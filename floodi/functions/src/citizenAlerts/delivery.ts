import { createHash, randomBytes } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { assessShadowEvidence, ShadowEpisode, ShadowIntent, ShadowRevision, ShadowState } from '../alerts/engine';
import { CAROLINA_BEACH_SHADOW_POLICY } from '../alerts/jobs';
import { normalizeShadowPublication } from '../alerts/store';
import { isDeliveryEligible } from './service';
import { CitizenAccount, CitizenDelivery, CitizenSubscription, DeliveryConfiguration, OUTBOX, SUBSCRIPTIONS } from './types';
import { EmailProvider, EmailProviderError } from './provider';

const MINUTE = 60_000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const MAX_ATTEMPTS = 5;
const eventTime = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
export interface CitizenDeliveryDependencies {
  account(uid: string): Promise<CitizenAccount>;
  provider: EmailProvider;
  configuration: DeliveryConfiguration;
  now?: () => Date;
}

export function citizenFloodMessage(revision: ShadowRevision): { subject: string; text: string } {
  const issued = eventTime.format(new Date(revision.issueId));
  if (revision.kind === 'forecast_revised_lower') return {
    subject: 'Carolina Beach flood forecast revised lower',
    text: `The forecast has fallen below the configured flood threshold at the monitored Carolina Beach gauge. This does not confirm that streets are dry.\nUpdated ${issued}.`,
  };
  const window = revision.window;
  const starts = eventTime.format(new Date(window.startAt));
  const ends = window.endAt ? eventTime.format(new Date(window.endAt)) : 'beyond the available alert forecast';
  return {
    subject: revision.kind === 'first_forecast' ? 'Flooding forecast for Carolina Beach' : 'Carolina Beach flood forecast updated',
    text: `Water levels are forecast above the Carolina Beach gauge flood threshold.\n${window.startClipped ? 'Already above threshold in this forecast: ' : 'Forecast flooding window: '}${starts} – ${ends}.\nPredicted peak: ${window.peakFt.toFixed(2)} ft MLLW at ${eventTime.format(new Date(window.peakAt))}. Gauge flood threshold: ${revision.thresholdFt.toFixed(2)} ft MLLW.\nIssued ${issued}.\nThis forecast concerns the monitored gauge. Street depth and road status are not established.`,
  };
}

/** Fan-out is bounded and resumable. The global shadow intent is read-only; no
 * recipient, send state or delivery result is ever written to the shadow path. */
export async function queueCitizenIntent(db: Firestore, intentId: string, configuration: DeliveryConfiguration, now = new Date()): Promise<{ queued: number; complete: boolean }> {
  if (!configuration.enabled) return { queued: 0, complete: true };
  if (!/^[a-f0-9]{32}$/.test(intentId)) throw new Error('Invalid citizen intent ID');
  const intentSnapshot = await db.doc(`shadow_alert_outbox/${intentId}`).get();
  const cursorRef = db.doc(`citizen_alert_fanout/${intentId}`);
  if (!intentSnapshot.exists) {
    await cursorRef.set({ complete: true, reason: 'source-missing', updatedAt: now.toISOString() });
    return { queued: 0, complete: true };
  }
  const intent = intentSnapshot.data() as ShadowIntent;
  if (intent.policyId !== CAROLINA_BEACH_SHADOW_POLICY.id || intent.decision !== 'would-notify' || intent.state !== 'simulated' || Date.parse(intent.expiresAt) <= +now) {
    await cursorRef.set({ complete: true, reason: 'source-no-longer-notifiable', updatedAt: now.toISOString() });
    return { queued: 0, complete: true };
  }
  const revisionSnapshot = await db.doc(`shadow_alert_states/${CAROLINA_BEACH_SHADOW_POLICY.id}/revisions/${intent.revisionId}`).get();
  if (!revisionSnapshot.exists) throw new Error('Citizen source revision is missing');
  const revision = revisionSnapshot.data() as ShadowRevision;
  const message = citizenFloodMessage(revision);
  const cursor = await cursorRef.get();
  if (cursor.data()?.complete) return { queued: 0, complete: true };
  const after = cursor.data()?.afterUid;
  let query = db.collection(SUBSCRIPTIONS).where('status', '==', 'active').orderBy('__name__').limit(100);
  if (typeof after === 'string') query = query.startAfter(after);
  const subscriptions = await query.get();
  let queued = 0;
  for (const snapshot of subscriptions.docs) {
    const subscription = snapshot.data() as CitizenSubscription;
    const id = hash(`${intent.policyId}|${intent.episodeId}|${intent.revisionId}|${subscription.uid}|${subscription.generation}`);
    const token = randomBytes(32).toString('hex');
    const accepted = await db.runTransaction(async transaction => {
      const [current, existing, currentIntent] = await Promise.all([
        transaction.get(snapshot.ref), transaction.get(db.doc(`${OUTBOX}/${id}`)), transaction.get(intentSnapshot.ref),
      ]);
      const value = current.data() as CitizenSubscription | undefined;
      if (existing.exists || !value || value.status !== 'active' || value.generation !== subscription.generation || currentIntent.data()?.state !== 'simulated' || Date.parse(intent.expiresAt) <= +now) return false;
      const at = now.toISOString();
      const delivery: CitizenDelivery = {
        version: 1, uid: value.uid, subscriptionGeneration: value.generation, email: value.email,
        kind: 'flood', state: 'queued', createdAt: at, updatedAt: at,
        // Provider idempotency lasts longer than this complete retry window.
        expiresAt: new Date(Math.min(Date.parse(intent.expiresAt), +now + 30 * MINUTE)).toISOString(),
        nextAttemptAt: at, attempts: 0, leaseId: null, leaseUntil: null, providerMessageId: null,
        subject: message.subject, text: message.text,
        unsubscribeToken: token, sourceIntentId: intentId, sourceEpisodeId: intent.episodeId, sourceRevisionId: intent.revisionId,
      };
      transaction.create(db.doc(`${OUTBOX}/${id}`), delivery);
      transaction.create(db.doc(`citizen_alert_unsubscribe/${hash(token)}`), { uid: value.uid, generation: value.generation, createdAt: at });
      transaction.create(snapshot.ref.collection('history').doc(id), { id, kind: 'flood', state: 'queued', createdAt: at, updatedAt: at, subject: delivery.subject });
      return true;
    });
    if (accepted) queued++;
  }
  const complete = subscriptions.size < 100;
  await cursorRef.set({ complete, afterUid: subscriptions.docs.at(-1)?.id ?? after ?? null, updatedAt: now.toISOString() });
  return { queued, complete };
}

/** A newly confirmed enrollment receives the current usable upcoming event even
 * if its original shadow notification expired or global fan-out finished earlier.
 * This creates a separate citizen delivery, never a new shadow revision. */
export async function queueCitizenEnrollment(db: Firestore, uid: string, configuration: DeliveryConfiguration, now = new Date()): Promise<number> {
  if (!configuration.enabled) return 0;
  const policy = CAROLINA_BEACH_SHADOW_POLICY;
  const [subscriptionSnapshot, stateSnapshot, currentSnapshot] = await Promise.all([
    db.doc(`${SUBSCRIPTIONS}/${uid}`).get(), db.doc(`shadow_alert_states/${policy.id}`).get(), db.doc(`locations/${policy.locationId}/outlook/current`).get(),
  ]);
  const subscription = subscriptionSnapshot.data() as CitizenSubscription | undefined;
  const state = stateSnapshot.data()?.state as ShadowState | undefined;
  if (!subscription || subscription.status !== 'active' || !state || state.evidenceStatus !== 'usable') return 0;
  if (currentSnapshot.data()?.generatedAt !== state.lastIssueId) throw new Error('Latest forecast evaluation is pending');
  const [publicationSnapshot, archiveSnapshot] = await Promise.all([
    db.doc(`forecast_publications/${policy.locationId}/issues/${state.lastIssueId}`).get(), db.doc(`forecast_archive/${policy.locationId}/issues/${state.lastIssueId}`).get(),
  ]);
  const publication = normalizeShadowPublication(publicationSnapshot.data(), policy.locationId, state.lastIssueId);
  if (!publication || assessShadowEvidence(publication, archiveSnapshot.data(), policy, now).reason !== null) return 0;
  const episodes = state.episodes.filter(episode => episode.status === 'predicted' && Date.parse(episode.window.endAt ?? episode.window.lastSampleAt) > +now);
  if (episodes.length > 16) throw new Error('Citizen episode working set exceeds safety bound');
  let queued = 0;
  for (const episode of episodes) {
    const revisions = await db.collection(`shadow_alert_states/${policy.id}/revisions`).where('episodeId', '==', episode.id).get();
    const revisionSnapshot = revisions.docs.find(value => value.data().revision === episode.revision);
    if (!revisionSnapshot) throw new Error('Current citizen episode revision is missing');
    const revisionId = revisionSnapshot.id;
    const revision = { ...revisionSnapshot.data(), window: episode.window, issueId: state.lastIssueId } as ShadowRevision;
    const message = citizenFloodMessage(revision);
    const id = hash(`${policy.id}|${episode.id}|${revisionId}|${uid}|${subscription.generation}`);
    const token = randomBytes(32).toString('hex');
    const accepted = await db.runTransaction(async transaction => {
      const ref = db.doc(`${OUTBOX}/${id}`);
      const [existing, freshSubscription, freshState] = await Promise.all([transaction.get(ref), transaction.get(subscriptionSnapshot.ref), transaction.get(stateSnapshot.ref)]);
      const fresh = freshSubscription.data() as CitizenSubscription | undefined;
      const latest = freshState.data()?.state as ShadowState | undefined;
      if (existing.exists || fresh?.status !== 'active' || fresh.generation !== subscription.generation || latest?.lastIssueId !== state.lastIssueId || latest.evidenceStatus !== 'usable') return false;
      const at = now.toISOString();
      const delivery: CitizenDelivery = {
        version: 1, uid, subscriptionGeneration: fresh.generation, email: fresh.email, kind: 'flood', state: 'queued',
        createdAt: at, updatedAt: at, expiresAt: new Date(Math.min(Date.parse(archiveSnapshot.data()!.expiresAt), +now + 30 * MINUTE, Date.parse(episode.window.endAt ?? episode.window.lastSampleAt))).toISOString(),
        nextAttemptAt: at, attempts: 0, leaseId: null, leaseUntil: null, providerMessageId: null,
        subject: message.subject, text: message.text, unsubscribeToken: token,
        sourceIntentId: null, sourceEpisodeId: episode.id, sourceRevisionId: revisionId,
      };
      transaction.create(ref, delivery);
      transaction.create(db.doc(`citizen_alert_unsubscribe/${hash(token)}`), { uid, generation: fresh.generation, createdAt: at });
      transaction.create(subscriptionSnapshot.ref.collection('history').doc(id), { id, kind: 'flood', state: 'queued', createdAt: at, updatedAt: at, subject: delivery.subject });
      return true;
    });
    if (accepted) queued++;
  }
  // A valid dry forecast also completes catch-up. Missing/stale evidence above
  // leaves the flag pending for the scheduler instead of dropping enrollment.
  await db.runTransaction(async transaction => {
    const [freshSubscription, freshState, freshCurrent] = await Promise.all([
      transaction.get(subscriptionSnapshot.ref), transaction.get(stateSnapshot.ref), transaction.get(currentSnapshot.ref),
    ]);
    const fresh = freshSubscription.data() as CitizenSubscription | undefined;
    const latest = freshState.data()?.state as ShadowState | undefined;
    if (fresh?.status === 'active' && fresh.generation === subscription.generation && latest?.lastIssueId === state.lastIssueId && latest.evidenceStatus === 'usable' && freshCurrent.data()?.generatedAt === state.lastIssueId) {
      transaction.update(subscriptionSnapshot.ref, { catchupPending: false });
    }
  });
  return queued;
}

/** Recheck actual current publication quality and episode revision at send time.
 * Earlier messages are cancelled when evidence is stale, superseded or revised;
 * a late worker can never turn an old forecast into a new notification. */
export async function citizenSourceStatus(db: Firestore, delivery: CitizenDelivery, now: Date): Promise<'current' | 'stale' | 'waiting'> {
  if (delivery.kind === 'test') return 'current';
  if (!delivery.sourceEpisodeId || !delivery.sourceRevisionId) return 'stale';
  const policy = CAROLINA_BEACH_SHADOW_POLICY;
  const [intentSnapshot, stateSnapshot, revisionSnapshot] = await Promise.all([
    delivery.sourceIntentId ? db.doc(`shadow_alert_outbox/${delivery.sourceIntentId}`).get() : Promise.resolve(null),
    db.doc(`shadow_alert_states/${policy.id}`).get(),
    db.doc(`shadow_alert_states/${policy.id}/revisions/${delivery.sourceRevisionId}`).get(),
  ]);
  const intent = intentSnapshot?.data() as ShadowIntent | undefined;
  const state = stateSnapshot.data()?.state as ShadowState | undefined;
  const revision = revisionSnapshot.data() as ShadowRevision | undefined;
  if (delivery.sourceIntentId && (!intent || intent.state !== 'simulated' || intent.decision !== 'would-notify' || Date.parse(intent.expiresAt) <= +now) || !state || state.evidenceStatus !== 'usable' || !revision) return 'stale';
  const episode: ShadowEpisode | undefined = state.episodes.find(value => value.id === delivery.sourceEpisodeId);
  if (!episode || episode.revision !== revision.revision || !['predicted', 'revised_lower'].includes(episode.status)) return 'stale';
  const [publicationSnapshot, archiveSnapshot, currentSnapshot] = await Promise.all([
    db.doc(`forecast_publications/${policy.locationId}/issues/${state.lastIssueId}`).get(),
    db.doc(`forecast_archive/${policy.locationId}/issues/${state.lastIssueId}`).get(),
    db.doc(`locations/${policy.locationId}/outlook/current`).get(),
  ]);
  if (currentSnapshot.data()?.generatedAt !== state.lastIssueId) return 'waiting';
  const publication = normalizeShadowPublication(publicationSnapshot.data(), policy.locationId, state.lastIssueId);
  return publication && assessShadowEvidence(publication, archiveSnapshot.data(), policy, now).reason === null ? 'current' : 'stale';
}

export async function citizenSourceStillCurrent(db: Firestore, delivery: CitizenDelivery, now: Date): Promise<boolean> {
  return await citizenSourceStatus(db, delivery, now) === 'current';
}

export function nextCitizenAttempt(attempts: number, now: Date): string {
  return new Date(+now + Math.min(10, 2 ** Math.max(0, attempts - 1)) * MINUTE).toISOString();
}

export async function listDueCitizenDeliveries(db: Firestore, now = new Date()) {
  const at = now.toISOString();
  const [ready, expiredLeases] = await Promise.all([
    db.collection(OUTBOX).where('state', 'in', ['queued', 'retry']).where('nextAttemptAt', '<=', at).orderBy('nextAttemptAt').limit(15).get(),
    db.collection(OUTBOX).where('state', '==', 'leased').where('leaseUntil', '<=', at).orderBy('leaseUntil').limit(5).get(),
  ]);
  return [...ready.docs, ...expiredLeases.docs];
}

export async function processCitizenDelivery(db: Firestore, id: string, dependencies: CitizenDeliveryDependencies): Promise<string> {
  if (!dependencies.configuration.enabled) return 'disabled';
  const now = dependencies.now ?? (() => new Date());
  const ref = db.doc(`${OUTBOX}/${id}`);
  const first = await ref.get();
  if (!first.exists) return 'missing';
  const original = first.data() as CitizenDelivery;
  // A missing/disabled account cancels this delivery; transient Auth errors
  // propagate so the worker can retry without claiming it was unsubscribed.
  const account = await dependencies.account(original.uid);
  const leaseId = randomBytes(16).toString('hex');
  const claimed = await db.runTransaction<CitizenDelivery | { terminal: CitizenDelivery['state'] } | null>(async transaction => {
    const [snapshot, subscriptionSnapshot] = await Promise.all([transaction.get(ref), transaction.get(db.collection(SUBSCRIPTIONS).doc(original.uid))]);
    if (!snapshot.exists) return null;
    const value = snapshot.data() as CitizenDelivery;
    const at = now();
    if (!['queued', 'retry', 'leased'].includes(value.state) || Date.parse(value.nextAttemptAt) > +at || value.state === 'leased' && Date.parse(value.leaseUntil ?? '') > +at) return null;
    let terminal: CitizenDelivery['state'] | null = null;
    if (Date.parse(value.expiresAt) <= +at) terminal = 'expired';
    else if (value.attempts >= MAX_ATTEMPTS) terminal = 'failed';
    else if (!isDeliveryEligible(subscriptionSnapshot.exists ? subscriptionSnapshot.data() as CitizenSubscription : null, account, dependencies.configuration, value.subscriptionGeneration) || value.email !== account.email) terminal = 'cancelled';
    if (terminal) {
      transaction.update(ref, { state: terminal, updatedAt: at.toISOString(), leaseId: null, leaseUntil: null });
      transaction.update(db.doc(`${SUBSCRIPTIONS}/${value.uid}/history/${id}`), { state: terminal, updatedAt: at.toISOString() });
      return { terminal };
    }
    transaction.update(ref, { state: 'leased', attempts: value.attempts + 1, leaseId, leaseUntil: new Date(+at + 90_000).toISOString(), updatedAt: at.toISOString() });
    return { ...value, attempts: value.attempts + 1 };
  });
  if (!claimed) return 'not-claimed';
  if ('terminal' in claimed) return claimed.terminal;
  let state: CitizenDelivery['state'] = 'sent';
  let providerMessageId: string | null = null;
  let failureCategory: string | null = null;
  let providerStatus: number | null = null;
  try {
    const [freshAccount, subscription, sourceCurrent] = await Promise.all([
      dependencies.account(claimed.uid), db.doc(`${SUBSCRIPTIONS}/${claimed.uid}`).get(), citizenSourceStatus(db, claimed, now()),
    ]);
    if (Date.parse(claimed.expiresAt) <= +now()) state = 'expired';
    else if (sourceCurrent === 'stale' || !isDeliveryEligible(subscription.exists ? subscription.data() as CitizenSubscription : null, freshAccount, dependencies.configuration, claimed.subscriptionGeneration) || claimed.email !== freshAccount.email) state = 'cancelled';
    else if (sourceCurrent === 'waiting') { state = 'retry'; failureCategory = 'waiting-for-forecast-evaluation'; }
    else providerMessageId = await dependencies.provider.send({ id, to: claimed.email, subject: claimed.subject, text: claimed.text, unsubscribeToken: claimed.unsubscribeToken });
  } catch (error) {
    state = error instanceof EmailProviderError && !error.retryable || claimed.attempts >= MAX_ATTEMPTS ? 'failed' : 'retry';
    failureCategory = error instanceof EmailProviderError ? error.retryable ? 'provider-transient' : 'provider-rejected' : 'dependency-unavailable';
    providerStatus = error instanceof EmailProviderError ? error.status : null;
  }
  const at = now();
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (snapshot.data()?.leaseId !== leaseId || snapshot.data()?.state !== 'leased') return;
    transaction.update(ref, { state, updatedAt: at.toISOString(), providerMessageId, leaseId: null, leaseUntil: null, failureCategory, providerStatus,
      nextAttemptAt: state === 'retry' ? nextCitizenAttempt(claimed.attempts, at) : at.toISOString() });
    transaction.update(db.doc(`${SUBSCRIPTIONS}/${claimed.uid}/history/${id}`), { state, updatedAt: at.toISOString() });
  });
  return state;
}

import type { Firestore, DocumentData } from 'firebase-admin/firestore';
import { evaluateShadowPublication, ShadowPolicy, ShadowPublication, ShadowState, ShadowTransition } from './engine';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const timestamp = (value: unknown): string | null => {
  if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*Z$/.test(value) && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  if (record(value) && typeof value.toDate === 'function') {
    const date: unknown = value.toDate();
    if (date instanceof Date && Number.isFinite(+date)) return date.toISOString();
  }
  return null;
};

export function normalizeShadowPublication(value: unknown, locationId: string, issueId: string): ShadowPublication | null {
  if (!record(value) || value.version !== 1 || value.locationId !== locationId || value.issueId !== issueId || value.generatedAt !== issueId ||
      !timestamp(value.generatedAt) || !timestamp(value.publishedAt) || !['available', 'experimental', 'unavailable'].includes(String(value.status)) ||
      ['archivePath', 'referenceVersion', 'sensor', 'tideStation'].some(key => typeof value[key] !== 'string' || !value[key]) ||
      ['inputPath', 'modelPath'].some(key => value[key] !== null && typeof value[key] !== 'string') ||
      ['offsetFt', 'phaseMinutes', 'thresholdFt'].some(key => typeof value[key] !== 'number' || !Number.isFinite(value[key])) || value.datum !== 'MLLW' || value.units !== 'ft') return null;
  return { ...value, publishedAt: timestamp(value.publishedAt)! } as unknown as ShadowPublication;
}

type PendingIntent = { id: string; issueId: string; episodeId: string; expiresAt: string };
export interface ShadowProcessResult {
  result: ShadowTransition['result'] | 'missing-publication';
  revisions: number;
  intents: number;
  reason: string | null;
}

/** Atomic state, revision, decision and shadow-intent writes. There are no
 * provider effects here: Firestore can rerun this callback after a conflict. */
export async function processShadowPublication(db: Firestore, policy: ShadowPolicy, issueId: string, now: Date): Promise<ShadowProcessResult> {
  if (!/^\d{4}-\d\d-\d\dT.*Z$/.test(issueId) || !Number.isFinite(Date.parse(issueId)) || issueId.includes('/')) throw new Error('Invalid shadow publication ID');
  const stateRef = db.doc(`shadow_alert_states/${policy.id}`);
  const publicationRef = db.doc(`forecast_publications/${policy.locationId}/issues/${issueId}`);
  return db.runTransaction(async transaction => {
    const publicationSnapshot = await transaction.get(publicationRef);
    if (!publicationSnapshot.exists) return { result: 'missing-publication', revisions: 0, intents: 0, reason: 'missing-publication' };
    const publication = normalizeShadowPublication(publicationSnapshot.data(), policy.locationId, issueId);
    if (!publication) throw new Error('Malformed committed shadow publication');
    // REQUEST_TIME is server processing time; creation metadata is the safer
    // availability bound when the two differ. Neither comes from a client clock.
    const createdAt = publicationSnapshot.createTime?.toDate();
    if (createdAt && +createdAt > Date.parse(publication.publishedAt)) publication.publishedAt = createdAt.toISOString();
    const stateSnapshot = await transaction.get(stateRef);
    const stored = stateSnapshot.data();
    const previous = (stored?.state ?? null) as ShadowState | null;
    // Marker archive paths are validated against the policy before use. Never
    // let an event payload direct this Admin SDK reader to an unrelated path.
    const expectedArchive = `forecast_archive/${policy.locationId}/issues/${issueId}`;
    const archiveSnapshot = await transaction.get(db.doc(expectedArchive));
    if (!archiveSnapshot.exists) throw new Error('Committed forecast archive is missing');
    const transition = evaluateShadowPublication(publication, archiveSnapshot.data(), previous, policy, now);
    if (transition.result === 'out-of-order') return { result: transition.result, revisions: 0, intents: 0, reason: transition.reason };
    const pending = (Array.isArray(stored?.pendingIntents) ? stored.pendingIntents : []) as PendingIntent[];
    if (pending.length > 64) throw new Error('Shadow intent working set exceeds safety bound');
    const pendingSnapshots = await Promise.all(pending.map(intent => transaction.get(db.doc(`shadow_alert_outbox/${intent.id}`))));
    const decisionRef = stateRef.collection('decisions').doc(transition.decisionId);
    const decisionSnapshot = transition.result === 'applied' ? await transaction.get(decisionRef) : null;
    // A committed decision and state always advance together. A mismatch must
    // be investigated rather than overwritten with a second evaluation.
    if (decisionSnapshot?.exists) throw new Error('Shadow decision exists without its expected state');
    const replacedEpisodes = new Set(transition.revisions.map(revision => revision.episodeId));
    const keep: PendingIntent[] = [];
    for (let i = 0; i < pending.length; i++) {
      const intent = pending[i], snapshot = pendingSnapshots[i];
      if (!snapshot.exists || snapshot.data()?.state !== 'simulated') continue;
      const expired = Date.parse(intent.expiresAt) <= +now;
      // A routine new issue does not retract an unchanged episode. Preserve the
      // original meaningful intent until its own expiry or a material revision.
      const superseded = replacedEpisodes.has(intent.episodeId) || transition.state?.evidenceStatus !== 'usable';
      if (expired || superseded) transaction.update(snapshot.ref, { state: expired ? 'expired' : 'superseded', closedAt: now.toISOString(), supersededByIssueId: superseded ? issueId : null, delivery: 'not-attempted' });
      else keep.push(intent);
    }
    if (transition.result === 'applied') {
      transaction.create(decisionRef, {
        version: 1, mode: 'shadow', delivery: 'not-attempted', decisionId: transition.decisionId,
        issueId, generatedAt: publication.generatedAt, publishedAt: publication.publishedAt,
        evaluatedAt: now.toISOString(), result: transition.result, reason: transition.reason,
        evidenceStatus: transition.state!.evidenceStatus, revisionCount: transition.revisions.length,
        policy, archivePath: expectedArchive, inputPath: publication.inputPath,
        modelPath: publication.modelPath, forecastStatus: publication.status,
      });
      for (const episode of transition.state!.episodes) transaction.set(stateRef.collection('episodes').doc(episode.id), { ...episode, policyId: policy.id, policyVersion: policy.version, referenceVersion: policy.referenceVersion, basis: 'predicted-gauge-threshold-only', datum: policy.datum, units: policy.units, thresholdFt: policy.thresholdFt });
      for (const revision of transition.revisions) transaction.create(stateRef.collection('revisions').doc(revision.id), revision as unknown as DocumentData);
      for (const intent of transition.intents) {
        transaction.create(db.doc(`shadow_alert_outbox/${intent.id}`), { ...intent, locationId: policy.locationId, mode: 'shadow', recipientCount: 0 });
        if (intent.state === 'simulated') keep.push({ id: intent.id, issueId: intent.issueId, episodeId: intent.episodeId, expiresAt: intent.expiresAt });
      }
    }
    if (keep.length > 64) throw new Error('Shadow intent working set exceeds safety bound; no state changes committed');
    if (transition.result === 'applied' || keep.length !== pending.length) transaction.set(stateRef, { version: 1, mode: 'shadow', policy, state: transition.state, pendingIntents: keep, updatedAt: now.toISOString() });
    return { result: transition.result, revisions: transition.revisions.length, intents: transition.intents.length, reason: transition.reason };
  });
}

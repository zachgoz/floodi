import { createHash, randomBytes } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { CITIZEN_CONSENT_VERSION, CITIZEN_COVERAGE, SUBSCRIPTIONS, OUTBOX, CitizenAccount, CitizenActionRequest, CitizenDelivery, CitizenHistory, CitizenStatusResponse, CitizenSubscription, DeliveryConfiguration, SubscriptionStatus } from './types';

const HOUR = 3600_000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export class CitizenRequestError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code); }
}

export function parseCitizenAction(value: unknown): CitizenActionRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  if (Object.keys(request).some(key => !['action', 'consentVersion'].includes(key)) || typeof request.action !== 'string' ||
      !['enroll', 'resume', 'pause', 'unsubscribe', 'test'].includes(request.action) ||
      request.consentVersion !== undefined && request.consentVersion !== CITIZEN_CONSENT_VERSION) return null;
  if (['enroll', 'resume'].includes(request.action) && request.consentVersion !== CITIZEN_CONSENT_VERSION) return null;
  return request as unknown as CitizenActionRequest;
}

export function enrolledStatus(account: CitizenAccount, configuration: DeliveryConfiguration): SubscriptionStatus {
  if (!account.emailVerified) return 'verification-required';
  return configuration.enabled ? 'active' : 'early-access';
}
export function isDeliveryEligible(subscription: CitizenSubscription | null, account: CitizenAccount, configuration: DeliveryConfiguration, generation?: number): boolean {
  return configuration.enabled && !account.disabled && account.emailVerified && !!account.email &&
    !!subscription && subscription.status === 'active' && subscription.uid === account.uid &&
    subscription.email === account.email && subscription.consentVersion === CITIZEN_CONSENT_VERSION &&
    subscription.coverage === CITIZEN_COVERAGE && (generation === undefined || subscription.generation === generation);
}

export function publicSubscription(subscription: CitizenSubscription | null, account: CitizenAccount, configuration: DeliveryConfiguration) {
  if (!subscription) return null;
  // Configuration/verification becoming available never silently promotes an
  // early-access registration into live delivery. The resident confirms resume.
  let status = subscription.status;
  if (status === 'active' && !isDeliveryEligible(subscription, account, configuration)) status = !account.emailVerified || subscription.email !== account.email ? 'verification-required' : 'early-access';
  return { status, email: account.email, emailVerified: account.emailVerified,
    coverage: subscription.coverage, channel: subscription.channel, consentVersion: subscription.consentVersion,
    createdAt: subscription.createdAt, updatedAt: subscription.updatedAt };
}

export function guestCitizenStatus(configuration: DeliveryConfiguration): CitizenStatusResponse {
  return { version: 1, locationId: 'carolina-beach', deliveryReady: configuration.enabled,
    readinessReason: configuration.enabled ? 'email-pilot-enabled' : 'email-delivery-not-enabled', billingEnabled: false,
    consentVersion: CITIZEN_CONSENT_VERSION, email: null, emailVerified: false, subscription: null, history: [] };
}

export async function getCitizenStatus(db: Firestore, account: CitizenAccount, configuration: DeliveryConfiguration): Promise<CitizenStatusResponse> {
  const ref = db.collection(SUBSCRIPTIONS).doc(account.uid);
  const [snapshot, events] = await Promise.all([ref.get(), ref.collection('history').orderBy('createdAt', 'desc').limit(20).get()]);
  return { ...guestCitizenStatus(configuration), email: account.email, emailVerified: account.emailVerified,
    subscription: publicSubscription(snapshot.exists ? snapshot.data() as CitizenSubscription : null, account, configuration),
    history: events.docs.map(event => {
      const data = event.data();
      return { id: event.id, kind: data.kind, state: data.state, createdAt: data.createdAt, updatedAt: data.updatedAt, subject: data.subject } as CitizenHistory;
    }) };
}

/** Client contact/entitlement fields never enter this path. Email and verification
 * come from a fresh Admin Auth read, and every opt-out revokes queued generations. */
export async function applyCitizenAction(db: Firestore, account: CitizenAccount, configuration: DeliveryConfiguration, request: CitizenActionRequest, now = new Date()): Promise<void> {
  if (account.disabled || !account.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.email)) throw new CitizenRequestError(400, 'email-account-required');
  if (!parseCitizenAction(request)) throw new CitizenRequestError(400, 'invalid-request');
  const at = now.toISOString();
  const ref = db.collection(SUBSCRIPTIONS).doc(account.uid);
  // Tokens are random, server created and independent of Firebase credentials.
  // Only their hash is retained on enrollment; a delivery stores its own token.
  const token = randomBytes(32).toString('hex');
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const previous = snapshot.exists ? snapshot.data() as CitizenSubscription : null;
    if (request.action === 'pause' || request.action === 'unsubscribe') {
      if (!previous || previous.status === (request.action === 'pause' ? 'paused' : 'unsubscribed')) return;
      const state = request.action === 'pause' ? 'paused' : 'unsubscribed';
      transaction.update(ref, { status: state, generation: previous.generation + 1, updatedAt: at, catchupPending: false });
      const event: CitizenHistory = { id: `${request.action}-${+now}`, kind: request.action === 'pause' ? 'pause' : 'unsubscribe', state, createdAt: at, updatedAt: at, subject: request.action === 'pause' ? 'Flood alerts paused' : 'Flood alerts unsubscribed' };
      transaction.set(ref.collection('history').doc(event.id), event);
      return;
    }
    if (request.action === 'test') {
      if (!isDeliveryEligible(previous, account, configuration)) throw new CitizenRequestError(409, configuration.enabled ? 'verified-active-subscription-required' : 'delivery-not-enabled');
      if (previous!.lastTestAt && +now - Date.parse(previous!.lastTestAt) < HOUR) throw new CitizenRequestError(429, 'test-rate-limited');
      const id = `test-${hash(`${account.uid}|${Math.floor(+now / HOUR)}`)}`;
      const queued = await transaction.get(db.doc(`${OUTBOX}/${id}`));
      if (queued.exists) throw new CitizenRequestError(429, 'test-rate-limited');
      const delivery: CitizenDelivery = {
        version: 1, uid: account.uid, email: account.email!, subscriptionGeneration: previous!.generation,
        kind: 'test', state: 'queued', createdAt: at, updatedAt: at, expiresAt: new Date(+now + 15 * 60_000).toISOString(),
        nextAttemptAt: at, attempts: 0, leaseId: null, leaseUntil: null, providerMessageId: null,
        subject: 'Your FloodCast test alert', text: 'Your email flood alerts are connected for Carolina Beach. This is a test, not a flooding forecast. Coverage uses the Carolina Beach water-level gauge; street depth and road status are not established.',
        unsubscribeToken: token, sourceIntentId: null, sourceEpisodeId: null, sourceRevisionId: null,
      };
      transaction.create(db.doc(`${OUTBOX}/${id}`), delivery);
      transaction.update(ref, { lastTestAt: at, updatedAt: at });
      transaction.create(ref.collection('history').doc(id), { id, kind: 'test', state: 'queued', createdAt: at, updatedAt: at, subject: delivery.subject });
      transaction.create(db.doc(`citizen_alert_unsubscribe/${hash(token)}`), { uid: account.uid, generation: previous!.generation, createdAt: at });
      return;
    }
    if (previous && +now - Date.parse(previous.updatedAt) < 5_000 && !['paused', 'unsubscribed'].includes(previous.status)) throw new CitizenRequestError(429, 'please-wait');
    const quotaRef = db.doc(`_citizenAlertLimits/${account.uid}`);
    const quotaSnapshot = await transaction.get(quotaRef);
    const hour = Math.floor(+now / HOUR);
    const count = quotaSnapshot.data()?.hour === hour ? Number(quotaSnapshot.data()?.count ?? 0) : 0;
    if (count >= 12) throw new CitizenRequestError(429, 'enrollment-rate-limited');
    const status = enrolledStatus(account, configuration);
    const subscription: CitizenSubscription = {
      version: 1, uid: account.uid, email: account.email!, status, locationId: 'carolina-beach', coverage: CITIZEN_COVERAGE,
      channel: 'email', consentVersion: CITIZEN_CONSENT_VERSION, consentAt: at,
      createdAt: previous?.createdAt ?? at, updatedAt: at, generation: (previous?.generation ?? 0) + 1,
      catchupPending: status === 'active',
      unsubscribeHash: hash(token), lastTestAt: previous?.lastTestAt ?? null,
    };
    transaction.set(ref, subscription);
    transaction.set(quotaRef, { hour, count: count + 1 });
    const id = `enroll-${+now}`;
    transaction.set(ref.collection('history').doc(id), { id, kind: 'enrollment', state: status, createdAt: at, updatedAt: at,
      subject: status === 'active' ? 'Email flood alerts enabled' : status === 'verification-required' ? 'Verify your email to finish joining' : 'Joined flood alert early access' });
  });
}

/** Opaque one-click unsubscribe tokens cannot reveal accounts or subscribe them.
 * A token from an older enrollment cannot revoke a later, explicit re-enrollment. */
export async function unsubscribeWithToken(db: Firestore, token: string, now = new Date()): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new CitizenRequestError(400, 'invalid-unsubscribe-token');
  const tokenRef = db.doc(`citizen_alert_unsubscribe/${hash(token)}`);
  await db.runTransaction(async transaction => {
    const tokenSnapshot = await transaction.get(tokenRef);
    if (!tokenSnapshot.exists) return;
    const data = tokenSnapshot.data()!;
    const ref = db.collection(SUBSCRIPTIONS).doc(data.uid);
    const snapshot = await transaction.get(ref);
    const subscription = snapshot.data() as CitizenSubscription | undefined;
    if (subscription && subscription.generation === data.generation && subscription.status !== 'unsubscribed') {
      const at = now.toISOString();
      transaction.update(ref, { status: 'unsubscribed', updatedAt: at, generation: subscription.generation + 1, catchupPending: false });
      const id = `unsubscribe-${+now}`;
      transaction.set(ref.collection('history').doc(id), { id, kind: 'unsubscribe', state: 'unsubscribed', createdAt: at, updatedAt: at, subject: 'Flood alerts unsubscribed' });
    }
    transaction.delete(tokenRef);
  });
}

import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { onRequest } from 'firebase-functions/v2/https';
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { citizenDeliveryConfiguration } from './config';
import { queueCitizenIntent, queueCitizenEnrollment, listDueCitizenDeliveries, processCitizenDelivery } from './delivery';
import { createResendProvider } from './provider';
import { CitizenRequestError, applyCitizenAction, getCitizenStatus, getPublicAlertFeed, renderPublicAlertChartPng, unsubscribeWithToken } from './service';
import { CitizenAccount } from './types';
import { createCitizenHttpHandler, isCitizenAuthenticationFailure } from './http';

function db() {
  if (!admin.apps.length) admin.initializeApp();
  return admin.firestore();
}
async function account(uid: string): Promise<CitizenAccount> {
  const user = await admin.auth().getUser(uid);
  return { uid: user.uid, email: user.email ?? null, emailVerified: user.emailVerified, disabled: user.disabled };
}

export function citizenAllowedOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const project = env.GCLOUD_PROJECT ?? env.GOOGLE_CLOUD_PROJECT;
  const result = new Set(['capacitor://localhost', 'ionic://localhost', 'https://localhost', 'http://localhost']);
  if (project && /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project)) {
    result.add(`https://${project}.web.app`);
    result.add(`https://${project}.firebaseapp.com`);
  }
  const configured = citizenDeliveryConfiguration(env).publicBaseUrl;
  if (configured) result.add(configured);
  if (env.FUNCTIONS_EMULATOR === 'true') result.add('http://localhost:5173');
  return result;
}

// The disabled deployment must not require creation of an unused provider secret.
// Turning on delivery requires deploying again with the operator switch enabled,
// which binds the existing Secret Manager value to the API and worker runtimes.
const providerSecrets = process.env.CITIZEN_ALERT_DELIVERY_ENABLED === 'true' ? ['CITIZEN_ALERT_RESEND_API_KEY'] : [];

export const citizenAlerts = onRequest({ maxInstances: 3, timeoutSeconds: 60, secrets: providerSecrets }, createCitizenHttpHandler({
  configuration: citizenDeliveryConfiguration,
  allowedOrigins: citizenAllowedOrigins,
  authenticate: async token => {
    db();
    try {
      const decoded = await admin.auth().verifyIdToken(token, true);
      return await account(decoded.uid);
    } catch (error) {
      // A backend Auth outage must not pretend the resident's session expired.
      throw new CitizenRequestError(isCitizenAuthenticationFailure(error) ? 401 : 503, isCitizenAuthenticationFailure(error) ? 'sign-in-required' : 'alerts-unavailable');
    }
  },
  status: (current, configuration) => getCitizenStatus(db(), current, configuration),
  action: (current, configuration, request) => applyCitizenAction(db(), current, configuration, request),
  unsubscribe: token => unsubscribeWithToken(db(), token),
  publicFeed: () => getPublicAlertFeed(db()),
  chartPng: highlightPeakIso => renderPublicAlertChartPng(db(), highlightPeakIso),
  // Auth tokens, email addresses, request bodies and unsubscribe capabilities
  // must never enter application error logs.
  logFailure: () => logger.error('Citizen alert request failed', { event: 'citizen_alert_request_failed' }),
}));

export const queueCitizenFloodAlerts = onDocumentCreated({
  document: 'shadow_alert_outbox/{intentId}', maxInstances: 1, timeoutSeconds: 120, memory: '256MiB', retry: true,
  secrets: providerSecrets,
}, async event => {
  const configuration = citizenDeliveryConfiguration();
  if (!configuration.enabled) return;
  try {
    const result = await queueCitizenIntent(db(), event.params.intentId, configuration);
    logger.info('Citizen alert fan-out evaluated', { event: 'citizen_alert_queued', ...result });
  } catch {
    logger.error('Citizen alert fan-out failed', { event: 'citizen_alert_fanout_failed' });
    throw new Error('Citizen alert fan-out unavailable');
  }
});

export const queueCitizenAlertEnrollment = onDocumentWritten({
  document: 'citizen_alert_subscriptions/{uid}', maxInstances: 1, timeoutSeconds: 120, memory: '256MiB', retry: true,
  secrets: providerSecrets,
}, async event => {
  const configuration = citizenDeliveryConfiguration();
  if (!configuration.enabled) return;
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!after || after.status !== 'active' || before?.status === 'active' && before?.generation === after.generation) return;
  try {
    const queued = await queueCitizenEnrollment(db(), event.params.uid, configuration);
    logger.info('Citizen alert enrollment checked upcoming events', { event: 'citizen_alert_enrollment_queued', queued });
  } catch {
    logger.error('Citizen alert enrollment fan-out failed', { event: 'citizen_alert_fanout_failed' });
    throw new Error('Citizen alert enrollment fan-out unavailable');
  }
});

export const deliverCitizenFloodAlerts = onSchedule({
  schedule: 'every 1 minutes', maxInstances: 1, concurrency: 1, timeoutSeconds: 540, memory: '256MiB',
  retryCount: 0, secrets: providerSecrets,
}, async () => {
  const configuration = citizenDeliveryConfiguration();
  if (!configuration.enabled) return;
  const firestore = db();
  const pendingEnrollments = await firestore.collection('citizen_alert_subscriptions').where('catchupPending', '==', true).limit(5).get();
  for (const enrollment of pendingEnrollments.docs) {
    try { await queueCitizenEnrollment(firestore, enrollment.id, configuration); }
    catch { logger.error('Citizen alert enrollment retry failed', { event: 'citizen_alert_fanout_failed' }); }
  }
  // Resume fan-out beyond the first 100 subscribers without Cloud Tasks or a
  // blocking transaction around provider effects. IDs make every resume safe.
  const pendingFanout = await firestore.collection('citizen_alert_fanout').where('complete', '==', false).limit(2).get();
  for (const fanout of pendingFanout.docs) {
    try { await queueCitizenIntent(firestore, fanout.id, configuration); }
    catch { logger.error('Citizen alert fan-out resume failed', { event: 'citizen_alert_fanout_failed' }); }
  }
  const queued = await listDueCitizenDeliveries(firestore);
  const outcomes: Record<string, number> = {};
  for (const delivery of queued) {
    try {
      const result = await processCitizenDelivery(firestore, delivery.id, {
        configuration, account: async uid => {
          try { return await account(uid); }
          catch (error) {
            if ((error as { code?: string }).code === 'auth/user-not-found') return { uid, email: null, emailVerified: false, disabled: true };
            throw error;
          }
        }, provider: createResendProvider(configuration),
      });
      outcomes[result] = (outcomes[result] ?? 0) + 1;
      if (result === 'failed') {
        const failed = (await delivery.ref.get()).data();
        logger.error('Citizen email delivery permanently failed', {
          event: 'citizen_alert_delivery_rejected',
          category: ['provider-rejected', 'provider-transient', 'dependency-unavailable'].includes(failed?.failureCategory) ? failed?.failureCategory : 'attempts-exhausted',
          providerStatus: Number.isInteger(failed?.providerStatus) ? failed?.providerStatus : null,
        });
      }
    } catch {
      // Remain queued/leased and retry after lease expiry; do not classify a
      // transient Firestore/Auth outage as successful delivery or an opt-out.
      outcomes.error = (outcomes.error ?? 0) + 1;
      logger.error('Citizen alert delivery worker failed', { event: 'citizen_alert_delivery_failed' });
    }
  }
  if (queued.length) logger.info('Citizen alert delivery worker completed', { event: 'citizen_alert_delivery_completed', processed: queued.length, outcomes });
});

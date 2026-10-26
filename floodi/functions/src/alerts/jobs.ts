import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FORECAST_REFERENCE_VERSION } from '../forecast/publication';
import { SITE } from '../forecast/sources';
import { safeError } from '../utils/observability';
import { ShadowPolicy } from './engine';
import { processShadowPublication } from './store';

/** This policy is a gauge-only rehearsal. Its tolerances are versioned product
 * settings, not calibrated municipal notification criteria or confidence levels.
 * A policy/reference change requires a new ID to preserve episode provenance. */
export const CAROLINA_BEACH_SHADOW_POLICY: ShadowPolicy = {
  id: 'carolina-beach-gauge-shadow-v1', version: 'gauge-shadow-v1', mode: 'shadow', scope: 'shared-gauge',
  locationId: SITE.id, referenceVersion: FORECAST_REFERENCE_VERSION,
  sensor: SITE.sensor, tideStation: SITE.tideStation, datum: 'MLLW', units: 'ft',
  offsetFt: SITE.offsetFt, phaseMinutes: SITE.phaseMinutes, thresholdFt: SITE.thresholdFt,
  maximumIssueAgeMinutes: 30, maximumObservationAgeMinutes: 60,
  maximumPointGapMinutes: 15, previewHorizonHours: 24,
  meaningfulTimeChangeMinutes: 15, meaningfulPeakChangeFt: 0.1,
  identityPeakToleranceMinutes: 60,
};

/** Only committed numerical issues can start an evaluation. The public current
 * pointer and optional AI explanation cannot trigger duplicate notifications. */
export const evaluateShadowFloodAlerts = onDocumentCreated({
  document: 'forecast_publications/{locationId}/issues/{issueId}',
  timeoutSeconds: 120, memory: '256MiB', maxInstances: 2, retry: true,
}, async event => {
  if (event.params.locationId !== SITE.id) return;
  if (!admin.apps.length) admin.initializeApp();
  try {
    const result = await processShadowPublication(admin.firestore(), CAROLINA_BEACH_SHADOW_POLICY, event.params.issueId, new Date());
    logger.info('Shadow flood alert issue evaluated; no delivery attempted', { event: 'shadow_alert_evaluated', locationId: SITE.id, issueId: event.params.issueId, mode: 'shadow', ...result });
  } catch (error) {
    logger.error('Shadow flood alert evaluation failed', { event: 'shadow_alert_failed', locationId: SITE.id, issueId: event.params.issueId, error: safeError(error) });
    throw error;
  }
});

/** Repairs a missed latest trigger and checks freshness during forecast outages.
 * Replaying the same usable issue is a no-op. Stale evidence records unresolved;
 * it never closes an episode as safe or dry. */
export const reconcileShadowFloodAlerts = onSchedule({
  schedule: 'every 10 minutes', timeoutSeconds: 120, memory: '256MiB',
  maxInstances: 1, concurrency: 1, retryCount: 1, minBackoffSeconds: 60,
}, async () => {
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();
  try {
    const latest = await db.collection(`forecast_publications/${SITE.id}/issues`).orderBy('generatedAt', 'desc').limit(1).get();
    if (latest.empty) {
      logger.info('No committed issue exists for shadow alerts', { event: 'shadow_alert_no_publication', locationId: SITE.id, mode: 'shadow' });
      return;
    }
    const issueId = latest.docs[0].id;
    const result = await processShadowPublication(db, CAROLINA_BEACH_SHADOW_POLICY, issueId, new Date());
    logger.info('Shadow flood alert reconciliation complete; no delivery attempted', { event: 'shadow_alert_reconciled', locationId: SITE.id, issueId, mode: 'shadow', ...result });
  } catch (error) {
    logger.error('Shadow flood alert reconciliation failed', { event: 'shadow_alert_reconcile_failed', locationId: SITE.id, error: safeError(error) });
    throw error;
  }
});

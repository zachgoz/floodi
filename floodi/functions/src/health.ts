import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { readObservationRange } from './utils/observationBuckets';
import { safeError } from './utils/observability';
import { SITE } from './forecast/sources';
import { isCurrentOperationalOutlook } from './forecast/jobs';

const MINUTE = 60_000;
type Freshness = { ageMinutes: number | null; fresh: boolean; latestAt: string | null };

export function freshness(timestamp: unknown, maximumMinutes: number, now: Date): Freshness {
  const ms = typeof timestamp === 'string' ? Date.parse(timestamp) : NaN;
  const valid = Number.isFinite(ms) && ms <= +now;
  const ageMinutes = valid ? Math.round(((+now - ms) / MINUTE) * 10) / 10 : null;
  return {
    latestAt: valid ? new Date(ms).toISOString() : null,
    ageMinutes,
    fresh: valid && +now - ms <= maximumMinutes * MINUTE,
  };
}

export function assessDataHealth(
  observations: { fiman: Record<string, number>; noaa: Record<string, number> },
  operationalOutlook: unknown,
  predictionJob: Record<string, unknown> | undefined,
  now: Date
) {
  const latest = (records: Record<string, number>) =>
    Object.entries(records)
      .filter(([t, v]) => Number.isFinite(v) && Number.isFinite(Date.parse(t)) && Date.parse(t) <= +now)
      .sort(([a], [b]) => Date.parse(b) - Date.parse(a))[0]?.[0];

  const validOutlook = isCurrentOperationalOutlook(operationalOutlook, now);
  const outlookDoc = operationalOutlook as { generatedAt?: string; expiresAt?: string; status?: string } | undefined;

  const sources = {
    gauge: freshness(latest(observations.fiman), 60, now),
    noaa: freshness(latest(observations.noaa), 60, now),
    outlook: freshness(validOutlook ? outlookDoc?.generatedAt : null, 30, now),
    predictions: freshness(
      (predictionJob?.sourceLastSuccessfulAt as Record<string, unknown> | undefined)?.noaa,
      36 * 60,
      now
    ),
  };
  if (validOutlook && (outlookDoc?.status !== 'available' || Date.parse(outlookDoc?.expiresAt ?? '') <= +now)) {
    sources.outlook.fresh = false;
  }
  const staleSources = Object.entries(sources)
    .filter(([, value]) => !value.fresh)
    .map(([source]) => source);
  return { healthy: staleSources.length === 0, staleSources, sources };
}

/** Independent inspection catches stale data across observed gauges, NOAA tide sync,
 * and the primary Operational Forecast (`timesfm-3` + Basin Physics). */
export const checkDataHealth = onSchedule(
  {
    schedule: 'every 10 minutes',
    timeoutSeconds: 120,
    memory: '256MiB',
    maxInstances: 1,
    concurrency: 1,
    retryCount: 1,
    minBackoffSeconds: 60,
  },
  async () => {
    if (!admin.apps.length) admin.initializeApp();
    const db = admin.firestore();
    const now = new Date();
    try {
      const [observations, operationalOutlook, predictions] = await Promise.all([
        readObservationRange(db, SITE.id, new Date(+now - 24 * 60 * MINUTE), now, { now }),
        db.doc(`locations/${SITE.id}/forecast_challengers/timesfm-3/outlook/current`).get(),
        db.doc(`operationalHealth/syncPredictions_${SITE.id}`).get(),
      ]);
      const health = assessDataHealth(observations, operationalOutlook.data(), predictions.data(), now);
      await db.doc(`operationalHealth/data_${SITE.id}`).set({ ...health, checkedAt: now.toISOString() });
      const event = { event: 'data_health', locationId: SITE.id, checkedAt: now.toISOString(), ...health };
      if (health.healthy) logger.info('Data freshness check passed', event);
      else logger.error('Flood data requires attention', event);
    } catch (error) {
      logger.error('Data freshness check failed', {
        event: 'data_health_check_failed',
        locationId: SITE.id,
        error: safeError(error),
      });
      throw error;
    }
  }
);

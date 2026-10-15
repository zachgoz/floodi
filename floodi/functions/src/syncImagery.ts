import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { persistImageryBatch } from './utils/storage';
import { readObservationRange, writeObservationBuckets } from './utils/observationBuckets';
import { recordJobOutcome, safeError } from './utils/observability';
import { LOCATIONS } from './locations';
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

/** Archive recent high-value images independently of measurement ingestion. */
export const syncImagery = onSchedule({ schedule: 'every 30 minutes', memory: '512MiB', timeoutSeconds: 300, maxInstances: 1, concurrency: 1 }, async () => {
  const failures: unknown[] = [];
  const now = new Date();
  if (!LOCATIONS.length) {
    const error = new Error('No imagery locations configured');
    await recordJobOutcome(db, 'syncImagery', 'configuration', { attemptedAt: now.toISOString(), status: 'failed', error: safeError(error) });
    throw error;
  }
  for (const location of LOCATIONS) {
    try {
      const configuredThreshold = location.thresholds.minor;
      if (typeof configuredThreshold !== 'number' || !Number.isFinite(configuredThreshold)) throw new Error('Location flood threshold missing');
      const data = await readObservationRange(db, location.id, new Date(+now - 48 * 3600_000), now, { now });
      const { patch, ...stats } = await persistImageryBatch(location.id, data.imagery, data.fiman, configuredThreshold, { maxImages: 24, budgetMs: 90_000 });
      if (Object.keys(patch).length) await writeObservationBuckets(db, location.id, { imagery: patch }, { now });
      await recordJobOutcome(db, 'syncImagery', location.id, {
        attemptedAt: now.toISOString(),
        status: stats.failed ? stats.succeeded ? 'partial' : 'failed' : 'ok',
        imageReferences: Object.values(data.imagery).reduce((count, cameras) => count + Object.keys(cameras).length, 0),
        waterLevelSamples: Object.keys(data.fiman).length,
        imagery: stats,
      });
      if (stats.failed && !stats.succeeded) failures.push(new Error('All attempted image archives failed'));
    } catch (error) {
      failures.push(error);
      await recordJobOutcome(db, 'syncImagery', location.id, { attemptedAt: now.toISOString(), status: 'failed', error: safeError(error) });
    }
  }
  if (failures.length) throw new AggregateError(failures, 'Imagery archival did not complete successfully');
});

import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { persistImageryBatch } from './utils/storage';
import { readObservationRange, writeObservationBuckets } from './utils/observationBuckets';
import { recordJobOutcome, safeError } from './utils/observability';
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

/** Archive recent high-value images independently of measurement ingestion. */
export const syncImagery = onSchedule({ schedule: 'every 30 minutes', memory: '512MiB', timeoutSeconds: 300, maxInstances: 1, concurrency: 1 }, async () => {
  const failures: unknown[] = [];
  const now = new Date();
  const locations = await db.collection('locations').get();
  for (const location of locations.docs) {
    try {
      const data = await readObservationRange(db, location.id, new Date(+now - 48 * 3600_000), now, { now });
      const configuredThreshold = location.data().thresholds?.minor;
      if (typeof configuredThreshold !== 'number' || !Number.isFinite(configuredThreshold)) throw new Error('Location flood threshold missing');
      const result = await persistImageryBatch(location.id, data.imagery, data.fiman, configuredThreshold, { maxImages: 24, budgetMs: 90_000 });
      if (Object.keys(result.patch).length) await writeObservationBuckets(db, location.id, { imagery: result.patch }, { now });
      const { patch: _patch, ...stats } = result;
      await recordJobOutcome(db, 'syncImagery', location.id, { attemptedAt: now.toISOString(), status: result.failed ? result.succeeded ? 'partial' : 'failed' : 'ok', imagery: stats });
      if (result.failed && !result.succeeded) failures.push(new Error('All attempted image archives failed'));
    } catch (error) {
      failures.push(error);
      await recordJobOutcome(db, 'syncImagery', location.id, { attemptedAt: now.toISOString(), status: 'failed', error: safeError(error) });
    }
  }
  if (failures.length) throw new AggregateError(failures, 'Imagery archival did not complete successfully');
});

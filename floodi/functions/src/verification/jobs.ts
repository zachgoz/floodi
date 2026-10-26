import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { recordJobOutcome, safeError } from '../utils/observability';
import { loadVerificationDay, recentMaturedVerificationDays, verificationDayPath } from './repository';
import { VERIFICATION_VERSION } from './types';

if (!admin.apps.length) admin.initializeApp();

/** Private recomputable evidence, deliberately disconnected from alert sending,
 * model selection, forecast promotion, and public accuracy claims. */
export const verifyPublishedForecasts = onSchedule({
  schedule: 'every day 06:40', timeZone: 'Etc/UTC', timeoutSeconds: 540,
  memory: '1GiB', maxInstances: 1, concurrency: 1,
}, async () => {
  const db = admin.firestore();
  const now = new Date();
  let completedDays = 0;
  let scoredTargets = 0;
  let uniqueCompleteEvents = 0;
  let truncatedDays = 0;
  let daysWithoutServedPairs = 0;
  try {
    for (const day of recentMaturedVerificationDays(now)) {
      const result = await loadVerificationDay(db, day, now);
      if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 700_000) throw new Error('Verification day exceeds private document size bound');
      const ref = db.doc(verificationDayPath(result.reference, day));
      // Same day and input snapshot writes the same evidence record. A later
      // correction replaces that day's revision rather than duplicating events.
      await ref.set(result);
      completedDays++;
      scoredTargets += result.targetScores.filter(row => row.status === 'scored').length;
      uniqueCompleteEvents += result.eventLedger.filter(event => event.complete).length;
      if (result.coverage.archiveReadTruncated) truncatedDays++;
      if (!result.targetScores.some(row => row.method === 'served' && row.status === 'scored')) daysWithoutServedPairs++;
    }
    await recordJobOutcome(db, 'verifyPublishedForecasts', 'carolina-beach', {
      attemptedAt: now.toISOString(), status: truncatedDays || daysWithoutServedPairs ? 'partial' : 'ok',
      version: VERIFICATION_VERSION, completedDays, scoredTargets, uniqueCompleteEvents, truncatedDays, daysWithoutServedPairs,
    });
  } catch (error) {
    await recordJobOutcome(db, 'verifyPublishedForecasts', 'carolina-beach', {
      attemptedAt: now.toISOString(), status: 'failed', version: VERIFICATION_VERSION,
      completedDays, scoredTargets, error: safeError(error),
    });
    throw error;
  }
});

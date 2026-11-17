import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { recordJobOutcome, safeError } from '../utils/observability';
import { loadVerificationDay, recentMaturedVerificationDays, verificationDayPath, VERIFICATION_REFERENCE } from './repository';
import { VERIFICATION_VERSION, type VerificationDay } from './types';
import { updateRollingVerificationSummary } from './summary';
import { updateModelDiagnostics } from './diagnostics';

if (!admin.apps.length) admin.initializeApp();

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const AUTO_HEAL_LOOKBACK_DAYS = 16;

/** Collects the standard 2 recently matured days plus any matured days in the past 16 days
 * that still have 0 scored 'served' pairs (auto-healing historical gaps after pipeline upgrades). */
export async function collectVerificationDaysToRun(
  db: FirebaseFirestore.Firestore,
  now = new Date()
): Promise<string[]> {
  const recent = recentMaturedVerificationDays(now);
  const daysSet = new Set(recent);
  const latestMs = Math.floor((+now - (24 + 72 + 6) * HOUR) / DAY) * DAY;
  const olderCandidates: string[] = [];
  for (let offset = 2; offset < AUTO_HEAL_LOOKBACK_DAYS; offset++) {
    const day = new Date(latestMs - offset * DAY).toISOString().slice(0, 10);
    if (!daysSet.has(day)) olderCandidates.push(day);
  }
  if (olderCandidates.length) {
    const snapshots = await db.getAll(
      ...olderCandidates.map(day => db.doc(verificationDayPath(VERIFICATION_REFERENCE, day)))
    );
    snapshots.forEach((snap, idx) => {
      const data = snap.exists ? (snap.data() as Partial<VerificationDay>) : undefined;
      const hasServedScores = Array.isArray(data?.targetScores) &&
        data.targetScores.some(row => row.method === 'served' && row.status === 'scored');
      if (!hasServedScores) {
        daysSet.add(olderCandidates[idx]);
      }
    });
  }
  return [...daysSet].sort();
}

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
    const daysToRun = await collectVerificationDaysToRun(db, now);
    for (const day of daysToRun) {
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
    // Update rolling 30-day verification summary and model diagnostics for public accuracy & tuning transparency
    try {
      await updateRollingVerificationSummary(db, 'carolina-beach');
      await updateModelDiagnostics(db, 'carolina-beach');
    } catch {
      // Non-fatal if summary/diagnostic compilation encounters an issue
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

/** Non-destructive monthly -> daily copy. Defaults to dry-run; uses server ADC.
 * npm run migrate:observations -- --project EXISTING_PROJECT --location carolina-beach --from 2026-05 --to 2026-10
 * Add --apply only after reviewing the dry-run. Never deletes legacy documents.
 */
import * as admin from 'firebase-admin';
import { isDeepStrictEqual } from 'node:util';
import { emptyObservationMaps, observationPatch, partitionObservationBuckets, type ObservationSources } from '../utils/observationBuckets';

type MigrationOptions = { locationId: string; from: string; to: string; apply?: boolean; now?: Date };
function monthIds(from: string, to: string): string[] {
  if (![from, to].every(value => /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) || from > to) throw new Error('Valid ascending --from/--to YYYY-MM months required');
  const months: string[] = [];
  const iter = new Date(`${from}-01T00:00:00Z`);
  while (iter.toISOString().slice(0, 7) <= to) {
    if (months.length >= 120) throw new Error('Migrate at most 120 months per invocation');
    months.push(iter.toISOString().slice(0, 7));
    iter.setUTCMonth(iter.getUTCMonth() + 1);
  }
  return months;
}
function missingLeaves(existing: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (!(key in existing)) patch[key] = value;
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      const previous = existing[key];
      if (!previous || typeof previous !== 'object' || Array.isArray(previous)) continue;
      const children = missingLeaves(previous as Record<string, unknown>, value as Record<string, unknown>);
      if (Object.keys(children).length) patch[key] = children;
    }
  }
  return patch;
}
function verifyLeaves(expected: Record<string, unknown>, actual: Record<string, unknown>) {
  for (const [key, value] of Object.entries(expected)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const found = actual[key];
      if (!found || typeof found !== 'object') throw new Error('Migration verification failed: missing map');
      verifyLeaves(value as Record<string, unknown>, found as Record<string, unknown>);
    } else if (!isDeepStrictEqual(value, actual[key])) throw new Error('Migration verification failed: leaf mismatch');
  }
}
function migrationInput(previous: Record<string, unknown>, incoming: Record<string, unknown>, day: string, now: Date) {
  const preserved = partitionObservationBuckets(previous, { now });
  const archived = preserved.buckets[day]?.persistedImagery || {};
  return { ...incoming, ...(Object.keys(archived).length ? { persistedImagery: archived } : {}) };
}

export async function migrateObservationBuckets(db: admin.firestore.Firestore, options: MigrationOptions) {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(options.locationId)) throw new Error('Valid location ID required');
  const now = options.now || new Date();
  const summary = { mode: options.apply ? 'apply' : 'dry-run', monthsRead: 0, daysExamined: 0, daysToCopy: 0, daysWritten: 0, rejectedRecords: 0, verifiedDays: 0 };
  for (const month of monthIds(options.from, options.to)) {
    const source = await db.doc(`locations/${options.locationId}/observations/${month}`).get();
    if (!source.exists) continue;
    summary.monthsRead++;
    const raw = source.data() || {};
    const recordedAt = typeof raw.lastUpdated === 'string' ? new Date(raw.lastUpdated) : null;
    // Unknown provenance is not upgraded to observed weather. Raw monthly
    // weather stays preserved in its original document for later investigation.
    const weatherObservedThrough = recordedAt && Number.isFinite(+recordedAt) ? recordedAt : new Date(0);
    const { buckets, rejectedRecords } = partitionObservationBuckets(raw, { now, weatherObservedThrough });
    summary.rejectedRecords += rejectedRecords;
    for (const [day, bucket] of Object.entries(buckets).sort()) {
      if (!day.startsWith(month)) continue;
      summary.daysExamined++;
      const destination = db.doc(`locations/${options.locationId}/observations/${day}`);
      const incoming = Object.fromEntries(Object.entries(bucket).filter(([, value]) => Object.keys(value).length));
      if (!options.apply) {
        const previous: Record<string, unknown> = (await destination.get()).data() || { ...emptyObservationMaps() };
        if (Object.keys(missingLeaves(previous, migrationInput(previous, incoming, day, now))).length) summary.daysToCopy++;
        continue;
      }
      // A short per-day transaction is necessary here only to copy missing
      // leaves while scheduled writes continue. Newer daily values always win.
      const expected = await db.runTransaction(async transaction => {
        const previous = (await transaction.get(destination)).data() || {};
        // Upgrade previously archived daily URLs before new camera refreshes;
        // raw URLs can never overwrite this separate archived overlay.
        const missing = missingLeaves(previous, migrationInput(previous, incoming, day, now));
        if (!Object.keys(missing).length) return null;
        transaction.set(destination, observationPatch(missing as ObservationSources, now.toISOString()), { merge: true });
        return missing;
      });
      if (expected) { summary.daysWritten++; summary.daysToCopy++; }
      // Verify the exact copied leaves. Preserve conflicting/newer daily leaves
      // and all metadata rather than treating them as migration discrepancies.
      const copied = (await destination.get()).data() || {};
      if (expected) verifyLeaves(expected, copied);
      summary.verifiedDays++;
    }
    if (options.apply) {
      const sourceAgain = await source.ref.get();
      if (!sourceAgain.exists) throw new Error('Legacy source vanished during migration');
      // Verify once per month, rather than downloading the same large archive
      // after each day. No migration write ever targets this original source.
      verifyLeaves(raw, sourceAgain.data() || {});
    }
  }
  return summary;
}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag: string) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
  const projectId = value('--project');
  const locationId = value('--location');
  const from = value('--from');
  const to = value('--to');
  if (!projectId || !locationId || !from || !to) throw new Error('Provide --project EXISTING_PROJECT --location LOCATION --from YYYY-MM --to YYYY-MM; default is dry-run');
  const known = new Set(['--project', '--location', '--from', '--to', '--apply']);
  for (let index = 0; index < args.length; index++) {
    if (!known.has(args[index])) throw new Error('Unknown migration option');
    if (args[index] !== '--apply') index++;
  }
  admin.initializeApp({ projectId });
  console.log(JSON.stringify({ projectId, locationId, from, to, ...await migrateObservationBuckets(admin.firestore(), { locationId, from, to, apply: args.includes('--apply') }) }, null, 2));
}
if (require.main === module) main().catch(error => { console.error(error instanceof Error ? error.message : 'Migration failed'); process.exitCode = 1; });

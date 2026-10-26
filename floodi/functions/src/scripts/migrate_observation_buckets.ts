/** Non-destructive monthly -> daily copy. Defaults to dry-run; uses server ADC.
 * npm run migrate:observations -- --project EXISTING_PROJECT --location carolina-beach --from 2026-05 --to 2026-10
 * Add --apply only after reviewing the dry-run. Never deletes legacy documents.
 */
import * as admin from 'firebase-admin';
import { isDeepStrictEqual } from 'node:util';
import { emptyObservationMaps, observationPatch, partitionObservationBuckets, type ObservationSources } from '../utils/observationBuckets';

type MigrationOptions = { locationId: string; from: string; to: string; apply?: boolean; coverageOnly?: boolean; now?: Date };
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

function calendarDays(month: string): string[] {
  const cursor = new Date(`${month}-01T00:00:00Z`);
  const days: string[] = [];
  while (cursor.toISOString().startsWith(month)) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/** Coverage is relative to the frozen legacy archive, not a claim of continuous
 * sensor uptime. Valid daily corrections may supersede old values. */
function normalizedCoverage(raw: Record<string, unknown>, day: string, now: Date) {
  const bucket = partitionObservationBuckets(raw, { now }).buckets[day] || emptyObservationMaps();
  for (const [t, cameras] of Object.entries(bucket.persistedImagery)) bucket.imagery[t] = { ...bucket.imagery[t], ...cameras };
  // A newer raw URL can satisfy an old raw URL, but cannot replace a saved
  // storage image that the legacy overlay would otherwise keep accessible.
  return { ...bucket };
}

async function verifyDailyCoverage(db: admin.firestore.Firestore, source: admin.firestore.DocumentSnapshot, month: string, buckets: Record<string, ReturnType<typeof emptyObservationMaps>>, locationId: string, now: Date, apply: boolean) {
  const sourceStamp = source.updateTime;
  if (!sourceStamp) throw new Error('Legacy snapshot updateTime is required to verify coverage');
  const sourceVersion = sourceStamp.toDate().toISOString();
  const exactSourceVersion = `${sourceStamp.seconds}:${sourceStamp.nanoseconds}`;
  const days = calendarDays(month);
  return db.runTransaction(async transaction => {
    const currentSource = await transaction.get(source.ref);
    if (!currentSource.exists || !currentSource.updateTime || !sourceStamp.isEqual(currentSource.updateTime)) throw new Error('Legacy archive changed during coverage verification; retry against its new snapshot');
    const destinations = days.map(day => db.doc(`locations/${locationId}/observations/${day}`));
    const currentDays = await Promise.all(destinations.map(destination => transaction.get(destination)));
    for (let i = 0; i < days.length; i++) {
      const incoming = normalizedCoverage({ ...(buckets[days[i]] || {}) }, days[i], now);
      const current = normalizedCoverage(currentDays[i].data() || {}, days[i], now);
      if (Object.keys(missingLeaves(current, incoming)).length) throw new Error(`Daily archive is incomplete for ${days[i]}; run the normal copy migration first`);
    }
    let changed = 0;
    for (let i = 0; i < days.length; i++) {
      // A frozen archive may not be amended without invalidating/re-verifying
      // these markers. All supported ingestion jobs write daily leaves only.
      const marker = { version: 1, sourceMonth: month, sourceUpdateTime: sourceVersion, sourceVersion: exactSourceVersion, archiveFrozen: true };
      const previous = currentDays[i].data()?.legacyCoverage;
      if (previous && isDeepStrictEqual({ version: previous.version, sourceMonth: previous.sourceMonth, sourceUpdateTime: previous.sourceUpdateTime, sourceVersion: previous.sourceVersion, archiveFrozen: previous.archiveFrozen }, marker)) continue;
      changed++;
      if (apply) transaction.set(destinations[i], { legacyCoverage: { ...marker, verifiedAt: now.toISOString() } }, { merge: true });
    }
    return changed;
  });
}

export async function migrateObservationBuckets(db: admin.firestore.Firestore, options: MigrationOptions) {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(options.locationId)) throw new Error('Valid location ID required');
  const now = options.now || new Date();
  const summary = { mode: options.apply ? 'apply' : 'dry-run', monthsRead: 0, daysExamined: 0, daysToCopy: 0, daysWritten: 0, rejectedRecords: 0, verifiedDays: 0, coverageMarkersReady: 0, coverageMarkersWritten: 0 };
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
    if (options.coverageOnly) {
      // Future gauge/image rows cannot be certified as archived observations.
      // Forecast-contaminated weather remains quarantined by its original cutoff.
      const allTimes = partitionObservationBuckets(raw, { now: new Date('9999-01-01T00:00:00Z'), weatherObservedThrough }).buckets;
      if (Object.keys(allTimes).some(day => +new Date(`${day}T00:00:00Z`) > +now) || Object.keys(missingLeaves(buckets as unknown as Record<string, unknown>, allTimes as unknown as Record<string, unknown>)).length) throw new Error('Legacy archive includes future observation rows; resolve provenance before certifying coverage');
      const count = await verifyDailyCoverage(db, source, month, buckets, options.locationId, now, !!options.apply);
      summary.coverageMarkersReady += count;
      if (options.apply) summary.coverageMarkersWritten += count;
      continue;
    }
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
  const known = new Set(['--project', '--location', '--from', '--to', '--apply', '--coverage-only']);
  for (let index = 0; index < args.length; index++) {
    if (!known.has(args[index])) throw new Error('Unknown migration option');
    if (args[index] !== '--apply' && args[index] !== '--coverage-only') index++;
  }
  admin.initializeApp({ projectId });
  console.log(JSON.stringify({ projectId, locationId, from, to, ...await migrateObservationBuckets(admin.firestore(), { locationId, from, to, apply: args.includes('--apply'), coverageOnly: args.includes('--coverage-only') }) }, null, 2));
}
if (require.main === module) main().catch(error => { console.error(error instanceof Error ? error.message : 'Migration failed'); process.exitCode = 1; });

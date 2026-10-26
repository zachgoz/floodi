const { test } = require('node:test');
const assert = require('node:assert/strict');
const { partitionObservationBuckets, writeObservationBuckets, readObservationRange, utcDaysInRange, MAX_OBSERVATION_PATCH_BYTES, ObservationBucketWriteError } = require('../lib/utils/observationBuckets');
const { migrateObservationBuckets } = require('../lib/scripts/migrate_observation_buckets');

const now = new Date('2026-10-14T12:00:00Z');
const t = '2026-10-14T11:00:00.000Z';
const beforeMidnight = '2026-10-13T23:58:00.000Z';
function merge(existing, incoming) {
  const out = { ...existing };
  for (const [key, value] of Object.entries(incoming)) out[key] = value && typeof value === 'object' && !Array.isArray(value)
    ? merge(existing?.[key] || {}, value) : value;
  return out;
}
function database(initial = {}) {
  const rows = new Map(Object.entries(structuredClone(initial)));
  const writes = [];
  const reads = [];
  const db = {
    doc: path => {
      const ref = {
        path,
        get: async () => { reads.push(path); return { ref, exists: rows.has(path), updateTime: { seconds: 1791977400, nanoseconds: 123, toDate: () => new Date('2026-10-14T11:30:00Z'), isEqual: other => other.seconds === 1791977400 && other.nanoseconds === 123 }, data: () => structuredClone(rows.get(path)) }; },
        set: async (data, options) => { writes.push({ path, data, options }); rows.set(path, options?.merge ? merge(rows.get(path) || {}, data) : data); },
      };
      return ref;
    },
    runTransaction: async fn => {
      const staged = [];
      const result = await fn({ get: ref => ref.get(), set: (ref, data, options) => staged.push([ref, data, options]) });
      for (const [ref, data, options] of staged) await ref.set(data, options);
      return result;
    },
  };
  return { db, rows, writes, reads };
}
const root = 'locations/carolina-beach/observations/';

test('daily partitions normalize explicit timezone timestamps across UTC midnight without losing zero', async () => {
  const { db, writes, reads } = database();
  const result = await writeObservationBuckets(db, 'carolina-beach', {
    noaa: { '2026-10-13T19:58:00-04:00': 0, [t]: 4.2 },
    weather: { [t]: { windSpeed: 0, precip: undefined, pressure: NaN }, '2026-10-15T00:00:00Z': { precip: 1 } },
    imagery: { [t]: { Camera: 'storage://saved.jpg' } },
  }, { now });
  assert.deepEqual(writes.map(write => write.path), [root + '2026-10-13', root + '2026-10-14']);
  assert.equal(writes[0].data.noaa[beforeMidnight], 0);
  assert.deepEqual(writes[1].data.weather[t], { windSpeed: 0 });
  assert.deepEqual(writes[1].data.persistedImagery[t], { Camera: 'storage://saved.jpg' });
  assert.equal(result.recordsWritten, 4);
  assert.equal(result.rejectedRecords, 1);
  assert.equal(reads.length, 0);
  assert.ok(writes.every(write => write.options.merge));
});

test('invalid, naive and future observations never refresh an otherwise empty day', async () => {
  const { db, writes } = database();
  const result = await writeObservationBuckets(db, 'carolina-beach', {
    fiman: { '2026-10-14T11:00:00': 9, nonsense: 9, '2026-10-15T00:00:00Z': 9, [t]: NaN },
    weather: { [t]: { precip: undefined } },
  }, { now });
  assert.equal(result.daysWritten, 0);
  assert.equal(result.rejectedRecords, 5);
  assert.deepEqual(writes, []);
});

test('daily partial updates preserve existing readings, image metadata and weather fields', async () => {
  const path = root + '2026-10-14';
  const { db, rows } = database({ [path]: { noaa: { [t]: 3.5 }, weather: { [t]: { precip: .2, windDirection: 90 } }, imagery: { [t]: { Camera: 'storage://saved.jpg' } }, calibration: 'existing' } });
  await writeObservationBuckets(db, 'carolina-beach', { fiman: { [t]: 4.5 }, weather: { [t]: { windSpeed: 0, precip: undefined } } }, { now });
  assert.deepEqual(rows.get(path), { noaa: { [t]: 3.5 }, fiman: { [t]: 4.5 }, weather: { [t]: { precip: .2, windDirection: 90, windSpeed: 0 } }, imagery: { [t]: { Camera: 'storage://saved.jpg' } }, calibration: 'existing', lastUpdated: now.toISOString() });
});

test('oversized source payload rejects before writing and reports partial progress honestly', async () => {
  const { db, writes } = database();
  await assert.rejects(writeObservationBuckets(db, 'carolina-beach', {
    noaa: { [beforeMidnight]: 3 }, weather: { [t]: { description: 'x'.repeat(MAX_OBSERVATION_PATCH_BYTES) } },
  }, { now }), error => error instanceof ObservationBucketWriteError && error.progress.daysWritten === 1 && error.progress.recordsWritten === 1);
  assert.equal(writes.length, 1);
});

test('range reads merge legacy first, daily corrections second, and quarantine legacy future weather', async () => {
  const legacyCutoff = '2026-10-14T10:00:00Z';
  const old = '2026-10-14T09:00:00.000Z';
  const { db, reads } = database({
    [root + '2026-10']: { noaa: { [t]: 3 }, fiman: { [t]: 4 }, weather: { [old]: { precip: .2, windSpeed: 3 }, [t]: { windSpeed: 99 } }, imagery: { Camera: { [t]: 'old.jpg' } }, lastUpdated: legacyCutoff },
    [root + '2026-10-14']: { noaa: { [t]: 3.5 }, weather: { [old]: { windSpeed: 0 } }, imagery: { [t]: { Camera2: 'new.jpg' } }, lastUpdated: now.toISOString() },
  });
  const result = await readObservationRange(db, 'carolina-beach', new Date('2026-10-14T00:00:00Z'), now, { now });
  assert.equal(result.noaa[t], 3.5);
  assert.equal(result.fiman[t], 4);
  assert.deepEqual(result.weather, { [old]: { precip: .2, windSpeed: 0 } });
  assert.deepEqual(result.imagery[t], { Camera: 'old.jpg', Camera2: 'new.jpg' });
  assert.deepEqual(reads, [root + '2026-10', root + '2026-10-14']);
});

test('UTC date iteration includes both days around midnight and handles DST without duplicate/missing days', () => {
  assert.deepEqual(utcDaysInRange(new Date('2026-11-01T23:59:59Z'), new Date('2026-11-02T00:00:00Z')), ['2026-11-01', '2026-11-02']);
  assert.deepEqual(utcDaysInRange(new Date('2026-10-31T23:59:00Z'), new Date('2026-11-02T01:00:00Z')), ['2026-10-31', '2026-11-01', '2026-11-02']);
  assert.deepEqual(utcDaysInRange(now, new Date(0)), []);
});

test('migration dry-run never writes; apply preserves newer daily leaves and metadata and is idempotent', async () => {
  const original = { noaa: { [t]: 3 }, fiman: { [t]: 4 }, weather: { [t]: { precip: 0 } }, imagery: { [t]: { Camera: 'old.jpg' } }, lastUpdated: now.toISOString(), archiveMetadata: 'keep' };
  const { db, rows, writes } = database({ [root + '2026-10']: original, [root + '2026-10-14']: { fiman: { [t]: 4.5 }, calibration: 'new', imagery: { [t]: { Camera: 'storage://saved.jpg' } } } });
  const options = { locationId: 'carolina-beach', from: '2026-10', to: '2026-10', now };
  const dry = await migrateObservationBuckets(db, options);
  assert.equal(dry.mode, 'dry-run');
  assert.equal(dry.daysToCopy, 1);
  assert.equal(writes.length, 0);
  const applied = await migrateObservationBuckets(db, { ...options, apply: true });
  assert.equal(applied.daysWritten, 1);
  assert.equal(applied.verifiedDays, 1);
  assert.deepEqual(rows.get(root + '2026-10'), original);
  assert.equal(rows.get(root + '2026-10-14').fiman[t], 4.5);
  assert.equal(rows.get(root + '2026-10-14').noaa[t], 3);
  assert.equal(rows.get(root + '2026-10-14').imagery[t].Camera, 'storage://saved.jpg');
  assert.equal(rows.get(root + '2026-10-14').calibration, 'new');
  const again = await migrateObservationBuckets(db, { ...options, apply: true });
  assert.equal(again.daysWritten, 0);
  assert.equal(writes.length, 1);
});

test('migration leaves forecast-contaminated weather in the untouched legacy source', async () => {
  const futureInArchive = '2026-10-13T12:00:00.000Z'; // Past today but future when this archive was written.
  const original = { noaa: { [t]: 3 }, weather: { [futureInArchive]: { precip: 99 } }, lastUpdated: '2026-10-12T00:00:00Z' };
  const { db, rows } = database({ [root + '2026-10']: original });
  const result = await migrateObservationBuckets(db, { locationId: 'carolina-beach', from: '2026-10', to: '2026-10', apply: true, now });
  assert.equal(result.rejectedRecords, 1);
  assert.equal(rows.has(root + '2026-10-13'), false);
  assert.equal(rows.get(root + '2026-10-14').weather, undefined);
  assert.deepEqual(rows.get(root + '2026-10'), original);
});

test('partitioning supports both imagery layouts and rejects malformed URLs without losing valid cameras', () => {
  const { buckets } = partitionObservationBuckets({ imagery: { [t]: { Camera: 'new.jpg', broken: undefined }, LegacyCamera: { [beforeMidnight]: 'old.jpg' } } }, { now });
  assert.deepEqual(buckets['2026-10-14'].imagery[t], { Camera: 'new.jpg' });
  assert.deepEqual(buckets['2026-10-13'].imagery[beforeMidnight], { LegacyCamera: 'old.jpg' });
});

test('raw URL refresh cannot downgrade separately archived image references', async () => {
  const path = root + '2026-10-14';
  const { db, rows } = database();
  await writeObservationBuckets(db, 'carolina-beach', { imagery: { [t]: { Camera: 'storage://saved.jpg' } } }, { now });
  await writeObservationBuckets(db, 'carolina-beach', { imagery: { [t]: { Camera: 'https://camera/latest.jpg' } } }, { now });
  assert.equal(rows.get(path).persistedImagery[t].Camera, 'storage://saved.jpg');
  const result = await readObservationRange(db, 'carolina-beach', new Date('2026-10-14T00:00:00Z'), now, { now });
  assert.equal(result.imagery[t].Camera, 'storage://saved.jpg');
});

test('coverage certification verifies all archived sources and writes metadata only, including empty archival days', async () => {
  const legacy = { noaa: { [t]: 3 }, fiman: { [t]: 4 }, weather: { [t]: { precip: 0, windSpeed: 5 } }, imagery: { Camera: { [t]: 'old.jpg' } }, lastUpdated: now.toISOString() };
  const daily = { noaa: { [t]: 3.1 }, fiman: { [t]: 4.5 }, weather: { [t]: { precip: 0, windSpeed: 6 } }, persistedImagery: { [t]: { Camera: 'storage://saved.jpg' } } };
  const { db, rows, writes } = database({ [root + '2026-10']: legacy, [root + '2026-10-14']: daily });
  const options = { locationId: 'carolina-beach', from: '2026-10', to: '2026-10', now, coverageOnly: true };
  const dry = await migrateObservationBuckets(db, options);
  assert.equal(dry.coverageMarkersReady, 31);
  assert.equal(dry.coverageMarkersWritten, 0);
  assert.equal(writes.length, 0);
  const applied = await migrateObservationBuckets(db, { ...options, apply: true });
  assert.equal(applied.coverageMarkersWritten, 31);
  assert.equal(applied.daysWritten, 0);
  assert.deepEqual(rows.get(root + '2026-10'), legacy);
  const stored = rows.get(root + '2026-10-14');
  assert.deepEqual(Object.fromEntries(Object.entries(stored).filter(([key]) => key !== 'legacyCoverage')), daily);
  assert.equal(stored.legacyCoverage.archiveFrozen, true);
  assert.ok(writes.every(({ data, path }) => path !== root + '2026-10' && Object.keys(data).length === 1 && data.legacyCoverage));
  assert.equal((await migrateObservationBuckets(db, { ...options, apply: true })).coverageMarkersWritten, 0);
  await writeObservationBuckets(db, 'carolina-beach', { fiman: { [t]: 4.6 } }, { now });
  assert.deepEqual(rows.get(root + '2026-10-14').legacyCoverage, stored.legacyCoverage);
});

test('coverage certification fails closed for a partial source, invalid reading, camera or weather field', async () => {
  const legacy = { noaa: { [t]: 3 }, fiman: { [t]: 4 }, weather: { [t]: { precip: 0, windSpeed: 5 } }, imagery: { [t]: { Camera: 'old.jpg' } }, lastUpdated: now.toISOString() };
  for (const partial of [
    { ...legacy, noaa: {} }, { ...legacy, fiman: { [t]: NaN } },
    { ...legacy, weather: { [t]: { windSpeed: 5 } } }, { ...legacy, imagery: {} },
  ]) {
    const { db, writes } = database({ [root + '2026-10']: legacy, [root + '2026-10-14']: partial });
    await assert.rejects(migrateObservationBuckets(db, { locationId: 'carolina-beach', from: '2026-10', to: '2026-10', now, apply: true, coverageOnly: true }), /incomplete/);
    assert.equal(writes.length, 0);
  }
  const archivedLegacy = { imagery: { [t]: { Camera: 'storage://saved.jpg' } }, lastUpdated: now.toISOString() };
  const rawOnly = database({ [root + '2026-10']: archivedLegacy, [root + '2026-10-14']: { imagery: { [t]: { Camera: 'https://camera/current.jpg' } } } });
  await assert.rejects(migrateObservationBuckets(rawOnly.db, { locationId: 'carolina-beach', from: '2026-10', to: '2026-10', now, apply: true, coverageOnly: true }), /incomplete/);
  assert.equal(rawOnly.writes.length, 0);
});

test('coverage certification rejects changed monthly snapshots, including submillisecond writes, and future observation provenance', async () => {
  for (const changedStamp of [{ seconds: 1791977401, nanoseconds: 123 }, { seconds: 1791977400, nanoseconds: 124 }]) {
    const { db, writes } = database({ [root + '2026-10']: {} });
    const transaction = db.runTransaction;
    db.runTransaction = callback => transaction(tx => callback({ ...tx, get: async ref => { const snapshot = await tx.get(ref); if (ref.path === root + '2026-10') snapshot.updateTime = { ...changedStamp, toDate: () => new Date('2026-10-14T11:30:00Z') }; return snapshot; } }));
    await assert.rejects(migrateObservationBuckets(db, { locationId: 'carolina-beach', from: '2026-10', to: '2026-10', now, apply: true, coverageOnly: true }), /changed/);
    assert.equal(writes.length, 0);
  }
  const future = database({ [root + '2026-10']: { fiman: { '2026-10-14T13:00:00Z': 9 }, lastUpdated: now.toISOString() } });
  await assert.rejects(migrateObservationBuckets(future.db, { locationId: 'carolina-beach', from: '2026-10', to: '2026-10', now, apply: true, coverageOnly: true }), /future observation/);
  assert.equal(future.writes.length, 0);
});

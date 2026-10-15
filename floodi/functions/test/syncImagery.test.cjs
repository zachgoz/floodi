const { test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const records = new Map();
const writes = [];
const reads = [];
const batches = [];
const logs = [];
const batchResults = new Map();
let locations;
let readFailure;
let writeFailure;
const now = new Date('2026-10-15T12:00:00.000Z');
const time = '2026-10-15T11:06:00.000Z';
const dailyPath = location => `locations/${location}/observations/2026-10-15`;
const healthPath = location => `operationalHealth/syncImagery_${location}`;
const configuredLocation = id => ({ id, thresholds: { minor: 5.6 } });

function merge(previous, patch) {
  const next = { ...(previous || {}) };
  for (const [key, value] of Object.entries(patch)) {
    next[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? Object.keys(value).length ? merge(next[key], value) : {}
      : value;
  }
  return next;
}

// Deliberately has no collection method and no locations/{id} parent document.
// Actual daily readers and writers must work directly with document IDs.
const db = {
  doc: path => ({
    path,
    get: async () => {
      reads.push(path);
      if (readFailure && path.includes('/observations/')) throw readFailure;
      return { exists: records.has(path), data: () => records.get(path) };
    },
    set: async (value, options) => {
      if (writeFailure && path.includes('/observations/')) throw writeFailure;
      writes.push({ path, value, options });
      records.set(path, options?.merge ? merge(records.get(path), value) : value);
    },
  }),
};

const entryPath = require.resolve('../lib/syncImagery');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'firebase-functions/logger') {
    return Object.fromEntries(['info', 'warn', 'error'].map(level => [level, (message, details) => logs.push({ level, message, details })]));
  }
  if (parent?.filename === entryPath) {
    if (request === 'firebase-admin') return { apps: [{}], firestore: () => db };
    if (request === 'firebase-functions/v2/scheduler') return { onSchedule: (_options, handler) => handler };
    if (request === './locations') return Object.defineProperty({}, 'LOCATIONS', { get: () => locations });
    if (request === './utils/storage') return {
      persistImageryBatch: async (...args) => {
        batches.push(args);
        const result = batchResults.get(args[0]);
        if (result instanceof Error) throw result;
        return result ?? { patch: {}, attempted: 0, succeeded: 0, failed: 0, deferred: false };
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
let run;
try { run = require(entryPath).syncImagery; }
finally { Module._load = originalLoad; }

function seed(location = 'carolina-beach', extra = {}) {
  records.set(dailyPath(location), {
    fiman: { [time]: 6.1 },
    imagery: { [time]: { CAM: 'https://images.example/current.jpg' } },
    weather: { [time]: { windSpeed: 12, precip: 0 } },
    lastUpdated: '2026-10-15T11:10:00.000Z',
    ...extra,
  });
}
function successResult() {
  return { patch: { [time]: { CAM: 'storage://imagery/carolina-beach/CAM/photo.jpg' } }, attempted: 1, succeeded: 1, failed: 0, deferred: false };
}
beforeEach(() => {
  mock.timers.enable({ apis: ['Date'], now: +now });
  records.clear(); writes.length = reads.length = batches.length = logs.length = 0;
  batchResults.clear(); readFailure = writeFailure = undefined;
  locations = [configuredLocation('carolina-beach')];
  seed();
});
afterEach(() => { mock.restoreAll(); mock.timers.reset(); });

test('archives daily images without a parent location document and preserves unrelated data and durable cameras', async () => {
  seed('carolina-beach', { persistedImagery: { [time]: { KEEP: 'storage://imagery/existing.jpg' } }, review: { verified: true } });
  batchResults.set('carolina-beach', successResult());
  await run();
  assert.equal(records.has('locations/carolina-beach'), false);
  const bucket = records.get(dailyPath('carolina-beach'));
  assert.equal(bucket.persistedImagery[time].CAM, 'storage://imagery/carolina-beach/CAM/photo.jpg');
  assert.equal(bucket.persistedImagery[time].KEEP, 'storage://imagery/existing.jpg');
  assert.deepEqual(bucket.review, { verified: true });
  assert.equal(bucket.fiman[time], 6.1);
  assert.equal(bucket.weather[time].windSpeed, 12);
  assert.equal(bucket.imagery[time].CAM, 'https://images.example/current.jpg');
  const patch = writes.find(write => write.path === dailyPath('carolina-beach'));
  assert.deepEqual(patch.options, { merge: true });
  assert.equal(Object.hasOwn(patch.value, 'fiman'), false);
  assert.equal(Object.hasOwn(patch.value, 'weather'), false);
  assert.equal(records.get(healthPath('carolina-beach')).status, 'ok');
  const [location, imagery, levels, threshold, options] = batches[0];
  assert.equal(location, 'carolina-beach');
  assert.equal(imagery[time].KEEP, 'storage://imagery/existing.jpg');
  assert.equal(levels[time], 6.1);
  assert.equal(threshold, 5.6);
  assert.deepEqual(options, { maxImages: 24, budgetMs: 90000 });
  assert.ok(reads.includes('locations/carolina-beach/observations/2026-10-13'));
  assert.ok(reads.includes('locations/carolina-beach/observations/2026-10-14'));
  assert.ok(reads.includes(dailyPath('carolina-beach')));
  const outcome = records.get(healthPath('carolina-beach'));
  assert.equal(outcome.waterLevelSamples, 1);
  assert.equal(outcome.imageReferences, 2);
});

test('already archived references produce an honest no-work outcome without rewriting observations', async () => {
  seed('carolina-beach', { imagery: {}, persistedImagery: { [time]: { CAM: 'storage://imagery/already.jpg' } } });
  const previous = structuredClone(records.get(dailyPath('carolina-beach')));
  await run();
  assert.equal(batches[0][1][time].CAM, 'storage://imagery/already.jpg');
  assert.deepEqual(records.get(dailyPath('carolina-beach')), previous);
  assert.equal(writes.filter(write => write.path.includes('/observations/')).length, 0);
  assert.deepEqual(records.get(healthPath('carolina-beach')).imagery, { attempted: 0, succeeded: 0, failed: 0, deferred: false });
  assert.equal(records.get(healthPath('carolina-beach')).status, 'ok');
});

test('partial camera failure retains successful archives, other cameras and a warning outcome', async () => {
  seed('carolina-beach', { imagery: { [time]: { CAM: 'https://images.example/current.jpg', FAILED: 'https://images.example/fail.jpg' } } });
  batchResults.set('carolina-beach', { ...successResult(), attempted: 2, failed: 1 });
  await run();
  assert.ok(records.get(dailyPath('carolina-beach')).persistedImagery[time].CAM);
  assert.equal(records.get(dailyPath('carolina-beach')).imagery[time].FAILED, 'https://images.example/fail.jpg');
  assert.equal(records.get(healthPath('carolina-beach')).status, 'partial');
  assert.ok(logs.some(log => log.level === 'warn' && log.details.event === 'job_outcome'));
});

test('all camera attempts failing reject the schedule and preserve observations and source URLs', async () => {
  const previous = structuredClone(records.get(dailyPath('carolina-beach')));
  batchResults.set('carolina-beach', { patch: {}, attempted: 2, succeeded: 0, failed: 2, deferred: false });
  await assert.rejects(run(), AggregateError);
  assert.deepEqual(records.get(dailyPath('carolina-beach')), previous);
  assert.equal(records.get(healthPath('carolina-beach')).status, 'failed');
});

test('read failures reject the schedule without attempting archival or changing observations', async () => {
  readFailure = new Error('Firestore read unavailable');
  await assert.rejects(run(), AggregateError);
  assert.equal(batches.length, 0);
  assert.equal(records.get(healthPath('carolina-beach')).status, 'failed');
  assert.equal(writes.filter(write => write.path.includes('/observations/')).length, 0);
});

test('a failed archive-reference write is reported as failure while measurements stay intact', async () => {
  const previous = structuredClone(records.get(dailyPath('carolina-beach')));
  batchResults.set('carolina-beach', successResult());
  writeFailure = new Error('Firestore write unavailable');
  await assert.rejects(run(), AggregateError);
  assert.deepEqual(records.get(dailyPath('carolina-beach')), previous);
  assert.equal(records.get(healthPath('carolina-beach')).status, 'failed');
});

test('a malformed configured threshold fails explicitly without downloading images', async () => {
  locations = [{ id: 'carolina-beach', thresholds: { minor: NaN } }];
  await assert.rejects(run(), AggregateError);
  assert.equal(batches.length, 0);
  assert.equal(reads.length, 0);
  assert.equal(records.get(healthPath('carolina-beach')).status, 'failed');
});

test('one configured location failing does not prevent a second location from archiving', async () => {
  locations = [configuredLocation('carolina-beach'), configuredLocation('second-location')];
  seed('second-location');
  batchResults.set('carolina-beach', new Error('First location camera unavailable'));
  batchResults.set('second-location', successResult());
  await assert.rejects(run(), AggregateError);
  assert.deepEqual(batches.map(args => args[0]), ['carolina-beach', 'second-location']);
  assert.equal(records.get(healthPath('carolina-beach')).status, 'failed');
  assert.equal(records.get(healthPath('second-location')).status, 'ok');
  assert.ok(records.get(dailyPath('second-location')).persistedImagery[time].CAM);
});

test('an empty configured-location list fails explicitly instead of silently skipping the camera job', async () => {
  locations = [];
  await assert.rejects(run());
  assert.equal(batches.length, 0);
  assert.ok(logs.some(log => log.level === 'error' && log.details.event === 'job_outcome'));
  assert.equal(records.get(healthPath('configuration')).status, 'failed');
});

test('missing source buckets report zero references and zero samples without claiming images were archived', async () => {
  records.clear();
  await run();
  const outcome = records.get(healthPath('carolina-beach'));
  assert.equal(outcome.status, 'ok');
  assert.equal(outcome.imageReferences, 0);
  assert.equal(outcome.waterLevelSamples, 0);
  assert.deepEqual(outcome.imagery, { attempted: 0, succeeded: 0, failed: 0, deferred: false });
  assert.equal(writes.some(write => write.path.includes('/observations/')), false);
});

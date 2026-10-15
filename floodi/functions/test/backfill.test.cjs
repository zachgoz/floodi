const { test, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

afterEach(() => mock.restoreAll());

function recursiveMerge(existing, incoming) {
  const result = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? Object.keys(value).length ? recursiveMerge(existing?.[key] || {}, value) : {} : value;
  }
  return result;
}

function loadBackfill(sources, initial = {}) {
  mock.method(console, 'log', () => {});
  mock.method(console, 'warn', () => {});
  mock.method(console, 'error', () => {});
  const writes = [];
  const buckets = new Map();
  let reads = 0;
  let deletions = 0;
  let configuration;
  const db = {
    doc: path => ({
      path,
      get: async () => { reads++; throw new Error('Recovery must not read monthly buckets'); },
      delete: async () => { deletions++; throw new Error('Recovery must not delete history'); },
      set: async (data, options) => {
        writes.push({ path, data, options });
        const previous = buckets.get(path) || recursiveMerge({
          fiman: { old: 2 }, noaa: { old: 3 }, imagery: { old: { Camera: 'old.jpg' } },
          weather: { old: { precip: .1, windDirection: 90 } },
        }, typeof initial === 'function' ? initial(path) : initial);
        buckets.set(path, options?.merge ? recursiveMerge(previous, data) : data);
      },
    }),
    collection: () => { deletions++; throw new Error('Recovery must not query history for deletion'); },
    runTransaction: async () => { reads++; throw new Error('Recovery must not use read/rewrite transactions'); },
  };
  const dependencies = {
    'firebase-admin': { apps: [{}], firestore: () => db },
    'firebase-functions/v2/https': { onRequest: (options, callback) => { configuration = options; return callback; } },
    './etl/fiman': { fetchFimanData: sources.fiman },
    './etl/noaa': { fetchNoaaObserved: sources.noaa },
    './etl/weather': { fetchNwsObservations: sources.weather },
    './etl/processor': sources.processor || { detectPeaks: () => [], detectFloodEvents: () => [] },
  };
  const path = require.resolve('../lib/backfill');
  const originalLoad = Module._load;
  delete require.cache[path];
  Module._load = function (request, ...args) {
    if (Object.hasOwn(dependencies, request)) return dependencies[request];
    return originalLoad.call(this, request, ...args);
  };
  let handler;
  try { handler = require(path).runBackfillData; } finally { Module._load = originalLoad; }
  return {
    writes, buckets, reads: () => reads, deletions: () => deletions, configuration: () => configuration,
    run: async (query = {}, method = 'POST') => {
      const result = {};
      await handler({ query, method }, { status: value => { result.status = value; return { send: value => { result.body = value; } }; } });
      return result;
    },
  };
}

const failed = async () => { throw new Error('Temporary source outage'); };
const timestamp = start => new Date(+start + 3600000).toISOString();
const emptyFiman = async () => ({ waterLevels: {}, imagery: {} });

test('backfill writes genuine FiMAN values when NOAA and weather fail, preserving existing source records', async () => {
  const api = loadBackfill({
    fiman: async (_sensor, start) => ({ waterLevels: { [timestamp(start)]: 0 }, imagery: {} }),
    noaa: failed, weather: failed,
  });
  const result = await api.run();
  assert.equal(result.status, 207);
  assert.equal(result.body.outcome, 'partial');
  assert.equal(result.body.partialChunks, result.body.requestedChunks);
  assert.equal(result.body.sourceRecords.fiman, result.body.recordsWritten);
  assert.equal(result.body.sourceRecords.noaa, 0);
  assert.ok(api.writes.every(write => /\/observations\/\d{4}-\d\d-\d\d$/.test(write.path)));
  assert.ok(api.writes.length >= 4);
  for (const write of api.writes) {
    assert.deepEqual(Object.keys(write.data).sort(), ['fiman', 'lastUpdated']);
    assert.ok(Object.values(write.data.fiman).includes(0));
    assert.deepEqual(write.options, { merge: true });
    assert.equal(api.buckets.get(write.path).fiman.old, 2);
    assert.equal(api.buckets.get(write.path).noaa.old, 3);
  }
  assert.equal(api.reads(), 0);
  assert.equal(api.deletions(), 0);
});

test('backfill preserves NOAA and weather when FiMAN fails and does not clear FiMAN peaks', async () => {
  const api = loadBackfill({
    fiman: failed,
    noaa: async (_station, start) => ({ [timestamp(start)]: 3.5 }),
    weather: async (_lat, _lon, start) => ({ [timestamp(start)]: { windSpeed: 0, precip: undefined } }),
  });
  await api.run();
  assert.ok(api.writes.length >= 4);
  assert.equal(api.reads(), 0);
  assert.equal(api.deletions(), 0);
  for (const write of api.writes) {
    assert.deepEqual(Object.keys(write.data).sort(), ['lastUpdated', 'noaa', 'weather']);
    assert.equal(api.buckets.get(write.path).noaa.old, 3);
    const incoming = Object.entries(write.data.weather).filter(([key]) => key !== 'old');
    assert.ok(incoming.length > 0);
    assert.ok(incoming.every(([, value]) => Object.keys(value).length === 1 && value.windSpeed === 0));
    assert.deepEqual(JSON.parse(JSON.stringify(write.data)), write.data);
  }
});

test('weather-only recovery writes available weather while empty water-level sources remain untouched', async () => {
  const api = loadBackfill({
    fiman: emptyFiman, noaa: async () => ({}),
    weather: async (_lat, _lon, start) => ({ [timestamp(start)]: { precip: 0, windDirection: undefined } }),
  });
  await api.run();
  assert.ok(api.writes.length >= 4);
  assert.equal(api.deletions(), 0);
  assert.ok(api.writes.every(write => Object.keys(write.data).sort().join(',') === 'lastUpdated,weather'));
  assert.ok(api.writes.every(write => Object.values(write.data.weather).some(value => value.precip === 0)));
});

test('all unavailable sources produce no bucket writes or false freshness updates', async () => {
  const api = loadBackfill({ fiman: failed, noaa: failed, weather: failed });
  const result = await api.run();
  assert.equal(result.status, 503);
  assert.equal(result.body.failedChunks, result.body.requestedChunks);
  assert.equal(result.body.recordsWritten, 0);
  assert.deepEqual(api.writes, []);
  assert.equal(api.reads(), 0);
  assert.equal(api.deletions(), 0);
});

test('only undefined weather fields produce no empty map write or false freshness update', async () => {
  const time = new Date().toISOString();
  const api = loadBackfill({
    fiman: emptyFiman, noaa: async () => ({}),
    weather: async () => ({ [time]: { precip: undefined, windSpeed: NaN } }),
  }, { weather: { [time]: { precip: .3, windSpeed: 12 } } });
  await api.run({ days: '4' });
  assert.deepEqual(api.writes, []);
  assert.equal(api.reads(), 0);
  assert.equal(api.deletions(), 0);
});

test('empty weather records do not erase stored values when another source updates the same month', async () => {
  const time = new Date().toISOString();
  const api = loadBackfill({
    fiman: async () => ({ waterLevels: { [time]: 4.5 }, imagery: {} }),
    noaa: async () => ({}),
    weather: async () => ({ [time]: { precip: undefined } }),
  }, { weather: { [time]: { precip: .3, windSpeed: 12 } } });
  await api.run({ days: '4' });
  assert.equal(api.writes.length, 1);
  assert.equal(Object.hasOwn(api.writes[0].data, 'weather'), false);
  assert.deepEqual(api.buckets.get(api.writes[0].path).weather[time], { precip: .3, windSpeed: 12 });
});

test('same-ID recovered peaks and events retain saved images and metadata', async () => {
  const time = new Date().toISOString();
  const event = { startTime: time, endTime: time, peakTime: time, peakLevel: 6.1 };
  const api = loadBackfill({
    fiman: async () => ({ waterLevels: { [time]: 6.1 }, imagery: {} }),
    noaa: async () => ({}), weather: async () => ({}),
    processor: { detectPeaks: () => [{ t: time, v: 6.1 }], detectFloodEvents: () => [event] },
  }, path => path.includes('/flood_events/') || path.includes('/peaks/')
    ? { peakImages: { Camera: 'storage://saved-image.jpg' }, calibration: 'existing' } : {});
  await api.run({ days: '4' });
  const derived = api.writes.filter(write => write.path.includes('/flood_events/') || write.path.includes('/peaks/'));
  assert.equal(derived.length, 2);
  for (const write of derived) {
    assert.deepEqual(write.options, { merge: true });
    assert.deepEqual(api.buckets.get(write.path).peakImages, { Camera: 'storage://saved-image.jpg' });
    assert.equal(api.buckets.get(write.path).calibration, 'existing');
    assert.equal(api.buckets.get(write.path).source, 'fiman');
  }
});

test('rejects invalid recovery day ranges before fetching or writing anything', async () => {
  let fetches = 0;
  const fetch = async () => { fetches++; return {}; };
  const api = loadBackfill({ fiman: fetch, noaa: fetch, weather: fetch });
  for (const days of ['0', '61', '-1', '1.5', '4days', '', ['4'], {}]) {
    const result = await api.run({ days });
    assert.equal(result.status, 400);
    assert.match(result.body, /integer from 1 to 60/);
  }
  assert.equal(fetches, 0);
  assert.deepEqual(api.writes, []);
});

test('four-day recovery fetches only that range and atomically preserves partial weather fields and earlier events', async () => {
  const ranges = [];
  const time = new Date().toISOString();
  const peakTime = new Date(Date.parse(time) - 3600000).toISOString();
  const api = loadBackfill({
    fiman: async (_sensor, start, end) => {
      ranges.push({ start, end });
      return { waterLevels: { [time]: 4.2 }, imagery: {} };
    },
    noaa: async () => ({}),
    weather: async () => ({ [time]: { windSpeed: 0, precip: undefined } }),
    processor: { detectPeaks: () => [{ t: peakTime, v: 4.8 }], detectFloodEvents: () => [] },
  }, { weather: { [time]: { precip: .2, windDirection: 45 } } });
  const result = await api.run({ days: '4' });
  assert.equal(result.status, 200);
  assert.equal(ranges.length, 1);
  assert.equal(+ranges[0].end - +ranges[0].start, 4 * 24 * 3600000);
  const bucketWrite = api.writes.find(write => write.path.includes('/observations/'));
  const bucket = api.buckets.get(bucketWrite.path);
  assert.equal(bucket.fiman.old, 2);
  assert.deepEqual(bucket.weather[time], { precip: .2, windDirection: 45, windSpeed: 0 });
  assert.ok(api.writes.some(write => write.path.endsWith(`/peaks/fiman_${peakTime.replace(/[:.-]/g, '')}`)));
  assert.equal(api.reads(), 0);
  assert.equal(api.deletions(), 0);
});

test('a later derived-event failure reports partial recovery without hiding measurements already persisted', async () => {
  const time = new Date().toISOString();
  const api = loadBackfill({
    fiman: async () => ({ waterLevels: { [time]: 4.3 }, imagery: {} }),
    noaa: async () => ({}), weather: async () => ({}),
    processor: { detectPeaks: () => { throw new Error('derived-event failure'); }, detectFloodEvents: () => [] },
  });
  const result = await api.run({ days: '4' });
  assert.equal(result.status, 207);
  assert.equal(result.body.outcome, 'partial');
  assert.equal(result.body.failedChunks, 1);
  assert.equal(result.body.recordsWritten, 1);
  assert.equal(result.body.sourceRecords.fiman, 1);
  assert.equal(api.writes.length, 1);
});

test('backfill is private, bounded to one concurrent instance and rejects non-POST requests before work', async () => {
  let fetches = 0;
  const fetch = async () => { fetches++; return {}; };
  const api = loadBackfill({ fiman: fetch, noaa: fetch, weather: fetch });
  assert.equal(api.configuration().invoker, 'private');
  assert.equal(api.configuration().maxInstances, 1);
  assert.equal(api.configuration().concurrency, 1);
  for (const method of ['GET', 'PUT', 'OPTIONS', 'DELETE']) assert.equal((await api.run({}, method)).status, 405);
  assert.equal(fetches, 0);
  assert.equal(api.writes.length, 0);
});

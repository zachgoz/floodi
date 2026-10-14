const { test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const records = new Map();
const writes = [];
const warnings = [];
const errors = [];
const imageCalls = [];
const sourceCalls = [];
let noaa;
let fiman;
let weather;
let prediction;
let forecastWeather;
let imageFailure;

function assertFirestoreValues(value) {
  assert.notEqual(value, undefined, 'Firestore payload must not contain undefined');
  if (typeof value === 'number') assert.ok(Number.isFinite(value), 'Firestore payload must not contain nonfinite numbers');
  if (value && typeof value === 'object') Object.values(value).forEach(assertFirestoreValues);
}

// Firestore merge:true writes a nested field mask, preserving omitted sample
// timestamps and omitted properties within the same weather record.
function mergeFields(previous, patch) {
  const result = { ...(previous || {}) };
  for (const [key, value] of Object.entries(patch)) {
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? Object.keys(value).length ? mergeFields(result[key], value) : {}
      : value;
  }
  return result;
}

const db = {
  doc: path => ({ path, set: async (value, options) => {
    assertFirestoreValues(value);
    writes.push({ path, value, options });
    records.set(path, options?.merge ? mergeFields(records.get(path), value) : value);
  } }),
};

async function source(name, result, args) {
  sourceCalls.push({ name, args });
  if (result instanceof Error) throw result;
  return result;
}

// Exercise the actual scheduled handlers with isolated upstream sources and a
// Firestore-like atomic merge boundary that rejects the original undefined bug.
const schedulerPath = require.resolve('../lib/syncData');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (parent?.filename === schedulerPath) {
    if (request === 'firebase-admin') return { apps: [{}], firestore: () => db };
    if (request === 'firebase-functions/v2/scheduler') return { onSchedule: (_options, handler) => handler };
    if (request === './etl/noaa') return {
      fetchNoaaObserved: (...args) => source('noaa', noaa, args),
      fetchNoaaPredictions: (...args) => source('prediction', prediction, args),
    };
    if (request === './etl/fiman') return { fetchFimanData: (...args) => source('fiman', fiman, args) };
    if (request === './etl/weather') return {
      fetchNwsObservations: (...args) => source('weather', weather, args),
      fetchNwsForecast: (...args) => source('forecastWeather', forecastWeather, args),
    };
    if (request === './utils/storage') return { persistImage: async (...args) => {
      imageCalls.push(args);
      if (imageFailure) throw imageFailure;
    } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
let handlers;
try { handlers = require(schedulerPath); }
finally { Module._load = originalLoad; }

const now = new Date('2026-10-14T12:00:00Z');
const observedPath = 'locations/carolina-beach/observations/2026-10';
const predictedPath = 'locations/carolina-beach/predictions/2026-10';
const oldTime = '2026-10-12T00:57:05.000Z';
const firstTime = '2026-10-14T11:30:00.000Z';
const peakTime = '2026-10-14T11:36:00.000Z';
const lastTime = '2026-10-14T11:42:00.000Z';
const oldBucket = () => ({
  noaa: { [oldTime]: 4.1 }, fiman: { [oldTime]: 4.5 },
  imagery: { [oldTime]: { OLD: 'https://images.example/old.jpg' } },
  weather: { [oldTime]: { windSpeed: 12, precip: 0 } },
  lastUpdated: '2026-10-12T01:05:00.000Z',
});

beforeEach(() => {
  mock.timers.enable({ apis: ['Date'], now: +now });
  mock.method(console, 'log', () => {});
  mock.method(console, 'warn', (...args) => { warnings.push(args); });
  mock.method(console, 'error', (...args) => { errors.push(args); });
  records.clear(); writes.length = 0; warnings.length = 0; errors.length = 0;
  imageCalls.length = 0; sourceCalls.length = 0; imageFailure = undefined;
  records.set(observedPath, oldBucket());
  records.set(predictedPath, { data: { [oldTime]: 4.2 }, weather: { [oldTime]: { windSpeed: 9 } }, lastUpdated: oldBucket().lastUpdated });
  noaa = { [peakTime]: 4.3 };
  fiman = {
    waterLevels: { [firstTime]: 5.4, [peakTime]: 6.1, [lastTime]: 5.3 },
    imagery: { [peakTime]: { SUNNYD_CB_03: 'https://images.example/current.jpg' } },
  };
  weather = { [peakTime]: { windSpeed: 0, precip: 0, temp: undefined, windDirection: undefined, pressure: Infinity } };
  prediction = { [firstTime]: 4.4, [peakTime]: 5.1, [lastTime]: 4.5 };
  forecastWeather = { [peakTime]: { windSpeed: 15, windDirection: undefined, description: 'Cloudy', icon: undefined } };
});

afterEach(() => { mock.restoreAll(); mock.timers.reset(); });

test('writes real gauge/NOAA/imagery records when optional weather fields contain undefined or nonfinite values', async () => {
  await handlers.syncWaterLevels({});
  assert.equal(errors.length, 0);
  const bucket = records.get(observedPath);
  assert.equal(bucket.fiman[peakTime], 6.1);
  assert.equal(bucket.fiman[oldTime], 4.5);
  assert.equal(bucket.noaa[peakTime], 4.3);
  assert.deepEqual(bucket.weather[peakTime], { windSpeed: 0, precip: 0 });
  assert.equal(bucket.weather[oldTime].windSpeed, 12);
  assert.match(bucket.imagery[peakTime].SUNNYD_CB_03, /^storage:\/\/imagery\/carolina-beach\//);
  assert.equal(imageCalls.length, 1);
  assert.equal(bucket.lastUpdated, now.toISOString());
  assert.equal(sourceCalls.find(call => call.name === 'weather').args[2].toISOString(), '2026-10-13T12:00:00.000Z');
  assert.equal(sourceCalls.find(call => call.name === 'weather').args[3].toISOString(), now.toISOString());
  assert.ok(writes.some(write => write.path.startsWith('locations/carolina-beach/peaks/fiman_')));
  assert.ok(writes.some(write => write.path.startsWith('locations/carolina-beach/flood_events/fiman_')));
  const patch = writes.find(write => write.path === observedPath);
  assert.deepEqual(patch.options, { merge: true });
  assert.equal(Object.hasOwn(patch.value.fiman, oldTime), false);
  assert.equal(Object.hasOwn(patch.value.weather, oldTime), false);
});

test('atomic observed merges retain archived samples and optional fields when weather updates are partial', async () => {
  records.get(observedPath).weather[peakTime] = { windDirection: 45, pressure: 1015, precip: .2 };
  weather = { [peakTime]: { windSpeed: 0, precip: undefined, pressure: undefined } };
  await handlers.syncWaterLevels({});
  assert.deepEqual(records.get(observedPath).weather[peakTime], { windSpeed: 0, windDirection: 45, pressure: 1015, precip: .2 });
  assert.equal(records.get(observedPath).fiman[oldTime], 4.5);
  assert.deepEqual(writes.find(write => write.path === observedPath).value.weather[peakTime], { windSpeed: 0 });
  assert.equal(errors.length, 0);
});

test('the real Firestore SDK creates leaf merge masks without replacing monthly maps or omitted weather properties', async () => {
  weather = { [peakTime]: { windSpeed: 0, precip: undefined } };
  await handlers.syncWaterLevels({});
  const patch = writes.find(write => write.path === observedPath);
  const { Firestore } = require('@google-cloud/firestore');
  const firestore = new Firestore({ projectId: 'demo-floodcast-sync-mask' });
  const batch = firestore.batch();
  batch.set(firestore.doc(observedPath), patch.value, patch.options);
  // Serialize the queued operation only: no commit, credentials or network.
  const operation = batch._ops[0].op();
  const fields = operation.updateMask.fieldPaths;
  assert.ok(fields.includes(`fiman.\`${peakTime}\``));
  assert.ok(fields.includes(`weather.\`${peakTime}\`.windSpeed`));
  assert.equal(fields.includes(`weather.\`${peakTime}\`.precip`), false);
  assert.equal(fields.includes('fiman'), false);
  assert.equal(fields.includes('weather'), false);
  assert.ok(fields.every(field => !field.includes(oldTime)));
});

test('NOAA and weather failures do not block fresh FiMAN observations, images, peaks or events', async () => {
  noaa = new Error('NOAA gateway unavailable');
  weather = new Error('NWS unavailable');
  const previous = records.get(observedPath);
  await handlers.syncWaterLevels({});
  const bucket = records.get(observedPath);
  assert.equal(bucket.fiman[peakTime], 6.1);
  assert.deepEqual(bucket.noaa, previous.noaa);
  assert.deepEqual(bucket.weather, previous.weather);
  const patch = writes.find(write => write.path === observedPath).value;
  assert.equal(Object.hasOwn(patch, 'noaa'), false);
  assert.equal(Object.hasOwn(patch, 'weather'), false);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every(warning => warning[0].includes('existing source records are preserved')));
  assert.ok(writes.some(write => write.path.includes('/flood_events/')));
  assert.equal(errors.length, 0);
});

test('a FiMAN failure preserves its archived measurements and imagery while updating NOAA and weather', async () => {
  fiman = new Error('FiMAN unavailable');
  const previous = records.get(observedPath);
  await handlers.syncWaterLevels({});
  const bucket = records.get(observedPath);
  assert.deepEqual(bucket.fiman, previous.fiman);
  assert.deepEqual(bucket.imagery, previous.imagery);
  assert.equal(bucket.noaa[peakTime], 4.3);
  assert.deepEqual(bucket.weather[peakTime], { windSpeed: 0, precip: 0 });
  const patch = writes.find(write => write.path === observedPath).value;
  assert.equal(Object.hasOwn(patch, 'fiman'), false);
  assert.equal(Object.hasOwn(patch, 'imagery'), false);
  assert.equal(imageCalls.length, 0);
  assert.equal(writes.some(write => write.path.includes('/peaks/') || write.path.includes('/flood_events/')), false);
  assert.equal(warnings.length, 1);
});

test('all source failures leave observations and their original freshness timestamp untouched', async () => {
  noaa = new Error('NOAA unavailable'); fiman = new Error('FiMAN unavailable'); weather = new Error('Weather unavailable');
  const previous = structuredClone(records.get(observedPath));
  await handlers.syncWaterLevels({});
  assert.deepEqual(records.get(observedPath), previous);
  assert.deepEqual(writes, []);
  assert.equal(warnings.length, 3);
});

test('empty sources and weather containing only missing fields do not manufacture records or new freshness', async () => {
  noaa = {}; fiman = { waterLevels: {}, imagery: {} };
  weather = { [peakTime]: { windSpeed: undefined, precip: NaN } };
  const previous = structuredClone(records.get(observedPath));
  await handlers.syncWaterLevels({});
  assert.deepEqual(records.get(observedPath), previous);
  assert.deepEqual(writes, []);
});

test('a UTC Oct 31 to Nov 1 lookback writes both month buckets without skipping November', async () => {
  mock.timers.setTime(Date.parse('2026-11-01T00:30:00Z'));
  const octoberTime = '2026-10-31T23:54:00.000Z';
  const novemberTime = '2026-11-01T00:06:00.000Z';
  noaa = { [octoberTime]: 4, [novemberTime]: 4.2 };
  fiman = { waterLevels: { [octoberTime]: 4.4, [novemberTime]: 4.6 }, imagery: {} };
  weather = { [novemberTime]: { windSpeed: 0, precip: 0 } };
  await handlers.syncWaterLevels({});
  assert.equal(records.get(observedPath).fiman[octoberTime], 4.4);
  const novemberPath = 'locations/carolina-beach/observations/2026-11';
  assert.equal(records.get(novemberPath).fiman[novemberTime], 4.6);
  assert.equal(records.get(novemberPath).noaa[novemberTime], 4.2);
  assert.deepEqual(records.get(novemberPath).weather[novemberTime], { windSpeed: 0, precip: 0 });
  assert.equal(errors.length, 0);
});

test('image storage failure retains the source URL and does not prevent gauge bucket writes', async () => {
  imageFailure = new Error('Image storage unavailable');
  await handlers.syncWaterLevels({});
  assert.equal(records.get(observedPath).fiman[peakTime], 6.1);
  assert.equal(records.get(observedPath).imagery[peakTime].SUNNYD_CB_03, 'https://images.example/current.jpg');
  assert.equal(errors.length, 1);
  assert.match(errors[0][0], /Failed to persist image/);
});

test('prediction writes omit missing weather fields while preserving numerical predictions and archived weather', async () => {
  await handlers.syncPredictions({});
  const bucket = records.get(predictedPath);
  assert.equal(bucket.data[peakTime], 5.1);
  assert.equal(bucket.data[oldTime], 4.2);
  assert.deepEqual(bucket.weather[peakTime], { windSpeed: 15, description: 'Cloudy' });
  assert.deepEqual(bucket.weather[oldTime], { windSpeed: 9 });
  assert.equal(errors.length, 0);
});

test('atomic prediction merges preserve prior optional weather properties omitted from a partial refresh', async () => {
  records.get(predictedPath).weather[peakTime] = { windDirection: 90, icon: 'https://weather.example/icon.svg' };
  await handlers.syncPredictions({});
  assert.deepEqual(records.get(predictedPath).weather[peakTime], { windSpeed: 15, windDirection: 90, description: 'Cloudy', icon: 'https://weather.example/icon.svg' });
  const patch = writes.find(write => write.path === predictedPath);
  assert.deepEqual(patch.options, { merge: true });
  assert.equal(Object.hasOwn(patch.value.data, oldTime), false);
  assert.equal(errors.length, 0);
});

test('failed forecast weather does not stop NOAA prediction writes or alter archived weather', async () => {
  forecastWeather = new Error('NWS hourly forecast unavailable');
  const previous = records.get(predictedPath);
  await handlers.syncPredictions({});
  const bucket = records.get(predictedPath);
  assert.equal(bucket.data[peakTime], 5.1);
  assert.deepEqual(bucket.weather, previous.weather);
  assert.equal(Object.hasOwn(writes.find(write => write.path === predictedPath).value, 'weather'), false);
  assert.equal(warnings.length, 1);
});

test('failed NOAA predictions preserve astronomical predictions while available forecast weather updates', async () => {
  prediction = new Error('NOAA unavailable');
  const previous = records.get(predictedPath);
  await handlers.syncPredictions({});
  assert.deepEqual(records.get(predictedPath).data, previous.data);
  assert.deepEqual(records.get(predictedPath).weather[peakTime], { windSpeed: 15, description: 'Cloudy' });
  assert.equal(writes.some(write => write.path.includes('/peaks/')), false);
  assert.equal(warnings.length, 1);
});

test('fully unavailable predictions retain the previous bucket and freshness timestamp', async () => {
  prediction = new Error('NOAA unavailable'); forecastWeather = new Error('NWS unavailable');
  const previous = structuredClone(records.get(predictedPath));
  await handlers.syncPredictions({});
  assert.deepEqual(records.get(predictedPath), previous);
  assert.deepEqual(writes, []);
  assert.equal(warnings.length, 2);
});

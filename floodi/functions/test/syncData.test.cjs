const { test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const records = new Map(), writes = [], calls = [], logs = [];
let noaa, fiman, weather, prediction, forecastWeather, imageFailure, writeFailure;
function merge(previous, patch) {
  const result = { ...(previous || {}) };
  for (const [key, value] of Object.entries(patch)) result[key] = value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).length ? merge(result[key], value) : {} : value;
  return result;
}
const db = { doc: path => ({ path, get: async () => ({ exists: records.has(path), data: () => records.get(path) }), set: async (value, options) => {
  if (writeFailure && path.includes('/observations/')) throw writeFailure;
  writes.push({ path, value, options }); records.set(path, options?.merge ? merge(records.get(path), value) : value);
} }) };
const schedulerPath = require.resolve('../lib/syncData');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'firebase-functions/logger') return Object.fromEntries(['info','warn','error'].map(level => [level, (...args) => logs.push({ level,args })]));
  if (parent?.filename === schedulerPath) {
    if (request === 'firebase-admin') return { apps: [{}], firestore: () => db };
    if (request === 'firebase-functions/v2/scheduler') return { onSchedule: (_options, handler) => handler };
    const source = async value => { if (value instanceof Error) throw value; return value; };
    if (request === './etl/noaa') return { fetchNoaaObserved: () => source(noaa), fetchNoaaPredictions: () => source(prediction) };
    if (request === './etl/fiman') return { fetchFimanData: () => source(fiman) };
    if (request === './etl/weather') return { fetchNwsObservations: () => source(weather), fetchNwsForecast: () => source(forecastWeather) };
    if (request === './utils/storage') return { persistImageryBatch: async (_location, imagery) => {
      calls.push('images');
      assert.ok(writes.some(write => write.path.includes('/observations/')), 'measurements must commit before cameras');
      if (imageFailure) throw imageFailure;
      return { patch: Object.fromEntries(Object.keys(imagery).map(t => [t, { CAM: 'storage://archived.jpg' }])), attempted: 1, succeeded: 1, failed: 0, deferred: false };
    } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
let handlers;
try { handlers = require(schedulerPath); } finally { Module._load = originalLoad; }
const now = new Date('2026-10-14T12:00:00Z');
const path = 'locations/carolina-beach/observations/2026-10-14';
const predictedPath = 'locations/carolina-beach/predictions/2026-10';
const first = '2026-10-14T11:30:00.000Z', peak = '2026-10-14T11:36:00.000Z', last = '2026-10-14T11:42:00.000Z';
const health = () => records.get('operationalHealth/syncWaterLevels_carolina-beach');
beforeEach(() => {
  mock.timers.enable({ apis: ['Date'], now: +now });
  records.clear(); writes.length = calls.length = logs.length = 0; imageFailure = writeFailure = undefined;
  noaa = { [peak]: 4.3 };
  fiman = { waterLevels: { [first]: 5.4, [peak]: 6.1, [last]: 5.3 }, imagery: { [peak]: { CAM: 'https://images.example/current.jpg' } } };
  weather = { [peak]: { windSpeed: 0, precip: 0, temp: undefined, pressure: Infinity } };
  prediction = { [first]: 4.4, [peak]: 5.1, [last]: 4.5 };
  forecastWeather = { [peak]: { windSpeed: 15, description: 'Cloudy', icon: undefined } };
});
afterEach(() => { mock.restoreAll(); mock.timers.reset(); });

test('commits valid daily measurements before cameras, omits undefined, and reports per-source freshness', async () => {
  await handlers.syncWaterLevels();
  const bucket = records.get(path);
  assert.equal(bucket.fiman[peak],6.1); assert.equal(bucket.noaa[peak],4.3);
  assert.deepEqual(bucket.weather[peak], { windSpeed:0,precip:0 });
  assert.equal(bucket.persistedImagery[peak].CAM,'storage://archived.jpg');
  assert.equal(health().status,'ok'); assert.equal(health().sources.fiman.latestAt,last);
  assert.equal(health().sources.fiman.count,3);
  assert.equal(writes.some(write => /observations\/\d{4}-\d\d$/.test(write.path)),false);
});
test('weather and NOAA failures retain existing history while allowing gauge writes and report partial success', async () => {
  records.set(path,{ noaa:{old:2},weather:{old:{windSpeed:8}} });
  noaa=new Error('NOAA unavailable'); weather=new Error('NWS unavailable');
  await handlers.syncWaterLevels();
  assert.equal(records.get(path).fiman[peak],6.1); assert.deepEqual(records.get(path).noaa,{old:2});
  assert.equal(health().status,'partial'); assert.equal(health().sources.noaa.status,'failed');
  assert.ok(logs.some(log => log.level==='warn' && log.args[1].event==='job_outcome'));
});
test('camera failure cannot discard committed observations or original camera URL', async () => {
  imageFailure=new Error('Camera storage timed out');
  await handlers.syncWaterLevels();
  assert.equal(records.get(path).fiman[peak],6.1);
  assert.equal(records.get(path).imagery[peak].CAM,'https://images.example/current.jpg');
  assert.equal(health().status,'partial');
});
test('zero successful measurement sources fail the schedule without manufacturing observation freshness', async () => {
  noaa=new Error('No NOAA'); fiman=new Error('No gauge'); weather=new Error('No weather');
  await assert.rejects(handlers.syncWaterLevels(),/Observation sync/);
  assert.equal(records.has(path),false); assert.equal(health().status,'failed');
  assert.equal(health().sources.fiman.status,'failed');
  assert.ok(logs.some(log => log.level==='error' && log.args[1].event==='job_outcome'));
});
test('empty and invalid weather sources fail rather than reporting an ingestion success', async () => {
  noaa={}; fiman={waterLevels:{},imagery:{}}; weather={ [peak]:{precip:undefined,pressure:NaN} };
  await assert.rejects(handlers.syncWaterLevels(),/Observation sync/);
  assert.equal(records.has(path),false); assert.equal(health().status,'failed');
});
test('fatal database write failure is visible to Scheduler and structured health', async () => {
  writeFailure=new Error('Database unavailable');
  await assert.rejects(handlers.syncWaterLevels(),/Observation sync/);
  assert.equal(health().status,'failed'); assert.equal(calls.length,0);
});
test('derived peak/event refresh preserves attached metadata and existing peak image keys', async () => {
  const peakPath=`locations/carolina-beach/peaks/fiman_${peak.replace(/[:.-]/g,'')}`;
  records.set(peakPath,{review:'verified',images:{KEEP:'photo'}});
  await handlers.syncWaterLevels();
  assert.equal(records.get(peakPath).review,'verified'); assert.deepEqual(records.get(peakPath).images,{KEEP:'photo'});
  assert.ok(writes.filter(write=>write.path.includes('/peaks/')||write.path.includes('/flood_events/')).every(write=>write.options?.merge===true));
});
test('daily buckets span UTC midnight without rewriting month archives', async () => {
  mock.timers.setTime(Date.parse('2026-11-01T00:30:00Z'));
  const october='2026-10-31T23:54:00Z',november='2026-11-01T00:06:00Z';
  noaa={ [october]:4,[november]:4.2 }; fiman={waterLevels:{ [october]:4.4,[november]:4.6 },imagery:{}}; weather={};
  await handlers.syncWaterLevels();
  assert.equal(records.get('locations/carolina-beach/observations/2026-10-31').fiman[new Date(october).toISOString()],4.4);
  assert.equal(records.get('locations/carolina-beach/observations/2026-11-01').fiman[new Date(november).toISOString()],4.6);
});
test('the real SDK daily leaf mask preserves omitted samples and partial weather fields',async()=>{
  records.set(path,{weather:{[peak]:{windDirection:45,pressure:1015}}});
  await handlers.syncWaterLevels();
  assert.equal(records.get(path).weather[peak].windDirection,45);
  const patch=writes.find(write=>write.path===path);
  const {Firestore}=require('@google-cloud/firestore');const firestore=new Firestore({projectId:'demo-sync-mask'});
  const batch=firestore.batch();batch.set(firestore.doc(path),patch.value,patch.options);
  const fields=batch._ops[0].op().updateMask.fieldPaths;
  assert.ok(fields.includes(`fiman.\`${peak}\``));assert.equal(fields.includes('fiman'),false);
  assert.equal(fields.includes(`weather.\`${peak}\`.pressure`),false);
});
test('predictions preserve historical fields and metadata while reporting partial source failure',async()=>{
  records.set(predictedPath,{data:{old:3},weather:{old:{windSpeed:8}}});forecastWeather=new Error('NWS failed');
  await handlers.syncPredictions();
  assert.equal(records.get(predictedPath).data[peak],5.1);assert.equal(records.get(predictedPath).data.old,3);
  assert.deepEqual(records.get(predictedPath).weather,{old:{windSpeed:8}});
  assert.equal(records.get('operationalHealth/syncPredictions_carolina-beach').status,'partial');
});
test('all unavailable prediction sources fail the schedule and leave existing forecast freshness untouched',async()=>{
  records.set(predictedPath,{lastUpdated:'original'});prediction=new Error('NOAA failed');forecastWeather=new Error('NWS failed');
  await assert.rejects(handlers.syncPredictions(),/Prediction sync/);
  assert.deepEqual(records.get(predictedPath),{lastUpdated:'original'});
});
test('weather-only writes cannot count as gauge measurements or produce a successful water-level sync',async()=>{
 noaa={};fiman={waterLevels:{},imagery:{}};
 await assert.rejects(handlers.syncWaterLevels(),/Observation sync/);
 assert.equal(records.get(path).weather[peak].precip,0);assert.equal(health().measurementWrites,0);assert.equal(health().status,'failed');
 assert.equal(health().sourceLastSuccessfulAt?.noaa,undefined);assert.equal(health().sourceLastSuccessfulAt?.fiman,undefined);
});

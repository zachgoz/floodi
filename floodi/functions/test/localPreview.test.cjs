const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const {
  archiveFingerprint, createLocalModelCache, LOCAL_MODEL_REFRESH_MS,
  parseLocalHistory, restoreLocalModelCache, writeAtomicJson,
} = require('../lib/forecast/localPreview');
const { SITE } = require('../lib/forecast/sources');
const { WEATHER_RESPONSE_FEATURES, WEATHER_RESPONSE_LEADS } = require('../lib/forecast/weatherResponse');

const HOUR = 3600000;
const now = new Date('2026-10-11T12:00:00Z');
const historyPath = '/private/tmp/floodi-local-history.json';
const fingerprint = archiveFingerprint('{"realArchive":true}');
const reference = { station: SITE.sensor, datum: SITE.datum, units: SITE.units };
function model() {
  return {
    reference, tideReference: reference,
    maxObservationGapMs: 30 * 60000 + 10000,
    trainedUntil: new Date(+now - 7 * 24 * HOUR),
    holdoutStarts: new Date(+now - 30 * 24 * HOUR),
    testStart: new Date(+now - 30 * 24 * HOUR),
    testEnd: new Date(+now - 7 * 24 * HOUR),
    regressions: WEATHER_RESPONSE_LEADS.map(leadHours => ({ leadHours, model: {
      means: WEATHER_RESPONSE_FEATURES.map(() => 0),
      scales: WEATHER_RESPONSE_FEATURES.map(() => 1),
      coefficients: WEATHER_RESPONSE_FEATURES.map(() => .1), intercept: .05,
      minimums: WEATHER_RESPONSE_FEATURES.map(() => -5),
      maximums: WEATHER_RESPONSE_FEATURES.map(() => 5),
    } })),
    validation: {
      leads: WEATHER_RESPONSE_LEADS.map(leadHours => ({ leadHours, trainingPairs: 300, testPairs: 120, modelMaeFt: .15, persistenceMaeFt: .25, improvement: .4, absoluteError90Ft: .4, passes: true })),
      peakWindows: 8, peakMaeFt: .15, persistencePeakMaeFt: .2,
      eligible: true, pointEligible: true, weatherInput: 'reanalysis hindcast',
    }, limitations: ['Synthetic cache-contract fixture; no physical forecast claim.'],
  };
}
const cache = () => JSON.parse(JSON.stringify(createLocalModelCache(model(), now, historyPath, fingerprint)));
const archive = () => ({
  metadata: { sensor: SITE.sensor, tideStation: SITE.tideStation, datum: SITE.datum, units: SITE.units, phaseMinutes: SITE.phaseMinutes, navd88ToMllwFt: SITE.offsetFt },
  history: [{ t: '2026-10-03T12:00:00Z', v: .4 }],
  tide: [{ t: '2026-10-03T12:00:00Z', v: 3 }],
  weather: [{ t: '2026-10-03T12:00:00Z', windSpeed: 12, windDirection: 45, precip: 0, pressure: 1018 }],
});

test('reuses the identical validated daily model with original observation and fit dates', () => {
  const restored = restoreLocalModelCache(cache(), new Date(+now + 10 * 60000), historyPath, fingerprint);
  assert.deepEqual(restored, model());
  assert.equal(restored.trainedUntil.toISOString(), '2026-10-04T12:00:00.000Z');
});

test('requires a fresh fit at 24 hours, with any archive edit, or with a different archive path', () => {
  assert.ok(restoreLocalModelCache(cache(), new Date(+now + LOCAL_MODEL_REFRESH_MS - 1), historyPath, fingerprint));
  assert.equal(restoreLocalModelCache(cache(), new Date(+now + LOCAL_MODEL_REFRESH_MS), historyPath, fingerprint), null);
  assert.equal(restoreLocalModelCache(cache(), now, historyPath, archiveFingerprint('{"realArchive":false}')), null);
  assert.equal(restoreLocalModelCache(cache(), now, '/private/tmp/different.json', fingerprint), null);
});

test('rejects wrong cache versions, physical references, validation gates and future fit dates', () => {
  for (const mutation of [
    value => { value.version = 2; },
    value => { value.cache.version = 'gauge-weather-response-v5'; },
    value => { value.cache.reference.offsetFt = 0; },
    value => { value.cache.reference.phaseMinutes = 0; },
    value => { value.cache.model.reference.datum = 'NAVD88'; },
    value => { value.cache.model.validation.leads[0].modelMaeFt = 2; },
    value => { value.cache.createdAt = new Date(+now + HOUR).toISOString(); },
    value => { value.cache.model.trainedUntil = new Date(+now + HOUR).toISOString(); },
    value => { value.cache.trainingPath = 'forecast-training/unrelated/history.json'; },
  ]) {
    const value = cache(); mutation(value);
    assert.equal(restoreLocalModelCache(value, now, historyPath, fingerprint), null);
  }
});

test('validates measured history and rejects future observations before any model reuse', () => {
  const valid = parseLocalHistory(archive(), now);
  assert.ok(valid.history[0].t instanceof Date);
  assert.ok(valid.weather[0].t instanceof Date);
  for (const mutation of [
    value => { value.metadata.sensor = 'SUNNYD_CB_03'; },
    value => { value.metadata.tideStation = 'other'; },
    value => { value.metadata.navd88ToMllwFt = 1; },
    value => { value.metadata.phaseMinutes = 0; },
    value => { value.history[0].t = new Date(+now + HOUR).toISOString(); },
    value => { value.weather[0].t = new Date(+now + HOUR).toISOString(); },
    value => { value.history[0].v = null; },
    value => { value.tide = []; },
  ]) {
    const value = archive(); mutation(value);
    assert.throws(() => parseLocalHistory(value, now), /Archive/);
  }
});

test('atomic JSON writes replace complete artifacts and preserve the previous one on serialization failure', () => {
  const directory = mkdtempSync(join(tmpdir(), 'floodi-local-preview-'));
  try {
    const path = join(directory, 'outlook.json');
    writeAtomicJson(path, { generatedAt: now.toISOString(), points: [1, 2] });
    const previous = readFileSync(path, 'utf8');
    const circular = {}; circular.self = circular;
    assert.throws(() => writeAtomicJson(path, circular));
    assert.equal(readFileSync(path, 'utf8'), previous);
    assert.deepEqual(readdirSync(directory), ['outlook.json']);
    writeAtomicJson(path, { generatedAt: new Date(+now + 600000).toISOString(), points: [3] });
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')).points, [3]);
    assert.equal(statSync(path).mode & 0o777, 0o600);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

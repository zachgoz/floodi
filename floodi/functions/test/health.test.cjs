const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assessDataHealth, freshness } = require('../lib/health');
const { buildForecast } = require('../lib/forecast/pipeline');
const { validateForecast } = require('../lib/forecast/schema');
const now = new Date('2026-10-14T16:00:00Z');
const recent = '2026-10-14T15:45:00Z';
const predictions = { lastSuccessfulAt: recent, sourceLastSuccessfulAt: { noaa: recent } };
function availableOutlook() {
  const metric = { samples: 10, hits: 1, misses: 0, falseAlarms: 0, matchedEvents: 1, maeFt: .2, peakMaeFt: .2, onsetMaeMinutes: 10, durationMaeMinutes: 10 };
  const value = {
    ...buildForecast([], [], [], [], [], now), status: 'available', sensor: '30046',
    method: 'weather-response', confidence: 'limited', validationStage: 'historical-hindcast',
    points: [0, 1].map(i => ({ t: new Date(+now + i * 360000).toISOString(), tideFt: 3, residualFt: .2, totalFt: 3.2, lowerFt: 3, upperFt: 3.5 })),
    validation: { kind: 'chronological-perfect-weather-hindcast', trainEnd: '2026-10-01T00:00:00Z', testStart: '2026-10-02T00:00:00Z', testEnd: '2026-10-10T00:00:00Z', trainingSamples: 100, limitation: 'Synthetic test fixture', error90Ft: .3, model: metric, tideOnly: metric, persistence: metric },
  };
  assert.equal(validateForecast(value), true);
  return value;
}
test('invalid, absent and future timestamps never count as healthy', () => {
  for (const t of [undefined, null, 'not-a-date', '2026-10-14T16:01:00Z']) assert.equal(freshness(t, 60, now).fresh, false);
  assert.equal(freshness('2026-10-14T15:00:00Z', 60, now).fresh, true);
  assert.equal(freshness('2026-10-14T14:59:59Z', 60, now).fresh, false);
});
test('independent source freshness catches stale gauge even when other jobs look current', () => {
  const health = assessDataHealth({ fiman: { '2026-10-14T14:00:00Z': 3, '2026-10-15T00:00:00Z': 7 }, noaa: { [recent]: 0 } }, availableOutlook(), { createdAt: recent }, predictions, now);
  assert.deepEqual(health.staleSources, ['gauge']);
  assert.equal(health.sources.gauge.latestAt, '2026-10-14T14:00:00.000Z');
  assert.equal(health.sources.noaa.fresh, true);
});
test('valid fresh gauge, NOAA, evaluated outlook and scheduled outputs pass', () => {
  const health = assessDataHealth({ fiman: { [recent]: 0 }, noaa: { [recent]: 0 } }, availableOutlook(), { createdAt: recent }, predictions, now);
  assert.equal(health.healthy, true);
  assert.deepEqual(health.staleSources, []);
});
test('a new unavailable forecast or missing model cannot manufacture health', () => {
  const health = assessDataHealth({ fiman: {}, noaa: {} }, buildForecast([], [], [], [], [], now), undefined, undefined, now);
  assert.equal(health.healthy, false);
  assert.deepEqual(health.staleSources, ['gauge', 'noaa', 'outlook', 'model', 'predictions']);
});
test('an expired or malformed outlook is unhealthy even if its generation timestamp is recent', () => {
  const outlook = availableOutlook();
  outlook.expiresAt = '2026-10-14T15:59:00Z';
  const health = assessDataHealth({ fiman: { [recent]: 4 }, noaa: { [recent]: 4 } }, outlook, { createdAt: recent }, predictions, now);
  assert.deepEqual(health.staleSources, ['outlook']);
});
test('weather-only job success cannot hide indefinitely missing NOAA prediction updates', () => {
  const partialJob = { lastSuccessfulAt: recent, sourceLastSuccessfulAt: { weather: recent, noaa: '2026-10-12T00:00:00Z' } };
  const health = assessDataHealth({ fiman: { [recent]: 4 }, noaa: { [recent]: 4 } }, availableOutlook(), { createdAt: recent }, partialJob, now);
  assert.deepEqual(health.staleSources, ['predictions']);
});

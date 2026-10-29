const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assessDataHealth, freshness } = require('../lib/health');

const now = new Date('2026-10-14T16:00:00Z');
const recent = '2026-10-14T15:45:00Z';
const predictions = { lastSuccessfulAt: recent, sourceLastSuccessfulAt: { noaa: recent } };

function availableOperationalOutlook() {
  return {
    challengerId: 'timesfm-3',
    locationId: 'carolina-beach',
    generatedAt: recent,
    expiresAt: '2026-10-14T16:30:00Z',
    status: 'available',
    engine: 'noaa-etss-hybrid',
    horizonSteps: 48,
    thresholdFt: 5.6,
    points: Array.from({ length: 48 }, (_, i) => ({
      t: new Date(+now + (i + 1) * 1800_000).toISOString(),
      tideFt: 3.1,
      residualFt: 0.7,
      totalFt: 3.8,
      lowerFt: 3.5,
      upperFt: 4.1,
    })),
    peak: {
      t: '2026-10-14T22:00:00Z',
      totalFt: 5.8,
      tideFt: 5.1,
      residualFt: 0.7,
      exceedsThreshold: true,
    },
    covariatesUsed: ['astronomical_tide', 'noaa_etss_surge'],
    metadata: { historyPointsCount: 97, noaaSurgeAvailable: true, retrievedAt: recent },
  };
}

test('invalid, absent and future timestamps never count as healthy', () => {
  for (const t of [undefined, null, 'not-a-date', '2026-10-14T16:01:00Z']) {
    assert.equal(freshness(t, 60, now).fresh, false);
  }
  assert.equal(freshness('2026-10-14T15:00:00Z', 60, now).fresh, true);
  assert.equal(freshness('2026-10-14T14:59:59Z', 60, now).fresh, false);
});

test('independent source freshness catches stale gauge even when operational outlook is current', () => {
  const health = assessDataHealth(
    { fiman: { '2026-10-14T14:00:00Z': 3, '2026-10-15T00:00:00Z': 7 }, noaa: { [recent]: 0 } },
    availableOperationalOutlook(),
    predictions,
    now
  );
  assert.deepEqual(health.staleSources, ['gauge']);
  assert.equal(health.sources.gauge.latestAt, '2026-10-14T14:00:00.000Z');
  assert.equal(health.sources.noaa.fresh, true);
});

test('valid fresh gauge, NOAA, operational outlook and scheduled outputs pass without legacy ridge model', () => {
  const health = assessDataHealth(
    { fiman: { [recent]: 0 }, noaa: { [recent]: 0 } },
    availableOperationalOutlook(),
    predictions,
    now
  );
  assert.equal(health.healthy, true);
  assert.deepEqual(health.staleSources, []);
});

test('an unavailable or missing operational forecast cannot manufacture health', () => {
  const health = assessDataHealth(
    { fiman: {}, noaa: {} },
    { status: 'unavailable', points: [] },
    undefined,
    now
  );
  assert.equal(health.healthy, false);
  assert.deepEqual(health.staleSources, ['gauge', 'noaa', 'outlook', 'predictions']);
});

test('an expired operational outlook is unhealthy even if its generation timestamp is recent', () => {
  const outlook = availableOperationalOutlook();
  outlook.expiresAt = '2026-10-14T15:59:00Z';
  const health = assessDataHealth(
    { fiman: { [recent]: 4 }, noaa: { [recent]: 4 } },
    outlook,
    predictions,
    now
  );
  assert.deepEqual(health.staleSources, ['outlook']);
});

test('weather-only job success cannot hide indefinitely missing NOAA prediction updates', () => {
  const partialJob = {
    lastSuccessfulAt: recent,
    sourceLastSuccessfulAt: { weather: recent, noaa: '2026-10-12T00:00:00Z' },
  };
  const health = assessDataHealth(
    { fiman: { [recent]: 4 }, noaa: { [recent]: 4 } },
    availableOperationalOutlook(),
    partialJob,
    now
  );
  assert.deepEqual(health.staleSources, ['predictions']);
});

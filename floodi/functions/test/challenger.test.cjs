const { test } = require('node:test');
const assert = require('node:assert/strict');

const { resampleResidualGrid, runTimesFmChallenger } = require('../lib/forecast/challenger');

/** Mock Firestore for testing */
function createMockFirestore() {
  const store = new Map();
  return {
    store,
    doc(path) {
      return {
        async set(data) {
          store.set(path, data);
        },
        async get() {
          const data = store.get(path);
          return {
            exists: !!data,
            data: () => data,
          };
        },
      };
    },
  };
}

test('resampleResidualGrid handles empty and boundary cases', () => {
  const now = new Date('2026-10-25T12:00:00Z');
  
  // 1. Empty input
  const emptyRes = resampleResidualGrid([], now, 48);
  assert.equal(emptyRes.length, 0);

  // 2. Regular 30-min series
  const series = [];
  for (let i = 0; i <= 96; i++) {
    const t = new Date(now.getTime() - (96 - i) * 30 * 60_000);
    series.push({ t, v: 1.5 + Math.sin(i * 0.1) });
  }

  const resampled = resampleResidualGrid(series, now, 48);
  assert.equal(resampled.length, 97); // 48 hours inclusive: 0h..48h = 97 points
  assert.equal(typeof resampled[0].v, 'number');
  assert.equal(resampled[0].t, new Date(now.getTime() - 48 * 3600_000).toISOString());
  assert.equal(resampled[resampled.length - 1].t, now.toISOString());
});

test('runTimesFmChallenger returns null when residual history is insufficient', async () => {
  const db = createMockFirestore();
  const issuedAt = new Date('2026-10-25T12:00:00Z');

  const result = await runTimesFmChallenger({
    db,
    siteId: '30046',
    thresholdFt: 5.75,
    issuedAt,
    recentResidual: [
      { t: new Date(issuedAt.getTime() - 60_000), v: 1.2 },
    ],
    tide: [],
  });

  assert.equal(result, null);
  assert.equal(db.store.size, 0);
});

test('runTimesFmChallenger succeeds with mocked TimesFM and NOAA ETSS guidance', async () => {
  const db = createMockFirestore();
  const issuedAt = new Date('2026-10-25T12:00:00Z');

  // Build 48 hours of mock residual history
  const recentResidual = [];
  for (let i = 0; i < 96; i++) {
    const t = new Date(issuedAt.getTime() - (96 - i) * 30 * 60_000);
    recentResidual.push({ t, v: 1.25 });
  }

  // Build future tides
  const tide = [];
  for (let step = 0; step <= 96; step++) {
    const t = new Date(issuedAt.getTime() + step * 30 * 60_000);
    // Peak at step 24 (12h out) with tide 4.8 ft
    tide.push({ t, v: 3.0 + 1.8 * Math.cos((step - 24) * 0.25) });
  }

  // Mock NOAA ETSS provider
  const mockNoaaProvider = async () => ({
    station: '8658163',
    stationName: 'Wrightsville Beach, NC (ncwrit)',
    retrievedAt: issuedAt.toISOString(),
    points: [
      {
        t: issuedAt.toISOString(),
        surgeFt: 1.2,
        tideFt: 4.87,
        totalFt: 6.07,
        anomalyFt: 0.35,
      },
      {
        t: new Date(issuedAt.getTime() + 24 * 3600_000).toISOString(),
        surgeFt: 1.1,
        tideFt: 4.29,
        totalFt: 5.39,
        anomalyFt: 0.25,
      },
    ],
  });

  // Mock TimesFmVertexClient
  const mockTimesfmClient = {
    async forecast(request) {
      assert.equal(request.targetHistory.length >= 24, true);
      assert.equal(request.horizon, 48);
      assert.equal(request.futureTide.length, 48);
      assert.equal(request.futureNoaaSurge.length, 48);
      return {
        mean: new Array(48).fill(1.35),
        q10: new Array(48).fill(1.10),
        q50: new Array(48).fill(1.35),
        q90: new Array(48).fill(1.60),
        engine: 'bigquery-ai-forecast',
      };
    },
  };

  const doc = await runTimesFmChallenger({
    db,
    siteId: '30046',
    thresholdFt: 5.75,
    issuedAt,
    recentResidual,
    tide,
    forecastWeather: [
      { t: issuedAt, windSpeedMph: 15, surfacePressureHpa: 1012 },
    ],
    timesfmClient: mockTimesfmClient,
    noaaForecastProvider: mockNoaaProvider,
  });

  assert.ok(doc);
  assert.equal(doc.challengerId, 'timesfm-3');
  assert.equal(doc.locationId, '30046');
  assert.equal(doc.status, 'available');
  assert.equal(doc.engine, 'bigquery-ai-forecast');
  assert.equal(doc.points.length, 48);
  assert.equal(doc.covariatesUsed.includes('noaa_etss_surge'), true);
  assert.equal(doc.covariatesUsed.includes('astronomical_tide'), true);

  // Exact math assertions: totalFt = tideFt + residualFt
  for (const pt of doc.points) {
    assert.equal(Math.round((pt.tideFt + pt.residualFt) * 1000) / 1000, pt.totalFt);
    assert.equal(pt.upperFt >= pt.lowerFt, true);
    assert.equal(pt.residualFt, 1.35);
  }

  // Peak check
  assert.ok(doc.peak);
  assert.equal(typeof doc.peak.totalFt, 'number');
  assert.equal(doc.peak.totalFt > 5.0, true);
  assert.equal(typeof doc.peak.exceedsThreshold, 'boolean');

  // Verify Firestore writes
  const issueKey = `locations/30046/forecast_challengers/timesfm-3/issues/${issuedAt.toISOString()}`;
  const currentKey = 'locations/30046/forecast_challengers/timesfm-3/outlook/current';
  const markerKey = `forecast_challenger_publications/timesfm-3/30046/issues/${issuedAt.toISOString()}`;

  assert.equal(db.store.has(issueKey), true);
  assert.equal(db.store.has(currentKey), true);
  assert.equal(db.store.has(markerKey), true);
});

test('runTimesFmChallenger handles TimesFM failure gracefully without throwing', async () => {
  const db = createMockFirestore();
  const issuedAt = new Date('2026-10-25T12:00:00Z');

  const recentResidual = [];
  for (let i = 0; i < 96; i++) {
    recentResidual.push({ t: new Date(issuedAt.getTime() - (96 - i) * 30 * 60_000), v: 1.0 });
  }

  const failingClient = {
    async forecast() {
      throw new Error('Simulated Vertex AI / BigQuery timeout 504');
    },
  };

  // Must NOT throw
  const doc = await runTimesFmChallenger({
    db,
    siteId: '30046',
    thresholdFt: 5.75,
    issuedAt,
    recentResidual,
    tide: [{ t: issuedAt, v: 3.5 }],
    timesfmClient: failingClient,
  });

  assert.equal(doc, null);
  assert.equal(db.store.size, 0);
});

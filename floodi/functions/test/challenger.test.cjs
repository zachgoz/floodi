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

  // 1. When NOAA surge is available, it gracefully falls back to noaa-etss-hybrid
  const hybridDoc = await runTimesFmChallenger({
    db,
    siteId: '30046',
    thresholdFt: 5.75,
    issuedAt,
    recentResidual,
    tide: [{ t: issuedAt, v: 3.5 }],
    timesfmClient: failingClient,
    noaaForecastProvider: async () => ({
      station: 'ncwrit',
      generatedAt: issuedAt.toISOString(),
      points: [{ t: issuedAt.toISOString(), surgeFt: 1.2 }],
    }),
  });

  assert.equal(hybridDoc.status, 'available');
  assert.equal(hybridDoc.engine, 'noaa-etss-hybrid');
  assert.equal(hybridDoc.points.length, 48);

  // 2. When both TimesFM and NOAA surge fail, it handles gracefully without throwing and returns null
  const nullDoc = await runTimesFmChallenger({
    db,
    siteId: '30046',
    thresholdFt: 5.75,
    issuedAt,
    recentResidual,
    tide: [{ t: issuedAt, v: 3.5 }],
    timesfmClient: failingClient,
    noaaForecastProvider: async () => null,
  });

  assert.equal(nullDoc, null);
});

test('fitResidualHarmonics handles edge cases and models lunar semi-diurnal M2 constituent', () => {
  const { fitResidualHarmonics } = require('../lib/forecast/challenger');
  const now = new Date('2026-10-27T12:00:00Z');

  // 1. Insufficient history (< 12 samples) returns 0.0
  const shortHistory = [
    { t: new Date(now.getTime() - 3600_000).toISOString(), v: 0.5 },
  ];
  const fnShort = fitResidualHarmonics(shortHistory, now);
  assert.equal(fnShort(now), 0);
  assert.equal(fnShort(new Date(now.getTime() + 6 * 3600_000)), 0);

  // 2. Exact zero delta at anchorTime
  const waveHistory = [];
  for (let i = 0; i < 48; i++) {
    const t = new Date(now.getTime() - (48 - i) * 30 * 60_000);
    const h = (t.getTime() - now.getTime()) / 3600_000;
    // Amplitude 0.35 ft, period 12.4206h (M2)
    const v = 0.8 + 0.35 * Math.cos(2 * Math.PI * h / 12.4206);
    waveHistory.push({ t: t.toISOString(), v });
  }

  const fnWave = fitResidualHarmonics(waveHistory, now);
  // Anchor assertion: must be strictly 0.0 at now
  assert.equal(Math.abs(fnWave(now)) < 1e-4, true);

  // At quarter cycle (~3.1h), delta is negative
  const quarterCycle = new Date(now.getTime() + 3.105 * 3600_000);
  assert.equal(fnWave(quarterCycle) < -0.2, true);

  // At half cycle (~6.21h), delta reaches full inverted amplitude (~ -0.7 ft)
  const halfCycle = new Date(now.getTime() + 6.21 * 3600_000);
  assert.equal(fnWave(halfCycle) < -0.5, true);

  // At full cycle (~12.42h), returns back near 0.0
  const fullCycle = new Date(now.getTime() + 12.4206 * 3600_000);
  assert.equal(Math.abs(fnWave(fullCycle)) < 0.05, true);
});

test('runTimesFmChallenger produces physically dynamic non-flat residual oscillations matching tidal cycles', async () => {
  const db = createMockFirestore();
  const issuedAt = new Date('2026-10-27T12:00:00Z');

  // Build oscillating history mimicking real Carolina Beach sensor readings
  const recentResidual = [];
  for (let i = 0; i < 96; i++) {
    const t = new Date(issuedAt.getTime() - (96 - i) * 30 * 60_000);
    const h = (t.getTime() - issuedAt.getTime()) / 3600_000;
    recentResidual.push({ t, v: 0.8 + 0.3 * Math.cos(2 * Math.PI * h / 12.4206) });
  }

  const tide = [];
  for (let step = 0; step <= 96; step++) {
    const t = new Date(issuedAt.getTime() + step * 30 * 60_000);
    tide.push({ t, v: 3.5 + 2.0 * Math.cos(step * 0.25) });
  }

  const doc = await runTimesFmChallenger({
    db,
    siteId: 'carolina-beach',
    thresholdFt: 5.75,
    issuedAt,
    recentResidual,
    tide,
    timesfmClient: {
      async forecast() {
        throw new Error('Fallback to hybrid');
      },
    },
    noaaForecastProvider: async () => ({
      station: '8658163',
      stationName: 'Wrightsville Beach',
      retrievedAt: issuedAt.toISOString(),
      points: [
        { t: issuedAt.toISOString(), surgeFt: 0.65 },
        { t: new Date(issuedAt.getTime() + 24 * 3600_000).toISOString(), surgeFt: 0.85 },
      ],
    }),
  });

  assert.ok(doc);
  assert.equal(doc.engine, 'noaa-etss-hybrid');
  assert.equal(doc.points.length, 48);

  const residuals = doc.points.map(p => p.residualFt);
  const minRes = Math.min(...residuals);
  const maxRes = Math.max(...residuals);
  const range = maxRes - minRes;

  // The residual MUST NOT be a flat line; it must oscillate with tidal shallow-water dynamics
  assert.equal(range > 0.2, true, `Residual range (${range.toFixed(3)} ft) should be > 0.2 ft, not flat`);

  // Verify mathematical integrity for all points
  for (const pt of doc.points) {
    assert.equal(Math.round((pt.tideFt + pt.residualFt) * 1000) / 1000, pt.totalFt);
  }
});



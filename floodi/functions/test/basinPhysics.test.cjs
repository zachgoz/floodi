const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  CAROLINA_BEACH_BASIN_SPEC,
  MULTI_REGION_BASIN_SPECS,
  directionalWindStress,
  fitBasinHarmonics,
  smoothSubtidalSeries,
  synthesizeOperationalForecast,
} = require('../lib/forecast/basinPhysics');
const { parseUsgsIvPayload, CAPE_FEAR_LOCK1_CONFIG } = require('../lib/forecast/usgsRiver');
const { buildEtssUrl, WRIGHTSVILLE_ETSS_CONFIG, WILMINGTON_RIVER_ETSS_CONFIG } = require('../lib/forecast/noaaSurge');

test('boundary & degenerate inputs: directionalWindStress, parseUsgsIvPayload, and synthesizeOperationalForecast never produce NaN', () => {
  // 1. Degenerate wind speeds & bearings
  assert.equal(directionalWindStress(0, 25, 25), 0);
  assert.equal(directionalWindStress(-15, 25, 25), 0);
  assert.equal(directionalWindStress(NaN, 25, 25), 0);
  assert.equal(directionalWindStress(20, NaN, 25), 0);
  assert.equal(directionalWindStress(undefined, 25, 25), 0);
  assert.equal(directionalWindStress(Infinity, 25, 25), 0);

  // Dead-on 20 mph NNE wind (25 deg) yields +1.0 stress; opposite SSW (205 deg) yields -1.0
  assert.ok(Math.abs(directionalWindStress(20, 25, 25) - 1.0) < 1e-6);
  assert.ok(Math.abs(directionalWindStress(20, 205, 25) - -1.0) < 1e-6);
  // Orthogonal ESE (115 deg) yields ~0.0 stress
  assert.ok(Math.abs(directionalWindStress(20, 115, 25)) < 1e-6);
  // Hurricane-force clamp bound
  assert.equal(directionalWindStress(200, 25, 25), 4.5);

  // 2. USGS parser rejects -999999 equipment/ice sentinels, negative discharge, and malformed JSON
  assert.deepEqual(parseUsgsIvPayload(null), { points: [], latestDischargeCfs: null, latestGageHeightFt: null });
  assert.deepEqual(parseUsgsIvPayload({ value: { timeSeries: 'corrupted' } }), {
    points: [],
    latestDischargeCfs: null,
    latestGageHeightFt: null,
  });

  const usgsParsed = parseUsgsIvPayload({
    value: {
      timeSeries: [
        {
          variable: { variableCode: [{ value: '00060' }] },
          values: [
            {
              value: [
                { dateTime: '2026-10-28T10:00:00.000Z', value: '-999999' },
                { dateTime: '2026-10-28T10:15:00.000Z', value: '-45' },
                { dateTime: '2026-10-28T10:30:00.000Z', value: '6420' },
                { dateTime: 'invalid-date', value: '5000' },
              ],
            },
          ],
        },
        {
          variable: { variableCode: [{ value: '00065' }] },
          values: [
            {
              value: [
                { dateTime: '2026-10-28T10:00:00.000Z', value: '-999999' },
                { dateTime: '2026-10-28T10:30:00.000Z', value: '14.82' },
              ],
            },
          ],
        },
      ],
    },
  });
  assert.equal(usgsParsed.points.length, 1);
  assert.equal(usgsParsed.latestDischargeCfs, 6420);
  assert.equal(usgsParsed.latestGageHeightFt, 14.82);

  // 3. Empty or invalid synthesizeOperationalForecast inputs
  assert.deepEqual(synthesizeOperationalForecast({ issuedAt: 'not-a-date', recentResidual: [], tide: [] }), []);
  assert.deepEqual(synthesizeOperationalForecast({ issuedAt: '2026-10-29T12:00:00Z', recentResidual: [], tide: [] }), []);

  // 4. ETSS station URL builder supports Wrightsville Ocean and Wilmington Cape Fear River
  assert.equal(CAPE_FEAR_LOCK1_CONFIG.siteId, '02105769');
  assert.ok(buildEtssUrl(WRIGHTSVILLE_ETSS_CONFIG.stationCode).includes('stn=ncwrit'));
  assert.ok(buildEtssUrl(WILMINGTON_RIVER_ETSS_CONFIG.stationCode).includes('stn=ncwilm'));
});

test('multi-regime registry covers Carolina Beach, Beaufort, Garden City, New Bern, Wilmington, Charleston, and Savannah', () => {
  const expectedIds = [
    'carolina-beach',
    'beaufort-nc',
    'garden-city-sc',
    'new-bern-nc',
    'wilmington-nc',
    'charleston-sc',
    'savannah-ga',
  ];
  for (const id of expectedIds) {
    const spec = MULTI_REGION_BASIN_SPECS[id];
    assert.ok(spec, `Missing basin spec for ${id}`);
    assert.equal(spec.locationId, id);
    assert.ok(spec.harmonics.maxClampFt > 0);
  }
  assert.equal(MULTI_REGION_BASIN_SPECS['new-bern-nc'].regime, 'wind-lagoon');
  assert.equal(MULTI_REGION_BASIN_SPECS['wilmington-nc'].regime, 'compound-river-estuary');
  assert.equal(MULTI_REGION_BASIN_SPECS['charleston-sc'].regime, 'compound-river-estuary');
  assert.equal(MULTI_REGION_BASIN_SPECS['savannah-ga'].regime, 'compound-river-estuary');
});

test('directional N/NE wind setup + Cape Fear River head + lossless 5-driver attribution & anchor continuity', () => {
  const issuedAt = new Date('2026-10-29T12:00:00Z');

  // 48h realistic Carolina Beach residual history with M2 + M4 shallow-water harmonics
  const recentResidual = [];
  for (let i = 0; i <= 96; i++) {
    const tMs = issuedAt.getTime() - (96 - i) * 30 * 60_000;
    const h = (tMs - issuedAt.getTime()) / 3600_000;
    const v = 0.75 + 0.34 * Math.cos((2 * Math.PI * h) / 12.4206) + 0.08 * Math.sin((2 * Math.PI * h) / 6.2103);
    recentResidual.push({ t: new Date(tMs), v });
  }

  // 7 days (168h) of future tide covering Regime A (0-102h ETSS) and Regime B (Days 5-7 extended wind/river)
  const tide = [];
  for (let h = 0; h <= 168; h++) {
    const tMs = issuedAt.getTime() + h * 3600_000;
    tide.push({ t: new Date(tMs), v: 3.1 + 2.2 * Math.cos((2 * Math.PI * h) / 12.4206) });
  }

  // Ocean ETSS (0..96h) holding steady at +0.70 ft
  const oceanEtss = [];
  // River ETSS (0..96h) rising to +1.50 ft (+0.80 ft river hydraulic head gradient across Snow's Cut!)
  const riverEtss = [];
  for (let h = -6; h <= 96; h++) {
    const tMs = issuedAt.getTime() + h * 3600_000;
    oceanEtss.push({ t: new Date(tMs), v: 0.70 });
    riverEtss.push({ t: new Date(tMs), v: h <= 0 ? 0.70 : 0.70 + Math.min(0.80, h * 0.025) });
  }

  // High Cape Fear River discharge at Lock #1 (21,500 cfs -> 20,000 cfs excess above 1,500 baseflow)
  const usgsDischargeCfs = [];
  for (let h = -36; h <= 0; h++) {
    usgsDischargeCfs.push({
      t: new Date(issuedAt.getTime() + h * 3600_000),
      v: h < -12 ? 1500 : 21_500,
    });
  }

  // Scenario 1: Strong 24 mph NNE wind (25 deg) + rainfall vs Scenario 2: 24 mph SSW wind (205 deg)
  const buildWeather = (futureDirDeg, futurePrecipIn) => {
    const w = [];
    for (let h = -12; h <= 168; h++) {
      w.push({
        t: new Date(issuedAt.getTime() + h * 3600_000),
        windSpeedMph: h <= 0 ? 6 : 24,
        windDirectionDeg: h <= 0 ? 115 : futureDirDeg,
        pressureHpa: h <= 0 ? 1016 : 1006,
        precipIn: h >= 18 && h <= 24 ? futurePrecipIn : 0,
      });
    }
    return w;
  };

  const nneForecast = synthesizeOperationalForecast({
    spec: CAROLINA_BEACH_BASIN_SPEC,
    issuedAt,
    recentResidual,
    tide,
    oceanEtss,
    riverEtss,
    usgsDischargeCfs,
    weather: buildWeather(25, 0.25), // 25 deg NNE + 1.5 in/6h rain burst around +24h
  });

  const sswForecast = synthesizeOperationalForecast({
    spec: CAROLINA_BEACH_BASIN_SPEC,
    issuedAt,
    recentResidual,
    tide,
    oceanEtss,
    riverEtss,
    usgsDischargeCfs: [{ t: issuedAt, v: 1500 }],
    weather: buildWeather(205, 0), // 205 deg SSW, baseflow, dry
  });

  assert.equal(nneForecast.length, 169);
  assert.equal(sswForecast.length, 169);

  // 1. Exact anchor continuity at t = issuedAt (h = 0)
  const anchorObs = recentResidual[recentResidual.length - 1].v;
  assert.ok(
    Math.abs(nneForecast[0].residualFt - anchorObs) < 0.005,
    `t=0 residual (${nneForecast[0].residualFt}) must match observed anchor (${anchorObs.toFixed(3)})`
  );

  // 2. Lossless 5-driver partition on every single point across all 169 hours
  for (const pt of nneForecast) {
    const d = pt.drivers;
    const sumDrivers =
      Math.round((d.oceanSurgeFt + d.windSetupFt + d.riverFlowFt + d.rainfallRunoffFt + d.estuarineHarmonicFt) * 1000) /
      1000;
    assert.equal(sumDrivers, pt.residualFt, `Drivers must sum losslessly to residualFt at ${pt.t}`);
    assert.equal(Math.round((pt.tideFt + pt.residualFt) * 1000) / 1000, pt.totalFt);
    assert.ok(pt.upperFt > pt.lowerFt);
  }

  // 3. At +24h (Regime A: ETSS + Basin Physics), NNE wind + Cape Fear River head + Rain > SSW wind
  const nne24 = nneForecast[24];
  const ssw24 = sswForecast[24];
  assert.ok(nne24.drivers.windSetupFt > 0.05, `Expected positive NNE windSetupFt, got ${nne24.drivers.windSetupFt}`);
  assert.ok(ssw24.drivers.windSetupFt < -0.05, `Expected negative SSW windSetupFt, got ${ssw24.drivers.windSetupFt}`);
  assert.ok(nne24.drivers.riverFlowFt > 0.15, `Expected positive Cape Fear riverFlowFt, got ${nne24.drivers.riverFlowFt}`);
  assert.ok(nne24.drivers.rainfallRunoffFt > 0.08, `Expected positive rainfallRunoffFt, got ${nne24.drivers.rainfallRunoffFt}`);
  assert.ok(nne24.totalFt > ssw24.totalFt + 0.30, 'NNE + River + Rain totalFt must exceed SSW dry baseline by >0.30 ft');

  // 4. At +120h (Day 5, Regime B beyond 102h ETSS), NNE wind + low pressure produces substantial setup over SSW
  const nne120 = nneForecast[120];
  const ssw120 = sswForecast[120];
  assert.ok(
    nne120.totalFt > ssw120.totalFt + 0.80,
    `Day 5 NNE storm setup (${nne120.totalFt}) must exceed SSW blow-out (${ssw120.totalFt}) by >0.80 ft`
  );
});

test('rolling-origin backtest proves Basin Physics (N/NE Wind + River Head + M4) beats raw Ocean ETSS and flat persistence', () => {
  // Construct 14 days of synthetic compound back-barrier lagoon observations with realistic physics:
  // Carolina Beach residual = 0.76 * OceanSurge + 0.24 * RiverSurge + 0.09 * tau_NNE + M2 + M4 + noise
  const startMs = Date.parse('2026-10-01T00:00:00Z');
  const totalHours = 14 * 24;
  const oceanSeries = [];
  const riverSeries = [];
  const weatherSeries = [];
  const tideSeries = [];
  const cbObservedResidual = [];

  for (let h = 0; h <= totalHours; h++) {
    const tMs = startMs + h * 3600_000;
    // Two multi-day N/NE coastal wind + Cape Fear river pulse episodes (Days 4-6 and Days 10-12)
    const isNneEvent = (h >= 84 && h <= 144) || (h >= 228 && h <= 288);
    const windSpd = isNneEvent ? 22 : 11;
    const windDir = isNneEvent ? 28 : 210; // NNE 28 deg vs SSW 210 deg
    const press = isNneEvent ? 1007 : 1018;
    const oceanS = 0.55 + (isNneEvent ? 0.45 : -0.10) + 0.08 * Math.sin(h / 18);
    // River surge rises higher and lingers longer after the NNE/rain pulse
    const isRiverPulse = (h >= 90 && h <= 168) || (h >= 234 && h <= 312);
    const riverS = oceanS + (isRiverPulse ? 0.75 : 0.05);

    const tauNne = directionalWindStress(windSpd, windDir, 25);
    const m2 = -0.35 * Math.cos((2 * Math.PI * h) / 12.4206);
    const m4 = 0.09 * Math.sin((2 * Math.PI * h) / 6.2103);
    const noise = 0.02 * Math.sin(h * 1.9);

    const trueResidual = 0.76 * oceanS + 0.24 * riverS + 0.08 * tauNne + m2 + m4 + noise;

    oceanSeries.push({ t: new Date(tMs), v: oceanS });
    riverSeries.push({ t: new Date(tMs), v: riverS });
    weatherSeries.push({
      t: new Date(tMs),
      windSpeedMph: windSpd,
      windDirectionDeg: windDir,
      pressureHpa: press,
      precipIn: isNneEvent ? 0.06 : 0,
    });
    tideSeries.push({ t: new Date(tMs), v: 3.0 + 2.1 * Math.cos((2 * Math.PI * h) / 12.4206) });
    cbObservedResidual.push({ t: new Date(tMs), v: trueResidual });
  }

  const persistenceErr24 = [];
  const rawOceanEtssErr24 = [];
  const basinPhysicsErr24 = [];

  for (let origH = 60; origH <= totalHours - 36; origH += 6) {
    const originT = cbObservedResidual[origH].t;
    const pastResidual = cbObservedResidual.slice(origH - 54, origH + 1);
    const futureTide = [tideSeries[origH], tideSeries[origH + 24]];
    const targetActual = cbObservedResidual[origH + 24].v;

    // 1. Flat persistence
    persistenceErr24.push(Math.abs(targetActual - cbObservedResidual[origH].v));

    // 2. Raw Ocean ETSS only (no river head, no N/NE wind stress, no M4)
    const rawOceanOnly = synthesizeOperationalForecast({
      spec: {
        ...CAROLINA_BEACH_BASIN_SPEC,
        localAxialWindWeightFt: 0,
        riverHeadCouplingWeight: 0,
        rainfallRunoffWeightFtPerInch6h: 0,
        harmonics: { lookbackHours: 48, includeM4: false, maxClampFt: 1.5 },
      },
      issuedAt: originT,
      recentResidual: pastResidual,
      tide: futureTide,
      oceanEtss: oceanSeries.slice(origH - 6, origH + 36),
    });
    rawOceanEtssErr24.push(Math.abs(targetActual - rawOceanOnly[1].residualFt));

    // 3. Full Basin Physics (Ocean ETSS + Cape Fear River ETSS + N/NE Wind Stress + Rain + M4)
    const fullBasin = synthesizeOperationalForecast({
      spec: CAROLINA_BEACH_BASIN_SPEC,
      issuedAt: originT,
      recentResidual: pastResidual,
      tide: futureTide,
      oceanEtss: oceanSeries.slice(origH - 6, origH + 36),
      riverEtss: riverSeries.slice(origH - 6, origH + 36),
      weather: weatherSeries.slice(origH - 12, origH + 36),
    });
    basinPhysicsErr24.push(Math.abs(targetActual - fullBasin[1].residualFt));
  }

  const mae = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const maePersist = mae(persistenceErr24);
  const maeRawOcean = mae(rawOceanEtssErr24);
  const maeBasin = mae(basinPhysicsErr24);

  assert.ok(maeRawOcean < maePersist, `Raw Ocean ETSS (${maeRawOcean.toFixed(3)}) should beat persistence (${maePersist.toFixed(3)})`);
  assert.ok(
    maeBasin < maeRawOcean * 0.75,
    `Full Basin Physics MAE (${maeBasin.toFixed(3)}) must beat raw Ocean ETSS MAE (${maeRawOcean.toFixed(3)}) by >25%`
  );
});

test('MULTI_REGION_BASIN_SPECS supports short city identifiers and protects against 99.90 sentinels', () => {
  const { MULTI_REGION_BASIN_SPECS, smoothSubtidalSeries, synthesizeOperationalForecast } = require('../lib/forecast/basinPhysics');
  
  // Verify aliases
  assert.ok(MULTI_REGION_BASIN_SPECS['beaufort'], 'beaufort alias exists');
  assert.ok(MULTI_REGION_BASIN_SPECS['garden-city'], 'garden-city alias exists');
  assert.ok(MULTI_REGION_BASIN_SPECS['wilmington'], 'wilmington alias exists');
  assert.ok(MULTI_REGION_BASIN_SPECS['new-bern'], 'new-bern alias exists');
  assert.ok(MULTI_REGION_BASIN_SPECS['charleston'], 'charleston alias exists');
  assert.ok(MULTI_REGION_BASIN_SPECS['savannah'], 'savannah alias exists');

  // Verify smoothSubtidalSeries rejects 99.90
  const dirtyEtss = [
    { t: '2026-11-02T22:00:00Z', v: 0.9 },
    { t: '2026-11-02T23:00:00Z', v: 0.8 },
    { t: '2026-11-03T00:00:00Z', v: 99.90 },
    { t: '2026-11-03T01:00:00Z', v: 99.90 },
    { t: '2026-11-03T02:00:00Z', v: 0.7 },
  ];
  const smoothed = smoothSubtidalSeries(dirtyEtss);
  for (const s of smoothed) {
    assert.ok(s.v < 5, `Smoothed surge ${s.v} should be < 5`);
  }

  // Verify synthesizeOperationalForecast clamps any rogue surge within [-5, 15] ft and total water level within [-2, 22] ft
  const origin = new Date('2026-11-02T22:00:00Z');
  const past = Array.from({ length: 48 }, (_, i) => ({
    t: new Date(origin.getTime() - (48 - i) * 3600_000).toISOString(),
    v: 0.5,
  }));
  const futureTide = [
    { t: new Date(origin.getTime() + 3600_000).toISOString(), v: 4.0 },
    { t: new Date(origin.getTime() + 7200_000).toISOString(), v: 4.2 },
  ];
  const result = synthesizeOperationalForecast({
    spec: MULTI_REGION_BASIN_SPECS['beaufort'],
    issuedAt: origin,
    recentResidual: past,
    tide: futureTide,
    oceanEtss: [{ t: origin, v: 99.90 }], // rogue input
  });
  assert.ok(result.length > 0);
  for (const p of result) {
    assert.ok(p.residualFt >= -5 && p.residualFt <= 15, `residualFt ${p.residualFt} within bounds`);
    assert.ok(p.totalFt >= -2 && p.totalFt <= 22, `totalFt ${p.totalFt} within bounds`);
  }
});


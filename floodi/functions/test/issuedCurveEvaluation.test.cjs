const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  prepareIssuedCurveReplay, evaluateIssuedCurvePairs, evaluateIssuedFloodWindow,
  summarizeIssuedCurves, issuedCurveCohort, parseIssuedCurveArgs,
} = require('../lib/scripts/evaluate_issued_curve');
const { GAUGE_FORECAST_MODEL_VERSION } = require('../lib/forecast/gaugePipeline');
const { WEATHER_RESPONSE_FEATURES } = require('../lib/forecast/weatherResponse');
const { FORECAST_REFERENCE_VERSION } = require('../lib/forecast/publication');

const HOUR = 3_600_000;
const start = Date.parse('2026-10-23T00:00:00.000Z');
const iso = hours => new Date(start + hours * HOUR).toISOString();
const at = hours => new Date(start + hours * HOUR);
const series = (startHour, endHour, step, fn) => Array.from({ length: Math.round((endHour - startHour) / step) + 1 }, (_, index) => ({ t: at(startHour + index * step), v: fn(startHour + index * step) }));
const serial = rows => rows.map(row => ({ ...row, t: row.t.toISOString() }));
const ref = { station: '30046', tideStation: '8658163', datum: 'MLLW', units: 'ft', offsetFt: 2.75, phaseMinutes: 60, thresholdFt: 5.6 };
function document(level = () => 5) {
  const metrics = { samples: 100, maeFt: .1, peakMaeFt: null, onsetMaeMinutes: null, durationMaeMinutes: null, hits: null, misses: null, falseAlarms: null, matchedEvents: null };
  return {
    version: 1, status: 'available', method: 'weather-response', confidence: 'limited', validationStage: 'historical-hindcast',
    generatedAt: iso(-.1), expiresAt: iso(1), observationAt: iso(-.5),
    locationId: 'carolina-beach', sensor: '30046', tideStation: '8658163', datum: 'MLLW', units: 'ft', phaseMinutes: 60, thresholdFt: 5.6,
    currentResidualFt: 1, trend: 'stable',
    points: series(-.1, 72, .1, level).map(point => ({ t: point.t.toISOString(), tideFt: 4, totalFt: point.v, residualFt: point.v - 4, lowerFt: point.v - .4, upperFt: point.v + .4 })),
    validation: { kind: 'chronological-weather-response-hindcast', trainEnd: iso(-101), testStart: iso(-100), testEnd: iso(-2), trainingSamples: 300, error90Ft: .3, model: metrics, tideOnly: metrics, persistence: metrics, limitation: 'Fixture' }, evidence: [{ id: 'availability', text: 'Fixture available' }], explanation: { headline: 'Flood outlook', evidenceIds: ['availability'] }, explanationSource: 'fallback', sources: [], limitations: [],
  };
}
function fixture() {
  const generatedAt = iso(-.1), createdAt = iso(-1);
  const n = WEATHER_RESPONSE_FEATURES.length;
  const regression = { intercept: 0, means: Array(n).fill(0), scales: Array(n).fill(1), coefficients: Array(n).fill(0), minimums: Array(n).fill(-100), maximums: Array(n).fill(100) };
  const leads = [1, 3, 6, 12, 24].map(leadHours => ({ leadHours, trainingPairs: 300, testPairs: 200, modelMaeFt: .1, persistenceMaeFt: .3, improvement: 2 / 3, absoluteError90Ft: .3, passes: true }));
  const cache = { version: 'gauge-weather-response-v6', createdAt, trainingPath: 'forecast-training/carolina-beach/frozen.json', reference: { ...ref }, model: {
    reference: { station: ref.station, datum: ref.datum, units: ref.units }, tideReference: { station: ref.station, datum: ref.datum, units: ref.units },
    trainedUntil: iso(-2), holdoutStarts: iso(-100), testStart: iso(-100), testEnd: iso(-2), maxObservationGapMs: 30 * 60_000 + 10_000,
    regressions: leads.map(lead => ({ leadHours: lead.leadHours, model: structuredClone(regression) })),
    validation: { leads, peakWindows: 0, peakMaeFt: null, persistencePeakMaeFt: null, eligible: false, pointEligible: true, weatherInput: 'reanalysis hindcast' }, limitations: [],
  } };
  return { value: { origin: iso(0), publication: { publishedAt: iso(-.09), referenceVersion: FORECAST_REFERENCE_VERSION, codeVersion: 'old-shape' }, forecast: document(), input: { version: 1, issuedAt: generatedAt, reference: { ...ref }, modelCreatedAt: createdAt, recentResidual: serial(series(-72.5, -.5, .5, () => 1)), tide: serial(series(-73, 73, .1, () => 4)), weather: [], sources: { weatherRetrievedAt: generatedAt } } }, caches: { [createdAt]: cache } };
}

test('replay keeps frozen delayed observations and coefficients without fitting or using future truth', () => {
  const { value, caches } = fixture();
  const before = JSON.stringify({ value, caches });
  let captured;
  const result = prepareIssuedCurveReplay(value, caches, at(100), (...args) => { captured = args; return document(() => 5.1); });
  assert.equal(result.exclusion, null);
  assert.equal(result.replay.originalModelVersion, 'gauge-weather-response-v6');
  assert.equal(captured[0].at(-1).t.toISOString(), value.forecast.observationAt);
  assert.equal(captured[0].at(-1).v, 1);
  assert.equal(captured[5].toISOString(), value.forecast.generatedAt);
  assert.deepEqual(captured[6].model.regressions, caches[iso(-1)].model.regressions);
  assert.equal(captured[6].includeDrivers, false);
  assert.equal(JSON.stringify({ value, caches }), before);
  assert.ok(GAUGE_FORECAST_MODEL_VERSION.startsWith('gauge-weather-response-'));
});

test('replay rejects future histories, publication timing, mismatched datums, stale and missing models', () => {
  const cases = [
    ['invalid-or-future-history', f => f.value.input.recentResidual.push({ t: iso(.1), v: 99 })],
    ['estimated-history', f => { f.value.input.recentResidual[0].estimated = true; }],
    ['invalid-publication-timing', f => { f.value.publication.publishedAt = iso(.1); }],
    ['incompatible-input-reference', f => { f.value.input.reference.datum = 'NAVD88'; }],
    ['incompatible-reference', f => { f.value.publication.referenceVersion = 'other-reference'; }],
    ['observation-anchor-mismatch', f => { f.value.forecast.observationAt = iso(-1); }],
    ['missing-or-unsupported-frozen-model', f => { f.value.input.modelCreatedAt = iso(-5); }],
    ['invalid-frozen-model', f => { f.caches[iso(-1)].createdAt = iso(-100); f.value.input.modelCreatedAt = iso(-100); f.caches[iso(-100)] = f.caches[iso(-1)]; }],
    ['issue-expired', f => { f.value.forecast.expiresAt = iso(-.01); }],
    ['future-weather-retrieval', f => { f.value.input.sources.weatherRetrievedAt = iso(.1); }],
  ];
  for (const [reason, mutate] of cases) {
    const f = fixture(); mutate(f);
    const result = prepareIssuedCurveReplay(f.value, f.caches, at(100), () => { throw new Error('must not build rejected issue'); });
    assert.equal(result.exclusion, reason);
  }
});

test('legacy creation-time availability permits missing markers only with compatible frozen physical inputs', () => {
  const f = fixture();
  f.value.publication.referenceVersion = null;
  f.value.publication.publicationBasis = 'legacy-create-time';
  assert.equal(prepareIssuedCurveReplay(f.value, f.caches, at(100), () => document()).exclusion, null);
  f.value.input.reference.offsetFt = 99;
  assert.equal(prepareIssuedCurveReplay(f.value, f.caches, at(100), () => document()).exclusion, 'incompatible-input-reference');
  const atomic = fixture();
  atomic.value.publication.referenceVersion = null;
  atomic.value.publication.publicationBasis = 'atomic-publication';
  assert.equal(prepareIssuedCurveReplay(atomic.value, atomic.caches, at(100), () => document()).exclusion, 'incompatible-reference');
});

test('dense and lead errors compare identical support and ignore unmatured outcomes', () => {
  const f = fixture();
  const replay = prepareIssuedCurveReplay(f.value, f.caches, at(100), () => document(() => 5.2)).replay;
  const observations = series(-1, 80, .5, () => 5.2);
  const scored = evaluateIssuedCurvePairs(replay, observations, at(3));
  assert.equal(scored.denseTargets.length, 6);
  assert.deepEqual(scored.leads.map(row => row.leadHours), [1, 3]);
  assert.equal(scored.event, null);
  assert.equal(scored.eventWindows.length, 0);
  for (const row of scored.denseTargets) { assert.ok(Math.abs(row.archivedErrorFt + .2) < 1e-8); assert.ok(Math.abs(row.candidateErrorFt) < 1e-8); }
  const gap = observations.filter(point => +point.t !== +at(1));
  const unsupported = evaluateIssuedCurvePairs(replay, gap, at(3));
  assert.equal(unsupported.leads.some(row => row.leadHours === 1), false);
});

test('native flood scoring retains misses and false events instead of relying on endpoint MAE', () => {
  const pulse = center => hours => 5 + Math.max(0, 1 - Math.abs(hours - center) / 2);
  const actual = series(-1, 25, .5, pulse(6));
  const missed = evaluateIssuedFloodWindow(at(0), actual, series(0, 24, .1, () => 5));
  assert.equal(missed.status, 'scored');
  assert.equal(missed.observedNewIds.length, 1);
  assert.equal(missed.missedIds.length, 1);
  const shifted = evaluateIssuedFloodWindow(at(0), actual, series(0, 24, .1, pulse(12)));
  assert.equal(shifted.missedIds.length, 1);
  assert.equal(shifted.unmatchedPredictedIds.length, 1);
  const caught = evaluateIssuedFloodWindow(at(0), actual, series(0, 24, .1, pulse(6)));
  assert.equal(caught.missedIds.length, 0);
  assert.equal(caught.matches.length, 1);
  assert.ok(Math.abs(caught.matches[0].peakErrorFt) < 1e-8);
  assert.ok(Math.abs(caught.matches[0].onsetErrorMinutes) < 1e-8);
  const gap = actual.filter(point => +point.t !== +at(4));
  assert.equal(evaluateIssuedFloodWindow(at(0), gap, series(0, 24, .1, pulse(6))).status, 'excluded');
  assert.equal(evaluateIssuedFloodWindow(at(0), actual, series(0, 24, .1, pulse(6)), 5.6, 12).status, 'scored');
  assert.equal(evaluateIssuedFloodWindow(at(0), actual, series(0, 24, .1, pulse(6)), 5.6, 6).status, 'scored');
  assert.throws(() => evaluateIssuedFloodWindow(at(0), actual, series(0, 24, .1, pulse(6)), 5.6, 1));
});

test('complete native residual windows report peak and valley errors rather than only total-water endpoints', () => {
  const wave = hours => 5 + Math.sin(hours * 2 * Math.PI / 12);
  const f = fixture();
  const replay = prepareIssuedCurveReplay(f.value, f.caches, at(100), () => document(wave)).replay;
  const result = evaluateIssuedCurvePairs(replay, series(-1, 80, .5, wave), at(100));
  assert.ok(result.residualShape24h);
  assert.ok(Math.abs(result.residualShape24h.archived.peakErrorFt + 1) < 1e-8);
  assert.ok(Math.abs(result.residualShape24h.archived.valleyErrorFt - 1) < 1e-8);
  assert.ok(Math.abs(result.residualShape24h.candidate.peakErrorFt) < 1e-8);
  assert.ok(Math.abs(result.residualShape24h.candidate.valleyErrorFt) < 1e-8);
});

test('fixed cohort labels and summaries retain differing sample counts without marketing accuracy', () => {
  assert.equal(issuedCurveCohort('2026-10-20T00:00:00Z'), 'development');
  assert.equal(issuedCurveCohort('2026-10-22T00:00:00Z'), 'selection');
  assert.equal(issuedCurveCohort(iso(0)), 'final-test');
  const f = fixture(), replay = prepareIssuedCurveReplay(f.value, f.caches, at(100), () => document()).replay;
  const rows = evaluateIssuedCurvePairs(replay, series(-1, 80, .5, () => 5), at(100));
  const summary = summarizeIssuedCurves([rows]).find(group => group.cohort === 'final-test');
  assert.equal(summary.origins, 1);
  assert.equal(summary.denseBands[0].samples, 6);
  assert.equal(summary.fixedMidnight24hWindows[0].commonWindows, 1);
  assert.equal(summary.fixedMidnight24hWindows[0].uniqueObservedNewEvents, 0);
  assert.throws(() => parseIssuedCurveArgs(['--input', '/tmp/archive', '--out', '/tmp/out.json', '--as-of', 'bad']));
  assert.equal(parseIssuedCurveArgs(['--input', '/tmp/archive', '--out', '/tmp/out.json', '--as-of', iso(100)]).asOf.toISOString(), iso(100));
});

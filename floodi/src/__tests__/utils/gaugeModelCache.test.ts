import { historicalOutlookFixture } from '../fixtures/historicalOutlook';
import { describe, expect, it } from 'vitest';
import { explanationIsDue, restoreGaugeModel, serializeGaugeModel } from '../../../functions/src/forecast/gaugePipeline';
import { LONG_RANGE_FEATURES, LONG_RANGE_LEADS, WEATHER_RESPONSE_FEATURES, WEATHER_RESPONSE_LEADS, WeatherResponseModel } from '../../../functions/src/forecast/weatherResponse';

const HOUR = 3600_000;
const now = new Date('2026-10-10T12:00:00Z');
const reference = { station: '30046', datum: 'MLLW', units: 'ft' };
const model = (): WeatherResponseModel => ({
  reference, tideReference: reference, maxObservationGapMs: 30 * 60_000 + 10_000,
  trainedUntil: new Date(+now - 7 * 24 * HOUR), holdoutStarts: new Date(+now - 30 * 24 * HOUR),
  testStart: new Date(+now - 30 * 24 * HOUR), testEnd: new Date(+now - 7 * 24 * HOUR),
  regressions: WEATHER_RESPONSE_LEADS.map(leadHours => ({ leadHours, model: {
    means: WEATHER_RESPONSE_FEATURES.map(() => 0), scales: WEATHER_RESPONSE_FEATURES.map(() => 1), coefficients: WEATHER_RESPONSE_FEATURES.map(() => .1), intercept: .05,
    minimums: WEATHER_RESPONSE_FEATURES.map(() => -5), maximums: WEATHER_RESPONSE_FEATURES.map(() => 5),
  } })),
  validation: {
    leads: WEATHER_RESPONSE_LEADS.map(leadHours => ({ leadHours, trainingPairs: 300, testPairs: 120, modelMaeFt: .15, persistenceMaeFt: .25, improvement: .4, absoluteError90Ft: .4, passes: true })),
    peakWindows: 8, peakMaeFt: .15, persistencePeakMaeFt: .2, eligible: true, pointEligible: true, weatherInput: 'reanalysis hindcast',
  }, limitations: ['Issued weather and flood timing errors remain unvalidated.'],
});
const cache = () => JSON.parse(JSON.stringify(serializeGaugeModel(model(), now, 'forecast-training/carolina-beach/2026-10-10/history.json')));
const shortRangeCache = () => {
  const value = model();
  value.shortRange = {
    regressions: value.regressions.slice(0, 3), leads: value.validation.leads.slice(0, 3),
    eligible: true, peakWindows: 12, peakMaeFt: .14, persistencePeakMaeFt: .22,
  };
  return JSON.parse(JSON.stringify(serializeGaugeModel(value, now, 'forecast-training/carolina-beach/2026-10-10/history.json')));
};

const longRangeCache = () => {
  const value = model();
  value.longRange = {
    peakByDay: [],
    regressions: LONG_RANGE_LEADS.map(leadHours => ({ leadHours, model: {
      means: LONG_RANGE_FEATURES.map(() => 0), scales: LONG_RANGE_FEATURES.map(() => 1), coefficients: LONG_RANGE_FEATURES.map(() => .1), intercept: .05,
      minimums: LONG_RANGE_FEATURES.map(() => -5), maximums: LONG_RANGE_FEATURES.map(() => 5),
    } })),
    leads: LONG_RANGE_LEADS.map(leadHours => ({ leadHours, trainingPairs: 300, testPairs: 120, modelMaeFt: .15, persistenceMaeFt: .25, improvement: .4, absoluteError90Ft: .6, passes: true })),
    eligible: true, peakWindows: 12, peakMaeFt: .14, persistencePeakMaeFt: .22,
  };
  return JSON.parse(JSON.stringify(serializeGaugeModel(value, now, 'forecast-training/carolina-beach/2026-10-10/history.json')));
};

const baselineBridgeCache = () => {
  const value = longRangeCache();
  value.model.longRange.leads.forEach((lead: { leadHours: number; method: string; modelMaeFt: number; persistenceMaeFt: number; improvement: number; passes: boolean }, i: number) => {
    if (i < 2) { lead.method = 'steady-residual'; lead.modelMaeFt = lead.persistenceMaeFt; lead.improvement = 0; lead.passes = false; value.model.longRange.regressions[i].model.intercept = 0; value.model.longRange.regressions[i].model.coefficients.fill(0); }
    else lead.method = 'residual-reversion';
    value.model.longRange.regressions[i].method = lead.method;
  });
  value.model.longRange.prefixValidation = {
    'residual-response': { peakWindows: 20, peakMaeFt: .22, persistencePeakMaeFt: .3, eligible: true },
    'weather-response': { peakWindows: 20, peakMaeFt: .34, persistencePeakMaeFt: .3, eligible: false },
  };
  return value;
};

describe('daily gauge model cache', () => {
  it('rejects old linear-curve validation rather than reusing its peak gates', () => {
    const previous = cache();
    previous.version = 'gauge-weather-response-v6';
    expect(restoreGaugeModel(previous, now)).toBeNull();
  });
  it('round-trips ridge vectors, validation and original UTC dates', () => {
    const restored = restoreGaugeModel(cache(), now);
    expect(restored).toEqual(model());
    expect(restored!.trainedUntil).toBeInstanceOf(Date);
  });
  it.each(['version', 'age', 'future-cache', 'station', 'datum', 'phase', 'offset', 'units', 'path', 'future-fit', 'old-fit', 'reversed-test', 'vectors', 'zero-scale', 'no-domain', 'reversed-domain', 'wrong-lead', 'fake-point-gate', 'fake-peak-gate', 'no-model'] as const)('rejects an incompatible or malformed cache: %s', failure => {
    const value = cache();
    if (failure === 'version') value.version = 'old';
    if (failure === 'age') value.createdAt = new Date(+now - 73 * HOUR).toISOString();
    if (failure === 'future-cache') value.createdAt = new Date(+now + HOUR).toISOString();
    if (failure === 'station') value.model.reference.station = 'SUNNYD_CB_03';
    if (failure === 'datum') value.model.tideReference.datum = 'NAVD88';
    if (failure === 'phase') value.reference.phaseMinutes = 0;
    if (failure === 'offset') value.reference.offsetFt = 0;
    if (failure === 'units') value.model.reference.units = 'm';
    if (failure === 'path') value.trainingPath = 'unrelated/history.json';
    if (failure === 'future-fit') value.model.trainedUntil = new Date(+now + HOUR).toISOString();
    if (failure === 'old-fit') value.model.trainedUntil = new Date(+now - 15 * 24 * HOUR).toISOString();
    if (failure === 'reversed-test') value.model.testEnd = new Date(+now - 40 * 24 * HOUR).toISOString();
    if (failure === 'vectors') value.model.regressions[0].model.coefficients.pop();
    if (failure === 'zero-scale') value.model.regressions[0].model.scales[0] = 0;
    if (failure === 'no-domain') delete value.model.regressions[0].model.minimums;
    if (failure === 'reversed-domain') value.model.regressions[0].model.minimums[0] = 10;
    if (failure === 'wrong-lead') value.model.regressions[0].leadHours = 2;
    if (failure === 'fake-point-gate') value.model.validation.leads[0].modelMaeFt = 1;
    if (failure === 'fake-peak-gate') value.model.validation.peakWindows = 0;
    if (failure === 'no-model') value.model = null;
    expect(restoreGaugeModel(value, now)).toBeNull();
  });
  it('rejects an older v3 cache so a v6 model cannot invent missing long-range vectors', () => {
    const value = cache(); value.version = 'gauge-weather-response-v3';
    expect(restoreGaugeModel(value, now)).toBeNull();
  });
  it('rejects v4 caches which predate baseline controls and per-prefix peak validation', () => {
    const value = cache(); value.version = 'gauge-weather-response-v4';
    expect(restoreGaugeModel(value, now)).toBeNull();
  });
  it('rejects an invalid current timestamp', () => {
    expect(restoreGaugeModel(cache(), new Date('invalid'))).toBeNull();
  });
  it('round-trips the optional validated 1/3/6-hour fallback without requiring that it be present in older caches', () => {
    const value = shortRangeCache();
    const restored = restoreGaugeModel(value, now);
    expect(restored!.shortRange).toEqual(value.model.shortRange);
    expect(restoreGaugeModel(cache(), now)!.shortRange).toBeUndefined();
  });
  it('can revive a validated short-range fallback while the longer weather model remains ineligible', () => {
    const value = shortRangeCache();
    value.model.validation.pointEligible = false;
    value.model.validation.eligible = false;
    expect(restoreGaugeModel(value, now)!.shortRange?.eligible).toBe(true);
  });
  it.each(['null', 'missing-regression', 'wrong-regression-lead', 'short-vector', 'nonfinite-coefficient', 'zero-scale', 'missing-domain', 'reversed-domain', 'missing-validation-lead', 'wrong-validation-lead', 'poor-point-error', 'insufficient-pairs', 'failed-point-gate', 'insufficient-peaks', 'missing-peak-error', 'worse-peak-error'] as const)('rejects a malformed or falsely eligible short-range cache: %s', failure => {
    const value = shortRangeCache();
    const short = value.model.shortRange;
    if (failure === 'null') value.model.shortRange = null;
    if (failure === 'missing-regression') short.regressions.pop();
    if (failure === 'wrong-regression-lead') short.regressions[2].leadHours = 12;
    if (failure === 'short-vector') short.regressions[0].model.coefficients.pop();
    if (failure === 'nonfinite-coefficient') short.regressions[0].model.coefficients[0] = NaN;
    if (failure === 'zero-scale') short.regressions[0].model.scales[0] = 0;
    if (failure === 'missing-domain') delete short.regressions[0].model.minimums;
    if (failure === 'reversed-domain') short.regressions[0].model.minimums[0] = 99;
    if (failure === 'missing-validation-lead') short.leads.pop();
    if (failure === 'wrong-validation-lead') short.leads[2].leadHours = 24;
    if (failure === 'poor-point-error') short.leads[2].modelMaeFt = .26;
    if (failure === 'insufficient-pairs') short.leads[0].testPairs = 99;
    if (failure === 'failed-point-gate') short.leads[1].passes = false;
    if (failure === 'insufficient-peaks') short.peakWindows = 6;
    if (failure === 'missing-peak-error') short.peakMaeFt = null;
    if (failure === 'worse-peak-error') short.peakMaeFt = .23;
    expect(restoreGaugeModel(value, now)).toBeNull();
  });
  it('round-trips the separate eight-feature 12/24/48/72-hour extension', () => {
    const value = longRangeCache();
    const restored = restoreGaugeModel(value, now)!;
    expect(restored.longRange).toEqual(value.model.longRange);
    expect(restored.regressions[0].model.coefficients.length).toBe(WEATHER_RESPONSE_FEATURES.length);
    expect(restored.longRange!.regressions[0].model.coefficients.length).toBe(LONG_RANGE_FEATURES.length);
  });
  it.each(['null', 'missing-regression', 'wrong-regression-lead', 'weather-vector', 'nonfinite-coefficient', 'zero-scale', 'missing-domain', 'reversed-domain', 'missing-validation-lead', 'wrong-validation-lead', 'poor-point-error', 'insufficient-pairs', 'failed-point-gate', 'insufficient-peaks', 'missing-peak-error', 'worse-peak-error'] as const)('rejects a malformed or falsely eligible long-range cache: %s', failure => {
    const value = longRangeCache();
    const long = value.model.longRange;
    if (failure === 'null') value.model.longRange = null;
    if (failure === 'missing-regression') long.regressions.pop();
    if (failure === 'wrong-regression-lead') long.regressions[2].leadHours = 6;
    if (failure === 'weather-vector') long.regressions[0].model.coefficients = WEATHER_RESPONSE_FEATURES.map(() => 0);
    if (failure === 'nonfinite-coefficient') long.regressions[0].model.coefficients[0] = NaN;
    if (failure === 'zero-scale') long.regressions[0].model.scales[0] = 0;
    if (failure === 'missing-domain') delete long.regressions[0].model.minimums;
    if (failure === 'reversed-domain') long.regressions[0].model.minimums[0] = 99;
    if (failure === 'missing-validation-lead') long.leads.pop();
    if (failure === 'wrong-validation-lead') long.leads[2].leadHours = 24;
    if (failure === 'poor-point-error') long.leads[2].modelMaeFt = .26;
    if (failure === 'insufficient-pairs') long.leads[0].testPairs = 99;
    if (failure === 'failed-point-gate') long.leads[1].passes = false;
    if (failure === 'insufficient-peaks') long.peakWindows = 6;
    if (failure === 'missing-peak-error') long.peakMaeFt = null;
    if (failure === 'worse-peak-error') long.peakMaeFt = .23;
    expect(restoreGaugeModel(value, now)).toBeNull();
  });
  it('accepts an explicit steady 12/24-hour bridge and independently validated 48/72-hour model', () => {
    const value = baselineBridgeCache();
    const restored = restoreGaugeModel(value, now)!;
    expect(restored.longRange!.leads.map(lead => lead.method)).toEqual(['steady-residual', 'steady-residual', 'residual-reversion', 'residual-reversion']);
    expect(restored.longRange!.prefixValidation!['residual-response'].eligible).toBe(true);
    expect(restored.longRange!.prefixValidation!['weather-response'].eligible).toBe(false);
  });
  it.each(['learned-bridge-claim', 'bridge-improvement', 'bridge-pass', 'baseline-at-48h', 'bridge-weight', 'missing-prefix', 'missing-prefix-method', 'bad-prefix-count', 'fake-prefix-gate', 'no-eligible-prefix', 'failed-48h', 'failed-72h', 'regression-method-mismatch'] as const)('rejects unsupported baseline or composite validation: %s', failure => {
    const value = baselineBridgeCache(); const long = value.model.longRange;
    if (failure === 'learned-bridge-claim') long.leads[0].modelMaeFt = .2;
    if (failure === 'bridge-improvement') long.leads[0].improvement = .1;
    if (failure === 'bridge-pass') long.leads[0].passes = true;
    if (failure === 'baseline-at-48h') long.leads[2].method = 'steady-residual';
    if (failure === 'bridge-weight') long.regressions[0].model.coefficients[0] = .1;
    if (failure === 'missing-prefix') delete long.prefixValidation;
    if (failure === 'missing-prefix-method') delete long.prefixValidation['weather-response'];
    if (failure === 'bad-prefix-count') long.prefixValidation['residual-response'].peakWindows = -1;
    if (failure === 'fake-prefix-gate') long.prefixValidation['residual-response'].peakMaeFt = .4;
    if (failure === 'no-eligible-prefix') long.prefixValidation['residual-response'].eligible = false;
    if (failure === 'failed-48h') long.leads[2].passes = false;
    if (failure === 'failed-72h') long.leads[3].modelMaeFt = .6;
    if (failure === 'regression-method-mismatch') long.regressions[2].method = 'steady-residual';
    expect(restoreGaugeModel(value, now)).toBeNull();
  });
});

describe('full-horizon historical model cache', () => {
  it('revives a complete validated summary and keeps historical context separate from passed skill', () => {
    const original = model(); original.historicalOutlook = historicalOutlookFixture(true);
    const serialized = serializeGaugeModel(original, now, 'forecast-training/carolina-beach/2026-10-10/history.json');
    expect(restoreGaugeModel(JSON.parse(JSON.stringify(serialized)), now)!.historicalOutlook).toEqual(original.historicalOutlook);
  });
  it.each(['old-v5', 'wrong-station', 'future-fit', 'reversed-dates', 'fractional-count', 'short-vector', 'reversed-domain', 'forged-skill', 'forged-weather', 'weather-missing-weights', 'nonfinite-coefficient'] as const)('rejects malformed full-horizon model data: %s', failure => {
    const original = model(); original.historicalOutlook = historicalOutlookFixture(true);
    const value = JSON.parse(JSON.stringify(serializeGaugeModel(original, now, 'forecast-training/carolina-beach/2026-10-10/history.json')));
    const outlook = value.model.historicalOutlook;
    if (failure === 'old-v5') value.version = 'gauge-weather-response-v5';
    if (failure === 'wrong-station') outlook.reference.station = 'SUNNYD_CB_03';
    if (failure === 'future-fit') outlook.trainedUntil = new Date(+now + HOUR).toISOString();
    if (failure === 'reversed-dates') outlook.trainingStart = '2026-10-04T00:00:00Z';
    if (failure === 'fractional-count') outlook.trainingPairs = 120.5;
    if (failure === 'short-vector') outlook.weather.coefficients.pop();
    if (failure === 'reversed-domain') outlook.historical.maximums[0] = -10;
    if (failure === 'forged-skill') outlook.validation.historicalEligible = true;
    if (failure === 'forged-weather') outlook.validation.leads[4].weatherMaeFt = 99;
    if (failure === 'weather-missing-weights') outlook.weather = null;
    if (failure === 'nonfinite-coefficient') outlook.historical.coefficients[0] = Infinity;
    expect(restoreGaugeModel(value, now)).toBeNull();
  });
});

describe('hourly explanation cadence' , () => {
  it('allows a first attempt and an attempt exactly one hour later', () => {
    expect(explanationIsDue(undefined, now)).toBe(true);
    expect(explanationIsDue(new Date(+now - HOUR).toISOString(), now)).toBe(true);
  });
  it('does not retry before an hour, even when the previous attempt failed', () => {
    expect(explanationIsDue(new Date(+now - 59 * 60_000).toISOString(), now)).toBe(false);
    expect(explanationIsDue(now.toISOString(), now)).toBe(false);
  });
  it('does not generate against a future reservation or invalid current time', () => {
    expect(explanationIsDue(new Date(+now + HOUR).toISOString(), now)).toBe(false);
    expect(explanationIsDue(undefined, new Date('invalid'))).toBe(false);
  });
});

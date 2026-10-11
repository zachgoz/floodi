import { describe, expect, it } from 'vitest';
import { HistoricalOutlookModel, HISTORICAL_OUTLOOK_LEADS, historicalPatternSummary, projectHistoricalOutlook, projectHistoricalResidual, trainHistoricalOutlook, validateHistoricalOutlookModel, validateHistoricalOutlookValidation, validateHistoricalPatternSummary } from '../../../functions/src/forecast/historicalOutlook';

const HOUR = 3600_000;
const issue = new Date('2026-10-03T00:00:00Z');
const at = (hours: number) => new Date(+issue + hours * HOUR);
const ref = { station: '30046', datum: 'MLLW', units: 'ft' };
const regression = (n: number) => ({ intercept: .7, means: Array(n).fill(0), scales: Array(n).fill(1), coefficients: Array.from({ length: n }, (_, i) => i === 0 ? -.1 : i === 1 ? .03 : i === 4 ? .02 : 0), minimums: Array(n).fill(-2000), maximums: Array(n).fill(2000) });
const leads = HISTORICAL_OUTLOOK_LEADS.map(leadHours => ({ leadHours, testPairs: 120, historicalMaeFt: .4, persistenceMaeFt: .3, historicalError90Ft: .8, weatherPairs: 120, weatherMaeFt: .2, weatherHistoricalMaeFt: .4, weatherError90Ft: .5 }));
const model: HistoricalOutlookModel = {
  version: 'historical-weather-v1', reference: ref, tideReference: ref,
  trainingStart: '2026-07-05T00:00:00Z', trainedUntil: '2026-09-06T14:34:00Z', testStart: '2026-09-06T14:35:00Z', testEnd: '2026-10-02T23:36:00Z', trainingPairs: 1000,
  historical: regression(2), weather: regression(10), anomalyDecayHours: 48, transitionHours: 12, maxHistoricalErrorFt: .8,
  validation: { eligible: true, historicalEligible: false, weatherEligible: true, leads, evaluation: 'chronological issue-anchored reanalysis hindcast', limitations: ['Seasonal coverage only'] },
};
const summary = historicalPatternSummary(model);
const tide = Array.from({ length: (72 + 31 * 24) * 4 + 1 }, (_, i) => ({ t: at(-72 + i / 4), v: 3 + 2 * Math.sin((-72 + i / 4) * Math.PI * 2 / 12.42) }));
const prefix = Array.from({ length: 61 }, (_, i) => ({ t: at(i / 10), v: 1.5 + .1 * Math.sin(i / 10) }));
const history = [{ t: at(-.25), v: 1.4 }, { t: issue, v: prefix[0].v }];
const pastWeather = Array.from({ length: 73 }, (_, i) => ({ t: at(i - 72), windSpeed: 10, windDirection: 0, pressure: 1015, precip: .01 }));
const futureWeather = Array.from({ length: 16 * 24 }, (_, i) => ({ t: at(i + 1), windSpeed: 30, windDirection: 0, pressure: 1015, precip: .01 }));

describe('full supplied NOAA historical/weather outlook', () => {
  it('validates JSON caches and explicit failed historical skill without forging a pass', () => {
    expect(validateHistoricalOutlookModel(JSON.parse(JSON.stringify(model)))).toBe(true);
    expect(validateHistoricalPatternSummary(summary)).toBe(true);
    expect(summary.historicalEligible).toBe(false);
    expect(summary.selectedFallback).toBe('historical-baseline');
    expect(validateHistoricalOutlookValidation({ ...model.validation, historicalEligible: true })).toBe(false);
    expect(validateHistoricalOutlookValidation({ ...model.validation, weatherEligible: false })).toBe(false);
    expect(validateHistoricalOutlookValidation({ ...model.validation, leads: leads.map((lead, i) => i ? lead : { ...lead, weatherPairs: 121 }) })).toBe(false);
  });
  it('preserves every supplied prefix value and reaches the exact31day NOAA endpoint', () => {
    const times = [...prefix.map(p => p.t), at(7), at(168), at(336), at(21 * 24), at(31 * 24)];
    const result = projectHistoricalResidual(summary, tide, times, prefix);
    expect(result.points.slice(0, prefix.length)).toEqual(prefix);
    expect(result.points.at(-1)!.t).toEqual(at(31 * 24));
    expect(result.errorFt.at(-1)!).toBeGreaterThan(result.errorFt[prefix.length + 2]);
    const far = result.points.at(-1)!;
    const expected = .7 - .1 * tide.at(-1)!.v + .03 * (tide.at(-1)!.v - tide.find(p => +p.t === +at(31 * 24 - 1))!.v);
    expect(far.v).toBeCloseTo(expected, 5);
  });
  it('returns no unsupported points through a missing astronomical tide interval', () => {
    const missing = tide.filter(point => !(+point.t >= +at(100) && +point.t <= +at(103)));
    const result = projectHistoricalResidual(summary, missing, [at(99), at(101), at(105)], prefix);
    expect(result.points.map(point => +point.t)).toEqual([+at(99), +at(105)]);
    expect(projectHistoricalResidual(summary, tide, [at(10)], [])).toEqual({ points: [], errorFt: [] });
  });
  it('rejects understated error controls, invalid references and inconsistent model chronology', () => {
    expect(validateHistoricalPatternSummary({ ...summary, errorByLead: summary.errorByLead.map((row, i) => i ? row : { ...row, absoluteError90Ft: .1 }) })).toBe(false);
    expect(validateHistoricalPatternSummary({ ...summary, maxHistoricalErrorFt: .1 })).toBe(false);
    expect(validateHistoricalPatternSummary({ ...summary, tideReference: { ...ref, datum: 'NAVD88' } })).toBe(false);
    expect(validateHistoricalOutlookModel({ ...model, historical: { ...model.historical, minimums: [100, 100], maximums: [0, 0] } })).toBe(false);
    expect(validateHistoricalOutlookModel({ ...model, trainedUntil: '2026-07-01T00:00:00Z' })).toBe(false);
    expect(projectHistoricalResidual({ ...summary, trainedUntil: at(1).toISOString() }, tide, [at(24)], prefix).points).toEqual([]);
  });
  it('uses supported sustained forecast wind then returns smoothly to historical conditions', () => {
    const times = [...prefix.map(p => p.t), at(48), at(168), at(384), at(504)];
    const result = projectHistoricalOutlook(model, history, tide, pastWeather, futureWeather, times, issue, ref, ref, { prefix });
    const historical = projectHistoricalOutlook(model, history, tide, pastWeather, [], times, issue, ref, ref, { prefix });
    expect(result.points.slice(0, prefix.length)).toEqual(prefix);
    expect(result.points.find(p => +p.t === +at(48))!.v).toBeGreaterThan(historical.points.find(p => +p.t === +at(48))!.v);
    expect(result.points.find(p => +p.t === +at(384))!.v).toBe(historical.points.find(p => +p.t === +at(384))!.v);
    expect(result.points.at(-1)).toEqual(historical.points.at(-1));
    expect(result.weatherSupportedUntil).toEqual(at(384));
    expect(result.lower.every((p, i) => p.v <= result.points[i].v && result.upper[i].v >= result.points[i].v)).toBe(true);
  });
  it('joins hourly weather corrections continuously to a prefix ending between weather hours', () => {
    const offHourPrefix = prefix.map(point => ({ ...point, t: new Date(+point.t + HOUR / 2) }));
    const times = [at(6.5), at(6.75), at(7)];
    const result = projectHistoricalOutlook(model, history, tide, pastWeather, futureWeather, times, issue, ref, ref, { prefix: offHourPrefix });
    const historical = projectHistoricalOutlook(model, history, tide, pastWeather, [], times, issue, ref, ref, { prefix: offHourPrefix });
    const corrections = result.points.map((point, i) => point.v - historical.points[i].v);
    expect(corrections[0]).toBe(0);
    expect(Math.abs(corrections[2])).toBeGreaterThan(1e-5);
    expect(corrections[1]).toBeCloseTo(corrections[2] / 2, 10);
    expect(result.points[0]).toEqual(offHourPrefix.at(-1));
  });
  it('falls back for out-of-domain/missing weather without inventing missing rainfall', () => {
    const times = [at(72), at(168)];
    const noWeather = projectHistoricalOutlook(model, history, tide, pastWeather, [], times, issue, ref, ref, { prefix });
    const extreme = futureWeather.map(w => ({ ...w, windSpeed: 100000 }));
    expect(projectHistoricalOutlook(model, history, tide, pastWeather, extreme, times, issue, ref, ref, { prefix }).points).toEqual(noWeather.points);
    const missing = futureWeather.map(w => ({ ...w, precip: undefined }));
    expect(projectHistoricalOutlook(model, history, tide, pastWeather, missing, times, issue, ref, ref, { prefix }).points).toEqual(noWeather.points);
    expect(projectHistoricalOutlook(model, history, tide, pastWeather, futureWeather, times, issue, ref, { ...ref, datum: 'NAVD88' }, { prefix }).points).toEqual([]);
  });
  it('excludes estimated/future water from projection and rejects inadequate training', () => {
    const times = [at(48)];
    const expected = projectHistoricalOutlook(model, history, tide, pastWeather, futureWeather, times, issue, ref, ref, { prefix });
    expect(projectHistoricalOutlook(model, [...history, { t: issue, v: 999, estimated: true }, { t: at(1), v: 999 }], tide, pastWeather, futureWeather, times, issue, ref, ref, { prefix }).points).toEqual(expected.points);
    expect(trainHistoricalOutlook(history, tide, pastWeather, ref, ref)).toBeNull();
    expect(trainHistoricalOutlook(history, tide, pastWeather, ref, { ...ref, station: '8658163' })).toBeNull();
  });
});

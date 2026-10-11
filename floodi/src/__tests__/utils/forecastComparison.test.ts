import { describe, expect, it } from 'vitest';
import { alignForecastComparison } from 'src/utils/forecastComparison';
import { buildForecast } from '../../../functions/src/forecast/pipeline';
import { validateForecast } from '../../../functions/src/forecast/schema';

const now = new Date('2026-10-10T12:00:00Z');
const reference = { station: '30046', tideStation: '8658163', datum: 'MLLW', units: 'ft', thresholdFt: 5.6 };
const base = buildForecast([], [], [], [], [], now);
const point = { t: now.toISOString(), tideFt: 5, residualFt: .8, totalFt: 5.8, lowerFt: 5.5, upperFt: 6.1 };

describe('experimental gauge forecast alignment', () => {
  it('expresses the physical total relative to the chart tide without adding the old residual twice', () => {
    const outlook = { ...base, phaseMinutes: 60, points: [point] };
    const aligned = alignForecastComparison(outlook, [{ t: now, v: 5.2 }], reference);
    expect(aligned.compatible).toBe(true);
    expect(aligned.points[0].v).toBe(5.8);
    expect(aligned.residual[0].v).toBeCloseTo(.6);
    expect(aligned.residual[0].v + 5.2).toBeCloseTo(aligned.points[0].v);
  });
  it.each(['station', 'tideStation', 'datum', 'units'] as const)('rejects incompatible %s references', key => {
    const other = { ...reference, [key]: 'different' };
    const result = alignForecastComparison({ ...base, points: [point] }, [{ t: now, v: 5.2 }], other);
    expect(result).toEqual({ compatible: false, points: [], residual: [] });
  });
  it('preserves physical totals after a user changes the flood threshold', () => {
    expect(alignForecastComparison({ ...base, points: [point] }, [{ t: now, v: 5.2 }], { ...reference, thresholdFt: 6.5 }).compatible).toBe(true);
  });
  it('does not fill missing astronomical samples to manufacture a residual', () => {
    expect(alignForecastComparison({ ...base, points: [point] }, [], reference).residual).toEqual([]);
    expect(alignForecastComparison(null, [], reference).compatible).toBe(false);
  });
  it('retains unavailable event metrics as null in the new hindcast schema', () => {
    const metric = { samples: 150, maeFt: .2, peakMaeFt: null, onsetMaeMinutes: null, durationMaeMinutes: null, hits: null, misses: null, falseAlarms: null, matchedEvents: null };
    const validation = { kind: 'chronological-weather-response-hindcast', trainEnd: '2026-09-05T00:00:00Z', testStart: '2026-09-06T00:00:00Z', testEnd: '2026-10-02T00:00:00Z', trainingSamples: 500, model: metric, persistence: metric, tideOnly: metric, error90Ft: .4, limitation: 'Peak and event validation unavailable.' };
    const doc = { ...base, validation, leadValidation: [{ leadHours: 6, testPairs: 150, modelMaeFt: .2, persistenceMaeFt: .34, absoluteError90Ft: .4 }] };
    expect(base.sensor).toBe('30046');
    expect(validateForecast(doc)).toBe(true);
    expect(validateForecast({ ...doc, leadValidation: [{ ...doc.leadValidation[0], modelMaeFt: NaN }] })).toBe(false);
    expect(validateForecast({ ...doc, leadValidation: [{ ...doc.leadValidation[0], leadHours: '6' }] })).toBe(false);
    expect(validateForecast({ ...doc, leadValidation: [doc.leadValidation[0], doc.leadValidation[0]] })).toBe(false);
    expect(validateForecast({ ...doc, observationAt: '2026-10-10T13:00:00Z' })).toBe(false);
    expect(validateForecast({ ...doc, validation: { ...validation, kind: 'chronological-perfect-weather-hindcast' } })).toBe(false);
  });
});

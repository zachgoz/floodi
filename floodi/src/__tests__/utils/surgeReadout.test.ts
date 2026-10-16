import { describe, expect, it } from 'vitest';
import { selectSurgeReadout, selectedForecastFactors } from 'src/utils/surgeReadout';
import type { ForecastDocument } from '../../../functions/src/forecast/schema';
const t = (hours: number) => new Date(Date.UTC(2026, 9, 16) + hours * 3600_000);
const point = (hours: number, v: number) => ({ t: t(hours), v });
describe('selected surge readout', () => {
  const observed = [point(0, .2), point(1, .4)], bridge = [point(1, .4), point(2, .5)], forecast = [point(1, .4), point(2, .5), point(4, 1.7)];
  it('follows the same focus time across observed, bridge and future lines', () => {
    expect(selectSurgeReadout(observed, bridge, forecast, t(0))?.source).toBe('Observed');
    expect(selectSurgeReadout(observed, bridge, forecast, t(.5))?.value).toBeCloseTo(.3);
    expect(selectSurgeReadout(observed, bridge, forecast, t(1.5))?.source).toBe('Estimated');
    expect(selectSurgeReadout(observed, bridge, forecast, t(3))).toMatchObject({ value: 1.1, source: 'Forecast' });
  });
  it('never extrapolates a line or presents missing live data as a new observation', () => {
    expect(selectSurgeReadout(observed, [], forecast, t(5))).toBeNull();
    expect(selectSurgeReadout(observed, [], [], t(2), true)).toMatchObject({ value: .4, at: t(1), source: 'Latest observation' });
    expect(selectSurgeReadout([], [], [], t(2), true)).toBeNull();
    expect(selectSurgeReadout([point(0, NaN)], [], [], t(0))).toBeNull();
  });
  it('labels visually connected measured gaps as interpolated', () => {
    expect(selectSurgeReadout([point(0, .2), point(4, .6)], [], [], t(2))).toMatchObject({ value: .4, source: 'Interpolated', interpolated: true });
  });
});
describe('selected forecast factors', () => {
  const document = { driverInfo: { version: 1 }, points: [
    { t: t(2).toISOString(), residualFt: 1, drivers: { m: 'w', c: [.2, .1, .1, .1, .3, .1, .05, .05], w: { at: t(2).toISOString(), wind6Mph: 15, wind6FromDeg: 45, rain24In: .4, pressureHpa: 1001 } } },
    { t: t(2.1).toISOString(), residualFt: 2, drivers: { m: 'w', c: [.4, .2, .2, .2, .6, .2, .1, .1] } },
  ] } as unknown as ForecastDocument;
  it('interpolates all factors and explicitly reconciles the chart tide reference', () => {
    const value = selectedForecastFactors(document, t(2.05), 1.7)!;
    expect(value.contributions.reduce((sum, row) => sum + row.value, 0)).toBeCloseTo(1.7, 10);
    expect(value.contributions.find(row => row.id === 'wind')?.value).toBeCloseTo(.45);
    expect(value.contributions.at(-1)?.id).toBe('local-tide-reference');
    expect(value.contributions.at(-1)?.value).toBeCloseTo(.2);
    expect(value.weather?.wind6Mph).toBe(15);
  });
  it('does not invent metadata for old caches or unsupported weather', () => {
    expect(selectedForecastFactors(null, t(2), 1)).toBeNull();
    expect(selectedForecastFactors(document, t(4), 1)).toBeNull();
    const gap = { ...document, points: [document.points[0], { ...document.points[1], t: t(4).toISOString() }] };
    expect(selectedForecastFactors(gap, t(3), 1.5)).toBeNull();
    expect(selectedForecastFactors(document, t(3), 2)?.weather).toBeUndefined();
    const historical = { ...document, points: document.points.map(p => ({ ...p, drivers: { ...p.drivers!, m: 'h' as const, w: undefined } })) };
    expect(selectedForecastFactors(historical, t(2.05), 1.5)?.weather).toBeUndefined();
  });
});

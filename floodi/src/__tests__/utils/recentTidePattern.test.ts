import { describe, expect, it } from 'vitest';
import { fitRecentTideResponse, type RecentResidualObservation } from '../../../functions/src/forecast/recentTidePattern';
import type { WaterPoint } from '../../../functions/src/forecast/water';

const HOUR = 3_600_000;
const issue = new Date('2026-10-26T12:00:00.000Z');
const at = (hours: number) => new Date(+issue + hours * HOUR);
const astronomical = (hours: number) => 2.7 + 2.1 * Math.sin(2 * Math.PI * hours / 12.4206) + .2 * Math.cos(2 * Math.PI * hours / 24);
const tideSlope = (hours: number) => astronomical(hours + .5) - astronomical(hours - .5);
const tide: WaterPoint[] = Array.from({ length: 761 }, (_, i) => {
  const hours = -75 + i / 10;
  return { t: at(hours), v: astronomical(hours) };
});
const measured = (hours: number, drift = .003, level = -.16, slope = -.25) => .8 + drift * hours + level * astronomical(hours) + slope * tideSlope(hours);
function history(anchorHours = 0, step = .1): RecentResidualObservation[] {
  return Array.from({ length: Math.round(70 / step) + 1 }, (_, i) => {
    const hours = anchorHours - 70 + i * step;
    return { t: at(hours), v: measured(hours) };
  });
}

describe('recent measured tide-linked residual support', () => {
  it('recovers level and phase response without mistaking slow drift for the cycle', () => {
    const result = fitRecentTideResponse(history(), tide, issue)!;
    expect(result.samples).toBe(61);
    expect(result.spanHours).toBe(60);
    expect(result.tideLevelCoefficient).toBeCloseTo(-.16, 3);
    expect(result.tideSlopeCoefficientHours).toBeCloseTo(-.25, 3);
    expect(result.varianceExplained).toBeGreaterThan(.999);
    expect(result.varianceExplained - result.baselineVarianceExplained).toBeGreaterThan(.8);
    // No intercept or drift is exported for extrapolation into the forecast.
    expect(Object.keys(result).sort()).toEqual([
      'baselineVarianceExplained', 'samples', 'spanHours',
      'tideLevelCoefficient', 'tideSlopeCoefficientHours', 'varianceExplained',
    ]);
  });

  it('keeps a strong historical linear drift separate from the tide response', () => {
    const rising = history().map(point => ({ ...point, v: 1.2 + .035 * (+point.t - +issue) / HOUR }));
    const result = fitRecentTideResponse(rising, tide, issue)!;
    expect(result.tideLevelCoefficient).toBeCloseTo(0, 9);
    expect(result.tideSlopeCoefficientHours).toBeCloseTo(0, 9);
    expect(result.baselineVarianceExplained).toBeCloseTo(1, 9);
    expect(result.varianceExplained).toBeCloseTo(1, 9);
  });

  it('uses the actual delayed anchor and preceding 60h rather than retimestamping it', () => {
    const delayed = history(-.4);
    const result = fitRecentTideResponse(delayed, tide, issue)!;
    expect(result.samples).toBe(60);
    expect(result.spanHours).toBe(59);
    expect(result.tideLevelCoefficient).toBeCloseTo(-.16, 3);
    expect(result.tideSlopeCoefficientHours).toBeCloseTo(-.25, 3);
    expect(fitRecentTideResponse(delayed, tide, at(.4))).toEqual(result);
    expect(fitRecentTideResponse(delayed, tide, at(.61))).toBeNull();
  });

  it('ignores future observations, estimated proxies, invalid values and pre-window history', () => {
    const clean = history(-.4);
    const result = fitRecentTideResponse(clean, tide, issue);
    const contamination = [
      ...clean,
      { t: at(.1), v: 999 },
      { t: at(0), v: 999, estimated: true },
      { t: at(-.4), v: 999, estimated: true },
      { t: at(-65), v: 999 },
      { t: at(-5), v: NaN },
      { t: new Date('invalid'), v: 999 },
    ].reverse();
    expect(fitRecentTideResponse(contamination, tide, issue)).toEqual(result);
    expect(fitRecentTideResponse(clean.map(point => ({ ...point, estimated: true })), tide, issue)).toBeNull();
  });

  it('collapses equal duplicates and rejects conflicting observed or tide timestamps', () => {
    const clean = history();
    const result = fitRecentTideResponse(clean, tide, issue);
    const duplicate = clean.at(-21)!;
    expect(fitRecentTideResponse([...clean, { ...duplicate }].reverse(), [...tide].reverse(), issue)).toEqual(result);
    expect(fitRecentTideResponse([...clean, { ...duplicate, v: duplicate.v + .1 }], tide, issue)).toBeNull();
    const duplicateTide = tide.find(point => +point.t === +at(-5))!;
    expect(fitRecentTideResponse(clean, [...tide, { ...duplicateTide, v: duplicateTide.v + .1 }], issue)).toBeNull();
  });

  it('accepts documented half-hour jitter and does not bridge a missed sample', () => {
    const jittered = (seconds: number) => history(-.4, .5).map((point, i) => {
      const t = new Date(+point.t + (i % 2 ? seconds * 1000 : 0));
      return { t, v: measured((+t - +issue) / HOUR) };
    });
    const supported = fitRecentTideResponse(jittered(8), tide, issue)!;
    expect(supported.samples).toBe(60);
    expect(supported.tideLevelCoefficient).toBeCloseTo(-.16, 2);
    expect(supported.tideSlopeCoefficientHours).toBeCloseTo(-.25, 2);
    expect(fitRecentTideResponse(jittered(11), tide, issue)).toBeNull();
    expect(fitRecentTideResponse(history(-.4, .5).filter((_, i) => i % 2 === 0), tide, issue)).toBeNull();
  });

  it('requires at least 40 supported hourly samples and 48h of actual span', () => {
    expect(fitRecentTideResponse([], tide, issue)).toBeNull();
    expect(fitRecentTideResponse(history().filter(point => +point.t >= +at(-47)), tide, issue)).toBeNull();
    const sparse = history(-.4, .5).filter(point => {
      const h = (+point.t - +issue) / HOUR;
      return h < -40 || h > -15;
    });
    expect(fitRecentTideResponse(sparse, tide, issue)).toBeNull();
    expect(fitRecentTideResponse(history(), tide.filter(point => +point.t > +at(-25)), issue)).toBeNull();
    expect(fitRecentTideResponse(history(), tide, new Date('invalid'))).toBeNull();
  });
});

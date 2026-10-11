import { describe, expect, it } from 'vitest';
import { backtestResidualPattern, projectResidualPattern } from '../../../functions/src/forecast/pattern';
import { Reference, WaterPoint } from '../../../functions/src/forecast/water';

const issue = new Date('2026-10-10T12:00:00Z');
const hour = 3600_000;
const reference: Reference = { station: 'local-gauge', datum: 'MLLW', units: 'ft' };
const time = (hours: number) => new Date(+issue + hours * hour);
const cycle = (hours: number) => .4 + .22 * Math.sin(2 * Math.PI * hours / 12.4206) + .08 * Math.cos(2 * Math.PI * hours / 24);
const history = () => Array.from({ length: 14 * 24 * 10 + 1 }, (_, i) => {
  const hours = -14 * 24 + i / 10;
  return { t: time(hours), v: cycle(hours) };
});
const times = Array.from({ length: 49 }, (_, i) => time(i / 2));
const run = (points: WaterPoint[] = history(), options = {}) => projectResidualPattern(points, times, issue, reference, reference, options);

describe('measured residual tidal-pattern candidate', () => {
  it('learns a repeating cycle, follows peaks and valleys, and improves unseen chronological outcomes', () => {
    const result = run();
    expect(result.analysis.status).toBe('experimental');
    expect(result.analysis.validation?.accepted).toBe(true);
    expect(result.analysis.validation?.origins).toBeGreaterThanOrEqual(8);
    expect(result.analysis.validation?.trainOnlyBeforeIssue).toBe(true);
    expect(result.analysis.varianceExplained).toBeGreaterThan(.999);
    expect(result.analysis.harmonicAmplitudesFt[0].amplitudeFt).toBeCloseTo(.22, 3);
    expect(result.analysis.harmonicAmplitudesFt[1].amplitudeFt).toBeCloseTo(.08, 3);
    for (const row of result.analysis.validation!.byHorizon) {
      expect(row.pattern.maeFt).toBeLessThan(.005);
      expect(row.pattern.rmseFt).toBeLessThan(.005);
      expect(row.pattern.maeFt).toBeLessThan(row.persistence.maeFt!);
    }
    expect(result.analysis.validation!.patternPeakMaeFt).toBeLessThan(.005);
    expect(result.points[0]).toEqual(history().at(-1));
    for (const point of result.points) expect(point.v).toBeCloseTo(cycle((+point.t - +issue) / hour), 3);
    expect(result.points.at(-1)!.t).toEqual(time(6));
    expect(result.points.at(-1)!.v).toBeLessThan(Math.max(...result.points.map(point => point.v)));
  });

  it('never trains or anchors on future samples or estimated NOAA proxies', () => {
    const clean = run();
    const contaminated = [
      ...history(),
      { t: time(0), v: 99, estimated: true },
      { t: time(2), v: 999 },
      { t: time(100), v: -999 },
      { t: new Date('invalid'), v: 0 },
      { t: time(-5), v: NaN },
    ].reverse();
    expect(projectResidualPattern(contaminated, times, issue, reference, reference)).toEqual(clean);
  });

  it('requires compatible station, datum, feet units and per-observation reference tags', () => {
    for (const other of [
      { ...reference, station: 'other-gauge' },
      { ...reference, datum: 'NAVD88' },
      { ...reference, units: 'm' },
      { ...reference, station: '' },
    ]) {
      const result = projectResidualPattern(history(), times, issue, reference, other);
      expect(result.analysis.status).toBe('reference-mismatch');
      expect(result.points).toEqual([]);
    }
    const mixed = history().map((point, i) => i === 1 ? { ...point, reference: { ...reference, station: 'other-gauge' } } : point);
    expect(run(mixed).analysis.status).toBe('reference-mismatch');
  });

  it('withholds a candidate when there is no improvement over persistence', () => {
    const result = run(history().map(point => ({ ...point, v: .5 })));
    expect(result.analysis.status).toBe('not-better-than-persistence');
    expect(result.analysis.validation?.accepted).toBe(false);
    expect(result.analysis.validation?.improvementFraction).toBeNull();
    expect(result.points).toEqual([]);
  });

  it('withholds on short histories, missing coverage, stale actual observations and missing data', () => {
    expect(run(history().filter(point => point.t >= time(-48))).analysis.status).toBe('insufficient-history');
    // Plenty of raw timestamps are insufficient if most hourly targets have gaps.
    expect(run(history().filter((_, i) => i % 40 === 0)).analysis.status).toBe('insufficient-history');
    expect(run(history().filter(point => point.t <= time(-2))).analysis.status).toBe('stale');
    expect(run([]).analysis.status).toBe('stale');
    const estimated = history().map(point => ({ ...point, estimated: true }));
    expect(projectResidualPattern(estimated, times, issue, reference, reference).analysis.status).toBe('stale');
  });

  it('keeps no more than a 24-hour horizon and deduplicates, sorts and rejects past output timestamps', () => {
    const result = projectResidualPattern(history(), [time(25), time(-1), time(3), time(1), time(3), new Date('invalid')], issue, reference, reference, { horizonHours: 24 });
    expect(result.points.map(point => +point.t)).toEqual([+issue, +time(1), +time(3)]);
    for (const options of [{ horizonHours: 25 }, { horizonHours: 0 }, { horizonHours: NaN }, { trainingHours: 48 }, { trainingHours: 337 }, { maxObservationAgeMinutes: 61 }]) {
      expect(run(history(), options).analysis.status).toBe('invalid-options');
      expect(run(history(), options).points).toEqual([]);
    }
  });

  it('anchors at the last measured time even when issue time falls between gauge updates', () => {
    const anchor = time(-.4);
    const points = history().filter(point => point.t <= anchor);
    const result = run(points);
    expect(result.analysis.status).toBe('experimental');
    expect(result.points[0].t).toEqual(anchor);
    expect(result.points[0].v).toEqual(points.at(-1)!.v);
    expect(result.points.find(point => +point.t === +issue)!.v).toBeCloseTo(cycle(0), 3);
  });

  it('bounds training cost and avoids timezone or daylight-saving clock arithmetic', () => {
    const result = run(history(), { trainingHours: 168 });
    expect(result.analysis.trainingSamples).toBe(169);
    const shiftedIssue = new Date('2026-11-01T06:00:00Z');
    const shift = +shiftedIssue - +issue;
    const shiftedHistory = history().map(point => ({ ...point, t: new Date(+point.t + shift) }));
    const shiftedTimes = times.map(value => new Date(+value + shift));
    const shifted = projectResidualPattern(shiftedHistory, shiftedTimes, shiftedIssue, reference, reference);
    expect(shifted.analysis.status).toBe('experimental');
    expect(shifted.points.map(point => point.v)).toEqual(result.points.map(point => point.v));
  });

  it('benchmarks chronological daily issues without future leakage and uses identical short-horizon pairs', () => {
    const result = backtestResidualPattern(history(), time(-10 * 24), issue, reference, reference)!;
    expect(result.origins).toBe(10);
    expect(result.trainOnlyBeforeIssue).toBe(true);
    expect(result.accepted).toBe(true);
    for (const lead of result.byHorizon.filter(row => row.hours <= 6)) {
      expect(lead.samples).toBe(10);
      expect(lead.dampedTrend.maeFt).not.toBeNull();
      expect(lead.pattern.maeFt).toBeLessThan(lead.dampedTrend.maeFt!);
    }
    expect(backtestResidualPattern([...history(), { t: time(1), v: 999 }], time(-10 * 24), issue, reference, reference)).toEqual(result);
    expect(backtestResidualPattern(history(), issue, time(-1), reference, reference)).toBeNull();
    expect(backtestResidualPattern(history(), time(-10 * 24), issue, reference, { ...reference, station: 'other' })).toBeNull();
  });
});

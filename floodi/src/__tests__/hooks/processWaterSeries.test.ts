import { describe, expect, it } from 'vitest';
import { processWaterSeries } from 'src/components/Tab2/hooks/processWaterSeries';
import type { ChartData } from 'src/components/Tab2/types';
import { interpolate } from 'src/utils/waterForecast';

const now = new Date('2026-10-10T12:00:00Z');
const time = (minutes: number) => new Date(+now + minutes * 60_000);
const series = (points: Array<[number, number]>) => Object.fromEntries(points.map(([m, v]) => [time(m).toISOString(), v]));
const config = { mode: 'auto', value: '' } as const;
const data = (changes: Partial<ChartData> = {}): ChartData => ({
  source: 'fiman', timeOffsetMins: 60,
  observed: series([[-36, 6.1], [-30, 6.2]]),
  // Raw NOAA values peak an hour earlier than the established local tide.
  alternate: series([[-96, 5.7], [-90, 5.8], [-84, 5.85], [-78, 5.95], [-72, 5.94], [-66, 5.92], [-60, 5.9], [-54, 5.8], [-30, 5], [0, 4.6]]),
  predicted: series([[-96, 5.4], [-90, 5.5], [-84, 5.6], [-78, 5.7], [-72, 5.65], [-66, 5.63], [-60, 5.6], [-54, 5.5], [-48, 5.4], [0, 4.8]]),
  adjusted: {}, offset: 0, nPoints: 2,
  ...changes,
});

describe('near-live local water-level handoff', () => {
  it('restores the established phase-aligned alternate curve during the gauge reporting lag', () => {
    const result = processWaterSeries(data(), now, '8658163', config);
    const tail = result.observedPoints.filter(p => p.t > time(-30));
    expect(tail).toHaveLength(5);
    [6.25, 6.35, 6.34, 6.32, 6.3].forEach((value, i) => expect(tail[i].v).toBeCloseTo(value));
    expect(tail.every(p => p.estimated)).toBe(true);
    expect(tail[0].t).toEqual(time(-24));
    expect(tail[0].observedTime).toEqual(time(-84));
    // The previous unshifted splice would put the raw falling limb here.
    expect(tail.at(-1)!.v).toBeCloseTo(6.3);
    expect(result.deltaPoints).toHaveLength(2);
    expect(result.deltaPoints.at(-1)!.t).toEqual(time(-30));
  });

  it('anchors future persistence to the latest displayed estimate without a step', () => {
    const result = processWaterSeries(data(), now, '8658163', config);
    const last = result.observedPoints.at(-1)!;
    expect(result.adjustedPoints[0]).toEqual(last);
    expect(result.effectiveOffset).toBeCloseTo(last.v - interpolate(result.predictedPoints, last.t)!);
    expect(result.adjustedPoints[1].v).toBeCloseTo(5.5 + result.effectiveOffset);
    expect(result.surgeForecastPoints[0]).toEqual({ t: now, v: result.effectiveOffset });
  });

  it('aligns at an interpolated common time instead of introducing a six-minute handoff error', () => {
    const input = data({ observed: series([[-27, 6.2]]) });
    const result = processWaterSeries(input, now, '8658163', config);
    expect(result.observedPoints.at(-1)!.v).toBeCloseTo(6.275);
    expect(result.observedPoints[0].t).toEqual(time(-27));
    expect(result.observedPoints[0].estimated).toBeUndefined();
  });

  it('estimates at the exact live time and retains the original supporting measurement time', () => {
    const issueTime = time(-3);
    const result = processWaterSeries(data(), issueTime, '8658163', config);
    const live = result.observedPoints.at(-1)!;
    expect(live.t).toEqual(issueTime);
    expect(live.v).toBeCloseTo(6.31);
    expect(live.observedTime).toEqual(time(-60));
    expect(live.estimated).toBe(true);
    expect(result.observedPoints.every(p => p.t <= issueTime)).toBe(true);
  });

  it('never phase-shifts primary NOAA measurements or combines a later FIMAN station into them', () => {
    const input = data({ source: 'noaa', observed: series([[-6, 4], [0, 4.1]]), alternate: series([[0, 6.2]]), predicted: series([[-6, 3.8], [0, 3.9], [6, 4]]) });
    const result = processWaterSeries(input, now, '8658163', config);
    expect(result.observedPoints.map(p => p.t)).toEqual([time(-6), now]);
    expect(result.observedPoints.at(-1)!.v).toBe(4.1);
    expect(result.predictedPoints[0].t).toEqual(time(-6));
    expect(result.observedPoints.every(p => !p.estimated)).toBe(true);
    expect(result.effectiveOffset).toBeCloseTo(0.2);
  });

  it('does not localize an alternate station without a recent overlapping calibration point', () => {
    const result = processWaterSeries(data({ alternate: series([[-40, 4], [-30, 3]]) }), now, '8658163', config);
    expect(result.observedPoints).toHaveLength(2);
    expect(result.adjustedPoints[0].t).toEqual(time(-30));
    expect(result.effectiveOffset).toBeCloseTo(0.7);
  });

  it('does not revive a stale or missing local sensor using another station', () => {
    const stale = processWaterSeries(data({ observed: series([[-66, 6.2]]) }), now, '8658163', config);
    expect(stale.observedPoints).toHaveLength(1);
    expect(stale.adjustedPoints).toEqual([]);
    expect(stale.surgeForecastPoints).toEqual([]);
    const missing = processWaterSeries(data({ observed: {} }), now, '8658163', config);
    expect(missing.observedPoints).toEqual([]);
    expect(missing.adjustedPoints).toEqual([]);
  });

  it('rejects invalid and future measurements and does not mutate source records or timestamps', () => {
    const input = data({ observed: { ...series([[-30, 6.2], [6, 99]]), bad: 10, [time(-12).toISOString()]: NaN } });
    const raw = JSON.stringify(input);
    const result = processWaterSeries(input, now, '8658163', config);
    expect(result.deltaPoints).toHaveLength(1);
    expect(result.observedPoints.every(p => p.t <= now && Number.isFinite(p.v))).toBe(true);
    expect(JSON.stringify(input)).toBe(raw);
  });

  it('retains the explicitly configured manual residual', () => {
    const result = processWaterSeries(data(), now, '8658163', { mode: 'manual', value: '1.2' });
    expect(result.effectiveOffset).toBe(1.2);
    expect(result.adjustedPoints[1].v).toBeCloseTo(6.7);
  });
});

import { describe, it, expect } from 'vitest';
import { projectSurgeTrend, surgeTrend, interpolate } from 'src/utils/waterForecast';
const now = new Date('2026-10-10T12:00:00Z');
const time = (hours: number) => new Date(+now + hours * 3600_000);
const history = (slope: number) => Array.from({length: 31}, (_, i) => ({ t: time(-3 + i / 10), v: .6 + slope * (-3 + i / 10) }));
const times = [time(0),time(1),time(2),time(3),time(6),time(7)];
describe('experimental damped residual trend', () => {
  it.each([.1,-.1])('follows the observed slope %s and gradually flattens', slope => {
    const points = history(slope);
    const projected = projectSurgeTrend(points, times, now, {horizonHours:6});
    expect(surgeTrend(points, now).slopeFtPerHour).toBeCloseTo(slope);
    expect(projected[0].v).toBeCloseTo(.6);
    const at = (h: number) => projected.find(p => +p.t === +time(h))!.v;
    expect(Math.sign(at(1)-.6)).toBe(Math.sign(slope));
    expect(Math.abs(at(2)-at(1))).toBeLessThan(Math.abs(at(1)-.6));
    expect(Math.abs(at(6)-.6)).toBeLessThan(.2);
    expect(projected.some(p => p.t > time(6))).toBe(false);
  });
  it('limits the displayed preview to one hour and rejects invalid horizon settings', () => {
    const h=history(.1);
    expect(projectSurgeTrend(h,times,now).every(p => p.t<=time(1))).toBe(true);
    for (const horizonHours of [0,-1,7,NaN,Infinity]) expect(projectSurgeTrend(h,times,now,{horizonHours})).toEqual([]);
  });
  it('keeps stable residuals steady and never extrapolates small noisy slopes', () => {
    expect(projectSurgeTrend(history(.01), times, now).every(p => Math.abs(p.v-.6)<1e-8)).toBe(true);
  });
  it('caps extreme trends in both directions without constraining negative residuals to zero', () => {
    for (const slope of [2,-2]) {
      const projected = projectSurgeTrend(history(slope), times, now, {horizonHours:6});
      expect(projected.every(p => Math.abs(p.v-.6)<=.500000001)).toBe(true);
      expect(projected.at(-1)!.v).toBeCloseTo(.6+Math.sign(slope)*.5);
    }
    expect(projectSurgeTrend(history(-.2).map(p=>({...p,v:p.v-1})), times, now).at(-1)!.v).toBeLessThan(0);
  });
  it('withholds projections when stale, sparse, gapped or missing', () => {
    expect(projectSurgeTrend([], times, now)).toEqual([]);
    expect(projectSurgeTrend(history(.1),times,time(2))).toEqual([]);
    expect(projectSurgeTrend(history(.1).slice(-2),times,now)).toEqual([]);
    expect(projectSurgeTrend([{t:time(-3),v:.1},{t:time(-2.9),v:.2},{t:now,v:.6}], times, now)).toEqual([]);
  });
  it('ignores future samples and invalid values, and does not invent past forecasts', () => {
    const h=history(.1);
    const withBad=[...h,{t:time(1),v:999},{t:now,v:NaN},{t:new Date('invalid'),v:2}].reverse();
    expect(projectSurgeTrend(withBad,[time(-1),...times],now)).toEqual(projectSurgeTrend(h,times,now));
  });
  it('combines the residual with tide at identical timestamps', () => {
    const residual = projectSurgeTrend(history(.1),[time(1)],now).at(-1)!;
    const tide = [{t:time(0),v:5},{t:time(1),v:5.2}];
    const total=interpolate(tide,residual.t)!+residual.v;
    expect(total).toBeGreaterThan(5.8);
    expect(total).toBeLessThan(6);
  });
});

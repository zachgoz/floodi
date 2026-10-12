import { describe, expect, it } from 'vitest';
import { compassDirection, parseWindDirection, weatherTimeline } from 'src/utils/weatherTimeline';

const start = new Date('2026-10-11T00:00:00Z');
const hour = (value: number) => new Date(+start + value * 3_600_000);
const wind = (index: number, speed = 12, dir = 45) => ({ t: hour(index), speed, dir });
const rain = (index: number, value = 0.1) => ({ t: hour(index), value });

describe('weather timeline aggregation', () => {
  it('adapts bins to the visible range and mobile width', () => {
    expect(weatherTimeline([], [], start, hour(24), 240).intervalHours).toBe(8);
    expect(weatherTimeline([], [], start, hour(6), 240).intervalHours).toBe(2);
    expect(weatherTimeline([], [], start, hour(24), 800).intervalHours).toBe(3);
    expect(weatherTimeline([], [], start, hour(24 * 21), 240).intervalHours).toBe(168);
  });

  it('can expose genuine hourly variation hidden by a mobile overview average', () => {
    const windPoints = [wind(0, 8, 0), wind(1, 24, 90), wind(2, 4, 180)];
    expect(weatherTimeline(windPoints, [], start, hour(3), 80).intervals[0].windSpeed).toBe(12);
    const hourly = weatherTimeline(windPoints, [rain(1, 0.2), rain(2, 0.1)], start, hour(3), 80, { intervalHours: 1 });
    expect(hourly.intervalHours).toBe(1);
    expect(hourly.intervals.map(interval => interval.windSpeed)).toEqual([8, 24, 4]);
    expect(hourly.intervals.map(interval => interval.windDirection)).toEqual([0, 90, 180]);
    expect(hourly.intervals.map(interval => interval.rain)).toEqual([0.2, 0.1, null]);
  });

  it('keeps hourly detail rainfall windows distinct and does not fill missing winds', () => {
    const { intervals } = weatherTimeline([wind(0, 8)], [rain(1, 0.2), rain(1.8, 2), rain(2, 0)], start, hour(3), 80, { intervalHours: 1 });
    expect(intervals.map(interval => interval.windSpeed)).toEqual([8, null, null]);
    expect(intervals.map(interval => interval.rain)).toEqual([0.2, 0, null]);
    expect(intervals.map(interval => interval.rainHours)).toEqual([1, 1, 0]);
  });

  it('does not reuse an outside-viewport hour for clipped hourly detail', () => {
    const { intervals } = weatherTimeline([wind(0, 8), wind(1, 24)], [rain(1, 0.8), rain(2, 0.2)], hour(0.5), hour(1.5), 80, { intervalHours: 1 });
    expect(intervals.map(interval => interval.expectedHours)).toEqual([0.5, 0.5]);
    expect(intervals.map(interval => interval.windSpeed)).toEqual([null, 24]);
    expect(intervals.map(interval => interval.rain)).toEqual([null, null]);
  });

  it('ignores malformed hourly modes rather than creating zero, negative or non-finite bins', () => {
    for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2, '1']) {
      const options = { intervalHours: invalid } as unknown as { intervalHours: 1 };
      const result = weatherTimeline([wind(0, 8), wind(1, 24)], [], start, hour(2), 80, options);
      expect(result.intervalHours).toBe(2);
      expect(result.intervals).toHaveLength(1);
      expect(result.intervals[0].windSpeed).toBe(16);
      expect(result.intervals[0].end).toEqual(hour(2));
    }
  });

  it('sums preceding-hour rainfall without changing inches or averaging the total', () => {
    const { intervals } = weatherTimeline([wind(0), wind(1, 18)], [rain(1, 0.2), rain(2, 0.1)], start, hour(2), 80);
    expect(intervals).toHaveLength(1);
    expect(intervals[0]).toMatchObject({ windSpeed: 15, windDirection: 45, rainHours: 2, expectedHours: 2 });
    expect(intervals[0].rain).toBeCloseTo(0.3);
  });

  it('keeps rain unavailable when missing and measured zero when complete', () => {
    const missing = weatherTimeline([], [], start, hour(2), 80).intervals[0];
    const dry = weatherTimeline([], [rain(1, 0), rain(2, 0)], start, hour(2), 80).intervals[0];
    expect(missing.rain).toBeNull();
    expect(missing.windSpeed).toBeNull();
    expect(dry.rain).toBe(0);
    expect(dry.rainHours).toBe(2);
  });

  it('does not double-count overlapping NWS rolling-hour reports or duplicate timestamps', () => {
    const { intervals } = weatherTimeline([], [rain(1, 0.2), rain(1.9, 0.8), rain(2, 0.1), rain(2, 0.1)], start, hour(2), 80);
    expect(intervals[0].rain).toBeCloseTo(0.3);
    expect(intervals[0].rainHours).toBe(2);
  });

  it('retains genuine partial rainfall coverage without inventing dry hours', () => {
    const { intervals } = weatherTimeline([], [rain(1, 0.2)], start, hour(6), 80);
    expect(intervals[0]).toMatchObject({ rain: 0.2, rainHours: 1, expectedHours: 6 });
  });

  it('averages wind directions around north using vectors, not arithmetic degrees', () => {
    const { intervals } = weatherTimeline([wind(0, 12, 359), wind(1, 12, 1)], [], start, hour(2), 80);
    expect(compassDirection(intervals[0].windDirection!)).toBe('N');
  });

  it('keeps direction unknown or variable while retaining valid wind speeds', () => {
    const unknown = weatherTimeline([wind(0, 12, Number.NaN)], [], start, hour(1), 80).intervals[0];
    const variable = weatherTimeline([wind(0, 12, 0), wind(1, 12, 180)], [], start, hour(2), 80).intervals[0];
    expect(unknown.windSpeed).toBe(12);
    expect(unknown.windDirection).toBeNull();
    expect(variable.windDirection).toBeNull();
  });

  it('ignores invalid values, dates and speed without inventing weather', () => {
    const { intervals } = weatherTimeline([wind(0, -1), { ...wind(1), t: new Date('invalid') }], [rain(1, -1), rain(2, Number.NaN)], start, hour(2), 80);
    expect(intervals[0].windSpeed).toBeNull();
    expect(intervals[0].rain).toBeNull();
    expect(weatherTimeline([], [], hour(2), start, 240).intervals).toEqual([]);
  });

  it('keeps unknown legacy compass readings unknown instead of north', () => {
    expect(parseWindDirection(' NNE ')).toBe(22.5);
    expect(parseWindDirection(360)).toBe(0);
    expect(parseWindDirection('variable')).toBeNaN();
    expect(parseWindDirection(undefined)).toBeNaN();
    expect(compassDirection(Number.NaN)).toBe('—');
  });

  it('prefers hourly wind to duplicate irregular reports in the same hour', () => {
    const { intervals } = weatherTimeline([wind(0.8, 30, 180), wind(0, 12, 45), wind(1, 18, 45)], [], start, hour(2), 80);
    expect(intervals[0].windSpeed).toBe(15);
    expect(intervals[0].windHours).toBe(2);
  });

  it('excludes weather beyond a clipped viewport without prorating rain at its edges', () => {
    const { intervals } = weatherTimeline([wind(0, 12), wind(1, 12), wind(2, 12), wind(2.75, 60)], [rain(1, 0.1), rain(2, 0.1), rain(3, 1)], start, hour(2.5), 80);
    expect(intervals[0]).toMatchObject({ start, end: hour(2.5), windSpeed: 12, rainHours: 2, expectedHours: 2.5 });
    expect(intervals[0].rain).toBeCloseTo(0.2);
    const clippedStart = weatherTimeline([wind(0, 60), wind(0.75, 12), wind(1, 12)], [rain(1, 1), rain(2, 0.1)], hour(0.5), hour(2), 80).intervals[0];
    expect(clippedStart).toMatchObject({ start: hour(0.5), end: hour(2), windSpeed: 12, rain: 0.1, rainHours: 1, expectedHours: 1.5 });
  });
});

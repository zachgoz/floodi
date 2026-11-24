import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  deduplicateFloodEvents,
  useHistoricalComparisonEvents,
  useSimilarFloodEvents,
} from 'src/components/dashboard/useSimilarFloodEvents';
import type { FloodEvent } from 'src/types/data';

const now = new Date('2026-10-17T12:00:00Z');
const event = (start: string, end: string, peak: number): FloodEvent => ({
  startTime: start, endTime: end, peakTime: new Date((Date.parse(start) + Date.parse(end)) / 2).toISOString(),
  peakValue: peak, thresholdType: 'minor', thresholdValue: 5.6, source: 'fiman',
});

describe('similar flood episodes', () => {
  it('shows independent floods instead of several threshold records for one flood', () => {
    const broad = event('2026-10-11T11:00:00Z', '2026-10-11T15:00:00Z', 6.01);
    const nested = event('2026-10-11T12:00:00Z', '2026-10-11T14:00:00Z', 6.02);
    const earlier = event('2026-10-10T11:00:00Z', '2026-10-10T15:00:00Z', 6.03);
    const { result } = renderHook(() => useSimilarFloodEvents([nested, earlier, broad], 6, now));
    expect(result.current).toEqual([broad, earlier]);
  });
  it('merges overlapping interval chains into one episode and keeps the closest peak', () => {
    const first = event('2026-10-11T11:00:00Z', '2026-10-11T12:00:00Z', 6.02);
    const bridge = event('2026-10-11T11:30:00Z', '2026-10-11T14:30:00Z', 6.04);
    const last = event('2026-10-11T14:00:00Z', '2026-10-11T15:00:00Z', 6.01);
    const { result } = renderHook(() => useSimilarFloodEvents([last, bridge, first], 6, now));
    expect(result.current).toEqual([last]);
  });
  it('does not include future, distant-height or invalid events', () => {
    const future = event('2026-10-18T11:00:00Z', '2026-10-18T15:00:00Z', 6);
    const distant = event('2026-10-11T11:00:00Z', '2026-10-11T15:00:00Z', 7);
    const invalid = { ...distant, peakValue: 6, startTime: 'invalid' };
    const { result } = renderHook(() => useSimilarFloodEvents([future, distant, invalid], 6, now));
    expect(result.current).toEqual([]);
  });
});

describe('useHistoricalComparisonEvents & deduplicateFloodEvents', () => {
  it('returns none for empty, null, NaN, or distant-only (>1 ft) inputs', () => {
    const past = event('2026-09-25T22:00:00Z', '2026-09-26T01:00:00Z', 5.70);
    expect(deduplicateFloodEvents(undefined, now)).toEqual([]);
    expect(renderHook(() => useHistoricalComparisonEvents([], 6.5, now)).result.current).toEqual({ matchType: 'none', items: [] });
    expect(renderHook(() => useHistoricalComparisonEvents([past], null, now)).result.current).toEqual({ matchType: 'none', items: [] });
    expect(renderHook(() => useHistoricalComparisonEvents([past], Number.NaN, now)).result.current).toEqual({ matchType: 'none', items: [] });
    expect(renderHook(() => useHistoricalComparisonEvents([past], 7.0, now)).result.current).toEqual({ matchType: 'none', items: [] });
  });

  it('matches similar episodes within ±3 inches and collapses rolling-window duplicates', () => {
    const dupA = event('2026-09-25T22:00:00Z', '2026-09-26T01:00:00Z', 6.51);
    const dupB = event('2026-09-25T22:30:00Z', '2026-09-26T01:00:00Z', 6.51);
    const older = event('2026-09-24T22:00:00Z', '2026-09-25T01:00:00Z', 6.48);
    const { result } = renderHook(() => useHistoricalComparisonEvents([dupA, dupB, older], 6.63, now));
    expect(result.current.matchType).toBe('similar');
    expect(result.current.items.map(i => i.event.peakValue)).toEqual([6.51, 6.48]);
    expect(result.current.items.map(i => i.deltaInches)).toEqual([-1, -2]);
  });

  it('falls back to closest on record with exact signed inch deltas when forecast exceeds recorded peaks', () => {
    const record = event('2026-09-25T22:00:00Z', '2026-09-26T01:00:00Z', 6.51);
    const second = event('2026-10-10T12:00:00Z', '2026-10-10T14:30:00Z', 6.20);
    const { result } = renderHook(() => useHistoricalComparisonEvents([second, record], 6.94, now));
    expect(result.current.matchType).toBe('closest');
    expect(result.current.items.map(i => i.event.peakValue)).toEqual([6.51, 6.20]);
    expect(result.current.items.map(i => i.deltaInches)).toEqual([-5, -9]);
  });
});

import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSimilarFloodEvents } from 'src/components/dashboard/useSimilarFloodEvents';
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

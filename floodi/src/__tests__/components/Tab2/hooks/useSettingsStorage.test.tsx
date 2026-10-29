import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STALE_ABSOLUTE_VIEWPORT_MS,
  useSettingsStorage,
} from 'src/components/Tab2/hooks/useSettingsStorage';

describe('useSettingsStorage viewport expiry & canonical threshold migration', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T12:00:00.000Z'));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it('recovers pre-fix or corrupted absolute ranges missing rangeSavedAt back to relative Live mode', () => {
    window.localStorage.setItem('floodi.hist.rangeMode', 'absolute');
    window.localStorage.setItem('floodi.hist.absStart', '2026-10-27T00:00:00.000Z');
    window.localStorage.setItem('floodi.hist.absEnd', '2026-10-28T12:00:00.000Z');

    const { result } = renderHook(() => useSettingsStorage());
    expect(result.current.config.timeRange.mode).toBe('relative');
    expect(Date.parse(result.current.config.timeRange.absEnd)).toBe(
      Date.parse('2026-10-31T12:00:00.000Z')
    );
    expect(window.localStorage.getItem('floodi.hist.rangeMode')).toBe('relative');
  });

  it('rejects malformed or inverted absolute timestamps even when rangeSavedAt is recent', () => {
    window.localStorage.setItem('floodi.hist.rangeMode', 'absolute');
    window.localStorage.setItem('floodi.hist.rangeSavedAt', String(Date.now() - 60_000));
    window.localStorage.setItem('floodi.hist.absStart', '2026-10-29T18:00:00.000Z');
    window.localStorage.setItem('floodi.hist.absEnd', '2026-10-29T10:00:00.000Z');

    const { result } = renderHook(() => useSettingsStorage());
    expect(result.current.config.timeRange.mode).toBe('relative');
    expect(window.localStorage.getItem('floodi.hist.rangeSavedAt')).toBeNull();
  });

  it('persists a fresh absolute pan across an immediate reload, then auto-expires after 30 minutes', () => {
    const first = renderHook(() => useSettingsStorage());
    act(() => {
      first.result.current.updateTimeRange({
        mode: 'absolute',
        absStart: '2026-10-28T00:00:00.000Z',
        absEnd: '2026-10-29T00:00:00.000Z',
      });
    });
    expect(first.result.current.config.timeRange.mode).toBe('absolute');
    expect(Number(window.localStorage.getItem('floodi.hist.rangeSavedAt'))).toBe(Date.now());
    first.unmount();

    // Reload 10 minutes later -> still within 30-min window, preserves user's inspection range
    vi.advanceTimersByTime(10 * 60_000);
    const second = renderHook(() => useSettingsStorage());
    expect(second.result.current.config.timeRange.mode).toBe('absolute');
    expect(second.result.current.config.timeRange.absStart).toBe('2026-10-28T00:00:00.000Z');
    second.unmount();

    // Reload 25 minutes later (35 minutes total > STALE_ABSOLUTE_VIEWPORT_MS) -> expires to Live!
    vi.advanceTimersByTime(STALE_ABSOLUTE_VIEWPORT_MS);
    const third = renderHook(() => useSettingsStorage());
    expect(third.result.current.config.timeRange.mode).toBe('relative');
    expect(window.localStorage.getItem('floodi.hist.rangeSavedAt')).toBeNull();
    expect(window.localStorage.getItem('floodi.hist.rangeMode')).toBe('relative');
  });

  it('clears rangeSavedAt and restores relative Live window immediately when resetToLive is called', () => {
    const { result } = renderHook(() => useSettingsStorage());
    act(() => {
      result.current.updateTimeRange({
        mode: 'absolute',
        absStart: '2026-10-25T00:00:00.000Z',
        absEnd: '2026-10-26T00:00:00.000Z',
      });
    });
    expect(result.current.config.timeRange.mode).toBe('absolute');

    act(() => {
      result.current.resetToLive();
    });
    expect(result.current.config.timeRange.mode).toBe('relative');
    expect(window.localStorage.getItem('floodi.hist.rangeSavedAt')).toBeNull();
    expect(window.localStorage.getItem('floodi.hist.rangeMode')).toBe('relative');
  });

  it('migrates stale legacy Carolina Beach 6.2 / 6.8 thresholds to canonical 5.6 / 7.0 / 7.7 / 8.5', () => {
    window.localStorage.setItem(
      'floodi.thresholds',
      JSON.stringify({ minor: 5.6, moderate: 6.2, major: 6.8, extreme: 8.5 })
    );
    const { result } = renderHook(() => useSettingsStorage());
    expect(result.current.config.thresholds).toEqual({
      minor: 5.6,
      moderate: 7.0,
      major: 7.7,
      extreme: 8.5,
    });
  });
});


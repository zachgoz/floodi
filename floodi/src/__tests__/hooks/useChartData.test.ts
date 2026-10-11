import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChartData } from 'src/components/Tab2/hooks/useChartData';
import type { AppConfiguration } from 'src/components/Tab2/types';
import { fetchUnifiedObservations, clearDataServiceCache } from 'src/lib/dataService';

vi.mock('src/lib/dataService', () => ({
  fetchUnifiedObservations: vi.fn(),
  fetchUnifiedPredictions: vi.fn(async () => ({ data: {}, weather: {} })),
  fetchFloodEvents: vi.fn(async () => []),
  extractWeatherData: vi.fn(() => ({ wind: {}, precip: {} })),
  clearDataServiceCache: vi.fn(),
}));
vi.mock('src/lib/noaa', () => ({
  buildAdjustedFuture: vi.fn(async () => ({ adjusted: {}, offset: 0, timeOffsetMins: 0, source: 'noaa', n: 0 })),
  fetchPredictions: vi.fn(async () => ({})),
}));

const config: AppConfiguration = {
  locationId: 'carolina-beach', location: { id: 'carolina-beach', name: 'Carolina Beach', state: 'NC' },
  station: { id: '8658163', name: 'Carolina Beach' },
  thresholds: { minor: 5.6, moderate: 7, major: 7.7, extreme: 8.5 },
  offset: { mode: 'auto', value: '' },
  timeRange: { mode: 'relative', lookbackH: 36, lookaheadH: 48, absStart: '', absEnd: '' },
  display: { timezone: 'local', showDelta: false, dataSource: 'noaa', viewMode: 'basic' },
};
function readings(level: number) {
  return { noaa: { [new Date(Date.now() - 6 * 60_000).toISOString()]: level }, fiman: {}, imagery: {}, weather: {} };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}
let sequence = 0;

describe('useChartData refresh ordering', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Distinct day buffers isolate this test from the module-level reading cache.
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 12 + sequence++)));
    vi.clearAllMocks();
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('keeps refreshed observations when an older initial read completes afterward', async () => {
    const earlier = deferred<ReturnType<typeof readings>>();
    vi.mocked(fetchUnifiedObservations).mockReturnValueOnce(earlier.promise).mockResolvedValueOnce(readings(6.2));
    const { result } = renderHook(() => useChartData(config));
    await act(async () => { await result.current.refresh(); });
    expect(clearDataServiceCache).toHaveBeenCalledTimes(1);
    expect(result.current.processedData.observedPoints.at(-1)?.v).toBe(6.2);
    await act(async () => { earlier.resolve(readings(4)); });
    expect(result.current.processedData.observedPoints.at(-1)?.v).toBe(6.2);
  });

  it('ignores a pending refresh after the user changes the selected source', async () => {
    const pending = deferred<ReturnType<typeof readings>>();
    vi.mocked(fetchUnifiedObservations).mockResolvedValueOnce(readings(4)).mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ ...readings(4), fiman: { [new Date(Date.now() - 6 * 60_000).toISOString()]: 6.3 } });
    const { result, rerender } = renderHook(({ settings }) => useChartData(settings), { initialProps: { settings: config } });
    await act(async () => {});
    let refresh!: Promise<void>;
    act(() => { refresh = result.current.refresh(); });
    rerender({ settings: { ...config, display: { ...config.display, dataSource: 'fiman' } } });
    await act(async () => {});
    expect(result.current.processedData.source).toBe('fiman');
    expect(result.current.processedData.observedPoints.at(-1)?.v).toBe(6.3);
    await act(async () => { pending.resolve(readings(4.1)); await refresh; });
    expect(result.current.processedData.source).toBe('fiman');
    expect(result.current.processedData.observedPoints.at(-1)?.v).toBe(6.3);
  });
  it('finishes loading when a newer refresh fails during the initial read', async () => {
    const earlier = deferred<ReturnType<typeof readings>>();
    vi.mocked(fetchUnifiedObservations).mockReturnValueOnce(earlier.promise)
      .mockRejectedValueOnce(new Error('Refresh failed'));
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useChartData(config));
    await act(async () => { await expect(result.current.refresh()).rejects.toThrow('Refresh failed'); });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('Refresh failed');
    await act(async () => { earlier.resolve(readings(4)); });
    expect(result.current.error).toBe('Refresh failed');
    warn.mockRestore();
  });
});

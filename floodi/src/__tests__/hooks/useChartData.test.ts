import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChartData } from 'src/components/Tab2/hooks/useChartData';
import type { AppConfiguration } from 'src/components/Tab2/types';
import { fetchPredictions as fetchNoaaPredictions } from 'src/lib/noaa';
import { fetchUnifiedObservations, fetchUnifiedPredictions, fetchFloodEvents, clearDataServiceCache, extractWeatherData } from 'src/lib/dataService';

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
    vi.mocked(fetchUnifiedObservations).mockReset();
    vi.mocked(fetchUnifiedPredictions).mockReset().mockResolvedValue({ data: {}, weather: {} });
    vi.mocked(fetchFloodEvents).mockReset().mockResolvedValue([]);
    vi.mocked(fetchNoaaPredictions).mockReset().mockResolvedValue({});
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
  it('keeps a missing legacy weather direction unknown while retaining its measured speed', async () => {
    vi.mocked(fetchUnifiedObservations).mockResolvedValueOnce(readings(4));
    vi.mocked(extractWeatherData).mockReturnValueOnce({ wind: { [new Date().toISOString()]: { speed: 12, dir: 'variable' as unknown as number } }, precip: {} });
    const { result } = renderHook(() => useChartData(config));
    await act(async () => {});
    expect(result.current.processedData.windPoints[0].speed).toBe(12);
    expect(result.current.processedData.windPoints[0].dir).toBeNaN();
  });
  it('renders essential data before an optional event query or buffered history resolves', async () => {
    const buffered = deferred<ReturnType<typeof readings>>();
    vi.mocked(fetchUnifiedObservations).mockResolvedValueOnce(readings(4.2)).mockReturnValueOnce(buffered.promise);
    vi.mocked(fetchFloodEvents).mockImplementation(() => new Promise<Awaited<ReturnType<typeof fetchFloodEvents>>>(() => {}));
    const { result } = renderHook(() => useChartData(config));
    await act(async () => {});
    expect(result.current.loading).toBe(false);
    expect(result.current.processedData.observedPoints.at(-1)?.v).toBe(4.2);
    expect(fetchUnifiedObservations).toHaveBeenCalledWith('carolina-beach', new Date(Date.now() - 36 * 3600_000), new Date(Date.now() + 48 * 3600_000));
    expect(fetchFloodEvents).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(fetchUnifiedObservations).toHaveBeenCalledTimes(2);
    expect(fetchFloodEvents).toHaveBeenCalledOnce();
    expect(result.current.loading).toBe(false);
    expect(result.current.processedData.observedPoints.at(-1)?.v).toBe(4.2);
  });

  it('retains current gauge context when reopening a recent historical viewport', async () => {
    vi.mocked(fetchUnifiedObservations).mockResolvedValue(readings(4));
    const historical = { ...config, timeRange: { ...config.timeRange, mode: 'absolute' as const,
      absStart: new Date(Date.now() - 3 * 86400_000).toISOString(),
      absEnd: new Date(Date.now() - 2 * 86400_000).toISOString() } };
    renderHook(() => useChartData(historical));
    await act(async () => {});
    expect(fetchUnifiedObservations).toHaveBeenCalledWith('carolina-beach', new Date(historical.timeRange.absStart), new Date(Date.now()));
  });

  it('warms the original complete history/horizon without changing the selected viewport', async () => {
    const old = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
    vi.mocked(fetchUnifiedObservations).mockResolvedValueOnce(readings(4.2))
      .mockResolvedValueOnce({ ...readings(4.3), noaa: { [old]: 3, ...readings(4.3).noaa } });
    const { result } = renderHook(() => useChartData(config));
    await act(async () => {});
    const original = result.current.processedData.timeDomain;
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(result.current.processedData.timeDomain).toBe(original);
    expect(result.current.processedData.loadedDomain.start).toEqual(new Date(+original.start - 14 * 86400_000));
    expect(result.current.processedData.loadedDomain.end).toEqual(new Date(+original.end + 14 * 86400_000));
    expect(result.current.processedData.observedPoints[0].t).toEqual(new Date(old));
    expect(result.current.processedData.observedPoints.at(-1)?.v).toBe(4.3);
  });

  it('ignores a late buffered completion after a newer pull-to-refresh', async () => {
    const buffered = deferred<ReturnType<typeof readings>>();
    vi.mocked(fetchUnifiedObservations).mockResolvedValueOnce(readings(4)).mockReturnValueOnce(buffered.promise)
      .mockResolvedValueOnce(readings(6.1));
    const { result } = renderHook(() => useChartData(config));
    await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    await act(async () => { await result.current.refresh(); });
    expect(result.current.processedData.observedPoints.at(-1)?.v).toBe(6.1);
    await act(async () => { buffered.resolve(readings(2)); });
    expect(result.current.processedData.observedPoints.at(-1)?.v).toBe(6.1);
  });

  it('does not fetch beyond a healthy cached forecast until the buffer warms', async () => {
    vi.mocked(fetchUnifiedObservations).mockResolvedValue(readings(4));
    vi.mocked(fetchUnifiedPredictions).mockResolvedValue({ data: { [new Date(Date.now() + 15 * 86400_000).toISOString()]: 4 }, weather: {} });
    renderHook(() => useChartData(config));
    await act(async () => {});
    expect(fetchNoaaPredictions).not.toHaveBeenCalled();
    const bufferedEnd = new Date(Date.now() + 48 * 3600_000 + 14 * 86400_000);
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(fetchNoaaPredictions).toHaveBeenCalledWith(expect.objectContaining({ end: bufferedEnd }));
  });

  it('emits one metadata-free chart-ready milestone after usable primary data', async () => {
    const ready = vi.fn();
    window.addEventListener('floodi:chart-ready', ready);
    vi.mocked(fetchUnifiedObservations).mockResolvedValue(readings(4));
    vi.mocked(fetchUnifiedPredictions).mockResolvedValue({ data: { [new Date(Date.now()).toISOString()]: 3, [new Date(Date.now() + 6 * 60_000).toISOString()]: 3.1 }, weather: {} });
    const { result } = renderHook(() => useChartData(config));
    await act(async () => {});
    await act(async () => { await result.current.refresh(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(ready).toHaveBeenCalledOnce();
    expect(ready.mock.calls[0][0]).not.toHaveProperty('detail');
    window.removeEventListener('floodi:chart-ready', ready);
  });

});

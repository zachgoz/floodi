import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDoc } from 'firebase/firestore';
import type { ForecastDocument } from '../../../../functions/src/forecast/schema';
import { useFloodOutlook } from 'src/components/dashboard/useFloodOutlook';

vi.mock('src/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), getDoc: vi.fn() }));

const now = new Date('2026-10-11T12:00:00Z');
const fetchMock = vi.fn();
const metrics = { samples: 150, maeFt: .2, peakMaeFt: null, onsetMaeMinutes: null, durationMaeMinutes: null, hits: null, misses: null, falseAlarms: null, matchedEvents: null };
const snapshot = (value: unknown) => ({ data: () => value }) as Awaited<ReturnType<typeof getDoc>>;
const response = (value: unknown) => ({ ok: true, json: async () => value }) as Response;

function forecast(issuedAt = now, validForMs = 2 * 3600_000): ForecastDocument {
  return {
    version: 1, status: 'available', method: 'residual-response', confidence: 'limited', validationStage: 'historical-hindcast',
    generatedAt: issuedAt.toISOString(), expiresAt: new Date(+issuedAt + validForMs).toISOString(),
    locationId: 'carolina-beach', sensor: '30046', tideStation: '8658163', datum: 'MLLW', units: 'ft', phaseMinutes: 60, thresholdFt: 5.6,
    currentResidualFt: .7, observationAt: issuedAt.toISOString(), forecastOriginAt: issuedAt.toISOString(), trend: 'Increasing',
    points: [0, 6].map((minutes, index) => ({ t: new Date(+issuedAt + minutes * 60_000).toISOString(), tideFt: 4 + index * .1, residualFt: .7, totalFt: 4.7 + index * .1, lowerFt: 4.3 + index * .1, upperFt: 5.1 + index * .1 })),
    validation: { kind: 'chronological-weather-response-hindcast', trainEnd: '2026-09-05T00:00:00Z', testStart: '2026-09-06T00:00:00Z', testEnd: '2026-10-02T00:00:00Z', trainingSamples: 500, model: metrics, persistence: { ...metrics, maeFt: .3 }, tideOnly: metrics, error90Ft: .4, limitation: 'Weather reanalysis hindcast.' },
    leadValidation: [1, 3, 6].map(leadHours => ({ leadHours, testPairs: 150, modelMaeFt: .2, persistenceMaeFt: .3, absoluteError90Ft: .4 })),
    evidence: [{ id: 'availability', text: 'Point-level validation is available.' }], explanation: { headline: 'Flood outlook', evidenceIds: ['availability'] }, explanationSource: 'fallback', sources: ['Observed gauge'], limitations: ['Weather reanalysis hindcast'],
  };
}

async function settle() {
  await act(async () => {});
}

describe('useFloodOutlook cached refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.clearAllMocks();
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error('Offline'));
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(getDoc).mockResolvedValue(snapshot(undefined));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reads a fresh local cache without inference or a Firestore request', async () => {
    const value = forecast();
    fetchMock.mockResolvedValue(response(value));
    const { result } = renderHook(() => useFloodOutlook('carolina-beach'));
    await settle();
    expect(result.current.outlook).toEqual(value);
    expect(getDoc).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith('/api/outlook', expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['http', 'json', 'network'] as const)('uses Firestore after a local %s failure', async failure => {
    if (failure === 'http') fetchMock.mockResolvedValue({ ok: false } as Response);
    if (failure === 'json') fetchMock.mockResolvedValue({ ok: true, json: async () => { throw new Error('Malformed JSON'); } } as unknown as Response);
    const value = forecast();
    vi.mocked(getDoc).mockResolvedValue(snapshot(value));
    const { result } = renderHook(() => useFloodOutlook('carolina-beach'));
    await settle();
    expect(result.current.outlook).toEqual(value);
    expect(getDoc).toHaveBeenCalledTimes(1);
  });

  it('retains a valid forecast through a failed poll and recovers on the 30-second retry', async () => {
    const first = forecast();
    fetchMock.mockResolvedValueOnce(response(first));
    const { result } = renderHook(() => useFloodOutlook('carolina-beach'));
    await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
    expect(result.current.outlook).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(29_999); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const recovered = forecast(new Date(Date.now() + 1));
    fetchMock.mockResolvedValueOnce(response(recovered));
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result.current.outlook).toEqual(recovered);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('clears a forecast at expiry even while a refresh is still pending', async () => {
    fetchMock.mockResolvedValueOnce(response(forecast(now, 60_000)));
    const { result } = renderHook(() => useFloodOutlook('carolina-beach'));
    await settle();
    fetchMock.mockImplementationOnce(() => new Promise<Response>(() => {}));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(result.current.outlook).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('bounds a hanging HTTP read, retains a valid cache and recovers without accepting its late result', async () => {
    const first = forecast();
    fetchMock.mockResolvedValueOnce(response(first));
    const { result } = renderHook(() => useFloodOutlook('carolina-beach'));
    await settle();
    let complete!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { complete = resolve; }));
    let pending!: Promise<void>;
    act(() => { pending = result.current.refresh(); });
    const signal = (fetchMock.mock.calls[1][1] as RequestInit).signal!;
    await act(async () => { await vi.advanceTimersByTimeAsync(19_999); });
    expect(signal.aborted).toBe(false);
    expect(result.current.outlook).toEqual(first);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); await pending; });
    expect(signal.aborted).toBe(true);
    expect(result.current.outlook).toEqual(first);
    const recovered = forecast(new Date(Date.now() + 30_000));
    recovered.trend = 'Decreasing';
    fetchMock.mockResolvedValueOnce(response(recovered));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(result.current.outlook).toEqual(recovered);
    await act(async () => { complete(response(first)); });
    expect(result.current.outlook).toEqual(recovered);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('releases a hanging Firestore read after its deadline and ignores its late result', async () => {
    let complete!: (value: Awaited<ReturnType<typeof getDoc>>) => void;
    vi.mocked(getDoc).mockImplementationOnce(() => new Promise<Awaited<ReturnType<typeof getDoc>>>(resolve => { complete = resolve; }));
    const { result } = renderHook(() => useFloodOutlook('carolina-beach'));
    await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(result.current.outlook).toBeNull();
    const recovered = forecast(new Date(Date.now()));
    recovered.trend = 'Decreasing';
    fetchMock.mockResolvedValueOnce(response(recovered));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.outlook).toEqual(recovered);
    await act(async () => { complete(snapshot(forecast())); });
    expect(result.current.outlook).toEqual(recovered);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('deduplicates manual, focus and online refreshes while a request is pending', async () => {
    fetchMock.mockResolvedValueOnce(response(forecast()));
    const { result, rerender } = renderHook(() => useFloodOutlook('carolina-beach'));
    await settle();
    const refresh = result.current.refresh;
    let complete!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { complete = resolve; }));
    let manual!: Promise<void>;
    act(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
      manual = result.current.refresh();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const updated = forecast();
    updated.trend = 'Decreasing';
    await act(async () => { complete(response(updated)); await manual; });
    expect(result.current.outlook).toEqual(updated);
    rerender();
    expect(result.current.refresh).toBe(refresh);
  });

  it('refreshes when the document becomes visible and ignores hidden visibility changes', async () => {
    fetchMock.mockResolvedValue(response(forecast()));
    const { result } = renderHook(() => useFloodOutlook('carolina-beach'));
    await settle();
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.outlook).not.toBeNull();
  });

  it.each(['expired', 'future', 'datum', 'numeric', 'location'] as const)('rejects a cached forecast with invalid %s metadata', async failure => {
    const value = forecast();
    if (failure === 'expired') value.expiresAt = now.toISOString();
    if (failure === 'future') value.generatedAt = new Date(+now + 60_000).toISOString();
    if (failure === 'numeric') value.points[0].totalFt = Number.NaN;
    if (failure === 'location') value.locationId = 'other-location';
    const input = failure === 'datum' ? { ...value, datum: 'NAVD88' } : value;
    fetchMock.mockResolvedValue(response(input));
    const { result } = renderHook(() => useFloodOutlook('carolina-beach'));
    await settle();
    expect(result.current.outlook).toBeNull();
    expect(getDoc).toHaveBeenCalledTimes(1);
  });

  it('aborts pending HTTP reads and removes timers and listeners on unmount', async () => {
    let complete!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { complete = resolve; }));
    const { unmount } = renderHook(() => useFloodOutlook('carolina-beach'));
    const signal = (fetchMock.mock.calls[0][1] as RequestInit).signal!;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => { complete(response(forecast())); });
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getDoc).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores a Firestore result that arrives after unmount', async () => {
    let complete!: (value: Awaited<ReturnType<typeof getDoc>>) => void;
    vi.mocked(getDoc).mockImplementationOnce(() => new Promise<Awaited<ReturnType<typeof getDoc>>>(resolve => { complete = resolve; }));
    const { unmount } = renderHook(() => useFloodOutlook('carolina-beach'));
    await settle();
    unmount();
    await act(async () => { complete(snapshot(forecast())); });
    expect(vi.getTimerCount()).toBe(0);
  });
});

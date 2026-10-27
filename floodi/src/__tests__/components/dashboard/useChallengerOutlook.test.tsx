import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDoc } from 'firebase/firestore';
import { useChallengerOutlook } from 'src/components/dashboard/useChallengerOutlook';

vi.mock('src/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), getDoc: vi.fn() }));

const now = new Date('2026-10-27T12:00:00Z');
const fetchMock = vi.fn();

const validDoc = {
  challengerId: 'timesfm-3',
  locationId: 'carolina-beach',
  generatedAt: now.toISOString(),
  expiresAt: new Date(+now + 3600_000).toISOString(),
  status: 'available' as const,
  engine: 'timesfm-3-vertex-etss-hybrid',
  horizonSteps: 48,
  thresholdFt: 5.6,
  points: [
    {
      t: new Date(+now + 1800_000).toISOString(),
      totalFt: 5.2,
      tideFt: 4.0,
      residualFt: 1.2,
      lowerFt: 4.8,
      upperFt: 5.6,
      noaaSurgeFt: 1.1,
    },
    {
      t: new Date(+now + 3600_000).toISOString(),
      totalFt: 5.8,
      tideFt: 4.2,
      residualFt: 1.6,
      lowerFt: 5.3,
      upperFt: 6.3,
      noaaSurgeFt: 1.5,
    },
  ],
  peak: {
    t: new Date(+now + 3600_000).toISOString(),
    totalFt: 5.8,
    tideFt: 4.2,
    residualFt: 1.6,
    exceedsThreshold: true,
  },
  covariatesUsed: ['noaa-etss-surge'],
};

describe('useChallengerOutlook hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fetches challenger document from /api/challenger successfully', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => validDoc,
    });

    const { result } = renderHook(() => useChallengerOutlook('carolina-beach'));

    expect(result.current.loading).toBe(true);
    await act(async () => {});

    expect(result.current.loading).toBe(false);
    expect(result.current.challenger).toEqual(validDoc);
    expect(result.current.totalPoints).toHaveLength(2);
    expect(result.current.totalPoints[0].v).toBe(5.2);
    expect(result.current.lowerPoints).toHaveLength(2);
    expect(result.current.lowerPoints[0].v).toBe(4.8);
    expect(result.current.upperPoints).toHaveLength(2);
    expect(result.current.upperPoints[0].v).toBe(5.6);
    expect(result.current.residualPoints).toHaveLength(2);
    expect(result.current.residualPoints[0].v).toBe(1.2);
  });

  it('falls back to Firestore when HTTP fetch fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Network error'));
    vi.mocked(getDoc).mockResolvedValueOnce({
      exists: () => true,
      data: () => validDoc,
    } as any);

    const { result } = renderHook(() => useChallengerOutlook('carolina-beach'));

    await act(async () => {});

    expect(result.current.challenger).toEqual(validDoc);
    expect(result.current.totalPoints).toHaveLength(2);
    expect(vi.mocked(getDoc)).toHaveBeenCalled();
  });

  it('ignores document if locationId does not match', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...validDoc, locationId: 'other-location' }),
    });
    vi.mocked(getDoc).mockResolvedValueOnce({
      exists: () => false,
      data: () => undefined,
    } as any);

    const { result } = renderHook(() => useChallengerOutlook('carolina-beach'));

    await act(async () => {});

    expect(result.current.challenger).toBeNull();
    expect(result.current.totalPoints).toHaveLength(0);
  });
});

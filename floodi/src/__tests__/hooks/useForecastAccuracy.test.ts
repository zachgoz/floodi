import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useForecastAccuracy, AUDITED_BASELINE_ACCURACY } from 'src/components/dashboard/useForecastAccuracy';

describe('useForecastAccuracy hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('initializes immediately with audited baseline constants before fetch returns', () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(() => {})));
    const { result } = renderHook(() => useForecastAccuracy('carolina-beach'));

    expect(result.current.accuracy.locationId).toBe('carolina-beach');
    expect(result.current.accuracy.mae24hInches).toBe(2.4);
    expect(result.current.accuracy.mae1hInches).toBe(1.4);
    expect(result.current.accuracy.isAuditedBaseline).toBe(true);
    expect(result.current.accuracy.leads).toHaveLength(7);
  });

  it('updates dynamically when API returns valid rolling accuracy payload', async () => {
    const mockApiResponse = {
      version: 1,
      locationId: 'carolina-beach',
      generatedAt: '2026-11-03T06:40:00Z',
      periodDays: 30,
      sampleCount: 220,
      mae24hInches: 2.3,
      mae24hFt: 0.192,
      mae1hInches: 1.3,
      mae1hFt: 0.108,
      crestTimingMinutes: 25.4,
      errorReductionPct: 78,
      leads: [
        { leadHours: 1, floodCastMaeInches: 1.3, floodCastMaeFt: 0.108, p90Inches: 2.7, p90Ft: 0.225, tideOnlyMaeInches: 5.8, tideOnlyMaeFt: 0.483, persistenceMaeInches: 1.7, persistenceMaeFt: 0.142, samples: 220 },
        { leadHours: 3, floodCastMaeInches: 1.6, floodCastMaeFt: 0.133, p90Inches: 3.3, p90Ft: 0.275, tideOnlyMaeInches: 6.0, tideOnlyMaeFt: 0.500, persistenceMaeInches: 3.7, persistenceMaeFt: 0.308, samples: 220 },
        { leadHours: 6, floodCastMaeInches: 1.9, floodCastMaeFt: 0.158, p90Inches: 3.9, p90Ft: 0.325, tideOnlyMaeInches: 6.2, tideOnlyMaeFt: 0.517, persistenceMaeInches: 6.0, persistenceMaeFt: 0.500, samples: 220 },
        { leadHours: 12, floodCastMaeInches: 2.1, floodCastMaeFt: 0.175, p90Inches: 4.4, p90Ft: 0.367, tideOnlyMaeInches: 6.3, tideOnlyMaeFt: 0.525, persistenceMaeInches: 7.7, persistenceMaeFt: 0.642, samples: 220 },
        { leadHours: 24, floodCastMaeInches: 2.3, floodCastMaeFt: 0.192, p90Inches: 4.8, p90Ft: 0.400, tideOnlyMaeInches: 6.5, tideOnlyMaeFt: 0.542, persistenceMaeInches: 8.8, persistenceMaeFt: 0.733, samples: 220 },
        { leadHours: 48, floodCastMaeInches: 3.0, floodCastMaeFt: 0.250, p90Inches: 6.0, p90Ft: 0.500, tideOnlyMaeInches: 6.7, tideOnlyMaeFt: 0.558, persistenceMaeInches: 9.4, persistenceMaeFt: 0.783, samples: 220 },
        { leadHours: 72, floodCastMaeInches: 3.7, floodCastMaeFt: 0.308, p90Inches: 7.2, p90Ft: 0.600, tideOnlyMaeInches: 7.0, tideOnlyMaeFt: 0.583, persistenceMaeInches: 9.7, persistenceMaeFt: 0.808, samples: 220 },
      ],
      isAuditedBaseline: false,
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockApiResponse,
    }));

    const { result } = renderHook(() => useForecastAccuracy('carolina-beach'));

    await waitFor(() => {
      expect(result.current.accuracy.mae24hInches).toBe(2.3);
      expect(result.current.accuracy.isAuditedBaseline).toBe(false);
      expect(result.current.accuracy.sampleCount).toBe(220);
    });
  });

  it('preserves baseline values if API returns an error status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }));

    const { result } = renderHook(() => useForecastAccuracy('carolina-beach'));

    await waitFor(() => {
      expect(result.current.error).toMatch(/HTTP 500/);
      expect(result.current.accuracy.mae24hInches).toBe(2.4);
    });
  });
});


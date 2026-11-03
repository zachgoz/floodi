import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  useForecastDiagnostics,
  AUDITED_BASELINE_DIAGNOSTICS,
} from 'src/components/dashboard/useForecastDiagnostics';

describe('useForecastDiagnostics Hook', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('initializes with audited baseline diagnostics', () => {
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useForecastDiagnostics('carolina-beach'));

    expect(result.current.diagnostics.locationId).toBe('carolina-beach');
    expect(result.current.diagnostics.isAuditedBaseline).toBe(true);
    expect(result.current.diagnostics.rolling30dMaeInches).toBe(2.4);
    expect(result.current.diagnostics.rolling7dMaeInches).toBe(2.2);
    expect(result.current.diagnostics.overallStatus).toBe('optimal');
    expect(result.current.diagnostics.regimeMetrics).toHaveLength(3);
    expect(result.current.diagnostics.quadrantMetrics).toHaveLength(4);
    expect(result.current.diagnostics.activeProposals).toHaveLength(2);
    expect(result.current.diagnostics.recentAnomalies).toHaveLength(2);
  });

  it('updates state when API returns valid diagnostics data', async () => {
    const mockApiResponse = {
      version: 1,
      locationId: 'carolina-beach',
      generatedAt: '2026-11-03T14:00:00.000Z',
      periodDays: 30,
      overallStatus: 'stable',
      rolling7dMaeInches: 2.1,
      rolling30dMaeInches: 2.3,
      driftDeltaInches: -0.2,
      systematicBiasInches: 0.2,
      biasDirection: 'running_high',
      regimeMetrics: [
        { regime: 'calm', samples: 90, maeInches: 1.7, biasInches: 0.1 },
        { regime: 'moderate', samples: 80, maeInches: 2.2, biasInches: 0.2 },
        { regime: 'squall', samples: 35, maeInches: 3.2, biasInches: -0.3 },
      ],
      quadrantMetrics: [
        { quadrant: 'NE', samples: 70, maeInches: 2.7, biasInches: 0.3 },
        { quadrant: 'SE', samples: 50, maeInches: 2.1, biasInches: 0.1 },
        { quadrant: 'SW', samples: 45, maeInches: 2.0, biasInches: 0.1 },
        { quadrant: 'NW', samples: 40, maeInches: 1.9, biasInches: 0.2 },
      ],
      recentAnomalies: [],
      activeProposals: [
        {
          proposalId: 'prop-test-01',
          generatedAt: '2026-11-03T14:00:00.000Z',
          status: 'active',
          category: 'drag_physics',
          targetParameter: 'basinPhysics.ts:directionalWindStress',
          currentValueDescription: 'Cd(W) = 1.0 + 0.02 * max(0, W - 20)',
          proposedValueDescription: 'Cd(W) = 1.0 + 0.025 * max(0, W - 20)',
          triggerReason: 'Squall error calibration',
          estimatedMaeReductionInches: 0.3,
          confidence: 'high',
          actionableDiffHint: 'const Cd = 1.025;',
        },
      ],
      isAuditedBaseline: false,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockApiResponse,
    } as Response);

    const { result } = renderHook(() => useForecastDiagnostics('carolina-beach'));

    await waitFor(() => {
      expect(result.current.diagnostics.isAuditedBaseline).toBe(false);
      expect(result.current.diagnostics.overallStatus).toBe('stable');
      expect(result.current.diagnostics.rolling7dMaeInches).toBe(2.1);
      expect(result.current.diagnostics.rolling30dMaeInches).toBe(2.3);
      expect(result.current.diagnostics.activeProposals).toHaveLength(1);
    });
  });

  it('falls back to audited baseline gracefully on HTTP error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    const { result } = renderHook(() => useForecastDiagnostics('carolina-beach'));

    await waitFor(() => {
      expect(result.current.error).toContain('HTTP 500');
      expect(result.current.diagnostics.isAuditedBaseline).toBe(true);
      expect(result.current.diagnostics.rolling30dMaeInches).toBe(AUDITED_BASELINE_DIAGNOSTICS.rolling30dMaeInches);
    });
  });
});

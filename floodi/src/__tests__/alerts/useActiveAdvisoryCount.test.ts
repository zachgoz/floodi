import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useActiveAdvisoryCount } from 'src/components/alerts/useActiveAdvisoryCount';
import * as citizenAlerts from 'src/lib/citizenAlerts';

describe('useActiveAdvisoryCount', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes in loading state and resolves 0 advisories when feed is empty', async () => {
    vi.spyOn(citizenAlerts, 'readPublicAlertFeed').mockResolvedValueOnce({
      version: 2,
      locationId: 'carolina-beach',
      generatedAt: '2026-10-29T14:00:00Z',
      forecastGeneratedAt: '2026-10-29T14:00:00Z',
      thresholds: { minor: 5.6, moderate: 7.0, major: 7.7, extreme: 8.5 },
      currentSurgeFt: 0.5,
      nextPeakFt: null,
      nextPeakAt: null,
      activeAdvisories: [],
      recentBulletins: [],
    });

    const { result } = renderHook(() => useActiveAdvisoryCount());
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.count).toBe(0);
    expect(result.current.highestSeverity).toBe(null);
  });

  it('determines highest severity among active advisories correctly', async () => {
    vi.spyOn(citizenAlerts, 'readPublicAlertFeed').mockResolvedValueOnce({
      version: 2,
      locationId: 'carolina-beach',
      generatedAt: '2026-10-29T14:00:00Z',
      forecastGeneratedAt: '2026-10-29T14:00:00Z',
      thresholds: { minor: 5.6, moderate: 7.0, major: 7.7, extreme: 8.5 },
      currentSurgeFt: 0.8,
      nextPeakFt: 7.2,
      nextPeakAt: '2026-10-29T18:00:00Z',
      activeAdvisories: [
        {
          episodeId: 'ep-1',
          severity: 'minor',
          startAt: '2026-10-29T15:00:00Z',
          peakAt: '2026-10-29T16:00:00Z',
          endAt: '2026-10-29T17:00:00Z',
          durationMinutes: 120,
          startClipped: false,
          endClipped: false,
          peakFt: 5.8,
          aboveFloodStageFt: 0.2,
          estimatedStreetDepthIn: 2.4,
          tideFt: 5.0,
          surgeFt: 0.8,
          windSpeedMph: 15,
          windDirectionDeg: 45,
          windCompass: 'NE',
          precipWindowIn: 0,
          drivers: { oceanSurgeFt: 0.8, windSetupFt: 0, riverFlowFt: 0, rainfallRunoffFt: 0, estuarineHarmonicFt: 0 },
        },
        {
          episodeId: 'ep-2',
          severity: 'moderate',
          startAt: '2026-10-30T03:00:00Z',
          peakAt: '2026-10-30T04:30:00Z',
          endAt: '2026-10-30T06:00:00Z',
          durationMinutes: 180,
          startClipped: false,
          endClipped: false,
          peakFt: 7.2,
          aboveFloodStageFt: 0.2,
          estimatedStreetDepthIn: 8.0,
          tideFt: 5.2,
          surgeFt: 2.0,
          windSpeedMph: 25,
          windDirectionDeg: 50,
          windCompass: 'NE',
          precipWindowIn: 0.2,
          drivers: { oceanSurgeFt: 1.5, windSetupFt: 0.4, riverFlowFt: 0.1, rainfallRunoffFt: 0, estuarineHarmonicFt: 0 },
        },
      ],
      recentBulletins: [],
    });

    const { result } = renderHook(() => useActiveAdvisoryCount());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.count).toBe(2);
    expect(result.current.highestSeverity).toBe('moderate');
  });

  it('gracefully handles network error and sets loading to false', async () => {
    vi.spyOn(citizenAlerts, 'readPublicAlertFeed').mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useActiveAdvisoryCount());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.count).toBe(0);
    expect(result.current.highestSeverity).toBe(null);
  });
});


import { describe, it, expect } from 'vitest';
import { reconcileOutlookAdvisories } from 'src/components/alerts/reconcileAdvisories';
import type { PublicFloodAdvisory } from 'src/lib/citizenAlerts';

const thresholds = { minor: 5.6, moderate: 7.0, major: 7.7, extreme: 8.5 };
const now = new Date('2026-10-29T16:00:00Z');
const pt = (minFromNow: number, v: number) => ({ t: new Date(+now + minFromNow * 60_000), v });

const staleBackendAdvisory: PublicFloodAdvisory = {
  episodeId: 'ep-2026-10-29-pm',
  severity: 'minor',
  startAt: '2026-10-29T18:15:00Z',
  endAt: '2026-10-29T20:45:00Z',
  startClipped: false,
  endClipped: false,
  peakAt: '2026-10-29T19:30:00Z',
  peakFt: 6.42,
  aboveFloodStageFt: 0.82,
  tideFt: 5.5,
  surgeFt: 0.92,
  estimatedStreetDepthIn: 9.8,
  durationMinutes: 150,
  windSpeedMph: 22,
  windDirectionDeg: 38,
  windCompass: 'NE',
  precipWindowIn: 0.14,
  drivers: {
    oceanSurgeFt: 0.38,
    windSetupFt: 0.31,
    riverFlowFt: 0.14,
    rainfallRunoffFt: 0.03,
    estuarineHarmonicFt: 0.06,
  },
};

describe('reconcileOutlookAdvisories', () => {
  it('reconciles a stale 30-min backend advisory peak to the exact live 6-min operational forecast peak while preserving drivers', () => {
    // Live 6-min curve crests 6 minutes later at 6.58 ft (instead of backend snapshot's 6.42 ft)
    const liveCurve = [
      pt(0, 4.2),
      pt(120, 5.4),
      pt(135, 5.65),
      pt(150, 5.95),
      pt(165, 6.20),
      pt(180, 6.38),
      pt(195, 6.48),
      pt(210, 6.52),
      pt(216, 6.58), // 19:36Z
      pt(228, 6.30),
      pt(240, 6.02),
      pt(255, 5.72),
      pt(270, 5.48),
    ];

    const result = reconcileOutlookAdvisories({
      feedAdvisories: [staleBackendAdvisory],
      feedNextPeakFt: 6.42,
      feedNextPeakAt: '2026-10-29T19:30:00Z',
      feedCurrentSurgeFt: 0.72,
      operationalForecastPoints: liveCurve,
      predictedPoints: liveCurve.map(p => ({ t: p.t, v: p.v - 0.9 })),
      deltaPoints: [pt(0, 0.85)],
      thresholds,
      now,
    });

    expect(result.advisories).toHaveLength(1);
    const adv = result.advisories[0];
    expect(adv.episodeId).toBe('ep-2026-10-29-pm');
    expect(adv.peakFt).toBe(6.58);
    expect(adv.peakAt).toBe('2026-10-29T19:36:00.000Z');
    expect(adv.fromLiveForecast).toBe(true);
    expect(adv.isExtendedOutlook).toBe(false);
    // Preserves backend physical driver breakdown
    expect(adv.drivers?.oceanSurgeFt).toBe(0.38);
    expect(adv.drivers?.windSetupFt).toBe(0.31);
    // Reconciles 48h summary metrics to live curve
    expect(result.next48hPeak).toEqual({ peakFt: 6.58, peakAt: '2026-10-29T19:36:00.000Z' });
    expect(result.currentSurgeFt).toBe(0.85);
  });

  it('preserves near-threshold probabilistic watches without mislabeling them as Minor Flood and reconciles their central crest', () => {
    const watch: PublicFloodAdvisory = {
      ...staleBackendAdvisory,
      episodeId: 'ep-watch',
      peakFt: 5.35,
      aboveFloodStageFt: 0,
      isProbabilisticWatch: true,
      upperPeakFt: 5.74,
    };
    const belowThresholdCurve = [
      pt(0, 4.0),
      pt(180, 5.20),
      pt(210, 5.44),
      pt(240, 5.10),
    ];

    const result = reconcileOutlookAdvisories({
      feedAdvisories: [watch],
      operationalForecastPoints: belowThresholdCurve,
      thresholds,
      now,
    });

    expect(result.advisories).toHaveLength(1);
    expect(result.advisories[0].isProbabilisticWatch).toBe(true);
    expect(result.advisories[0].peakFt).toBe(5.44);
    expect(result.advisories[0].upperPeakFt).toBe(5.74);
  });

  it('includes extended multi-day flood windows beyond 48 hours and falls back cleanly when live curve is empty', () => {
    const extendedCurve = [
      pt(0, 4.0),
      pt(60 * 60, 5.2),
      pt(62 * 60, 6.15), // +62h (beyond 48h)
      pt(65 * 60, 5.1),
    ];
    const extended = reconcileOutlookAdvisories({
      operationalForecastPoints: extendedCurve,
      thresholds,
      now,
    });
    expect(extended.advisories).toHaveLength(1);
    expect(extended.advisories[0].peakFt).toBe(6.15);
    expect(extended.advisories[0].isExtendedOutlook).toBe(true);

    const fallback = reconcileOutlookAdvisories({
      feedAdvisories: [staleBackendAdvisory],
      feedNextPeakFt: 6.42,
      feedNextPeakAt: '2026-10-29T19:30:00Z',
      feedCurrentSurgeFt: 0.72,
      operationalForecastPoints: [],
      thresholds,
      now,
    });
    expect(fallback.advisories).toHaveLength(1);
    expect(fallback.advisories[0].peakFt).toBe(6.42);
    expect(fallback.advisories[0].fromLiveForecast).toBe(false);
    expect(fallback.next48hPeak).toEqual({ peakFt: 6.42, peakAt: '2026-10-29T19:30:00Z' });
    expect(fallback.currentSurgeFt).toBe(0.72);
  });
});

import { describe, expect, it } from 'vitest';
import {
  selectOperationalSurgeDrivers,
  selectSurgeReadout,
  selectedForecastFactors,
} from 'src/utils/surgeReadout';
import type { ChallengerOutlookDocument } from 'src/components/dashboard/useChallengerOutlook';
import type { ForecastDocument } from '../../../functions/src/forecast/schema';

const t = (hours: number) => new Date(Date.UTC(2026, 9, 16) + hours * 3600_000);
const point = (hours: number, v: number) => ({ t: t(hours), v });

describe('selected surge readout', () => {
  const observed = [point(0, 0.2), point(1, 0.4)],
    bridge = [point(1, 0.4), point(2, 0.5)],
    forecast = [point(1, 0.4), point(2, 0.5), point(4, 1.7)];
  it('follows the same focus time across observed, bridge and future lines', () => {
    expect(selectSurgeReadout(observed, bridge, forecast, t(0))?.source).toBe('Observed');
    expect(selectSurgeReadout(observed, bridge, forecast, t(0.5))?.value).toBeCloseTo(0.3);
    expect(selectSurgeReadout(observed, bridge, forecast, t(1.5))?.source).toBe('Estimated');
    expect(selectSurgeReadout(observed, bridge, forecast, t(3))).toMatchObject({
      value: 1.1,
      source: 'Forecast',
    });
  });
  it('never extrapolates a line or presents missing live data as a new observation', () => {
    expect(selectSurgeReadout(observed, [], forecast, t(5))).toBeNull();
    expect(selectSurgeReadout(observed, [], [], t(2), true)).toMatchObject({
      value: 0.4,
      at: t(1),
      source: 'Latest observation',
    });
    expect(selectSurgeReadout([], [], [], t(2), true)).toBeNull();
    expect(selectSurgeReadout([point(0, NaN)], [], [], t(0))).toBeNull();
  });
  it('labels visually connected measured gaps as interpolated', () => {
    expect(selectSurgeReadout([point(0, 0.2), point(4, 0.6)], [], [], t(2))).toMatchObject({
      value: 0.4,
      source: 'Interpolated',
      interpolated: true,
    });
  });
});

describe('operational physical surge drivers', () => {
  const challenger: ChallengerOutlookDocument = {
    challengerId: 'timesfm-3',
    locationId: 'carolina-beach',
    generatedAt: t(0).toISOString(),
    expiresAt: t(2).toISOString(),
    status: 'available',
    engine: 'timesfm-3-vertex-etss-hybrid',
    horizonSteps: 4,
    thresholdFt: 5.6,
    points: [
      {
        t: t(2).toISOString(),
        totalFt: 6.0,
        tideFt: 5.0,
        residualFt: 1.0,
        drivers: {
          oceanSurgeFt: 0.4,
          windSetupFt: 0.3,
          riverFlowFt: 0.15,
          rainfallRunoffFt: 0.05,
          estuarineHarmonicFt: 0.1,
        },
        windSpeedMph: 20,
        windDirectionDeg: 35,
        precipIn: 0.1,
      },
      {
        t: t(2.5).toISOString(),
        totalFt: 6.4,
        tideFt: 5.0,
        residualFt: 1.4,
        drivers: {
          oceanSurgeFt: 0.6,
          windSetupFt: 0.4,
          riverFlowFt: 0.25,
          rainfallRunoffFt: 0.05,
          estuarineHarmonicFt: 0.1,
        },
        windSpeedMph: 24,
        windDirectionDeg: 40,
        precipIn: 0.2,
      },
    ],
    peak: null,
    covariatesUsed: ['noaa-etss-ocean-surge'],
  };

  it('rejects null, out-of-window, missing-drivers, or over-90-min gap inputs', () => {
    expect(selectOperationalSurgeDrivers(null, t(2.25), 1.2)).toBeNull();
    expect(selectOperationalSurgeDrivers(challenger, t(1.5), 1.0)).toBeNull();
    expect(selectOperationalSurgeDrivers(challenger, t(3.0), 1.4)).toBeNull();
    expect(selectOperationalSurgeDrivers(challenger, t(2.25), Number.NaN)).toBeNull();

    const wideGap: ChallengerOutlookDocument = {
      ...challenger,
      points: [challenger.points[0], { ...challenger.points[1], t: t(4.0).toISOString() }],
    };
    expect(selectOperationalSurgeDrivers(wideGap, t(3.0), 1.2)).toBeNull();
  });

  it('interpolates all 5 physical drivers losslessly with zero Tide reference adjustment', () => {
    const breakdown = selectOperationalSurgeDrivers(challenger, t(2.25), 1.2)!;
    expect(breakdown).not.toBeNull();
    expect(breakdown.method).toBe('NOAA ETSS + Wind/River + TimesFM AI');
    expect(breakdown.contributions.map(c => c.id)).toEqual([
      'ocean-surge',
      'wind-setup',
      'river-head',
      'rainfall-runoff',
      'estuarine-harmonics',
    ]);
    expect(breakdown.contributions.some(c => c.label.includes('Tide reference'))).toBe(false);
    expect(breakdown.contributions.find(c => c.id === 'ocean-surge')?.value).toBeCloseTo(0.5, 6);
    expect(breakdown.contributions.find(c => c.id === 'wind-setup')?.value).toBeCloseTo(0.35, 6);
    expect(breakdown.contributions.find(c => c.id === 'river-head')?.value).toBeCloseTo(0.2, 6);
    expect(
      breakdown.contributions.reduce((sum, item) => sum + item.value, 0)
    ).toBeCloseTo(1.2, 6);
    expect(breakdown.weather?.windSpeedMph).toBeCloseTo(22, 6);
    expect(breakdown.weather?.precipIn).toBeCloseTo(0.15, 6);
  });
});

describe('selected forecast factors (legacy schema compatibility)', () => {
  const document = {
    driverInfo: { version: 1 },
    points: [
      {
        t: t(2).toISOString(),
        residualFt: 1,
        drivers: {
          m: 'w',
          c: [0.2, 0.1, 0.1, 0.1, 0.3, 0.1, 0.05, 0.05],
          w: {
            at: t(2).toISOString(),
            wind6Mph: 15,
            wind6FromDeg: 45,
            rain24In: 0.4,
            pressureHpa: 1001,
          },
        },
      },
      {
        t: t(2.1).toISOString(),
        residualFt: 2,
        drivers: { m: 'w', c: [0.4, 0.2, 0.2, 0.2, 0.6, 0.2, 0.1, 0.1] },
      },
    ],
  } as unknown as ForecastDocument;
  it('interpolates all factors and explicitly reconciles the chart tide reference', () => {
    const value = selectedForecastFactors(document, t(2.05), 1.7)!;
    expect(value.contributions.reduce((sum, row) => sum + row.value, 0)).toBeCloseTo(1.7, 10);
    expect(value.contributions.find(row => row.id === 'wind')?.value).toBeCloseTo(0.45);
    expect(value.contributions.at(-1)?.id).toBe('local-tide-reference');
    expect(value.contributions.at(-1)?.value).toBeCloseTo(0.2);
    expect(value.weather?.wind6Mph).toBe(15);
  });
});

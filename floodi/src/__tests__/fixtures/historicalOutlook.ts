import type { HistoricalOutlookModel } from '../../../functions/src/forecast/historicalOutlook';

/** Synthetic contract fixture, never a historical skill or physical reading. */
export function historicalOutlookFixture(weatherEnabled = false): HistoricalOutlookModel {
  const reference = { station: '30046', datum: 'MLLW', units: 'ft' };
  return {
    version: 'historical-weather-v1', reference, tideReference: reference,
    trainingStart: '2026-07-01T00:00:00Z', trainedUntil: '2026-10-03T00:00:00Z',
    testStart: '2026-09-06T00:00:00Z', testEnd: '2026-10-03T00:00:00Z', trainingPairs: 1500,
    anomalyDecayHours: 48, transitionHours: 12, maxHistoricalErrorFt: .8,
    historical: { intercept: .6, means: [4, 0], scales: [1, 1], coefficients: [.05, -.03], minimums: [-5, -5], maximums: [10, 10] },
    weather: weatherEnabled ? { intercept: .7, means: Array(10).fill(0), scales: Array(10).fill(1), coefficients: Array(10).fill(0), minimums: Array(10).fill(-2000), maximums: Array(10).fill(2000) } : null,
    validation: {
      eligible: true, historicalEligible: false, weatherEligible: weatherEnabled,
      evaluation: 'chronological issue-anchored reanalysis hindcast',
      leads: [1, 3, 6, 24, 72, 120, 168, 336].map(leadHours => ({
        leadHours, testPairs: 150, historicalMaeFt: leadHours === 336 ? .31 : .2, persistenceMaeFt: .3,
        historicalError90Ft: leadHours === 336 ? .8 : .6,
        weatherPairs: weatherEnabled ? 120 : 0, weatherMaeFt: weatherEnabled ? .1 : null,
        weatherHistoricalMaeFt: weatherEnabled ? (leadHours === 336 ? .31 : .2) : null,
        weatherError90Ft: weatherEnabled ? .35 : null,
      })),
      limitations: ['Synthetic schema and data-flow fixture; does not establish forecasting skill.'],
    },
  };
}

import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { FORECAST_DRIVER_METADATA, FORECAST_FACTOR_KEYS, driverVector, forecastWeatherContext, regressionContributions, validateForecastDrivers } from '../../../functions/src/forecast/attribution';
import { projectLongRangeResidual, projectShortRangeResidual, projectWeatherResidual, WEATHER_RESPONSE_FEATURES, WeatherResponseModel } from '../../../functions/src/forecast/weatherResponse';
import { projectHistoricalOutlook } from '../../../functions/src/forecast/historicalOutlook';
import { buildGaugeForecast } from '../../../functions/src/forecast/gaugePipeline';
import { validateForecast } from '../../../functions/src/forecast/schema';
import { historicalOutlookFixture } from '../fixtures/historicalOutlook';
import type { AttributedWaterPoint } from '../../../functions/src/forecast/attribution';

const require = createRequire(`${process.cwd()}/functions/package.json`);
function firestoreDocumentBytes(value: unknown) {
  // Exercise the installed SDK's real field serializer and Firestore protobuf
  // encoding in memory. No fake forecast is written to any remote database.
  const { Firestore } = require('@google-cloud/firestore');
  const protobuf = require('protobufjs');
  const type = protobuf.Root.fromJSON(require('@google-cloud/firestore/build/protos/v1.json')).lookupType('google.firestore.v1.Document');
  const db = new Firestore({ projectId: 'demo-floodcast-rules' });
  return type.encode({ name: 'projects/demo-floodcast-rules/databases/(default)/documents/forecast_outlook/carolina-beach', fields: db._serializer.encodeFields(value) }).finish().length as number;
}
const HOUR = 3600_000;
const issue = new Date('2026-10-10T12:00:00Z');
const at = (hours: number) => new Date(+issue + hours * HOUR);
const ref = { station: '30046', datum: 'MLLW', units: 'ft' };
const history = Array.from({ length: 193 }, (_, i) => ({ t: at(-48 + i / 4), v: .6 + .001 * i + .03 * Math.sin(i / 8) }));
const tide = Array.from({ length: (72 + 32 * 24) * 4 + 1 }, (_, i) => ({ t: at(-72 + i / 4), v: 3 + 2 * Math.sin((-72 + i / 4) * 2 * Math.PI / 12.42) }));
const weather = Array.from({ length: 72 + 384 + 1 }, (_, i) => ({ t: at(-72 + i), windSpeed: 10 + .02 * i, windDirection: 30, pressure: 1015 - .01 * i, precip: .01 }));
const past = weather.filter(row => row.t <= issue), future = weather.filter(row => row.t > issue);
const regression = (n: number) => ({ intercept: .03, means: Array(n).fill(0), scales: Array(n).fill(1), coefficients: Array.from({ length: n }, (_, i) => .001 * (i % 3 - 1)), minimums: Array(n).fill(-2000), maximums: Array(n).fill(2000) });
const lead = (leadHours: number) => ({ leadHours, trainingPairs: 300, testPairs: 150, modelMaeFt: .15, persistenceMaeFt: .3, improvement: .5, absoluteError90Ft: .4, passes: true });
function model(): WeatherResponseModel {
  return { reference: ref, tideReference: ref, trainedUntil: at(-24), testStart: at(-300), testEnd: at(-24), holdoutStarts: at(-300), maxObservationGapMs: 30 * 60_000,
    regressions: [1, 3, 6, 12, 24].map(leadHours => ({ leadHours, model: regression(WEATHER_RESPONSE_FEATURES.length) })),
    validation: { leads: [1, 3, 6, 12, 24].map(lead), eligible: true, pointEligible: true, peakWindows: 10, peakMaeFt: .2, persistencePeakMaeFt: .3, weatherInput: 'reanalysis hindcast' }, limitations: [],
    shortRange: { regressions: [1, 3, 6].map(leadHours => ({ leadHours, model: regression(WEATHER_RESPONSE_FEATURES.length) })), leads: [1, 3, 6].map(lead), eligible: true, peakWindows: 10, peakMaeFt: .2, persistencePeakMaeFt: .3 },
    longRange: { regressions: [12, 24, 48, 72].map(leadHours => ({ leadHours, method: 'residual-reversion', model: regression(8) })), leads: [12, 24, 48, 72].map(lead), eligible: true, peakWindows: 10, peakMaeFt: .2, persistencePeakMaeFt: .3, peakByDay: [] },
  };
}
function assertParts(points: AttributedWaterPoint[]) {
  expect(points.length).toBeGreaterThan(0);
  for (const point of points) {
    expect(point.drivers).toBeDefined();
    expect(point.drivers!.c).toHaveLength(8);
    expect(point.drivers!.c.reduce((sum, part) => sum + part, 0)).toBeCloseTo(point.v, 12);
    expect(validateForecastDrivers(point.drivers, point.v, point.t.toISOString())).toBe(true);
  }
}
const numeric = (points: AttributedWaterPoint[]) => points.map(({ t, v }) => ({ t, v }));

describe('point-specific numerical forecast factors', () => {
  it('groups exact centered regression terms without replacing centering by a causal claim', () => {
    const parts = regressionContributions({ intercept: .2, coefficients: [.4, -.3], means: [1, 10], scales: [2, 5] }, [3, 15], [4, 6], .7);
    expect(parts).toEqual([.7, 0, 0, 0, .4, 0, -.3, .2]);
    expect(FORECAST_FACTOR_KEYS).toHaveLength(8);
    expect(FORECAST_DRIVER_METADATA.interpretation).toContain('not causal proof');
    expect(driverVector(parts, 999)).toBeNull();
    expect(driverVector([NaN, 0, 0, 0, 0, 0, 0, 0], 1)).toBeNull();
  });
  it('explains every interpolated weather point and leaves the numerical curve identical', () => {
    const times = Array.from({ length: 97 }, (_, i) => at(i / 4));
    const base = projectWeatherResidual(model(), history, tide, past, future, times, issue, ref, ref);
    const explained = projectWeatherResidual(model(), history, tide, past, future, times, issue, ref, ref, { includeDrivers: true });
    expect(numeric(explained)).toEqual(base); assertParts(explained);
    expect(explained.some(point => point.drivers!.c[4] !== 0)).toBe(true);
    expect(explained.some(point => point.drivers!.c[5] !== 0)).toBe(true);
    expect(explained.some(point => point.drivers!.c[6] !== 0)).toBe(true);
    expect(explained.at(-1)!.drivers!.w?.rain24In).toBe(.24);
  });
  it('explains recent-pattern forecasts without falsely introducing weather terms', () => {
    const times = Array.from({ length: 25 }, (_, i) => at(i / 4));
    const explained = projectShortRangeResidual(model(), history, tide, times, issue, ref, ref, { includeDrivers: true });
    expect(numeric(explained)).toEqual(projectShortRangeResidual(model(), history, tide, times, issue, ref, ref)); assertParts(explained);
    expect(explained.every(point => point.drivers!.c.slice(4, 7).every(value => value === 0) && point.drivers!.w === undefined)).toBe(true);
  });
  it('preserves a supplied near-term prefix and decomposes the exact learned reversion blend', () => {
    const candidate = model();
    const prefix = projectShortRangeResidual(candidate, history, tide, Array.from({ length: 25 }, (_, i) => at(i / 4)), issue, ref, ref, { includeDrivers: true });
    const times = [at(6.25), at(9), at(12), at(22), at(48), at(71.75)];
    const explained = projectLongRangeResidual(candidate, history, tide, times, issue, ref, ref, { prefix, includeDrivers: true });
    expect(numeric(explained)).toEqual(projectLongRangeResidual(candidate, history, tide, times, issue, ref, ref, { prefix })); assertParts(explained);
    expect(explained.every(point => point.drivers!.m === 'l')).toBe(true);
  });
  it.each([false, true])('decomposes historical, prefix-decay and weather fade exactly, weather eligibility=%s', weatherEligible => {
    const historical = historicalOutlookFixture(weatherEligible);
    if (historical.weather) {
      historical.weather.coefficients = [.05, -.03, .002, .003, .004, .005, .0002, -.002, .01, .02];
      historical.weather.means = [3, 0, 10, 0, 10, 0, 1015, 0, 0, 0];
    }
    const prefix = projectShortRangeResidual(model(), history, tide, Array.from({ length: 25 }, (_, i) => at(i / 4)), issue, ref, ref);
    const times = [at(6.25), at(7), at(24.5), at(100), at(383.75), at(384), at(21 * 24)];
    const base = projectHistoricalOutlook(historical, history, tide, past, future, times, issue, ref, ref, { prefix });
    const explained = projectHistoricalOutlook(historical, history, tide, past, future, times, issue, ref, ref, { prefix, includeDrivers: true });
    expect(numeric(explained.points)).toEqual(base.points); assertParts(explained.points);
    expect(explained.points.at(-1)!.drivers!.m).toBe('h');
    expect(explained.points.at(-1)!.drivers!.c.slice(4, 7)).toEqual([0, 0, 0]);
    expect(explained.points.at(-1)!.drivers!.w).toBeUndefined();
    if (weatherEligible) {
      expect(explained.points.some(point => point.drivers!.m === 'hw')).toBe(true);
      for (const index of [4, 5, 6]) expect(explained.points.some(point => Math.abs(point.drivers!.c[index]) > 1e-5)).toBe(true);
    }
  });
  it('uses real context timestamps and does not invent rain or extrapolate weather context', () => {
    expect(forecastWeatherContext(weather, at(24.5))?.at).toBe(at(24).toISOString());
    expect(forecastWeatherContext(weather, at(386))).toBeUndefined();
    expect(forecastWeatherContext(weather.map(row => ({ ...row, precip: undefined })), at(24))).toBeUndefined();
  });
  it('rejects malformed factors, reconstruction errors and future weather while allowing old payloads', () => {
    const valid = { m: 'w', c: [.7, 0, 0, 0, .2, 0, 0, .1] };
    expect(validateForecastDrivers(valid, 1, issue.toISOString())).toBe(true);
    expect(validateForecastDrivers({ ...valid, c: [NaN, 0, 0, 0, 0, 0, 0, 0] }, 1, issue.toISOString())).toBe(false);
    expect(validateForecastDrivers({ ...valid, c: [1] }, 1, issue.toISOString())).toBe(false);
    expect(validateForecastDrivers(valid, 2, issue.toISOString())).toBe(false);
    expect(validateForecastDrivers({ ...valid, w: { at: at(1).toISOString(), wind6Mph: 10, wind6FromDeg: 0, rain24In: 0, pressureHpa: 1015 } }, 1, issue.toISOString())).toBe(false);
    const candidate = model(); candidate.historicalOutlook = historicalOutlookFixture(true);
    const doc = buildGaugeForecast(history, tide, past, tide.filter(point => point.t >= issue), future, issue, { model: candidate });
    const plain = buildGaugeForecast(history, tide, past, tide.filter(point => point.t >= issue), future, issue, { model: candidate, includeDrivers: false });
    expect(doc.points.map(point => { const copy = { ...point }; delete copy.drivers; return copy; })).toEqual(plain.points);
    expect(validateForecast(doc)).toBe(true); expect(validateForecast(plain)).toBe(true);
    // Firestore changes object key ordering; the codebook validator must not.
    const copied = JSON.parse(JSON.stringify(doc)); copied.driverInfo = Object.fromEntries(Object.entries(copied.driverInfo).reverse());
    expect(validateForecast(copied)).toBe(true);
    copied.points[0].drivers.c[0] += 1;
    expect(validateForecast(copied)).toBe(false);
    expect(Buffer.byteLength(JSON.stringify(doc))).toBeLessThan(900_000);
    expect(firestoreDocumentBytes(doc)).toBeLessThan(1_000_000);
    expect(JSON.stringify(doc)).not.toMatch(/coefficients|minimums|maximums/);
  });
});

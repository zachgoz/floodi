import { describe, expect, it } from 'vitest';
import { validateForecastDrivers } from '../../../functions/src/forecast/attribution';
import type { WeatherPoint } from '../../../functions/src/forecast/model';
import { interpolate } from '../../../functions/src/forecast/water';
import { projectShortRangeResidual, projectWeatherResidual, WEATHER_RESPONSE_FEATURES, WEATHER_RESPONSE_LEADS, type WeatherResponseModel } from '../../../functions/src/forecast/weatherResponse';

const HOUR = 3600_000;
const issue = new Date('2026-10-20T12:00:00Z');
const at = (h: number) => new Date(+issue + h * HOUR);
const reference = { station: '30046', datum: 'MLLW', units: 'ft' };
const tideAt = (h: number) => 3 + 2 * Math.sin(2 * Math.PI * h / 12);
const tide = Array.from({ length: 1001 }, (_, i) => ({ t: at(-74 + i / 10), v: tideAt(-74 + i / 10) }));
const measuredHistory = (tideCoefficient: number) => Array.from({ length: 145 }, (_, i) => {
  const h = -72 + i / 2;
  return { t: at(h), v: .8 + tideCoefficient * (tideAt(h) - tideAt(0)) };
});
// A stronger same-sign measured response supports every ordinary fixture's
// learned coefficient despite the recent fit's small regularization penalty.
const history = measuredHistory(-.6);
const weather: WeatherPoint[] = Array.from({ length: 73 }, (_, i) => ({ t: at(-48 + i), windSpeed: 10, windDirection: 45, pressure: 1015, precip: .01 }));
const past = weather.filter(p => p.t <= issue), future = weather.filter(p => p.t > issue);
const leadValidation = (leadHours: number) => ({ leadHours, trainingPairs: 300, testPairs: 150, modelMaeFt: .1, persistenceMaeFt: .3, improvement: 2 / 3, absoluteError90Ft: .2, passes: true });
const model = (coefficient = -.3): WeatherResponseModel => {
  const regressions = WEATHER_RESPONSE_LEADS.map(leadHours => ({ leadHours, model: {
    intercept: .01 * leadHours,
    coefficients: WEATHER_RESPONSE_FEATURES.map((_, i) => i === WEATHER_RESPONSE_FEATURES.length - 1 ? coefficient : 0),
    means: Array(WEATHER_RESPONSE_FEATURES.length).fill(0) as number[], scales: Array(WEATHER_RESPONSE_FEATURES.length).fill(1) as number[],
    minimums: Array(WEATHER_RESPONSE_FEATURES.length).fill(-1e6) as number[], maximums: Array(WEATHER_RESPONSE_FEATURES.length).fill(1e6) as number[],
  } }));
  return {
    reference, tideReference: reference, trainedUntil: at(-24), holdoutStarts: at(-48), testStart: at(-48), testEnd: at(-24), maxObservationGapMs: 30 * 60_000 + 10_000,
    regressions, validation: { leads: WEATHER_RESPONSE_LEADS.map(leadValidation), eligible: true, pointEligible: true, peakWindows: 10, peakMaeFt: .1, persistencePeakMaeFt: .2, weatherInput: 'reanalysis hindcast' },
    shortRange: { regressions: regressions.slice(0, 3), leads: [1, 3, 6].map(leadValidation), eligible: true, peakWindows: 10, peakMaeFt: .1, persistencePeakMaeFt: .2 }, limitations: [],
  };
};
const project = (times: Date[], candidate = model(), options = {}, measured = history) => projectWeatherResidual(candidate, measured, tide, past, future, times, issue, reference, reference, options);

describe('continuous learned tide response between residual forecast leads', () => {
  it('preserves the measured anchor and every fitted 1/3/6/12/24-hour control', () => {
    const times = [issue, ...WEATHER_RESPONSE_LEADS.map(at)];
    const values = project(times);
    expect(values).toHaveLength(times.length);
    values.forEach(point => {
      const h = (+point.t - +issue) / HOUR;
      expect(point.v).toBeCloseTo(.8 + .01 * h - .3 * (tideAt(h) - tideAt(0)), 13);
    });
    expect(values[0].v).toBe(.8);
  });
  it('retains intervening peaks and valleys when twelve-hour controls match', () => {
    const values = project([at(12), at(15), at(21), at(24)]);
    expect(values).toHaveLength(4);
    expect(values[1].v).toBeCloseTo(.8 + .15 - .6, 12);
    expect(values[2].v).toBeCloseTo(.8 + .21 + .6, 12);
    expect(Math.abs(values[1].v - (.8 + .15))).toBeCloseTo(.6, 12);
    // Shape follows the supplied astronomical series rather than an additional
    // hardcoded sine, and cannot create cycles from a flat tide prediction.
    const flat = projectWeatherResidual(model(), history, tide.map(p => ({ ...p, v: 3 })), past, future, [at(15), at(21)], issue, reference, reference);
    expect(flat[0].v).toBeCloseTo(.95, 13); expect(flat[1].v).toBeCloseTo(1.01, 13);
  });
  it('leaves a model with no fitted tide effect linear', () => {
    const values = project([at(1.5), at(9), at(15), at(21)], model(0));
    expect(values).toHaveLength(4);
    values.forEach(p => expect(p.v).toBeCloseTo(.8 + .01 * (+p.t - +issue) / HOUR, 13));
  });
  it('blends the learned tide coefficients rather than freezing one lead model across a segment', () => {
    const candidate = model();
    candidate.regressions.forEach(entry => { entry.model.coefficients[WEATHER_RESPONSE_FEATURES.length - 1] = -.01 * entry.leadHours; });
    const times = [at(1), at(2), at(3), at(9), at(12), at(15), at(21), at(24)];
    const values = project(times, candidate, { includeDrivers: true });
    expect(values).toHaveLength(times.length);
    values.forEach(p => {
      const h = (+p.t - +issue) / HOUR;
      expect(p.v).toBeCloseTo(.8 + .01 * h - .01 * h * (tideAt(h) - tideAt(0)), 12);
      expect(validateForecastDrivers(p.drivers, p.v, p.t.toISOString())).toBe(true);
    });
  });
  it('bounds each contributing tide feature by its own model domain without changing fitted controls', () => {
    const candidate = model();
    const index = WEATHER_RESPONSE_FEATURES.length - 1;
    for (const entry of candidate.regressions) {
      if (entry.leadHours === 12) {
        entry.model.scales[index] = .1;
        entry.model.minimums![index] = -.1;
        entry.model.maximums![index] = .1;
      } else if (entry.leadHours === 24) {
        entry.model.scales[index] = .2;
        entry.model.minimums![index] = -.4;
        entry.model.maximums![index] = .4;
      }
    }
    // This test isolates the historical feature-domain bound: the measured
    // response supports even the deliberately steep standardized coefficients.
    const strongHistory = measuredHistory(-6);
    const unbounded = { ...candidate, regressions: candidate.regressions.map(entry => ({ ...entry, model: { ...entry.model, minimums: undefined, maximums: undefined } })) };
    const controls = [issue, ...WEATHER_RESPONSE_LEADS.map(at)];
    expect(project(controls, candidate, {}, strongHistory)).toEqual(project(controls, unbounded, {}, strongHistory));
    const values = project([at(15), at(21)], candidate, { includeDrivers: true }, strongHistory);
    // At 15h, both tide differences are 2ft, outside the 12h model's ±0.4ft
    // and 24h model's ±1ft limits (training min/max plus 3 standard deviations).
    // Evaluate each bounded term first, then blend with its quarter/three-
    // quarter lead weight. Clamping after blending would give another result.
    expect(values[0].v).toBeCloseTo(.8 + .15 - (1.2 * .75 + 1.5 * .25), 12);
    expect(values[1].v).toBeCloseTo(.8 + .21 + (1.2 * .25 + 1.5 * .75), 12);
    expect(project([at(15), at(21)], unbounded, {}, strongHistory)[0].v).toBeLessThan(values[0].v - 3);
    values.forEach(p => {
      expect(validateForecastDrivers(p.drivers, p.v, p.t.toISOString())).toBe(true);
      expect(p.drivers!.c.slice(4, 7)).toEqual([0, 0, 0]);
    });
    expect(values.map(({ t, v }) => ({ t, v }))).toEqual(project([at(15), at(21)], candidate, {}, strongHistory));
  });
  it('retains the original linear curve when measured tide response has the opposite sign', () => {
    const opposite = measuredHistory(.6);
    const controls = project([issue, ...WEATHER_RESPONSE_LEADS.map(at)], model(), {}, opposite);
    const times = [at(.5), at(4.5), at(9), at(15), at(21)];
    const values = project(times, model(), { includeDrivers: true }, opposite);
    expect(values.map(({ t, v }) => ({ t, v }))).toEqual(times.map(t => ({ t, v: interpolate(controls, t, 12 * HOUR) })));
    values.forEach(p => expect(validateForecastDrivers(p.drivers, p.v, p.t.toISOString())).toBe(true));
  });
  it('caps new curvature at the smaller supported recent response while preserving learned controls', () => {
    const smaller = measuredHistory(-.1);
    const controlTimes = [issue, ...WEATHER_RESPONSE_LEADS.map(at)];
    expect(project(controlTimes, model(), {}, smaller)).toEqual(project(controlTimes));
    const values = project([at(15), at(21)], model(), { includeDrivers: true }, smaller);
    // A roughly -0.1ft/ft measured response permits about 0.2ft of curvature,
    // not the 0.6ft supported by the historical -0.3ft/ft model alone.
    expect(values[0].v).toBeCloseTo(.8 + .15 - .2, 3);
    expect(values[1].v).toBeCloseTo(.8 + .21 + .2, 3);
    expect(values[0].v).toBeGreaterThan(project([at(15)])[0].v + .39);
    values.forEach(p => expect(validateForecastDrivers(p.drivers, p.v, p.t.toISOString())).toBe(true));
  });
  it('retains exact original scalar interpolation when recent measured coverage is unsupported', () => {
    const incomplete = history.filter(p => p.t >= at(-24));
    const controls = project([issue, ...WEATHER_RESPONSE_LEADS.map(at)], model(), {}, incomplete);
    const times = [at(.5), at(4.5), at(9), at(15), at(21)];
    expect(project(times, model(), {}, incomplete)).toEqual(times.map(t => ({ t, v: interpolate(controls, t, 12 * HOUR) })));
    const shortControls = projectShortRangeResidual(model(), incomplete, tide, [issue, at(1), at(3), at(6)], issue, reference, reference);
    const shortTimes = [at(.5), at(2), at(4.5)];
    expect(projectShortRangeResidual(model(), incomplete, tide, shortTimes, issue, reference, reference)).toEqual(shortTimes.map(t => ({ t, v: interpolate(shortControls, t, 3 * HOUR) })));
  });
  it('preserves a delayed real anchor and supports non-hourly requested times', () => {
    const delayedIssue = at(.4);
    const values = projectWeatherResidual(model(), history, tide, weather, future, [delayedIssue, at(1), at(2.1), at(5.4)], delayedIssue, reference, reference);
    expect(values).toHaveLength(4); expect(values[0].v).toBe(.8);
    values.slice(1).forEach(p => {
      const h = (+p.t - +delayedIssue) / HOUR;
      expect(p.v).toBeCloseTo(.8 + .01 * h - .3 * (interpolate(tide, p.t)! - interpolate(tide, delayedIssue)!), 12);
    });
    expect(history.at(-1)!.t).toEqual(issue);
  });
  it('uses the same tide-aware shape in the six-hour fallback', () => {
    const times = [issue, at(.5), at(1), at(2), at(3), at(4.5), at(6)];
    const values = projectShortRangeResidual(model(), history, tide, times, issue, reference, reference);
    expect(values).toHaveLength(times.length);
    values.forEach(p => {
      const h = (+p.t - +issue) / HOUR;
      expect(p.v).toBeCloseTo(.8 + .01 * h - .3 * (tideAt(h) - tideAt(0)), 12);
    });
  });
  it.each(['weather', 'short'] as const)('preserves %s numeric values with drivers and assigns the shape to tide-pattern', method => {
    const times = method === 'weather' ? [at(.5), at(4.5), at(9), at(15), at(21)] : [at(.5), at(2), at(4.5)];
    const plain = method === 'weather' ? project(times) : projectShortRangeResidual(model(), history, tide, times, issue, reference, reference);
    const explained = method === 'weather' ? project(times, model(), { includeDrivers: true }) : projectShortRangeResidual(model(), history, tide, times, issue, reference, reference, { includeDrivers: true });
    expect(explained.map(({ t, v }) => ({ t, v }))).toEqual(plain); expect(explained).toHaveLength(times.length);
    explained.forEach(p => {
      expect(validateForecastDrivers(p.drivers, p.v, p.t.toISOString())).toBe(true);
      expect(p.drivers!.c[3]).toBeCloseTo(-.3 * (interpolate(tide, p.t)! - tideAt(0)), 6);
      expect(p.drivers!.c[7]).toBeCloseTo(.01 * (+p.t - +issue) / HOUR, 6);
      expect(p.drivers!.c.reduce((sum, part) => sum + part, 0)).toBeCloseTo(p.v, 12);
      expect(p.drivers!.c.slice(4, 7)).toEqual([0, 0, 0]);
    });
  });
  it('does not fill a missing astronomical interval between valid controls', () => {
    const missing = tide.filter(p => +p.t < +at(14.7) || +p.t > +at(15.3));
    const values = projectWeatherResidual(model(), history, missing, past, future, [at(12), at(15), at(21), at(24)], issue, reference, reference);
    expect(values.map(p => p.t)).toEqual([at(12), at(21), at(24)]);
    expect(projectWeatherResidual(model(), history, tide.filter(p => +p.t < +issue || +p.t > +at(.3)), past, future, [at(1)], issue, reference, reference)).toEqual([]);
  });
  it('ignores future measured residuals and future historical weather', () => {
    const times = [at(.5), at(4.5), at(15), at(21)];
    const contaminated = [...history, ...times.map(t => ({ t, v: 999 }))];
    const contaminatedPast = weather.map(p => p.t > issue ? { ...p, windSpeed: 999, pressure: 800, precip: 50 } : p);
    expect(projectWeatherResidual(model(), contaminated, tide, contaminatedPast, future, times, issue, reference, reference)).toEqual(project(times));
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import {
  projectWeatherResidual, projectShortRangeResidual, projectLongRangeResidual, trainWeatherResponse, weatherResponseFeatures,
  WEATHER_RESPONSE_FEATURES, LONG_RANGE_FEATURES, LONG_RANGE_LEADS, WeatherResponseModel,
} from '../../../functions/src/forecast/weatherResponse';
import { WeatherPoint } from '../../../functions/src/forecast/model';

const HOUR = 3600_000;
const origin = new Date('2026-07-01T00:00:00Z');
const time = (hour: number) => new Date(+origin + hour * HOUR);
const ref = { station: '30046', datum: 'MLLW', units: 'ft' };
const n = 1000;
const north = (h: number) => 10 + 6 * Math.sin(h / 19);
const east = (h: number) => 4 * Math.cos(h / 13);
const tideValue = (h: number) => 3 + 2 * Math.sin(h * Math.PI * 2 / 12.42);
const average = (fn: (h: number) => number, at: number, hours: number) =>
  Array.from({ length: hours }, (_, i) => fn(at - i)).reduce((s, v) => s + v, 0) / hours;
const weather: WeatherPoint[] = Array.from({ length: n + 49 }, (_, h) => ({
  t: time(h), windSpeed: Math.hypot(north(h), east(h)),
  windDirection: (Math.atan2(east(h), north(h)) * 180 / Math.PI + 360) % 360,
  pressure: 1015 + 8 * Math.sin(h / 70), precip: .005 * (1 + Math.sin(h / 37)),
}));
const tide = Array.from({ length: (n + 49) * 10 }, (_, i) => ({ t: time(i / 10), v: tideValue(i / 10) }));
const history = Array.from({ length: n }, (_, h) => ({
  t: time(h), v: .08 * average(north, h, 6) + .03 * average(north, h, 24) + .02 * average(east, h, 12) - .15 * tideValue(h),
}));
const measuredHistory = Array.from({ length: (n - 1) * 10 + 1 }, (_, i) => {
  const h = i / 10;
  return { t: time(h), v: .08 * average(north, h, 6) + .03 * average(north, h, 24) + .02 * average(east, h, 12) - .15 * tideValue(h) };
});
let model: WeatherResponseModel | null;
beforeAll(() => { model = trainWeatherResponse(measuredHistory, tide, weather, ref, ref); }, 30000);

describe('interpretable weather-response residual forecast', () => {
  it('evaluates chronological future residual changes against persistence and peaks', () => {
    expect(model?.validation.eligible).toBe(true);
    expect(model!.validation.leads.every(l => l.trainingPairs >= 120 && l.testPairs >= 100 && l.improvement! >= .05)).toBe(true);
    expect(model!.validation.peakWindows).toBeGreaterThanOrEqual(7);
    expect(model!.validation.peakMaeFt!).toBeLessThanOrEqual(model!.validation.persistencePeakMaeFt!);
    expect(model!.validation.weatherInput).toBe('reanalysis hindcast');
    expect(+model!.holdoutStarts).toBeGreaterThan(+history[0].t);
    expect(+model!.holdoutStarts).toBeLessThan(+model!.trainedUntil);
  });
  it('uses north/east wind-from components and explicit measured rain', () => {
    const issue = time(500), target = time(506);
    const x = weatherResponseFeatures(issue, target, history[500], history, tide, weather, weather)!;
    expect(x).toHaveLength(WEATHER_RESPONSE_FEATURES.length);
    expect(x[2]).toBeCloseTo(average(north, 500, 6));
    expect(x[3]).toBeCloseTo(average(east, 500, 6));
    expect(x[16]).toBeCloseTo(weather.slice(495, 501).reduce((s, w) => s + w.precip!, 0));
  });
  it('does not use residual observations or measured weather after the issue as predictors', () => {
    const issue = time(500), target = time(506);
    const expected = weatherResponseFeatures(issue, target, history[500], history, tide, weather, weather);
    const contaminatedHistory = history.map(p => +p.t > +issue ? { ...p, v: 9999 } : p);
    const contaminatedWeather = weather.map(w => +w.t > +issue ? { ...w, windSpeed: 9999, pressure: 9999, precip: 9999 } : w);
    expect(weatherResponseFeatures(issue, target, history[500], contaminatedHistory, tide, contaminatedWeather, weather)).toEqual(expected);
    expect(weatherResponseFeatures(issue, target, { t: target, v: 9999 }, history, tide, weather, weather)).toBeNull();
  });
  it('rejects unknown rainfall, missing weather and incompatible reference data', () => {
    const issue = time(500), target = time(506);
    const missingRain = weather.map((w, i) => i === 500 ? { ...w, precip: undefined } : w);
    expect(weatherResponseFeatures(issue, target, history[500], history, tide, missingRain, weather)).toBeNull();
    expect(weatherResponseFeatures(issue, target, history[500], history, tide, weather.filter((_, i) => i !== 500), weather)).toBeNull();
    expect(trainWeatherResponse(history, tide, weather, ref, { ...ref, datum: 'NAVD88' })).toBeNull();
    expect(trainWeatherResponse(history, tide, weather, ref, { ...ref, station: '8658163' })).toBeNull();
    expect(trainWeatherResponse(history.slice(-500), tide, weather, ref, ref)).toBeNull();
  });
  it('anchors to the latest real observation and uses issued upcoming weather', () => {
    const issue = history.at(-1)!.t;
    const times = [issue, time(n), time(n + 5), time(n + 23), time(n + 24)];
    const result = projectWeatherResidual(model, history, tide, weather, weather, times, issue, ref, ref);
    expect(result[0].v).toBeCloseTo(history.at(-1)!.v);
    expect(result).toHaveLength(4);
    expect(result.every(p => Number.isFinite(p.v) && +p.t <= +issue + 24 * HOUR)).toBe(true);
    expect(Math.abs(result.at(-1)!.v - result[0].v)).toBeGreaterThan(.01);
  });
  it('withholds a forecast for failed validation, stale sources and unavailable forecast weather', () => {
    const issue = history.at(-1)!.t, times = [time(n)];
    expect(projectWeatherResidual(null, history, tide, weather, weather, times, issue, ref, ref)).toEqual([]);
    expect(projectWeatherResidual({ ...model!, validation: { ...model!.validation, eligible: false } }, history, tide, weather, weather, times, issue, ref, ref)).toEqual([]);
    expect(projectWeatherResidual(model, history, tide, weather, [], times, issue, ref, ref)).toEqual([]);
    expect(projectWeatherResidual(model, history, tide, weather, weather, [time(n + 2)], time(n + 1), ref, ref)).toEqual([]);
    expect(projectWeatherResidual(model, history, tide, weather, weather, times, issue, ref, { ...ref, units: 'm' })).toEqual([]);
    expect(projectWeatherResidual(model, history, tide, weather, weather, [time(501)], time(500), ref, ref)).toEqual([]);
  });
  it('does not bridge half-hour observation outages or invent a current residual', () => {
    const issue = time(500), target = time(506);
    const gap = history.filter(p => +p.t !== +time(497));
    expect(weatherResponseFeatures(issue, target, history[500], gap, tide, weather, weather)).toBeNull();
    expect(trainWeatherResponse(history, tide, weather, ref, ref, { maxObservationGapMs: HOUR })).toBeNull();
  });
  it('requires explicit experimental opt-in for missing peak validation and rejects known worse peaks', () => {
    const issue = history.at(-1)!.t, times = [issue, time(n)];
    const pointOnly = { ...model!, validation: { ...model!.validation, eligible: false, pointEligible: true, peakWindows: 0, peakMaeFt: null, persistencePeakMaeFt: null } };
    expect(projectWeatherResidual(pointOnly, history, tide, weather, weather, times, issue, ref, ref)).toEqual([]);
    expect(projectWeatherResidual(pointOnly, history, tide, weather, weather, times, issue, ref, ref, { allowPointValidatedExperimental: true })).toHaveLength(2);
    const adverse = { ...pointOnly, validation: { ...pointOnly.validation, peakMaeFt: .4, persistencePeakMaeFt: .2 } };
    expect(projectWeatherResidual(adverse, history, tide, weather, weather, times, issue, ref, ref, { allowPointValidatedExperimental: true })).toEqual([]);
    expect(model!.validation.leads.every(l => l.absoluteError90Ft !== null && l.absoluteError90Ft >= l.modelMaeFt!)).toBe(true);
  });
  it('sorts and deduplicates forecast weather and requested timestamps', () => {
    const issue = history.at(-1)!.t;
    const expected = projectWeatherResidual(model, history, tide, weather, weather, [issue, time(n), time(n + 2)], issue, ref, ref);
    const shuffled = [...weather, weather[n + 1], { t: new Date('invalid'), windSpeed: 99 }].reverse();
    expect(projectWeatherResidual(model, [...history].reverse(), [...tide].reverse(), [...weather].reverse(), shuffled, [time(n + 2), time(n), issue, time(n), new Date('invalid')], issue, ref, ref)).toEqual(expected);
    expect(projectWeatherResidual(model, history, tide, weather, [{ t: new Date('invalid') }], [time(n)], issue, ref, ref)).toEqual([]);
    expect(weatherResponseFeatures(time(500), time(506), history[500], [...history].reverse(), [...tide].reverse(), [...weather].reverse(), shuffled)).toEqual(weatherResponseFeatures(time(500), time(506), history[500], history, tide, weather, weather));
  });
  it('excludes estimated proxy measurements from training, anchoring and features', () => {
    const issue = history.at(-1)!.t, times = [issue, time(n)];
    const withProxy = [...history, { t: issue, v: 9999, estimated: true }];
    expect(projectWeatherResidual(model, withProxy, tide, weather, weather, times, issue, ref, ref)).toEqual(projectWeatherResidual(model, history, tide, weather, weather, times, issue, ref, ref));
    expect(trainWeatherResponse(history.map(p => ({ ...p, estimated: true })), tide, weather, ref, ref)).toBeNull();
    expect(weatherResponseFeatures(time(500), time(506), { ...history[500], estimated: true }, history, tide, weather, weather)).toBeNull();
  });
  it('rejects empty or unsupported references, invalid model dates and future-trained weights', () => {
    const issue = history.at(-1)!.t, times = [time(n)];
    for (const bad of [{ ...ref, station: '' }, { ...ref, datum: '' }, { ...ref, datum: 'UNKNOWN' }, { ...ref, units: 'm' }]) {
      expect(trainWeatherResponse(history, tide, weather, bad, bad)).toBeNull();
      expect(projectWeatherResidual(model, history, tide, weather, weather, times, issue, bad, bad)).toEqual([]);
    }
    expect(projectWeatherResidual({ ...model!, trainedUntil: new Date('invalid') }, history, tide, weather, weather, times, issue, ref, ref)).toEqual([]);
    expect(projectWeatherResidual({ ...model!, trainedUntil: time(n) }, history, tide, weather, weather, times, issue, ref, ref)).toEqual([]);
    expect(projectWeatherResidual(model, history, tide, weather, weather, times, new Date('invalid'), ref, ref)).toEqual([]);
    const badRegression = { ...model!, regressions: model!.regressions.map((r, i) => i === 0 ? { ...r, model: { ...r.model, coefficients: [] } } : r) };
    expect(projectWeatherResidual(badRegression, history, tide, weather, weather, times, issue, ref, ref)).toEqual([]);
  });
  it('permits a real observation exactly half an hour old without using the later proxy', () => {
    const issue = time(n - .5);
    const fineTide = Array.from({ length: (n + 49) * 10 }, (_, i) => ({ t: time(i / 10), v: tideValue(i / 10) }));
    const fineHistory = Array.from({ length: (n - 1) * 10 + 1 }, (_, i) => {
      const h = i / 10;
      return { t: time(h), v: .08 * average(north, h, 6) + .03 * average(north, h, 24) + .02 * average(east, h, 12) - .15 * tideValue(h) };
    });
    const result = projectWeatherResidual(model, [...fineHistory, { t: issue, v: 999, estimated: true }], fineTide, weather, weather, [issue, time(n + .5)], issue, ref, ref);
    expect(result).toHaveLength(2);
    expect(result[0].v).toBeCloseTo(history.at(-1)!.v);
  });
  it('tolerates documented half-hour timestamp jitter without bridging longer gaps', () => {
    const issue = time(500), target = time(506);
    const jittered = (seconds: number) => [
      ...history.filter(p => +p.t !== +time(497)),
      { t: time(496.75), v: history[496].v },
      { t: new Date(+time(497.25) + seconds * 1000), v: history[498].v },
    ];
    expect(weatherResponseFeatures(issue, target, history[500], jittered(8), tide, weather, weather)).not.toBeNull();
    expect(weatherResponseFeatures(issue, target, history[500], jittered(11), tide, weather, weather)).toBeNull();
  });
  it('can freeze purged training weights for a later historical replay', () => {
    const frozen = trainWeatherResponse(measuredHistory, tide, weather, ref, ref, { refitValidatedModel: false })!;
    expect(+frozen.trainedUntil).toBeLessThan(+frozen.holdoutStarts);
    expect(frozen.regressions).not.toEqual(model!.regressions);
    const result = projectWeatherResidual(frozen, history, tide, weather, weather, [time(800), time(806)], time(800), ref, ref);
    expect(result).toHaveLength(2);
  });
  it('withholds extrapolations far outside the historical feature range', () => {
    const issue = history.at(-1)!.t;
    const extremeForecast = weather.map(w => +w.t > +issue ? { ...w, precip: 1000 } : w);
    expect(projectWeatherResidual(model, history, tide, weather, extremeForecast, [issue, time(n + 5)], issue, ref, ref)).toEqual([]);
  });
  it('uses a separately screened six-hour measured-change forecast when weather is unsupported', () => {
    const issue = history.at(-1)!.t;
    expect(model!.shortRange?.eligible).toBe(true);
    const points = projectShortRangeResidual(model, history, tide, [issue, time(n), time(n + 4), time(n + 6)], issue, ref, ref);
    expect(points).toHaveLength(3);
    expect(points[0].v).toBeCloseTo(history.at(-1)!.v);
    expect(Math.abs(points.at(-1)!.v - points[0].v)).toBeGreaterThan(.01);
    expect(points.every(point => +point.t <= +issue + 6 * HOUR)).toBe(true);
    expect(projectShortRangeResidual({ ...model!, shortRange: { ...model!.shortRange!, eligible: false } }, history, tide, [issue, time(n)], issue, ref, ref)).toEqual([]);
    expect(projectShortRangeResidual(model, history, tide, [issue, time(n)], issue, ref, { ...ref, datum: 'NAVD88' })).toEqual([]);
  });
  it('reports separate chronological multi-day tests without lowering the screening gate', () => {
    expect(model!.longRange?.leads.map(lead => lead.leadHours)).toEqual(LONG_RANGE_LEADS);
    expect(model!.longRange?.leads.every(lead => lead.passes === (lead.testPairs >= 100 && lead.improvement !== null && lead.improvement >= .05))).toBe(true);
    expect(model!.longRange?.regressions.every(item => item.model.coefficients.length === LONG_RANGE_FEATURES.length)).toBe(true);
    expect(model!.longRange?.peakByDay.map(day => day.day)).toEqual([1, 2, 3]);
  });
  it('preserves the approved prefix and evaluates tide response throughout a bounded three-day extension', () => {
    const issue = history.at(-1)!.t;
    const fineTide = Array.from({ length: (n + 97) * 10 }, (_, i) => ({ t: time(i / 10), v: tideValue(i / 10) }));
    const longModel: WeatherResponseModel = { ...model!, longRange: { ...model!.longRange!, eligible: true, regressions: LONG_RANGE_LEADS.map(leadHours => ({ leadHours, model: { intercept: 0, means: Array(8).fill(0), scales: Array(8).fill(1), coefficients: Array.from({ length: 8 }, (_, i) => i === 6 ? .1 : 0) } })) } };
    const prefixTimes = Array.from({ length: 61 }, (_, i) => time(n - 1 + i / 10));
    const prefix = projectShortRangeResidual(model, history, fineTide, prefixTimes, issue, ref, ref);
    const times = [...prefixTimes, ...Array.from({ length: 660 }, (_, i) => time(n + 5 + i / 10)), time(n + 71), time(n + 72)];
    const result = projectLongRangeResidual(longModel, history, fineTide, times, issue, ref, ref, { prefix });
    expect(result.slice(0, prefix.length)).toEqual(prefix);
    expect(+result.at(-1)!.t).toBe(+issue + 72 * HOUR);
    const at48 = result.find(point => +point.t === +issue + 48 * HOUR)!.v;
    const at54 = result.find(point => +point.t === +issue + 54 * HOUR)!.v;
    const at60 = result.find(point => +point.t === +issue + 60 * HOUR)!.v;
    expect(Math.abs(at54 - (at48 + at60) / 2)).toBeGreaterThan(.05);
    expect(projectLongRangeResidual({ ...longModel, longRange: { ...longModel.longRange!, eligible: false } }, history, fineTide, times, issue, ref, ref)).toEqual([]);
    expect(projectLongRangeResidual(longModel, history.filter(point => +point.t !== +time(n - 2)), fineTide, times, issue, ref, ref, { prefix })).toEqual([]);
    expect(projectLongRangeResidual(longModel, history, fineTide, times, issue, ref, { ...ref, datum: 'NAVD88' }, { prefix })).toEqual([]);
    const invalid = { ...longModel, longRange: { ...longModel.longRange!, regressions: longModel.longRange!.regressions.map((item, i) => i ? item : { ...item, model: { ...item.model, coefficients: [] } }) } };
    expect(projectLongRangeResidual(invalid, history, fineTide, times, issue, ref, ref, { prefix })).toEqual([]);
  });
  it('keeps unsupported twelve/twenty-four hour controls steady and joins an off-grid weather horizon smoothly', () => {
    const issue = history.at(-1)!.t;
    const fineTide = Array.from({ length: (n + 97) * 10 }, (_, i) => ({ t: time(i / 10), v: tideValue(i / 10) }));
    const longModel: WeatherResponseModel = { ...model!, longRange: { ...model!.longRange!, eligible: true, regressions: LONG_RANGE_LEADS.map(leadHours => ({ leadHours, method: leadHours <= 24 ? 'steady-residual' : 'residual-reversion', model: { intercept: 0, means: Array(8).fill(0), scales: Array(8).fill(1), coefficients: Array.from({ length: 8 }, (_, i) => i === 6 ? .1 : 0) } })) } };
    const baseline = projectLongRangeResidual(longModel, history, fineTide, [time(n + 11), time(n + 23)], issue, ref, ref);
    expect(baseline.map(point => point.v)).toEqual([history.at(-1)!.v, history.at(-1)!.v]);
    const weatherPrefix = Array.from({ length: 240 }, (_, i) => ({ t: time(n - 1 + i / 10), v: history.at(-1)!.v + .4 }));
    const last = weatherPrefix.at(-1)!;
    const joined = projectLongRangeResidual(longModel, history, fineTide, [last.t, time(n + 23), time(n + 47)], issue, ref, ref, { prefix: weatherPrefix });
    expect(joined[0]).toEqual(last);
    // The24h baseline is inside the weather prefix's supported horizon and must
    // not undo a weather forecast in the final six-minute grid interval.
    expect(Math.abs(joined[1].v - last.v)).toBeLessThan(.01);
    expect(joined[1].v).not.toBeCloseTo(history.at(-1)!.v);
  });
});

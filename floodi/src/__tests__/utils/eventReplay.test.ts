import { describe, expect, it } from 'vitest';
import { completeReplayWindow, replayFrozenWeatherCandidate, scoreReplayWindow, summarizeCommonEventTiming, summarizeReplayScores } from '../../../functions/src/forecast/eventEvaluation';
import { WEATHER_RESPONSE_FEATURES, WeatherResponseModel } from '../../../functions/src/forecast/weatherResponse';

const origin = +new Date('2026-09-06T00:00:00Z');
const point = (minutes: number, value: number, estimated = false) => ({ t: new Date(origin + minutes * 60_000), v: value, estimated });

describe('chronological event replay coverage and metrics', () => {
  it('requires measured endpoint brackets and never bridges gaps over 30 minutes', () => {
    expect(completeReplayWindow([point(0, 1), point(30, 2), point(60, 1)], point(5, 0).t, point(55, 0).t)).toBe(true);
    expect(completeReplayWindow([point(0, 1), point(31, 2), point(60, 1)], point(5, 0).t, point(55, 0).t)).toBe(false);
    expect(completeReplayWindow([point(0, 1), point(30, 2)], point(-1, 0).t, point(29, 0).t)).toBe(false);
  });
  it('does not accept proxy points as support during observed outages', () => {
    expect(completeReplayWindow([point(0, 1), point(20, 2, true), point(40, 1)], point(5, 0).t, point(35, 0).t)).toBe(false);
  });
  it('permits only an explicitly supplied ten-second reporting jitter tolerance', () => {
    const observed = [point(0, 1), { t: new Date(origin + 30 * 60_000 + 5000), v: 2 }, point(60, 1)];
    expect(completeReplayWindow(observed, point(5, 0).t, point(55, 0).t)).toBe(false);
    expect(completeReplayWindow(observed, point(5, 0).t, point(55, 0).t, 30 * 60_000 + 10_000)).toBe(true);
    expect(completeReplayWindow([point(0, 1), point(60, 2)], point(5, 0).t, point(55, 0).t, 30 * 60_000 + 10_000)).toBe(false);
    expect(completeReplayWindow(observed, point(5, 0).t, point(55, 0).t, 31 * 60_000)).toBe(false);
  });
  it('scores strict threshold crossing, peak, onset and duration on complete events', () => {
    const actual = [point(0, 4), point(10, 6), point(20, 4)];
    const forecast = [point(0, 4), point(10, 7), point(20, 4)];
    const score = scoreReplayWindow(actual, forecast, 5)!;
    expect(score.actualFlood).toBe(true);
    expect(score.predictedFlood).toBe(true);
    expect(score.peakErrorFt).toBe(1);
    expect(score.matchedEvents).toBe(1);
    expect(score.onsetErrorsMinutes[0]).toBeCloseTo(5 / 3);
    expect(score.durationErrorsMinutes[0]).toBeCloseTo(10 / 3);
  });
  it('retains flood detection and peak scores but withholds clipped event times', () => {
    const points = [point(0, 6), point(10, 7), point(20, 6)];
    const score = scoreReplayWindow(points, points, 5)!;
    expect(score.actualFlood).toBe(true);
    expect(score.peakErrorFt).toBe(0);
    expect(score.observedCompleteEvents).toBe(0);
    expect(score.matchedEvents).toBe(0);
    expect(summarizeReplayScores([score]).onsetMaeMinutes).toBeNull();
  });
  it('includes nonflood windows, missed events and false alarms in detection', () => {
    const low = [point(0, 4), point(10, 5), point(20, 4)];
    const high = [point(0, 4), point(10, 6), point(20, 4)];
    const summary = summarizeReplayScores([
      scoreReplayWindow(high, high, 5)!, scoreReplayWindow(high, low, 5)!,
      scoreReplayWindow(low, high, 5)!, scoreReplayWindow(low, low, 5)!,
    ]);
    expect(summary.floodWindowDetection).toEqual({ hits: 1, misses: 1, falseAlarms: 1, correctNegatives: 1, recall: .5, precision: .5 });
  });
  it('rejects unequal timestamps instead of comparing misaligned measurements', () => {
    expect(scoreReplayWindow([point(0, 4)], [point(1, 4)], 5)).toBeNull();
    expect(scoreReplayWindow([], [], 5)).toBeNull();
  });
  it('compares onset and duration on the same observed event rather than different matched subsets', () => {
    const actual = [point(0, 4), point(10, 6), point(20, 4)];
    const weather = scoreReplayWindow(actual, [point(0, 4), point(10, 7), point(20, 4)], 5)!;
    const persistence = scoreReplayWindow(actual, actual, 5)!;
    const shared = summarizeCommonEventTiming([{ weather, persistence }]);
    expect(shared.matchedObservedEvents).toBe(1);
    expect(shared.weather.onsetMaeMinutes).toBeCloseTo(5 / 3);
    expect(shared.persistence.onsetMaeMinutes).toBe(0);
    expect(summarizeCommonEventTiming([{ weather, persistence: { ...persistence, matchedEventTimings: [] } }]).matchedObservedEvents).toBe(0);
  });
  it('freezes coefficients and excludes residual observations after issue from predictors', () => {
    const reference = { station: '30046', datum: 'MLLW', units: 'ft' };
    const model: WeatherResponseModel = {
      reference, tideReference: reference, maxObservationGapMs: 30 * 60_000, trainedUntil: point(-1440, 0).t,
      holdoutStarts: point(-1440, 0).t, testStart: point(0, 0).t, testEnd: point(1440, 0).t,
      regressions: [1, 3, 6, 12, 24].map(leadHours => ({ leadHours, model: {
        means: Array(WEATHER_RESPONSE_FEATURES.length).fill(0), scales: Array(WEATHER_RESPONSE_FEATURES.length).fill(1),
        coefficients: Array(WEATHER_RESPONSE_FEATURES.length).fill(0), intercept: .1,
      } })),
      validation: { leads: [], peakWindows: 0, peakMaeFt: null, persistencePeakMaeFt: null, eligible: false, pointEligible: false, weatherInput: 'reanalysis hindcast' }, limitations: [],
    };
    const history = Array.from({ length: 13 }, (_, i) => point((i - 8) * 30, 1 + i * .01));
    const tide = Array.from({ length: 1501 }, (_, i) => point(i - 30, 3));
    const weather = Array.from({ length: 49 }, (_, i) => ({ t: point((i - 24) * 60, 0).t, windSpeed: 10, windDirection: 0, pressure: 1015, precip: 0 }));
    const issue = point(0, 0).t, times = [issue, point(60, 0).t, point(180, 0).t];
    const forecast = replayFrozenWeatherCandidate(model, history, tide, weather, times, issue);
    expect(forecast).toHaveLength(3);
    expect(replayFrozenWeatherCandidate(model, history.map(p => +p.t > +issue ? { ...p, v: 999 } : p), tide, weather, times, issue)).toEqual(forecast);
    expect(replayFrozenWeatherCandidate({ ...model, trainedUntil: point(1, 0).t }, history, tide, weather, times, issue)).toEqual([]);
    const guarded = { ...model, regressions: model.regressions.map(regression => ({ ...regression, model: { ...regression.model, minimums: Array(WEATHER_RESPONSE_FEATURES.length).fill(0), maximums: Array(WEATHER_RESPONSE_FEATURES.length).fill(0) } })) };
    let reason: string | undefined;
    expect(replayFrozenWeatherCandidate(guarded, history, tide, weather, times, issue, { onWithheld: value => { reason = value; } })).toEqual([]);
    expect(reason).toBe('outside-training-domain');
    expect(replayFrozenWeatherCandidate(guarded, history, tide, weather, times, issue, { allowOutsideTrainingDomain: true })).toEqual(forecast);
  });
});

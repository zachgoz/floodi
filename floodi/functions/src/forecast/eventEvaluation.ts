/** Local replay evaluation helpers. Unknown water across a gap is never scored. */
import { WeatherPoint } from './model';
import { ResidualObservation, WeatherResponseModel, weatherResponseFeatures } from './weatherResponse';
import { floodWindows, FloodWindow, interpolate, WaterPoint } from './water';

const HOUR = 3600_000;
export const EVENT_REPLAY_MAX_GAP = 30 * 60_000;
export const EVENT_REPLAY_CADENCE_JITTER = 10_000;

/** Requires every segment, including endpoint brackets, to have measured support. */
export function completeReplayWindow(history: ResidualObservation[], start: Date, end: Date, maxGap = EVENT_REPLAY_MAX_GAP): boolean {
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || +end <= +start || maxGap <= 0 || maxGap > EVENT_REPLAY_MAX_GAP + EVENT_REPLAY_CADENCE_JITTER) return false;
  const alreadyPrepared = history.every((point, i) => !point.estimated && Number.isFinite(+point.t) && Number.isFinite(point.v) && (i === 0 || +point.t > +history[i - 1].t));
  const points = alreadyPrepared ? history : [...new Map(history.filter(p => !p.estimated && Number.isFinite(+p.t) && Number.isFinite(p.v)).map(p => [+p.t, p])).values()].sort((a, b) => +a.t - +b.t);
  if (interpolate(points, start, maxGap) === null || interpolate(points, end, maxGap) === null) return false;
  for (let i = 1; i < points.length; i++) {
    if (+points[i].t > +start && +points[i - 1].t < +end && +points[i].t - +points[i - 1].t > maxGap) return false;
  }
  return true;
}

/** Bypass operational publication gates only for independent evaluation of a
 * frozen candidate. The unchanged fitted coefficients and all issue predictors
 * precede issue; reanalysis supplies future weather and must be declared. */
export function replayFrozenWeatherCandidate(
  model: WeatherResponseModel, history: ResidualObservation[], tide: WaterPoint[], weather: WeatherPoint[], times: Date[], issue: Date,
  options: { allowOutsideTrainingDomain?: boolean; onWithheld?: (reason: string) => void } = {},
): WaterPoint[] {
  const withhold = (reason: string) => { options.onWithheld?.(reason); return []; };
  if (!Number.isFinite(+issue) || +model.trainedUntil >= +issue) return withhold('future-trained-model');
  const known = history.filter(p => !p.estimated && +p.t <= +issue).sort((a, b) => +a.t - +b.t);
  const anchor = known.at(-1);
  if (!anchor || +issue - +anchor.t > model.maxObservationGapMs) return withhold('missing-or-stale-measured-anchor');
  const controls = [{ t: issue, v: anchor.v }];
  for (const regression of model.regressions) {
    const target = new Date(+issue + regression.leadHours * HOUR);
    const features = weatherResponseFeatures(issue, target, anchor,
      known.filter(p => +p.t >= +issue - 4 * HOUR),
      tide.filter(p => +p.t >= +issue - 15 * 60_000 && +p.t <= +target + 15 * 60_000),
      weather.filter(w => +w.t >= +issue - 24 * HOUR && +w.t <= +issue),
      weather.filter(w => +w.t > +issue && +w.t <= +target), model.maxObservationGapMs);
    if (!features) return withhold('missing-issue-history-weather-or-tide-features');
    const fit = regression.model;
    if (!options.allowOutsideTrainingDomain && fit.minimums && fit.maximums && features.some((value, i) => value < fit.minimums![i] - 3 * fit.scales[i] || value > fit.maximums![i] + 3 * fit.scales[i])) return withhold('outside-training-domain');
    const delta = fit.intercept + fit.coefficients.reduce((sum, coefficient, i) => sum + coefficient * (features[i] - fit.means[i]) / fit.scales[i], 0);
    if (!Number.isFinite(delta)) return withhold('invalid-model-output');
    controls.push({ t: target, v: anchor.v + delta });
  }
  return times.flatMap(t => {
    const residual = interpolate(controls, t, 12 * HOUR);
    return residual === null ? [] : [{ t, v: residual }];
  });
}

export interface ReplayWindowScore {
  actualFlood: boolean; predictedFlood: boolean;
  actualAlreadyFlooding: boolean;
  peakErrorFt: number; pointMaeFt: number;
  observedCompleteEvents: number; predictedCompleteEvents: number;
  matchedEvents: number; onsetErrorsMinutes: number[]; durationErrorsMinutes: number[];
  matchedEventTimings: { observedPeakTime: Date; onsetErrorMinutes: number; durationErrorMinutes: number }[];
}
function completeEvents(points: WaterPoint[], thresholdFt: number): FloodWindow[] {
  return floodWindows(points, thresholdFt, EVENT_REPLAY_MAX_GAP).filter(event => !event.startClipped && event.endTime !== null);
}

/** Detection scores every complete time window, including nonflood windows.
 * Timing compares only complete one-to-one events whose peaks are within 3h;
 * no clipped start/end is assigned a fabricated timing error. */
export function scoreReplayWindow(actual: WaterPoint[], forecast: WaterPoint[], thresholdFt: number): ReplayWindowScore | null {
  if (!actual.length || actual.length !== forecast.length || !Number.isFinite(thresholdFt) || actual.some((p, i) => +p.t !== +forecast[i].t || !Number.isFinite(p.v) || !Number.isFinite(forecast[i].v))) return null;
  const observedEvents = completeEvents(actual, thresholdFt), predictedEvents = completeEvents(forecast, thresholdFt);
  const unmatched = new Set(predictedEvents.map((_, i) => i));
  const onsetErrorsMinutes: number[] = [], durationErrorsMinutes: number[] = [];
  const matchedEventTimings: ReplayWindowScore['matchedEventTimings'] = [];
  for (const observed of observedEvents) {
    const match = [...unmatched].map(i => ({ i, gap: Math.abs(+predictedEvents[i].peakTime - +observed.peakTime) })).filter(item => item.gap <= 3 * HOUR).sort((a, b) => a.gap - b.gap)[0];
    if (!match) continue;
    const predicted = predictedEvents[match.i];
    unmatched.delete(match.i);
    const onsetErrorMinutes = Math.abs(+predicted.startTime - +observed.startTime) / 60_000;
    const durationErrorMinutes = Math.abs((+predicted.endTime! - +predicted.startTime) - (+observed.endTime! - +observed.startTime)) / 60_000;
    onsetErrorsMinutes.push(onsetErrorMinutes);
    durationErrorsMinutes.push(durationErrorMinutes);
    matchedEventTimings.push({ observedPeakTime: observed.peakTime, onsetErrorMinutes, durationErrorMinutes });
  }
  return {
    actualFlood: actual.some(p => p.v > thresholdFt), predictedFlood: forecast.some(p => p.v > thresholdFt),
    actualAlreadyFlooding: actual[0].v > thresholdFt,
    peakErrorFt: Math.abs(Math.max(...forecast.map(p => p.v)) - Math.max(...actual.map(p => p.v))),
    pointMaeFt: actual.reduce((sum, p, i) => sum + Math.abs(forecast[i].v - p.v), 0) / actual.length,
    observedCompleteEvents: observedEvents.length, predictedCompleteEvents: predictedEvents.length,
    matchedEvents: onsetErrorsMinutes.length, onsetErrorsMinutes, durationErrorsMinutes, matchedEventTimings,
  };
}

/** Timing comparison on exactly the same observed event within each issue
 * window. This prevents differing misses from changing the timing denominator. */
export function summarizeCommonEventTiming(pairs: { weather: ReplayWindowScore; persistence: ReplayWindowScore }[]) {
  const weatherTimings: ReplayWindowScore['matchedEventTimings'] = [], persistenceTimings: ReplayWindowScore['matchedEventTimings'] = [];
  for (const pair of pairs) {
    const baseline = new Map(pair.persistence.matchedEventTimings.map(timing => [+timing.observedPeakTime, timing]));
    for (const timing of pair.weather.matchedEventTimings) {
      const match = baseline.get(+timing.observedPeakTime);
      if (match) { weatherTimings.push(timing); persistenceTimings.push(match); }
    }
  }
  const summary = (timings: ReplayWindowScore['matchedEventTimings']) => ({
    onsetMaeMinutes: timings.length ? timings.reduce((sum, timing) => sum + timing.onsetErrorMinutes, 0) / timings.length : null,
    durationMaeMinutes: timings.length ? timings.reduce((sum, timing) => sum + timing.durationErrorMinutes, 0) / timings.length : null,
  });
  return { matchedObservedEvents: weatherTimings.length, weather: summary(weatherTimings), persistence: summary(persistenceTimings) };
}

export function summarizeReplayScores(scores: ReplayWindowScore[]) {
  const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const onsets = scores.flatMap(score => score.onsetErrorsMinutes), durations = scores.flatMap(score => score.durationErrorsMinutes);
  const hits = scores.filter(score => score.actualFlood && score.predictedFlood).length;
  const misses = scores.filter(score => score.actualFlood && !score.predictedFlood).length;
  const falseAlarms = scores.filter(score => !score.actualFlood && score.predictedFlood).length;
  const correctNegatives = scores.filter(score => !score.actualFlood && !score.predictedFlood).length;
  const dryStart = scores.filter(score => !score.actualAlreadyFlooding);
  const newHits = dryStart.filter(score => score.actualFlood && score.predictedFlood).length;
  const newMisses = dryStart.filter(score => score.actualFlood && !score.predictedFlood).length;
  const newFalseAlarms = dryStart.filter(score => !score.actualFlood && score.predictedFlood).length;
  const newCorrectNegatives = dryStart.filter(score => !score.actualFlood && !score.predictedFlood).length;
  return {
    windows: scores.length, peakMaeFt: average(scores.map(score => score.peakErrorFt)), pointMaeFt: average(scores.map(score => score.pointMaeFt)),
    floodWindowDetection: { hits, misses, falseAlarms, correctNegatives, recall: hits + misses ? hits / (hits + misses) : null, precision: hits + falseAlarms ? hits / (hits + falseAlarms) : null },
    dryStartFloodWindowDetection: { windows: dryStart.length, hits: newHits, misses: newMisses, falseAlarms: newFalseAlarms, correctNegatives: newCorrectNegatives, recall: newHits + newMisses ? newHits / (newHits + newMisses) : null, precision: newHits + newFalseAlarms ? newHits / (newHits + newFalseAlarms) : null },
    observedCompleteEvents: scores.reduce((sum, score) => sum + score.observedCompleteEvents, 0),
    predictedCompleteEvents: scores.reduce((sum, score) => sum + score.predictedCompleteEvents, 0),
    matchedCompleteEvents: onsets.length, onsetMaeMinutes: average(onsets), durationMaeMinutes: average(durations),
  };
}

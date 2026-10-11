/** Offline event replay. Usage: node lib/scripts/evaluate_events.js <archive> [later archive] [output.json] [--strict|--unguarded|--short-range]
 * Original purged70/30 coefficients frozen; no cloud writes, network or credentials. */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { WeatherPoint } from '../forecast/model';
import { completeReplayWindow, EVENT_REPLAY_CADENCE_JITTER, EVENT_REPLAY_MAX_GAP, replayFrozenWeatherCandidate, ReplayWindowScore, scoreReplayWindow, summarizeCommonEventTiming, summarizeReplayScores } from '../forecast/eventEvaluation';
import { projectShortRangeResidual, ResidualObservation, trainWeatherResponse } from '../forecast/weatherResponse';
import { floodWindows, interpolate, WaterPoint } from '../forecast/water';

const HOUR = 3600_000;
interface Archive {
  history: (Omit<ResidualObservation, 't'> & { t: string })[];
  tide: { t: string; v: number }[];
  weather: (Omit<WeatherPoint, 't'> & { t: string })[];
  metadata: { sensor: string; datum: string; units: string; tideStation: string; phaseMinutes: number; navd88ToMllwFt: number; [key: string]: unknown };
}
function merge<T extends { t: string }>(arrays: T[][]): (Omit<T, 't'> & { t: Date })[] {
  return [...new Map(arrays.flat().filter(p => Number.isFinite(Date.parse(p.t))).map(p => [p.t, { ...p, t: new Date(p.t) }])).values()].sort((a, b) => +a.t - +b.t);
}
function run() {
  const argumentsWithoutFlags = process.argv.slice(2).filter(argument => !argument.startsWith('--'));
  const strict = process.argv.includes('--strict');
  const unguarded = process.argv.includes('--unguarded');
  const shortRange = process.argv.includes('--short-range');
  const candidateName = shortRange ? 'shortRange' : 'weather';
  const horizons = shortRange ? [6] : [3, 6, 12, 24];
  if (shortRange && unguarded) throw new Error('The short-range replay always calls the guarded production projector');
  const maxGap = EVENT_REPLAY_MAX_GAP + (strict ? 0 : EVENT_REPLAY_CADENCE_JITTER);
  const primary = argumentsWithoutFlags[0];
  if (!primary) throw new Error('Supply a provenance-bearing regional gauge archive');
  const paths = [primary];
  if (argumentsWithoutFlags[1]) paths.push(argumentsWithoutFlags[1]);
  const archives = paths.map(path => JSON.parse(readFileSync(path, 'utf8')) as Archive);
  const first = archives[0].metadata;
  for (const archive of archives) {
    const metadata = archive.metadata;
    if (metadata.sensor !== '30046' || metadata.units !== 'ft' || metadata.datum !== 'MLLW' || ['tideStation', 'phaseMinutes', 'navd88ToMllwFt'].some(key => metadata[key] !== first[key])) throw new Error('Compatible gauge30046, ft MLLW, tide phase and conversion metadata are required');
  }
  const history = merge(archives.map(a => a.history)).filter(p => !p.estimated && Number.isFinite(p.v));
  const tide = merge(archives.map(a => a.tide));
  const weather = merge(archives.map(a => a.weather));
  const ref = { station: '30046', datum: 'MLLW', units: 'ft' };
  const originalHistory = merge([archives[0].history]).filter(point => !point.estimated && Number.isFinite(point.v));
  const originalTide = merge([archives[0].tide]), originalWeather = merge([archives[0].weather]);
  const model = trainWeatherResponse(originalHistory, originalTide, originalWeather, ref, ref, { maxObservationGapMs: maxGap, refitValidatedModel: false });
  if (!model || model.regressions.length !== 5) throw new Error('Insufficient frozen historical fit');
  const testStart = new Date(Math.ceil(+model.holdoutStarts / HOUR) * HOUR), testEnd = history.at(-1)!.t;
  const thresholdFt = 5.6;
  const observedTotals = history.flatMap(point => {
    const astronomical = interpolate(tide, point.t);
    return astronomical === null ? [] : [{ t: point.t, v: point.v + astronomical }];
  });
  const nativeEvents = floodWindows(observedTotals.filter(point => +point.t >= +testStart), thresholdFt, maxGap);
  const nativeComplete = nativeEvents.filter(event => !event.startClipped && event.endTime !== null);
  const gaps = history.slice(1).map((point, i) => +point.t - +history[i].t).filter(gap => gap > EVENT_REPLAY_MAX_GAP);
  const groups = [];
  const cachedCandidates = new Map<number, WaterPoint[]>();
  const cachedWithholdReasons = new Map<number, string>();
  for (const horizonHours of horizons) {
    const scores: Record<string, ReplayWindowScore[]> = { [candidateName]: [], persistence: [], tideOnly: [] };
    const fixedScores: Record<string, ReplayWindowScore[]> = { [candidateName]: [], persistence: [], tideOnly: [] };
    const counts = { attempted: 0, excludedObservationGap: 0, excludedIssueOrWeather: 0, excludedTide: 0, persistenceFallback: 0, outsideTrainingDomainFallback: 0, missingFeaturesFallback: 0, shortRangeWithheldFallback: 0, included: 0 };
    const windows = [];
    for (let ms = +testStart; ms + horizonHours * HOUR <= +testEnd; ms += HOUR) {
      counts.attempted++;
      const issue = new Date(ms), end = new Date(ms + horizonHours * HOUR);
      if (!completeReplayWindow(history, issue, end, maxGap)) { counts.excludedObservationGap++; continue; }
      const anchor = history.filter(p => +p.t <= ms).at(-1)!;
      if (!anchor || ms - +anchor.t > maxGap) { counts.excludedIssueOrWeather++; continue; }
      const times = [...new Set([
        ...Array.from({ length: horizonHours * 10 + 1 }, (_, i) => ms + i * 6 * 60_000),
        ...history.filter(p => +p.t >= ms && +p.t <= +end).map(p => +p.t),
      ])].sort((a, b) => a - b).map(time => new Date(time));
      if (!cachedCandidates.has(ms)) {
        const maximumCandidateHours = shortRange ? 6 : 24;
        const allCandidateTimes = [...new Set([
          ...Array.from({ length: maximumCandidateHours * 10 + 1 }, (_, i) => ms + i * 6 * 60_000),
          ...history.filter(point => +point.t >= ms && +point.t <= ms + maximumCandidateHours * HOUR).map(point => +point.t),
        ])].sort((a, b) => a - b).map(time => new Date(time));
        cachedCandidates.set(ms, shortRange ? projectShortRangeResidual(model, history, tide, allCandidateTimes, issue, ref, ref) : replayFrozenWeatherCandidate(model, history, tide, weather, allCandidateTimes, issue, {
          allowOutsideTrainingDomain: unguarded,
          onWithheld: reason => cachedWithholdReasons.set(ms, reason),
        }));
        if (shortRange && !cachedCandidates.get(ms)!.length) cachedWithholdReasons.set(ms, model.shortRange?.eligible ? 'short-range-production-data-or-domain-withhold' : 'short-range-production-validation-withhold');
      }
      const candidate = cachedCandidates.get(ms)!.filter(point => +point.t <= +end);
      const useFallback = candidate.length !== times.length;
      if (useFallback) {
        counts.persistenceFallback++;
        if (shortRange) counts.shortRangeWithheldFallback++;
        else if (cachedWithholdReasons.get(ms) === 'outside-training-domain') counts.outsideTrainingDomainFallback++;
        else counts.missingFeaturesFallback++;
      }
      const tideValues = times.map(time => interpolate(tide, time));
      if (tideValues.some(value => value === null)) { counts.excludedTide++; continue; }
      const actualValues = times.map(time => interpolate(observedTotals, time, maxGap));
      if (actualValues.some(value => value === null)) { counts.excludedTide++; continue; }
      const actual = times.map((time, i) => ({ t: time, v: actualValues[i]! }));
      const forecasts: Record<string, WaterPoint[]> = {
        [candidateName]: useFallback ? times.map((time, i) => ({ t: time, v: anchor.v + tideValues[i]! })) : candidate.map((point, i) => ({ t: point.t, v: point.v + tideValues[i]! })),
        persistence: times.map((time, i) => ({ t: time, v: anchor.v + tideValues[i]! })),
        tideOnly: times.map((time, i) => ({ t: time, v: tideValues[i]! })),
      };
      const windowScores = Object.fromEntries(Object.entries(forecasts).map(([name, forecast]) => [name, scoreReplayWindow(actual, forecast, thresholdFt)!]));
      counts.included++;
      const onFixedSchedule = (ms - +testStart) % (horizonHours * HOUR) === 0;
      for (const [name, score] of Object.entries(windowScores)) { scores[name].push(score); if (onFixedSchedule) fixedScores[name].push(score); }
      windows.push({ issue, end, onFixedSchedule, persistenceFallback: useFallback, withholdReason: cachedWithholdReasons.get(ms) || null, actualPeakFt: Math.max(...actual.map(point => point.v)), scores: windowScores });
    }
    const commonTiming = (values: Record<string, ReplayWindowScore[]>) => {
      const common = summarizeCommonEventTiming(values[candidateName].map((candidateScore, i) => ({ weather: candidateScore, persistence: values.persistence[i] })));
      return { matchedObservedEvents: common.matchedObservedEvents, [candidateName]: common.weather, persistence: common.persistence };
    };
    groups.push({ horizonHours, coverage: counts,
      hourlyIssues: Object.fromEntries(Object.entries(scores).map(([name, values]) => [name, summarizeReplayScores(values)])),
      nonoverlappingUtcIssues: Object.fromEntries(Object.entries(fixedScores).map(([name, values]) => [name, summarizeReplayScores(values)])),
      commonObservedEventTiming: {
        hourlyIssues: commonTiming(scores),
        nonoverlappingUtcIssues: commonTiming(fixedScores),
      }, windows });
  }
  const report = {
    evaluatedAt: new Date().toISOString(), inputArchives: paths, reference: first,
    training: { coefficientTargetCutoff: model.holdoutStarts, trainedUntil: model.trainedUntil, refittedUsingHoldout: false, frozenBefore: testStart, pretestScreen: shortRange ? model.shortRange?.leads : model.validation },
    testing: { start: testStart, end: testEnd, thresholdFt, horizonsHours: horizons, candidate: shortRange ? 'Learned measured residual, prior3h change and upcoming astronomical tide change; no upcoming meteorology.' : 'Full wind/pressure/rain residual-change model', nominalMaximumObservationGapMinutes: 30, reportingCadenceJitterSeconds: strict ? 0 : 10, effectiveMaximumGapSeconds: maxGap / 1000, reconstruction: 'At native observation timestamps actual total = archived measured residual + exact same localized astronomical tide. Piecewise linear interpolation of these observed totals, with the declared gap bound, supplies only intermediate scoring times. All native readings retained; no spike filtering or retimestamping.', pointErrorSampling: 'Union of regular6min grid and all native observations; per-window mean, then equal-window mean.', weather: shortRange ? 'No future weather used at prediction time; training ablation uses same complete historical pairs as weather model.' : 'Future reanalysis hindcast, not archived issued forecasts', candidateGuard: unguarded ? 'Sensitivity only: training-domain guard bypassed' : 'Exact production feature min/max plus3SD guard at every lead', missingModelBehavior: 'Candidate method uses measured-residual persistence fallback when withheld; otherwise-observable windows remain in the denominator.' },
    gapDiagnostics: { gapsAboveStrict30Minutes: gaps.length, gapsWithin10SecondCadenceJitter: gaps.filter(gap => gap <= EVENT_REPLAY_MAX_GAP + EVENT_REPLAY_CADENCE_JITTER).length, largerGaps: gaps.filter(gap => gap > EVENT_REPLAY_MAX_GAP + EVENT_REPLAY_CADENCE_JITTER).length, note: 'Strict30min fragments records spaced30min plus a few seconds. This report declares its ten-second cadence tolerance explicitly and preserves exact source timestamps. Hourly outages remain excluded.' },
    nativeEventCoverage: { all: nativeEvents.length, complete: nativeComplete.length, completeEvents: nativeComplete.map(event => ({ startTime: event.startTime, endTime: event.endTime, peakTime: event.peakTime, peakValueFt: event.peakValue, durationMinutes: (+event.endTime! - +event.startTime) / 60_000 })) },
    results: groups,
    limitations: [
      'The 3h/6h evaluations include complete fixed-duration windows regardless of flood status. Missing windows are excluded equally for every method.',
      'Hourly issues overlap; their events and error summaries are correlated and not independent trials. Nonoverlapping UTC schedules are reported separately.',
      'Onset and duration use only complete, one-to-one matched events within three hours of observed peak. Clipped events never receive invented timing.',
      'Matching complete events is a conditional timing sample; flood-window confusion matrices also expose misses and false alarms.',
      'Common-event timing compares only the exact same observed events matched by weather and persistence within each issue window. Separate conditional timing summaries may use different matched samples.',
      shortRange ? 'Short-range replay calls the actual production projector, including its eligibility, domain and missing-data gates. No guard is bypassed.' : 'The frozen weather candidate is evaluated regardless of earlier publication screening, with no parameter changes or selection based on held-out events.',
      'Candidate scores include persistence fallback for withheld predictions. Full weather replay separates OOD from missing-feature fallback; short-range replay reports combined production withholds.',
      'The original archive chronological70/30 split is reused without refitting on held-out targets. Later archive data extends evaluation only.',
      'Observed support does not imply every short lived spike is physical. Provider non-evaluated records and all isolated spikes remain.',
      shortRange ? 'Short-range forecasts use measured state and astronomical tide only; abrupt upcoming weather changes are not represented. Existing phase and vertical datum conversion remain uncalibrated.' : 'Future weather reanalysis omits weather forecast error. Existing phase and vertical datum conversion remain uncalibrated.',
      'This replay is evidence about hindcast skill, not a guarantee of operational event accuracy.',
    ],
  };
  const output = argumentsWithoutFlags[2] || join(dirname(primary), shortRange ? 'event-replay-short-range-validation.json' : unguarded ? 'event-replay-unguarded-validation.json' : strict ? 'event-replay-strict-validation.json' : 'event-replay-validation.json');
  writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, training: report.training, testing: report.testing, results: groups.map(({ windows: _windows, ...summary }) => summary) }, null, 2));
}
try { run(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }

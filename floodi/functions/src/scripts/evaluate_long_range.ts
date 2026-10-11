/** Local, provenance-bearing three-day forecast replay. No network/cloud writes.
 * Usage: node lib/scripts/evaluate_long_range.js original-archive.json report.json
 *        [later-archive.json] [already-frozen-model.json]
 */
import { readFileSync, writeFileSync } from 'fs';
import { WeatherPoint } from '../forecast/model';
import { ReplayWindowScore, scoreReplayWindow, summarizeCommonEventTiming, summarizeReplayScores } from '../forecast/eventEvaluation';
import { interpolate, Reference } from '../forecast/water';
import { LONG_RANGE_FEATURES, LONG_RANGE_LEADS, projectLongRangeResidual, projectShortRangeResidual, projectWeatherResidual, trainWeatherResponse, WEATHER_OBSERVATION_MAX_GAP_MS, WeatherResponseModel } from '../forecast/weatherResponse';

const HOUR = 3600_000;
const ref: Reference = { station: '30046', datum: 'MLLW', units: 'ft' };
interface Archive { history: { t: string; v: number }[]; tide: { t: string; v: number }[]; weather: (Omit<WeatherPoint, 't'> & { t: string })[]; metadata: { sensor: string; datum: string; units: string; [key: string]: unknown } }
const mean = (values: number[]) => values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
function readArchive(path: string) {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Archive;
  if (raw.metadata.sensor !== '30046' || raw.metadata.datum !== 'MLLW' || raw.metadata.units !== 'ft') throw new Error('Gauge30046 feetMLLW provenance required');
  return { metadata: raw.metadata, history: raw.history.map(p => ({ ...p, t: new Date(p.t) })), tide: raw.tide.map(p => ({ ...p, t: new Date(p.t) })), weather: raw.weather.map(p => ({ ...p, t: new Date(p.t) })) };
}
function replay(model: WeatherResponseModel, archive: ReturnType<typeof readArchive>, start: number) {
  const { history, tide, weather } = archive;
  const observed = history.flatMap(p => { const astronomical = interpolate(tide, p.t); return astronomical === null ? [] : [{ t: p.t, v: p.v + astronomical }]; });
  const branches = (['residual-response', 'weather-response'] as const).map(method => ({
    method, leads: LONG_RANGE_LEADS.map(leadHours => ({ leadHours, errors: [] as number[], steadyErrors: [] as number[], withheld: 0, missingActual: 0 })),
    peakErrors: [] as number[], steadyPeakErrors: [] as number[], nativeDailyWindows: 0, withheldDailyWindows: 0,
    dailyScores: [] as { weather: ReplayWindowScore; persistence: ReplayWindowScore }[],
    complete72hScores: [] as { weather: ReplayWindowScore; persistence: ReplayWindowScore }[],
  }));
  const prefix = (method: 'residual-response' | 'weather-response', issue: Date) => {
    const times = [issue, ...tide.filter(point => +point.t > +issue && +point.t <= +issue + (method === 'residual-response' ? 6 : 24) * HOUR).map(point => point.t)];
    return method === 'residual-response'
      ? projectShortRangeResidual(model, history, tide, times, issue, ref, ref)
      : projectWeatherResidual(model, history, tide, weather, weather, times, issue, ref, ref);
  };
  let anchorIndex = 0;
  for (let ms = Math.ceil(start / HOUR) * HOUR; ms <= +history.at(-1)!.t; ms += HOUR) {
    while (anchorIndex + 1 < history.length && +history[anchorIndex + 1].t <= ms) anchorIndex++;
    const anchor = history[anchorIndex];
    if (+anchor.t < start || ms - +anchor.t > WEATHER_OBSERVATION_MAX_GAP_MS) continue;
    const issue = anchor.t;
    for (const branch of branches) {
      const initial = prefix(branch.method, issue);
      const requested = branch.leads.map(lead => new Date(+issue + lead.leadHours * HOUR)).filter(t => +t <= +history.at(-1)!.t);
      const forecast = projectLongRangeResidual(model, history, tide, requested, issue, ref, ref, { prefix: initial });
      for (const lead of branch.leads) {
        const target = new Date(+issue + lead.leadHours * HOUR);
        if (+target > +history.at(-1)!.t) continue;
        const actual = interpolate(history, target, WEATHER_OBSERVATION_MAX_GAP_MS);
        if (actual === null) { lead.missingActual++; continue; }
        const predicted = forecast.find(point => +point.t === +target);
        if (!predicted) { lead.withheld++; continue; }
        lead.errors.push(Math.abs(predicted.v - actual)); lead.steadyErrors.push(Math.abs(anchor.v - actual));
      }
    }
  }
  // Daily issues/daily observed peaks; the day2/day3 samples overlap across
  // issues and are descriptive comparisons, not independent confidence trials.
  anchorIndex = 0;
  for (let ms = Math.ceil(start / (24 * HOUR)) * 24 * HOUR; ms + 24 * HOUR <= +history.at(-1)!.t; ms += 24 * HOUR) {
    while (anchorIndex + 1 < history.length && +history[anchorIndex + 1].t <= ms) anchorIndex++;
    const anchor = history[anchorIndex];
    if (+anchor.t < start || ms - +anchor.t > WEATHER_OBSERVATION_MAX_GAP_MS) continue;
    const issue = anchor.t;
    for (const branch of branches) {
      const initial = prefix(branch.method, issue);
      for (const day of [1, 2, 3]) {
        const from = +issue + (day - 1) * 24 * HOUR, until = from + 24 * HOUR;
        if (until > +history.at(-1)!.t) continue;
        const times = [...new Set([...Array.from({ length: 241 }, (_, i) => from + i * 6 * 60_000), ...observed.filter(p => +p.t >= from && +p.t <= until).map(p => +p.t)])].sort((a, b) => a - b).map(t => new Date(t));
        const actual = times.map(t => interpolate(observed, t, WEATHER_OBSERVATION_MAX_GAP_MS)), astronomical = times.map(t => interpolate(tide, t));
        if (actual.some(v => v === null) || astronomical.some(v => v === null)) continue;
        branch.nativeDailyWindows++;
        const forecast = projectLongRangeResidual(model, history, tide, times, issue, ref, ref, { prefix: initial });
        if (forecast.length !== times.length) { branch.withheldDailyWindows++; continue; }
        const peak = Math.max(...actual.map(v => v!));
        branch.peakErrors.push(Math.abs(Math.max(...forecast.map((p, i) => p.v + astronomical[i]!)) - peak));
        branch.steadyPeakErrors.push(Math.abs(Math.max(...astronomical.map(v => v! + anchor.v)) - peak));
        const actualPoints = times.map((t, i) => ({ t, v: actual[i]! }));
        const totalPoints = forecast.map((p, i) => ({ t: p.t, v: p.v + astronomical[i]! }));
        const steadyPoints = times.map((t, i) => ({ t, v: anchor.v + astronomical[i]! }));
        const score = scoreReplayWindow(actualPoints, totalPoints, 5.6), steadyScore = scoreReplayWindow(actualPoints, steadyPoints, 5.6);
        if (score && steadyScore) branch.dailyScores.push({ weather: score, persistence: steadyScore });
      }
    }
  }
  anchorIndex = 0;
  for (let ms = Math.ceil(start / (24 * HOUR)) * 24 * HOUR; ms + 72 * HOUR <= +history.at(-1)!.t; ms += 72 * HOUR) {
    while (anchorIndex + 1 < history.length && +history[anchorIndex + 1].t <= ms) anchorIndex++;
    const anchor = history[anchorIndex];
    if (+anchor.t < start || ms - +anchor.t > WEATHER_OBSERVATION_MAX_GAP_MS) continue;
    const issue = anchor.t, end = +issue + 72 * HOUR;
    const times = [...new Set([...Array.from({ length: 721 }, (_, i) => +issue + i * 6 * 60_000), ...observed.filter(p => +p.t >= +issue && +p.t <= end).map(p => +p.t)])].sort((a, b) => a - b).map(t => new Date(t));
    const actual = times.map(t => interpolate(observed, t, WEATHER_OBSERVATION_MAX_GAP_MS)), astronomical = times.map(t => interpolate(tide, t));
    if (actual.some(v => v === null) || astronomical.some(v => v === null)) continue;
    for (const branch of branches) {
      const forecast = projectLongRangeResidual(model, history, tide, times, issue, ref, ref, { prefix: prefix(branch.method, issue) });
      if (forecast.length !== times.length) continue;
      const score = scoreReplayWindow(times.map((t, i) => ({ t, v: actual[i]! })), forecast.map((p, i) => ({ t: p.t, v: p.v + astronomical[i]! })), 5.6);
      const steadyScore = scoreReplayWindow(times.map((t, i) => ({ t, v: actual[i]! })), times.map((t, i) => ({ t, v: anchor.v + astronomical[i]! })), 5.6);
      if (score && steadyScore) branch.complete72hScores.push({ weather: score, persistence: steadyScore });
    }
  }
  return branches.map(branch => ({
    method: branch.method, leads: branch.leads.map(lead => ({ leadHours: lead.leadHours, pairs: lead.errors.length, modelMaeFt: mean(lead.errors), persistenceMaeFt: mean(lead.steadyErrors), withheld: lead.withheld, missingActual: lead.missingActual })),
    nativeDailyWindows: branch.nativeDailyWindows, evaluatedDailyWindows: branch.peakErrors.length, withheldDailyWindows: branch.withheldDailyWindows,
    peakMaeFt: mean(branch.peakErrors), persistencePeakMaeFt: mean(branch.steadyPeakErrors),
    dailyEventReplay: { model: summarizeReplayScores(branch.dailyScores.map(p => p.weather)), persistence: summarizeReplayScores(branch.dailyScores.map(p => p.persistence)), sameEventTiming: summarizeCommonEventTiming(branch.dailyScores) },
    nonoverlapping72hEventReplay: { model: summarizeReplayScores(branch.complete72hScores.map(p => p.weather)), persistence: summarizeReplayScores(branch.complete72hScores.map(p => p.persistence)), sameEventTiming: summarizeCommonEventTiming(branch.complete72hScores) },
  }));
}
function run() {
  const [input, output, laterInput, frozenInput] = process.argv.slice(2);
  if (!input || !output) throw new Error('Original provenance archive and local report paths required');
  const archive = readArchive(input);
  let model = frozenInput ? JSON.parse(readFileSync(frozenInput, 'utf8')) as WeatherResponseModel : trainWeatherResponse(archive.history, archive.tide, archive.weather, ref, ref, { refitValidatedModel: false });
  if (!model) throw new Error('Insufficient compatible training observations');
  model = { ...model, trainedUntil: new Date(model.trainedUntil), holdoutStarts: new Date(model.holdoutStarts), testStart: new Date(model.testStart), testEnd: new Date(model.testEnd) };
  const later = laterInput ? readArchive(laterInput) : null;
  const report = {
    evaluatedAt: new Date().toISOString(), inputArchive: input, laterArchive: laterInput ?? null,
    frozenWeights: true, trainedUntil: model.trainedUntil, testStart: model.testStart, testEnd: model.testEnd, eventThresholdFtMllw: 5.6,
    features: LONG_RANGE_FEATURES, method: 'Fixed penalty20 standardized lead-specific ridge; unsupported12/24h candidate replaced by explicit steady baseline; supported48/72h learned tide/mean-reversion response.',
    validation: model.longRange ? { ...model.longRange, regressions: undefined } : null,
    laterReplay: later ? { classification: 'Out-of-training replay with development-period overlap; not pristine independent validation', start: archive.metadata.end, results: replay(model, later, Date.parse(String(archive.metadata.end))) } : null,
    limitations: ['12/24h learned candidates did not satisfy the unchanged5% gate and are not used in the tail.', '48/72h models do not use future weather; upcoming storm departures may be missed.', 'Weather-prefix future weather is reanalysis and excludes issued-weather forecast error.', 'Daily windows across leads overlap; errors are descriptive and confidence intervals are not calibrated.', 'Candidate development inspected a later90d archive including the replay week; later replay is not an untouched model-selection holdout.', 'Existing NOAA phase and NAVD88 to MLLW conversion remain independently uncalibrated.'],
  };
  writeFileSync(output, JSON.stringify(report, null, 2));
  writeFileSync(output.replace(/\.json$/, '-model.json'), JSON.stringify(model));
  console.log(JSON.stringify({ output, validation: report.validation, laterReplay: report.laterReplay }, null, 2));
}
try { run(); } catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; }

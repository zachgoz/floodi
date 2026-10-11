/** Local-file, fixed-candidate joined-prefix hindcast; no network/cloud writes.
 * node lib/scripts/evaluate_historical_outlook.js archive.json frozen-near.json report.json
 */
import { readFileSync, writeFileSync } from 'fs';
import { trainHistoricalOutlook, historicalPatternSummary, projectHistoricalOutlook, HISTORICAL_OUTLOOK_LEADS } from '../forecast/historicalOutlook';
import { projectShortRangeResidual, projectWeatherResidual, WeatherResponseModel } from '../forecast/weatherResponse';
import { WeatherPoint } from '../forecast/model';
import { interpolate, Reference } from '../forecast/water';
import { scoreReplayWindow, summarizeReplayScores, summarizeCommonEventTiming, ReplayWindowScore } from '../forecast/eventEvaluation';
const HOUR = 3600_000, GAP = 30 * 60_000 + 10_000;
const mean = (values: number[]) => values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
interface Archive { history: { t: string; v: number }[]; tide: { t: string; v: number }[]; weather: (Omit<WeatherPoint, 't'> & { t: string })[]; metadata: { sensor: string; datum: string; units: string; [key: string]: unknown } }
function run() {
  const [input, nearInput, output] = process.argv.slice(2);
  if (!input || !nearInput || !output) throw new Error('Archive, frozen near-model and report paths required');
  const archive = JSON.parse(readFileSync(input, 'utf8')) as Archive;
  if (archive.metadata.sensor !== '30046' || archive.metadata.datum !== 'MLLW' || archive.metadata.units !== 'ft') throw new Error('Verified gauge30046 localized feetMLLW archive required');
  const history = archive.history.map(p => ({ ...p, t: new Date(p.t) })), tide = archive.tide.map(p => ({ ...p, t: new Date(p.t) })), weather = archive.weather.map(p => ({ ...p, t: new Date(p.t) }));
  const ref: Reference = { station: '30046', datum: 'MLLW', units: 'ft' };
  const model = trainHistoricalOutlook(history, tide, weather, ref, ref, { refitValidatedModel: false });
  if (!model) throw new Error('Insufficient compatible historical observations');
  const nearRaw = JSON.parse(readFileSync(nearInput, 'utf8')) as WeatherResponseModel;
  const near = { ...nearRaw, trainedUntil: new Date(nearRaw.trainedUntil), holdoutStarts: new Date(nearRaw.holdoutStarts), testStart: new Date(nearRaw.testStart), testEnd: new Date(nearRaw.testEnd) };
  if (+near.trainedUntil > Date.parse(model.testStart)) throw new Error('Near-term weights must precede holdout');
  const observed = history.flatMap(p => { const at = interpolate(tide, p.t); return at === null ? [] : [{ t: p.t, v: p.v + at }]; });
  const compositions = (['residual-response', 'weather-response'] as const).map(method => {
    const leads = HISTORICAL_OUTLOOK_LEADS.map(leadHours => ({ leadHours, errors: [] as number[], historicalOnlyErrors: [] as number[], steadyErrors: [] as number[], withheld: 0 }));
    const eventPairs: { leadHours: number; weather: ReplayWindowScore; persistence: ReplayWindowScore }[] = [];
    let anchorIndex = 0;
    for (let ms = Math.ceil(Date.parse(model.testStart) / (24 * HOUR)) * 24 * HOUR; ms <= +history.at(-1)!.t; ms += 24 * HOUR) {
      while (anchorIndex + 1 < history.length && +history[anchorIndex + 1].t <= ms) anchorIndex++;
      const anchor = history[anchorIndex]; if (!anchor || ms - +anchor.t > GAP) continue;
      const issue = anchor.t;
      const prefixTimes = [issue, ...tide.filter(p => +p.t > +issue && +p.t <= +issue + (method === 'residual-response' ? 6 : 24) * HOUR).map(p => p.t)];
      const prefix = method === 'residual-response' ? projectShortRangeResidual(near, history, tide, prefixTimes, issue, ref, ref) : projectWeatherResidual(near, history, tide, weather, weather, prefixTimes, issue, ref, ref);
      const times = HISTORICAL_OUTLOOK_LEADS.map(lead => new Date(+issue + lead * HOUR)).filter(t => +t <= +history.at(-1)!.t);
      const future = weather.filter(w => +w.t > +issue && +w.t <= +issue + 16 * 24 * HOUR), past = weather.filter(w => +w.t <= +issue && +w.t >= +issue - 3 * 24 * HOUR);
      const outlook = projectHistoricalOutlook(model, history, tide, past, future, times, issue, ref, ref, { prefix });
      const historicalOnly = projectHistoricalOutlook(model, history, tide, past, [], times, issue, ref, ref, { prefix });
      for (const lead of leads) {
        const target = new Date(+issue + lead.leadHours * HOUR); if (+target > +history.at(-1)!.t) continue;
        const actual = interpolate(history, target, GAP); if (actual === null) continue;
        const prediction = outlook.points.find(p => +p.t === +target), baseline = historicalOnly.points.find(p => +p.t === +target);
        if (!prediction || !baseline) { lead.withheld++; continue; }
        lead.errors.push(Math.abs(prediction.v - actual)); lead.historicalOnlyErrors.push(Math.abs(baseline.v - actual)); lead.steadyErrors.push(Math.abs(anchor.v - actual));
      }
      for (const horizon of [24, 72, 120, 168, 336]) {
        const until = +issue + horizon * HOUR; if (until > +history.at(-1)!.t) continue;
        const windowTimes = [...new Set([...Array.from({ length: horizon * 10 + 1 }, (_, i) => +issue + i * 6 * 60_000), ...observed.filter(p => +p.t >= +issue && +p.t <= until).map(p => +p.t)])].sort((a, b) => a - b).map(t => new Date(t));
        const actual = windowTimes.map(t => interpolate(observed, t, GAP)), astronomical = windowTimes.map(t => interpolate(tide, t));
        if (actual.some(v => v === null) || astronomical.some(v => v === null)) continue;
        const forecast = projectHistoricalOutlook(model, history, tide, past, future, windowTimes, issue, ref, ref, { prefix });
        if (forecast.points.length !== windowTimes.length) continue;
        const actualPoints = windowTimes.map((t, i) => ({ t, v: actual[i]! }));
        const predicted = forecast.points.map((p, i) => ({ t: p.t, v: p.v + astronomical[i]! }));
        const steady = windowTimes.map((t, i) => ({ t, v: anchor.v + astronomical[i]! }));
        const score = scoreReplayWindow(actualPoints, predicted, 5.6), persistence = scoreReplayWindow(actualPoints, steady, 5.6);
        if (score && persistence) eventPairs.push({ leadHours: horizon, weather: score, persistence });
      }
    }
    return { method, leads: leads.map(lead => ({ leadHours: lead.leadHours, pairs: lead.errors.length, modelMaeFt: mean(lead.errors), historicalOnlyMaeFt: mean(lead.historicalOnlyErrors), persistenceMaeFt: mean(lead.steadyErrors), withheld: lead.withheld })), windows: [24, 72, 120, 168, 336].map(leadHours => { const pairs = eventPairs.filter(pair => pair.leadHours === leadHours); return { leadHours, model: summarizeReplayScores(pairs.map(p => p.weather)), persistence: summarizeReplayScores(pairs.map(p => p.persistence)), commonTiming: summarizeCommonEventTiming(pairs) }; }) };
  });
  const report = { evaluatedAt: new Date().toISOString(), inputArchive: input, frozenNearModel: nearInput, provenance: archive.metadata, trainedUntil: model.trainedUntil, testStart: model.testStart, testEnd: model.testEnd, summary: historicalPatternSummary(model), validation: model.validation, compositions, limitations: [...model.validation.limitations, 'Joined-prefix point and complete-window comparisons use daily issues; windows overlap and are descriptive, not independent storms.', 'Candidate development inspected portions of holdout; this is transparent hindcast screening, not pristine prospective validation.'] };
  writeFileSync(output, JSON.stringify(report, null, 2)); writeFileSync(output.replace(/\.json$/, '-model.json'), JSON.stringify(model));
  console.log(JSON.stringify({ output, validation: model.validation, compositions }, null, 2));
}
try { run(); } catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; }

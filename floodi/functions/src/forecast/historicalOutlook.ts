/** Interpretable seasonal-coverage-limited tide pattern and weather hindcast.
 * All water values are feet in one explicitly localized station/datum reference.
 * Private weather weights never appear in the public pattern summary.
 */
import type { WeatherPoint } from './model';
import type { Reference, WaterPoint } from './water';
import { interpolate } from './water';

const HOUR = 3600_000;
const GAP = 30 * 60_000 + 10_000;
export const HISTORICAL_OUTLOOK_LEADS = [1, 3, 6, 24, 72, 120, 168, 336];
export const HISTORICAL_WEATHER_FEATURES = ['tideLevel', 'tideSlope1h', 'northWind6h', 'eastWind6h', 'northWind24h', 'eastWind24h', 'pressure', 'pressureChange6h', 'rain6h', 'rain24h'];
interface Regression { intercept: number; means: number[]; scales: number[]; coefficients: number[]; minimums: number[]; maximums: number[] }
export interface HistoricalOutlookLead {
  leadHours: number; testPairs: number; historicalMaeFt: number | null; persistenceMaeFt: number | null;
  historicalError90Ft: number | null; weatherPairs: number; weatherMaeFt: number | null;
  weatherHistoricalMaeFt: number | null; weatherError90Ft: number | null;
}
export interface HistoricalOutlookValidation {
  eligible: boolean; historicalEligible: boolean; weatherEligible: boolean; leads: HistoricalOutlookLead[];
  evaluation: 'chronological issue-anchored reanalysis hindcast';
  limitations: string[];
}
export interface HistoricalPatternSummary {
  version: 'historical-tide-v1'; reference: Reference; tideReference: Reference;
  trainedUntil: string; trainingStart: string; testStart: string; testEnd: string;
  trainingPairs: number; validationHours: number; coverage: 'training-season-only';
  pattern: { interceptFt: number; tideLevelCoefficient: number; tideSlopeCoefficientHours: number };
  anomalyDecayHours: number; transitionHours: number;
  errorByLead: { leadHours: number; absoluteError90Ft: number }[];
  maxHistoricalErrorFt: number; validationLeads: HistoricalOutlookLead[]; weatherEligible: boolean;
  historicalEligible: boolean; selectedFallback: 'historical-baseline';
}
export interface HistoricalOutlookModel {
  version: 'historical-weather-v1'; reference: Reference; tideReference: Reference;
  trainedUntil: string; trainingStart: string; testStart: string; testEnd: string;
  historical: Regression; weather: Regression | null; trainingPairs: number;
  anomalyDecayHours: number; transitionHours: number; maxHistoricalErrorFt: number;
  validation: HistoricalOutlookValidation;
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const record = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v));
const validDate = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && /Z$/.test(v);
const validReference = (v: unknown): v is Reference => record(v) && typeof v.station === 'string' && v.station.length > 0 && v.station === v.station.trim() && v.units === 'ft' && typeof v.datum === 'string' && /^(MLLW|NAVD88|MSL|MLW|MHW|MHHW|MTL|STND)$/.test(v.datum);
const matching = (a: Reference, b: Reference) => validReference(a) && validReference(b) && a.station === b.station && a.units === b.units && a.datum === b.datum;
const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
const percentile90 = (values: number[]) => values.length ? [...values].sort((a, b) => a - b)[Math.floor(.9 * (values.length - 1))] : null;
function sortWater(points: (WaterPoint & { estimated?: boolean })[]) { return [...new Map(points.filter(p => !p.estimated && finite(+p.t) && finite(p.v)).map(p => [+p.t, p])).values()].sort((a, b) => +a.t - +b.t); }
function sortWeather(points: WeatherPoint[]) { return [...new Map(points.filter(p => finite(+p.t)).map(p => [+p.t, p])).values()].sort((a, b) => +a.t - +b.t); }
function indexBefore<T extends { t: Date }>(rows: T[], at: Date) { let lo = 0, hi = rows.length; while (lo < hi) { const m = (lo + hi) >>> 1; if (+rows[m].t <= +at) lo = m + 1; else hi = m; } return lo - 1; }
function tideFeatures(tide: WaterPoint[], at: Date) {
  const now = interpolate(tide, at), earlier = interpolate(tide, new Date(+at - HOUR));
  return now === null || earlier === null ? null : [now, now - earlier];
}
function weatherFeatures(tide: WaterPoint[], weather: WeatherPoint[], at: Date) {
  const tidal = tideFeatures(tide, at), last = indexBefore(weather, at);
  if (!tidal || last < 23 || +at - +weather[last].t >= HOUR) return null;
  const rows = weather.slice(last - 23, last + 1);
  if (rows.some((w, i) => !finite(w.windSpeed) || w.windSpeed < 0 || !finite(w.windDirection) || w.windDirection < 0 || w.windDirection > 360 || !finite(w.precip) || w.precip < 0 || (i > 0 && +w.t - +rows[i - 1].t !== HOUR))) return null;
  const north = (w: WeatherPoint) => w.windSpeed! * Math.cos(w.windDirection! * Math.PI / 180);
  const east = (w: WeatherPoint) => w.windSpeed! * Math.sin(w.windDirection! * Math.PI / 180);
  const pressure = rows.at(-1)!.pressure, olderPressure = rows[17].pressure;
  if (!finite(pressure) || pressure <= 0 || !finite(olderPressure) || olderPressure <= 0) return null;
  return [...tidal, mean(rows.slice(-6).map(north)), mean(rows.slice(-6).map(east)), mean(rows.map(north)), mean(rows.map(east)), pressure, pressure - olderPressure, rows.slice(-6).reduce((s, w) => s + w.precip!, 0), rows.reduce((s, w) => s + w.precip!, 0)];
}
function fit(rows: { x: number[]; y: number }[]): Regression | null {
  if (rows.length < 120) return null;
  const size = rows[0].x.length, means = Array.from({ length: size }, (_, i) => mean(rows.map(r => r.x[i])));
  const scales = means.map((m, i) => Math.sqrt(mean(rows.map(r => (r.x[i] - m) ** 2))) || 1);
  const intercept = mean(rows.map(r => r.y));
  const matrix = Array.from({ length: size }, () => Array(size + 1).fill(0) as number[]);
  for (const row of rows) { const z = row.x.map((v, i) => (v - means[i]) / scales[i]); for (let i = 0; i < size; i++) { for (let j = 0; j < size; j++) matrix[i][j] += z[i] * z[j]; matrix[i][size] += z[i] * (row.y - intercept); } }
  for (let i = 0; i < size; i++) matrix[i][i] += 20;
  for (let i = 0; i < size; i++) {
    let pivot = i; for (let j = i + 1; j < size; j++) if (Math.abs(matrix[j][i]) > Math.abs(matrix[pivot][i])) pivot = j;
    [matrix[i], matrix[pivot]] = [matrix[pivot], matrix[i]];
    const denominator = matrix[i][i]; if (!finite(denominator) || Math.abs(denominator) < 1e-9) return null;
    for (let j = i; j <= size; j++) matrix[i][j] /= denominator;
    for (let k = 0; k < size; k++) if (k !== i) { const factor = matrix[k][i]; for (let j = i; j <= size; j++) matrix[k][j] -= factor * matrix[i][j]; }
  }
  return { means, scales, intercept, coefficients: matrix.map(r => r[size]), minimums: means.map((_, i) => Math.min(...rows.map(r => r.x[i]))), maximums: means.map((_, i) => Math.max(...rows.map(r => r.x[i]))) };
}
const predict = (model: Regression, x: number[]) => model.intercept + model.coefficients.reduce((sum, c, i) => sum + c * (x[i] - model.means[i]) / model.scales[i], 0);
const inDomain = (model: Regression, x: number[]) => x.every((v, i) => v >= model.minimums[i] - 3 * model.scales[i] && v <= model.maximums[i] + 3 * model.scales[i]);
function validRegression(v: unknown, n: number): v is Regression { return record(v) && finite(v.intercept) && ['means', 'scales', 'coefficients', 'minimums', 'maximums'].every(k => Array.isArray(v[k]) && v[k].length === n && v[k].every(finite)) && (v.scales as number[]).every(x => x > 0) && (v.minimums as number[]).every((x, i) => x <= (v.maximums as number[])[i] && (v.means as number[])[i] >= x && (v.means as number[])[i] <= (v.maximums as number[])[i]); }
function validLead(v: unknown): v is HistoricalOutlookLead {
  return record(v) && finite(v.leadHours) && HISTORICAL_OUTLOOK_LEADS.includes(v.leadHours) && ['testPairs', 'weatherPairs'].every(k => finite(v[k]) && Number.isInteger(v[k]) && v[k] >= 0) && ['historicalMaeFt', 'persistenceMaeFt', 'historicalError90Ft', 'weatherMaeFt', 'weatherHistoricalMaeFt', 'weatherError90Ft'].every(k => v[k] === null || (finite(v[k]) && v[k] >= 0)) && (v.weatherPairs as number) <= (v.testPairs as number) && ['historicalMaeFt', 'persistenceMaeFt', 'historicalError90Ft'].every(k => (v.testPairs === 0) === (v[k] === null)) && ['weatherMaeFt', 'weatherHistoricalMaeFt', 'weatherError90Ft'].every(k => (v.weatherPairs === 0) === (v[k] === null));
}
function sufficientCoverage(leads: HistoricalOutlookLead[]) { return leads.filter(lead => [120, 168, 336].includes(lead.leadHours)).every(lead => lead.testPairs >= 100 && lead.historicalMaeFt !== null); }
function datesInOrder(v: Record<string, unknown>) { return ['trainedUntil', 'trainingStart', 'testStart', 'testEnd'].every(k => validDate(v[k])) && Date.parse(v.trainingStart as string) < Date.parse(v.trainedUntil as string) && Date.parse(v.trainedUntil as string) <= Date.parse(v.testEnd as string) && Date.parse(v.trainingStart as string) < Date.parse(v.testStart as string) && Date.parse(v.testStart as string) <= Date.parse(v.testEnd as string); }
function maximumMeasuredError(leads: HistoricalOutlookLead[]) { return Math.max(0, ...leads.flatMap(lead => [lead.historicalError90Ft, lead.weatherError90Ft]).filter((v): v is number => v !== null)); }
function countsInPeriod(leads: HistoricalOutlookLead[], start: string, end: string) { const hours = (Date.parse(end) - Date.parse(start)) / HOUR; return leads.every(lead => lead.testPairs <= Math.max(0, Math.ceil(hours - lead.leadHours) + 1)); }
export function validateHistoricalOutlookValidation(v: unknown): v is HistoricalOutlookValidation {
  if (!record(v) || typeof v.eligible !== 'boolean' || typeof v.historicalEligible !== 'boolean' || typeof v.weatherEligible !== 'boolean' || v.evaluation !== 'chronological issue-anchored reanalysis hindcast' || !Array.isArray(v.leads) || v.leads.length !== HISTORICAL_OUTLOOK_LEADS.length || !v.leads.every((lead, i) => validLead(lead) && lead.leadHours === HISTORICAL_OUTLOOK_LEADS[i]) || !Array.isArray(v.limitations) || !v.limitations.every(s => typeof s === 'string')) return false;
  const leads = v.leads as HistoricalOutlookLead[];
  return v.eligible === sufficientCoverage(leads) && v.historicalEligible === sufficient(leads, false) && v.weatherEligible === sufficient(leads, true);
}
export function validateHistoricalOutlookModel(v: unknown): v is HistoricalOutlookModel {
  return record(v) && v.version === 'historical-weather-v1' && validReference(v.reference) && validReference(v.tideReference) && matching(v.reference, v.tideReference) && datesInOrder(v) && validRegression(v.historical, 2) && (v.weather === null || validRegression(v.weather, HISTORICAL_WEATHER_FEATURES.length)) && finite(v.trainingPairs) && Number.isInteger(v.trainingPairs) && v.trainingPairs >= 120 && v.anomalyDecayHours === 48 && v.transitionHours === 12 && finite(v.maxHistoricalErrorFt) && v.maxHistoricalErrorFt >= 0 && validateHistoricalOutlookValidation(v.validation) && (!v.validation.weatherEligible || v.weather !== null) && v.maxHistoricalErrorFt === maximumMeasuredError(v.validation.leads) && countsInPeriod(v.validation.leads, v.testStart as string, v.testEnd as string);
}
export function validateHistoricalPatternSummary(v: unknown): v is HistoricalPatternSummary {
  if (!(record(v) && v.version === 'historical-tide-v1' && validReference(v.reference) && validReference(v.tideReference) && matching(v.reference, v.tideReference) && datesInOrder(v) && finite(v.trainingPairs) && Number.isInteger(v.trainingPairs) && v.trainingPairs >= 120 && v.validationHours === 336 && v.coverage === 'training-season-only' && record(v.pattern) && ['interceptFt', 'tideLevelCoefficient', 'tideSlopeCoefficientHours'].every(k => finite((v.pattern as Record<string, unknown>)[k])) && v.anomalyDecayHours === 48 && v.transitionHours === 12 && Array.isArray(v.errorByLead) && v.errorByLead.length === HISTORICAL_OUTLOOK_LEADS.length && v.errorByLead.every((lead, i) => record(lead) && lead.leadHours === HISTORICAL_OUTLOOK_LEADS[i] && finite(lead.absoluteError90Ft) && lead.absoluteError90Ft >= 0) && finite(v.maxHistoricalErrorFt) && v.maxHistoricalErrorFt >= 0 && Array.isArray(v.validationLeads) && v.validationLeads.length === HISTORICAL_OUTLOOK_LEADS.length && v.validationLeads.every((lead, i) => validLead(lead) && lead.leadHours === HISTORICAL_OUTLOOK_LEADS[i]) && typeof v.weatherEligible === 'boolean' && typeof v.historicalEligible === 'boolean' && v.selectedFallback === 'historical-baseline')) return false;
  const leads = v.validationLeads as HistoricalOutlookLead[];
  return sufficientCoverage(leads) && v.historicalEligible === sufficient(leads, false) && v.weatherEligible === sufficient(leads, true) && v.maxHistoricalErrorFt === maximumMeasuredError(leads) && countsInPeriod(leads, v.testStart as string, v.testEnd as string) && (v.errorByLead as { leadHours: number; absoluteError90Ft: number }[]).every((row, i) => row.absoluteError90Ft === Math.max(leads[i].historicalError90Ft ?? (v.maxHistoricalErrorFt as number), leads[i].weatherError90Ft ?? 0));
}
function sufficient(leads: HistoricalOutlookLead[], weather: boolean) {
  const selected = leads.filter(lead => (weather ? [24, 72, 120, 168, 336] : [120, 168, 336]).includes(lead.leadHours));
  return selected.every(lead => (weather ? lead.weatherPairs : lead.testPairs) >= 100 && (weather ? lead.weatherMaeFt : lead.historicalMaeFt) !== null && (weather ? lead.weatherHistoricalMaeFt : lead.persistenceMaeFt) !== null && (weather ? lead.weatherMaeFt! <= lead.weatherHistoricalMaeFt! : lead.historicalMaeFt! <= lead.persistenceMaeFt!)) && mean(selected.map(lead => weather ? lead.weatherMaeFt! : lead.historicalMaeFt!)) <= .95 * mean(selected.map(lead => weather ? lead.weatherHistoricalMaeFt! : lead.persistenceMaeFt!));
}
export function trainHistoricalOutlook(historyInput: (WaterPoint & { estimated?: boolean })[], tideInput: WaterPoint[], weatherInput: WeatherPoint[], reference: Reference, tideReference: Reference, options: { refitValidatedModel?: boolean } = {}): HistoricalOutlookModel | null {
  if (!matching(reference, tideReference)) return null;
  const history = sortWater(historyInput), tide = sortWater(tideInput), weather = sortWeather(weatherInput);
  if (history.length < 500 || +history.at(-1)!.t - +history[0].t < 30 * 24 * HOUR) return null;
  const cutoff = +history[0].t + .7 * (+history.at(-1)!.t - +history[0].t);
  const rows = history.flatMap(p => { const x = tideFeatures(tide, p.t); return x ? [{ t: p.t, x, y: p.v }] : []; });
  const weatherRows = history.flatMap(p => { const x = weatherFeatures(tide, weather, p.t); return x ? [{ t: p.t, x, y: p.v }] : []; });
  const historical = fit(rows.filter(row => +row.t < cutoff)), weatherModel = fit(weatherRows.filter(row => +row.t < cutoff));
  if (!historical) return null;
  const leads = HISTORICAL_OUTLOOK_LEADS.map(leadHours => {
    const historicalErrors: number[] = [], steadyErrors: number[] = [], weatherErrors: number[] = [], weatherHistoricalErrors: number[] = [];
    for (let ms = Math.ceil(cutoff / HOUR) * HOUR; ms + leadHours * HOUR <= +history.at(-1)!.t; ms += HOUR) {
      const issue = new Date(ms), target = new Date(ms + leadHours * HOUR), anchor = history[indexBefore(history, issue)];
      const targetActual = interpolate(history, target, GAP), initialTide = tideFeatures(tide, issue), targetTide = tideFeatures(tide, target);
      if (!anchor || ms - +anchor.t > GAP || targetActual === null || !initialTide || !targetTide) continue;
      const decay = Math.exp(-leadHours / 48);
      const historicalPrediction = predict(historical, targetTide) + (anchor.v - predict(historical, initialTide)) * decay;
      historicalErrors.push(Math.abs(historicalPrediction - targetActual)); steadyErrors.push(Math.abs(anchor.v - targetActual));
      const initialWeather = weatherFeatures(tide, weather, issue), targetWeather = weatherFeatures(tide, weather, target);
      if (!weatherModel || !initialWeather || !targetWeather || !inDomain(weatherModel, initialWeather) || !inDomain(weatherModel, targetWeather)) continue;
      const weatherPrediction = predict(weatherModel, targetWeather) + (anchor.v - predict(weatherModel, initialWeather)) * decay;
      const weatherWeight = 1 - Math.exp(-leadHours / 12);
      weatherErrors.push(Math.abs(historicalPrediction + weatherWeight * (weatherPrediction - historicalPrediction) - targetActual)); weatherHistoricalErrors.push(Math.abs(historicalPrediction - targetActual));
    }
    return { leadHours, testPairs: historicalErrors.length, historicalMaeFt: historicalErrors.length ? mean(historicalErrors) : null, persistenceMaeFt: steadyErrors.length ? mean(steadyErrors) : null, historicalError90Ft: percentile90(historicalErrors), weatherPairs: weatherErrors.length, weatherMaeFt: weatherErrors.length ? mean(weatherErrors) : null, weatherHistoricalMaeFt: weatherHistoricalErrors.length ? mean(weatherHistoricalErrors) : null, weatherError90Ft: percentile90(weatherErrors) };
  });
  const historicalEligible = sufficient(leads, false), weatherEligible = Boolean(weatherModel && sufficient(leads, true));
  // Adequate coverage permits an explicitly historical baseline outlook. It
  // does not relabel a failed accuracy gate as a passed operational forecast.
  const eligible = sufficientCoverage(leads);
  const refit = options.refitValidatedModel !== false && eligible;
  const refittedHistorical = refit ? fit(rows) : historical;
  const refittedWeather = refit && weatherEligible ? fit(weatherRows) : weatherModel;
  const allErrors = leads.flatMap(lead => [lead.historicalError90Ft, lead.weatherError90Ft]).filter((v): v is number => v !== null);
  return { version: 'historical-weather-v1', reference, tideReference, historical: refittedHistorical!, weather: refittedWeather, trainedUntil: new Date(refit ? +history.at(-1)!.t : cutoff - 1).toISOString(), trainingStart: history[0].t.toISOString(), testStart: new Date(cutoff).toISOString(), testEnd: history.at(-1)!.t.toISOString(), trainingPairs: refit ? rows.length : rows.filter(row => +row.t < cutoff).length, anomalyDecayHours: 48, transitionHours: 12, maxHistoricalErrorFt: allErrors.length ? Math.max(...allErrors) : 0, validation: { eligible, historicalEligible, weatherEligible, leads, evaluation: 'chronological issue-anchored reanalysis hindcast', limitations: ['Training covers the observed season only; no annual or winter pattern is inferred.', 'Historical baseline is permitted as context even when its persistence-comparison skill gate fails; the skill flag and measured errors remain explicit.', 'Future weather in evaluation is reanalysis and omits issued-weather forecast errors.', 'Hourly targets overlap and are not independent storms.', 'These point-error gates do not establish peak, event-detection or onset accuracy.', 'The approved near-term prefix is preserved; issue-anchored validation does not independently validate each joined prefix composition.', 'Beyond336h, uncertainty is a conservative extrapolation of historical error rather than a validated probability interval.', 'Missing or out-of-domain weather uses the historical tide/phase pattern, which cannot predict a new unobserved storm.', 'Existing local tide phase and datum calibration remain uncertain.'] } };
}
export function historicalPatternSummary(model: HistoricalOutlookModel): HistoricalPatternSummary {
  const h = model.historical, level = h.coefficients[0] / h.scales[0], slope = h.coefficients[1] / h.scales[1];
  return { version: 'historical-tide-v1', reference: model.reference, tideReference: model.tideReference, trainedUntil: model.trainedUntil, trainingStart: model.trainingStart, testStart: model.testStart, testEnd: model.testEnd, trainingPairs: model.trainingPairs, validationHours: 336, coverage: 'training-season-only', pattern: { interceptFt: h.intercept - level * h.means[0] - slope * h.means[1], tideLevelCoefficient: level, tideSlopeCoefficientHours: slope }, anomalyDecayHours: model.anomalyDecayHours, transitionHours: model.transitionHours, errorByLead: model.validation.leads.map(lead => ({ leadHours: lead.leadHours, absoluteError90Ft: Math.max(lead.historicalError90Ft ?? model.maxHistoricalErrorFt, lead.weatherError90Ft ?? 0) })), maxHistoricalErrorFt: model.maxHistoricalErrorFt, validationLeads: model.validation.leads, weatherEligible: model.validation.weatherEligible, historicalEligible: model.validation.historicalEligible, selectedFallback: 'historical-baseline' };
}
function patternAt(summary: HistoricalPatternSummary, tide: WaterPoint[], at: Date) { const x = tideFeatures(tide, at); return x ? summary.pattern.interceptFt + summary.pattern.tideLevelCoefficient * x[0] + summary.pattern.tideSlopeCoefficientHours * x[1] : null; }
function errorAt(summary: HistoricalPatternSummary, lead: number) {
  const controls = summary.errorByLead.map(row => ({ t: new Date(row.leadHours * HOUR), v: row.absoluteError90Ft }));
  let max = 0; for (const control of controls) { max = Math.max(max, control.v); control.v = max; }
  if (lead <= controls[0].t.getTime() / HOUR) return controls[0].v;
  if (lead <= summary.validationHours) return interpolate(controls, new Date(lead * HOUR), 168 * HOUR) ?? max;
  return Math.max(max, summary.maxHistoricalErrorFt) * Math.sqrt(lead / summary.validationHours);
}
export function projectHistoricalResidual(summary: HistoricalPatternSummary, tideInput: WaterPoint[], times: Date[], prefixInput: WaterPoint[]): { points: WaterPoint[]; errorFt: number[] } {
  if (!validateHistoricalPatternSummary(summary)) return { points: [], errorFt: [] };
  const tide = sortWater(tideInput), prefix = sortWater(prefixInput), last = prefix.at(-1), first = prefix[0];
  if (!last || !first || prefix.length < 2 || prefix.some((p, i) => i > 0 && +p.t - +prefix[i - 1].t > GAP) || Date.parse(summary.trainedUntil) > +first.t) return { points: [], errorFt: [] };
  const initial = patternAt(summary, tide, last.t);
  if (initial === null) return { points: [], errorFt: [] };
  const points: WaterPoint[] = [], errorFt: number[] = [];
  for (const t of [...new Map(times.filter(at => finite(+at) && +at >= +first.t).map(at => [+at, at])).values()].sort((a, b) => +a - +b)) {
    const before = +t <= +last.t ? interpolate(prefix, t, GAP) : null;
    const expected = +t > +last.t ? patternAt(summary, tide, t) : null;
    const v = before ?? (expected === null ? null : expected + (last.v - initial) * Math.exp(-(+t - +last.t) / (summary.anomalyDecayHours * HOUR)));
    if (v === null || !finite(v)) continue;
    points.push({ t, v }); errorFt.push(errorAt(summary, (+t - +first.t) / HOUR));
  }
  return { points, errorFt };
}
export function projectHistoricalOutlook(model: HistoricalOutlookModel | null, historyInput: (WaterPoint & { estimated?: boolean })[], tideInput: WaterPoint[], pastWeatherInput: WeatherPoint[], futureWeatherInput: WeatherPoint[], times: Date[], issue: Date, reference: Reference, tideReference: Reference, options: { prefix: WaterPoint[] }): { points: WaterPoint[]; lower: WaterPoint[]; upper: WaterPoint[]; summary: HistoricalPatternSummary | null; weatherSupportedUntil: Date | null; validation: HistoricalOutlookValidation | null } {
  const empty = { points: [], lower: [], upper: [], summary: null, weatherSupportedUntil: null, validation: null };
  if (!model || !validateHistoricalOutlookModel(model) || !model.validation.eligible || !matching(reference, tideReference) || !matching(model.reference, reference) || !matching(model.tideReference, tideReference) || Date.parse(model.trainedUntil) > +issue) return empty;
  const history = sortWater(historyInput.filter(p => +p.t <= +issue)), anchor = history.at(-1), tide = sortWater(tideInput), prefix = sortWater(options.prefix);
  if (!anchor || +issue - +anchor.t > GAP || !prefix.length) return empty;
  const summary = historicalPatternSummary(model), historical = projectHistoricalResidual(summary, tide, times, prefix);
  if (!historical.points.length) return empty;
  const junction = prefix.at(-1)!.t;
  const past = sortWeather(pastWeatherInput.filter(w => +w.t <= +issue)), future = sortWeather(futureWeatherInput.filter(w => +w.t > +issue));
  const weather = sortWeather([...past, ...future]);
  const initialWeather = weatherFeatures(tide, weather, junction), initialHistorical = patternAt(summary, tide, junction);
  const initialExpected = model.weather && initialWeather && inDomain(model.weather, initialWeather) ? predict(model.weather, initialWeather) : initialHistorical;
  // The prefix may end between hourly weather samples. Anchor its correction
  // at zero so the first weather contribution ramps from the exact junction
  // instead of remaining zero and then jumping at the next whole hour.
  const weatherControls: WaterPoint[] = [{ t: junction, v: 0 }];
  let weatherSupportedUntil: Date | null = null;
  if (model.weather && model.validation.weatherEligible && initialExpected !== null && future.length) {
    const until = +future.at(-1)!.t;
    // Explicit hourly correction controls include missing forecast hours as
    // zero WEATHER contribution, not zero rain/wind observations. This joins
    // a missing/OOD period smoothly to the historical baseline without a step.
    for (let ms = Math.floor(+junction / HOUR + 1) * HOUR; ms <= until; ms += HOUR) {
      const at = new Date(ms);
      const x = weatherFeatures(tide, weather, at), historicalAt = patternAt(summary, tide, at);
      let correction = 0;
      if (x && historicalAt !== null && inDomain(model.weather, x)) {
        const elapsed = (ms - +junction) / HOUR, decay = Math.exp(-elapsed / model.anomalyDecayHours);
        const predicted = predict(model.weather, x) + (prefix.at(-1)!.v - initialExpected) * decay;
        const historicalValue = historicalAt + (prefix.at(-1)!.v - initialHistorical!) * decay;
        const fade = Math.min(1, Math.max(0, (until - ms) / (24 * HOUR)));
        correction = (predicted - historicalValue) * (1 - Math.exp(-elapsed / model.transitionHours)) * fade;
        weatherSupportedUntil = at;
      }
      weatherControls.push({ t: at, v: correction });
    }
  }
  const points = historical.points.map(point => ({ t: point.t, v: point.v + (+point.t <= +junction ? 0 : interpolate(weatherControls, point.t, HOUR) ?? 0) }));
  return { points, lower: points.map((point, i) => ({ t: point.t, v: point.v - historical.errorFt[i] })), upper: points.map((point, i) => ({ t: point.t, v: point.v + historical.errorFt[i] })), summary, weatherSupportedUntil, validation: model.validation };
}

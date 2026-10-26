/** Experimental residual-change ridge baseline. Training future weather is
 * reanalysis: this evaluates a weather hindcast, not issued forecast accuracy.
 * WeatherPoint inputs use mph, degrees wind-from, inches and MSL hPa, as
 * normalized by forecast/sources.ts. Water references must be compatible feet.
 */
import { WeatherPoint } from './model';
import { interpolate, Reference, WaterPoint } from './water';
import { HistoricalOutlookModel, trainHistoricalOutlook } from './historicalOutlook';
import { fitRecentTideResponse } from './recentTidePattern';
import { attachDrivers, AttributedWaterPoint, DriverControl, driverVector, emptyContributions, forecastWeatherContext, interpolateContributions, regressionContributions } from './attribution';

const HOUR = 3600_000;
// FIMAN nominal half-hour reports can be a few seconds apart from the grid.
// Preserve actual timestamps; tolerate only 10s jitter, never hourly outages.
export const WEATHER_OBSERVATION_MAX_GAP_MS = 30 * 60_000 + 10_000;
export const WEATHER_RESPONSE_LEADS = [1, 3, 6, 12, 24];
export const SHORT_RANGE_LEADS = [1, 3, 6];
export const LONG_RANGE_LEADS = [12, 24, 48, 72];
export const LONG_RANGE_FEATURES = [
  'issueResidual', 'residualChange3h', 'meanResidual12h', 'meanResidual24h',
  'residualChange24h', 'issueAstronomicalTide', 'targetAstronomicalTide',
  'targetAstronomicalTideChange1h',
];
export const WEATHER_RESPONSE_FEATURES = [
  'issueResidual', 'residualChange3h',
  ...[6, 12, 24].flatMap(h => [`northWind${h}h`, `eastWind${h}h`]),
  ...[6, 12, 24].flatMap(h => [`northWindChange${h}h`, `eastWindChange${h}h`]),
  'pressureChange', 'pressureChange6h',
  'rain6h', 'rain12h', 'rain24h', 'upcomingRain', 'astronomicalTideChange',
];
export interface WeatherResponseOptions { maxObservationGapMs?: number; refitValidatedModel?: boolean }
export interface WeatherProjectionOptions { allowPointValidatedExperimental?: boolean; includeDrivers?: boolean }
export interface ResidualObservation extends WaterPoint { estimated?: boolean }
interface Regression { means: number[]; scales: number[]; coefficients: number[]; intercept: number; minimums?: number[]; maximums?: number[] }
interface TrainingRow { issue: Date; target: Date; x: number[]; y: number; anchor: number }
export interface WeatherLeadValidation {
  leadHours: number; trainingPairs: number; testPairs: number;
  modelMaeFt: number | null; persistenceMaeFt: number | null; improvement: number | null;
  absoluteError90Ft: number | null;
  passes: boolean;
  method?: 'steady-residual' | 'residual-reversion';
  candidateModelMaeFt?: number | null;
}
interface LongRegression { leadHours: number; model: Regression; method?: 'steady-residual' | 'residual-reversion' }
interface PrefixPeakValidation { peakWindows: number; peakMaeFt: number | null; persistencePeakMaeFt: number | null; eligible: boolean }
export interface WeatherResponseModel {
  historicalOutlook?: HistoricalOutlookModel;
  reference: Reference; tideReference: Reference;
  maxObservationGapMs: number; trainedUntil: Date; holdoutStarts: Date;
  testStart: Date; testEnd: Date;
  regressions: { leadHours: number; model: Regression }[];
  validation: {
    leads: WeatherLeadValidation[]; peakWindows: number;
    peakMaeFt: number | null; persistencePeakMaeFt: number | null;
    eligible: boolean; pointEligible: boolean; weatherInput: 'reanalysis hindcast';
  };
  limitations: string[];
  shortRange?: {
    regressions: { leadHours: number; model: Regression }[];
    leads: WeatherLeadValidation[];
    eligible: boolean;
    peakWindows: number;
    peakMaeFt: number | null;
    persistencePeakMaeFt: number | null;
  };
  longRange?: {
    regressions: LongRegression[];
    leads: WeatherLeadValidation[];
    eligible: boolean;
    peakWindows: number;
    peakMaeFt: number | null;
    persistencePeakMaeFt: number | null;
    peakByDay: { day: number; windows: number; modelMaeFt: number | null; persistenceMaeFt: number | null }[];
    prefixValidation?: Record<'residual-response' | 'weather-response', PrefixPeakValidation>;
  };
}
const valid = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const mean = (v: number[]) => v.reduce((s, n) => s + n, 0) / v.length;
const error90 = (values: number[]) => values.length ? [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * .9)] : null;
const validReference = (r: Reference) => Boolean(r && typeof r.station === 'string' && r.station.length && r.station === r.station.trim() && typeof r.datum === 'string' && /^(MLLW|NAVD88|MSL|MLW|MHW|MHHW|MTL|STND)$/.test(r.datum) && r.units === 'ft');
const sameReference = (a: Reference, b: Reference) => validReference(a) && validReference(b) && a.station === b.station && a.datum === b.datum && a.units === b.units;
const measured = (point: ResidualObservation) => point.estimated !== true;
function sorted(points: WaterPoint[]) {
  return [...new Map(points.filter(p => measured(p) && Number.isFinite(+p.t) && valid(p.v)).map(p => [+p.t, p])).values()].sort((a, b) => +a.t - +b.t);
}
function sortedWeather(points: WeatherPoint[]) {
  return [...new Map(points.filter(p => Number.isFinite(+p.t)).map(p => [+p.t, p])).values()].sort((a, b) => +a.t - +b.t);
}
function anchorAt(history: WaterPoint[], issue: Date, maxAge: number) {
  let low = 0, high = history.length;
  while (low < high) { const mid = (low + high) >>> 1; if (+history[mid].t <= +issue) low = mid + 1; else high = mid; }
  const anchor = history[low - 1];
  return anchor && +issue - +anchor.t <= maxAge ? anchor : null;
}
function weatherAt(rows: WeatherPoint[], at: Date) {
  return rows.find(w => +w.t <= +at && +at - +w.t < HOUR);
}
function window(rows: WeatherPoint[], at: Date, hours: number) {
  const values = rows.filter(w => +w.t > +at - hours * HOUR && +w.t <= +at);
  // No missing rain is silently treated as zero; weather inputs must be hourly.
  if (values.length !== hours || values.some((w, i) => i > 0 && +w.t - +values[i - 1].t > HOUR * 1.01)) return null;
  return values;
}
function wind(rows: WeatherPoint[]) {
  if (!rows.every(w => valid(w.windSpeed) && w.windSpeed >= 0 && valid(w.windDirection) && w.windDirection >= 0 && w.windDirection <= 360)) return null;
  return [mean(rows.map(w => w.windSpeed! * Math.cos(w.windDirection! * Math.PI / 180))), mean(rows.map(w => w.windSpeed! * Math.sin(w.windDirection! * Math.PI / 180)))];
}
/** Every residual feature is restricted to timestamps <= issue. Upcoming
 * meteorology comes only from futureWeather, never later historyWeather rows.
 */
function featureVector(
  issue: Date, target: Date, anchor: ResidualObservation, history: ResidualObservation[], tide: WaterPoint[],
  historyWeather: WeatherPoint[], futureWeather: WeatherPoint[], maxObservationGapMs = WEATHER_OBSERVATION_MAX_GAP_MS,
  prepared = false,
): number[] | null {
  if (!Number.isFinite(+issue) || !Number.isFinite(+target) || !measured(anchor) || !Number.isFinite(+anchor.t) || !valid(anchor.v) || !Number.isFinite(maxObservationGapMs) || maxObservationGapMs <= 0 || maxObservationGapMs > WEATHER_OBSERVATION_MAX_GAP_MS || +issue - +anchor.t > maxObservationGapMs) return null;
  const waterBeforeIssue = history.filter(p => +p.t <= +issue);
  const pastWater = prepared ? waterBeforeIssue : sorted(waterBeforeIssue);
  const older = interpolate(pastWater, new Date(+issue - 3 * HOUR), maxObservationGapMs);
  const pastRows = historyWeather.filter(w => +w.t <= +issue);
  const futureRows = futureWeather.filter(w => +w.t > +issue && +w.t <= +target);
  const past = prepared ? pastRows : sortedWeather(pastRows);
  const future = prepared ? futureRows : sortedWeather(futureRows);
  const allWeather = [...past, ...future].sort((a, b) => +a.t - +b.t);
  if (+anchor.t > +issue || older === null || +target <= +issue || +target > +issue + 24 * HOUR) return null;
  const x = [anchor.v, (anchor.v - older) / 3];
  const issueWindows = [6, 12, 24].map(h => window(past, issue, h));
  const targetWindows = [6, 12, 24].map(h => window(allWeather, target, h));
  if (issueWindows.some(w => !w) || targetWindows.some(w => !w)) return null;
  const oldWinds = issueWindows.map(w => wind(w!));
  const newWinds = targetWindows.map(w => wind(w!));
  if (oldWinds.some(w => !w) || newWinds.some(w => !w)) return null;
  oldWinds.forEach(w => x.push(...w!));
  newWinds.forEach((w, i) => x.push(w![0] - oldWinds[i]![0], w![1] - oldWinds[i]![1]));
  const before = weatherAt(past, issue), after = weatherAt(allWeather, target), sixHoursAgo = weatherAt(past, new Date(+issue - 6 * HOUR));
  if (!valid(before?.pressure) || before.pressure <= 0 || !valid(after?.pressure) || after.pressure <= 0 || !valid(sixHoursAgo?.pressure) || sixHoursAgo.pressure <= 0) return null;
  x.push(after.pressure - before.pressure, before.pressure - sixHoursAgo.pressure);
  for (const w of issueWindows) { if (!w!.every(row => valid(row.precip) && row.precip >= 0)) return null; x.push(w!.reduce((s, row) => s + row.precip!, 0)); }
  const upcoming = allWeather.filter(w => +w.t > +issue && +w.t <= +target);
  if (!upcoming.every(w => valid(w.precip) && w.precip >= 0) || upcoming.length !== Math.floor((+target - +issue) / HOUR)) return null;
  x.push(upcoming.reduce((s, w) => s + w.precip!, 0));
  const tidePoints = prepared ? tide : sorted(tide);
  const issueTide = interpolate(tidePoints, issue), targetTide = interpolate(tidePoints, target);
  if (issueTide === null || targetTide === null) return null;
  x.push(targetTide - issueTide);
  return x.every(valid) ? x : null;
}
export function weatherResponseFeatures(
  issue: Date, target: Date, anchor: ResidualObservation, history: ResidualObservation[], tide: WaterPoint[],
  historyWeather: WeatherPoint[], futureWeather: WeatherPoint[], maxObservationGapMs = WEATHER_OBSERVATION_MAX_GAP_MS,
): number[] | null {
  return featureVector(issue, target, anchor, history, tide, historyWeather, futureWeather, maxObservationGapMs);
}
function fit(rows: TrainingRow[], p = WEATHER_RESPONSE_FEATURES.length): Regression | null {
  if (rows.length < 120) return null;
  const means = Array.from({ length: p }, (_, i) => mean(rows.map(r => r.x[i])));
  const scales = means.map((m, i) => Math.sqrt(mean(rows.map(r => (r.x[i] - m) ** 2))) || 1);
  const intercept = mean(rows.map(r => r.y));
  const matrix = Array.from({ length: p }, () => Array(p + 1).fill(0) as number[]);
  for (const row of rows) {
    const z = row.x.map((v, i) => (v - means[i]) / scales[i]);
    for (let i = 0; i < p; i++) { for (let j = 0; j < p; j++) matrix[i][j] += z[i] * z[j]; matrix[i][p] += z[i] * (row.y - intercept); }
  }
  for (let i = 0; i < p; i++) matrix[i][i] += 20;
  for (let i = 0; i < p; i++) {
    let pivot = i;
    for (let j = i + 1; j < p; j++) if (Math.abs(matrix[j][i]) > Math.abs(matrix[pivot][i])) pivot = j;
    [matrix[i], matrix[pivot]] = [matrix[pivot], matrix[i]];
    const denominator = matrix[i][i];
    if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-9) return null;
    for (let j = i; j <= p; j++) matrix[i][j] /= denominator;
    for (let k = 0; k < p; k++) if (k !== i) { const factor = matrix[k][i]; for (let j = i; j <= p; j++) matrix[k][j] -= factor * matrix[i][j]; }
  }
  return { means, scales, intercept, coefficients: matrix.map(r => r[p]), minimums: means.map((_, i) => Math.min(...rows.map(r => r.x[i]))), maximums: means.map((_, i) => Math.max(...rows.map(r => r.x[i]))) };
}
function predict(model: Regression, x: number[]) {
  return model.intercept + model.coefficients.reduce((s, coefficient, i) => s + coefficient * (x[i] - model.means[i]) / model.scales[i], 0);
}
function validRegression(model: Regression, length = WEATHER_RESPONSE_FEATURES.length) {
  return model && valid(model.intercept) && [model.means, model.scales, model.coefficients].every(values => Array.isArray(values) && values.length === length && values.every(valid)) && model.scales.every(scale => scale > 0) && [model.minimums, model.maximums].every(values => values === undefined || (Array.isArray(values) && values.length === length && values.every(valid)));
}
const shortVector = (x: number[]) => x.map((value, i) => i === 0 || i === 1 || i === WEATHER_RESPONSE_FEATURES.length - 1 ? value : 0);
function shortFeatures(issue: Date, target: Date, anchor: WaterPoint, history: WaterPoint[], tide: WaterPoint[], maxGap: number) {
  const older = interpolate(history.filter(p => p.t <= issue), new Date(+issue - 3 * HOUR), maxGap);
  const issueTide = interpolate(tide, issue), targetTide = interpolate(tide, target);
  if (older === null || issueTide === null || targetTide === null) return null;
  const x = Array(WEATHER_RESPONSE_FEATURES.length).fill(0) as number[];
  x[0] = anchor.v; x[1] = (anchor.v - older) / 3; x[x.length - 1] = targetTide - issueTide;
  return x;
}
function withinTrainingDomain(model: Regression, x: number[]) {
  return !model.minimums || !model.maximums || x.every((value, i) => value >= model.minimums![i] - 3 * model.scales[i] && value <= model.maximums![i] + 3 * model.scales[i]);
}
/** Long-range inputs use only genuine measurements available at issue. The
 * repeating tide is a predictor of the local residual relationship, never an
 * extra lunar addition to total water. Missing hourly samples remain missing.
 */
function longFeatures(issue: Date, target: Date, anchor: WaterPoint, history: WaterPoint[], tide: WaterPoint[], maxGap: number) {
  const past = history.filter(point => +point.t <= +issue);
  const hourly = [anchor.v, ...Array.from({ length: 23 }, (_, i) => interpolate(past, new Date(+issue - (i + 1) * HOUR), maxGap))];
  const older3 = interpolate(past, new Date(+issue - 3 * HOUR), maxGap);
  const older24 = interpolate(past, new Date(+issue - 24 * HOUR), maxGap);
  const issueTide = interpolate(tide, issue), targetTide = interpolate(tide, target);
  const beforeTargetTide = interpolate(tide, new Date(+target - HOUR / 2));
  const afterTargetTide = interpolate(tide, new Date(+target + HOUR / 2));
  if (hourly.some(v => v === null) || older3 === null || older24 === null || issueTide === null || targetTide === null || beforeTargetTide === null || afterTargetTide === null) return null;
  const x = [anchor.v, (anchor.v - older3) / 3, mean(hourly.slice(0, 12) as number[]), mean(hourly as number[]), anchor.v - older24, issueTide, targetTide, afterTargetTide - beforeTargetTide];
  return x.every(valid) ? x : null;
}
function longProjection(models: LongRegression[], history: WaterPoint[], tide: WaterPoint[], times: Date[], issue: Date, maxGap: number, prefix: WaterPoint[]) {
  const anchor = anchorAt(history, issue, maxGap);
  if (!anchor) return [];
  const issueFeatures = longFeatures(issue, new Date(+issue + 12 * HOUR), anchor, history, tide, maxGap)?.slice(0, 6);
  if (!issueFeatures) return [];
  const pastPrefix = sorted(prefix).filter(p => +p.t >= +issue && +p.t <= +issue + 24 * HOUR);
  // A learned long-range tail is joined to an already supported prefix. It
  // cannot replace or silently shift any of that prefix's physical values.
  if (!pastPrefix.length || +pastPrefix[0].t > +issue + HOUR || pastPrefix.some((point, i) => i > 0 && +point.t - +pastPrefix[i - 1].t > WEATHER_OBSERVATION_MAX_GAP_MS)) return [];
  const controls: WaterPoint[] = sorted([{ t: issue, v: anchor.v }, ...pastPrefix]);
  const junction = +pastPrefix.at(-1)!.t;
  // The supplied six-minute prefix may finish seconds before its nominal 6/24 h
  // horizon. Avoid an abrupt extra baseline control in those final grid seconds.
  const longModels = models.filter(item => item.leadHours > Math.ceil((junction - +issue) / HOUR));
  if (!longModels.length) return [];
  const output: WaterPoint[] = [];
  for (const t of [...new Map(times.filter(at => Number.isFinite(+at) && +at >= +issue && +at <= +issue + 72 * HOUR).map(at => [+at, at])).values()].sort((a, b) => +a - +b)) {
    if (+t <= junction) {
      const v = interpolate(controls, t, HOUR);
      if (v === null) return [];
      output.push({ t, v });
      continue;
    }
    const astronomical = interpolate(tide, t), beforeTide = interpolate(tide, new Date(+t - HOUR / 2)), afterTide = interpolate(tide, new Date(+t + HOUR / 2));
    if (astronomical === null || beforeTide === null || afterTide === null) return [];
    const x = [...issueFeatures, astronomical, afterTide - beforeTide];
    const nextIndex = longModels.findIndex(item => +issue + item.leadHours * HOUR >= +t);
    if (nextIndex < 0) return [];
    const next = longModels[nextIndex];
    if (next.method !== 'steady-residual' && !withinTrainingDomain(next.model, x)) return [];
    const nextValue = next.method === 'steady-residual' ? anchor.v : anchor.v + predict(next.model, x);
    const before = longModels[nextIndex - 1];
    const beforeTime = before ? +issue + before.leadHours * HOUR : junction;
    if (before && before.method !== 'steady-residual' && !withinTrainingDomain(before.model, x)) return [];
    const beforeValue = before ? before.method === 'steady-residual' ? anchor.v : anchor.v + predict(before.model, x) : pastPrefix.at(-1)!.v;
    const fraction = (+t - beforeTime) / (+issue + next.leadHours * HOUR - beforeTime);
    const v = beforeValue + fraction * (nextValue - beforeValue);
    if (!Number.isFinite(v)) return [];
    output.push({ t, v });
  }
  return output;
}
interface TideShapeControl extends WaterPoint { tideChange: number; tideCoefficient: number; tideMinimum: number; tideMaximum: number }
function tideControl(model: Regression, tideChange: number, recentCoefficient: number) {
  const index = WEATHER_RESPONSE_FEATURES.length - 1;
  const bounded = model.minimums !== undefined && model.maximums !== undefined;
  const learned = model.coefficients[index] / model.scales[index];
  // The historical model can lag a changing local residual cycle. Introduce
  // curvature only where the recent measured level response supports its sign,
  // and cap that correction by both fitted magnitudes. This never replaces the
  // original control levels or extrapolates the recent fit's historical drift.
  const tideCoefficient = learned * recentCoefficient > 0
    ? Math.sign(learned) * Math.min(Math.abs(learned), Math.abs(recentCoefficient)) : 0;
  return {
    tideChange, tideCoefficient,
    tideMinimum: bounded ? model.minimums![index] - 3 * model.scales[index] : -Infinity,
    tideMaximum: bounded ? model.maximums![index] + 3 * model.scales[index] : Infinity,
  };
}
/** Keep each learned lead prediction exact while retaining its target-tide
 * term between leads. Interpolating the complete residual from 12h to 24h
 * otherwise removes almost a whole semidiurnal peak/valley. No new tide or
 * weather effect is added: this evaluates the already fitted tide term at
 * the requested timestamp instead of interpolating that term's endpoints.
 * A lead model's feature can have a narrow range (especially near a full
 * tidal cycle), so each term stays inside that model's existing domain.
 */
function tideShapeCorrection(controls: TideShapeControl[], tide: WaterPoint[], issueTide: number, at: Date, maxGap: number): number | null {
  const exact = controls.find(control => +control.t === +at);
  if (exact) return 0;
  const next = controls.findIndex(control => +control.t > +at);
  if (next <= 0) return null;
  const before = controls[next - 1], after = controls[next];
  if (+after.t - +before.t > maxGap) return null;
  const astronomical = interpolate(tide, at);
  if (astronomical === null) return null;
  const fraction = (+at - +before.t) / (+after.t - +before.t);
  const change = astronomical - issueTide;
  const boundedTerm = (control: TideShapeControl) => control.tideCoefficient * Math.max(control.tideMinimum, Math.min(control.tideMaximum, change));
  const beforeBounded = boundedTerm(before), afterBounded = boundedTerm(after);
  const beforeTerm = before.tideCoefficient * before.tideChange, afterTerm = after.tideCoefficient * after.tideChange;
  return beforeBounded + fraction * (afterBounded - beforeBounded) - (beforeTerm + fraction * (afterTerm - beforeTerm));
}
function tideAwareProjection(controls: TideShapeControl[], tide: WaterPoint[], times: Date[], issue: Date, horizonHours: number, maxGap: number) {
  const issueTide = interpolate(tide, issue);
  if (issueTide === null) return [];
  return [...new Map(times.filter(t => Number.isFinite(+t) && +t >= +issue && +t <= +issue + horizonHours * HOUR).map(t => [+t, t])).values()].sort((a, b) => +a - +b).flatMap(t => {
    const linear = interpolate(controls, t, maxGap), correction = tideShapeCorrection(controls, tide, issueTide, t, maxGap);
    if (linear === null || correction === null) return [];
    const v = linear + correction;
    return Number.isFinite(v) ? [{ t, v }] : [];
  });
}
function shortProjection(models: { leadHours: number; model: Regression }[], history: WaterPoint[], tide: WaterPoint[], times: Date[], issue: Date, maxGap: number) {
  const anchor = anchorAt(history, issue, maxGap);
  if (!anchor) return [];
  const tideIndex = WEATHER_RESPONSE_FEATURES.length - 1;
  const recentCoefficient = fitRecentTideResponse(history, tide, issue)?.tideLevelCoefficient ?? 0;
  const controls: TideShapeControl[] = [{ t: issue, v: anchor.v, ...tideControl(models[0].model, 0, recentCoefficient) }];
  for (const item of models) {
    const target = new Date(+issue + item.leadHours * HOUR);
    const x = shortFeatures(issue, target, anchor, history, tide, maxGap);
    if (!x || !withinTrainingDomain(item.model, x)) return [];
    controls.push({ t: target, v: anchor.v + predict(item.model, x), ...tideControl(item.model, x[tideIndex], recentCoefficient) });
  }
  return tideAwareProjection(controls, tide, times, issue, 6, 3 * HOUR);
}
function projection(
  models: { leadHours: number; model: Regression }[], history: WaterPoint[], tide: WaterPoint[],
  historyWeather: WeatherPoint[], futureWeather: WeatherPoint[], times: Date[], issue: Date, maxGap: number,
) {
  const anchor = anchorAt(history, issue, maxGap);
  if (!anchor) return [];
  const tideIndex = WEATHER_RESPONSE_FEATURES.length - 1;
  const recentCoefficient = fitRecentTideResponse(history, tide, issue)?.tideLevelCoefficient ?? 0;
  const controls: TideShapeControl[] = [{ t: issue, v: anchor.v, ...tideControl(models[0].model, 0, recentCoefficient) }];
  for (const item of models) {
    const target = new Date(+issue + item.leadHours * HOUR);
    const x = featureVector(issue, target, anchor, history, tide, historyWeather, futureWeather, maxGap, true);
    if (!x || !withinTrainingDomain(item.model, x)) return [];
    controls.push({ t: target, v: anchor.v + predict(item.model, x), ...tideControl(item.model, x[tideIndex], recentCoefficient) });
  }
  return tideAwareProjection(controls, tide, times, issue, 24, 12 * HOUR);
}
/** Purged chronological 70/30 split: a training target cannot enter holdout.
 * Ridge coefficients are never selected by testing alternative penalties.
 */
export function trainWeatherResponse(
  historyInput: ResidualObservation[], tideInput: WaterPoint[], weatherInput: WeatherPoint[],
  reference: Reference, tideReference: Reference, options: WeatherResponseOptions = {},
): WeatherResponseModel | null {
  if (!sameReference(reference, tideReference)) return null;
  const history = sorted(historyInput), tide = sorted(tideInput);
  const weather = sortedWeather(weatherInput);
  const maxGap = options.maxObservationGapMs ?? WEATHER_OBSERVATION_MAX_GAP_MS;
  if (history.length < 500 || !Number.isFinite(maxGap) || maxGap <= 0 || maxGap > WEATHER_OBSERVATION_MAX_GAP_MS || +history.at(-1)!.t - +history[0].t < 30 * 24 * HOUR) return null;
  const cutoff = new Date(+history[0].t + .7 * (+history.at(-1)!.t - +history[0].t));
  const rows = new Map<number, TrainingRow[]>();
  for (const leadHours of WEATHER_RESPONSE_LEADS) {
    const values: TrainingRow[] = [];
    for (let ms = Math.ceil((+history[0].t + 24 * HOUR) / HOUR) * HOUR; ms + leadHours * HOUR <= +history.at(-1)!.t; ms += HOUR) {
      const issue = new Date(ms), target = new Date(ms + leadHours * HOUR);
      const anchor = anchorAt(history, issue, maxGap), actual = interpolate(history, target, maxGap);
      if (!anchor || actual === null) continue;
      const x = featureVector(issue, target, anchor, history, tide, weather, weather, maxGap, true);
      if (x) values.push({ issue, target, x, y: actual - anchor.v, anchor: anchor.v });
    }
    rows.set(leadHours, values);
  }
  const models: { leadHours: number; model: Regression }[] = [];
  const leads: WeatherLeadValidation[] = [];
  for (const leadHours of WEATHER_RESPONSE_LEADS) {
    const values = rows.get(leadHours)!;
    const train = values.filter(r => +r.target < +cutoff), test = values.filter(r => +r.issue >= +cutoff);
    const model = fit(train);
    const errors = model ? test.map(r => Math.abs(predict(model, r.x) - r.y)) : [];
    const modelMaeFt = errors.length ? mean(errors) : null;
    const persistenceMaeFt = test.length ? mean(test.map(r => Math.abs(r.y))) : null;
    const improvement = modelMaeFt !== null && persistenceMaeFt !== null && persistenceMaeFt > 0 ? 1 - modelMaeFt / persistenceMaeFt : null;
    leads.push({ leadHours, trainingPairs: train.length, testPairs: test.length, modelMaeFt, persistenceMaeFt, improvement, absoluteError90Ft: error90(errors), passes: test.length >= 100 && improvement !== null && improvement >= .05 });
    if (model) models.push({ leadHours, model });
  }
  const peakErrors: number[] = [], persistencePeakErrors: number[] = [];
  // Reconstruct actual total at native measurement times first, so interpolated
  // tide curvature cannot manufacture additional observed peaks between readings.
  const observedTotals = history.flatMap(p => {
    const astronomical = interpolate(tide, p.t);
    return astronomical === null ? [] : [{ t: p.t, v: p.v + astronomical }];
  });
  if (models.length === WEATHER_RESPONSE_LEADS.length) {
    for (let ms = Math.ceil(+cutoff / (24 * HOUR)) * 24 * HOUR; ms + 24 * HOUR <= +history.at(-1)!.t; ms += 24 * HOUR) {
      const issue = new Date(ms), anchor = anchorAt(history, issue, maxGap);
      if (!anchor) continue;
      const end = ms + 24 * HOUR;
      const times = [...new Set([
        ...Array.from({ length: 241 }, (_, i) => ms + i * 6 * 60_000),
        ...observedTotals.filter(p => +p.t >= ms && +p.t <= end).map(p => +p.t),
      ])].sort((a, b) => a - b).map(t => new Date(t));
      const forecast = projection(models, history, tide, weather, weather, times, issue, maxGap);
      const actual = times.map(t => interpolate(observedTotals, t, maxGap));
      const tides = times.map(t => interpolate(tide, t));
      if (forecast.length !== times.length || actual.some(v => v === null) || tides.some(v => v === null)) continue;
      const actualPeak = Math.max(...actual.map(v => v!));
      peakErrors.push(Math.abs(Math.max(...forecast.map((p, i) => p.v + tides[i]!)) - actualPeak));
      persistencePeakErrors.push(Math.abs(Math.max(...tides.map(v => v! + anchor.v)) - actualPeak));
    }
  }
  const peakMaeFt = peakErrors.length ? mean(peakErrors) : null;
  const persistencePeakMaeFt = persistencePeakErrors.length ? mean(persistencePeakErrors) : null;
  const pointEligible = leads.every(l => l.passes) && !(peakMaeFt !== null && persistencePeakMaeFt !== null && peakMaeFt > persistencePeakMaeFt);
  const eligible = pointEligible && peakErrors.length >= 7 && peakMaeFt !== null && persistencePeakMaeFt !== null;
  // Refit the unchanged algorithm on all available history only after validation.
  const refit = pointEligible && options.refitValidatedModel !== false;
  const regressions = refit ? WEATHER_RESPONSE_LEADS.flatMap(leadHours => { const model = fit(rows.get(leadHours)!); return model ? [{ leadHours, model }] : []; }) : models;
  // Predeclared short-range alternative: same historical pairs and fixed ridge
  // penalty, using measured residual, its recent change and tide change only.
  // It is screened separately; unsupported weather is never clipped to fit.
  const shortModels: { leadHours: number; model: Regression }[] = [];
  const shortLeads = SHORT_RANGE_LEADS.map(leadHours => {
    const values = rows.get(leadHours)!.map(row => ({ ...row, x: shortVector(row.x) }));
    const train = values.filter(row => +row.target < +cutoff), test = values.filter(row => +row.issue >= +cutoff);
    const fitted = fit(train);
    if (fitted) shortModels.push({ leadHours, model: fitted });
    const errors = fitted ? test.map(row => Math.abs(predict(fitted, row.x) - row.y)) : [];
    const modelMaeFt = errors.length ? mean(errors) : null;
    const persistenceMaeFt = test.length ? mean(test.map(row => Math.abs(row.y))) : null;
    const improvement = modelMaeFt !== null && persistenceMaeFt !== null && persistenceMaeFt > 0 ? 1 - modelMaeFt / persistenceMaeFt : null;
    return { leadHours, trainingPairs: train.length, testPairs: test.length, modelMaeFt, persistenceMaeFt, improvement, absoluteError90Ft: error90(errors), passes: test.length >= 100 && improvement !== null && improvement >= .05 };
  });
  const shortPeakErrors: number[] = [], shortSteadyPeakErrors: number[] = [];
  if (shortModels.length === SHORT_RANGE_LEADS.length) {
    for (let ms = Math.ceil(+cutoff / (6 * HOUR)) * 6 * HOUR; ms + 6 * HOUR <= +history.at(-1)!.t; ms += 6 * HOUR) {
      const issue = new Date(ms), anchor = anchorAt(history, issue, maxGap);
      if (!anchor) continue;
      const times = [...new Set([
        ...Array.from({ length: 61 }, (_, i) => ms + i * 6 * 60_000),
        ...observedTotals.filter(p => +p.t >= ms && +p.t <= ms + 6 * HOUR).map(p => +p.t),
      ])].sort((a, b) => a - b).map(t => new Date(t));
      const forecast = shortProjection(shortModels, history, tide, times, issue, maxGap);
      const actual = times.map(t => interpolate(observedTotals, t, maxGap)), tides = times.map(t => interpolate(tide, t));
      if (forecast.length !== times.length || actual.some(v => v === null) || tides.some(v => v === null)) continue;
      const actualPeak = Math.max(...actual.map(v => v!));
      shortPeakErrors.push(Math.abs(Math.max(...forecast.map((p, i) => p.v + tides[i]!)) - actualPeak));
      shortSteadyPeakErrors.push(Math.abs(Math.max(...tides.map(v => v! + anchor.v)) - actualPeak));
    }
  }
  const shortPeakMae = shortPeakErrors.length ? mean(shortPeakErrors) : null, shortSteadyPeakMae = shortSteadyPeakErrors.length ? mean(shortSteadyPeakErrors) : null;
  const shortEligible = shortLeads.every(lead => lead.passes) && shortPeakErrors.length >= 7 && shortPeakMae !== null && shortSteadyPeakMae !== null && shortPeakMae <= shortSteadyPeakMae;
  const shortRegressions = refit && shortEligible ? SHORT_RANGE_LEADS.flatMap(leadHours => {
    const fitted = fit(rows.get(leadHours)!.map(row => ({ ...row, x: shortVector(row.x) })));
    return fitted ? [{ leadHours, model: fitted }] : [];
  }) : shortModels;
  // Fixed, separately screened multi-day candidate. Unlike extending a recent
  // slope, each lead learns the measured residual's persistence/mean reversion
  // and local tide relationship. Unknown future weather is not used here.
  const longRows = new Map<number, TrainingRow[]>();
  const longIssueFeatures = new Map<number, number[] | null>();
  const longModels: LongRegression[] = [];
  const longLeads = LONG_RANGE_LEADS.map(leadHours => {
    const values: TrainingRow[] = [];
    for (let ms = Math.ceil((+history[0].t + 24 * HOUR) / HOUR) * HOUR; ms + leadHours * HOUR <= +history.at(-1)!.t; ms += HOUR) {
      const issue = new Date(ms), target = new Date(ms + leadHours * HOUR);
      const anchor = anchorAt(history, issue, maxGap), actual = interpolate(history, target, maxGap);
      if (!anchor || actual === null) continue;
      if (!longIssueFeatures.has(ms)) longIssueFeatures.set(ms, longFeatures(issue, new Date(ms + 12 * HOUR), anchor, history, tide, maxGap)?.slice(0, 6) ?? null);
      const base = longIssueFeatures.get(ms);
      const targetTide = interpolate(tide, target), beforeTide = interpolate(tide, new Date(+target - HOUR / 2)), afterTide = interpolate(tide, new Date(+target + HOUR / 2));
      const x = base && targetTide !== null && beforeTide !== null && afterTide !== null ? [...base, targetTide, afterTide - beforeTide] : null;
      if (x) values.push({ issue, target, x, y: actual - anchor.v, anchor: anchor.v });
    }
    longRows.set(leadHours, values);
    const train = values.filter(row => +row.target < +cutoff), test = values.filter(row => +row.issue >= +cutoff);
    const fitted = fit(train, LONG_RANGE_FEATURES.length);
    const baseline = leadHours === 12 || leadHours === 24;
    if (fitted) longModels.push({ leadHours, method: baseline ? 'steady-residual' : 'residual-reversion', model: baseline ? { ...fitted, intercept: 0, coefficients: fitted.coefficients.map(() => 0) } : fitted });
    const errors = fitted ? test.map(row => Math.abs(predict(fitted, row.x) - row.y)) : [];
    const candidateModelMaeFt = errors.length ? mean(errors) : null;
    const persistenceMaeFt = test.length ? mean(test.map(row => Math.abs(row.y))) : null;
    const modelMaeFt = baseline ? persistenceMaeFt : candidateModelMaeFt;
    const improvement = modelMaeFt !== null && persistenceMaeFt !== null && persistenceMaeFt > 0 ? 1 - modelMaeFt / persistenceMaeFt : null;
    return { leadHours, method: baseline ? 'steady-residual' as const : 'residual-reversion' as const, trainingPairs: train.length, testPairs: test.length, modelMaeFt, persistenceMaeFt, improvement, absoluteError90Ft: error90(baseline ? test.map(row => Math.abs(row.y)) : errors), passes: !baseline && test.length >= 100 && improvement !== null && improvement >= .05, candidateModelMaeFt };
  });
  const longPeakByPrefix = {
    'residual-response': [1, 2, 3].map(day => ({ day, errors: [] as number[], persistenceErrors: [] as number[] })),
    'weather-response': [1, 2, 3].map(day => ({ day, errors: [] as number[], persistenceErrors: [] as number[] })),
  };
  if (longModels.length === LONG_RANGE_LEADS.length && shortModels.length === SHORT_RANGE_LEADS.length) {
    for (let ms = Math.ceil(+cutoff / (24 * HOUR)) * 24 * HOUR; ms + 72 * HOUR <= +history.at(-1)!.t; ms += 24 * HOUR) {
      const anchor = anchorAt(history, new Date(ms), maxGap);
      if (!anchor) continue;
      const issue = anchor.t;
      const prefixTimes = (hours: number) => [issue, ...tide.filter(point => +point.t > +issue && +point.t <= +issue + hours * HOUR).map(point => point.t)];
      const prefixes = {
        'residual-response': shortProjection(shortModels, history, tide, prefixTimes(6), issue, maxGap),
        'weather-response': projection(models, history, tide, weather, weather, prefixTimes(24), issue, maxGap),
      };
      for (const dayNumber of [1, 2, 3]) {
        const start = +issue + (dayNumber - 1) * 24 * HOUR, end = start + 24 * HOUR;
        const times = [...new Set([
          ...Array.from({ length: 241 }, (_, i) => start + i * 6 * 60_000),
          ...observedTotals.filter(p => +p.t >= start && +p.t <= end).map(p => +p.t),
        ])].sort((a, b) => a - b).map(t => new Date(t));
        const actual = times.map(t => interpolate(observedTotals, t, maxGap)), tides = times.map(t => interpolate(tide, t));
        if (actual.some(v => v === null) || tides.some(v => v === null)) continue;
        const actualPeak = Math.max(...actual.map(v => v!));
        for (const method of ['residual-response', 'weather-response'] as const) {
          const forecast = longProjection(longModels, history, tide, times, issue, maxGap, prefixes[method]);
          if (forecast.length !== times.length) continue;
          const day = longPeakByPrefix[method][dayNumber - 1];
          day.errors.push(Math.abs(Math.max(...forecast.map((p, i) => p.v + tides[i]!)) - actualPeak));
          day.persistenceErrors.push(Math.abs(Math.max(...tides.map(v => v! + anchor.v)) - actualPeak));
        }
      }
    }
  }
  const longLearnedEligible = longLeads.filter(lead => lead.method === 'residual-reversion').every(lead => lead.passes);
  const summarizePrefix = (method: 'residual-response' | 'weather-response'): PrefixPeakValidation => {
    const errors = longPeakByPrefix[method].flatMap(day => day.errors), baselineErrors = longPeakByPrefix[method].flatMap(day => day.persistenceErrors);
    const peakMaeFt = errors.length ? mean(errors) : null, persistencePeakMaeFt = baselineErrors.length ? mean(baselineErrors) : null;
    return { peakWindows: errors.length, peakMaeFt, persistencePeakMaeFt, eligible: longLearnedEligible && (method === 'residual-response' ? shortEligible : eligible) && errors.length >= 7 && peakMaeFt !== null && persistencePeakMaeFt !== null && peakMaeFt <= persistencePeakMaeFt };
  };
  const prefixValidation = { 'residual-response': summarizePrefix('residual-response'), 'weather-response': summarizePrefix('weather-response') };
  const longEligible = Object.values(prefixValidation).some(result => result.eligible);
  const selectedPrefix = prefixValidation['residual-response'].eligible ? 'residual-response' : 'weather-response';
  const longPeakByDay = longPeakByPrefix[selectedPrefix];
  const selectedPeaks = prefixValidation[selectedPrefix];
  const longRefit = longEligible && options.refitValidatedModel !== false;
  const longRegressions = longRefit ? LONG_RANGE_LEADS.flatMap(leadHours => {
    const fitted = fit(longRows.get(leadHours)!, LONG_RANGE_FEATURES.length);
    const baseline = leadHours === 12 || leadHours === 24;
    return fitted ? [{ leadHours, method: baseline ? 'steady-residual' as const : 'residual-reversion' as const, model: baseline ? { ...fitted, intercept: 0, coefficients: fitted.coefficients.map(() => 0) } : fitted }] : [];
  }) : longModels;
  return {
    historicalOutlook: trainHistoricalOutlook(history, tide, weather, reference, tideReference, options) ?? undefined,
    reference, tideReference, maxObservationGapMs: maxGap, trainedUntil: refit || longRefit ? history.at(-1)!.t : new Date(+cutoff - 1), holdoutStarts: cutoff,
    testStart: cutoff, testEnd: history.at(-1)!.t,
    regressions, validation: { leads, peakWindows: peakErrors.length, peakMaeFt, persistencePeakMaeFt, eligible, pointEligible, weatherInput: 'reanalysis hindcast' },
    shortRange: { regressions: shortRegressions, leads: shortLeads, eligible: shortEligible, peakWindows: shortPeakErrors.length, peakMaeFt: shortPeakMae, persistencePeakMaeFt: shortSteadyPeakMae },
    longRange: { regressions: longRegressions, leads: longLeads, ...selectedPeaks, eligible: longEligible, peakByDay: longPeakByDay.map(day => ({ day: day.day, windows: day.errors.length, modelMaeFt: day.errors.length ? mean(day.errors) : null, persistenceMaeFt: day.persistenceErrors.length ? mean(day.persistenceErrors) : null })), prefixValidation },
    limitations: ['Reanalysis future weather omits issued weather forecast error.', 'Overlapping hourly issue windows are descriptive, not independent confidence trials.', 'Nominal 30-minute observation gaps allow 10 seconds of timestamp jitter; longer outages remain unavailable.', 'Peak errors use complete 24-hour windows, all native measured totals and a six-minute grid; no filtering of measured spikes.', 'Regional tide phase and datum assumptions remain uncalibrated.', 'This screening gate does not establish operational accuracy or calibrated confidence.'],
  };
}
const WEATHER_GROUPS = WEATHER_RESPONSE_FEATURES.map(name => name === 'issueResidual' ? 2 : name === 'residualChange3h' ? 1 : name.includes('Wind') ? 4 : name.startsWith('pressure') ? 5 : name.toLowerCase().includes('rain') ? 6 : 3);
const LONG_GROUPS = LONG_RANGE_FEATURES.map(name => name === 'residualChange3h' ? 1 : name.includes('Tide') ? 3 : 2);
function projectionDrivers(points: WaterPoint[], models: { leadHours: number; model: Regression }[], history: WaterPoint[], tide: WaterPoint[], issue: Date, maxGap: number, weather?: { past: WeatherPoint[]; future: WeatherPoint[] }): AttributedWaterPoint[] {
  const anchor = anchorAt(history, issue, maxGap);
  if (!anchor || !points.length) return points;
  const issueTide = interpolate(tide, issue), tideIndex = WEATHER_RESPONSE_FEATURES.length - 1;
  if (issueTide === null) return points;
  const recentCoefficient = fitRecentTideResponse(history, tide, issue)?.tideLevelCoefficient ?? 0;
  const initial = emptyContributions(); initial[0] = anchor.v;
  const controls: (DriverControl & TideShapeControl)[] = [{ t: issue, v: anchor.v, contributionsFt: initial, ...tideControl(models[0].model, 0, recentCoefficient) }];
  for (const item of models) {
    const target = new Date(+issue + item.leadHours * HOUR);
    const x = weather ? featureVector(issue, target, anchor, history, tide, weather.past, weather.future, maxGap, true) : shortFeatures(issue, target, anchor, history, tide, maxGap);
    if (!x) return points;
    const groups = weather ? WEATHER_GROUPS : WEATHER_RESPONSE_FEATURES.map((_, i) => [0, 1, WEATHER_RESPONSE_FEATURES.length - 1].includes(i) ? WEATHER_GROUPS[i] : 7);
    const contributionsFt = regressionContributions(item.model, x, groups, anchor.v);
    controls.push({ t: target, v: anchor.v + predict(item.model, x), contributionsFt, ...tideControl(item.model, x[tideIndex], recentCoefficient) });
  }
  const attributed: AttributedWaterPoint[] = points.map(point => {
    const maxControlGap = weather ? 12 * HOUR : 3 * HOUR;
    const parts = interpolateContributions(controls, point.t, maxControlGap);
    const correction = tideShapeCorrection(controls, tide, issueTide, point.t, maxControlGap);
    if (!parts || correction === null) return point;
    parts[3] += correction;
    const vector = driverVector(parts, point.v);
    return vector ? { ...point, drivers: { m: weather ? 'w' : 'r', c: vector } } : point;
  });
  if (weather) {
    const rows = sortedWeather([...weather.past.filter(row => +row.t <= +issue), ...weather.future.filter(row => +row.t > +issue)]);
    for (const point of attributed) {
      // Weather context repeats hourly; factors remain present at every point.
      if (+point.t % HOUR !== 0) continue;
      const context = forecastWeatherContext(rows, point.t);
      if (point.drivers && context) point.drivers.w = context;
    }
  }
  return attributed;
}
/** Three-day measured/tide response, independently screened at12/24/48/72 h.
 * The prefix is kept exact; adjacent learned models are evaluated against tide
 * at each timestamp so a supported repeating response is not a straight tail.
 */
export function projectLongRangeResidual(model: WeatherResponseModel | null, historyInput: ResidualObservation[], tideInput: WaterPoint[], times: Date[], issue: Date, reference: Reference, tideReference: Reference, options: { prefix?: AttributedWaterPoint[]; includeDrivers?: boolean } = {}): AttributedWaterPoint[] {
  const long = model?.longRange;
  if (!model || !long?.eligible || !sameReference(reference, tideReference) || !sameReference(model.reference, reference) || !sameReference(model.tideReference, tideReference) || !Number.isFinite(+issue) || !Number.isFinite(+model.trainedUntil) || +model.trainedUntil > +issue || !Number.isFinite(model.maxObservationGapMs) || model.maxObservationGapMs <= 0 || model.maxObservationGapMs > WEATHER_OBSERVATION_MAX_GAP_MS || long.regressions.length !== LONG_RANGE_LEADS.length || long.regressions.some((r, i) => r.leadHours !== LONG_RANGE_LEADS[i] || !validRegression(r.model, LONG_RANGE_FEATURES.length))) return [];
  const history = sorted(historyInput.filter(p => +p.t <= +issue)), tide = sorted(tideInput);
  const prefix = options.prefix ?? projectShortRangeResidual(model, history, tide, Array.from({ length: 61 }, (_, i) => new Date(+issue + i * 6 * 60_000)), issue, reference, tideReference, { includeDrivers: options.includeDrivers });
  const points = longProjection(long.regressions, history, tide, times, issue, model.maxObservationGapMs, prefix);
  if (!options.includeDrivers || !points.length) return points;
  const anchor = anchorAt(history, issue, model.maxObservationGapMs)!;
  const junction = prefix.at(-1)!;
  const selected = long.regressions.filter(item => item.leadHours > Math.ceil((+junction.t - +issue) / HOUR));
  return points.map(point => {
    if (+point.t <= +junction.t) {
      const controls = prefix.filter(p => p.drivers).map(p => ({ ...p, contributionsFt: p.drivers!.c }));
      const original = prefix.find(value => +value.t === +point.t);
      return original?.drivers ? { ...point, drivers: original.drivers } : attachDrivers([point], controls, prefix.find(value => value.drivers)?.drivers?.m ?? 'r', HOUR)[0];
    }
    const x = longFeatures(issue, point.t, anchor, history, tide, model.maxObservationGapMs);
    const nextIndex = selected.findIndex(item => +issue + item.leadHours * HOUR >= +point.t);
    if (!x || nextIndex < 0) return point;
    const next = selected[nextIndex], before = selected[nextIndex - 1];
    const partsAt = (item: LongRegression) => item.method === 'steady-residual' ? [anchor.v, 0, 0, 0, 0, 0, 0, 0] : regressionContributions(item.model, x, LONG_GROUPS, anchor.v);
    const beforeParts = before ? partsAt(before) : (junction as AttributedWaterPoint).drivers?.c;
    if (!beforeParts) return point;
    const controls = [{ t: before ? new Date(+issue + before.leadHours * HOUR) : junction.t, v: 0, contributionsFt: beforeParts }, { t: new Date(+issue + next.leadHours * HOUR), v: 0, contributionsFt: partsAt(next) }];
    return attachDrivers([point], controls, 'l', 72 * HOUR)[0];
  });
}
/** Learned six-hour fallback, independently screened against a steady residual.
 * Weather outside its training range cannot enter this predictor. No forecast
 * is returned for unsupported measured conditions, gaps, references or weights.
 */
export function projectShortRangeResidual(model: WeatherResponseModel | null, historyInput: ResidualObservation[], tideInput: WaterPoint[], times: Date[], issue: Date, reference: Reference, tideReference: Reference, options: { includeDrivers?: boolean } = {}): AttributedWaterPoint[] {
  const short = model?.shortRange;
  if (!model || !short?.eligible || !sameReference(reference, tideReference) || !sameReference(model.reference, reference) || !sameReference(model.tideReference, tideReference) || !Number.isFinite(+issue) || !Number.isFinite(+model.trainedUntil) || +model.trainedUntil > +issue || !Number.isFinite(model.maxObservationGapMs) || model.maxObservationGapMs <= 0 || model.maxObservationGapMs > WEATHER_OBSERVATION_MAX_GAP_MS || short.regressions.length !== SHORT_RANGE_LEADS.length || short.regressions.some((r, i) => r.leadHours !== SHORT_RANGE_LEADS[i] || !validRegression(r.model))) return [];
  const history = sorted(historyInput.filter(p => p.t <= issue)), tide = sorted(tideInput);
  const points = shortProjection(short.regressions, history, tide, times, issue, model.maxObservationGapMs);
  return options.includeDrivers ? projectionDrivers(points, short.regressions, history, tide, issue, model.maxObservationGapMs) : points;
}
/** Returns no curve for failing holdout, stale/missing data or mismatched refs.
 * historyWeather after issue is ignored; only futureWeather supplies upcoming inputs.
 * An explicit opt-in permits a point-validated experimental curve when peak
 * coverage is unavailable. A known worse peak result always withholds it.
 */
export function projectWeatherResidual(
  model: WeatherResponseModel | null, historyInput: ResidualObservation[], tideInput: WaterPoint[],
  historyWeather: WeatherPoint[], futureWeather: WeatherPoint[], times: Date[], issue: Date,
  reference: Reference, tideReference: Reference, options: WeatherProjectionOptions = {},
): AttributedWaterPoint[] {
  const allowed = model?.validation.eligible || (options.allowPointValidatedExperimental === true && model?.validation.pointEligible);
  const adversePeak = model && model.validation.peakMaeFt !== null && model.validation.persistencePeakMaeFt !== null && model.validation.peakMaeFt > model.validation.persistencePeakMaeFt;
  if (!model || !allowed || adversePeak || !sameReference(reference, tideReference) || !sameReference(model.reference, reference) || !sameReference(model.tideReference, tideReference) || !Number.isFinite(+issue) || !Number.isFinite(+model.trainedUntil) || +model.trainedUntil > +issue || !Number.isFinite(model.maxObservationGapMs) || model.maxObservationGapMs <= 0 || model.maxObservationGapMs > WEATHER_OBSERVATION_MAX_GAP_MS || model.regressions.length !== WEATHER_RESPONSE_LEADS.length || model.regressions.some((r, i) => r.leadHours !== WEATHER_RESPONSE_LEADS[i] || !validRegression(r.model))) return [];
  const history = sorted(historyInput.filter(p => +p.t <= +issue)), tide = sorted(tideInput), past = sortedWeather(historyWeather), future = sortedWeather(futureWeather);
  const points = projection(model.regressions, history, tide, past, future, times, issue, model.maxObservationGapMs);
  return options.includeDrivers ? projectionDrivers(points, model.regressions, history, tide, issue, model.maxObservationGapMs, { past, future }) : points;
}

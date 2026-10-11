import { interpolate, projectSurgeTrend, Reference, WaterPoint } from './water';

const HOUR = 3600_000;
const PERIODS = [12.4206, 24] as const;
const LEADS = [1, 3, 6, 12, 24] as const;

export interface PatternPoint extends WaterPoint {
  estimated?: boolean;
  reference?: Reference;
}
export interface PatternOptions {
  horizonHours?: number;
  trainingHours?: number;
  maxObservationAgeMinutes?: number;
}
export interface PatternErrors {
  maeFt: number | null;
  rmseFt: number | null;
}
export interface PatternValidation {
  origins: number;
  trainOnlyBeforeIssue: true;
  byHorizon: {
    hours: number;
    samples: number;
    pattern: PatternErrors;
    persistence: PatternErrors;
    dampedTrend: PatternErrors;
  }[];
  patternPeakMaeFt: number | null;
  persistencePeakMaeFt: number | null;
  improvementFraction: number | null;
  accepted: boolean;
  limitation: string;
}
export interface ResidualPatternAnalysis {
  status: 'experimental' | 'insufficient-history' | 'stale' | 'reference-mismatch' | 'not-better-than-persistence' | 'invalid-options';
  reason: string;
  harmonicAmplitudesFt: { periodHours: number; amplitudeFt: number }[];
  varianceExplained: number | null;
  trainingHours: number;
  trainingSamples: number;
  validation: PatternValidation | null;
}
interface Fit {
  origin: number;
  coefficients: number[];
  samples: number;
  spanHours: number;
  varianceExplained: number;
}
interface HourlyPoint extends WaterPoint {
  /** The later source observation needed to know an interpolated sample. */
  knownAt: Date;
}
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const sameReference = (a: Reference, b: Reference) => a.station === b.station && a.datum === b.datum && a.units === b.units;
const validReference = (reference: Reference) => Boolean(reference.station && reference.datum && reference.units === 'ft');

function observedBefore(points: readonly PatternPoint[], issue: Date) {
  return [...new Map(points.filter(point => !point.estimated && Number.isFinite(+point.t) && Number.isFinite(point.v) && point.t <= issue).map(point => [+point.t, point])).values()].sort((a, b) => +a.t - +b.t);
}
/** Hourly samples prevent dense sensor intervals receiving disproportionate weight.
 * Interpolation never bridges observation gaps longer than 30 minutes.
 */
function sampleHourly(points: WaterPoint[]) {
  if (!points.length) return [];
  const samples: HourlyPoint[] = [];
  for (let time = Math.ceil(+points[0].t / HOUR) * HOUR; time <= +points.at(-1)!.t; time += HOUR) {
    const value = interpolate(points, new Date(time), 30 * 60_000);
    if (value !== null) {
      let left = 0;
      let right = points.length;
      while (left < right) {
        const middle = (left + right) >>> 1;
        if (+points[middle].t < time) left = middle + 1;
        else right = middle;
      }
      samples.push({ t: new Date(time), v: value, knownAt: points[left].t });
    }
  }
  return samples;
}
function columns(time: number, origin: number) {
  const hours = (time - origin) / HOUR;
  return [1, hours / 72, ...PERIODS.flatMap(period => {
    const angle = 2 * Math.PI * hours / period;
    return [Math.sin(angle), Math.cos(angle)];
  })];
}
function solve(matrix: number[][]): number[] | null {
  for (let column = 0; column < matrix.length; column++) {
    let pivot = column;
    for (let row = column + 1; row < matrix.length; row++) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
    }
    [matrix[pivot], matrix[column]] = [matrix[column], matrix[pivot]];
    const divisor = matrix[column][column];
    if (Math.abs(divisor) < 1e-10) return null;
    for (let j = column; j <= matrix.length; j++) matrix[column][j] /= divisor;
    for (let row = 0; row < matrix.length; row++) {
      if (row === column) continue;
      const scale = matrix[row][column];
      for (let j = column; j <= matrix.length; j++) matrix[row][j] -= scale * matrix[column][j];
    }
  }
  const result = matrix.map(row => row.at(-1)!);
  return result.every(Number.isFinite) ? result : null;
}
function fitPattern(hourly: HourlyPoint[], issue: Date, trainingHours: number): Fit | null {
  const rows = hourly.filter(point => point.t <= issue && point.knownAt <= issue && +point.t >= +issue - trainingHours * HOUR);
  if (rows.length < 55) return null;
  const spanHours = (+rows.at(-1)!.t - +rows[0].t) / HOUR;
  if (spanHours < 72 || rows.length / (Math.floor(spanHours) + 1) < 0.75) return null;
  const origin = +issue;
  const count = 6;
  const matrix = Array.from({ length: count }, () => Array(count + 1).fill(0) as number[]);
  for (const point of rows) {
    const x = columns(+point.t, origin);
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < count; j++) matrix[i][j] += x[i] * x[j];
      matrix[i][count] += x[i] * point.v;
    }
  }
  // Small fixed ridge stabilizes the four harmonic coefficients. The linear term
  // removes slow historical drift during fitting; it is not extrapolated.
  for (let i = 2; i < count; i++) matrix[i][i] += 0.05;
  const coefficients = solve(matrix);
  if (!coefficients) return null;
  const average = mean(rows.map(point => point.v));
  const variance = rows.reduce((sum, point) => sum + (point.v - average) ** 2, 0);
  const error = rows.reduce((sum, point) => sum + (point.v - columns(+point.t, origin).reduce((total, x, i) => total + x * coefficients[i], 0)) ** 2, 0);
  return { origin, coefficients, samples: rows.length, spanHours, varianceExplained: variance > 1e-10 ? Math.max(0, 1 - error / variance) : 0 };
}
function harmonic(fit: Fit, time: number) {
  const x = columns(time, fit.origin);
  return x.slice(2).reduce((sum, value, i) => sum + value * fit.coefficients[i + 2], 0);
}
function projected(fit: Fit, anchor: WaterPoint, time: number) {
  // Carry the current slow anomaly unchanged, adding only the learned cycle's
  // change. This anchors the candidate exactly to an actual gauge observation.
  return anchor.v + harmonic(fit, time) - harmonic(fit, +anchor.t);
}
function errors(values: number[]): PatternErrors {
  return {
    maeFt: values.length ? mean(values.map(Math.abs)) : null,
    rmseFt: values.length ? Math.sqrt(mean(values.map(value => value ** 2))) : null,
  };
}
function validate(hourly: HourlyPoint[], observed: WaterPoint[], issue: Date, trainingHours: number, evaluation?: { start: number; stepHours: number }): PatternValidation {
  const buckets = LEADS.map(hours => ({ hours, pattern: [] as number[], persistence: [] as number[], damped: [] as number[] }));
  const peaks: number[] = [];
  const persistencePeaks: number[] = [];
  let origins = 0;
  // Live preview: at most thirteen origins over the latest 48-hour issue interval.
  // Offline evaluation can specify a longer interval with daily issue times.
  // Every outcome ends before the evaluation cutoff; each fit ends at its issue.
  const end = Math.floor((+issue - 24 * HOUR) / HOUR) * HOUR;
  const start = Math.max(evaluation?.start ?? end - 48 * HOUR, +hourly[0].t + 72 * HOUR);
  for (let ms = Math.ceil(start / HOUR) * HOUR; ms <= end; ms += (evaluation?.stepHours ?? 4) * HOUR) {
    const origin = new Date(ms);
    const fit = fitPattern(hourly, origin, trainingHours);
    const history = observed.filter(point => point.t <= origin && +point.t >= ms - 4 * HOUR);
    const anchor = history.at(-1);
    if (!fit || !anchor || ms - +anchor.t > HOUR) continue;
    let count = 0;
    for (const bucket of buckets) {
      const time = new Date(+anchor.t + bucket.hours * HOUR);
      // Leads begin at the last actual reading, matching the trend horizon.
      // Ground truth may interpolate a target, but not through missing gaps.
      const actual = interpolate(observed, time, 30 * 60_000);
      if (actual === null) continue;
      const trend = bucket.hours <= 6 ? projectSurgeTrend(history, [time], origin, { horizonHours: 6 }).at(-1) : undefined;
      // Short-horizon comparisons use exactly the same target pairs for all
      // three candidates. Do not compare one model on an easier missing-data set.
      if (bucket.hours <= 6 && (!trend || +trend.t !== +time)) continue;
      bucket.pattern.push(projected(fit, anchor, +time) - actual);
      bucket.persistence.push(anchor.v - actual);
      if (trend) bucket.damped.push(trend.v - actual);
      count++;
    }
    if (count) origins++;
    const target = Array.from({ length: 24 }, (_, i) => {
      const t = new Date(+anchor.t + (i + 1) * HOUR);
      const v = interpolate(observed, t, 30 * 60_000);
      return v === null ? null : { t, v };
    }).filter((point): point is WaterPoint => point !== null);
    if (target.length === 24) {
      const actualPeak = Math.max(...target.map(point => point.v));
      peaks.push(Math.abs(Math.max(...target.map(point => projected(fit, anchor, +point.t))) - actualPeak));
      persistencePeaks.push(Math.abs(anchor.v - actualPeak));
    }
  }
  const byHorizon = buckets.map(bucket => ({
    hours: bucket.hours,
    samples: bucket.pattern.length,
    pattern: errors(bucket.pattern),
    persistence: errors(bucket.persistence),
    dampedTrend: errors(bucket.damped),
  }));
  const patternErrors = buckets.flatMap(bucket => bucket.pattern.map(Math.abs));
  const persistenceErrors = buckets.flatMap(bucket => bucket.persistence.map(Math.abs));
  const baseMae = persistenceErrors.length ? mean(persistenceErrors) : 0;
  const improvementFraction = baseMae > 1e-8 ? 1 - mean(patternErrors) / baseMae : null;
  const accepted = origins >= 8 && byHorizon.every(row => row.samples >= 8 && row.pattern.maeFt !== null && row.persistence.maeFt !== null && row.pattern.maeFt <= row.persistence.maeFt * 1.05 + 0.005) && improvementFraction !== null && improvementFraction >= 0.1;
  return {
    origins,
    trainOnlyBeforeIssue: true,
    byHorizon,
    patternPeakMaeFt: peaks.length ? mean(peaks) : null,
    persistencePeakMaeFt: persistencePeaks.length ? mean(persistencePeaks) : null,
    improvementFraction,
    accepted,
    limitation: 'Rolling-origin residual hindcast only; overlapping outcomes are correlated. Leads start at the last actual reading (up to one hour before issue). At 1/3/6 hours, all three candidates use identical available targets and valid trend history; 12/24 hours compare pattern and persistence only. Peak metrics require a complete 24-hour hourly outcome. Interpolated training samples must be fully known at issue. Fixed 12.4206-hour and 24-hour cycles can reflect tide phase or amplitude mismatch as well as local processes. No causal weather inference, calibrated uncertainty, storm validation or operational reliability claim.',
  };
}

/** Offline chronological benchmark. No observations after an issue enter
 * that issue's fitted cycle or measured anchor. The supplied end is the latest
 * permitted outcome, and references must describe the same gauge/datum/units.
 */
export function backtestResidualPattern(
  history: readonly PatternPoint[],
  start: Date,
  end: Date,
  observationRef: Reference,
  forecastRef: Reference,
  options: { trainingHours?: number; stepHours?: number } = {},
): PatternValidation | null {
  const trainingHours = options.trainingHours ?? 168;
  const stepHours = options.stepHours ?? 24;
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || start >= end || !Number.isFinite(trainingHours) || trainingHours < 72 || trainingHours > 336 || !Number.isFinite(stepHours) || stepHours < 4 || stepHours > 168)
    return null;
  if (!validReference(observationRef) || !validReference(forecastRef) || !sameReference(observationRef, forecastRef) || history.some(point => point.reference && !sameReference(point.reference, observationRef)))
    return null;
  const observed = observedBefore(history, end);
  const hourly = sampleHourly(observed);
  if (hourly.length < 73) return null;
  return validate(hourly, observed, end, trainingHours, { start: +start, stepHours });
}

/** Experimental measured-gauge residual forecast. The candidate is withheld
 * unless recent chronological holdout improves on persistence by at least 10%
 * overall without materially worsening an evaluated lead. Caller must keep the
 * validated tide/persistence forecast primary and avoid estimated proxy inputs.
 */
export function projectResidualPattern(
  history: readonly PatternPoint[],
  times: readonly Date[],
  issue: Date,
  observationRef: Reference,
  forecastRef: Reference,
  options: PatternOptions = {},
): { points: WaterPoint[]; analysis: ResidualPatternAnalysis } {
  const analysis: ResidualPatternAnalysis = {
    status: 'insufficient-history', reason: 'At least several days of measured residual history and eight completed rolling validation origins are required.',
    harmonicAmplitudesFt: [], varianceExplained: null, trainingHours: 0, trainingSamples: 0, validation: null,
  };
  const unavailable = (status: ResidualPatternAnalysis['status'], reason: string) => ({ points: [] as WaterPoint[], analysis: { ...analysis, status, reason } });
  const horizon = options.horizonHours ?? 6;
  const trainingHours = options.trainingHours ?? 168;
  const maxAge = options.maxObservationAgeMinutes ?? 60;
  if (!Number.isFinite(+issue) || !Number.isFinite(horizon) || horizon <= 0 || horizon > 24 || !Number.isFinite(trainingHours) || trainingHours < 72 || trainingHours > 336 || !Number.isFinite(maxAge) || maxAge <= 0 || maxAge > 60)
    return unavailable('invalid-options', 'Forecast horizon must be within 24 hours, training within 72–336 hours, and observation age within 60 minutes.');
  if (!validReference(observationRef) || !validReference(forecastRef) || !sameReference(observationRef, forecastRef) || history.some(point => point.reference && !sameReference(point.reference, observationRef)))
    return unavailable('reference-mismatch', 'Measured residual and forecast station, vertical datum and feet units must match.');
  const observed = observedBefore(history, issue);
  const anchor = observed.at(-1);
  if (!anchor || +issue - +anchor.t > maxAge * 60_000)
    return unavailable('stale', 'A recent actual gauge residual is required. Estimated proxy readings do not qualify.');
  // The largest validation fit needs the earlier training window plus 72 hours.
  const bounded = observed.filter(point => +point.t >= +issue - (trainingHours + 72) * HOUR);
  const hourly = sampleHourly(bounded);
  const fit = fitPattern(hourly, issue, trainingHours);
  if (!fit) return unavailable('insufficient-history', 'Require at least 72 hours of measured residuals with 75% hourly coverage; gaps over 30 minutes are not interpolated.');
  analysis.trainingHours = fit.spanHours;
  analysis.trainingSamples = fit.samples;
  analysis.varianceExplained = fit.varianceExplained;
  analysis.harmonicAmplitudesFt = PERIODS.map((periodHours, i) => ({ periodHours, amplitudeFt: Math.hypot(fit.coefficients[2 + i * 2], fit.coefficients[3 + i * 2]) }));
  analysis.validation = validate(hourly, bounded, issue, trainingHours);
  if (analysis.validation.origins < 8 || analysis.validation.byHorizon.some(row => row.samples < 8))
    return unavailable('insufficient-history', 'Not enough completed, well-covered rolling forecast origins to evaluate the learned pattern.');
  if (!analysis.validation.accepted)
    return unavailable('not-better-than-persistence', 'The learned cycle did not sufficiently outperform persistence on recent unseen observations.');
  const future = [...new Set(times.filter(time => Number.isFinite(+time) && time >= issue && +time > +anchor.t && +time <= +anchor.t + horizon * HOUR).map(time => +time))].sort((a, b) => a - b);
  analysis.status = 'experimental';
  analysis.reason = 'Recent holdout supports a measured tidal-cycle pattern; prospective local flood and weather validation remains incomplete.';
  return { points: future.length ? [{ t: new Date(+anchor.t), v: anchor.v }, ...future.map(time => ({ t: new Date(time), v: projected(fit, anchor, time) }))] : [], analysis };
}

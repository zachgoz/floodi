/** Local support for a learned tide-linked residual shape. This is a fit to
 * available measured history, not another astronomical tide prediction or a
 * weather forecast. Its historical drift is a nuisance term and is never
 * extrapolated. Station, datum and unit compatibility belongs to the caller.
 */
import { interpolate, type WaterPoint } from './water';

const HOUR = 3_600_000;
const LOOKBACK_HOURS = 60;
const OBSERVATION_MAX_GAP_MS = 30 * 60_000 + 10_000;
const TIDE_MAX_GAP_MS = 15 * 60_000;

export interface RecentResidualObservation extends WaterPoint { estimated?: boolean }
export interface RecentTideResponse {
  tideLevelCoefficient: number;
  tideSlopeCoefficientHours: number;
  samples: number;
  spanHours: number;
  varianceExplained: number;
  baselineVarianceExplained: number;
}

/** Equal duplicate readings are harmless. Conflicting readings are unknown;
 * neither averaging them nor selecting whichever arrived last is justified.
 */
function orderedUnambiguous(points: WaterPoint[]): WaterPoint[] | null {
  const values = new Map<number, number>();
  for (const point of points) {
    const at = +point.t;
    if (!Number.isFinite(at) || !Number.isFinite(point.v)) continue;
    const previous = values.get(at);
    if (previous !== undefined && previous !== point.v) return null;
    values.set(at, point.v);
  }
  return [...values].map(([t, v]) => ({ t: new Date(t), v })).sort((a, b) => +a.t - +b.t);
}

function solve(matrix: number[][]): number[] | null {
  const n = matrix.length;
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let row = i + 1; row < n; row++) {
      if (Math.abs(matrix[row][i]) > Math.abs(matrix[pivot][i])) pivot = row;
    }
    [matrix[i], matrix[pivot]] = [matrix[pivot], matrix[i]];
    const divisor = matrix[i][i];
    if (!Number.isFinite(divisor) || Math.abs(divisor) < 1e-9) return null;
    for (let j = i; j <= n; j++) matrix[i][j] /= divisor;
    for (let row = 0; row < n; row++) {
      if (row === i) continue;
      const scale = matrix[row][i];
      for (let j = i; j <= n; j++) matrix[row][j] -= scale * matrix[i][j];
    }
  }
  const result = matrix.map(row => row[n]);
  return result.every(Number.isFinite) ? result : null;
}

interface Sample { t: Date; x: number[]; y: number }
function fit(rows: Sample[], columns: number): number[] | null {
  const matrix = Array.from({ length: columns }, () => Array(columns + 1).fill(0) as number[]);
  for (const row of rows) {
    for (let i = 0; i < columns; i++) {
      for (let j = 0; j < columns; j++) matrix[i][j] += row.x[i] * row.x[j];
      matrix[i][columns] += row.x[i] * row.y;
    }
  }
  // Match the fixed diagnostic candidate: only the two shape terms are
  // regularized. Neither the intercept nor historical drift is penalized.
  for (let i = 2; i < columns; i++) matrix[i][i] += 0.05;
  return solve(matrix);
}

/** Fit the last 60 hours preceding the actual newest observation. Hourly
 * bracketed samples avoid weighting bursts of dense sensor reports more than
 * normal half-hour readings. No future observation or estimated proxy enters
 * either the fit or its anchor. Astronomical predictions may bracket the
 * derivative because they were already known at issue time.
 */
export function fitRecentTideResponse(
  historyResidual: RecentResidualObservation[], tide: WaterPoint[], issue: Date,
): RecentTideResponse | null {
  if (!Number.isFinite(+issue)) return null;
  const measured = historyResidual.filter(point => point.estimated !== true && Number.isFinite(+point.t) && Number.isFinite(point.v) && +point.t <= +issue);
  const latestAt = measured.reduce((latest, point) => Math.max(latest, +point.t), -Infinity);
  if (!Number.isFinite(latestAt) || +issue - latestAt > HOUR) return null;
  const lower = latestAt - LOOKBACK_HOURS * HOUR;
  const history = orderedUnambiguous(measured.filter(point => +point.t >= lower));
  const astronomical = orderedUnambiguous(tide.filter(point => Number.isFinite(+point.t) && +point.t >= lower - HOUR / 2 && +point.t <= latestAt + HOUR / 2));
  if (!history?.length || !astronomical?.length) return null;

  const rows: Sample[] = [];
  const firstHour = Math.ceil(+history[0].t / HOUR) * HOUR;
  for (let time = firstHour; time <= latestAt; time += HOUR) {
    const at = new Date(time);
    const residual = interpolate(history, at, OBSERVATION_MAX_GAP_MS);
    const level = interpolate(astronomical, at, TIDE_MAX_GAP_MS);
    const before = interpolate(astronomical, new Date(time - HOUR / 2), TIDE_MAX_GAP_MS);
    const after = interpolate(astronomical, new Date(time + HOUR / 2), TIDE_MAX_GAP_MS);
    if (residual === null || level === null || before === null || after === null) continue;
    rows.push({ t: at, x: [1, (time - latestAt) / (72 * HOUR), level, after - before], y: residual });
  }
  if (rows.length < 40) return null;
  const spanHours = (+rows.at(-1)!.t - +rows[0].t) / HOUR;
  if (spanHours < 48) return null;
  const coefficients = fit(rows, 4), baseline = fit(rows, 2);
  if (!coefficients || !baseline) return null;
  const mean = rows.reduce((sum, row) => sum + row.y, 0) / rows.length;
  const variance = rows.reduce((sum, row) => sum + (row.y - mean) ** 2, 0);
  const explained = (weights: number[]) => {
    const error = rows.reduce((sum, row) => sum + (row.y - weights.reduce((predicted, weight, i) => predicted + row.x[i] * weight, 0)) ** 2, 0);
    return variance > 1e-12 ? Math.max(0, Math.min(1, 1 - error / variance)) : 0;
  };
  return {
    tideLevelCoefficient: coefficients[2], tideSlopeCoefficientHours: coefficients[3],
    samples: rows.length, spanHours,
    varianceExplained: explained(coefficients), baselineVarianceExplained: explained(baseline),
  };
}

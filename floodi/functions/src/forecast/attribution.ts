/** Public, point-specific decomposition of the numerical forecast. These are
 * centered regression terms, not independently established physical causes.
 * Numeric vectors avoid repeating labels and cannot expose private weights.
 */
import type { WeatherPoint } from './model';
import type { WaterPoint } from './water';

export const FORECAST_FACTOR_KEYS = ['measured-anchor', 'recent-trend', 'recent-history', 'tide-pattern', 'wind', 'pressure', 'rainfall', 'baseline'] as const;
export const FORECAST_FACTOR_INFO = [
  { id: 'measured-anchor', label: 'Measured water anomaly', source: 'Local gauge minus localized NOAA astronomical tide' },
  { id: 'recent-trend', label: 'Recent trend', source: 'Measured residual change before forecast issue' },
  { id: 'recent-history', label: 'Recent water pattern', source: 'Measured residual persistence and learned recent-history response' },
  { id: 'tide-pattern', label: 'Tide-linked pattern', source: 'Learned residual relationship to astronomical tide level and slope; no extra lunar addition' },
  { id: 'wind', label: 'Wind', source: 'Learned response to rolling north/east wind components and their changes' },
  { id: 'pressure', label: 'Air pressure', source: 'Learned response to pressure and pressure changes' },
  { id: 'rainfall', label: 'Rainfall', source: 'Learned response to recent and forecast accumulated precipitation' },
  { id: 'baseline', label: 'Learned baseline', source: 'Regression intercept and centering; not a separately measured physical effect' },
] as const;
export const FORECAST_DRIVER_METHODS = { w: 'Weather response', r: 'Recent water pattern', l: 'Residual reversion', h: 'Historical tide pattern', hw: 'Historical pattern and weather' } as const;
export interface ForecastDrivers {
  m: 'w' | 'r' | 'l' | 'h' | 'hw';
  /** Feet, in FORECAST_FACTOR_KEYS order; sums to this point's residualFt. */
  c: number[];
  /** Forecast context, not an assertion that one reading caused a component. */
  w?: { at: string; wind6Mph: number; wind6FromDeg: number; rain24In: number; pressureHpa: number };
}
export interface AttributedWaterPoint extends WaterPoint { drivers?: ForecastDrivers }
export interface DriverControl extends WaterPoint { contributionsFt: number[] }
export const FORECAST_DRIVER_METADATA = {
  version: 1 as const,
  basis: 'centered-ridge-groups' as const,
  factorOrder: [...FORECAST_FACTOR_KEYS],
  interpretation: 'Additive model associations, not causal proof. Components use training-mean reference conditions and include persistence, blending and reversion. They sum to the forecast residual; astronomical tide is added separately.',
};
export const emptyContributions = () => Array(FORECAST_FACTOR_KEYS.length).fill(0) as number[];
export function regressionContributions(model: { intercept: number; coefficients: number[]; means: number[]; scales: number[] }, x: number[], groups: number[], anchor = 0): number[] {
  const parts = emptyContributions();
  parts[0] = anchor; parts[7] = model.intercept;
  model.coefficients.forEach((coefficient, i) => { parts[groups[i]] += coefficient * (x[i] - model.means[i]) / model.scales[i]; });
  return parts;
}
/** Six decimal places keep payloads compact. Reconcile only floating/rounding
 * error into the intercept, leaving the numerical forecast itself untouched. */
export function driverVector(parts: number[], residual: number): number[] | null {
  // Metadata failure must never change the underlying numerical curve. Do not
  // hide an attribution algebra error by dumping it into the baseline term.
  if (parts.length !== FORECAST_FACTOR_KEYS.length || !parts.every(Number.isFinite) || !Number.isFinite(residual) || Math.abs(parts.reduce((sum, value) => sum + value, 0) - residual) > 1e-6) return null;
  const rounded = parts.map(value => Math.round(value * 1e6) / 1e6);
  rounded[7] = residual - rounded.slice(0, 7).reduce((sum, value) => sum + value, 0);
  return rounded;
}
export function interpolateContributions(controls: DriverControl[], at: Date, maxGap: number): number[] | null {
  let low = 0, high = controls.length;
  while (low < high) { const mid = (low + high) >>> 1; if (+controls[mid].t < +at) low = mid + 1; else high = mid; }
  const right = controls[low], left = controls[low - 1];
  if (right && +right.t === +at) return right.contributionsFt.every(Number.isFinite) ? [...right.contributionsFt] : null;
  if (!left || !right || +right.t - +left.t > maxGap || !left.contributionsFt.every(Number.isFinite) || !right.contributionsFt.every(Number.isFinite)) return null;
  const fraction = (+at - +left.t) / (+right.t - +left.t);
  return left.contributionsFt.map((value, i) => value + (right.contributionsFt[i] - value) * fraction);
}
export function attachDrivers(points: WaterPoint[], controls: DriverControl[], method: ForecastDrivers['m'], maxGap: number): AttributedWaterPoint[] {
  return points.map(point => {
    const parts = interpolateContributions(controls, point.t, maxGap);
    const vector = parts ? driverVector(parts, point.v) : null;
    return vector ? { ...point, drivers: { m: method, c: vector } } : point;
  });
}
export function forecastWeatherContext(rows: WeatherPoint[], at: Date): ForecastDrivers['w'] | undefined {
  const before = rows.filter(row => +row.t <= +at).slice(-24);
  if (before.length !== 24 || +at - +before.at(-1)!.t >= 3600_000 || before.some((row, i) => !Number.isFinite(row.windSpeed) || row.windSpeed! < 0 || !Number.isFinite(row.windDirection) || row.windDirection! < 0 || row.windDirection! > 360 || !Number.isFinite(row.precip) || row.precip! < 0 || (i > 0 && +row.t - +before[i - 1].t !== 3600_000)) || !Number.isFinite(before.at(-1)!.pressure) || before.at(-1)!.pressure! <= 0) return undefined;
  const north = before.slice(-6).reduce((sum, row) => sum + row.windSpeed! * Math.cos(row.windDirection! * Math.PI / 180), 0) / 6;
  const east = before.slice(-6).reduce((sum, row) => sum + row.windSpeed! * Math.sin(row.windDirection! * Math.PI / 180), 0) / 6;
  return { at: before.at(-1)!.t.toISOString(), wind6Mph: Math.round(Math.hypot(north, east) * 100) / 100, wind6FromDeg: Math.round(((Math.atan2(east, north) * 180 / Math.PI + 360) % 360) * 100) / 100, rain24In: Math.round(before.reduce((sum, row) => sum + row.precip!, 0) * 1e4) / 1e4, pressureHpa: Math.round(before.at(-1)!.pressure! * 100) / 100 };
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export function validateForecastDrivers(value: unknown, residualFt: number, at: string): value is ForecastDrivers {
  if (!record(value) || !Object.keys(value).every(key => ['m', 'c', 'w'].includes(key)) || !['w', 'r', 'l', 'h', 'hw'].includes(String(value.m)) || !Array.isArray(value.c) || value.c.length !== FORECAST_FACTOR_KEYS.length || !value.c.every(finite) || Math.abs(value.c.reduce((sum, part) => sum + part, 0) - residualFt) > 1e-6) return false;
  if (value.w === undefined) return true;
  const weather = value.w;
  return ['w', 'hw'].includes(String(value.m)) && record(weather) && Object.keys(weather).length === 5 && typeof weather.at === 'string' && /Z$/.test(weather.at) && Number.isFinite(Date.parse(weather.at)) && Date.parse(weather.at) <= Date.parse(at) && Date.parse(at) - Date.parse(weather.at) < 3600_000 && ['wind6Mph', 'wind6FromDeg', 'rain24In', 'pressureHpa'].every(key => finite(weather[key])) && Number(weather.wind6Mph) >= 0 && Number(weather.wind6FromDeg) >= 0 && Number(weather.wind6FromDeg) <= 360 && Number(weather.rain24In) >= 0 && Number(weather.pressureHpa) > 0;
}

import type { Point } from 'src/components/Tab2/types';
import { FORECAST_FACTOR_INFO, FORECAST_DRIVER_METHODS, type ForecastDocument, type ForecastDrivers } from '../../functions/src/forecast/schema';

const valid = (points: Point[]) => points.filter(p => Number.isFinite(+p.t) && Number.isFinite(p.v)).sort((a, b) => +a.t - +b.t);
function sample(points: Point[], at: Date) {
  if (!points.length || +at < +points[0].t || +at > +points.at(-1)!.t) return null;
  const next = points.findIndex(p => +p.t >= +at);
  const b = points[next];
  if (+b.t === +at) return { value: b.v, interpolated: false };
  const a = points[next - 1];
  return { value: a.v + (b.v - a.v) * ((+at - +a.t) / (+b.t - +a.t)), interpolated: true };
}
export function selectSurgeReadout(observations: Point[], estimates: Point[], prediction: Point[], at: Date, live = false) {
  const measured = valid(observations), estimated = valid(estimates), forecast = valid(prediction);
  const measuredEnd = measured.at(-1)?.t;
  const handoff = Math.max(measuredEnd ? +measuredEnd : -Infinity, estimated.at(-1) ? +estimated.at(-1)!.t : -Infinity);
  const actual = sample(measured, at);
  if (actual) return { ...actual, at, source: actual.interpolated ? 'Interpolated' as const : 'Observed' as const };
  if ((!measuredEnd || +at > +measuredEnd)) {
    const bridge = sample(estimated, at);
    if (bridge) return { ...bridge, at, source: 'Estimated' as const };
  }
  if (+at >= handoff) {
    const future = sample(forecast, at);
    if (future) return { ...future, at, source: 'Forecast' as const };
  }
  const latest = measured.at(-1);
  if (live && latest && +latest.t <= +at) return { value: latest.v, at: latest.t, interpolated: false, source: 'Latest observation' as const };
  return null;
}

export function selectedForecastFactors(document: ForecastDocument | null | undefined, at: Date, displayedResidual: number) {
  if (!document?.driverInfo || !Number.isFinite(+at) || !Number.isFinite(displayedResidual)) return null;
  const points = document.points;
  const index = points.findIndex(p => Date.parse(p.t) >= +at);
  if (index < 0) return null;
  const b = points[index], a = Date.parse(b.t) === +at ? b : points[index - 1];
  if (!a?.drivers || !b.drivers || Date.parse(b.t) - Date.parse(a.t) > 30 * 60_000) return null;
  const ratio = a === b ? 0 : (+at - Date.parse(a.t)) / (Date.parse(b.t) - Date.parse(a.t));
  if (ratio < 0 || ratio > 1) return null;
  const mix = (x: number, y: number) => x + (y - x) * ratio;
  const contributions: { id: string; label: string; source: string; value: number }[] = FORECAST_FACTOR_INFO.map((info, i) => ({ ...info, value: mix(a.drivers!.c[i], b.drivers!.c[i]) }));
  const residual = mix(a.residualFt, b.residualFt);
  // The chart may fit a different tide phase. Preserve the physical forecast
  // and disclose its reference conversion, never attribute that to weather.
  contributions.push({ id: 'local-tide-reference', label: 'Tide reference adjustment', source: 'Chart tide reference adjustment; physical total water level is unchanged', value: displayedResidual - residual });
  const method = a.drivers.m === b.drivers.m ? FORECAST_DRIVER_METHODS[a.drivers.m] : 'Forecast blend';
  let weather: ForecastDrivers['w'];
  if (['w', 'hw'].includes(a.drivers.m) && ['w', 'hw'].includes(b.drivers.m)) {
    for (let i = index; i >= 0; i--) {
      const context = points[i].drivers?.w;
      if (context && Date.parse(context.at) <= +at && +at - Date.parse(context.at) < 3600_000) { weather = context; break; }
      if (Date.parse(points[i].t) < +at - 3600_000) break;
    }
  }
  return { contributions, method, weather };
}

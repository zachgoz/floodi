/** Pure calculations shared by the server and dashboard. All levels are feet. */
export interface WaterPoint {
  t: Date;
  v: number;
}
export interface FloodWindow {
  startTime: Date;
  endTime: Date | null;
  peakTime: Date;
  peakValue: number;
  startClipped: boolean;
  lastSampleTime: Date;
}
export interface Reference {
  station: string;
  datum: string;
  units: string;
}
export function interpolate(
  points: WaterPoint[],
  time: Date,
  maxGapMs = 15 * 60_000,
): number | null {
  const ms = time.getTime();
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (points[mid].t.getTime() < ms) lo = mid + 1;
    else hi = mid;
  }
  const right = points[lo];
  const left = points[lo - 1];
  if (right?.t.getTime() === ms)
    return Number.isFinite(right.v) ? right.v : null;
  if (!left || !right || right.t.getTime() - left.t.getTime() > maxGapMs)
    return null;
  if (!Number.isFinite(left.v) || !Number.isFinite(right.v)) return null;
  return (
    left.v +
    ((right.v - left.v) * (ms - left.t.getTime())) /
      (right.t.getTime() - left.t.getTime())
  );
}
export function residuals(
  observed: WaterPoint[],
  tide: WaterPoint[],
  observationRef: Reference,
  tideRef: Reference,
): WaterPoint[] {
  if (
    observationRef.station !== tideRef.station ||
    observationRef.datum !== tideRef.datum ||
    observationRef.units !== tideRef.units
  )
    return [];
  return observed.flatMap((p) => {
    const v = interpolate(tide, p.t);
    return v === null || !Number.isFinite(p.v) ? [] : [{ t: p.t, v: p.v - v }];
  });
}
/** Strict exceedance, interpolated crossings, and no invented end across missing data. */
export function floodWindows(
  points: WaterPoint[],
  threshold: number,
  maxGapMs = 15 * 60_000,
): FloodWindow[] {
  if (!Number.isFinite(threshold)) return [];
  const sorted = [
    ...new Map(
      points
        .filter((p) => Number.isFinite(p.v) && Number.isFinite(p.t.getTime()))
        .map((p) => [p.t.getTime(), p]),
    ).values(),
  ].sort((a, b) => +a.t - +b.t);
  const events: FloodWindow[] = [];
  let active: FloodWindow | null = null;
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const prev = sorted[i - 1];
    const contiguous = prev && +p.t - +prev.t <= maxGapMs;
    if (active && !contiguous) {
      events.push(active);
      active = null;
    }
    const crossing = () =>
      new Date(
        +prev.t + ((threshold - prev.v) / (p.v - prev.v)) * (+p.t - +prev.t),
      );
    if (p.v > threshold && !active)
      active = {
        startTime: contiguous && prev.v <= threshold ? crossing() : p.t,
        endTime: null,
        peakTime: p.t,
        peakValue: p.v,
        startClipped: !contiguous,
        lastSampleTime: p.t,
      };
    if (active && p.v > threshold) active.lastSampleTime = p.t;
    if (active && p.v > active.peakValue) {
      active.peakValue = p.v;
      active.peakTime = p.t;
    }
    if (active && p.v <= threshold) {
      active.endTime = crossing();
      events.push(active);
      active = null;
    }
  }
  if (active) events.push(active);
  return events;
}
export interface StreetCalibration {
  elevationFt: number;
  datum: string;
  validated: boolean;
  street: string;
  source: string;
}
export function inundation(
  peakFt: number,
  thresholdFt: number,
  datum: string,
  calibration?: StreetCalibration,
) {
  const valid =
    calibration?.validated &&
    calibration.datum === datum &&
    Number.isFinite(calibration.elevationFt) &&
    calibration.source &&
    calibration.street;
  return {
    label: valid ? "Max Street Inundation" : "Water Above Flood Threshold",
    inches:
      Math.max(0, peakFt - (valid ? calibration.elevationFt : thresholdFt)) *
      12,
  };
}
export function liveViewport(
  start: Date,
  end: Date,
  now: Date,
  focusRatio = 1 / 3,
) {
  const duration = Math.max(60_000, +end - +start);
  return {
    start: new Date(+now - duration * focusRatio),
    end: new Date(+now + duration * (1 - focusRatio)),
  };
}
export function surgeTrend(points: WaterPoint[], now: Date) {
  const sorted = [...new Map(points.filter(p => Number.isFinite(p.v) && Number.isFinite(+p.t) && p.t <= now).map(p => [+p.t, p])).values()].sort((a, b) => +a.t - +b.t);
  const latest = sorted.at(-1);
  if (!latest || +now - +latest.t > 60 * 60_000)
    return { value: null, trend: "Unavailable", slopeFtPerHour: null };
  const recent = sorted.filter(
    (p) => +p.t >= +latest.t - 3 * 3600_000 && +p.t <= +latest.t,
  );
  if (recent.length < 3 || +recent.at(-1)!.t - +recent[0].t < 3600_000 || recent.some((p, i) => i > 0 && +p.t - +recent[i - 1].t > 60 * 60_000))
    return { value: latest.v, trend: "Insufficient history", slopeFtPerHour: null };
  const xs = recent.map((p) => (+p.t - +recent[0].t) / 3600_000);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = recent.reduce((a, b) => a + b.v, 0) / recent.length;
  const slope =
    recent.reduce((a, p, i) => a + (xs[i] - mx) * (p.v - my), 0) /
    xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  return {
    value: latest.v,
    slopeFtPerHour: slope,
    trend:
      slope > 0.03 ? "Increasing" : slope < -0.03 ? "Decreasing" : "Stable",
  };
}

/** Experimental short-horizon damped slope, not calibrated confidence or storm surge.
 * Uses the same three-hour regression as the readout. The two-hour damping scale,
 * half-foot change cap are uncalibrated settings. The preview defaults to one hour;
 * longer horizons (up to six hours) are allowed only for historical evaluation.
 */
export function projectSurgeTrend(points: WaterPoint[], times: Date[], now: Date, options: { horizonHours?: number } = {}): WaterPoint[] {
  const horizon = options.horizonHours ?? 1;
  if (!Number.isFinite(horizon) || horizon <= 0 || horizon > 6) return [];
  const fit = surgeTrend(points, now);
  if (fit.value === null || fit.slopeFtPerHour === null) return [];
  const latest = points.filter(p => p.t <= now && Number.isFinite(+p.t) && Number.isFinite(p.v)).reduce((a, b) => +a.t > +b.t ? a : b);
  const slope = fit.trend === 'Stable' ? 0 : fit.slopeFtPerHour;
  const forecast = [...new Set(times.filter(t => Number.isFinite(+t) && t >= now && +t > +latest.t && +t - +latest.t <= horizon * 3600_000).map(t => +t))].sort((a, b) => a - b).map(ms => {
    const hours = (ms - +latest.t) / 3600_000;
    const change = Math.max(-0.5, Math.min(0.5, slope * 2 * (1 - Math.exp(-hours / 2))));
    return { t: new Date(ms), v: fit.value! + change };
  });
  return forecast.length ? [{ ...latest }, ...forecast] : [];
}

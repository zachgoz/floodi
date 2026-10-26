/** Hourly weather is usable only inside its actual coverage, within one sample interval. */
export function nearestEventWeather<T extends { t: Date }>(points: T[], time: Date): T | null {
  const valid = points.filter(point => Number.isFinite(+point.t));
  if (!valid.length || !Number.isFinite(+time)) return null;
  const first = Math.min(...valid.map(point => +point.t));
  const last = Math.max(...valid.map(point => +point.t));
  if (+time < first || +time > last) return null;
  const nearest = valid.reduce((best, point) => Math.abs(+point.t - +time) < Math.abs(+best.t - +time) ? point : best);
  return Math.abs(+nearest.t - +time) <= 3600_000 ? nearest : null;
}

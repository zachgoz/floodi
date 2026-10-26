import type { Point } from 'src/components/Tab2/types';

/** Matches the existing data-health contract; this is freshness, not a new flood threshold. */
export function currentGaugeStatus(points: Point[], thresholdFt: number, now: Date) {
  const latest = points.filter(p => !p.estimated && Number.isFinite(p.v) && Number.isFinite(+p.t) && +p.t <= +now)
    .sort((a, b) => +b.t - +a.t)[0];
  if (!latest) return { label: 'Observation unavailable', latest: null, fresh: false, above: false };
  const fresh = +now - +latest.t <= 60 * 60_000;
  return { label: !fresh ? 'Observation out of date' : latest.v > thresholdFt ? 'Gauge above flood threshold' : 'Below flood threshold', latest, fresh, above: fresh && latest.v > thresholdFt };
}

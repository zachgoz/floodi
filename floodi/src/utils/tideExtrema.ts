import type { Point } from 'src/components/Tab2/types';

export interface TideExtremum {
  t: Date;
  v: number;
  type: 'high' | 'low';
}

export interface NextTideInfo {
  type: 'high' | 'low';
  time: Date;
  value: number;
  minutesRemaining: number;
  heightDelta: number;
}

/**
 * Identifies tide peaks (high/low tides) from predicted/adjusted water level data.
 * Reuses the three-point derivative sign-change check from ChartViewer.tsx,
 * including a 1-hour noise threshold filter.
 * 
 * @param points Chronological array of water level data points
 * @returns Array of identified tide extrema (high/low peaks)
 */
export function findTideExtrema(points: Point[]): TideExtremum[] {
  if (!points || points.length < 3) {
    return [];
  }

  // Sort a copy of points chronologically to ensure stable extrema checking
  const sortedPoints = [...points].sort((a, b) => a.t.getTime() - b.t.getTime());
  const extrema: TideExtremum[] = [];

  for (let i = 1; i < sortedPoints.length - 1; i++) {
    const curr = sortedPoints[i].v;
    const prev = sortedPoints[i - 1].v;
    const next = sortedPoints[i + 1].v;

    const isHigh = (curr >= prev && curr > next) || (curr > prev && curr >= next);
    const isLow = (curr <= prev && curr < next) || (curr < prev && curr <= next);

    if (isHigh || isLow) {
      const type = isHigh ? 'high' : 'low';
      const timeMs = sortedPoints[i].t.getTime();

      // Noise control: Skip if within 1hr (3,600,000 ms) of the last registered extremum (noise)
      if (extrema.length > 0) {
        const lastExtremumTime = extrema[extrema.length - 1].t.getTime();
        if (Math.abs(timeMs - lastExtremumTime) < 3600000) {
          continue;
        }
      }

      extrema.push({
        t: sortedPoints[i].t,
        v: sortedPoints[i].v,
        type,
      });
    }
  }

  return extrema;
}

/**
 * Locates the next upcoming tide peak or valley after a target time,
 * and calculates the minutes remaining and height difference in feet.
 * 
 * @param points Array of water level data points
 * @param targetTime The focused time threshold (e.g. current simulation or view time)
 * @param currentLevel The water level at the target time
 * @returns Next tide information, or null if no upcoming extrema exist in the dataset
 */
export function findNextTideExtremum(
  points: Point[],
  targetTime: Date,
  currentLevel: number
): NextTideInfo | null {
  const extrema = findTideExtrema(points);
  const targetMs = targetTime.getTime();

  // Find the first upcoming extremum strictly after the targetTime
  const nextExtremum = extrema.find(ext => ext.t.getTime() > targetMs);

  if (!nextExtremum) {
    return null;
  }

  const diffMs = nextExtremum.t.getTime() - targetMs;
  const minutesRemaining = Math.max(0, Math.round(diffMs / 60000));
  const heightDelta = nextExtremum.v - currentLevel;

  return {
    type: nextExtremum.type,
    time: nextExtremum.t,
    value: nextExtremum.v,
    minutesRemaining,
    heightDelta,
  };
}

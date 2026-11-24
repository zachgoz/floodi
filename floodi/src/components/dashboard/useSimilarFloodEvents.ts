import { useMemo } from 'react';
import type { FloodEvent } from 'src/types/data';

const ONE_INCH_FT = 1 / 12;
const SIMILAR_WINDOW_FT = 0.25; // ±3 inches
const EPISODE_GAP_MS = 4 * 3600_000;

export interface HistoricalFloodComparison {
  event: FloodEvent;
  /** Signed difference in inches: negative means the past flood was lower than the target level. */
  deltaInches: number;
}

export interface HistoricalComparisonResult {
  matchType: 'similar' | 'closest' | 'none';
  items: HistoricalFloodComparison[];
}

/**
 * Collapses duplicate or overlapping Firestore flood_events records that belong to
 * the same physical high-tide flood episode, retaining the highest (or target-closest) record.
 */
export function deduplicateFloodEvents(
  floodEvents: FloodEvent[] | undefined,
  referenceTime?: Date,
  preferredTargetFt?: number | null,
): FloodEvent[] {
  if (!floodEvents?.length) return [];
  const refMs = referenceTime ? referenceTime.getTime() : Number.POSITIVE_INFINITY;

  const valid = floodEvents.filter(event => {
    const peakMs = Date.parse(event.peakTime);
    const startMs = Date.parse(event.startTime);
    const endMs = Date.parse(event.endTime ?? event.peakTime);
    return (
      Number.isFinite(peakMs) &&
      Number.isFinite(startMs) &&
      Number.isFinite(endMs) &&
      Number.isFinite(event.peakValue) &&
      peakMs < refMs
    );
  });

  if (!valid.length) return [];

  const sortedByTime = [...valid].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  const groups: Array<{ start: number; end: number; peakMs: number; events: FloodEvent[] }> = [];

  for (const event of sortedByTime) {
    const start = Date.parse(event.startTime);
    const end = Date.parse(event.endTime ?? event.peakTime);
    const peakMs = Date.parse(event.peakTime);
    const previous = groups.at(-1);
    if (previous && (start <= previous.end || Math.abs(peakMs - previous.peakMs) <= EPISODE_GAP_MS)) {
      previous.end = Math.max(previous.end, end);
      previous.events.push(event);
    } else {
      groups.push({ start, end, peakMs, events: [event] });
    }
  }

  return groups.map(group => {
    const sorted = [...group.events].sort((a, b) => {
      if (typeof preferredTargetFt === 'number' && Number.isFinite(preferredTargetFt)) {
        const diff = Math.abs(a.peakValue - preferredTargetFt) - Math.abs(b.peakValue - preferredTargetFt);
        if (Math.abs(diff) > 0.0001) return diff;
      } else {
        const peakDiff = b.peakValue - a.peakValue;
        if (Math.abs(peakDiff) > 0.0001) return peakDiff;
      }
      return Date.parse(b.peakTime) - Date.parse(a.peakTime);
    });
    return sorted[0];
  });
}

export function useSimilarFloodEvents(
  floodEvents: FloodEvent[] | undefined,
  predictedPeak: number | null,
  referenceTime: Date
): FloodEvent[] {
  return useMemo(() => {
    if (!floodEvents || predictedPeak === null || !Number.isFinite(predictedPeak)) return [];
    const referenceMs = referenceTime.getTime();

    const candidates = floodEvents
      .filter(event => {
        const peakMs = Date.parse(event.peakTime);
        const startMs = Date.parse(event.startTime);
        const endMs = Date.parse(event.endTime ?? event.peakTime);
        return (
          Number.isFinite(peakMs) &&
          Number.isFinite(startMs) &&
          Number.isFinite(endMs) &&
          peakMs < referenceMs &&
          Math.abs(event.peakValue - predictedPeak) <= ONE_INCH_FT
        );
      })
      .sort((a, b) => {
        const levelDiff = Math.abs(a.peakValue - predictedPeak) - Math.abs(b.peakValue - predictedPeak);
        if (Math.abs(levelDiff) > 0.0001) return levelDiff;
        return Date.parse(b.peakTime) - Date.parse(a.peakTime);
      });

    const groups: Array<{ start: number; end: number; events: FloodEvent[] }> = [];
    for (const event of [...candidates].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))) {
      const start = Date.parse(event.startTime);
      const end = Date.parse(event.endTime ?? event.peakTime);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      const previous = groups.at(-1);
      if (previous && start <= previous.end) {
        previous.end = Math.max(previous.end, end);
        previous.events.push(event);
      } else {
        groups.push({ start, end, events: [event] });
      }
    }
    return groups
      .map(group => group.events.sort((a, b) => candidates.indexOf(a) - candidates.indexOf(b))[0])
      .sort((a, b) => candidates.indexOf(a) - candidates.indexOf(b))
      .slice(0, 5);
  }, [floodEvents, predictedPeak, referenceTime]);
}

/**
 * Finds the best deduplicated historical flood references for a target water level:
 * - Tier 1 ('similar'): episodes within ±3 inches (±0.25 ft), sorted by height closeness then recency.
 * - Tier 2 ('closest'): if no episode falls within ±3 inches (e.g., forecast exceeds recorded peaks),
 *   returns up to 4 closest recorded episodes within ±1.0 ft with exact signed inch deltas.
 */
export function useHistoricalComparisonEvents(
  floodEvents: FloodEvent[] | undefined,
  targetLevel: number | null,
  referenceTime: Date,
  maxItems = 4,
): HistoricalComparisonResult {
  return useMemo(() => {
    if (!floodEvents?.length || targetLevel === null || !Number.isFinite(targetLevel)) {
      return { matchType: 'none', items: [] };
    }

    const episodes = deduplicateFloodEvents(floodEvents, referenceTime, targetLevel);
    if (!episodes.length) return { matchType: 'none', items: [] };

    const ranked = episodes
      .map(event => ({
        event,
        absDiffFt: Math.abs(event.peakValue - targetLevel),
        deltaInches: Math.round((event.peakValue - targetLevel) * 12),
      }))
      .sort((a, b) => {
        if (Math.abs(a.absDiffFt - b.absDiffFt) > 0.005) return a.absDiffFt - b.absDiffFt;
        return Date.parse(b.event.peakTime) - Date.parse(a.event.peakTime);
      });

    const similar = ranked.filter(item => item.absDiffFt <= SIMILAR_WINDOW_FT).slice(0, maxItems);
    if (similar.length > 0) {
      return {
        matchType: 'similar',
        items: similar.map(({ event, deltaInches }) => ({ event, deltaInches })),
      };
    }

    const closest = ranked.slice(0, maxItems);
    if (closest.length > 0) {
      return {
        matchType: 'closest',
        items: closest.map(({ event, deltaInches }) => ({ event, deltaInches })),
      };
    }

    return { matchType: 'none', items: [] };
  }, [floodEvents, targetLevel, referenceTime, maxItems]);
}

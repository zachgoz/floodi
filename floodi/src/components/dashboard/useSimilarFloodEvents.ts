import { useMemo } from 'react';
import type { FloodEvent } from 'src/types/data';

const ONE_INCH_FT = 1 / 12;

export function useSimilarFloodEvents(
  floodEvents: FloodEvent[] | undefined,
  predictedPeak: number | null,
  referenceTime: Date
): FloodEvent[] {
  return useMemo(() => {
    if (!floodEvents || predictedPeak === null) return [];
    const referenceMs = referenceTime.getTime();

    const candidates = floodEvents
      .filter(event => {
        const peakMs = new Date(event.peakTime).getTime();
        return peakMs < referenceMs && Math.abs(event.peakValue - predictedPeak) <= ONE_INCH_FT;
      })
      .sort((a, b) => {
        const levelDiff = Math.abs(a.peakValue - predictedPeak) - Math.abs(b.peakValue - predictedPeak);
        if (Math.abs(levelDiff) > 0.0001) return levelDiff;
        return new Date(b.peakTime).getTime() - new Date(a.peakTime).getTime();
      });
    // Several threshold records can describe the same physical flood episode.
    // Retain the closest-height match from each overlapping interval.
    const groups: Array<{ start: number; end: number; events: FloodEvent[] }> = [];
    for (const event of [...candidates].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))) {
      const start = Date.parse(event.startTime);
      const end = Date.parse(event.endTime ?? event.peakTime);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      const previous = groups.at(-1);
      if (previous && start <= previous.end) {
        previous.end = Math.max(previous.end, end);
        previous.events.push(event);
      } else groups.push({ start, end, events: [event] });
    }
    return groups.map(group => group.events.sort((a, b) => candidates.indexOf(a) - candidates.indexOf(b))[0])
      .sort((a, b) => candidates.indexOf(a) - candidates.indexOf(b)).slice(0, 5);
  }, [floodEvents, predictedPeak, referenceTime]);
}

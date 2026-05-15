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

    return floodEvents
      .filter(event => {
        const peakMs = new Date(event.peakTime).getTime();
        return peakMs < referenceMs && Math.abs(event.peakValue - predictedPeak) <= ONE_INCH_FT;
      })
      .sort((a, b) => {
        const levelDiff = Math.abs(a.peakValue - predictedPeak) - Math.abs(b.peakValue - predictedPeak);
        if (Math.abs(levelDiff) > 0.0001) return levelDiff;
        return new Date(b.peakTime).getTime() - new Date(a.peakTime).getTime();
      })
      .slice(0, 5);
  }, [floodEvents, predictedPeak, referenceTime]);
}

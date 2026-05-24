import { describe, it, expect } from 'vitest';
import { findTideExtrema, findNextTideExtremum } from 'src/utils/tideExtrema';
import type { Point } from 'src/components/Tab2/types';

describe('tideExtrema utility', () => {
  // Helper to generate a clean sine wave of water level points
  function generateSineWavePoints(
    startTime: Date,
    hours: number,
    intervalMinutes: number,
    amplitude: number = 3,
    periodHours: number = 12,
    offset: number = 5
  ): Point[] {
    const points: Point[] = [];
    const totalMs = hours * 60 * 60 * 1000;
    const intervalMs = intervalMinutes * 60 * 1000;

    for (let ms = 0; ms <= totalMs; ms += intervalMs) {
      const t = new Date(startTime.getTime() + ms);
      // v = offset + amp * sin(2 * pi * ms / periodMs)
      const val = offset + amplitude * Math.sin((2 * Math.PI * ms) / (periodHours * 60 * 60 * 1000));
      points.push({ t, v: Number(val.toFixed(4)) });
    }
    return points;
  }

  describe('findTideExtrema', () => {
    it('returns empty array when points are empty or too few', () => {
      expect(findTideExtrema([])).toEqual([]);
      expect(findTideExtrema([{ t: new Date(), v: 1.2 }])).toEqual([]);
      expect(findTideExtrema([
        { t: new Date(1000), v: 1.2 },
        { t: new Date(2000), v: 1.5 }
      ])).toEqual([]);
    });

    it('correctly identifies high and low tide peaks in a clean semi-diurnal curve', () => {
      const startTime = new Date('2026-05-24T00:00:00Z');
      // 12-hour period, 24 hours of data, interval of 15 minutes
      const points = generateSineWavePoints(startTime, 24, 15, 3.0, 12, 5.0);

      const extrema = findTideExtrema(points);

      // In 24 hours, a 12-hour period sine wave should have:
      // High: 3h, 15h
      // Low: 9h, 21h
      expect(extrema.length).toBe(4);

      // Verify Types and Values
      expect(extrema[0].type).toBe('high');
      expect(extrema[0].t.toISOString()).toBe(new Date(startTime.getTime() + 3 * 3600000).toISOString());
      expect(extrema[0].v).toBeCloseTo(8.0, 2);

      expect(extrema[1].type).toBe('low');
      expect(extrema[1].t.toISOString()).toBe(new Date(startTime.getTime() + 9 * 3600000).toISOString());
      expect(extrema[1].v).toBeCloseTo(2.0, 2);

      expect(extrema[2].type).toBe('high');
      expect(extrema[2].t.toISOString()).toBe(new Date(startTime.getTime() + 15 * 3600000).toISOString());
      expect(extrema[2].v).toBeCloseTo(8.0, 2);

      expect(extrema[3].type).toBe('low');
      expect(extrema[3].t.toISOString()).toBe(new Date(startTime.getTime() + 21 * 3600000).toISOString());
      expect(extrema[3].v).toBeCloseTo(2.0, 2);
    });

    it('handles out-of-order points correctly by sorting them', () => {
      const startTime = new Date('2026-05-24T00:00:00Z');
      const points = generateSineWavePoints(startTime, 12, 30, 3.0, 12, 5.0);
      
      // Shuffle points
      const shuffledPoints = [...points].sort(() => Math.random() - 0.5);

      const extrema = findTideExtrema(shuffledPoints);

      // Should still find High at 3h and Low at 9h
      expect(extrema.length).toBe(2);
      expect(extrema[0].type).toBe('high');
      expect(extrema[0].t.toISOString()).toBe(new Date(startTime.getTime() + 3 * 3600000).toISOString());
      expect(extrema[1].type).toBe('low');
      expect(extrema[1].t.toISOString()).toBe(new Date(startTime.getTime() + 9 * 3600000).toISOString());
    });

    it('applies noise filter to skip redundant peaks/valleys within 1 hour', () => {
      const startTime = new Date('2026-05-24T00:00:00Z');
      const points: Point[] = [
        { t: new Date(startTime.getTime() + 0), v: 2.0 },
        { t: new Date(startTime.getTime() + 15 * 60000), v: 4.5 },
        { t: new Date(startTime.getTime() + 30 * 60000), v: 4.6 }, // Real High Peak
        { t: new Date(startTime.getTime() + 45 * 60000), v: 4.3 },
        { t: new Date(startTime.getTime() + 60 * 60000), v: 4.4 }, // Micro noise peak (within 1 hour from 30 mins)
        { t: new Date(startTime.getTime() + 75 * 60000), v: 4.2 },
        { t: new Date(startTime.getTime() + 120 * 60000), v: 1.0 },
      ];

      const extrema = findTideExtrema(points);

      // High peak should be found at 30 mins, but the noise at 60 mins should be ignored
      const highs = extrema.filter(e => e.type === 'high');
      expect(highs.length).toBe(1);
      expect(highs[0].t.toISOString()).toBe(new Date(startTime.getTime() + 30 * 60000).toISOString());
      expect(highs[0].v).toBe(4.6);
    });
  });

  describe('findNextTideExtremum', () => {
    it('returns null if there are no upcoming extrema', () => {
      const startTime = new Date('2026-05-24T00:00:00Z');
      const points = generateSineWavePoints(startTime, 6, 15, 3.0, 12, 5.0); // Has High at 3h
      
      const targetTime = new Date(startTime.getTime() + 4 * 3600000); // 4h (past the 3h peak)
      const nextTide = findNextTideExtremum(points, targetTime, 4.0);

      expect(nextTide).toBeNull();
    });

    it('returns correct countdown and elevation change for upcoming high tide', () => {
      const startTime = new Date('2026-05-24T00:00:00Z');
      const points = generateSineWavePoints(startTime, 12, 15, 3.0, 12, 5.0); // High at 3h (8.0 ft), Low at 9h (2.0 ft)

      // Set target to 1 hour and 15 minutes before the high tide
      // High tide is at 3h (180 minutes). Target is at 1h 45m (105 minutes).
      const targetTime = new Date(startTime.getTime() + 105 * 60000);
      const currentLevel = 6.5; // Water is rising

      const nextTide = findNextTideExtremum(points, targetTime, currentLevel);

      expect(nextTide).not.toBeNull();
      expect(nextTide!.type).toBe('high');
      expect(nextTide!.time.toISOString()).toBe(new Date(startTime.getTime() + 180 * 60000).toISOString());
      expect(nextTide!.value).toBeCloseTo(8.0, 2);
      expect(nextTide!.minutesRemaining).toBe(75); // 180 - 105 = 75 minutes
      expect(nextTide!.heightDelta).toBeCloseTo(1.5, 2); // 8.0 - 6.5 = +1.5 ft (rising)
    });

    it('returns correct countdown and elevation change for upcoming low tide', () => {
      const startTime = new Date('2026-05-24T00:00:00Z');
      const points = generateSineWavePoints(startTime, 12, 15, 3.0, 12, 5.0); // High at 3h (8.0 ft), Low at 9h (2.0 ft)

      // Set target to 2 hours before the low tide
      // Low tide is at 9h (540 minutes). Target is at 7h (420 minutes).
      const targetTime = new Date(startTime.getTime() + 420 * 60000);
      const currentLevel = 3.5; // Water is falling

      const nextTide = findNextTideExtremum(points, targetTime, currentLevel);

      expect(nextTide).not.toBeNull();
      expect(nextTide!.type).toBe('low');
      expect(nextTide!.time.toISOString()).toBe(new Date(startTime.getTime() + 540 * 60000).toISOString());
      expect(nextTide!.value).toBeCloseTo(2.0, 2);
      expect(nextTide!.minutesRemaining).toBe(120); // 540 - 420 = 120 minutes
      expect(nextTide!.heightDelta).toBeCloseTo(-1.5, 2); // 2.0 - 3.5 = -1.5 ft (falling)
    });
  });
});

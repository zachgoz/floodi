import { describe, expect, it } from 'vitest';
import { estimateSurgeAndTimeOffset } from 'src/lib/noaa';

describe('estimateSurgeAndTimeOffset', () => {
  it('matches equivalent NOAA timestamps with different ISO string formats', () => {
    const observed = {
      '2026-05-18T12:00:00.000Z': 5.2,
      '2026-05-18T12:06:00.000Z': 5.4,
    };
    const predicted = {
      '2026-05-18T12:00:00Z': 4.8,
      '2026-05-18T12:06:00Z': 5.0,
    };

    const result = estimateSurgeAndTimeOffset(observed, predicted, 'noaa');

    expect(result.n).toBe(2);
    expect(result.offset).toBeCloseTo(0.4);
  });

  it('matches shifted FiMAN observations to nearest predicted timestamps', () => {
    const observed = {
      '2026-05-18T13:00:00.000Z': 5.3,
      '2026-05-18T13:06:00.000Z': 5.5,
    };
    const predicted = {
      '2026-05-18T12:00:00Z': 4.8,
      '2026-05-18T12:06:00Z': 5.0,
    };

    const result = estimateSurgeAndTimeOffset(observed, predicted, 'fiman');

    expect(result.timeOffsetMins).toBe(60);
    expect(result.n).toBe(2);
    expect(result.offset).toBeCloseTo(0.5);
  });
});

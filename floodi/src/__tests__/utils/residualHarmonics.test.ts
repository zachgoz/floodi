import { describe, it, expect } from 'vitest';
import { fitResidualHarmonics } from 'src/utils/residualHarmonics';

describe('fitResidualHarmonics utility', () => {
  const now = new Date('2026-10-27T12:00:00Z');

  it('returns 0 when history has fewer than 12 points', () => {
    const shortHistory = [
      { t: new Date(now.getTime() - 3600_000), v: 0.5 },
      { t: now, v: 0.6 },
    ];
    const fn = fitResidualHarmonics(shortHistory, now);
    expect(fn(now)).toBe(0);
    expect(fn(new Date(now.getTime() + 6 * 3600_000))).toBe(0);
  });

  it('strictly anchors at 0.000 ft at anchorTime', () => {
    const waveHistory = [];
    for (let i = 0; i < 48; i++) {
      const t = new Date(now.getTime() - (48 - i) * 30 * 60_000);
      const h = (t.getTime() - now.getTime()) / 3600_000;
      const v = 0.8 + 0.35 * Math.cos(2 * Math.PI * h / 12.4206);
      waveHistory.push({ t, v });
    }
    const fn = fitResidualHarmonics(waveHistory, now);
    expect(Math.abs(fn(now))).toBeLessThan(1e-4);
  });

  it('accurately reproduces M2 (12.4206h) tidal oscillation phases into future', () => {
    const waveHistory = [];
    for (let i = 0; i < 48; i++) {
      const t = new Date(now.getTime() - (48 - i) * 30 * 60_000);
      const h = (t.getTime() - now.getTime()) / 3600_000;
      // Cosine peak at anchor
      const v = 0.7 + 0.40 * Math.cos(2 * Math.PI * h / 12.4206);
      waveHistory.push({ t, v });
    }
    const fn = fitResidualHarmonics(waveHistory, now);

    // Quarter cycle (~3.1h) should be near -0.4 ft deviation from anchor
    const quarterCycle = new Date(now.getTime() + 3.105 * 3600_000);
    expect(fn(quarterCycle)).toBeLessThan(-0.25);

    // Half cycle (~6.21h) should reach full inverted deviation (~ -0.8 ft)
    const halfCycle = new Date(now.getTime() + 6.21 * 3600_000);
    expect(fn(halfCycle)).toBeLessThan(-0.6);

    // Full cycle (~12.42h) returns near 0
    const fullCycle = new Date(now.getTime() + 12.4206 * 3600_000);
    expect(Math.abs(fn(fullCycle))).toBeLessThan(0.06);
  });

  it('safely handles non-finite, null or malformed data points without throwing', () => {
    const dirtyHistory = [
      { t: new Date(now.getTime() - 40 * 3600_000), v: Number.NaN },
      { t: 'invalid-date', v: 0.5 },
      ...Array.from({ length: 20 }, (_, i) => ({
        t: new Date(now.getTime() - (20 - i) * 3600_000),
        v: 0.6 + 0.2 * Math.sin(i * 0.5),
      })),
    ];
    const fn = fitResidualHarmonics(dirtyHistory, now);
    expect(Number.isFinite(fn(now))).toBe(true);
    expect(Number.isFinite(fn('invalid-target'))).toBe(true);
    expect(fn('invalid-target')).toBe(0);
  });
});

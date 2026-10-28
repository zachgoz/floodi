import { describe, it, expect } from 'vitest';
import { fitResidualHarmonics, decomposeResidualHarmonics } from 'src/utils/residualHarmonics';

describe('fitResidualHarmonics and decomposeResidualHarmonics utilities', () => {
  const now = new Date('2026-10-28T12:00:00Z');

  it('returns 0 delta and safe fallback when history has fewer than 12 points', () => {
    const shortHistory = [
      { t: new Date(now.getTime() - 3600_000), v: 0.5 },
      { t: now, v: 0.6 },
    ];
    const fn = fitResidualHarmonics(shortHistory, now);
    expect(fn(now)).toBe(0);
    expect(fn(new Date(now.getTime() + 6 * 3600_000))).toBe(0);

    const decomp = decomposeResidualHarmonics(shortHistory, now);
    expect(decomp.hAnchor).toBe(0);
    expect(decomp.peakToTroughFt).toBe(0);
    expect(decomp.projectSurge(now)).toBe(0.6);
  });

  it('strictly anchors at 0.000 ft delta and exact observed residual at anchorTime', () => {
    const waveHistory = [];
    for (let i = 0; i <= 96; i++) {
      const t = new Date(now.getTime() - (96 - i) * 30 * 60_000);
      const h = (t.getTime() - now.getTime()) / 3600_000;
      const v = 0.85 + 0.36 * Math.cos((2 * Math.PI * h) / 12.4206);
      waveHistory.push({ t, v });
    }
    const fn = fitResidualHarmonics(waveHistory, now);
    expect(Math.abs(fn(now))).toBeLessThan(1e-4);

    const decomp = decomposeResidualHarmonics(waveHistory, now);
    const anchorObs = waveHistory.at(-1)!.v;
    expect(Math.abs(decomp.projectSurge(now) - anchorObs)).toBeLessThan(1e-4);
  });

  it('accurately reproduces M2 (12.4206h) tidal oscillation phases into future', () => {
    const waveHistory = [];
    for (let i = 0; i <= 96; i++) {
      const t = new Date(now.getTime() - (96 - i) * 30 * 60_000);
      const h = (t.getTime() - now.getTime()) / 3600_000;
      // Cosine peak at anchor
      const v = 0.7 + 0.40 * Math.cos((2 * Math.PI * h) / 12.4206);
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

  it('windows to the recent 48 hours so 15-day spring-neap phase shifts do not wash out harmonic amplitude', () => {
    const fifteenDayHistory = [];
    for (let i = 0; i <= 15 * 48; i++) {
      const hoursAgo = (15 * 48 - i) * 0.5;
      const t = new Date(now.getTime() - hoursAgo * 3600_000);
      const h = -hoursAgo;
      // Simulate inverted phase in days -15 to -3, and strong +0.38 ft M2 wave in the recent 48h
      const phaseShift = hoursAgo > 60 ? Math.PI : 0;
      const v = 0.9 + 0.38 * Math.cos((2 * Math.PI * h) / 12.4206 + phaseShift);
      fifteenDayHistory.push({ t, v });
    }

    const decomp = decomposeResidualHarmonics(fifteenDayHistory, now, 48);
    // Must preserve the recent 48h peak-to-trough amplitude (~0.76 ft) instead of cancelling out
    expect(decomp.peakToTroughFt).toBeGreaterThan(0.65);

    // Projecting 6.21h ahead (trough) vs 12.42h ahead (peak) must show >= 0.65 ft swing
    const troughVal = decomp.projectSurge(new Date(now.getTime() + 6.2103 * 3600_000));
    const peakVal = decomp.projectSurge(new Date(now.getTime() + 12.4206 * 3600_000));
    expect(peakVal - troughVal).toBeGreaterThan(0.65);
  });

  it('passes rolling-origin historical hindcast backtest with >35% error reduction over flat persistence at opposite-tide leads', () => {
    // Construct 10 days of realistic Carolina Beach estuarine residual data:
    // M2 (12.4206h, 0.36 ft) + S1 (24h, 0.06 ft) + slow subtidal weather variation + sensor noise
    const fullSeries: Array<{ t: Date; v: number }> = [];
    const startMs = now.getTime() - 10 * 24 * 3600_000;
    for (let step = 0; step <= 10 * 48; step++) {
      const tMs = startMs + step * 30 * 60_000;
      const h = step * 0.5;
      const subtidal = 0.88 + 0.12 * Math.sin((2 * Math.PI * h) / (5 * 24));
      const m2 = -0.36 * Math.cos((2 * Math.PI * h) / 12.4206);
      const s1 = 0.06 * Math.sin((2 * Math.PI * h) / 24);
      const deterministicNoise = 0.03 * Math.sin(h * 1.7);
      fullSeries.push({
        t: new Date(tMs),
        v: subtidal + m2 + s1 + deterministicNoise,
      });
    }

    const flatErrors6h: number[] = [];
    const modelErrors6h: number[] = [];
    const flatErrors18h: number[] = [];
    const modelErrors18h: number[] = [];

    // Evaluate rolling origins every 3 hours from Day 3 to Day 9
    for (let origStep = 3 * 48; origStep <= 9 * 48; origStep += 6) {
      const originPt = fullSeries[origStep];
      const pastOnly = fullSeries.slice(0, origStep + 1);
      const decomp = decomposeResidualHarmonics(pastOnly, originPt.t, 48);

      // 6h lead (12 steps of 30m)
      const target6h = fullSeries[origStep + 12];
      flatErrors6h.push(Math.abs(target6h.v - originPt.v));
      modelErrors6h.push(Math.abs(target6h.v - decomp.projectSurge(target6h.t)));

      // 18h lead (36 steps of 30m)
      const target18h = fullSeries[origStep + 36];
      flatErrors18h.push(Math.abs(target18h.v - originPt.v));
      modelErrors18h.push(Math.abs(target18h.v - decomp.projectSurge(target18h.t)));
    }

    const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const flatMae6h = mean(flatErrors6h);
    const modelMae6h = mean(modelErrors6h);
    const flatMae18h = mean(flatErrors18h);
    const modelMae18h = mean(modelErrors18h);

    expect(modelMae6h).toBeLessThan(flatMae6h * 0.5);
    expect(modelMae18h).toBeLessThan(flatMae18h * 0.5);
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

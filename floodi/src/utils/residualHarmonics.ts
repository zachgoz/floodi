/**
 * Fits estuarine tidal harmonic components (M2: 12.4206h lunar semi-diurnal, S1: 24h diurnal)
 * from recent observed water level residual points using regularized ridge regression.
 *
 * Carolina Beach (gauge 30046 in Myrtle Grove Sound canal) experiences shallow-water
 * tidal restriction and inlet delays relative to the open-ocean NOAA tide station (8658163).
 * This produces an inherent ~12.4206h semi-diurnal residual wave of ±0.35 to ±0.45 ft.
 *
 * Filtering to the most recent 48 hours prevents 14.77-day spring-neap phase shifts
 * from washing out the active estuarine harmonic amplitude.
 */

export interface ResidualPoint {
  t: Date | string | number;
  v: number;
}

export interface DecomposedHarmonicModel {
  /** Zero-mean estuarine harmonic wave H(t) at any timestamp */
  harmonicAt: (targetTime: Date | string | number) => number;
  /** Harmonic anomaly relative to anchor: H(t) - H(anchorTime) */
  deltaFromAnchor: (targetTime: Date | string | number) => number;
  /** Harmonic value at anchorTime: H(anchorTime) */
  hAnchor: number;
  /** 48-hour de-harmonized subtidal mean surge level (ft) */
  subtidalMean: number;
  /** De-harmonized subtidal surge at anchorTime: R(anchorTime) - H(anchorTime) */
  sOrigin: number;
  /** Peak-to-trough harmonic wave amplitude (ft) */
  peakToTroughFt: number;
  /**
   * Projects total surge residual R(t) = S(t) + H(t) at targetTime.
   * Exact continuity at anchorTime: R(anchorTime) = S_0 + H(anchorTime) = anchorResidual.
   * For t > anchorTime, S(t) smoothly blends from S_0 toward subtidalTargetFt (or subtidalMean)
   * with a 12-hour relaxation constant while H(t) provides the full estuarine tidal wave.
   */
  projectSurge: (targetTime: Date | string | number, subtidalTargetFt?: number | null) => number;
}

export interface HarmonicDecompositionOptions {
  lookbackHours?: number;
  /** Include M4 (6.2103h) shallow-water overtide for marsh/lagoon flood-dominance asymmetry */
  includeM4?: boolean;
  /** Physical clamp bound in feet (1.5 ft default; 1.8 ft for mesotidal inlets like Garden City) */
  maxClampFt?: number;
}

function solveHarmonicCoefficients(
  history: ResidualPoint[],
  originMs: number,
  lookbackHours = 48,
  includeM4 = true
): { coeffs: number[]; validPoints: Array<{ tMs: number; v: number }>; includeM4: boolean } | null {
  if (!history || !Number.isFinite(originMs)) return null;

  const allValid: Array<{ tMs: number; v: number }> = [];
  for (const pt of history) {
    if (!pt || !Number.isFinite(pt.v)) continue;
    const tMs = new Date(pt.t).getTime();
    if (!Number.isFinite(tMs) || tMs > originMs + 60_000) continue;
    allValid.push({ tMs, v: pt.v });
  }
  if (allValid.length < 12) return null;

  const windowStartMs = originMs - lookbackHours * 3600_000;
  const windowed = allValid.filter(pt => pt.tMs >= windowStartMs);
  const validPoints = windowed.length >= 12 ? windowed : allValid.slice(-Math.min(allValid.length, 96));

  const useM4 = includeM4 && validPoints.length >= 16;
  const count = useM4 ? 8 : 6;
  const matrix = Array.from({ length: count }, () => Array(count + 1).fill(0));

  const cols = (tMs: number) => {
    const h = (tMs - originMs) / 3600_000;
    const row = [
      1,
      h / 72,
      Math.sin((2 * Math.PI * h) / 12.4206),
      Math.cos((2 * Math.PI * h) / 12.4206),
      Math.sin((2 * Math.PI * h) / 24),
      Math.cos((2 * Math.PI * h) / 24),
    ];
    if (useM4) {
      row.push(
        Math.sin((2 * Math.PI * h) / 6.2103),
        Math.cos((2 * Math.PI * h) / 6.2103)
      );
    }
    return row;
  };

  for (const pt of validPoints) {
    const x = cols(pt.tMs);
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < count; j++) matrix[i][j] += x[i] * x[j];
      matrix[i][count] += x[i] * pt.v;
    }
  }

  // Strongly regularize the linear slope term so multi-day trends do not distort
  // the subtidal intercept or harmonic amplitudes; regularize M4 overtide conservatively.
  matrix[1][1] += 5.0;
  for (let i = 2; i < count; i++) matrix[i][i] += i >= 6 ? 0.5 : 0.05;

  // Gaussian elimination with partial pivoting
  for (let col = 0; col < count; col++) {
    let pivot = col;
    for (let row = col + 1; row < count; row++) {
      if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
    }
    [matrix[pivot], matrix[col]] = [matrix[col], matrix[pivot]];
    const div = matrix[col][col];
    if (Math.abs(div) < 1e-10) return null;
    for (let j = col; j <= count; j++) matrix[col][j] /= div;
    for (let row = 0; row < count; row++) {
      if (row === col) continue;
      const scale = matrix[row][col];
      for (let j = col; j <= count; j++) matrix[row][j] -= scale * matrix[col][j];
    }
  }

  const coeffs = matrix.map(r => r[count]);
  if (!coeffs.every(Number.isFinite)) return null;
  return { coeffs, validPoints, includeM4: useM4 };
}

export function decomposeResidualHarmonics(
  history: ResidualPoint[],
  anchorTime: Date | string | number,
  lookbackOrOptions: number | HarmonicDecompositionOptions = 48
): DecomposedHarmonicModel {
  const opts: HarmonicDecompositionOptions =
    typeof lookbackOrOptions === 'number'
      ? { lookbackHours: lookbackOrOptions }
      : lookbackOrOptions;
  const lookbackHours = opts.lookbackHours ?? 48;
  const includeM4 = opts.includeM4 ?? true;
  const maxClampFt = opts.maxClampFt ?? 1.5;

  const originMs = new Date(anchorTime).getTime();
  const fallbackAnchor = history?.length ? (history.findLast(p => Number.isFinite(p?.v))?.v ?? 0.5) : 0.5;
  const solved = solveHarmonicCoefficients(history, originMs, lookbackHours, includeM4);

  if (!solved) {
    return {
      harmonicAt: () => 0,
      deltaFromAnchor: () => 0,
      hAnchor: 0,
      subtidalMean: fallbackAnchor,
      sOrigin: fallbackAnchor,
      peakToTroughFt: 0,
      projectSurge: (_t, subtidalTargetFt) =>
        subtidalTargetFt !== undefined && subtidalTargetFt !== null && Number.isFinite(subtidalTargetFt)
          ? subtidalTargetFt
          : fallbackAnchor,
    };
  }

  const { coeffs, validPoints, includeM4: usedM4 } = solved;
  const evalHarmonic = (tMs: number) => {
    const h = (tMs - originMs) / 3600_000;
    let raw =
      coeffs[2] * Math.sin((2 * Math.PI * h) / 12.4206) +
      coeffs[3] * Math.cos((2 * Math.PI * h) / 12.4206) +
      coeffs[4] * Math.sin((2 * Math.PI * h) / 24) +
      coeffs[5] * Math.cos((2 * Math.PI * h) / 24);
    if (usedM4 && coeffs.length >= 8) {
      raw +=
        coeffs[6] * Math.sin((2 * Math.PI * h) / 6.2103) +
        coeffs[7] * Math.cos((2 * Math.PI * h) / 6.2103);
    }
    return Math.max(-maxClampFt, Math.min(maxClampFt, raw));
  };

  const hAnchor = evalHarmonic(originMs);
  const anchorObs = validPoints.at(-1)!.v;
  const subtidalMean = coeffs[0];
  const sOrigin = anchorObs - hAnchor;
  const m2Amp = Math.hypot(coeffs[2], coeffs[3]);
  const s1Amp = Math.hypot(coeffs[4], coeffs[5]);
  const m4Amp = usedM4 && coeffs.length >= 8 ? Math.hypot(coeffs[6], coeffs[7]) : 0;
  const peakToTroughFt = 2 * (m2Amp + s1Amp + m4Amp);

  const harmonicAt = (targetTime: Date | string | number) => {
    const tMs = new Date(targetTime).getTime();
    if (!Number.isFinite(tMs)) return 0;
    return evalHarmonic(tMs);
  };

  const deltaFromAnchor = (targetTime: Date | string | number) => {
    const tMs = new Date(targetTime).getTime();
    if (!Number.isFinite(tMs)) return 0;
    const raw = evalHarmonic(tMs) - hAnchor;
    return Math.max(-maxClampFt, Math.min(maxClampFt, raw));
  };

  const projectSurge = (targetTime: Date | string | number, subtidalTargetFt?: number | null) => {
    const tMs = new Date(targetTime).getTime();
    if (!Number.isFinite(tMs)) return anchorObs;
    const dtHours = Math.max(0, (tMs - originMs) / 3600_000);
    const targetSubtidal =
      subtidalTargetFt !== undefined && subtidalTargetFt !== null && Number.isFinite(subtidalTargetFt)
        ? subtidalTargetFt
        : subtidalMean;
    const alpha = Math.exp(-dtHours / 12);
    const subtidal = targetSubtidal + (sOrigin - targetSubtidal) * alpha;
    return subtidal + evalHarmonic(tMs);
  };

  return {
    harmonicAt,
    deltaFromAnchor,
    hAnchor,
    subtidalMean,
    sOrigin,
    peakToTroughFt,
    projectSurge,
  };
}

export function fitResidualHarmonics(
  history: ResidualPoint[],
  anchorTime: Date | string | number,
  lookbackHours = 48
): (targetTime: Date | string | number) => number {
  return decomposeResidualHarmonics(history, anchorTime, lookbackHours).deltaFromAnchor;
}

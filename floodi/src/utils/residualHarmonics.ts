/**
 * Fits estuarine tidal harmonic components (M2: 12.4206h lunar semi-diurnal, S1: 24h diurnal)
 * from recent observed water level residual points using regularized ridge regression.
 *
 * Carolina Beach (gauge 30046 in Myrtle Grove Sound canal) experiences shallow-water
 * tidal restriction and inlet delays relative to the open-ocean NOAA tide station (8658163).
 * This produces an inherent ~12.4206h semi-diurnal residual wave of ±0.3 to ±0.5 ft.
 *
 * Returns a continuous function mapping any future timestamp to its estuarine harmonic
 * anomaly relative to anchorTime (strictly 0.000 ft at anchorTime).
 */

export interface ResidualPoint {
  t: Date | string | number;
  v: number;
}

export function fitResidualHarmonics(
  history: ResidualPoint[],
  anchorTime: Date | string | number
): (targetTime: Date | string | number) => number {
  if (!history || history.length < 12) {
    return () => 0;
  }
  const count = 6;
  const matrix = Array.from({ length: count }, () => Array(count + 1).fill(0));
  const origin = new Date(anchorTime).getTime();

  const cols = (tMs: number) => {
    const h = (tMs - origin) / 3600_000;
    return [
      1,
      h / 72,
      Math.sin(2 * Math.PI * h / 12.4206),
      Math.cos(2 * Math.PI * h / 12.4206),
      Math.sin(2 * Math.PI * h / 24),
      Math.cos(2 * Math.PI * h / 24),
    ];
  };

  for (const pt of history) {
    if (!Number.isFinite(pt.v)) continue;
    const tMs = new Date(pt.t).getTime();
    if (!Number.isFinite(tMs)) continue;
    const x = cols(tMs);
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < count; j++) matrix[i][j] += x[i] * x[j];
      matrix[i][count] += x[i] * pt.v;
    }
  }

  // Ridge regularization for numerical stability
  for (let i = 2; i < count; i++) matrix[i][i] += 0.05;

  // Gaussian elimination with partial pivoting
  for (let col = 0; col < count; col++) {
    let pivot = col;
    for (let row = col + 1; row < count; row++) {
      if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
    }
    [matrix[pivot], matrix[col]] = [matrix[col], matrix[pivot]];
    const div = matrix[col][col];
    if (Math.abs(div) < 1e-10) return () => 0;
    for (let j = col; j <= count; j++) matrix[col][j] /= div;
    for (let row = 0; row < count; row++) {
      if (row === col) continue;
      const scale = matrix[row][col];
      for (let j = col; j <= count; j++) matrix[row][j] -= scale * matrix[col][j];
    }
  }

  const coeffs = matrix.map(r => r[count]);
  if (!coeffs.every(Number.isFinite)) return () => 0;

  const harmonicAt = (tMs: number) => {
    const x = cols(tMs);
    return x.slice(2).reduce((s, v, i) => s + v * coeffs[i + 2], 0);
  };

  const hAnchor = harmonicAt(origin);

  return (targetTime: Date | string | number) => {
    const tMs = new Date(targetTime).getTime();
    if (!Number.isFinite(tMs)) return 0;
    const raw = harmonicAt(tMs) - hAnchor;
    // Bounded within physical canal anomaly range [-1.2 ft, +1.2 ft]
    return Math.max(-1.2, Math.min(1.2, raw));
  };
}

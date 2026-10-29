/**
 * Multi-Regime Coastal & Estuarine Basin Physics Engine
 *
 * Pure, runtime-agnostic TypeScript module shared between Cloud Functions and Frontend.
 * Models local water level at site x relative to reference NOAA harmonic station r:
 *
 *   eta_x(t) = T_r(t - phase) + S_ocean(t) + dS_basin(tau_axial, tau_onshore, dH_river, P_rain) + H_estuarine(t; M2, S1, M4)
 *
 * Supports four physical coastal regimes via site configuration:
 *   1. 'back-barrier-lagoon'    (e.g., Carolina Beach NC, Beaufort NC, Garden City / Murrells Inlet SC)
 *   2. 'open-coast'             (e.g., Wrightsville Beach NC, Kingfisher Pier SC)
 *   3. 'wind-lagoon'            (e.g., New Bern / Neuse-Pamlico Sound NC)
 *   4. 'compound-river-estuary' (e.g., Wilmington / Cape Fear NC, Charleston SC, Savannah GA)
 */

export type CoastalRegime =
  | 'back-barrier-lagoon'
  | 'open-coast'
  | 'wind-lagoon'
  | 'compound-river-estuary';

export interface BasinPhysicsSpec {
  locationId: string;
  regime: CoastalRegime;
  /** Bearing (deg from North, meteorological "coming FROM") that maximizes axial sound/estuary trapping */
  axialFetchBearingDeg: number;
  /** Bearing (deg from North) that maximizes coastal Ekman / onshore ocean setup */
  onshoreEkmanBearingDeg: number;
  /** Extra local basin amplification weight per unit axial wind stress (W/20)^2 * cos(dir - axial) */
  localAxialWindWeightFt: number;
  /** Direct subtidal wind surge weight when NOAA ETSS guidance is unavailable (>102h or wind-lagoon) */
  extendedAxialWindWeightFt: number;
  /** Direct subtidal onshore Ekman weight when NOAA ETSS guidance is unavailable */
  extendedOnshoreWindWeightFt: number;
  /** Inverse barometer response (ft per 10 hPa pressure drop below 1013.25 hPa; theoretical = 0.33) */
  inverseBarometerWeightFtPer10Hpa: number;
  /** Hydraulic coupling ratio [0..1] to river-mouth ETSS head (S_river - S_ocean), e.g. 0.24 across Snow's Cut */
  riverHeadCouplingWeight: number;
  /** Upstream USGS excess discharge response (ft per 10,000 cfs above baseflowCfs) */
  usgsExcessFlowWeightFtPer10kCfs: number;
  usgsBaseflowCfs: number;
  usgsTravelLagHours: number;
  /** Short-window (6h) rainfall stormwater runoff response (ft per inch of 6h rain) */
  rainfallRunoffWeightFtPerInch6h: number;
  /** Estuarine harmonic configuration */
  harmonics: {
    lookbackHours: number;
    includeM4: boolean;
    maxClampFt: number;
  };
}

/**
 * Empirically calibrated & out-of-sample backtest-verified specification for Carolina Beach, NC
 * (Myrtle Grove Sound / Yacht Basin / Canal Dr, connected to Cape Fear River via Snow's Cut).
 */
export const CAROLINA_BEACH_BASIN_SPEC: BasinPhysicsSpec = {
  locationId: 'carolina-beach',
  regime: 'back-barrier-lagoon',
  axialFetchBearingDeg: 25,       // NNE wind down Myrtle Grove Sound straight into CB Yacht Basin
  onshoreEkmanBearingDeg: 70,     // ENE along-shelf Ekman transport
  localAxialWindWeightFt: 0.08,   // Extra local basin trapping above open-ocean Wrightsville ETSS
  extendedAxialWindWeightFt: 0.95,// Full NNE wind setup for Days 5-16 beyond 102h ETSS window
  extendedOnshoreWindWeightFt: 0.24,
  inverseBarometerWeightFtPer10Hpa: 0.30,
  riverHeadCouplingWeight: 0.24,  // Empirical 24% Wilmington Cape Fear / 76% Wrightsville Ocean across Snow's Cut
  usgsExcessFlowWeightFtPer10kCfs: 0.06,
  usgsBaseflowCfs: 1500,
  usgsTravelLagHours: 18,
  rainfallRunoffWeightFtPerInch6h: 0.08,
  harmonics: {
    lookbackHours: 48,
    includeM4: true,
    maxClampFt: 1.5,
  },
};

/** Multi-region presets demonstrating plug-and-play extensibility across all four coastal regimes */
export const MULTI_REGION_BASIN_SPECS: Record<string, BasinPhysicsSpec> = {
  'carolina-beach': CAROLINA_BEACH_BASIN_SPEC,
  'beaufort-nc': {
    locationId: 'beaufort-nc',
    regime: 'back-barrier-lagoon',
    axialFetchBearingDeg: 40, // NE wind down Core / Back Sound into Taylor's Creek
    onshoreEkmanBearingDeg: 110,
    localAxialWindWeightFt: 0.12,
    extendedAxialWindWeightFt: 0.75,
    extendedOnshoreWindWeightFt: 0.25,
    inverseBarometerWeightFtPer10Hpa: 0.32,
    riverHeadCouplingWeight: 0,
    usgsExcessFlowWeightFtPer10kCfs: 0,
    usgsBaseflowCfs: 0,
    usgsTravelLagHours: 0,
    rainfallRunoffWeightFtPerInch6h: 0.14, // Front St gravity storm-drain backup at high tide
    harmonics: { lookbackHours: 48, includeM4: true, maxClampFt: 1.2 },
  },
  'garden-city-sc': {
    locationId: 'garden-city-sc',
    regime: 'back-barrier-lagoon',
    axialFetchBearingDeg: 45, // NE wind into Murrells Inlet marsh lagoon
    onshoreEkmanBearingDeg: 95,
    localAxialWindWeightFt: 0.10,
    extendedAxialWindWeightFt: 0.85,
    extendedOnshoreWindWeightFt: 0.30,
    inverseBarometerWeightFtPer10Hpa: 0.32,
    riverHeadCouplingWeight: 0,
    usgsExcessFlowWeightFtPer10kCfs: 0,
    usgsBaseflowCfs: 0,
    usgsTravelLagHours: 0,
    rainfallRunoffWeightFtPerInch6h: 0.10,
    harmonics: { lookbackHours: 48, includeM4: true, maxClampFt: 1.8 }, // Mesotidal 5.0-6.5+ ft range
  },
  'new-bern-nc': {
    locationId: 'new-bern-nc',
    regime: 'wind-lagoon',
    axialFetchBearingDeg: 115, // ESE wind up 35-mile Neuse River / Pamlico Sound fetch
    onshoreEkmanBearingDeg: 75,
    localAxialWindWeightFt: 0.45,
    extendedAxialWindWeightFt: 1.45, // Wind seiche dominates 90%+ of variance
    extendedOnshoreWindWeightFt: 0.40,
    inverseBarometerWeightFtPer10Hpa: 0.30,
    riverHeadCouplingWeight: 0.35,
    usgsExcessFlowWeightFtPer10kCfs: 0.22, // Neuse River USGS 02091814 Fort Barnwell
    usgsBaseflowCfs: 2500,
    usgsTravelLagHours: 24,
    rainfallRunoffWeightFtPerInch6h: 0.12,
    harmonics: { lookbackHours: 48, includeM4: false, maxClampFt: 0.6 },
  },
  'wilmington-nc': {
    locationId: 'wilmington-nc',
    regime: 'compound-river-estuary',
    axialFetchBearingDeg: 185, // S/SSW wind pushing up Cape Fear River channel + NE ocean setup
    onshoreEkmanBearingDeg: 55,
    localAxialWindWeightFt: 0.12,
    extendedAxialWindWeightFt: 0.65,
    extendedOnshoreWindWeightFt: 0.55,
    inverseBarometerWeightFtPer10Hpa: 0.30,
    riverHeadCouplingWeight: 1.0, // Direct ncwilm river ETSS station
    usgsExcessFlowWeightFtPer10kCfs: 0.28, // Direct Cape Fear River Lock #1 discharge
    usgsBaseflowCfs: 1500,
    usgsTravelLagHours: 14,
    rainfallRunoffWeightFtPerInch6h: 0.12,
    harmonics: { lookbackHours: 48, includeM4: true, maxClampFt: 1.6 },
  },
  'charleston-sc': {
    locationId: 'charleston-sc',
    regime: 'compound-river-estuary',
    axialFetchBearingDeg: 65, // ENE/NE wind into Charleston Harbor (Ashley/Cooper confluence)
    onshoreEkmanBearingDeg: 90,
    localAxialWindWeightFt: 0.14,
    extendedAxialWindWeightFt: 0.95,
    extendedOnshoreWindWeightFt: 0.35,
    inverseBarometerWeightFtPer10Hpa: 0.32,
    riverHeadCouplingWeight: 1.0,
    usgsExcessFlowWeightFtPer10kCfs: 0.18,
    usgsBaseflowCfs: 3000,
    usgsTravelLagHours: 18,
    rainfallRunoffWeightFtPerInch6h: 0.15,
    harmonics: { lookbackHours: 48, includeM4: true, maxClampFt: 1.8 },
  },
  'savannah-ga': {
    locationId: 'savannah-ga',
    regime: 'compound-river-estuary',
    axialFetchBearingDeg: 75, // ENE wind into Savannah River entrance / Fort Pulaski
    onshoreEkmanBearingDeg: 100,
    localAxialWindWeightFt: 0.15,
    extendedAxialWindWeightFt: 1.05,
    extendedOnshoreWindWeightFt: 0.35,
    inverseBarometerWeightFtPer10Hpa: 0.32,
    riverHeadCouplingWeight: 1.0,
    usgsExcessFlowWeightFtPer10kCfs: 0.20,
    usgsBaseflowCfs: 6500,
    usgsTravelLagHours: 30,
    rainfallRunoffWeightFtPerInch6h: 0.12,
    harmonics: { lookbackHours: 48, includeM4: true, maxClampFt: 2.0 }, // Macro/mesotidal ~6.9 ft range
  },
};

export interface SurgeDriversBreakdown {
  /** Regional ocean storm surge + baseline subtidal sea level anomaly (ft) */
  oceanSurgeFt: number;
  /** Directional wind-fetch basin trapping & barometric setup (ft) */
  windSetupFt: number;
  /** Upstream river hydraulic head / Snow's Cut backwater & USGS discharge (ft) */
  riverFlowFt: number;
  /** Local rainfall stormwater runoff contribution (ft) */
  rainfallRunoffFt: number;
  /** Localized M2 + S1 + M4 shallow-water estuarine tidal harmonic wave (ft) */
  estuarineHarmonicFt: number;
}

export interface BasinWeatherSample {
  t: Date | string | number;
  windSpeedMph?: number;
  windDirectionDeg?: number;
  pressureHpa?: number;
  precipIn?: number;
}

export interface TimeValueSample {
  t: Date | string | number;
  v: number;
}

export interface SynthesizedForecastPoint {
  t: string;
  totalFt: number;
  tideFt: number;
  residualFt: number;
  noaaSurgeFt?: number;
  riverSurgeFt?: number;
  lowerFt: number;
  upperFt: number;
  windSpeedMph?: number;
  windDirectionDeg?: number;
  precipIn?: number;
  drivers: SurgeDriversBreakdown;
}

const DEG_TO_RAD = Math.PI / 180;
const HALF_M2_MS = 6.2103 * 3600_000;

/**
 * Computes normalized quadratic directional wind stress:
 *   tau = (clamp(W, 0, 95) / 20)^2 * cos(windDir - targetBearing)
 * Bounded and NaN-safe; 20 mph dead-on wind yields tau = +1.0, opposite wind yields -1.0.
 */
export function directionalWindStress(
  windSpeedMph: number | undefined | null,
  windDirectionDeg: number | undefined | null,
  targetBearingDeg: number
): number {
  if (
    typeof windSpeedMph !== 'number' ||
    !Number.isFinite(windSpeedMph) ||
    windSpeedMph <= 0 ||
    typeof windDirectionDeg !== 'number' ||
    !Number.isFinite(windDirectionDeg)
  ) {
    return 0;
  }
  const clampedW = Math.min(95, Math.max(0, windSpeedMph));
  const projection = Math.cos((windDirectionDeg - targetBearingDeg) * DEG_TO_RAD);
  const stress = Math.pow(clampedW / 20, 2) * projection;
  return Math.max(-4.5, Math.min(4.5, stress));
}

function toSortedMsSeries(samples: TimeValueSample[]): Array<{ tMs: number; v: number }> {
  const out: Array<{ tMs: number; v: number }> = [];
  for (const s of samples || []) {
    if (!s || typeof s.v !== 'number' || !Number.isFinite(s.v)) continue;
    const tMs = new Date(s.t).getTime();
    if (Number.isFinite(tMs)) out.push({ tMs, v: s.v });
  }
  out.sort((a, b) => a.tMs - b.tMs);
  return out;
}

function linearInterpMs(
  sorted: Array<{ tMs: number; v: number }>,
  tMs: number,
  maxGapMs = 3 * 3600_000
): number | null {
  if (!sorted.length || !Number.isFinite(tMs)) return null;
  if (tMs < sorted[0].tMs || tMs > sorted[sorted.length - 1].tMs) return null;
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].tMs === tMs) return sorted[mid].v;
    if (sorted[mid].tMs < tMs) lo = mid + 1;
    else hi = mid - 1;
  }
  const a = sorted[hi];
  const b = sorted[lo];
  if (!a || !b || b.tMs - a.tMs > maxGapMs) return null;
  if (b.tMs === a.tMs) return a.v;
  return a.v + ((tMs - a.tMs) / (b.tMs - a.tMs)) * (b.v - a.v);
}

/**
 * Boxcar-averages a storm surge series over one M2 tidal period (12.4206h)
 * to remove 0.1-ft quantization steps and residual tidal leakage from NOAA ETSS tables.
 */
export function smoothSubtidalSeries(samples: TimeValueSample[]): Array<{ tMs: number; v: number }> {
  const sorted = toSortedMsSeries(samples);
  if (!sorted.length) return [];
  return sorted.map(pt => {
    let sum = 0;
    let count = 0;
    for (const s of sorted) {
      if (Math.abs(s.tMs - pt.tMs) <= HALF_M2_MS) {
        sum += s.v;
        count++;
      }
    }
    return { tMs: pt.tMs, v: count > 0 ? sum / count : pt.v };
  });
}

/**
 * Fits 48-hour M2 (12.4206h) + S1 (24h) + M4 (6.2103h) estuarine harmonics.
 */
export function fitBasinHarmonics(
  residualHistory: TimeValueSample[],
  originMs: number,
  options: { lookbackHours?: number; includeM4?: boolean; maxClampFt?: number } = {}
): {
  subtidalMean: number;
  sOrigin: number;
  anchorObs: number;
  evalHarmonic: (tMs: number) => number;
} {
  const lookbackHours = options.lookbackHours ?? 48;
  const includeM4 = options.includeM4 ?? true;
  const maxClampFt = options.maxClampFt ?? 1.5;

  const sorted = toSortedMsSeries(residualHistory).filter(p => p.tMs <= originMs + 60_000);
  const fallback = sorted.length ? sorted[sorted.length - 1].v : 0.5;
  if (sorted.length < 12 || !Number.isFinite(originMs)) {
    return {
      subtidalMean: fallback,
      sOrigin: fallback,
      anchorObs: fallback,
      evalHarmonic: () => 0,
    };
  }

  const windowStart = originMs - lookbackHours * 3600_000;
  const recent = sorted.filter(p => p.tMs >= windowStart);
  const pts = recent.length >= 12 ? recent : sorted.slice(-Math.min(sorted.length, 96));
  const useM4 = includeM4 && pts.length >= 16;
  const count = useM4 ? 8 : 6;
  const mat = Array.from({ length: count }, () => Array(count + 1).fill(0));

  const cols = (tMs: number) => {
    const h = (tMs - originMs) / 3600_000;
    const r = [
      1,
      h / 72,
      Math.sin((2 * Math.PI * h) / 12.4206),
      Math.cos((2 * Math.PI * h) / 12.4206),
      Math.sin((2 * Math.PI * h) / 24),
      Math.cos((2 * Math.PI * h) / 24),
    ];
    if (useM4) {
      r.push(Math.sin((2 * Math.PI * h) / 6.2103), Math.cos((2 * Math.PI * h) / 6.2103));
    }
    return r;
  };

  for (const pt of pts) {
    const x = cols(pt.tMs);
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < count; j++) mat[i][j] += x[i] * x[j];
      mat[i][count] += x[i] * pt.v;
    }
  }
  mat[1][1] += 5.0;
  for (let i = 2; i < count; i++) mat[i][i] += i >= 6 ? 0.5 : 0.05;

  for (let col = 0; col < count; col++) {
    let piv = col;
    for (let row = col + 1; row < count; row++) {
      if (Math.abs(mat[row][col]) > Math.abs(mat[piv][col])) piv = row;
    }
    [mat[piv], mat[col]] = [mat[col], mat[piv]];
    const div = mat[col][col];
    if (Math.abs(div) < 1e-10) {
      return { subtidalMean: fallback, sOrigin: fallback, anchorObs: fallback, evalHarmonic: () => 0 };
    }
    for (let j = col; j <= count; j++) mat[col][j] /= div;
    for (let row = 0; row < count; row++) {
      if (row === col) continue;
      const sc = mat[row][col];
      for (let j = col; j <= count; j++) mat[row][j] -= sc * mat[col][j];
    }
  }

  const coeffs = mat.map(r => r[count]);
  if (!coeffs.every(Number.isFinite)) {
    return { subtidalMean: fallback, sOrigin: fallback, anchorObs: fallback, evalHarmonic: () => 0 };
  }

  const evalHarmonic = (tMs: number) => {
    if (!Number.isFinite(tMs)) return 0;
    const h = (tMs - originMs) / 3600_000;
    let raw =
      coeffs[2] * Math.sin((2 * Math.PI * h) / 12.4206) +
      coeffs[3] * Math.cos((2 * Math.PI * h) / 12.4206) +
      coeffs[4] * Math.sin((2 * Math.PI * h) / 24) +
      coeffs[5] * Math.cos((2 * Math.PI * h) / 24);
    if (useM4 && coeffs.length >= 8) {
      raw +=
        coeffs[6] * Math.sin((2 * Math.PI * h) / 6.2103) +
        coeffs[7] * Math.cos((2 * Math.PI * h) / 6.2103);
    }
    return Math.max(-maxClampFt, Math.min(maxClampFt, raw));
  };

  const anchorObs = pts[pts.length - 1].v;
  const hOrigin = evalHarmonic(originMs);
  return {
    subtidalMean: coeffs[0],
    sOrigin: anchorObs - hOrigin,
    anchorObs,
    evalHarmonic,
  };
}

export interface SynthesizeOperationalForecastInput {
  spec?: BasinPhysicsSpec;
  issuedAt: Date | string | number;
  /** Recent 48h+ observed gauge-minus-tide residual series */
  recentResidual: TimeValueSample[];
  /** Future (and recent) phase-aligned astronomical tide predictions across the full 21-day horizon */
  tide: TimeValueSample[];
  /** Primary regional NOAA ETSS storm surge guidance (e.g. Wrightsville Beach ncwrit) */
  oceanEtss?: TimeValueSample[];
  /** Secondary river-mouth NOAA ETSS surge guidance (e.g. Wilmington Cape Fear River ncwilm) */
  riverEtss?: TimeValueSample[];
  /** Upstream USGS river discharge (ft^3/s) observations (e.g. Lock #1 02105769) */
  usgsDischargeCfs?: TimeValueSample[];
  /** Past + future hourly weather telemetry (windSpeedMph, windDirectionDeg, pressureHpa, precipIn) */
  weather?: BasinWeatherSample[];
  /** Optional de-harmonized subtidal AI predictions from TimesFM-3 (30-min or hourly steps) */
  timesFmSubtidal?: TimeValueSample[];
  /** Optional TimesFM quantile half-spreads (uncertainty ft) */
  timesFmSpread?: TimeValueSample[];
}

/**
 * Synthesizes a single authoritative, physically consistent operational forecast across the full
 * astronomical tide horizon (up to 21 days) with lossless per-point physical driver attribution.
 */
export function synthesizeOperationalForecast(
  input: SynthesizeOperationalForecastInput
): SynthesizedForecastPoint[] {
  const spec = input.spec ?? CAROLINA_BEACH_BASIN_SPEC;
  const originMs = new Date(input.issuedAt).getTime();
  if (!Number.isFinite(originMs)) return [];

  const sortedTide = toSortedMsSeries(input.tide).filter(p => p.tMs >= originMs);
  if (!sortedTide.length) return [];

  // 1. Decompose 48h observed residual into subtidal baseline + M2/S1/M4 estuarine harmonics
  const harmonics = fitBasinHarmonics(input.recentResidual, originMs, spec.harmonics);

  // 2. Smooth discrete 0.1-ft NOAA ETSS ocean & river surge curves over 12.42h M2 period
  const oceanSub = smoothSubtidalSeries(input.oceanEtss ?? []);
  const riverSub = smoothSubtidalSeries(input.riverEtss ?? []);
  const tfmSub = toSortedMsSeries(input.timesFmSubtidal ?? []);
  const tfmSpread = toSortedMsSeries(input.timesFmSpread ?? []);
  const usgsQ = toSortedMsSeries(input.usgsDischargeCfs ?? []);

  const oceanAtOrigin =
    linearInterpMs(oceanSub, originMs, 6 * 3600_000) ??
    (oceanSub.length && Math.abs(oceanSub[0].tMs - originMs) <= 6 * 3600_000 ? oceanSub[0].v : null);
  const riverAtOrigin =
    linearInterpMs(riverSub, originMs, 6 * 3600_000) ??
    (riverSub.length && Math.abs(riverSub[0].tMs - originMs) <= 6 * 3600_000 ? riverSub[0].v : null);

  // Latest known USGS excess discharge (decays gently over 72h in future when river forecast isn't issued)
  const latestQ = usgsQ.length ? usgsQ[usgsQ.length - 1].v : spec.usgsBaseflowCfs;

  // 3. Pre-index weather onto sorted ms array for trailing 6h wind-stress & rain integration
  const sortedWeather = (input.weather ?? [])
    .map(w => ({
      tMs: new Date(w.t).getTime(),
      wSpd: typeof w.windSpeedMph === 'number' && Number.isFinite(w.windSpeedMph) ? Math.max(0, w.windSpeedMph) : undefined,
      wDir: typeof w.windDirectionDeg === 'number' && Number.isFinite(w.windDirectionDeg) ? w.windDirectionDeg : undefined,
      press: typeof w.pressureHpa === 'number' && Number.isFinite(w.pressureHpa) ? w.pressureHpa : undefined,
      precip: typeof w.precipIn === 'number' && Number.isFinite(w.precipIn) ? Math.max(0, w.precipIn) : 0,
    }))
    .filter(w => Number.isFinite(w.tMs))
    .sort((a, b) => a.tMs - b.tMs);

  const weatherWindowStats = (targetMs: number) => {
    if (!sortedWeather.length) {
      return { tauAxial: 0, tauOnshore: 0, invBaro10: 0, rain6h: 0, nearest: null as (typeof sortedWeather)[0] | null };
    }
    const winStart = targetMs - 6 * 3600_000;
    let sumAxial = 0;
    let sumOnshore = 0;
    let sumBaro = 0;
    let wCount = 0;
    let rain6h = 0;
    let nearest: (typeof sortedWeather)[0] | null = null;
    let nearestDist = Infinity;

    for (const w of sortedWeather) {
      const dist = Math.abs(w.tMs - targetMs);
      if (dist < nearestDist && dist <= 3 * 3600_000) {
        nearestDist = dist;
        nearest = w;
      }
      if (w.tMs >= winStart && w.tMs <= targetMs + 1800_000) {
        if (w.wSpd !== undefined && w.wDir !== undefined) {
          sumAxial += directionalWindStress(w.wSpd, w.wDir, spec.axialFetchBearingDeg);
          sumOnshore += directionalWindStress(w.wSpd, w.wDir, spec.onshoreEkmanBearingDeg);
          wCount++;
        }
        if (w.press !== undefined) {
          sumBaro += (1013.25 - w.press) / 10;
        }
        rain6h += w.precip;
      }
    }
    if (wCount === 0 && nearest && nearest.wSpd !== undefined && nearest.wDir !== undefined) {
      sumAxial = directionalWindStress(nearest.wSpd, nearest.wDir, spec.axialFetchBearingDeg);
      sumOnshore = directionalWindStress(nearest.wSpd, nearest.wDir, spec.onshoreEkmanBearingDeg);
      sumBaro = nearest.press !== undefined ? (1013.25 - nearest.press) / 10 : 0;
      wCount = 1;
    }
    return {
      tauAxial: wCount > 0 ? sumAxial / wCount : 0,
      tauOnshore: wCount > 0 ? sumOnshore / wCount : 0,
      invBaro10: wCount > 0 ? sumBaro / wCount : 0,
      rain6h: Math.min(8, rain6h),
      nearest,
    };
  };

  const originWeather = weatherWindowStats(originMs);
  const originLagQ =
    linearInterpMs(usgsQ, originMs - spec.usgsTravelLagHours * 3600_000, 12 * 3600_000) ?? latestQ;
  const originQExcess10k = Math.max(0, (originLagQ - spec.usgsBaseflowCfs) / 10_000);
  const originRiverHeadDelta =
    riverAtOrigin !== null && oceanAtOrigin !== null ? Math.max(-0.6, Math.min(2.5, riverAtOrigin - oceanAtOrigin)) : 0;
  const originRiverFt =
    spec.riverHeadCouplingWeight * originRiverHeadDelta + spec.usgsExcessFlowWeightFtPer10kCfs * originQExcess10k;
  const originLocalWindFt = spec.localAxialWindWeightFt * originWeather.tauAxial;
  const originRainFt = spec.rainfallRunoffWeightFtPerInch6h * originWeather.rain6h;

  const oceanMaxMs = oceanSub.length ? oceanSub[oceanSub.length - 1].tMs : -Infinity;
  const weatherMaxMs = sortedWeather.length ? sortedWeather[sortedWeather.length - 1].tMs : -Infinity;

  const out: SynthesizedForecastPoint[] = [];

  for (const tp of sortedTide) {
    const tMs = tp.tMs;
    const dtHours = Math.max(0, (tMs - originMs) / 3600_000);
    const alpha = Math.exp(-dtHours / 12); // 12h anchor continuity relaxation

    const wStats = weatherWindowStats(tMs);
    const hEstuarine = harmonics.evalHarmonic(tMs);

    // Upstream USGS discharge with travel lag (relaxes toward baseflow over 96h into future)
    const laggedMs = tMs - spec.usgsTravelLagHours * 3600_000;
    const histLagQ = linearInterpMs(usgsQ, laggedMs, 12 * 3600_000);
    const futureDecay = Math.exp(-Math.max(0, (laggedMs - originMs) / 3600_000) / 96);
    const effectiveQ = histLagQ !== null ? histLagQ : spec.usgsBaseflowCfs + (latestQ - spec.usgsBaseflowCfs) * futureDecay;
    const qExcess10k = Math.max(0, (effectiveQ - spec.usgsBaseflowCfs) / 10_000);

    const oceanVal = linearInterpMs(oceanSub, tMs, 3 * 3600_000);
    const riverVal = linearInterpMs(riverSub, tMs, 3 * 3600_000);
    const tfmVal = linearInterpMs(tfmSub, tMs, 2 * 3600_000);

    let oceanComponentFt: number;
    let windComponentFt: number;
    let riverComponentFt: number;
    let rainComponentFt: number;

    if (oceanVal !== null && oceanAtOrigin !== null) {
      // REGIME A (0 - 102h): NOAA Hydrodynamic Ocean ETSS + Cape Fear River ETSS/USGS Head + N/NE Basin Trapping + Rain
      const oceanDelta = oceanVal - oceanAtOrigin;
      const riverHeadDelta =
        riverVal !== null ? Math.max(-0.6, Math.min(2.5, riverVal - oceanVal)) : originRiverHeadDelta * Math.exp(-dtHours / 48);
      const rawRiverFt =
        spec.riverHeadCouplingWeight * riverHeadDelta + spec.usgsExcessFlowWeightFtPer10kCfs * qExcess10k;
      const rawWindFt = spec.localAxialWindWeightFt * wStats.tauAxial;
      const rawRainFt = spec.rainfallRunoffWeightFtPerInch6h * wStats.rain6h;

      // Relative anomalies from origin so t=0 starts seamlessly at observed sOrigin
      const dRiver = (rawRiverFt - originRiverFt) * (1 - alpha);
      const dWind = (rawWindFt - originLocalWindFt) * (1 - alpha);
      const dRain = (rawRainFt - originRainFt) * (1 - alpha);

      // Subtle 15% blend with de-harmonized TimesFM anomaly if available and bounded
      const baseOceanTarget = harmonics.subtidalMean + oceanDelta;
      const blendedOceanTarget =
        tfmVal !== null && Math.abs(tfmVal - baseOceanTarget) <= 1.2
          ? 0.85 * baseOceanTarget + 0.15 * tfmVal
          : baseOceanTarget;

      oceanComponentFt = blendedOceanTarget + (harmonics.sOrigin - blendedOceanTarget) * alpha;
      windComponentFt = dWind;
      riverComponentFt = dRiver;
      rainComponentFt = dRain;
    } else if (tMs <= weatherMaxMs && sortedWeather.length > 0) {
      // REGIME B (Days 5 - 16, Beyond 102h ETSS): Directional N/NE Wind-Fetch + ENE Ekman + Barometer + River + Rain
      const hoursPastEtss = oceanMaxMs > originMs ? Math.max(0, (tMs - oceanMaxMs) / 3600_000) : dtHours;
      const bridgeWeight = Math.min(1, hoursPastEtss / 12);

      // Continuity anchor from end of ETSS if ETSS existed
      const etssEndDelta =
        oceanSub.length && oceanAtOrigin !== null ? oceanSub[oceanSub.length - 1].v - oceanAtOrigin : 0;
      const etssEndLevel = harmonics.subtidalMean + etssEndDelta * Math.exp(-hoursPastEtss / 48);

      const weatherWindDelta =
        spec.extendedAxialWindWeightFt * (wStats.tauAxial - originWeather.tauAxial * 0.3) +
        spec.extendedOnshoreWindWeightFt * (wStats.tauOnshore - originWeather.tauOnshore * 0.3) +
        spec.inverseBarometerWeightFtPer10Hpa * wStats.invBaro10;
      // Damp weather-driven surge amplitude slightly at ultra-long leads (>10 days) for forecast skill realism
      const leadDamp = Math.exp(-Math.max(0, dtHours - 120) / 240);

      oceanComponentFt = etssEndLevel + (harmonics.sOrigin - etssEndLevel) * alpha;
      windComponentFt = Math.max(-1.2, Math.min(2.2, weatherWindDelta * leadDamp * bridgeWeight)) * (1 - alpha);
      riverComponentFt = (spec.usgsExcessFlowWeightFtPer10kCfs * qExcess10k) * (1 - alpha);
      rainComponentFt = (spec.rainfallRunoffWeightFtPerInch6h * wStats.rain6h * leadDamp) * (1 - alpha);
    } else {
      // REGIME C (Days 16 - 21, Astronomical Tide + Estuarine Harmonics + Seasonal Subtidal Baseline)
      oceanComponentFt = harmonics.subtidalMean + (harmonics.sOrigin - harmonics.subtidalMean) * alpha;
      windComponentFt = 0;
      riverComponentFt = 0;
      rainComponentFt = 0;
    }

    const r3 = (x: number) => Math.round(x * 1000) / 1000;
    const dOcean = r3(oceanComponentFt);
    const dWind = r3(windComponentFt);
    const dRiver = r3(riverComponentFt);
    const dRain = r3(rainComponentFt);
    const dHarm = r3(hEstuarine);

    // Lossless driver sum: residualFt equals the exact sum of the 5 physical drivers
    const residualFt = r3(dOcean + dWind + dRiver + dRain + dHarm);
    const tideFt = r3(tp.v);
    const totalFt = r3(tideFt + residualFt);

    // Calibrated uncertainty growth with lead time
    const rawSpread = linearInterpMs(tfmSpread, tMs, 3 * 3600_000);
    const spread =
      rawSpread !== null && rawSpread > 0.15
        ? Math.min(1.25, Math.max(0.22, rawSpread))
        : Math.min(1.25, 0.22 + 0.0035 * dtHours);

    out.push({
      t: new Date(tMs).toISOString(),
      totalFt,
      tideFt,
      residualFt,
      ...(oceanVal !== null ? { noaaSurgeFt: r3(oceanVal) } : {}),
      ...(riverVal !== null ? { riverSurgeFt: r3(riverVal) } : {}),
      lowerFt: r3(totalFt - spread),
      upperFt: r3(totalFt + spread),
      ...(wStats.nearest?.wSpd !== undefined ? { windSpeedMph: Math.round(wStats.nearest.wSpd * 10) / 10 } : {}),
      ...(wStats.nearest?.wDir !== undefined ? { windDirectionDeg: Math.round(wStats.nearest.wDir) } : {}),
      ...(wStats.nearest ? { precipIn: Math.round(wStats.nearest.precip * 100) / 100 } : {}),
      drivers: {
        oceanSurgeFt: dOcean,
        windSetupFt: dWind,
        riverFlowFt: dRiver,
        rainfallRunoffFt: dRain,
        estuarineHarmonicFt: dHarm,
      },
    });
  }

  return out;
}


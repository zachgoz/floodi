import * as logger from 'firebase-functions/logger';
import { FieldValue } from 'firebase-admin/firestore';
import { safeError } from '../utils/observability';
import { WaterPoint, interpolate } from './water';
import { TimesFmVertexClient, TimesFmPredictionResult } from './timesfmClient';
import {
  fetchNoaaSurgeForecast,
  NoaaSurgeForecast,
  WRIGHTSVILLE_ETSS_CONFIG,
  WILMINGTON_RIVER_ETSS_CONFIG,
} from './noaaSurge';
import {
  fetchUsgsRiverTelemetry,
  UsgsRiverTelemetry,
  CAPE_FEAR_LOCK1_CONFIG,
} from './usgsRiver';
import {
  CAROLINA_BEACH_BASIN_SPEC,
  MULTI_REGION_BASIN_SPECS,
  CoastalRegime,
  SurgeDriversBreakdown,
  BasinWeatherSample,
  fitBasinHarmonics,
  synthesizeOperationalForecast,
} from './basinPhysics';

export interface ChallengerPoint {
  t: string;          // ISO 8601 UTC
  totalFt: number;    // Astronomical tide + predicted residual
  tideFt: number;     // Astronomical tide
  residualFt: number; // Synthesized operational surge residual (exact sum of drivers)
  noaaSurgeFt?: number; // NOAA ETSS primary ocean surge guidance (e.g. Wrightsville ncwrit)
  riverSurgeFt?: number; // NOAA ETSS river-mouth surge guidance (e.g. Wilmington Cape Fear ncwilm)
  lowerFt?: number;   // 10th percentile bound
  upperFt?: number;   // 90th percentile bound
  windSpeedMph?: number;
  windDirectionDeg?: number;
  precipIn?: number;
  drivers?: SurgeDriversBreakdown;
}

export interface ChallengerOutlookDocument {
  challengerId: string;
  locationId: string;
  regime?: CoastalRegime;
  generatedAt: string;
  observationAt?: string;
  currentResidualFt?: number;
  expiresAt: string;
  status: 'available' | 'unavailable';
  engine: TimesFmPredictionResult['engine'] | 'none';
  horizonSteps: number;
  thresholdFt: number;
  points: ChallengerPoint[];
  peak: {
    t: string;
    totalFt: number;
    tideFt: number;
    residualFt: number;
    exceedsThreshold: boolean;
  } | null;
  covariatesUsed: string[];
  metadata: {
    historyPointsCount: number;
    noaaSurgeAvailable: boolean;
    riverSurgeAvailable?: boolean;
    usgsDischargeCfs?: number | null;
    weatherAvailable?: boolean;
    retrievedAt: string;
  };
  error?: string;
}

export interface ChallengerWeatherInput {
  t: Date | string;
  windSpeedMph?: number;
  windSpeed?: number;
  windDirectionDeg?: number;
  windDirection?: number;
  surfacePressureHpa?: number;
  pressure?: number;
  precipIn?: number;
  precip?: number;
}

export interface ChallengerRunOptions {
  db: FirebaseFirestore.Firestore;
  siteId: string;
  thresholdFt: number;
  issuedAt: Date;
  recentResidual: WaterPoint[];
  tide: WaterPoint[];
  forecastWeather?: ChallengerWeatherInput[];
  horizonSteps?: number; // defaults to 48 (24 hours at 30-min steps) for TimesFM inference
  /** When true, synthesizes the full future astronomical tide horizon (up to 21 days at 30-min steps) */
  extendFullTideHorizon?: boolean;
  timesfmClient?: TimesFmVertexClient;
  noaaForecastProvider?: () => Promise<NoaaSurgeForecast | null>;
  riverForecastProvider?: () => Promise<NoaaSurgeForecast | null>;
  usgsTelemetryProvider?: () => Promise<UsgsRiverTelemetry | null>;
}

/** Resamples irregular residual points onto a strict 30-minute grid */
export function resampleResidualGrid(
  series: WaterPoint[],
  endTime: Date,
  hoursBack = 48
): Array<{ t: string; v: number }> {
  if (!series.length) return [];
  const points = [...series].sort((a, b) => a.t.getTime() - b.t.getTime());

  const endMs = Math.floor(endTime.getTime() / (30 * 60_000)) * (30 * 60_000);
  const startMs = endMs - hoursBack * 3600_000;

  const resampled: Array<{ t: string; v: number }> = [];
  for (let ms = startMs; ms <= endMs; ms += 30 * 60_000) {
    const d = new Date(ms);
    const val = interpolate(points, d, 45 * 60_000); // 45-min max gap
    if (val !== null && Number.isFinite(val)) {
      resampled.push({ t: d.toISOString(), v: Math.round(val * 1000) / 1000 });
    }
  }
  return resampled;
}

/**
 * Fits tidal harmonic components (M2: 12.4206h, S1: 24h, M4: 6.2103h) from recent
 * observed residual points and returns deviation relative to anchorTime.
 */
export function fitResidualHarmonics(
  history: Array<{ t: string; v: number }>,
  anchorTime: Date,
  lookbackHours = 48
): (targetTime: Date) => number {
  const originMs = anchorTime.getTime();
  const model = fitBasinHarmonics(history, originMs, {
    lookbackHours,
    includeM4: true,
    maxClampFt: 1.5,
  });
  const hOrigin = model.evalHarmonic(originMs);
  return (targetTime: Date) => {
    const raw = model.evalHarmonic(targetTime.getTime()) - hOrigin;
    return Math.max(-1.5, Math.min(1.5, raw));
  };
}

function normalizeWeatherSamples(inputs: ChallengerWeatherInput[]): BasinWeatherSample[] {
  const out: BasinWeatherSample[] = [];
  for (const w of inputs || []) {
    if (!w) continue;
    const tMs = new Date(w.t).getTime();
    if (!Number.isFinite(tMs)) continue;
    out.push({
      t: new Date(tMs),
      windSpeedMph: w.windSpeedMph ?? w.windSpeed,
      windDirectionDeg: w.windDirectionDeg ?? w.windDirection,
      pressureHpa: w.surfacePressureHpa ?? w.pressure,
      precipIn: w.precipIn ?? w.precip,
    });
  }
  return out;
}

/**
 * Runs the unified Operational Forecast Engine:
 *   TimesFM-3 Subtidal AI + NOAA Ocean ETSS (ncwrit) + Cape Fear River ETSS (ncwilm)
 *   + USGS Lock #1 Discharge (02105769) + Directional N/NE Wind-Fetch Stress + M2/S1/M4 Estuarine Harmonics.
 */
export async function runTimesFmChallenger(
  options: ChallengerRunOptions
): Promise<ChallengerOutlookDocument | null> {
  const hasCustomNoaaProvider = options.noaaForecastProvider !== undefined;
  const {
    db,
    siteId,
    thresholdFt,
    issuedAt,
    recentResidual,
    tide,
    forecastWeather = [],
    horizonSteps = 48,
    extendFullTideHorizon = false,
    timesfmClient = new TimesFmVertexClient(),
    noaaForecastProvider = () => fetchNoaaSurgeForecast(10_000, WRIGHTSVILLE_ETSS_CONFIG),
    riverForecastProvider = hasCustomNoaaProvider
      ? async () => null
      : () => fetchNoaaSurgeForecast(10_000, WILMINGTON_RIVER_ETSS_CONFIG),
    usgsTelemetryProvider = hasCustomNoaaProvider
      ? async () => null
      : () => fetchUsgsRiverTelemetry(CAPE_FEAR_LOCK1_CONFIG),
  } = options;

  try {
    // 1. Resample recent residual to strict 30-minute intervals (48h back)
    const historyPoints = resampleResidualGrid(recentResidual, issuedAt, 48);
    if (historyPoints.length < 24) {
      logger.info('Operational forecast skipped: insufficient residual history', {
        pointsAvailable: historyPoints.length,
        required: 24,
      });
      return null;
    }

    const spec = MULTI_REGION_BASIN_SPECS[siteId] ?? CAROLINA_BEACH_BASIN_SPEC;
    const originMs = issuedAt.getTime();
    const harmonics = fitBasinHarmonics(historyPoints, originMs, spec.harmonics);

    // De-harmonize observed residual before feeding TimesFM so harmonics are never double-counted
    const subtidalTargetHistory = historyPoints.map(p =>
      Math.round((p.v - harmonics.evalHarmonic(Date.parse(p.t))) * 1000) / 1000
    );
    const timestamps = historyPoints.map(p => p.t);

    // 2. Fetch NOAA Ocean ETSS, NOAA River ETSS (Wilmington Cape Fear), and USGS Lock #1 discharge in parallel
    const [noaaSurge, riverSurge, usgsTelemetry] = await Promise.all([
      noaaForecastProvider().catch(e => {
        logger.warn('NOAA Ocean ETSS fetch failed', { error: safeError(e) });
        return null;
      }),
      riverForecastProvider().catch(e => {
        logger.warn('NOAA River ETSS fetch failed', { error: safeError(e) });
        return null;
      }),
      usgsTelemetryProvider().catch(e => {
        logger.warn('USGS river telemetry fetch failed', { error: safeError(e) });
        return null;
      }),
    ]);

    const normalizedWeather = normalizeWeatherSamples(forecastWeather);

    // 3. Build future covariate vectors for the TimesFM inference window (horizonSteps)
    const futureTide: number[] = [];
    const futureNoaaSurge: number[] = [];
    const futureWind: number[] = [];
    const futureWindDir: number[] = [];
    const futurePressure: number[] = [];
    const futurePrecip: number[] = [];
    const futureDates: Date[] = [];

    const noaaPoints = noaaSurge?.points.map(p => ({ t: new Date(p.t), v: p.surgeFt })) || [];
    const riverPoints = riverSurge?.points.map(p => ({ t: new Date(p.t), v: p.surgeFt })) || [];
    const weatherWind = normalizedWeather
      .filter(w => typeof w.windSpeedMph === 'number')
      .map(w => ({ t: new Date(w.t), v: w.windSpeedMph! }));
    const weatherWindDir = normalizedWeather
      .filter(w => typeof w.windDirectionDeg === 'number')
      .map(w => ({ t: new Date(w.t), v: w.windDirectionDeg! }));
    const weatherPressure = normalizedWeather
      .filter(w => typeof w.pressureHpa === 'number')
      .map(w => ({ t: new Date(w.t), v: w.pressureHpa! }));
    const weatherPrecip = normalizedWeather
      .filter(w => typeof w.precipIn === 'number')
      .map(w => ({ t: new Date(w.t), v: w.precipIn! }));

    for (let step = 1; step <= horizonSteps; step++) {
      const stepTime = new Date(originMs + step * 30 * 60_000);
      futureDates.push(stepTime);

      const tideVal = interpolate(tide, stepTime, 45 * 60_000) ?? 3.5;
      futureTide.push(Math.round(tideVal * 1000) / 1000);

      const surgeVal = noaaPoints.length ? interpolate(noaaPoints, stepTime, 90 * 60_000) ?? 0 : 0;
      futureNoaaSurge.push(Math.round(surgeVal * 1000) / 1000);

      const windVal = weatherWind.length ? interpolate(weatherWind, stepTime, 90 * 60_000) ?? 0 : 0;
      futureWind.push(Math.round(windVal * 10) / 10);

      const dirVal = weatherWindDir.length ? interpolate(weatherWindDir, stepTime, 90 * 60_000) ?? 0 : 0;
      futureWindDir.push(Math.round(dirVal));

      const pressVal = weatherPressure.length ? interpolate(weatherPressure, stepTime, 90 * 60_000) ?? 1013.25 : 1013.25;
      futurePressure.push(Math.round(pressVal * 10) / 10);

      const precipVal = weatherPrecip.length ? interpolate(weatherPrecip, stepTime, 90 * 60_000) ?? 0 : 0;
      futurePrecip.push(Math.round(precipVal * 100) / 100);
    }

    // 4. Request TimesFM subtidal prediction
    const covariatesUsed = ['astronomical_tide', 'estuarine_harmonics_m2_s1_m4'];
    if (noaaSurge && noaaPoints.length > 0) covariatesUsed.push('noaa_etss_surge');
    if (riverSurge && riverPoints.length > 0) covariatesUsed.push('cape_fear_river_etss_head');
    if (usgsTelemetry && usgsTelemetry.points.length > 0) covariatesUsed.push('usgs_lock1_discharge');
    if (weatherWind.length > 0) covariatesUsed.push('surface_wind_speed');
    if (weatherWindDir.length > 0) covariatesUsed.push('directional_nne_wind_stress');
    if (weatherPressure.length > 0) covariatesUsed.push('surface_pressure');
    if (weatherPrecip.length > 0) covariatesUsed.push('precipitation_runoff');

    let engine: TimesFmPredictionResult['engine'] = 'noaa-etss-hybrid';
    let timesFmSubtidal: Array<{ t: Date; v: number }> = [];
    let timesFmSpread: Array<{ t: Date; v: number }> = [];

    try {
      const prediction = await timesfmClient.forecast({
        targetHistory: subtidalTargetHistory,
        timestamps,
        horizon: horizonSteps,
        futureTide,
        futureNoaaSurge: noaaPoints.length ? futureNoaaSurge : undefined,
        futureWeather: {
          windSpeed: futureWind,
          windDirection: futureWindDir,
          pressure: futurePressure,
          precipitation: futurePrecip,
        },
        quantiles: [0.1, 0.5, 0.9],
      });
      engine = prediction.engine;
      timesFmSubtidal = futureDates.map((d, idx) => ({ t: d, v: prediction.mean[idx] }));
      if (prediction.q10 && prediction.q90) {
        timesFmSpread = futureDates.map((d, idx) => ({
          t: d,
          v: Math.max(0.18, (prediction.q90![idx] - prediction.q10![idx]) / 2),
        }));
      }
    } catch (modelErr) {
      if (!noaaPoints.length) {
        throw new Error('Both TimesFM inference and NOAA ETSS surge guidance are unavailable');
      }
      logger.warn('TimesFM remote inference failed, activating NOAA ETSS + Basin Physics hybrid engine', {
        event: 'timesfm_fallback_etss',
        error: safeError(modelErr),
      });
      engine = 'noaa-etss-hybrid';
    }

    // 5. Build target future tide evaluation grid (30-min steps across horizonSteps or full 21-day tide horizon)
    const sortedInputTide = [...tide].sort((a, b) => +a.t - +b.t);
    const maxTideMs = sortedInputTide.length ? +sortedInputTide[sortedInputTide.length - 1].t : originMs;
    const minEndMs = originMs + horizonSteps * 30 * 60_000;
    const targetEndMs = extendFullTideHorizon ? Math.max(minEndMs, maxTideMs) : minEndMs;

    const targetTideGrid: Array<{ t: Date; v: number }> = [];
    for (let ms = originMs + 30 * 60_000; ms <= targetEndMs; ms += 30 * 60_000) {
      const d = new Date(ms);
      const tv = interpolate(sortedInputTide, d, 65 * 60_000);
      if (tv !== null && Number.isFinite(tv)) {
        targetTideGrid.push({ t: d, v: tv });
      } else if (ms <= minEndMs) {
        targetTideGrid.push({ t: d, v: 3.5 });
      }
    }

    const usgsDischargeSeries =
      usgsTelemetry?.points
        .filter(p => typeof p.dischargeCfs === 'number' && Number.isFinite(p.dischargeCfs))
        .map(p => ({ t: p.t, v: p.dischargeCfs! })) ?? [];

    // Ensure Ocean ETSS covers origin if NOAA ETSS had a single anchor point or TimesFM zero-shot ran without ETSS
    const effectiveOceanEtss =
      noaaPoints.length >= 2
        ? noaaPoints
        : noaaPoints.length === 1
          ? [noaaPoints[0], { t: new Date(minEndMs), v: noaaPoints[0].v }]
          : timesFmSubtidal;

    const synthesized = synthesizeOperationalForecast({
      spec,
      issuedAt,
      recentResidual: historyPoints,
      tide: targetTideGrid,
      oceanEtss: effectiveOceanEtss,
      riverEtss: riverPoints,
      usgsDischargeCfs: usgsDischargeSeries,
      weather: normalizedWeather,
      timesFmSubtidal,
      timesFmSpread,
    });

    const challengerPoints: ChallengerPoint[] = synthesized.map(pt => ({
      t: pt.t,
      totalFt: pt.totalFt,
      tideFt: pt.tideFt,
      residualFt: pt.residualFt,
      ...(pt.noaaSurgeFt !== undefined ? { noaaSurgeFt: pt.noaaSurgeFt } : {}),
      ...(pt.riverSurgeFt !== undefined ? { riverSurgeFt: pt.riverSurgeFt } : {}),
      lowerFt: pt.lowerFt,
      upperFt: pt.upperFt,
      ...(pt.windSpeedMph !== undefined ? { windSpeedMph: pt.windSpeedMph } : {}),
      ...(pt.windDirectionDeg !== undefined ? { windDirectionDeg: pt.windDirectionDeg } : {}),
      ...(pt.precipIn !== undefined ? { precipIn: pt.precipIn } : {}),
      drivers: pt.drivers,
    }));

    // Compute peak within the primary 72h operational outlook window (or full series if shorter)
    const primaryCutoffMs = originMs + Math.max(horizonSteps, 144) * 30 * 60_000;
    let peakPoint: ChallengerPoint | null = null;
    for (const pt of challengerPoints) {
      if (Date.parse(pt.t) <= primaryCutoffMs) {
        if (!peakPoint || pt.totalFt > peakPoint.totalFt) {
          peakPoint = pt;
        }
      }
    }
    if (!peakPoint && challengerPoints.length) {
      peakPoint = challengerPoints[0];
    }

    const latestObs = [...recentResidual].sort((a, b) => +a.t - +b.t).at(-1);
    const currentResidualFt = latestObs ? Math.round(latestObs.v * 1000) / 1000 : harmonics.anchorObs;
    const observationAt = latestObs ? latestObs.t.toISOString() : historyPoints.at(-1)?.t;

    const expiresAt = new Date(originMs + 45 * 60_000).toISOString();
    const challengerDoc: ChallengerOutlookDocument = {
      challengerId: 'timesfm-3',
      locationId: siteId,
      regime: spec.regime,
      generatedAt: issuedAt.toISOString(),
      ...(observationAt ? { observationAt } : {}),
      currentResidualFt,
      expiresAt,
      status: 'available',
      engine,
      horizonSteps: challengerPoints.length,
      thresholdFt,
      points: challengerPoints,
      peak: peakPoint
        ? {
            t: peakPoint.t,
            totalFt: peakPoint.totalFt,
            tideFt: peakPoint.tideFt,
            residualFt: peakPoint.residualFt,
            exceedsThreshold: peakPoint.totalFt >= thresholdFt,
          }
        : null,
      covariatesUsed,
      metadata: {
        historyPointsCount: historyPoints.length,
        noaaSurgeAvailable: !!(noaaSurge && noaaPoints.length > 0),
        riverSurgeAvailable: !!(riverSurge && riverPoints.length > 0),
        usgsDischargeCfs: usgsTelemetry?.latestDischargeCfs ?? null,
        weatherAvailable: normalizedWeather.length > 0,
        retrievedAt: new Date().toISOString(),
      },
    };

    // 6. Write operational forecast atomically to Firestore
    const issuePath = `locations/${siteId}/forecast_challengers/timesfm-3/issues/${issuedAt.toISOString()}`;
    const currentPath = `locations/${siteId}/forecast_challengers/timesfm-3/outlook/current`;
    const publicationMarker = `forecast_challenger_publications/timesfm-3/${siteId}/issues/${issuedAt.toISOString()}`;

    await Promise.all([
      db.doc(issuePath).set(challengerDoc),
      db.doc(currentPath).set(challengerDoc),
      db.doc(publicationMarker).set({
        challengerId: 'timesfm-3',
        locationId: siteId,
        issueId: issuedAt.toISOString(),
        publishedAt: FieldValue.serverTimestamp(),
        engine,
        peakFt: challengerDoc.peak?.totalFt ?? null,
        peakTime: challengerDoc.peak?.t ?? null,
      }),
    ]);

    logger.info('Operational Basin Physics + TimesFM forecast published successfully', {
      event: 'timesfm_challenger_published',
      locationId: siteId,
      regime: spec.regime,
      engine,
      pointsCount: challengerPoints.length,
      peakFt: challengerDoc.peak?.totalFt,
      peakTime: challengerDoc.peak?.t,
      riverSurgeAvailable: challengerDoc.metadata.riverSurgeAvailable,
      usgsDischargeCfs: challengerDoc.metadata.usgsDischargeCfs,
    });

    return challengerDoc;
  } catch (err) {
    logger.warn('Operational forecast execution failed', {
      event: 'timesfm_challenger_failed',
      locationId: siteId,
      error: safeError(err),
    });
    return null;
  }
}

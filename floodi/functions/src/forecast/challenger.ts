import * as logger from 'firebase-functions/logger';
import { FieldValue } from 'firebase-admin/firestore';
import { safeError } from '../utils/observability';
import { WaterPoint, interpolate } from './water';
import { TimesFmVertexClient, TimesFmPredictionResult } from './timesfmClient';
import { fetchNoaaSurgeForecast, NoaaSurgeForecast } from './noaaSurge';

export interface ChallengerPoint {
  t: string;          // ISO 8601 UTC
  totalFt: number;    // Astronomical tide + predicted residual
  tideFt: number;     // Astronomical tide
  residualFt: number; // Foundation model predicted residual
  noaaSurgeFt?: number; // NOAA ETSS hydrodynamic surge guidance
  lowerFt?: number;   // 10th percentile bound
  upperFt?: number;   // 90th percentile bound
}

export interface ChallengerOutlookDocument {
  challengerId: string;
  locationId: string;
  generatedAt: string;
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
    retrievedAt: string;
  };
  error?: string;
}

export interface ChallengerRunOptions {
  db: FirebaseFirestore.Firestore;
  siteId: string;
  thresholdFt: number;
  issuedAt: Date;
  recentResidual: WaterPoint[];
  tide: WaterPoint[];
  forecastWeather?: Array<{ t: Date; windSpeedMph?: number; surfacePressureHpa?: number }>;
  horizonSteps?: number; // defaults to 48 (24 hours at 30-min steps)
  timesfmClient?: TimesFmVertexClient;
  noaaForecastProvider?: () => Promise<NoaaSurgeForecast | null>;
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
  const startMs = endMs - (hoursBack * 3600_000);

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
 * Fits tidal harmonic components (M2: 12.4206h lunar semi-diurnal, S1: 24h diurnal)
 * from recent observed residual points using ridge regression.
 * Returns a function that maps any target timestamp to its shallow-water harmonic deviation relative to anchorTime.
 */
export function fitResidualHarmonics(
  history: Array<{ t: string; v: number }>,
  anchorTime: Date
): (targetTime: Date) => number {
  if (history.length < 12) {
    return () => 0;
  }
  const count = 6;
  const matrix = Array.from({ length: count }, () => Array(count + 1).fill(0));
  const origin = anchorTime.getTime();

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
    const tMs = new Date(pt.t).getTime();
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

  return (targetTime: Date) => {
    const raw = harmonicAt(targetTime.getTime()) - hAnchor;
    // Bounded within physical canal anomaly range [-1.2 ft, +1.2 ft]
    return Math.max(-1.2, Math.min(1.2, raw));
  };
}

/**
 * Runs the TimesFM-3 + NOAA ETSS shadow challenger.
 * Designed to execute asynchronously alongside primary forecast publication.
 * Under NO circumstances does this function throw into the primary forecast pipeline.
 */
export async function runTimesFmChallenger(
  options: ChallengerRunOptions
): Promise<ChallengerOutlookDocument | null> {
  const {
    db,
    siteId,
    thresholdFt,
    issuedAt,
    recentResidual,
    tide,
    forecastWeather = [],
    horizonSteps = 48,
    timesfmClient = new TimesFmVertexClient(),
    noaaForecastProvider = fetchNoaaSurgeForecast,
  } = options;

  try {
    // 1. Resample recent residual to strict 30-minute intervals (48h back)
    const historyPoints = resampleResidualGrid(recentResidual, issuedAt, 48);
    if (historyPoints.length < 24) {
      logger.info('TimesFM shadow challenger skipped: insufficient residual history', {
        pointsAvailable: historyPoints.length,
        required: 24,
      });
      return null;
    }

    const targetHistory = historyPoints.map(p => p.v);
    const timestamps = historyPoints.map(p => p.t);

    // 2. Fetch NOAA ETSS storm surge guidance
    let noaaSurge: NoaaSurgeForecast | null = null;
    try {
      noaaSurge = await noaaForecastProvider();
    } catch (e) {
      logger.warn('NOAA ETSS fetch failed; proceeding with pure TimesFM zero-shot', { error: safeError(e) });
    }

    // 3. Build future covariate vectors
    const futureTide: number[] = [];
    const futureNoaaSurge: number[] = [];
    const futureWind: number[] = [];
    const futurePressure: number[] = [];
    const futureDates: Date[] = [];

    const noaaPoints = noaaSurge?.points.map(p => ({ t: new Date(p.t), v: p.surgeFt })) || [];
    const weatherWind = forecastWeather.map(w => ({ t: w.t, v: w.windSpeedMph ?? 0 }));
    const weatherPressure = forecastWeather.map(w => ({ t: w.t, v: w.surfacePressureHpa ?? 1013.25 }));

    for (let step = 1; step <= horizonSteps; step++) {
      const stepTime = new Date(issuedAt.getTime() + step * 30 * 60_000);
      futureDates.push(stepTime);

      const tideVal = interpolate(tide, stepTime, 45 * 60_000) ?? 3.5;
      futureTide.push(Math.round(tideVal * 1000) / 1000);

      const surgeVal = noaaPoints.length ? (interpolate(noaaPoints, stepTime, 90 * 60_000) ?? 0) : 0;
      futureNoaaSurge.push(Math.round(surgeVal * 1000) / 1000);

      const windVal = weatherWind.length ? (interpolate(weatherWind, stepTime, 90 * 60_000) ?? 0) : 0;
      futureWind.push(Math.round(windVal * 10) / 10);

      const pressVal = weatherPressure.length ? (interpolate(weatherPressure, stepTime, 90 * 60_000) ?? 1013.25) : 1013.25;
      futurePressure.push(Math.round(pressVal * 10) / 10);
    }

    // 4. Request TimesFM prediction
    const covariatesUsed = ['astronomical_tide'];
    if (noaaSurge && noaaPoints.length > 0) covariatesUsed.push('noaa_etss_surge');
    if (weatherWind.length > 0) covariatesUsed.push('surface_wind_speed');
    if (weatherPressure.length > 0) covariatesUsed.push('surface_pressure');

    let prediction: TimesFmPredictionResult;
    try {
      prediction = await timesfmClient.forecast({
        targetHistory,
        timestamps,
        horizon: horizonSteps,
        futureTide,
        futureNoaaSurge: noaaPoints.length ? futureNoaaSurge : undefined,
        futureWeather: {
          windSpeed: futureWind,
          pressure: futurePressure,
        },
        quantiles: [0.1, 0.5, 0.9],
      });
    } catch (modelErr) {
      if (!noaaPoints.length) {
        throw new Error('Both TimesFM inference and NOAA ETSS surge guidance are unavailable');
      }
      logger.warn('TimesFM remote inference failed, activating NOAA ETSS hybrid fallback', {
        event: 'timesfm_fallback_etss',
        error: safeError(modelErr),
      });

      // Hybrid Fallback: Blend latest measured residual with NOAA ETSS guidance
      const anchorResidual = targetHistory.at(-1) ?? 0.5;
      const mean: number[] = [];
      const q10: number[] = [];
      const q90: number[] = [];

      for (let i = 0; i < horizonSteps; i++) {
        const noaaVal = noaaPoints.length ? futureNoaaSurge[i] : anchorResidual;
        // Exponential blending: weight decays over 6 hours (12 steps of 30 mins)
        // smoothly bridging from measured gauge residual to NOAA ETSS hydrodynamic surge guidance
        const alpha = Math.exp(-i / 12);
        const blended = alpha * anchorResidual + (1 - alpha) * noaaVal;
        mean.push(blended);

        // Calibrated empirical error growth for storm surge
        const uncertainty = 0.25 + 0.005 * i;
        q10.push(blended - uncertainty);
        q90.push(blended + uncertainty);
      }

      prediction = {
        mean,
        q10,
        q50: mean,
        q90,
        engine: 'noaa-etss-hybrid',
      };
    }

    // 5. Reconstruct total forecasted water level curve with shallow-water estuarine harmonics
    const challengerPoints: ChallengerPoint[] = [];
    let peakPoint: ChallengerPoint | null = null;
    const harmonicDelta = fitResidualHarmonics(historyPoints, issuedAt);

    for (let i = 0; i < horizonSteps; i++) {
      const t = futureDates[i].toISOString();
      const tideFt = futureTide[i];
      const hDelta = harmonicDelta(futureDates[i]);
      const residualFt = Math.round((prediction.mean[i] + hDelta) * 1000) / 1000;
      const totalFt = Math.round((tideFt + residualFt) * 1000) / 1000;
      const lowerFt = prediction.q10 ? Math.round((tideFt + prediction.q10[i] + hDelta) * 1000) / 1000 : undefined;
      const upperFt = prediction.q90 ? Math.round((tideFt + prediction.q90[i] + hDelta) * 1000) / 1000 : undefined;
      const noaaSurgeFt = noaaPoints.length ? futureNoaaSurge[i] : undefined;

      const pt: ChallengerPoint = {
        t,
        totalFt,
        tideFt,
        residualFt,
        noaaSurgeFt,
        lowerFt,
        upperFt,
      };
      challengerPoints.push(pt);

      if (!peakPoint || pt.totalFt > peakPoint.totalFt) {
        peakPoint = pt;
      }
    }

    const expiresAt = new Date(issuedAt.getTime() + 45 * 60_000).toISOString();
    const challengerDoc: ChallengerOutlookDocument = {
      challengerId: 'timesfm-3',
      locationId: siteId,
      generatedAt: issuedAt.toISOString(),
      expiresAt,
      status: 'available',
      engine: prediction.engine,
      horizonSteps,
      thresholdFt,
      points: challengerPoints,
      peak: peakPoint ? {
        t: peakPoint.t,
        totalFt: peakPoint.totalFt,
        tideFt: peakPoint.tideFt,
        residualFt: peakPoint.residualFt,
        exceedsThreshold: peakPoint.totalFt >= thresholdFt,
      } : null,
      covariatesUsed,
      metadata: {
        historyPointsCount: historyPoints.length,
        noaaSurgeAvailable: !!(noaaSurge && noaaPoints.length > 0),
        retrievedAt: new Date().toISOString(),
      },
    };

    // 6. Write asynchronously to Firestore
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
        engine: prediction.engine,
        peakFt: challengerDoc.peak?.totalFt ?? null,
        peakTime: challengerDoc.peak?.t ?? null,
      }),
    ]);

    logger.info('TimesFM shadow challenger forecast published successfully', {
      event: 'timesfm_challenger_published',
      locationId: siteId,
      engine: prediction.engine,
      peakFt: challengerDoc.peak?.totalFt,
      peakTime: challengerDoc.peak?.t,
    });

    return challengerDoc;
  } catch (err) {
    logger.warn('TimesFM shadow challenger execution failed; primary forecast unaffected', {
      event: 'timesfm_challenger_failed',
      locationId: siteId,
      error: safeError(err),
    });
    return null;
  }
}

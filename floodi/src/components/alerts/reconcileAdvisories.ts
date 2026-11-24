import type { PublicFloodAdvisory } from 'src/lib/citizenAlerts';
import type { AppConfiguration, Point, PrecipPoint, WindPoint } from 'src/components/Tab2/types';
import { floodWindows, inundation, type StreetCalibration } from 'src/utils/waterForecast';
import { getFloodSeverityForLevel, type FloodSeverity } from 'src/utils/floodSeverity';
import { nearestEventWeather } from 'src/components/dashboard/eventWeather';

const TIDE_MATCH_WINDOW_MS = 3 * 3600_000;
const COMPASS_DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

function degToCompass(deg: number | null | undefined): string | null {
  if (typeof deg !== 'number' || !Number.isFinite(deg)) return null;
  return COMPASS_DIRS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

export interface UnifiedFloodAdvisory extends PublicFloodAdvisory {
  /** True when the event comes from the live 6-minute operational forecast curve */
  fromLiveForecast: boolean;
  /** True when the peak occurs beyond the 48-hour short-range advisory window */
  isExtendedOutlook: boolean;
}

export interface ReconciledOutlookSummary {
  /** Unified, deduplicated, chronologically sorted flood advisories & watches */
  advisories: UnifiedFloodAdvisory[];
  /** Highest water level within the next 48 hours (reconciled with live curve) */
  next48hPeak: { peakFt: number; peakAt: string } | null;
  /** Latest surge anomaly in ft */
  currentSurgeFt: number | null;
  /** End of available operational forecast horizon */
  forecastHorizon: Date | null;
}

/**
 * Reconciles backend 30-min PublicFloodAdvisory snapshots with the live 6-min
 * operational forecast curve so every crest height, peak timing, duration, and
 * street-depth estimate matches the interactive hydrograph identically.
 */
export function reconcileOutlookAdvisories({
  feedAdvisories = [],
  feedNextPeakFt = null,
  feedNextPeakAt = null,
  feedCurrentSurgeFt = null,
  operationalForecastPoints = [],
  predictedPoints = [],
  deltaPoints = [],
  windPoints = [],
  precipPoints = [],
  thresholds,
  now,
  streetCalibration,
}: {
  feedAdvisories?: PublicFloodAdvisory[];
  feedNextPeakFt?: number | null;
  feedNextPeakAt?: string | null;
  feedCurrentSurgeFt?: number | null;
  operationalForecastPoints?: Point[];
  predictedPoints?: Point[];
  deltaPoints?: Point[];
  windPoints?: WindPoint[];
  precipPoints?: PrecipPoint[];
  thresholds: AppConfiguration['thresholds'];
  now: Date;
  streetCalibration?: StreetCalibration;
}): ReconciledOutlookSummary {
  const nowMs = now.getTime();
  const horizon48hMs = nowMs + 48 * 3600_000;
  const hasLiveCurve = operationalForecastPoints.length > 1;

  const matchedFeedIds = new Set<string>();
  const unified: UnifiedFloodAdvisory[] = [];

  if (hasLiveCurve) {
    const liveWindows = floodWindows(operationalForecastPoints, thresholds.minor).filter(
      w => +(w.endTime ?? w.lastSampleTime) > nowMs
    );

    for (const w of liveWindows) {
      const peakMs = w.peakTime.getTime();
      const matchedFeed = feedAdvisories.find(
        adv => !matchedFeedIds.has(adv.episodeId) && Math.abs(Date.parse(adv.peakAt) - peakMs) <= TIDE_MATCH_WINDOW_MS
      );
      if (matchedFeed) {
        matchedFeedIds.add(matchedFeed.episodeId);
      }

      const peakFt = Math.round(w.peakValue * 100) / 100;
      const severity: FloodSeverity = getFloodSeverityForLevel(peakFt, thresholds) ?? 'minor';
      const endDate = w.endTime ?? w.lastSampleTime;
      const durationMinutes = Math.max(15, Math.round((endDate.getTime() - w.startTime.getTime()) / 60_000));
      const aboveFloodStageFt = Math.max(0, Math.round((peakFt - thresholds.minor) * 100) / 100);
      const estimatedStreetDepthIn = Math.round(
        inundation(peakFt, thresholds.minor, 'MLLW', streetCalibration).inches * 10
      ) / 10;

      const nearestTide = predictedPoints.reduce<Point | null>((best, pt) => {
        if (!Number.isFinite(pt.v) || !Number.isFinite(+pt.t)) return best;
        if (!best) return pt;
        return Math.abs(+pt.t - peakMs) < Math.abs(+best.t - peakMs) ? pt : best;
      }, null);
      const tideFt = nearestTide && Math.abs(+nearestTide.t - peakMs) <= 60 * 60_000
        ? Math.round(nearestTide.v * 100) / 100
        : matchedFeed?.tideFt ?? peakFt;
      const surgeFt = Math.round((peakFt - tideFt) * 100) / 100;

      const nearestWind = nearestEventWeather(windPoints, w.peakTime);
      const nearestPrecip = nearestEventWeather(precipPoints, w.peakTime);
      const windSpeedMph = matchedFeed?.windSpeedMph ?? (nearestWind ? Math.round(nearestWind.speed) : null);
      const windDirectionDeg = matchedFeed?.windDirectionDeg ?? (nearestWind ? nearestWind.dir : null);
      const windCompass = matchedFeed?.windCompass ?? degToCompass(windDirectionDeg);
      const precipWindowIn = matchedFeed?.precipWindowIn ?? (nearestPrecip ? Math.round(nearestPrecip.value * 100) / 100 : 0);

      unified.push({
        episodeId: matchedFeed?.episodeId ?? `live-${w.startTime.toISOString()}`,
        severity,
        startAt: w.startTime.toISOString(),
        peakAt: w.peakTime.toISOString(),
        endAt: endDate.toISOString(),
        durationMinutes,
        startClipped: w.startClipped,
        endClipped: w.endTime === null,
        peakFt,
        aboveFloodStageFt,
        estimatedStreetDepthIn,
        tideFt,
        surgeFt,
        windSpeedMph,
        windDirectionDeg,
        windCompass,
        precipWindowIn,
        drivers: matchedFeed?.drivers,
        isProbabilisticWatch: false,
        upperPeakFt: matchedFeed?.upperPeakFt,
        fromLiveForecast: true,
        isExtendedOutlook: peakMs > horizon48hMs,
      });
    }

    // Preserve unmatched backend probabilistic watches (central < minor, P90 >= minor),
    // reconciling their central peak with the live 6-min curve near that peak time.
    for (const adv of feedAdvisories) {
      if (matchedFeedIds.has(adv.episodeId)) continue;
      if (!adv.isProbabilisticWatch) continue;
      const advPeakMs = Date.parse(adv.peakAt);
      if (!Number.isFinite(advPeakMs) || Date.parse(adv.endAt) <= nowMs) continue;

      const localSlice = operationalForecastPoints.filter(
        p => Math.abs(+p.t - advPeakMs) <= 2 * 3600_000 && Number.isFinite(p.v)
      );
      const localPeak = localSlice.reduce<Point | null>((best, p) => (!best || p.v > best.v ? p : best), null);
      const reconciledPeakFt = localPeak ? Math.round(localPeak.v * 100) / 100 : adv.peakFt;
      const reconciledPeakAt = localPeak ? localPeak.t.toISOString() : adv.peakAt;

      unified.push({
        ...adv,
        peakFt: reconciledPeakFt,
        peakAt: reconciledPeakAt,
        fromLiveForecast: Boolean(localPeak),
        isExtendedOutlook: Date.parse(reconciledPeakAt) > horizon48hMs,
      });
    }
  } else {
    // Fallback when only the backend alert feed is loaded (e.g., before chart data resolves)
    for (const adv of feedAdvisories) {
      unified.push({
        ...adv,
        fromLiveForecast: false,
        isExtendedOutlook: Date.parse(adv.peakAt) > horizon48hMs,
      });
    }
  }

  unified.sort((a, b) => Date.parse(a.peakAt) - Date.parse(b.peakAt));

  // Reconcile next 48-hour crest height & timing
  let next48hPeak: { peakFt: number; peakAt: string } | null = null;
  if (hasLiveCurve) {
    const window48h = operationalForecastPoints.filter(
      p => +p.t >= nowMs && +p.t <= horizon48hMs && Number.isFinite(p.v)
    );
    const maxPt = window48h.reduce<Point | null>((best, p) => (!best || p.v > best.v ? p : best), null);
    if (maxPt) {
      next48hPeak = {
        peakFt: Math.round(maxPt.v * 100) / 100,
        peakAt: maxPt.t.toISOString(),
      };
    }
  }
  if (!next48hPeak && feedNextPeakFt !== null && feedNextPeakAt) {
    next48hPeak = { peakFt: feedNextPeakFt, peakAt: feedNextPeakAt };
  }

  const latestDelta = deltaPoints.at(-1)?.v;
  const currentSurgeFt = typeof latestDelta === 'number' && Number.isFinite(latestDelta)
    ? Math.round(latestDelta * 100) / 100
    : feedCurrentSurgeFt;

  const forecastHorizon = operationalForecastPoints.at(-1)?.t ?? null;

  return {
    advisories: unified,
    next48hPeak,
    currentSurgeFt,
    forecastHorizon,
  };
}

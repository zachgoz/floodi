import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { buildAdjustedFuture, fetchPredictions as fetchNoaaPredictions } from 'src/lib/noaa';
import { 
  fetchUnifiedObservations, 
  fetchUnifiedPredictions, 
  fetchFloodEvents, 
  extractWeatherData 
} from 'src/lib/dataService';
import type { ChartData, DataState, Point, ThresholdCrossing, AppConfiguration, WindPoint, PrecipPoint } from '../types';
import { LOCATIONS } from 'src/constants/locations';

/**
 * Module-level cache to persist data across hook remounts and prevent redundant network requests.
 * Key format: {stationId}-{fStartMs}-{fEndMs}
 */
const dataCache: Record<string, { timestamp: number; data: any }> = {};
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Convert NOAA series data to Point array format
 */
function seriesToPoints(series: Record<string, number>, source?: 'fiman' | 'noaa'): Point[] {
  return Object.entries(series)
    .map(([k, v]) => ({ t: new Date(k), v, source }))
    .sort((a, b) => a.t.getTime() - b.t.getTime());
}

/**
 * Custom hook for fetching and processing NOAA chart data
 */
export function useChartData(config: AppConfiguration) {
  const [dataState, setDataState] = useState<DataState>({
    loading: true,
    error: null,
    data: {
      observed: {},
      predicted: {},
      adjusted: {},
      offset: null,
      nPoints: 0,
      wind: {},
      precip: {},
    },
  });


  const { locationId, timeRange, offset: configOffset } = config;
  const location = LOCATIONS[locationId] || LOCATIONS['carolina-beach'];
  const stationId = location.noaaStationId;

  const { mode, lookbackH, lookaheadH, absStart, absEnd } = timeRange;

  const timeDomain = useMemo(() => {
    // Round to the minute to prevent URL jitter and redundant fetches
    const now = new Date();
    now.setSeconds(0, 0);
    now.setMilliseconds(0);

    let start, end;
    if (mode === 'relative') {
      start = new Date(now.getTime() - lookbackH * 3600_000);
      end = new Date(now.getTime() + lookaheadH * 3600_000);
    } else {
      const startMs = Math.min(new Date(absStart).getTime(), new Date(absEnd).getTime());
      const endMs = Math.max(new Date(absStart).getTime(), new Date(absEnd).getTime(), startMs + 60_000);
      start = new Date(startMs);
      end = new Date(endMs);
    }

    return { start, end, now };
  }, [mode, lookbackH, lookaheadH, absStart, absEnd]);

  const fetchRangeRef = useRef<{ start: Date; end: Date; stationId: string } | null>(null);

  // Main data fetching logic
  const performFetch = useCallback(async (force = false) => {
    const { start, end, now } = timeDomain;
    const { timeRange, offset: configOffset } = config;

    // Buffer range: +/- 14 days to allow smooth scrolling.
    // We only refetch if we move outside this 28-day window or if we get close to the edges.
    const BUFFER_DAYS = 14;
    const REFETCH_THRESHOLD_DAYS = 3;

    const fStart = new Date(start.getTime() - BUFFER_DAYS * 24 * 3600 * 1000);
    const fEnd = new Date(end.getTime() + BUFFER_DAYS * 24 * 3600 * 1000);

    // 1. Check if we already have this range covered in our buffer
    if (!force && fetchRangeRef.current && fetchRangeRef.current.stationId === stationId) {
      const buffered = fetchRangeRef.current;
      const startEdgeDiff = (start.getTime() - buffered.start.getTime()) / (24 * 3600 * 1000);
      const endEdgeDiff = (buffered.end.getTime() - end.getTime()) / (24 * 3600 * 1000);

      // If we are within the buffer and not too close to the edges, skip fetch
      if (start >= buffered.start && end <= buffered.end && 
          startEdgeDiff > REFETCH_THRESHOLD_DAYS && 
          endEdgeDiff > REFETCH_THRESHOLD_DAYS) {
        return { data: dataState.data, fromCache: true };
      }
    }

    try {
      const lookahead = timeRange.mode === 'relative' ? (timeRange.lookaheadH + 120) : 
        Math.max(1, Math.ceil((fEnd.getTime() - now.getTime()) / 3600_000));

      const warnings: string[] = [];

      // 2. Fetch base data: Unified functions handle Firestore + Live fallback
      const [unifiedObs, unifiedPred, floodEvents] = await Promise.all([
        fetchUnifiedObservations(locationId, fStart, fEnd),
        fetchUnifiedPredictions(locationId, fStart, fEnd),
        fetchFloodEvents(locationId, 50).catch(err => {
          console.warn('Firestore fetchFloodEvents failed:', err);
          return [];
        }),
      ]);

      // Process weather data using centralized logic
      const { wind: windData, precip: precipData } = extractWeatherData({
        weather: { ...unifiedObs.weather, ...unifiedPred.weather }
      });

      // 2.1 Data Source Selection
      const preferredSource = config.display.dataSource === 'auto' ? 'fiman' : config.display.dataSource;
      const fimanHasData = Object.keys(unifiedObs.fiman || {}).length > 0;
      const noaaHasData = Object.keys(unifiedObs.noaa || {}).length > 0;

      let effectiveSource: 'fiman' | 'noaa' = 
        (preferredSource === 'fiman' && fimanHasData) ? 'fiman' :
        (preferredSource === 'noaa' && noaaHasData) ? 'noaa' :
        fimanHasData ? 'fiman' : 'noaa';

      const observedData = {
        data: effectiveSource === 'fiman' ? { ...unifiedObs.fiman } : { ...unifiedObs.noaa },
        alternate: effectiveSource === 'fiman' ? { ...unifiedObs.noaa } : { ...unifiedObs.fiman },
        imagery: { ...unifiedObs.imagery },
        source: effectiveSource
      };

      const predictions = { ...unifiedPred.data };
      const lastDbPredT = Math.max(...Object.keys(predictions).map(t => new Date(t).getTime()), 0);
      
      // Secondary gap fill for predictions if range exceeds what's in DB
      if (fEnd.getTime() > lastDbPredT) {
        const livePred = await fetchNoaaPredictions({
          station: stationId,
          start: new Date(Math.max(fStart.getTime(), lastDbPredT)),
          end: fEnd,
          interval: 6,
        }).catch(() => ({}));
        Object.assign(predictions, livePred);
      }

      // 3. Calculate adjusted forecast
      const adjustedResult = await buildAdjustedFuture({
        station: stationId,
        now,
        lookbackHours: 6,
        lookaheadHours: lookahead,
        interval: 6,
        datum: 'MLLW',
        units: 'english',
        existingObserved: observedData.data,
        existingPredicted: predictions
      }).catch(err => {
        console.warn('buildAdjustedFuture failed:', err);
        warnings.push('Surge forecast calculation failed');
        return { adjusted: {}, offset: 0, timeOffsetMins: 0, source: 'noaa', n: 0 };
      });

      // 4. Success - Update range ref and cache
      fetchRangeRef.current = { start: fStart, end: fEnd, stationId: stationId };

      const result: ChartData = {
        observed: observedData.data as any,
        alternate: observedData.alternate as any,
        source: observedData.source as 'fiman' | 'noaa',
        timeOffsetMins: adjustedResult.timeOffsetMins as number,
        predicted: predictions,
        adjusted: adjustedResult.adjusted,
        offset: adjustedResult.offset,
        nPoints: adjustedResult.n,
        wind: windData as any,
        precip: precipData as any,
        floodEvents,
        warnings,
        imagery: observedData.imagery as any,
      };

    const cacheKey = `${stationId}-${Math.floor(fStart.getTime() / 300000) * 300000}-${Math.floor(fEnd.getTime() / 300000) * 300000}-${configOffset.mode}-${configOffset.value}`;
      dataCache[cacheKey] = {
        timestamp: Date.now(),
        data: result
      };

      return { data: result, fromCache: false };
    } catch (error) {
      console.error('[useChartData] Fetch failed:', error);
      throw error;
    }
  // Stabilize dependencies: use primitive values from config rather than the object reference.
  // This prevents re-creating performFetch on every render, which caused triple-fire on mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeDomain, locationId, stationId, config.display.dataSource, config.offset.mode, config.offset.value, config.timeRange.mode, config.timeRange.lookaheadH]);

  // Effect to manage the loading state and race conditions
  useEffect(() => {
    let active = true;

    const { start, end } = timeDomain;
    const { offset: configOffset } = config;
    const fetchBuffer = 5 * 24 * 3600_000;
    const fStart = new Date(start.getTime() - fetchBuffer);
    const fEnd = new Date(end.getTime() + fetchBuffer);
    const cacheKey = `${stationId}-${Math.floor(fStart.getTime() / 300000) * 300000}-${Math.floor(fEnd.getTime() / 300000) * 300000}-${configOffset.mode}-${configOffset.value}`;
    const cached = dataCache[cacheKey];

    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
      setDataState({
        loading: false,
        error: null,
        data: cached.data,
      });
    } else {
      setDataState(prev => ({ ...prev, loading: true, error: null }));
    }

    performFetch()
      .then(result => {
        if (!active || !result) return;
        setDataState({
          loading: false,
          error: null,
          data: result.data,
        });
      })
      .catch(error => {
        if (!active) return;
        setDataState(prev => ({
          ...prev,
          loading: false,
          error: error.message || String(error),
        }));
      });

    return () => { active = false; };
  }, [performFetch, timeDomain, stationId, config.offset.mode, config.offset.value]);

  const processedData = useMemo(() => {
    const { data } = dataState;
    const { start, end, now } = timeDomain;

    // Note: We deliberately DO NOT filter points to start/end here anymore,
    // so that the ChartViewer can scroll into the buffered data (+/- 5 days).
    const shiftMs = data.timeOffsetMins ? data.timeOffsetMins * 60000 : 0;
    
    // Observed points are our ground truth at clock time.
    // We merge the primary source (usually FiMAN local sensors) with the 
    // alternate source (official NOAA station data) to bridge any gaps up to 'now'.
    const primaryPoints = seriesToPoints(data.observed, data.source);
    const lastPrimary = primaryPoints.length > 0 ? primaryPoints[primaryPoints.length - 1] : null;
    const lastPrimaryT = lastPrimary?.t.getTime() || 0;
    
    // To prevent "non-linear" jumps at the handover point, we calculate the 
    // vertical difference between sources at the last common or nearest timestamp.
    let fallbackOffset = 0;
    const allAltPoints = seriesToPoints(data.alternate || {}, 'noaa');
    
    if (lastPrimary && allAltPoints.length > 0) {
      // Find nearest alternate point to the last primary point to compute offset
      let minDt = Infinity;
      let nearestV = 0;
      for (const p of allAltPoints) {
        const dt = Math.abs(p.t.getTime() - lastPrimaryT);
        if (dt < minDt) {
          minDt = dt;
          nearestV = p.v;
        }
      }
      // Only apply offset if the nearest point is within 15 minutes
      if (minDt <= 15 * 60000) {
        fallbackOffset = lastPrimary.v - nearestV;
      }
    }

    const alternatePoints = allAltPoints
      .filter(p => p.t.getTime() > lastPrimaryT)
      .map(p => ({ ...p, v: p.v + fallbackOffset }));

    // Combine, filter to prevent future 'observations' from NOAA, and explicitly sort
    // to ensure lastObs is truly the latest point.
    const observedPoints = [...primaryPoints, ...alternatePoints]
      .filter(p => p.t.getTime() <= now.getTime() + 600000) // Max 10 mins into future
      .sort((a, b) => a.t.getTime() - b.t.getTime());

    // Apply time offset to localized predicted points (Phase Alignment)
    // This shifts the raw NOAA tide to match the local station's timing
    const predictedPoints: Point[] = Object.entries(data.predicted)
      .map(([k, v]) => ({
        t: new Date(new Date(k).getTime() + shiftMs),
        v: v as number,
        source: 'noaa' as const
      }))
      .sort((a, b) => a.t.getTime() - b.t.getTime());

    // Calculate current 'Live Surge' for the forecast
    // We use the most recent observation vs the localized prediction for a seamless lineup
    const lastObs = observedPoints.length > 0 ? observedPoints[observedPoints.length - 1] : null;
    const liveSurge = lastObs 
      ? lastObs.v - (predictedPoints.find(p => Math.abs(p.t.getTime() - lastObs.t.getTime()) < 360000)?.v ?? lastObs.v)
      : (data.offset ?? 0);

    const effectiveOffset = config.offset.mode === 'manual'
      ? (parseFloat(config.offset.value) || 0)
      : liveSurge;

    // Calculate Adjusted Points (FloodCast) - Forecast Only
    // To prevent any overlap or "double lines", we filter for points strictly AFTER the last observation
    const lastObsT = lastObs?.t.getTime() || now.getTime();
    const adjustedPoints: Point[] = Object.entries(data.predicted)
      .map(([k, v]) => ({
        t: new Date(new Date(k).getTime() + shiftMs),
        v: (v as number) + effectiveOffset
      }))
      .filter(p => p.t.getTime() > lastObsT) // Strictly after
      .sort((a, b) => a.t.getTime() - b.t.getTime());

    // Prepend the last observation point to the adjusted series to ensure 
    // the lines meet perfectly at the handover point with no gap or overlap.
    if (lastObs) {
      adjustedPoints.unshift({ ...lastObs, source: 'fiman' });
    }

    const deltaPoints: Point[] = [];
    for (const obsPoint of observedPoints) {
      // Find nearest localized prediction
      const nearest = predictedPoints.reduce((best, predPoint) => {
        const dtMin = Math.abs(predPoint.t.getTime() - obsPoint.t.getTime()) / 60000;
        const bestDt = best ? Math.abs(best.t.getTime() - obsPoint.t.getTime()) / 60000 : Infinity;
        return dtMin < bestDt && dtMin <= 10 ? predPoint : best;
      }, null as Point | null);

      if (nearest) {
        deltaPoints.push({ t: obsPoint.t, v: obsPoint.v - nearest.v });
      }
    }

    const surgeForecastPoints: Point[] = predictedPoints
      .filter(p => p.t.getTime() >= now.getTime())
      .map(p => ({ t: p.t, v: effectiveOffset }));

    // Compass direction lookup for legacy Firestore records where direction was stored as a string
    // (NWS forecast API returns "E", "SE", etc. — the ETL fix now converts these, but old data may remain).
    const COMPASS_TO_DEG_FE: Record<string, number> = {
      N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
      E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
      S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
      W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
    };
    const toWindDeg = (dir: unknown): number => {
      if (typeof dir === 'number' && isFinite(dir)) return dir;
      if (typeof dir === 'string') return COMPASS_TO_DEG_FE[dir.trim().toUpperCase()] ?? 0;
      return 0;
    };

    const windPoints: WindPoint[] = Object.entries(data.wind || {})
      .map(([k, v]) => ({ t: new Date(k), speed: (v as any).speed, dir: toWindDeg((v as any).dir) }))
      .sort((a, b) => a.t.getTime() - b.t.getTime());

    const precipPoints: PrecipPoint[] = Object.entries(data.precip || {})
      .map(([k, v]) => ({ t: new Date(k), value: v as number }))
      .sort((a, b) => a.t.getTime() - b.t.getTime());

    return {
      observedPoints,
      predictedPoints,
      adjustedPoints,
      deltaPoints,
      windPoints,
      precipPoints,
      effectiveOffset,
      timeOffsetMins: data.timeOffsetMins,
      surgeForecastPoints: adjustedPoints, // For Tab2.tsx compatibility
      timeDomain,
      warnings: data.warnings,
      imagery: data.imagery,
      floodEvents: data.floodEvents,
      source: data.source,
      thresholdCrossing: ((): ThresholdCrossing | null => {
        // Use the phase-aligned adjusted points if available, otherwise fallback to phase-aligned predicted
        const seriesForCrossing = adjustedPoints.length > 0 ? adjustedPoints : predictedPoints;
        
        // We need to find the next point in the series that exceeds the threshold
        const nextCrossing = seriesForCrossing.find(p => p.t.getTime() > now.getTime() && p.v >= config.thresholds.minor);
        if (!nextCrossing) return null;

        return {
          time: nextCrossing.t,
          level: nextCrossing.v,
          threshold: config.thresholds.minor
        };
      })()
    };
  }, [dataState.data, timeDomain, config.offset.mode, config.offset.value, config.thresholds.minor]);

  return {
    ...dataState,
    processedData,
    thresholdCrossing: processedData?.thresholdCrossing ?? null,
    refresh: () => performFetch(true),
  };
}

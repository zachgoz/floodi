import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { buildAdjustedFuture, fetchObservedWaterLevels, fetchPredictions, findNextThresholdCrossing, fetchWind, fetchPrecipitation } from '../../../lib/noaa';
import type { ChartData, DataState, Point, ThresholdCrossing, AppConfiguration, WindPoint, PrecipPoint } from '../types';

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
  // ... (lines 25-220 same)
  // ... (skipping to line 222 in current file)
  
  // (Wait, I need to provide the context correctly)
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

  const { mode, lookbackH, lookaheadH, absStart, absEnd } = config.timeRange;

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
    const { station, timeRange, offset } = config;

    // Buffer range: +/- 5 days to allow smooth scrolling without immediate refetch
    const fStart = new Date(start.getTime() - 5 * 24 * 3600 * 1000);
    const fEnd = new Date(end.getTime() + 5 * 24 * 3600 * 1000);

    // 1. Check if we already have this range covered in our buffer
    if (!force && fetchRangeRef.current && fetchRangeRef.current.stationId === station.id) {
      const buffered = fetchRangeRef.current;
      if (start >= buffered.start && end <= buffered.end) {
        return { data: dataState.data, fromCache: true };
      }
    }

    try {
      const lookahead = timeRange.mode === 'relative' ? (timeRange.lookaheadH + 120) : 
        Math.max(1, Math.ceil((fEnd.getTime() - now.getTime()) / 3600_000));

      const warnings: string[] = [];

      // 2. Fetch base data in parallel
      const [observed, predicted, windData, precipData] = await Promise.all([
        fetchObservedWaterLevels({
          station: station.id,
          start: fStart,
          end: fEnd,
          interval: 6,
          datum: 'MLLW',
          units: 'english',
          provider: 'both',
        }).catch(err => {
          console.warn('fetchObservedWaterLevels failed:', err);
          warnings.push('Observed water level data unavailable');
          return { data: {}, source: 'noaa' as const, alternate: {}, imagery: {} };
        }),

        fetchPredictions({
          station: station.id,
          start: fStart,
          end: fEnd,
          interval: 6,
          datum: 'MLLW',
          units: 'english',
        }).catch(err => {
          console.warn('fetchPredictions failed:', err);
          warnings.push('Tide predictions unavailable');
          return {};
        }),

        fetchWind({
          station: station.id,
          start: fStart,
          end: fEnd,
          units: 'english',
        }).catch(err => {
          console.warn('fetchWind failed:', err);
          warnings.push('Wind data unavailable');
          return {};
        }),

        fetchPrecipitation({
          station: station.id,
          start: fStart,
          end: fEnd,
          units: 'english',
        }).catch(err => {
          console.warn('fetchPrecipitation failed:', err);
          warnings.push('Precipitation data unavailable');
          return {};
        }),
      ]);

      // 3. Calculate adjusted forecast
      const adjustedResult = await buildAdjustedFuture({
        station: station.id,
        now,
        lookbackHours: 6,
        lookaheadHours: lookahead,
        interval: 6,
        datum: 'MLLW',
        units: 'english',
        existingObserved: observed.data,
        existingPredicted: predicted
      }).catch(err => {
        console.warn('buildAdjustedFuture failed:', err);
        warnings.push('Surge forecast calculation failed');
        return { adjusted: {}, offset: 0, timeOffsetMins: 0, source: 'noaa', n: 0 };
      });

      // 4. Success - Update range ref and cache
      fetchRangeRef.current = { start: fStart, end: fEnd, stationId: station.id };

      const result: ChartData = {
        observed: observed.data as any,
        alternate: observed.alternate as any,
        source: observed.source as 'fiman' | 'noaa',
        timeOffsetMins: adjustedResult.timeOffsetMins as number,
        predicted,
        adjusted: adjustedResult.adjusted,
        offset: adjustedResult.offset,
        nPoints: adjustedResult.n,
        wind: windData as any,
        precip: precipData as any,
        warnings,
        imagery: (observed as any).imagery,
      };

    const cacheKey = `${station.id}-${Math.floor(fStart.getTime() / 300000) * 300000}-${Math.floor(fEnd.getTime() / 300000) * 300000}-${offset.mode}-${offset.value}`;
      dataCache[cacheKey] = {
        timestamp: Date.now(),
        data: result
      };

      return { data: result, fromCache: false };
    } catch (error) {
      console.error('[useChartData] Fetch failed:', error);
      throw error;
    }
  }, [timeDomain, config, dataState.data]);

  // Effect to manage the loading state and race conditions
  useEffect(() => {
    let active = true;

    const { start, end } = timeDomain;
    const { station, offset } = config;
    const fetchBuffer = 5 * 24 * 3600_000;
    const fStart = new Date(start.getTime() - fetchBuffer);
    const fEnd = new Date(end.getTime() + fetchBuffer);
    const cacheKey = `${station.id}-${Math.floor(fStart.getTime() / 300000) * 300000}-${Math.floor(fEnd.getTime() / 300000) * 300000}-${offset.mode}-${offset.value}`;
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
  }, [performFetch, timeDomain, config.station.id, config.offset.mode, config.offset.value]);

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

    const windPoints: WindPoint[] = Object.entries(data.wind || {})
      .map(([k, v]) => ({ t: new Date(k), speed: (v as any).speed, dir: (v as any).dir }))
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
  }, [dataState.data, timeDomain, config.offset, config.thresholds.minor]);

  return {
    ...dataState,
    processedData,
    thresholdCrossing: processedData?.thresholdCrossing ?? null,
    refresh: () => performFetch(true),
  };
}

import { useState, useEffect, useCallback, useMemo } from 'react';
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
function seriesToPoints(series: Record<string, number>): Point[] {
  return Object.entries(series)
    .map(([k, v]) => ({ t: new Date(k), v }))
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

  // Main data fetching logic
  const performFetch = useCallback(async (isManual = false) => {
    const { start, end, now } = timeDomain;
    const { station, timeRange, offset } = config;

    // 1. Calculate fetch boundaries with a 5-day buffer for seamless scrolling
    const fetchBuffer = 5 * 24 * 3600_000; // 5 days
    const fStart = new Date(start.getTime() - fetchBuffer);
    const fEnd = new Date(end.getTime() + fetchBuffer);

    // 2. Check Cache
    const cacheKey = `${station.id}-${fStart.getTime()}-${fEnd.getTime()}-${offset.mode}-${offset.value}`;
    const cached = dataCache[cacheKey];
    if (!isManual && cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
      return { data: cached.data, fromCache: true };
    }


    try {
      const lookahead = timeRange.mode === 'relative' ? (timeRange.lookaheadH + 120) : // Add 5 days in hours
        Math.max(1, Math.ceil((fEnd.getTime() - now.getTime()) / 3600_000));

      // We use Promise.all to fetch everything in parallel
      const [adjustedResult, observed, predicted, windData, precipData] = await Promise.all([
        buildAdjustedFuture({
          station: station.id,
          now,
          lookbackHours: 6,
          lookaheadHours: lookahead,
          interval: 6,
          datum: 'MLLW',
          units: 'english',
        }).catch(err => {
          console.warn('buildAdjustedFuture failed:', err);
          return { adjusted: {}, offset: 0, n: 0 };
        }),

        (fStart < now) ? fetchObservedWaterLevels({
          station: station.id,
          start: fStart,
          end: new Date(Math.min(fEnd.getTime(), now.getTime())),
          interval: 6,
          datum: 'MLLW',
          units: 'english',
        }).catch(err => {
          console.warn('fetchObservedWaterLevels failed:', err);
          return {};
        }) : Promise.resolve({}),

        fetchPredictions({
          station: station.id,
          start: fStart,
          end: new Date(Math.max(fEnd.getTime(), fStart.getTime() + 60_000)),
          interval: 6,
          datum: 'MLLW',
          units: 'english',
        }).catch(err => {
          console.warn('fetchPredictions failed:', err);
          return {};
        }),

        fetchWind({
          station: station.id,
          start: fStart,
          end: fEnd,
          units: 'english',
        }).catch(err => {
          console.warn('fetchWind failed:', err);
          return {};
        }),

        fetchPrecipitation({
          station: station.id,
          start: fStart,
          end: fEnd,
          units: 'english',
        }).catch(err => {
          console.warn('fetchPrecipitation failed:', err);
          return {};
        }),
      ]);

      const result = {
        observed,
        predicted,
        adjusted: adjustedResult.adjusted,
        offset: adjustedResult.offset,
        nPoints: adjustedResult.n,
        wind: windData as any,
        precip: precipData as any,
      };

      // Update cache
      dataCache[cacheKey] = {
        timestamp: Date.now(),
        data: result
      };

      return { data: result, fromCache: false };
    } catch (error) {
      console.error('[useChartData] Fetch failed:', error);
      throw error;
    }
  }, [timeDomain, config.station.id, config.offset.mode, config.offset.value]);

  // Effect to manage the loading state and race conditions
  useEffect(() => {
    let active = true;

    // 1. Synchronously check cache to avoid flicker
    const { start, end } = timeDomain;
    const { station, offset } = config;
    const fetchBuffer = 5 * 24 * 3600_000;
    const fStart = new Date(start.getTime() - fetchBuffer);
    const fEnd = new Date(end.getTime() + fetchBuffer);
    const cacheKey = `${station.id}-${fStart.getTime()}-${fEnd.getTime()}-${offset.mode}-${offset.value}`;
    const cached = dataCache[cacheKey];

    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
      setDataState({
        loading: false,
        error: null,
        data: cached.data,
      });
      // We still run performFetch in the background to refresh if needed,
      // but without showing the loading state.
    } else {
      setDataState(prev => ({ ...prev, loading: true, error: null }));
    }

    performFetch()
      .then(result => {
        if (!active) return;
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
    const observedPoints = seriesToPoints(data.observed);
    const predictedPoints = seriesToPoints(data.predicted);

    const effectiveOffset = config.offset.mode === 'manual'
      ? (parseFloat(config.offset.value) || 0)
      : (data.offset ?? 0);

    const adjustedSeries: Record<string, number> = {};
    const nowMs = now.getTime();

    for (const [k, v] of Object.entries(data.predicted)) {
      const t = new Date(k).getTime();
      if (t >= nowMs) {
        adjustedSeries[k] = v + effectiveOffset;
      }
    }

    const adjustedPoints = seriesToPoints(adjustedSeries);

    const deltaPoints: Point[] = [];
    for (const obsPoint of observedPoints) {
      const nearest = predictedPoints.reduce((best, predPoint) => {
        const dtMin = Math.abs(predPoint.t.getTime() - obsPoint.t.getTime()) / 60000;
        const bestDt = best ? Math.abs(best.t.getTime() - obsPoint.t.getTime()) / 60000 : Infinity;
        return dtMin < bestDt && dtMin <= 9 ? predPoint : best;
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
      surgeForecastPoints,
      windPoints,
      precipPoints,
      effectiveOffset,
      timeDomain,
    };
  }, [dataState.data, timeDomain, config.offset]);

  const thresholdCrossing = useMemo((): ThresholdCrossing | null => {
    const { data } = dataState;
    const { now } = timeDomain;
    const seriesForCrossing = Object.keys(data.adjusted).length > 0 ? data.adjusted : data.predicted;
    return findNextThresholdCrossing(seriesForCrossing, config.thresholds.minor, now);
  }, [dataState.data, timeDomain.now, config.thresholds.minor]);

  return {
    ...dataState,
    processedData,
    thresholdCrossing,
    refresh: () => performFetch(true),
  };
}

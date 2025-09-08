import { useState, useEffect, useCallback, useMemo } from 'react';
import { buildAdjustedFuture, fetchObservedWaterLevels, fetchPredictions, findNextThresholdCrossing } from '../../../lib/noaa';
import type { ChartData, DataState, Point, ThresholdCrossing, AppConfiguration } from '../types';

/**
 * Convert NOAA series data to Point array format
 * @param series Record of timestamp keys to numeric values
 * @returns Sorted array of Points
 */
function seriesToPoints(series: Record<string, number>): Point[] {
  return Object.entries(series)
    .map(([k, v]) => ({ t: new Date(k), v }))
    .sort((a, b) => a.t.getTime() - b.t.getTime());
}

/**
 * Custom hook for fetching and processing NOAA chart data
 * 
 * @param config Application configuration containing station, time range, etc.
 * @returns Data state, refresh function, and processed chart data
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
    },
  });

  /**
   * Calculate time domain based on current configuration
   */
  const timeDomain = useMemo(() => {
    const now = new Date();
    const { timeRange } = config;
    
    if (timeRange.mode === 'relative') {
      return {
        start: new Date(now.getTime() - timeRange.lookbackH * 3600_000),
        end: new Date(now.getTime() + timeRange.lookaheadH * 3600_000),
        now,
      };
    } else {
      return {
        start: new Date(timeRange.absStart),
        end: new Date(timeRange.absEnd),
        now,
      };
    }
  }, [config.timeRange]);

  /**
   * Fetch and process all required data from NOAA APIs
   */
  const fetchData = useCallback(async () => {
    setDataState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const { start, end, now } = timeDomain;
      const { station, timeRange } = config;
      
      // Build adjusted future (includes surge offset calculation)
      const adjustedResult = await buildAdjustedFuture({
        station: station.id,
        now,
        lookbackHours: 6,
        lookaheadHours: timeRange.mode === 'relative' ? timeRange.lookaheadH : 
          Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60)),
        interval: 6,
        datum: 'MLLW',
        units: 'english',
      });

      // Fetch observed water levels for the past period
      const observed = await fetchObservedWaterLevels({
        station: station.id,
        start,
        end: now,
        interval: 6,
        datum: 'MLLW',
        units: 'english',
      });

      // Fetch predictions for the entire time range
      const predicted = await fetchPredictions({
        station: station.id,
        start,
        end,
        interval: 6,
        datum: 'MLLW',
        units: 'english',
      });

      const chartData: ChartData = {
        observed,
        predicted,
        adjusted: adjustedResult.adjusted,
        offset: adjustedResult.offset,
        nPoints: adjustedResult.n,
      };

      setDataState({
        loading: false,
        error: null,
        data: chartData,
      });
    } catch (error: any) {
      setDataState(prev => ({
        ...prev,
        loading: false,
        error: error?.message || String(error),
      }));
    }
  }, [timeDomain, config]);

  // Auto-refresh data when configuration changes
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /**
   * Process chart data into filtered point arrays based on current domain
   */
  const processedData = useMemo(() => {
    const { data } = dataState;
    const { start, end, now } = timeDomain;
    
    // Convert to points and filter by domain
    const observedPoints = seriesToPoints(data.observed)
      .filter(p => p.t >= start && p.t <= end);
    
    const predictedPoints = seriesToPoints(data.predicted)
      .filter(p => p.t >= start && p.t <= end);

    // Calculate effective offset based on mode
    const effectiveOffset = config.offset.mode === 'manual' 
      ? (() => {
          const manualValue = parseFloat(config.offset.value);
          return !Number.isNaN(manualValue) ? manualValue : 0;
        })()
      : data.offset ?? 0;

    // Generate adjusted series (predictions + offset for future times only)
    const adjustedSeries: Record<string, number> = {};
    const nowMs = now.getTime();
    
    for (const [k, v] of Object.entries(data.predicted)) {
      const t = new Date(k).getTime();
      if (t >= nowMs) {
        adjustedSeries[k] = v + effectiveOffset;
      }
    }

    const adjustedPoints = seriesToPoints(adjustedSeries)
      .filter(p => p.t >= start && p.t <= end);

    // Calculate delta points (observed - predicted at matching timestamps)
    const deltaPoints: Point[] = [];
    for (const obsPoint of observedPoints) {
      // Find nearest predicted point within 9 minutes
      const nearest = predictedPoints.reduce((best, predPoint) => {
        const dtMin = Math.abs(predPoint.t.getTime() - obsPoint.t.getTime()) / 60000;
        const bestDt = best ? Math.abs(best.t.getTime() - obsPoint.t.getTime()) / 60000 : Infinity;
        return dtMin < bestDt && dtMin <= 9 ? predPoint : best;
      }, null as Point | null);

      if (nearest) {
        deltaPoints.push({ t: obsPoint.t, v: obsPoint.v - nearest.v });
      }
    }

    return {
      observedPoints,
      predictedPoints,
      adjustedPoints,
      deltaPoints,
      effectiveOffset,
      timeDomain,
    };
  }, [dataState.data, timeDomain, config.offset]);

  /**
   * Find next threshold crossing in adjusted data
   */
  const thresholdCrossing = useMemo((): ThresholdCrossing | null => {
    const { data } = dataState;
    const { now } = timeDomain;
    
    // Use adjusted data if available, otherwise fall back to predicted
    const seriesForCrossing = Object.keys(data.adjusted).length > 0 
      ? data.adjusted 
      : data.predicted;
      
    return findNextThresholdCrossing(seriesForCrossing, config.threshold, now);
  }, [dataState.data, timeDomain.now, config.threshold]);

  return {
    ...dataState,
    processedData,
    thresholdCrossing,
    refresh: fetchData,
  };
}
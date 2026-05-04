import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { buildAdjustedFuture, fetchObservedWaterLevels, fetchPredictions, findNextThresholdCrossing, fetchWind, fetchPrecipitation } from '../../../lib/noaa';
import type { ChartData, DataState, Point, ThresholdCrossing, AppConfiguration, WindPoint, PrecipPoint } from '../types';

/**
 * Module-level cache to persist data across hook remounts and prevent redundant network requests.
 * Key format: {stationId}-{fStartMs}-{fEndMs}
 */
const dataCache: Record<string, { timestamp: number; data: any }> = {};
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

const BUCKET_SIZE_MS = 30 * 24 * 3600 * 1000; // 30 days
const REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // Refresh "current" bucket every 5 mins

/**
 * Returns the start of the 30-day bucket for a given timestamp.
 * We use absolute UTC buckets to ensure stable URLs across sessions/users.
 */
function getBucketStart(timestamp: number): number {
  return Math.floor(timestamp / BUCKET_SIZE_MS) * BUCKET_SIZE_MS;
}

/**
 * Convert NOAA series data to Point array format
 */
function seriesToPoints(series: Record<string, number>, source?: 'fiman' | 'noaa'): Point[] {
  return Object.entries(series)
    .map(([k, v]) => ({ t: new Date(k), v, source }))
    .sort((a, b) => a.t.getTime() - b.t.getTime());
}

/**
 * Merges two ChartData objects by combining their time-series records.
 * Records are indexed by ISO timestamps, so duplicates are automatically handled.
 */
function mergeChartData(oldData: ChartData, newData: ChartData): ChartData {
  const mergeRecords = <T>(oldRec: Record<string, T> = {}, newRec: Record<string, T> = {}) => ({
    ...oldRec,
    ...newRec,
  });

  const mergeImagery = (oldImg: ChartData['imagery'] = {}, newImg: ChartData['imagery'] = {}) => {
    const merged = { ...oldImg };
    for (const [stationId, images] of Object.entries(newImg || {})) {
      merged[stationId] = { ...(merged[stationId] || {}), ...images };
    }
    return merged;
  };

  // Preserve 'fiman' source if it exists in either set
  const mergedSource = (oldData.source === 'fiman' || newData.source === 'fiman') ? 'fiman' : 'noaa';

  return {
    ...newData,
    source: mergedSource,
    observed: mergeRecords(oldData.observed, newData.observed),
    alternate: mergeRecords(oldData.alternate, newData.alternate),
    predicted: mergeRecords(oldData.predicted, newData.predicted),
    // Adjusted forecast and current offset should always come from the most recent (newest) fetch
    // as they are derived from the state of 'now'.
    adjusted: Object.keys(newData.adjusted || {}).length > 0 ? newData.adjusted : oldData.adjusted,
    offset: newData.offset !== null ? newData.offset : oldData.offset,
    nPoints: newData.nPoints > 0 ? newData.nPoints : oldData.nPoints,
    wind: mergeRecords(oldData.wind, newData.wind),
    precip: mergeRecords(oldData.precip, newData.precip),
    imagery: mergeImagery(oldData.imagery, newData.imagery),
    warnings: Array.from(new Set([...(oldData.warnings || []), ...(newData.warnings || [])])),
  };
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
  const fetchedBucketsRef = useRef<Map<number, number>>(new Map()); // bucketStart -> lastFetchTimestamp

  // Main data fetching logic
  const performFetch = useCallback(async (force = false) => {
    const { start, end, now } = timeDomain;
    const { station, timeRange, offset } = config;

    // 1. Reset buckets if station changed
    if (fetchRangeRef.current?.stationId !== station.id) {
      fetchedBucketsRef.current.clear();
      fetchRangeRef.current = null;
    }

    // 2. Identify required buckets
    const startBucket = getBucketStart(start.getTime());
    const endBucket = getBucketStart(end.getTime());
    const requiredBuckets: number[] = [];
    
    for (let b = startBucket; b <= endBucket; b += BUCKET_SIZE_MS) {
      requiredBuckets.push(b);
    }

    // 3. Determine which buckets need fetching
    const bucketsToFetch = requiredBuckets.filter(bStart => {
      if (force) return true;
      const lastFetch = fetchedBucketsRef.current.get(bStart);
      if (!lastFetch) return true; // Never fetched
      
      // If this bucket contains 'now' or is in the future, refresh it periodically
      if (bStart + BUCKET_SIZE_MS > now.getTime()) {
        return Date.now() - lastFetch > REFRESH_THRESHOLD_MS;
      }
      
      return false; // Historical bucket, already fetched
    });

    if (bucketsToFetch.length === 0) {
      return null;
    }

    try {
      const warnings: string[] = [];
      const fetchPromises = bucketsToFetch.map(async (bStart) => {
        const bEnd = bStart + BUCKET_SIZE_MS;
        const s = new Date(bStart);
        const e = new Date(bEnd);

        // Fetch everything for this chunk
        const [obs, pred, wind, prec] = await Promise.all([
          fetchObservedWaterLevels({
            station: station.id,
            start: s,
            end: e,
            interval: 6,
            datum: 'MLLW',
            units: 'english',
            provider: 'both',
          }).catch(() => ({ data: {}, source: 'noaa' as const, alternate: {}, imagery: {} })),

          fetchPredictions({
            station: station.id,
            start: s,
            end: e,
            interval: 6,
            datum: 'MLLW',
            units: 'english',
          }).catch(() => ({})),

          fetchWind({
            station: station.id,
            start: s,
            end: e,
            units: 'english',
          }).catch(() => ({})),

          fetchPrecipitation({
            station: station.id,
            start: s,
            end: e,
            units: 'english',
          }).catch(() => ({})),
        ]);

        fetchedBucketsRef.current.set(bStart, Date.now());

        return {
          observed: obs.data,
          alternate: obs.alternate,
          source: obs.source,
          predicted: pred,
          wind,
          precip: prec,
          imagery: obs.imagery
        };
      });

      const chunkResults = await Promise.all(fetchPromises);

      // 4. Merge results
      const mergedResult: ChartData = {
        observed: {},
        predicted: {},
        adjusted: {},
        offset: null,
        nPoints: 0,
        wind: {},
        precip: {},
        imagery: {},
        warnings: [],
        source: 'noaa',
        timeOffsetMins: 60
      };

      for (const res of chunkResults) {
        Object.assign(mergedResult.observed, res.observed);
        if (res.alternate) Object.assign(mergedResult.alternate || (mergedResult.alternate = {}), res.alternate);
        Object.assign(mergedResult.predicted, res.predicted);
        Object.assign(mergedResult.wind!, res.wind ?? {});
        Object.assign(mergedResult.precip!, res.precip ?? {});
        if (res.imagery) {
          for (const [sid, imgs] of Object.entries(res.imagery)) {
            mergedResult.imagery![sid] = { ...(mergedResult.imagery![sid] || {}), ...imgs };
          }
        }
        if (res.source === 'fiman') mergedResult.source = 'fiman';
      }

      // 5. Calculate adjusted forecast (Surge)
      // This should always be based on the latest data across the whole set,
      // but buildAdjustedFuture only needs a 6h lookback by default.
      // We pass the merged data so it doesn't have to refetch.
      const adjustedResult = await buildAdjustedFuture({
        station: station.id,
        now,
        lookbackHours: 6,
        lookaheadHours: timeRange.mode === 'relative' ? (timeRange.lookaheadH + 120) : 
          Math.max(1, Math.ceil((end.getTime() - now.getTime()) / 3600_000)),
        interval: 6,
        datum: 'MLLW',
        units: 'english',
        existingObserved: mergedResult.observed,
        existingPredicted: mergedResult.predicted
      }).catch(err => {
        console.warn('buildAdjustedFuture failed:', err);
        return { adjusted: {}, offset: 0, timeOffsetMins: 60, source: 'noaa' as const, n: 0 };
      });

      mergedResult.adjusted = adjustedResult.adjusted;
      mergedResult.offset = adjustedResult.offset;
      mergedResult.timeOffsetMins = adjustedResult.timeOffsetMins;
      mergedResult.nPoints = adjustedResult.n;

      fetchRangeRef.current = { start: new Date(startBucket), end: new Date(endBucket + BUCKET_SIZE_MS), stationId: station.id };

      return { data: mergedResult, fromCache: false };
    } catch (error) {
      console.error('[useChartData] Fetch failed:', error);
      throw error;
    }
  }, [timeDomain, config]);

  // Effect to manage the loading state and race conditions
  useEffect(() => {
    let active = true;

    const { start, end } = timeDomain;
    const { station, offset } = config;
    const isNewStation = !fetchRangeRef.current || fetchRangeRef.current.stationId !== station.id;
    
    const cacheKey = `${station.id}-${offset.mode}-${offset.value}`;
    const cached = dataCache[cacheKey];

    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
      setDataState({
        loading: false,
        fetchingMore: false,
        error: null,
        data: cached.data,
      });
    } else if (isNewStation || !fetchRangeRef.current) {
      // Clear data for new station or initial load
      setDataState({
        loading: true,
        fetchingMore: false,
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
    } else {
      // For incremental extensions, don't show the full-screen spinner
      // This keeps the chart responsive while loading history
      setDataState(prev => ({ ...prev, loading: false, fetchingMore: true, error: null }));
    }

    performFetch()
      .then(result => {
        if (!active) return;
        if (!result) {
          setDataState(prev => ({ ...prev, loading: false, fetchingMore: false }));
          return;
        }
        setDataState(prev => {
          const merged = isNewStation ? result.data : mergeChartData(prev.data, result.data);
          
          // Update cache with merged data
          const cacheKey = `${station.id}-${offset.mode}-${offset.value}`;
          dataCache[cacheKey] = {
            timestamp: Date.now(),
            data: merged
          };
          
          return {
            loading: false,
            fetchingMore: false,
            error: null,
            data: merged,
          };
        });
      })
      .catch(error => {
        if (!active) return;
        setDataState(prev => ({
          ...prev,
          loading: false,
          fetchingMore: false,
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
    // 1. Identify FiMAN points
    const primaryPoints = seriesToPoints(data.observed, data.source);
    const firstPrimary = primaryPoints.length > 0 ? primaryPoints[0] : null;
    const lastPrimary = primaryPoints.length > 0 ? primaryPoints[primaryPoints.length - 1] : null;
    const firstPrimaryT = firstPrimary?.t.getTime() || Infinity;
    const lastPrimaryT = lastPrimary?.t.getTime() || 0;
    
    // To prevent "non-linear" jumps at the handover point, we calculate the 
    // vertical difference between sources at the last common or nearest timestamp.
    const allAltPoints = seriesToPoints(data.alternate || {}, 'noaa');
    
    const findNearestOffset = (anchor: Point) => {
      let minDt = Infinity;
      let nearestV = 0;
      for (const p of allAltPoints) {
        const dt = Math.abs(p.t.getTime() - anchor.t.getTime());
        if (dt < minDt) {
          minDt = dt;
          nearestV = p.v;
        }
      }
      return minDt <= 15 * 60000 ? anchor.v - nearestV : 0;
    };

    // Past Handover (Historical NOAA -> FiMAN)
    const pastFallbackOffset = firstPrimary ? findNearestOffset(firstPrimary) : 0;

    // Recent Handover (FiMAN -> Future NOAA/Recent Gaps)
    const recentFallbackOffset = lastPrimary ? findNearestOffset(lastPrimary) : 0;

    // NOAA points to fill OLDER gaps (before FiMAN history)
    const olderAltPoints = allAltPoints
      .filter(p => p.t.getTime() < firstPrimaryT)
      .map(p => ({ ...p, v: p.v + pastFallbackOffset }));

    // NOAA points to fill NEWER gaps (if FiMAN is delayed)
    const newerAltPoints = allAltPoints
      .filter(p => p.t.getTime() > lastPrimaryT)
      .map(p => ({ ...p, v: p.v + recentFallbackOffset }));

    // Combine: [NOAA Past] + [FiMAN] + [NOAA Recent Gaps]
    const observedPoints = [...olderAltPoints, ...primaryPoints, ...newerAltPoints]
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

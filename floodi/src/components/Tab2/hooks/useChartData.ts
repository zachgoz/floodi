import { parseWindDirection } from 'src/utils/weatherTimeline';
import { floodWindows } from 'src/utils/waterForecast';
import { processWaterSeries } from './processWaterSeries';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { buildAdjustedFuture, fetchPredictions as fetchNoaaPredictions } from 'src/lib/noaa';
import {
  fetchUnifiedObservations,
  clearDataServiceCache,
  fetchUnifiedPredictions,
  fetchFloodEvents,
  extractWeatherData
} from 'src/lib/dataService';
import type { ChartData, DataState, ThresholdCrossing, AppConfiguration, WindPoint, PrecipPoint } from '../types';
import { LOCATIONS } from 'src/constants/locations';
import { markPerf, measurePerf, measurePerfSync } from 'src/lib/perfLogger';

/**
 * Module-level cache to persist data across hook remounts and prevent redundant network requests.
 * Key format: {stationId}-{fStartMs}-{fEndMs}
 */
const dataCache: Record<string, { timestamp: number; data: any }> = {};
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const BUFFER_DAYS = 14;
const REFETCH_THRESHOLD_DAYS = 3;
const CACHE_BUCKET_MS = 300000;

const dataCacheKey = (
  stationId: string,
  start: Date,
  end: Date,
  offsetMode: AppConfiguration['offset']['mode'],
  offsetValue: string,
  dataSource: AppConfiguration['display']['dataSource']
) => `${stationId}-${Math.floor(start.getTime() / CACHE_BUCKET_MS) * CACHE_BUCKET_MS}-${Math.floor(end.getTime() / CACHE_BUCKET_MS) * CACHE_BUCKET_MS}-${offsetMode}-${offsetValue}-${dataSource}`;

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


  const { locationId, timeRange } = config;
  const location = LOCATIONS[locationId] || LOCATIONS['carolina-beach'];
  const stationId = location.noaaStationId;

  const { mode, lookbackH, lookaheadH, absStart, absEnd } = timeRange;

  const [liveTick, setLiveTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setLiveTick(t => t + 1), 5 * 60_000);
    return () => clearInterval(timer);
  }, []);
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
  }, [mode, lookbackH, lookaheadH, absStart, absEnd, liveTick]);

  const fetchRangeRef = useRef<{
    start: Date;
    end: Date;
    stationId: string;
    dataSource: AppConfiguration['display']['dataSource'];
    timestamp: number;
  } | null>(null);
  const fetchRevisionRef = useRef(0);
  const backgroundTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latestDataRef = useRef(dataState.data);
  latestDataRef.current = dataState.data;
  const chartReadyRef = useRef(false);

  // Main data fetching logic
  const performFetch = useCallback(async (force = false, buffered = false, parentRevision?: number) => {
    if (parentRevision !== undefined && parentRevision !== fetchRevisionRef.current) return null;
    const requestRevision = parentRevision ?? ++fetchRevisionRef.current;
    if (!buffered) clearTimeout(backgroundTimerRef.current);
    if (force) clearDataServiceCache();
    const { start, end, now } = timeDomain;
    const { timeRange, offset: configOffset } = config;
    const requestedDataSource = config.display.dataSource;

    // Paint the requested viewport and its residual/phase-alignment context first.
    // The original full panning/forecast buffer is populated after that paint.
    const expandedStart = new Date(start.getTime() - BUFFER_DAYS * 24 * 3600_000);
    const expandedEnd = new Date(end.getTime() + BUFFER_DAYS * 24 * 3600_000);
    const fStart = buffered ? expandedStart : new Date(Math.min(+start, +now - 8 * 3600_000));
    // A recently persisted historical viewport still needs the current gauge
    // anchor that its original buffer included. Do not turn it into a stale
    // residual just because the first user-visible window ends before now.
    const foregroundEnd = end < now && expandedEnd >= now ? now : end;
    const fEnd = buffered ? expandedEnd : foregroundEnd;
    const cacheKey = dataCacheKey(stationId, fStart, fEnd, configOffset.mode, configOffset.value, requestedDataSource);
    const fullCacheKey = dataCacheKey(stationId, expandedStart, expandedEnd, configOffset.mode, configOffset.value, requestedDataSource);
    const fullCache = dataCache[fullCacheKey];
    const cached = !buffered && fullCache && Date.now() - fullCache.timestamp < CACHE_TTL ? fullCache : dataCache[cacheKey];

    if (!force && cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
      fetchRangeRef.current = { start: cached === fullCache ? expandedStart : fStart, end: cached === fullCache ? expandedEnd : fEnd, stationId, dataSource: requestedDataSource, timestamp: cached.timestamp };
      markPerf('chartData.moduleCache.hit', {
        stationId,
        locationId,
        start: start.toISOString(),
        end: end.toISOString(),
      });
      return { data: cached.data, fromCache: true };
    }

    // 1. Check if we already have this range covered in our buffer
    if (
      !force &&
      fetchRangeRef.current &&
      fetchRangeRef.current.stationId === stationId &&
      fetchRangeRef.current.dataSource === requestedDataSource &&
      Date.now() - fetchRangeRef.current.timestamp < CACHE_TTL
    ) {
      const buffered = fetchRangeRef.current;
      const startEdgeDiff = (start.getTime() - buffered.start.getTime()) / (24 * 3600 * 1000);
      const endEdgeDiff = (buffered.end.getTime() - end.getTime()) / (24 * 3600 * 1000);

      // If we are within the buffer and not too close to the edges, skip fetch
      if (start >= buffered.start && end <= buffered.end &&
          startEdgeDiff > REFETCH_THRESHOLD_DAYS &&
          endEdgeDiff > REFETCH_THRESHOLD_DAYS) {
        markPerf('chartData.rangeCache.hit', {
          stationId,
          locationId,
          start: start.toISOString(),
          end: end.toISOString(),
        });
        return { data: latestDataRef.current, fromCache: true };
      }
    }

    try {
      const lookahead = timeRange.mode === 'relative' ? (timeRange.lookaheadH + 120) :
        Math.max(1, Math.ceil((expandedEnd.getTime() - now.getTime()) / 3600_000));

      const warnings: string[] = [];
      const fetchMetadata = {
        stationId,
        locationId,
        force,
        buffered,
        requestedStart: start.toISOString(),
        requestedEnd: end.toISOString(),
        fetchStart: fStart.toISOString(),
        fetchEnd: fEnd.toISOString(),
      };

      // 2. Fetch base data: Unified functions handle Firestore + Live fallback
      const [unifiedObs, unifiedPred] = await measurePerf('chartData.fetchUnifiedBundle', () => Promise.all([
        fetchUnifiedObservations(locationId, fStart, fEnd),
        fetchUnifiedPredictions(locationId, fStart, fEnd),
      ]), fetchMetadata);
      const floodEvents = fetchRangeRef.current?.stationId === stationId ? latestDataRef.current.floodEvents || [] : [];

      // Process weather data using centralized logic
      const { wind: windData, precip: precipData } = extractWeatherData({
        weather: { ...unifiedObs.weather, ...unifiedPred.weather }
      });

      // 2.1 Data Source Selection
      const preferredSource = config.display.dataSource === 'auto' ? 'fiman' : config.display.dataSource;
      const fimanHasData = Object.keys(unifiedObs.fiman || {}).length > 0;
      const noaaHasData = Object.keys(unifiedObs.noaa || {}).length > 0;

      const effectiveSource: 'fiman' | 'noaa' =
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
        const livePred = await measurePerf('chartData.fetchNoaaPredictionGap', () => fetchNoaaPredictions({
          station: stationId,
          start: new Date(Math.max(fStart.getTime(), lastDbPredT)),
          end: fEnd,
          interval: 6,
        }).catch(() => ({})), fetchMetadata);
        Object.assign(predictions, livePred);
      }

      // 3. Calculate adjusted forecast
      const adjustedResult = await measurePerf('chartData.buildAdjustedFuture', () => buildAdjustedFuture({
        station: stationId,
        now,
        lookbackHours: 6,
        lookaheadHours: lookahead,
        interval: 6,
        datum: 'MLLW',
        units: 'english',
        existingObserved: observedData.data,
        existingObservedSource: observedData.source,
        existingAlternateObserved: observedData.alternate,
        existingPredicted: predictions
      }).catch(err => {
        console.warn('buildAdjustedFuture failed:', err);
        warnings.push('Surge forecast calculation failed');
        return { adjusted: {}, offset: 0, timeOffsetMins: 0, source: 'noaa', n: 0 };
      }), fetchMetadata);

      // 4. Success - Update range ref and cache
      if (requestRevision === fetchRevisionRef.current) {
        fetchRangeRef.current = { start: fStart, end: fEnd, stationId, dataSource: requestedDataSource, timestamp: Date.now() };
      }

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

      if (requestRevision === fetchRevisionRef.current) {
        dataCache[cacheKey] = { timestamp: Date.now(), data: result };
      }

      markPerf('chartData.fetchComplete', {
        ...fetchMetadata,
        observedPoints: Object.keys(result.observed).length,
        predictedPoints: Object.keys(result.predicted).length,
        adjustedPoints: Object.keys(result.adjusted).length,
        windPoints: Object.keys(result.wind ?? {}).length,
        precipPoints: Object.keys(result.precip ?? {}).length,
        floodEvents: result.floodEvents?.length ?? 0,
        warnings: result.warnings,
        source: result.source,
      });

      return { data: result, fromCache: false };
    } catch (error) {
      console.error('[useChartData] Fetch failed:', error);
      throw error;
    }
  // Stabilize dependencies: use primitive values from config rather than the object reference.
  // This prevents re-creating performFetch on every render, which caused triple-fire on mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeDomain, locationId, stationId, config.display.dataSource, config.offset.mode, config.offset.value, config.timeRange.mode, config.timeRange.lookaheadH]);

  const warmBackground = useCallback((revision: number) => {
    clearTimeout(backgroundTimerRef.current);
    backgroundTimerRef.current = setTimeout(() => {
      if (revision !== fetchRevisionRef.current) return;
      // Independent optional reads cannot hold the first chart hostage. Every
      // completion uses the same revision guard as pull-to-refresh/settings.
      void performFetch(false, true, revision).then(result => {
        if (!result || revision !== fetchRevisionRef.current) return;
        setDataState(previous => ({ loading: false, error: null, data: {
          ...result.data, floodEvents: previous.data.floodEvents || result.data.floodEvents,
        } }));
      }).catch(() => { /* Retain the already usable foreground viewport. */ });
      void fetchFloodEvents(locationId, 50).then(events => {
        if (revision !== fetchRevisionRef.current) return;
        setDataState(previous => ({ ...previous, data: { ...previous.data, floodEvents: events } }));
      }).catch(() => { /* Historical comparisons are optional. */ });
    }, 250);
  }, [performFetch, locationId]);

  // Effect to manage the loading state and race conditions
  useEffect(() => {
    let active = true;

    const { start, end } = timeDomain;
    const fetchBuffer = BUFFER_DAYS * 24 * 3600_000;
    const fStart = new Date(start.getTime() - fetchBuffer);
    const fEnd = new Date(end.getTime() + fetchBuffer);
    const cacheKey = dataCacheKey(stationId, fStart, fEnd, config.offset.mode, config.offset.value, config.display.dataSource);
    const cached = dataCache[cacheKey];

    markPerf('chartData.effect.start', {
      stationId,
      locationId,
      start: start.toISOString(),
      end: end.toISOString(),
      hasFreshCache: !!cached && (Date.now() - cached.timestamp < CACHE_TTL),
    });

    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
      setDataState({
        loading: false,
        error: null,
        data: cached.data,
      });
    } else {
      setDataState(prev => ({ ...prev, loading: true, error: null }));
    }

    const pending = performFetch();
    const requestRevision = fetchRevisionRef.current;
    pending
      .then(result => {
        if (!active || !result || requestRevision !== fetchRevisionRef.current) return;
        setDataState({
          loading: false,
          error: null,
          data: result.data,
        });
        warmBackground(requestRevision);
      })
      .catch(error => {
        if (!active || requestRevision !== fetchRevisionRef.current) return;
        setDataState(prev => ({
          ...prev,
          loading: false,
          error: error.message || String(error),
        }));
      });

    // This stable request tracker is shared with pull-to-refresh, so cleanup
    // also invalidates manual reads when settings change or the hook unmounts.
    const requestTracker = fetchRevisionRef;
    return () => { active = false; ++requestTracker.current; clearTimeout(backgroundTimerRef.current); };
  }, [performFetch, warmBackground, timeDomain, stationId, locationId, config.display.dataSource, config.offset.mode, config.offset.value]);

  useEffect(() => {
    if (chartReadyRef.current || dataState.loading || dataState.error ||
        (Object.keys(dataState.data.observed).length < 2 && Object.keys(dataState.data.predicted).length < 2)) return;
    chartReadyRef.current = true;
    markPerf('dashboard.chart_ready');
    // No data/user metadata crosses this milestone. Central startup telemetry
    // listens separately and applies its own schema, sampling and budget.
    window.dispatchEvent(new Event('floodi:chart-ready'));
  }, [dataState]);

  const processedData = useMemo(() => {
    const data = dataState.data;
    const { now } = timeDomain;

    return measurePerfSync('chartData.processData', () => {
      // Note: We deliberately DO NOT filter points to start/end here anymore,
      // so that the ChartViewer can scroll into the buffered data (+/- 5 days).
      const {
        observedPoints, predictedPoints, adjustedPoints, deltaPoints,
        effectiveOffset, surgeForecastPoints,
      } = processWaterSeries(data, now, stationId, { mode: config.offset.mode, value: config.offset.value });

    // Compass direction lookup for legacy Firestore records where direction was stored as a string
    // (NWS forecast API returns "E", "SE", etc. — the ETL fix now converts these, but old data may remain).
    const windPoints: WindPoint[] = Object.entries(data.wind || {})
      .map(([k, v]) => ({ t: new Date(k), speed: (v as any).speed, dir: parseWindDirection((v as any).dir) }))
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
      surgeForecastPoints, // For Tab2.tsx compatibility
      timeDomain,
      loadedDomain: fetchRangeRef.current ? { start: fetchRangeRef.current.start, end: fetchRangeRef.current.end } : timeDomain,
      warnings: [...(data.warnings || []), ...(adjustedPoints.length ? ['Dashed total water level uses the existing residual persistence projection; its long-range accuracy is unvalidated.'] : ['Residual projection unavailable: observations or matching tide predictions are missing or stale.'])],
      imagery: data.imagery,
      floodEvents: data.floodEvents,
      source: data.source,
      observationStation: data.source === 'fiman' ? '30046' : stationId,
      thresholdCrossing: ((): ThresholdCrossing | null => {
        // Use the phase-aligned adjusted points if available, otherwise fallback to phase-aligned predicted
        const seriesForCrossing = adjustedPoints.length > 0 ? adjustedPoints : predictedPoints;

        const event = floodWindows(seriesForCrossing, config.thresholds.minor)
          .find(e => (e.endTime || e.lastSampleTime) > now);
        return event ? { time: event.startTime, level: config.thresholds.minor, threshold: config.thresholds.minor } : null;
      })()
      };
    }, {
      observedKeys: Object.keys(data.observed).length,
      predictedKeys: Object.keys(data.predicted).length,
      windKeys: Object.keys(data.wind ?? {}).length,
      precipKeys: Object.keys(data.precip ?? {}).length,
    });
  }, [dataState.data, timeDomain, config.offset.mode, config.offset.value, config.thresholds.minor, stationId]);

  return {
    ...dataState,
    processedData,
    thresholdCrossing: processedData?.thresholdCrossing ?? null,
    refresh: async () => {
      const pending = performFetch(true);
      const requestRevision = fetchRevisionRef.current;
      try {
        const result = await pending;
        if (result && requestRevision === fetchRevisionRef.current) {
          setDataState({ loading: false, error: null, data: result.data });
          warmBackground(requestRevision);
        }
      } catch (error) {
        if (requestRevision === fetchRevisionRef.current) {
          setDataState(previous => ({
            ...previous, loading: false,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
        throw error;
      }
    },
  };
}

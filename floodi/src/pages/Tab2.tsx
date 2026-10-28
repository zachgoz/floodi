import { LOCATIONS } from 'src/constants/locations';
import { AlertInvitation } from 'src/components/alerts/AlertInvitation';
import { CurrentConditions } from 'src/components/dashboard/CurrentConditions';
import { interpolate } from 'src/utils/waterForecast';
import { projectResidualPattern } from '../../functions/src/forecast/pattern';
import { alignForecastComparison } from 'src/utils/forecastComparison';
import { selectWaterForecast } from 'src/utils/selectWaterForecast';
import { SurgeChart } from 'src/components/dashboard/SurgeChart';
import { ForecastTimeControls } from 'src/components/dashboard/ForecastTimeControls';
import { FloodOutlook } from 'src/components/dashboard/FloodOutlook';
import { useFloodOutlook } from 'src/components/dashboard/useFloodOutlook';
import { useChallengerOutlook } from 'src/components/dashboard/useChallengerOutlook';
import type { Point } from 'src/components/Tab2/types';
import { decomposeResidualHarmonics } from 'src/utils/residualHarmonics';
import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonRefresher,
  IonRefresherContent,
  IonButtons,
  IonButton,
  IonIcon,
} from '@ionic/react';
import { settingsOutline, notificationsOutline, personCircleOutline } from 'ionicons/icons';
import { SettingsModal } from 'src/components/Tab2/SettingsModal';
import { TimeSettingsModal } from 'src/components/Tab2/TimeSettingsModal';
import { useSettingsStorage } from 'src/components/Tab2/hooks/useSettingsStorage';
import { useChartData } from 'src/components/Tab2/hooks/useChartData';
import { useAtmosphericState } from 'src/components/Tab2/hooks/useAtmosphericState';
import { useChartComments } from 'src/components/Tab2/hooks/useChartComments';
import { ChartCommentModal } from 'src/components/Tab2/ChartCommentModal';
import 'src/components/Tab2/styles/Tab2.css';
import './Tab2.css';
import 'src/components/dashboard/DashboardView.css';
import HydrographChart from 'src/components/dashboard/HydrographChart';
import AtmosphericOverlay from 'src/components/dashboard/AtmosphericOverlay';
import { findNextTideExtremum } from 'src/utils/tideExtrema';
import type { RoadProperties } from 'src/components/dashboard/InundationMap';
import InundationSimulator from 'src/components/dashboard/InundationSimulator';
import WebcamFeedCard from 'src/components/dashboard/WebcamFeedCard';
import NextFloodingEventsCard from 'src/components/dashboard/NextFloodingEventsCard';
import { WEBCAMS } from 'src/constants/webcams';
import { markPerf, measurePerf } from 'src/lib/perfLogger';
import { IntroTourOverlay } from 'src/components/onboarding/IntroTourOverlay';
import { useHistory } from 'react-router-dom';
import { floodWindows, hasUpcomingFlooding } from 'src/utils/waterForecast';
import { AdSenseUnit } from 'src/components/common/AdSenseUnit';
import { reportClientError } from 'src/lib/errorReporting';

const DeferredInundationMap = React.lazy(async () => {
  try {
    const [{ default: MapComponent }, { APIProvider }] = await Promise.all([
      import('src/components/dashboard/InundationMap'),
      import('@vis.gl/react-google-maps'),
    ]);
    const MapWithProvider = (props: React.ComponentProps<typeof MapComponent>) => (
      <APIProvider apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''}>
        <MapComponent {...props} />
      </APIProvider>
    );
    return { default: MapWithProvider };
  } catch (error) {
    // A blocked optional map chunk must not replace the working dashboard
    // with the application-wide crash recovery screen.
    reportClientError('map_unavailable', error, { provider: 'app' });
    const UnavailableMap = () => React.cloneElement(mapPlaceholder, { role: 'alert', 'aria-label': 'Flood map unavailable' }, 'Map unavailable');
    return { default: UnavailableMap };
  }
});

const mapPlaceholder = <div role="status" aria-label="Flood map loading" style={{ height: 420, width: '100%', borderRadius: 20, marginBottom: 24, background: 'var(--dash-card-bg, rgba(128, 145, 165, 0.08))' }} />;

/**
 * Professional FloodCast Tab2 Component
 * 
 * This is the completely refactored Tab2 component that replaces the original
 * 1,037-line monolithic implementation with a clean, maintainable architecture
 * using professional Ionic patterns and decomposed components.
 * 
 * @returns JSX.Element Professional FloodCast interface
 */
interface Tab2Props {
  showIntroTour?: boolean;
}

const Tab2: React.FC<Tab2Props> = ({ showIntroTour = false }) => {
  const history = useHistory();
  const pageRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    markPerf('tab2.mounted');
  }, []);

  // Settings modal state
  const [showSettings, setShowSettings] = useState(false);
  const [showTimeSettings, setShowTimeSettings] = useState(false);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [showWLInfo, setShowWLInfo] = useState(false);

  // User feedback messages
  const [messages, setMessages] = useState<{
    success?: string | null;
    error?: string | null;
  }>({});


  // Professional configuration management
  const {
    config,
    updateLocation,
    updateThresholds,
    updateOffset,
    updateTimeRange,
    updateDisplay,
    resetToDefaults,
  } = useSettingsStorage();

  // State declarations (moved up to avoid TDZ)
  const [resetCount, setResetCount] = useState(0);
  const [currentViewport, setCurrentViewport] = useState<{ start: Date; end: Date; focusTime: Date } | null>(null);
  const [manualFocusTime, setManualFocusTime] = useState<Date | null>(null);
  const [centerRequest, setCenterRequest] = useState<{ time: Date; id: number } | undefined>(undefined);
  const [viewportRequest, setViewportRequest] = useState<{ start: Date; end: Date; id: number } | undefined>();
  const [selectedCameraId, setSelectedCameraId] = useState<string>(WEBCAMS[0].id);
  const lastPersistedDomainRef = useRef<string | null>(null);

  // Professional data fetching and processing
  const {
    loading,
    error,
    data,
    processedData,
    refresh,
  } = useChartData(config);

  const { outlook, refresh: refreshOutlook } = useFloodOutlook(config.locationId);
  const {
    challenger,
    totalPoints: challengerTotalPoints,
    upperPoints: challengerUpperPoints,
    residualPoints: challengerResidualPoints,
  } = useChallengerOutlook(config.locationId);
  const [showSteadyComparison, setShowSteadyComparison] = useState(false);
  const [showChallengerComparison, setShowChallengerComparison] = useState(false);
  const FORECAST_INTERPOLATE_GAP_MS = 3 * 3600_000; // 3 hours to safely bridge 30-min to 1-hour model intervals and anchor observations

  const anchoredChallengerResidual = useMemo(() => {
    if (!challengerResidualPoints.length) return [];
    const anchor = processedData?.deltaPoints.at(-1);
    if (!anchor) return challengerResidualPoints;
    const futureChallenger = challengerResidualPoints.filter(p => +p.t > +anchor.t);
    return futureChallenger.length ? [anchor, ...futureChallenger] : [anchor];
  }, [challengerResidualPoints, processedData]);
  const anchoredChallengerTotal = useMemo(() => {
    if (!challengerTotalPoints.length) return [];
    const anchor = processedData?.observedPoints.findLast(p => !p.estimated);
    if (!anchor) return challengerTotalPoints;
    const futureChallenger = challengerTotalPoints.filter(p => +p.t > +anchor.t);
    return futureChallenger.length ? [anchor, ...futureChallenger] : [anchor];
  }, [challengerTotalPoints, processedData]);
  const anchoredChallengerUpper = useMemo(() => {
    if (!challengerUpperPoints.length) return [];
    const anchor = processedData?.observedPoints.findLast(p => !p.estimated);
    if (!anchor) return challengerUpperPoints;
    const futureChallenger = challengerUpperPoints.filter(p => +p.t > +anchor.t);
    return futureChallenger.length ? [anchor, ...futureChallenger] : [anchor];
  }, [challengerUpperPoints, processedData]);
  const patternProjection = useMemo(() => {
    if (!processedData) return null;
    const reference = { station: processedData.observationStation, datum: 'MLLW', units: 'ft' };
    return projectResidualPattern(processedData.deltaPoints, processedData.predictedPoints.map(p => p.t), processedData.timeDomain.now, reference, reference);
  }, [processedData]);
  const surgeEstimatePoints = useMemo(() => {
    if (!processedData) return [];
    const estimates = processedData.observedPoints.filter(p => p.estimated).flatMap(p => {
      const tide = interpolate(processedData.predictedPoints, p.t, FORECAST_INTERPOLATE_GAP_MS);
      return tide === null ? [] : [{ ...p, v: p.v - tide }];
    });
    const anchor = processedData.deltaPoints.at(-1);
    return estimates.length ? [...(anchor ? [anchor] : []), ...estimates] : [];
  }, [processedData, FORECAST_INTERPOLATE_GAP_MS]);
  const outlookComparison = useMemo(() => alignForecastComparison(outlook, processedData?.predictedPoints || [], { station: processedData?.observationStation || '', tideStation: LOCATIONS[config.locationId]?.noaaStationId || '', datum: 'MLLW', units: 'ft', thresholdFt: config.thresholds.minor }), [outlook, processedData, config.locationId, config.thresholds.minor]);
  const forecastCompatible = outlookComparison.compatible;
  const selectedForecast = useMemo(() => selectWaterForecast({
    outlook,
    weatherCompatible: forecastCompatible,
    weatherTotalPoints: outlookComparison.points,
    weatherResidualPoints: outlookComparison.residual,
    steadyTotalPoints: processedData?.adjustedPoints || [],
    tidePoints: processedData?.predictedPoints || [],
    now: processedData?.timeDomain.now || new Date(),
    validationNow: new Date(),
    manualOverride: config.offset.mode === 'manual',
  }), [outlook, forecastCompatible, outlookComparison, processedData, config.offset.mode]);
  const isTimesFmPrimary = Boolean(challenger && (challengerTotalPoints.length > 0 || challengerResidualPoints.length > 0));
  const weatherSelected = selectedForecast.method === 'weather' || selectedForecast.method === 'learned';
  const selectedBounds = useMemo(() => {
    const timestamps = new Set(selectedForecast.totalPoints.map(point => +point.t));
    const supported = weatherSelected ? (outlook?.points || []).filter(point => timestamps.has(Date.parse(point.t))) : [];
    return {
      lower: selectedForecast.lowerPoints ?? supported.map(point => ({ t: new Date(point.t), v: point.lowerFt })),
      upper: selectedForecast.upperPoints ?? supported.map(point => ({ t: new Date(point.t), v: point.upperFt })),
    };
  }, [weatherSelected, selectedForecast.totalPoints, selectedForecast.lowerPoints, selectedForecast.upperPoints, outlook]);

  // Dynamic 48-hour estuarine tidal harmonic decomposition (M2 12.4206h lunar semi-diurnal & S1 24h diurnal)
  // calibrated from recent observed water level residuals.
  const decomposedHarmonics = useMemo(() => {
    const anchor = processedData?.deltaPoints?.at(-1);
    return decomposeResidualHarmonics(processedData?.deltaPoints || [], anchor?.t ?? new Date(), 48);
  }, [processedData?.deltaPoints]);

  // Extract 12-hour tidal-cycle smoothed subtidal storm surge anomalies from NOAA ETSS / Challenger
  // so discrete 0.1-ft ETSS steps never flatten or distort the estuarine tidal wave.
  const subtidalStormAnomalies = useMemo(() => {
    if (!challenger?.points?.length) return [] as Point[];
    const rawSubtidal = challenger.points.map(p => ({
      tMs: Date.parse(p.t),
      v: typeof p.noaaSurgeFt === 'number' && Number.isFinite(p.noaaSurgeFt) ? p.noaaSurgeFt : p.residualFt,
    })).filter(p => Number.isFinite(p.tMs) && Number.isFinite(p.v));
    if (!rawSubtidal.length) return [] as Point[];

    const halfWinMs = 6.2103 * 3600_000;
    const smoothed = rawSubtidal.map(pt => {
      const neighbors = rawSubtidal.filter(n => Math.abs(n.tMs - pt.tMs) <= halfWinMs);
      const meanVal = neighbors.reduce((s, n) => s + n.v, 0) / neighbors.length;
      return { t: new Date(pt.tMs), v: meanVal };
    });
    const baseSubtidal0 = smoothed[0].v;
    return smoothed.map(pt => ({ t: pt.t, v: pt.v - baseSubtidal0 }));
  }, [challenger]);

  const operationalSurgePoints = useMemo(() => {
    if (!isTimesFmPrimary || !challengerResidualPoints.length) {
      return selectedForecast.residualPoints;
    }
    const chalEndMs = +challengerResidualPoints.at(-1)!.t;
    const anchor = processedData?.deltaPoints.at(-1);
    const startMs = anchor ? +anchor.t : Date.now();
    const surge: Point[] = [];
    if (anchor) surge.push(anchor);

    const futureTides = (processedData?.predictedPoints || []).filter(p => +p.t > startMs);
    if (futureTides.length > 0) {
      let lastStormAnomaly = 0;
      for (const tp of futureTides) {
        const tMs = +tp.t;
        if (tMs <= chalEndMs && subtidalStormAnomalies.length > 0) {
          const anom = interpolate(subtidalStormAnomalies, tp.t, FORECAST_INTERPOLATE_GAP_MS) ?? 0;
          lastStormAnomaly = anom;
          const subtidalTarget = decomposedHarmonics.subtidalMean + anom;
          const res = decomposedHarmonics.projectSurge(tp.t, subtidalTarget);
          surge.push({ t: tp.t, v: Math.round(res * 1000) / 1000 });
        } else {
          const hoursPast = Math.max(0, (tMs - chalEndMs) / 3600_000);
          const decayedAnom = lastStormAnomaly * Math.exp(-hoursPast / 48);
          const subtidalTarget = decomposedHarmonics.subtidalMean + decayedAnom;
          const res = decomposedHarmonics.projectSurge(tp.t, subtidalTarget);
          surge.push({ t: tp.t, v: Math.round(res * 1000) / 1000 });
        }
      }
    } else {
      for (const cp of anchoredChallengerResidual) {
        if (anchor && +cp.t <= +anchor.t) continue;
        const anom = subtidalStormAnomalies.length
          ? (interpolate(subtidalStormAnomalies, cp.t, FORECAST_INTERPOLATE_GAP_MS) ?? 0)
          : 0;
        const subtidalTarget = decomposedHarmonics.subtidalMean + anom;
        const res = decomposedHarmonics.projectSurge(cp.t, subtidalTarget);
        surge.push({ t: cp.t, v: Math.round(res * 1000) / 1000 });
      }
    }

    return surge;
  }, [isTimesFmPrimary, challengerResidualPoints, anchoredChallengerResidual, processedData, selectedForecast.residualPoints, subtidalStormAnomalies, decomposedHarmonics, FORECAST_INTERPOLATE_GAP_MS]);

  // High-resolution 6-minute TimesFM AI + NOAA ETSS operational forecast
  // that seamlessly extends to the full NOAA prediction horizon (up to 21 days)
  const operationalForecastPoints = useMemo(() => {
    if (!isTimesFmPrimary || !challengerResidualPoints.length || !processedData?.predictedPoints?.length) {
      return selectedForecast.totalPoints;
    }
    const anchor = processedData.observedPoints.findLast(p => !p.estimated);
    const startMs = anchor ? +anchor.t : Date.now();

    const points: Point[] = [];
    if (anchor) points.push(anchor);

    const futureTides = processedData.predictedPoints.filter(p => +p.t > startMs);
    const surgeMap = new Map(operationalSurgePoints.map(p => [+p.t, p.v]));

    for (const tp of futureTides) {
      const surgeVal = surgeMap.get(+tp.t) ?? interpolate(operationalSurgePoints, tp.t, FORECAST_INTERPOLATE_GAP_MS);
      if (surgeVal !== null) {
        points.push({ t: tp.t, v: Math.round((tp.v + surgeVal) * 1000) / 1000 });
      } else {
        const fallbackRes = decomposedHarmonics.projectSurge(tp.t);
        points.push({ t: tp.t, v: Math.round((tp.v + fallbackRes) * 1000) / 1000 });
      }
    }

    return points;
  }, [isTimesFmPrimary, challengerResidualPoints, processedData, selectedForecast.totalPoints, operationalSurgePoints, decomposedHarmonics, FORECAST_INTERPOLATE_GAP_MS]);

  const operationalUpper = useMemo(() => {
    if (!isTimesFmPrimary || !challengerUpperPoints.length) {
      return selectedBounds.upper;
    }
    const chalEndMs = +challengerUpperPoints.at(-1)!.t;
    const bounds: Point[] = [];
    const totalMap = new Map(operationalForecastPoints.map(p => [+p.t, p.v]));

    const anchor = processedData?.observedPoints.findLast(p => !p.estimated);
    const startMs = anchor ? +anchor.t : Date.now();
    const tideInWindow = (processedData?.predictedPoints || []).filter(p => +p.t > startMs && +p.t <= chalEndMs);
    for (const tp of tideInWindow) {
      const estTotal = totalMap.get(+tp.t) ?? tp.v;
      const rawUp = interpolate(anchoredChallengerUpper, tp.t, FORECAST_INTERPOLATE_GAP_MS);
      const rawTot = interpolate(anchoredChallengerTotal, tp.t, FORECAST_INTERPOLATE_GAP_MS);
      const spread = rawUp !== null && rawTot !== null ? Math.max(0.2, rawUp - rawTot) : 0.35;
      bounds.push({ t: tp.t, v: Math.round((estTotal + spread) * 1000) / 1000 });
    }

    const futureTides = (processedData?.predictedPoints || []).filter(p => +p.t > chalEndMs);
    for (const tp of futureTides) {
      const hoursPast = (+tp.t - chalEndMs) / 3600_000;
      const uncertainty = Math.min(1.2, 0.8 + 0.001 * hoursPast);
      const estTotal = totalMap.get(+tp.t) ?? tp.v;
      bounds.push({ t: tp.t, v: Math.round((estTotal + uncertainty) * 1000) / 1000 });
    }
    return bounds;
  }, [isTimesFmPrimary, challengerUpperPoints, anchoredChallengerUpper, anchoredChallengerTotal, selectedBounds.upper, processedData?.observedPoints, processedData?.predictedPoints, operationalForecastPoints, FORECAST_INTERPOLATE_GAP_MS]);

  const operationalForecastLabel = isTimesFmPrimary ? 'Forecast (TimesFM AI + NOAA)' : selectedForecast.tailMethod || selectedForecast.extensionMethod ? 'Extended outlook' : selectedForecast.method === 'weather' ? 'Weather forecast' : selectedForecast.method === 'learned' ? 'Short-range forecast' : selectedForecast.method === 'steady' ? 'Steady forecast' : 'Tide only';
  const operationalForecastDescription = isTimesFmPrimary
    ? 'Solid blue line shows the primary operational forecast powered by Google TimesFM foundation model combined with NOAA ETSS storm surge guidance and localized 48-hour estuarine tidal harmonics.'
    : selectedForecast.reason;

  // One selected physical forecast drives both charts and every hazard calculation.
  // Actual measurements and the near-live display estimate remain untouched.
  const forecastData = useMemo(() => processedData ? {
    ...processedData,
    adjustedPoints: operationalForecastPoints,
    surgeForecastPoints: operationalSurgePoints,
  } : null, [processedData, operationalForecastPoints, operationalSurgePoints]);

  useEffect(() => {
    markPerf('tab2.dataState', {
      loading,
      hasError: !!error,
      hasProcessedData: !!processedData,
      observedPoints: processedData?.observedPoints.length ?? 0,
      adjustedPoints: processedData?.adjustedPoints.length ?? 0,
    });
  }, [loading, error, processedData]);

  // Modularized atmospheric and simulation state
  const {
    activeAtmo,
    simulationLevel,
    setSimulationLevel,
    setIsUserSimulating,
  } = useAtmosphericState(forecastData, manualFocusTime, currentViewport);

  const resetToLive = useCallback(() => {
    lastPersistedDomainRef.current = null;
    setManualFocusTime(null);
    setIsUserSimulating(false);
    setCenterRequest({ time: new Date(), id: Date.now() });
  }, [setIsUserSimulating]);

  const handleTimeChange = useCallback((time: Date) => {
    setManualFocusTime(time);
    setCenterRequest({ time, id: Date.now() });
  }, []);

  // Reset simulation flag when the user interacts with the chart (changing focus time)
  useEffect(() => {
    if (manualFocusTime || currentViewport?.focusTime) {
      setIsUserSimulating(false);
    }
  }, [manualFocusTime, currentViewport?.focusTime, setIsUserSimulating]);

  // Track the buffered data window so we only refetch when the user scrolls
  // outside what we've already loaded (useChartData fetches a broad buffer
  // around the current domain, so minor pans should never trigger a request).
  const fetchedBufferRef = useRef<{ start: Date; end: Date } | null>(null);
  useEffect(() => {
    if (!processedData) return;
    fetchedBufferRef.current = {
      start: processedData.loadedDomain.start,
      end: processedData.loadedDomain.end,
    };
  }, [processedData]);

  /**
   * Handle location selection changes
   */
  const handleLocationChange = (locationId: string) => {
    updateLocation(locationId);
    setMessages({
      success: `Location updated to ${locationId}`,
      error: null,
    });
  };

  /**
   * Clear user messages
   */
  const clearMessages = () => {
    setMessages({});
  };


  /**
   * Handle refresh with proper error handling
   */
  type RefresherDetail = { complete: () => void };
  const handleRefresh = async (event: CustomEvent<RefresherDetail>) => {
    try {
      await Promise.all([refresh(), refreshOutlook()]);
    } catch (error: unknown) {
      setMessages({
        error: (error as { message?: string } | null)?.message || 'Failed to refresh data',
        success: null,
      });
    } finally {
      event.detail.complete();
    }
  };

  /**
   * Memoized chart configuration
   */
  const chartConfig = useMemo(() => ({
    thresholds: config.thresholds,
    showDelta: false,
    timezone: config.display.timezone,
  }), [config.thresholds, config.display.showDelta, config.display.timezone]);

  const persistViewedDomain = useCallback((start: Date, end: Date) => {
    const absStart = start.toISOString();
    const absEnd = end.toISOString();
    const domainKey = `${absStart}:${absEnd}`;
    if (lastPersistedDomainRef.current === domainKey) return;
    lastPersistedDomainRef.current = domainKey;

    updateTimeRange({
      mode: 'absolute',
      absStart,
      absEnd
    });
  }, [updateTimeRange]);

  // Stable data range request handler. Persistence happens separately via
  // persistViewedDomain; this only expands the data window when needed.
  const handleDomainChangeRequest = useCallback((start: Date, end: Date) => {
    const buf = fetchedBufferRef.current;
    if (buf && start >= buf.start && end <= buf.end) {
      // Still within the buffered window — no fetch needed, ChartViewer
      // already has all the data it needs locally.
      return;
    }
    persistViewedDomain(start, end);
  }, [persistViewedDomain]);

  // Comments integration tied to current config
  const {
    comments: visibleComments,
    commentCount,
    showComments,
    toggleCommentOverlay,
    handleCommentHover: onCommentHoverAction,
    handleCommentClick: onCommentClickAction,
    handleTimeRangeSelect: onTimeRangeSelectAction,
    selectedTimeRange,
    selectedComments,
    clearSelected
  } = useChartComments(config);

  // Stable event handlers to prevent infinite loops in ChartViewer
  const handleViewportChange = useCallback((start: Date, end: Date, focusTime: Date) => {
    setManualFocusTime(null);
    setCurrentViewport(previous => previous && +previous.start === +start && +previous.end === +end && +previous.focusTime === +focusTime ? previous : { start, end, focusTime });
  }, []);

  const chartFocusRatio = config.timeRange.lookbackH / Math.max(1, config.timeRange.lookbackH + config.timeRange.lookaheadH);
  const handleSurgeViewportChange = useCallback((start: Date, end: Date) => {
    handleViewportChange(start, end, new Date(+start + (+end - +start) * chartFocusRatio));
    setViewportRequest(previous => ({ start, end, id: (previous?.id || 0) + 1 }));
  }, [chartFocusRatio, handleViewportChange]);

  const handleCommentHover = useCallback((c: any) => {
    onCommentHoverAction(c);
  }, [onCommentHoverAction]);
 
  const handleCommentClick = useCallback((cs: any) => {
    onCommentClickAction(cs);
  }, [onCommentClickAction]);
 
  const handleTimePointSelect = useCallback((time: Date, level?: number) => {
    // Skip the action sheet and go straight to comment form
    setChartActionLevel(level);
    onTimeRangeSelectAction({ at: time });
  }, [onTimeRangeSelectAction]);
  const [commentModalOpen, setCommentModalOpen] = useState(false);
  const [chartActionLevel, setChartActionLevel] = useState<number | undefined>(undefined);

  // Open comment modal when a selection range or comment is clicked
  useEffect(() => {
    if (selectedTimeRange || selectedComments) {
      setCommentModalOpen(true);
    }
  }, [selectedTimeRange, selectedComments]);


  // The map's libraries and elevation dataset are optional below-fold work.
  // Keep its exact footprint while loading only near the visible scroll area.
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const [mapRequested, setMapRequested] = useState(false);
  const [roadData, setRoadData] = useState<GeoJSON.FeatureCollection<GeoJSON.LineString, RoadProperties> | undefined>(undefined);
  useEffect(() => {
    if (loading || mapRequested || !mapContainerRef.current) return;
    if (typeof IntersectionObserver === 'undefined') { setMapRequested(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setMapRequested(true);
        observer.disconnect();
      }
    }, { rootMargin: '300px' });
    observer.observe(mapContainerRef.current);
    return () => observer.disconnect();
  }, [loading, mapRequested]);
  useEffect(() => {
    if (!mapRequested) return;
    const controller = new AbortController();
    const version = import.meta.env.VITE_APP_BUILD_ID || 'current';
    void measurePerf('tab2.fetchRoadGeojson', () => fetch(`/data/carolinaBeachRoads.geojson?v=${encodeURIComponent(version)}`, { signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(value => { if (value && !controller.signal.aborted) setRoadData(value); })
      .catch(() => { /* The map retains its missing-elevation-data notice. */ }));
    return () => controller.abort();
  }, [mapRequested]);

  // Reuse the same forecast crossings as the event cards.
  const floodWindow = useMemo(() => {
    if (!processedData) return null;
    const target = activeAtmo.targetTime || new Date();
    const event = floodWindows([...processedData.observedPoints, ...operationalForecastPoints], config.thresholds.minor)
      .find(e => e.startTime <= target && ((e.endTime || e.lastSampleTime) >= target));
    if (!event) return null;
    return {
      startTime: event.startTime, endTime: event.endTime ?? undefined,
      duration: event.endTime ? `${Math.round((+event.endTime - +event.startTime) / 60_000)} min` : 'End unavailable',
      maxRoadFloodDepth: Math.max(0, event.peakValue - config.thresholds.minor),
      maxWaterLevel: event.peakValue, maxWaterLevelTime: event.peakTime,
    };
  }, [processedData, operationalForecastPoints, activeAtmo.targetTime, config.thresholds.minor]);

  // Compute next tide info reactively
  const nextTideInfo = useMemo(() => {
    if (!processedData || !activeAtmo.targetTime || activeAtmo.wl === undefined || activeAtmo.wl === null) {
      return null;
    }
    // Create combined actual + FloodCast prediction curve to ensure we find actual expected peaks (including surge)
    const combinedPoints = [
      ...processedData.observedPoints,
      ...operationalForecastPoints
    ];
    return findNextTideExtremum(
      combinedPoints.length > 0 ? combinedPoints : processedData.predictedPoints,
      activeAtmo.targetTime,
      activeAtmo.wl
    );
  }, [processedData, operationalForecastPoints, activeAtmo.targetTime, activeAtmo.wl]);

  return (
    <IonPage
      ref={(node) => {
        pageRef.current = node as unknown as HTMLElement | null;
      }}
      className="floodcast-page"
    >
      <IonHeader>
        <IonToolbar>
          <IonTitle>FloodCast</IonTitle>
          <IonButtons slot="end">
            <IonButton routerLink="/alerts" aria-label="Flood alerts"><IonIcon icon={notificationsOutline} aria-hidden="true" /></IonButton>
            <IonButton routerLink="/profile" aria-label="Your account"><IonIcon icon={personCircleOutline} aria-hidden="true" /></IonButton>
            <IonButton
              aria-label="Open settings"
              onClick={() => setShowSettings(true)}
              data-tour-id="settings"
            >
              <IonIcon icon={settingsOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
        <CurrentConditions location={`${LOCATIONS[config.locationId]?.name || config.location.name}, ${config.location.state}`}
          points={processedData?.observedPoints || []} thresholdFt={LOCATIONS[config.locationId]?.thresholds.minor ?? 5.6}
          customView={config.offset.mode === 'manual' || config.display.dataSource === 'noaa' || Object.entries(config.thresholds).some(([key, value]) => value !== LOCATIONS[config.locationId]?.thresholds[key as keyof typeof config.thresholds])}
          onSettings={() => setShowSettings(true)} />
      </IonHeader>

      <IonContent className="floodcast-content">
        {/* Pull-to-refresh functionality */}
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent
            pullingText="Pull to refresh data"
            refreshingSpinner="crescent"
          />
        </IonRefresher>

        {/* Main dashboard — always render the shell once we have a station or are loading */}
        {(processedData || error || loading) && (
          <div className="dashboard-scroll-container">
            <div className="dashboard-grid">
              {(processedData || loading) && (
                <div className="dashboard-sidebar">
                  <div className="dashboard-next-events" data-tour-id="events">
                    <NextFloodingEventsCard
                      adjustedPoints={operationalForecastPoints}
                      predictedPoints={processedData?.predictedPoints || []}
                      windPoints={processedData?.windPoints || []}
                      precipPoints={processedData?.precipPoints || []}
                      floodEvents={processedData?.floodEvents || []}
                      thresholds={config.thresholds}
                      now={processedData?.timeDomain.now || new Date()}
                      onTimeChange={handleTimeChange}
                      loading={loading}
                      streetCalibration={LOCATIONS[config.locationId]?.streetCalibration}
                      forecastHorizon={weatherSelected ? selectedForecast.horizonEnd : null}
                      upperForecastPoints={operationalUpper}
                      planningOutlookStart={weatherSelected && outlook?.tail ? new Date(outlook.tail.startsAt) : null}
                    />
                  </div>
                  <div className="dashboard-alert-invitation"><AlertInvitation /></div>
                </div>
              )}

              <div className="dashboard-main-col">
                {error ? (
                  /* Error state — replaces chart area entirely */
                  <div className="chart-error-state">
                    <div className="chart-error-icon">⚠</div>
                    <h3 className="chart-error-title">Unable to Load Data</h3>
                    <p className="chart-error-message">Water-level data could not be loaded. Check your connection or try again; the latest observation time is shown above.</p>
                    <button
                      className="chart-error-details-toggle"
                      onClick={() => setShowErrorDetails(v => !v)}
                    >
                      {showErrorDetails ? 'Hide details ▴' : 'Show details ▾'}
                    </button>
                    {showErrorDetails && (
                      <div className="chart-error-details">
                        {error.split('\n').map((line, i) => {
                          const [label, value] = line.split('\t');
                          if (value) {
                            return (
                              <div key={i} className="chart-error-row">
                                <span className="chart-error-label">{label}:</span>
                                <span className="chart-error-value">{value}</span>
                              </div>
                            );
                          }
                          return <div key={i} className="chart-error-line">{line}</div>;
                        })}
                      </div>
                    )}
                    <div className="chart-error-actions">
                      <IonButton
                        fill="outline"
                        onClick={() => updateTimeRange({ mode: 'relative', lookbackH: 24, lookaheadH: 48 })}
                      >
                        Reset Time Window
                      </IonButton>
                      <IonButton fill="solid" onClick={() => refresh()}>
                        Retry
                      </IonButton>
                    </div>
                  </div>
                ) : (processedData || loading) ? (
                  <>
                    <div className="dashboard-hydrograph-card" data-tour-id="hydrograph">
                      <HydrographChart
                        onResetView={() => {
                          updateTimeRange({ mode: 'relative', lookbackH: 36, lookaheadH: 48 });
                          setCurrentViewport(null);
                          setManualFocusTime(null);
                          setCenterRequest(undefined);
                          setViewportRequest(undefined);
                          setResetCount(c => c + 1);
                        }}
                        locationName="Water Level Forecast"
                        controls={<ForecastTimeControls
                          viewport={currentViewport || processedData?.timeDomain || { start: new Date(Date.now() - 36 * 3600_000), end: new Date(Date.now() + 48 * 3600_000) }}
                          now={processedData?.timeDomain.now || new Date()}
                          forecastEndAt={processedData?.predictedPoints.at(-1)?.t}
                          focusRatio={chartFocusRatio}
                          isLive={activeAtmo.isLive}
                          onViewportChange={handleSurgeViewportChange}
                          onReturnToLive={resetToLive}
                        />}
                        sentinel={
                          <div data-tour-id="live-readout">
                            {activeAtmo.wl === null && !loading ? <p>Water level unavailable for this time.</p> : <AtmosphericOverlay
                              nextTideInfo={nextTideInfo ?? undefined}
                              precipitationAccumulation={activeAtmo.precip}
                              windSpeed={activeAtmo.wind?.speed ?? null}
                              windDirection={activeAtmo.wind?.dir ?? Number.NaN}
                              observedWaterLevel={activeAtmo.wl ?? 0}
                              isLive={activeAtmo.isLive}
                              source={activeAtmo.source}
                              fullSource={activeAtmo.fullSource}
                              sourceId={activeAtmo.sourceId}
                              surge={activeAtmo.surge}
                              prediction={activeAtmo.prediction}
                              statusLabel={activeAtmo.statusLabel}
                              targetTime={activeAtmo.targetTime ?? undefined}
                              thresholds={config.thresholds}
                              maxRoadFloodDepth={floodWindow?.maxRoadFloodDepth ?? Math.max(0, (activeAtmo.wl ?? 0) - (config.thresholds?.minor || 5.6))}
                              maxWaterLevel={floodWindow?.maxWaterLevel}
                              maxWaterLevelTime={floodWindow?.maxWaterLevelTime}
                              floodStartTime={floodWindow?.startTime}
                              floodEndTime={floodWindow?.endTime}
                              floodDuration={floodWindow?.duration}
                              loading={loading}
                              showWLInfo={showWLInfo}
                              onShowWLInfoChange={setShowWLInfo}
                            />}
                          </div>
                        }
                        isLive={activeAtmo.isLive}
                        time={activeAtmo.targetTime}
                        source={activeAtmo.source}
                        observedPoints={processedData?.observedPoints || []}
                        predictedPoints={processedData?.predictedPoints || []}
                        adjustedPoints={operationalForecastPoints}
                        forecastLabel={operationalForecastLabel}
                        forecastDescription={operationalForecastDescription}
                        experimentalPoints={
                          showChallengerComparison
                            ? (isTimesFmPrimary ? selectedForecast.totalPoints : anchoredChallengerTotal)
                            : weatherSelected && showSteadyComparison
                            ? processedData?.adjustedPoints || []
                            : []
                        }
                        experimentalLower={[]}
                        experimentalUpper={[]}
                        experimentalLabel={
                          showChallengerComparison
                            ? (isTimesFmPrimary ? 'Legacy Baseline Model' : 'TimesFM-3 + ETSS (Challenger)')
                            : 'Steady comparison'
                        }
                        experimentalDescription={
                          showChallengerComparison
                            ? (isTimesFmPrimary
                                ? 'Dashed line shows the legacy numerical model projection for comparison. Solid blue line is the primary TimesFM-3 operational forecast.'
                                : 'Purple dashed line shows the TimesFM-3 foundation model combined with NOAA ETSS storm surge guidance and 80% confidence interval. Primary operational forecast remains in blue.')
                            : undefined
                        }
                        showChallenger={showChallengerComparison}
                        onToggleChallenger={() => setShowChallengerComparison(v => !v)}
                        challengerToggleLabel={isTimesFmPrimary ? 'Compare Legacy Baseline' : 'Compare TimesFM-3 Challenger'}
                        challengerBadgeText={isTimesFmPrimary ? 'Legacy Model' : 'AI+ETSS'}
                        deltaPoints={processedData?.deltaPoints || []}
                        timeOffsetMins={processedData?.timeOffsetMins || 0}
                        surgeForecastPoints={operationalSurgePoints}
                        windPoints={processedData?.windPoints || []}
                        precipPoints={processedData?.precipPoints || []}
                        domainStart={processedData?.timeDomain.start || new Date(Date.now() - 24 * 3600 * 1000)}
                        domainEnd={processedData?.timeDomain.end || new Date(Date.now() + 48 * 3600 * 1000)}
                        now={processedData?.timeDomain.now || new Date()}
                        thresholds={config?.thresholds}
                        showDelta={false}
                        timezone={config?.display.timezone || 'local'}
                        config={chartConfig}
                        floodEvents={processedData?.floodEvents || []}
                        timeRange={config?.timeRange}
                        selectedTime={manualFocusTime}
                        showComments={showComments}
                        comments={visibleComments}
                        onCommentHover={handleCommentHover}
                        onCommentClick={handleCommentClick}
                        onTimePointSelect={handleTimePointSelect}
                        onToggleComments={toggleCommentOverlay}
                        commentCount={commentCount}
                        onViewportChange={handleViewportChange}
                        onViewportDomainCommit={persistViewedDomain}
                        onDomainChangeRequest={handleDomainChangeRequest}
                        loading={loading}
                        mode={config.timeRange.mode}
                        onResetToLive={resetToLive}
                        onTimeSettingsClick={() => setShowTimeSettings(true)}
                        centerRequest={centerRequest}
                        viewportRequest={viewportRequest}
                        resetKey={resetCount}
                        warnings={weatherSelected ? (processedData?.warnings || []).filter(w => !w.startsWith('Dashed total water level') && !w.startsWith('Residual projection unavailable')) : processedData?.warnings || []}
                        viewMode={config.display.viewMode}
                        locationId={config.locationId}
                        onJumpToTime={handleTimeChange}
                      >
                    <SurgeChart
                      forecastDocument={weatherSelected && forecastCompatible ? outlook : null}
                      focusTime={manualFocusTime || currentViewport?.focusTime}
                      embedded
                      showControls={false}
                      points={processedData?.deltaPoints || []}
                      estimatedPoints={surgeEstimatePoints}
                      source={processedData?.source}
                      timezone={config.display.timezone}
                      now={processedData?.timeDomain.now}
                      forecastEndAt={processedData?.predictedPoints.at(-1)?.t}
                      viewport={currentViewport || processedData?.timeDomain}
                      focusRatio={chartFocusRatio}
                      onViewportChange={handleSurgeViewportChange}
                      onResetToLive={resetToLive}
                      forecast={operationalSurgePoints}
                      forecastLabel={operationalForecastLabel}
                      forecastDescription={operationalForecastDescription}
                      experimentalForecast={
                        showChallengerComparison
                          ? (isTimesFmPrimary ? selectedForecast.residualPoints : anchoredChallengerResidual)
                          : weatherSelected && showSteadyComparison
                          ? processedData?.surgeForecastPoints || []
                          : []
                      }
                      comparisonLabel={
                        showChallengerComparison
                          ? (isTimesFmPrimary ? 'Legacy Residual' : 'TimesFM-3 Residual')
                          : 'Steady comparison'
                      }
                      patternAnalysis={patternProjection?.analysis}
                    />
                      </HydrographChart>
                    </div>
                    <FloodOutlook
                      outlook={outlook}
                      selection={isTimesFmPrimary ? { ...selectedForecast, totalPoints: operationalForecastPoints, residualPoints: operationalSurgePoints } : selectedForecast}
                      thresholdFt={config.thresholds.minor}
                      now={processedData?.timeDomain.now || new Date()}
                      showComparison={showSteadyComparison}
                      floodExpected={hasUpcomingFlooding(operationalForecastPoints, config.thresholds.minor, processedData?.timeDomain.now || new Date())}
                      floodPossible={hasUpcomingFlooding(operationalUpper, config.thresholds.minor, processedData?.timeDomain.now || new Date())}
                      onToggle={() => setShowSteadyComparison(v => !v)}
                      challenger={challenger}
                      showChallenger={showChallengerComparison}
                      onToggleChallenger={() => setShowChallengerComparison(v => !v)}
                      isTimesFmPrimary={isTimesFmPrimary}
                    />
                  <div className="dashboard-webcam-card" data-tour-id="webcam">
                    <WebcamFeedCard
                      cameraId={selectedCameraId}
                      locationName={WEBCAMS.find(c => c.id === selectedCameraId)?.name || ''}
                      targetTime={activeAtmo.targetTime || new Date()}
                      isLive={activeAtmo.isLive}
                      onResetToLive={resetToLive}
                      onTimeChange={handleTimeChange}
                      onCameraChange={setSelectedCameraId}
                      imagery={processedData?.imagery?.[selectedCameraId]}
                      loading={loading}
                    />
                  </div>
                    <div className="dashboard-map-card" data-tour-id="map" ref={mapContainerRef}>
                      {mapRequested ? <React.Suspense fallback={mapPlaceholder}>
                        <DeferredInundationMap
                          waterLevelFt={simulationLevel}
                          waterLevelUnavailable={!activeAtmo.isSimulated && activeAtmo.wl === null}
                          waterLevelLabel={activeAtmo.isSimulated ? 'Simulated Water Level' : activeAtmo.wl === null ? 'Water Level' : `${activeAtmo.isLive ? 'Live ' : ''}${activeAtmo.statusLabel} Water Level`}
                          roadData={roadData}
                          observedLevelFt={processedData?.observedPoints?.filter(point => !point.estimated).at(-1)?.v}
                          targetTime={activeAtmo.targetTime || new Date()}
                          onResetToLive={resetToLive}
                          onTimeChange={handleTimeChange}
                          imagery={processedData?.imagery}
                          loading={loading}
                        />
                      </React.Suspense> : mapPlaceholder}
                    </div>

                    <div className="dashboard-simulator-card" data-tour-id="simulator">
                      <InundationSimulator
                        waterLevelFt={simulationLevel}
                        minLevelFt={0.0}
                        maxLevelFt={10.0}
                        onLevelChange={(val) => {
                          setSimulationLevel(val);
                          setIsUserSimulating(true);
                        }}
                        thresholds={config.thresholds}
                        locationId={config.locationId}
                        simulationContext={{
                          targetTime: activeAtmo.targetTime ?? new Date(),
                          wind: activeAtmo.wind ?? undefined,
                          precip: activeAtmo.precip ?? undefined,
                          source: activeAtmo.fullSource,
                          isSimulated: activeAtmo.isSimulated,
                        }}
                      />
                    </div>
                    
                    {/* Bottom ad unit. Replace the slot ID with your actual AdSense ad unit slot ID */}
                    <AdSenseUnit slot={import.meta.env.VITE_ADSENSE_DASHBOARD_SLOT || ''} />
                  </>
                ) : null}
              </div>
            </div>
          </div>
        )}

        {/* Professional settings modal */}
        <SettingsModal
          isOpen={showSettings}
          onDismiss={() => setShowSettings(false)}
          config={config}
          onLocationChange={handleLocationChange}
          onThresholdsChange={updateThresholds}
          onOffsetConfigChange={updateOffset}
          onDisplayChange={updateDisplay}
          onResetDefaults={resetToDefaults}
          computedOffset={processedData?.effectiveOffset ?? null}
          offsetDataPoints={data?.nPoints || 0}
          dataSource={data?.source as 'fiman' | 'noaa' | undefined}
          successMessage={messages.success}
          errorMessage={messages.error}
          onClearMessages={clearMessages}
          showComments={showComments}
          commentCount={commentCount}
          onShowCommentsChange={(show) => {
            if (show !== showComments) {
              toggleCommentOverlay();
            }
          }}
        />

        <TimeSettingsModal
          isOpen={showTimeSettings}
          onDismiss={() => setShowTimeSettings(false)}
          timeRange={config.timeRange}
          onTimeRangeChange={updateTimeRange}
          timezone={config.display.timezone}
          onTimezoneChange={(timezone) => updateDisplay({ timezone })}
        />

        {/* Chart comment creation modal */}
        <ChartCommentModal
          isOpen={commentModalOpen}
          onDismiss={() => { setCommentModalOpen(false); clearSelected(); }}
          range={selectedTimeRange || (selectedComments?.[0]?.metadata.timeRange ?? null)}
          existingComments={selectedComments || []}
          config={config}
          waterLevel={chartActionLevel}
        />

        {showIntroTour && (
          <IntroTourOverlay
            targetRoot={pageRef}
            onFinish={() => history.replace('/tab2')}
          />
        )}
      </IonContent>
    </IonPage>
  );
};

export default Tab2;

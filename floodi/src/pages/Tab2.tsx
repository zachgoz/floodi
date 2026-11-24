import { LOCATIONS } from 'src/constants/locations';
import { CurrentConditions, formatCompactGaugeDateTime } from 'src/components/dashboard/CurrentConditions';
import { SurgeChart } from 'src/components/dashboard/SurgeChart';
import { ForecastTimeControls } from 'src/components/dashboard/ForecastTimeControls';
import { useOperationalForecast } from 'src/components/dashboard/useOperationalForecast';
import type { Point } from 'src/components/Tab2/types';
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
import { useAtmosphericState, resolveHydrographWaterLevel } from 'src/components/Tab2/hooks/useAtmosphericState';
import { useChartComments } from 'src/components/Tab2/hooks/useChartComments';
import { ChartCommentModal } from 'src/components/Tab2/ChartCommentModal';
import { ForecastAccuracyModal } from 'src/components/dashboard/ForecastAccuracyModal';
import { useForecastAccuracy } from 'src/components/dashboard/useForecastAccuracy';
import 'src/components/Tab2/styles/Tab2.css';
import './Tab2.css';
import 'src/components/dashboard/DashboardView.css';
import HydrographChart from 'src/components/dashboard/HydrographChart';
import AtmosphericOverlay, { PastSimilarFloodChip } from 'src/components/dashboard/AtmosphericOverlay';
import { findNextTideExtremum } from 'src/utils/tideExtrema';
import { getFloodSeverityForLevel, getFloodSeverityLabel } from 'src/utils/floodSeverity';
import type { RoadProperties } from 'src/components/dashboard/InundationMap';
import InundationSimulator from 'src/components/dashboard/InundationSimulator';
import WebcamFeedCard from 'src/components/dashboard/WebcamFeedCard';
import { WEBCAMS } from 'src/constants/webcams';
import { markPerf, measurePerf } from 'src/lib/perfLogger';
import { IntroTourOverlay } from 'src/components/onboarding/IntroTourOverlay';
import { Link, useHistory, useLocation } from 'react-router-dom';
import { floodWindows } from 'src/utils/waterForecast';
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
  const routerLocation = useLocation();
  const pageRef = useRef<HTMLElement | null>(null);
  const appliedDeepLinkRef = useRef<string | null>(null);

  useEffect(() => {
    markPerf('tab2.mounted');
  }, []);

  // Settings modal state
  const [showSettings, setShowSettings] = useState(false);
  const [showTimeSettings, setShowTimeSettings] = useState(false);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [showWLInfo, setShowWLInfo] = useState(false);
  const [showAccuracyModal, setShowAccuracyModal] = useState(false);

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
    resetToLive: resetStorageToLive,
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

  // Honor ?t=<iso> deep links from FloodCast Alerts 2.0 emails & advisories and ?view=accuracy
  useEffect(() => {
    const params = new URLSearchParams(routerLocation.search);
    if (params.get('accuracy') === '1' || params.get('view') === 'accuracy') {
      setShowAccuracyModal(true);
    }
    const tParam = params.get('t');
    if (!tParam || appliedDeepLinkRef.current === tParam) return;
    const targetMs = Date.parse(tParam);
    if (!Number.isFinite(targetMs)) return;
    appliedDeepLinkRef.current = tParam;
    const targetDate = new Date(targetMs);
    setManualFocusTime(targetDate);
    setCenterRequest({ time: targetDate, id: Date.now() });
  }, [routerLocation.search]);

  // Shared operational forecast pipeline (also powers Outlook & Alerts tab)
  const {
    loading,
    error,
    data,
    processedData,
    refresh,
    challenger,
    refreshChallenger,
    patternProjection,
    surgeEstimatePoints,
    isTimesFmPrimary,
    operationalSurgePoints,
    operationalForecastPoints,
    operationalForecastLabel,
    operationalForecastDescription,
    forecastData,
  } = useOperationalForecast(config);
  const { accuracy: rollingAccuracy } = useForecastAccuracy(config.locationId);

  const nextUpcomingFlood = useMemo(() => {
    if (!processedData || operationalForecastPoints.length === 0) return null;
    const liveNow = processedData.timeDomain.now || new Date();
    const upcoming = floodWindows(operationalForecastPoints, config.thresholds.minor)
      .find(event => +(event.endTime ?? event.lastSampleTime) > +liveNow);
    if (!upcoming) return null;
    const severity = getFloodSeverityForLevel(upcoming.peakValue, config.thresholds) ?? 'minor';
    return {
      severity,
      severityLabel: getFloodSeverityLabel(severity),
      peakTime: upcoming.peakTime,
      peakValue: upcoming.peakValue,
    };
  }, [processedData, operationalForecastPoints, config.thresholds]);

  useEffect(() => {
    markPerf('tab2.dataState', {
      loading,
      hasError: !!error,
      hasProcessedData: !!processedData,
      observedPoints: processedData?.observedPoints.length ?? 0,
      adjustedPoints: processedData?.adjustedPoints.length ?? 0,
    });
  }, [loading, error, processedData]);

  // Modularized atmospheric and simulation state driven cleanly by the scrolled playhead
  const {
    activeAtmo,
    simulationLevel,
    setSimulationLevel,
    setIsUserSimulating,
  } = useAtmosphericState(forecastData, manualFocusTime, currentViewport);

  const resetToLive = useCallback(() => {
    lastPersistedDomainRef.current = null;
    resetStorageToLive?.();
    setManualFocusTime(null);
    setIsUserSimulating(false);
    setCenterRequest({ time: new Date(), id: Date.now() });
  }, [resetStorageToLive, setIsUserSimulating]);

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
      await Promise.all([refresh(), refreshChallenger(true)]);
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

  // Compute next tide info for the inspected point (used inside water-level insight modal)
  const nextTideInfo = useMemo(() => {
    if (!processedData || !activeAtmo.targetTime || activeAtmo.wl === undefined || activeAtmo.wl === null) {
      return null;
    }
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

  // Sync the top-bar live gauge reading with the hydrograph's live inferred value & timestamp
  const liveHydrographReading = useMemo(() => {
    if (activeAtmo.isLive && activeAtmo.wl !== null && activeAtmo.targetTime) {
      return { t: activeAtmo.targetTime, v: activeAtmo.wl };
    }
    if (!forecastData) return null;
    const liveNow = forecastData.timeDomain.now;
    const resolved = resolveHydrographWaterLevel(forecastData, liveNow);
    return resolved.wl !== null ? { t: liveNow, v: resolved.wl } : null;
  }, [activeAtmo.isLive, activeAtmo.wl, activeAtmo.targetTime, forecastData]);

  // Anchor top-bar next high/low tide strictly to the current point in time (independent of hydrograph scroll)
  const currentNextTideInfo = useMemo(() => {
    if (!processedData) return null;
    const liveNow = processedData.timeDomain.now || new Date();
    const combinedPoints = [
      ...processedData.observedPoints,
      ...operationalForecastPoints,
    ];
    const curve = combinedPoints.length > 0 ? combinedPoints : processedData.predictedPoints;
    if (curve.length === 0) return null;
    const latestObs = [...processedData.observedPoints]
      .filter(p => !p.estimated && Number.isFinite(p.v) && +p.t <= +liveNow)
      .sort((a, b) => +b.t - +a.t)[0];
    const nearestLive = curve.reduce<Point | null>((best, pt) => {
      if (!Number.isFinite(pt.v) || !Number.isFinite(+pt.t)) return best;
      if (!best) return pt;
      return Math.abs(+pt.t - +liveNow) < Math.abs(+best.t - +liveNow) ? pt : best;
    }, null);
    const currentLevel = latestObs?.v ?? nearestLive?.v;
    if (currentLevel === undefined || !Number.isFinite(currentLevel)) return null;
    return findNextTideExtremum(curve, liveNow, currentLevel);
  }, [processedData, operationalForecastPoints]);

  return (
    <IonPage
      ref={(node) => {
        pageRef.current = node as unknown as HTMLElement | null;
      }}
      className="floodcast-page"
    >
      <IonHeader>
        <IonToolbar>
          <IonTitle className="floodcast-toolbar-title">
            FloodCast{' '}
            <span className="toolbar-location-subtitle">
              · {LOCATIONS[config.locationId]?.name || config.location.name}
            </span>
          </IonTitle>
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
        <CurrentConditions
          location={`${LOCATIONS[config.locationId]?.name || config.location.name}, ${config.location.state}`}
          points={processedData?.observedPoints || []}
          thresholdFt={LOCATIONS[config.locationId]?.thresholds.minor ?? 5.6}
          customView={config.offset.mode === 'manual' || config.display.dataSource === 'noaa' || Object.entries(config.thresholds).some(([key, value]) => value !== LOCATIONS[config.locationId]?.thresholds[key as keyof typeof config.thresholds])}
          onSettings={() => setShowSettings(true)}
          nextTideInfo={currentNextTideInfo ?? undefined}
          onNextTideClick={() => setShowWLInfo(true)}
          isLive={activeAtmo.isLive}
          onResetToLive={resetToLive}
          liveReading={liveHydrographReading}
        />
      </IonHeader>

      <IonContent className="floodcast-content">
        {/* Pull-to-refresh functionality */}
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent
            pullingText="Pull to refresh data"
            refreshingSpinner="crescent"
          />
        </IonRefresher>

        {/* Main dashboard — chart-first layout once we have a station or are loading */}
        {(processedData || error || loading) && (
          <div className="dashboard-scroll-container">
            <div className="dashboard-grid">
              {!error && nextUpcomingFlood && (
                <Link
                  to="/alerts"
                  className={`dashboard-threat-banner sev-${nextUpcomingFlood.severity}`}
                  aria-label={`${nextUpcomingFlood.severityLabel} flood forecast ${formatCompactGaugeDateTime(nextUpcomingFlood.peakTime)} at ${nextUpcomingFlood.peakValue.toFixed(2)} feet — open Outlook and Alerts`}
                >
                  <span className="threat-banner-main">
                    <span className="threat-banner-dot" aria-hidden="true" />
                    <strong>{nextUpcomingFlood.severityLabel} flood</strong>
                    <span>
                      {formatCompactGaugeDateTime(nextUpcomingFlood.peakTime)} · {nextUpcomingFlood.peakValue.toFixed(2)} ft
                    </span>
                  </span>
                  <span className="threat-banner-cta">Outlook ›</span>
                </Link>
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
                    <div className="dashboard-hydrograph-card" id="dashboard-section-chart" data-tour-id="hydrograph">
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
                        headerAction={
                          <PastSimilarFloodChip
                            observedWaterLevel={activeAtmo.wl}
                            thresholds={config.thresholds}
                            floodEvents={processedData?.floodEvents}
                            now={processedData?.timeDomain.now}
                            loading={loading}
                            onJumpToTime={handleTimeChange}
                          />
                        }
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
                              floodEvents={processedData?.floodEvents}
                              now={processedData?.timeDomain.now}
                              onJumpToTime={handleTimeChange}
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
                        centerRequest={centerRequest}
                        viewportRequest={viewportRequest}
                        resetKey={resetCount}
                        warnings={isTimesFmPrimary ? (processedData?.warnings || []).filter(w => !w.startsWith('Dashed total water level') && !w.startsWith('Residual projection unavailable')) : processedData?.warnings || []}
                        viewMode={config.display.viewMode}
                        locationId={config.locationId}
                        onJumpToTime={handleTimeChange}
                      >
                    <SurgeChart
                      challenger={challenger}
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
                      patternAnalysis={patternProjection?.analysis}
                    />
                      </HydrographChart>
                    </div>
                  <div className="dashboard-webcam-card" id="dashboard-section-cams" data-tour-id="webcam">
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
                    <div className="dashboard-map-card" id="dashboard-section-map" data-tour-id="map" ref={mapContainerRef}>
                      {mapRequested ? <React.Suspense fallback={mapPlaceholder}>
                        <DeferredInundationMap
                          waterLevelFt={simulationLevel}
                          waterLevelUnavailable={!activeAtmo.isSimulated && activeAtmo.wl === null}
                          waterLevelLabel={
                            activeAtmo.isSimulated
                              ? 'Simulated Water Level'
                              : activeAtmo.wl === null
                              ? 'Water Level'
                              : activeAtmo.isLive && activeAtmo.statusLabel !== 'Estimated'
                              ? 'Live Water Level'
                              : `${activeAtmo.statusLabel} Water Level`
                          }
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
          onAccuracyClick={() => setShowAccuracyModal(true)}
          maeInches={rollingAccuracy.mae24hInches}
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

        {/* Scientific Forecast Accuracy Audit modal */}
        <ForecastAccuracyModal
          isOpen={showAccuracyModal}
          onDismiss={() => setShowAccuracyModal(false)}
          accuracy={rollingAccuracy}
          observedPoints={processedData?.observedPoints}
          predictedPoints={processedData?.predictedPoints}
          adjustedPoints={operationalForecastPoints?.length ? operationalForecastPoints : processedData?.adjustedPoints}
          thresholds={config.thresholds}
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

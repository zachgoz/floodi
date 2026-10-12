import { LOCATIONS } from 'src/constants/locations';
import { interpolate } from 'src/utils/waterForecast';
import { projectResidualPattern } from '../../functions/src/forecast/pattern';
import { alignForecastComparison } from 'src/utils/forecastComparison';
import { selectWaterForecast } from 'src/utils/selectWaterForecast';
import { SurgeChart } from 'src/components/dashboard/SurgeChart';
import { ForecastTimeControls } from 'src/components/dashboard/ForecastTimeControls';
import { FloodOutlook } from 'src/components/dashboard/FloodOutlook';
import { useFloodOutlook } from 'src/components/dashboard/useFloodOutlook';
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
import { settingsOutline } from 'ionicons/icons';
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
import InundationMap, { RoadProperties } from 'src/components/dashboard/InundationMap';
import InundationSimulator from 'src/components/dashboard/InundationSimulator';
import WebcamFeedCard from 'src/components/dashboard/WebcamFeedCard';
import NextFloodingEventsCard from 'src/components/dashboard/NextFloodingEventsCard';
import { WEBCAMS } from 'src/constants/webcams';
import { APIProvider } from '@vis.gl/react-google-maps';
import { markPerf, measurePerf } from 'src/lib/perfLogger';
import { IntroTourOverlay } from 'src/components/onboarding/IntroTourOverlay';
import { useHistory } from 'react-router-dom';
import { floodWindows, hasUpcomingFlooding } from 'src/utils/waterForecast';
import { AdSenseUnit } from 'src/components/common/AdSenseUnit';

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
  const [showSteadyComparison, setShowSteadyComparison] = useState(false);
  const patternProjection = useMemo(() => {
    if (!processedData) return null;
    const reference = { station: processedData.observationStation, datum: 'MLLW', units: 'ft' };
    return projectResidualPattern(processedData.deltaPoints, processedData.predictedPoints.map(p => p.t), processedData.timeDomain.now, reference, reference);
  }, [processedData]);
  const surgeEstimatePoints = useMemo(() => {
    if (!processedData) return [];
    const estimates = processedData.observedPoints.filter(p => p.estimated).flatMap(p => {
      const tide = interpolate(processedData.predictedPoints, p.t);
      return tide === null ? [] : [{ ...p, v: p.v - tide }];
    });
    const anchor = processedData.deltaPoints.at(-1);
    return estimates.length ? [...(anchor ? [anchor] : []), ...estimates] : [];
  }, [processedData]);
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
  // One selected physical forecast drives both charts and every hazard calculation.
  // Actual measurements and the near-live display estimate remain untouched.
  const forecastData = useMemo(() => processedData ? {
    ...processedData,
    adjustedPoints: selectedForecast.totalPoints,
    surgeForecastPoints: selectedForecast.residualPoints,
  } : null, [processedData, selectedForecast]);
  const weatherSelected = selectedForecast.method === 'weather' || selectedForecast.method === 'learned';
  const selectedBounds = useMemo(() => {
    const timestamps = new Set(selectedForecast.totalPoints.map(point => +point.t));
    const supported = weatherSelected ? (outlook?.points || []).filter(point => timestamps.has(Date.parse(point.t))) : [];
    return {
      lower: selectedForecast.lowerPoints ?? supported.map(point => ({ t: new Date(point.t), v: point.lowerFt })),
      upper: selectedForecast.upperPoints ?? supported.map(point => ({ t: new Date(point.t), v: point.upperFt })),
    };
  }, [weatherSelected, selectedForecast.totalPoints, selectedForecast.lowerPoints, selectedForecast.upperPoints, outlook]);
  const forecastLabel = selectedForecast.tailMethod || selectedForecast.extensionMethod ? 'Extended outlook' : selectedForecast.method === 'weather' ? 'Weather forecast' : selectedForecast.method === 'learned' ? 'Short-range forecast' : selectedForecast.method === 'steady' ? 'Steady forecast' : 'Tide only';

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
    const FETCH_BUFFER_MS = 5 * 24 * 3600_000;
    fetchedBufferRef.current = {
      start: new Date(processedData.timeDomain.start.getTime() - FETCH_BUFFER_MS),
      end: new Date(processedData.timeDomain.end.getTime() + FETCH_BUFFER_MS),
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


  // Road elevation GeoJSON — fetched from /public/data/
  const [roadData, setRoadData] = useState<GeoJSON.FeatureCollection<GeoJSON.LineString, RoadProperties> | undefined>(undefined);
  useEffect(() => {
    measurePerf('tab2.fetchRoadGeojson', () => fetch('/data/carolinaBeachRoads.geojson?v=' + new Date().getTime())
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setRoadData(data); })
      .catch(() => { /* file not yet generated — map shows notice */ }));
  }, []);

  // Reuse the same crossings as the event cards and forecast shading.
  const floodWindow = useMemo(() => {
    if (!processedData) return null;
    const target = activeAtmo.targetTime || new Date();
    const event = floodWindows([...processedData.observedPoints, ...selectedForecast.totalPoints], config.thresholds.minor)
      .find(e => e.startTime <= target && ((e.endTime || e.lastSampleTime) >= target));
    if (!event) return null;
    return {
      startTime: event.startTime, endTime: event.endTime ?? undefined,
      duration: event.endTime ? `${Math.round((+event.endTime - +event.startTime) / 60_000)} min` : 'End unavailable',
      maxRoadFloodDepth: Math.max(0, event.peakValue - config.thresholds.minor),
      maxWaterLevel: event.peakValue, maxWaterLevelTime: event.peakTime,
    };
  }, [processedData, selectedForecast.totalPoints, activeAtmo.targetTime, config.thresholds.minor]);

  // Compute next tide info reactively
  const nextTideInfo = useMemo(() => {
    if (!processedData || !activeAtmo.targetTime || activeAtmo.wl === undefined || activeAtmo.wl === null) {
      return null;
    }
    // Create combined actual + FloodCast prediction curve to ensure we find actual expected peaks (including surge)
    const combinedPoints = [
      ...processedData.observedPoints,
      ...selectedForecast.totalPoints
    ];
    return findNextTideExtremum(
      combinedPoints.length > 0 ? combinedPoints : processedData.predictedPoints,
      activeAtmo.targetTime,
      activeAtmo.wl
    );
  }, [processedData, selectedForecast.totalPoints, activeAtmo.targetTime, activeAtmo.wl]);

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
            <IonButton
              aria-label="Open settings"
              onClick={() => setShowSettings(true)}
              data-tour-id="settings"
            >
              <IonIcon icon={settingsOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
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
                      adjustedPoints={selectedForecast.totalPoints}
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
                      upperForecastPoints={selectedBounds.upper}
                    />
                  </div>
                </div>
              )}

              <div className="dashboard-main-col">
                {error ? (
                  /* Error state — replaces chart area entirely */
                  <div className="chart-error-state">
                    <div className="chart-error-icon">⚠</div>
                    <h3 className="chart-error-title">Unable to Load Data</h3>
                    <p className="chart-error-message">NOAA API request failed. This can happen when the time range extends into the future or is invalid.</p>
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
                              precipitationAccumulation={activeAtmo.precip ?? 0}
                              windSpeed={activeAtmo.wind?.speed ?? 0}
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
                        adjustedPoints={selectedForecast.totalPoints}
                        forecastLabel={forecastLabel}
                        forecastDescription={selectedForecast.reason}
                        deltaPoints={processedData?.deltaPoints || []}
                        timeOffsetMins={processedData?.timeOffsetMins || 0}
                        surgeForecastPoints={selectedForecast.residualPoints}
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
                      embedded
                      showControls={false}
                      points={processedData?.deltaPoints || []}
                      estimatedPoints={surgeEstimatePoints}
                      source={processedData?.source}
                      timezone={config.display.timezone}
                      now={processedData?.timeDomain.now}
                      forecastEndAt={processedData?.predictedPoints.at(-1)?.t}
                      viewport={currentViewport || processedData?.timeDomain}
                      focusTime={currentViewport?.focusTime}
                      focusRatio={chartFocusRatio}
                      onViewportChange={handleSurgeViewportChange}
                      onResetToLive={resetToLive}
                      forecast={selectedForecast.residualPoints}
                      forecastLabel={forecastLabel}
                      forecastDescription={selectedForecast.reason}
                      experimentalForecast={weatherSelected && showSteadyComparison ? processedData?.surgeForecastPoints || [] : []}
                      comparisonLabel="Steady comparison"
                      patternAnalysis={patternProjection?.analysis}
                    />
                      </HydrographChart>
                    </div>
                    <FloodOutlook outlook={outlook} selection={selectedForecast} showComparison={showSteadyComparison} floodExpected={hasUpcomingFlooding(selectedForecast.totalPoints, config.thresholds.minor, processedData?.timeDomain.now || new Date())} floodPossible={hasUpcomingFlooding(selectedBounds.upper, config.thresholds.minor, processedData?.timeDomain.now || new Date())} onToggle={() => setShowSteadyComparison(v => !v)} />
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
                    <div className="dashboard-map-card" data-tour-id="map">
                      <APIProvider apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''}>
                        <InundationMap
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
                      </APIProvider>
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
                    <AdSenseUnit slot="dashboard-bottom" />
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

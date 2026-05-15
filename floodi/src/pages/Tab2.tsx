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
import InundationMap, { RoadProperties } from 'src/components/dashboard/InundationMap';
import InundationSimulator from 'src/components/dashboard/InundationSimulator';
import WebcamFeedCard from 'src/components/dashboard/WebcamFeedCard';
import NextFloodingEventsCard from 'src/components/dashboard/NextFloodingEventsCard';
import { WEBCAMS } from 'src/constants/webcams';
import { APIProvider } from '@vis.gl/react-google-maps';

/**
 * Professional FloodCast Tab2 Component
 * 
 * This is the completely refactored Tab2 component that replaces the original
 * 1,037-line monolithic implementation with a clean, maintainable architecture
 * using professional Ionic patterns and decomposed components.
 * 
 * @returns JSX.Element Professional FloodCast interface
 */
const Tab2: React.FC = () => {
  // Settings modal state
  const [showSettings, setShowSettings] = useState(false);
  const [showErrorDetails, setShowErrorDetails] = useState(false);

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
    resetToLive: baseResetToLive,
    resetToDefaults,
  } = useSettingsStorage();

  // State declarations (moved up to avoid TDZ)
  const [resetCount, setResetCount] = useState(0);
  const [currentViewport, setCurrentViewport] = useState<{ start: Date; end: Date; focusTime: Date } | null>(null);
  const [manualFocusTime, setManualFocusTime] = useState<Date | null>(null);
  const [centerRequest, setCenterRequest] = useState<{ time: Date; id: number } | undefined>(undefined);
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

  // Modularized atmospheric and simulation state
  const {
    activeAtmo,
    simulationLevel,
    setSimulationLevel,
    setIsUserSimulating,
  } = useAtmosphericState(processedData, manualFocusTime, currentViewport);

  const resetToLive = useCallback(() => {
    baseResetToLive();
    lastPersistedDomainRef.current = null;
    setCurrentViewport(null);
    setManualFocusTime(null);
    setIsUserSimulating(false);
    setResetCount(c => c + 1);
    setCenterRequest({ time: new Date(), id: Date.now() });
  }, [baseResetToLive, setIsUserSimulating]);

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
      await refresh();
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
    showDelta: config.display.showDelta,
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
    setCurrentViewport({ start, end, focusTime });
  }, []);

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
    fetch('/data/carolinaBeachRoads.geojson?v=' + new Date().getTime())
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setRoadData(data); })
      .catch(() => { /* file not yet generated — map shows notice */ });
  }, []);

  // Approximate flooding time calculation
  const floodWindow = useMemo(() => {
    if (!processedData || !config.thresholds) return null;
    
    const minor = config.thresholds.minor;
    const points = [...processedData.observedPoints, ...processedData.adjustedPoints];
    const target = activeAtmo.targetTime || new Date();
    const targetTime = target.getTime();

    // 1. Find the point in the series nearest to targetTime
    let nearestIdx = -1;
    let minDiff = Infinity;
    for (let i = 0; i < points.length; i++) {
      const diff = Math.abs(points[i].t.getTime() - targetTime);
      if (diff < minDiff) {
        minDiff = diff;
        nearestIdx = i;
      }
    }

    if (nearestIdx === -1) return null;

    // 2. Search backward and forward to find the continuous period above threshold
    let startIdx = nearestIdx;
    while (startIdx > 0 && points[startIdx].v >= minor) {
      startIdx--;
    }
    // If we're below threshold at startIdx, the actual start is startIdx + 1
    const actualStartIdx = points[startIdx].v >= minor ? startIdx : startIdx + 1;

    let endIdx = nearestIdx;
    while (endIdx < points.length - 1 && points[endIdx].v >= minor) {
      endIdx++;
    }
    // If we're below threshold at endIdx, the actual end is endIdx - 1
    const actualEndIdx = points[endIdx].v >= minor ? endIdx : endIdx - 1;

    // 3. Validate if target is actually in/near a flood event
    if (points[actualStartIdx].v < minor) return null;

    const startTime = points[actualStartIdx].t;
    const endTimeRaw = points[actualEndIdx].t;
    const peakPoint = points
      .slice(actualStartIdx, actualEndIdx + 1)
      .reduce((peak, point) => point.v > peak.v ? point : peak, points[actualStartIdx]);
    
    // User requirement: "end about an hour after it falls back below the 5.6' threshold"
    const endTime = new Date(endTimeRaw.getTime() + 3600_000);
    
    const durationMs = endTime.getTime() - startTime.getTime();
    const hours = Math.floor(durationMs / 3600_000);
    const mins = Math.round((durationMs % 3600_000) / 60_000);
    const duration = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

    return {
      startTime,
      endTime,
      duration,
      maxRoadFloodDepth: Math.max(0, peakPoint.v - minor),
      maxWaterLevel: peakPoint.v,
      maxWaterLevelTime: peakPoint.t,
    };
  }, [processedData, activeAtmo.targetTime, config.thresholds]);

  return (
    <IonPage className="floodcast-page">
      <IonHeader>
        <IonToolbar>
          <IonTitle>FloodCast</IonTitle>
          <IonButtons slot="end">
            <IonButton
              aria-label="Open settings"
              onClick={() => setShowSettings(true)}
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

        {/* Main dashboard — always render the shell once we have a station */}
        {(processedData || error) && (
          <div className="dashboard-scroll-container">
            <div className="dashboard-grid">
              {processedData && (
                <div className="dashboard-sidebar">
                  <NextFloodingEventsCard
                    adjustedPoints={processedData.adjustedPoints}
                    predictedPoints={processedData.predictedPoints}
                    windPoints={processedData.windPoints}
                    precipPoints={processedData.precipPoints}
                    floodEvents={processedData.floodEvents}
                    thresholds={config.thresholds}
                    now={processedData.timeDomain.now}
                    onTimeChange={handleTimeChange}
                  />
                  <WebcamFeedCard
                    cameraId={selectedCameraId}
                    locationName={WEBCAMS.find(c => c.id === selectedCameraId)?.name || ''}
                    targetTime={activeAtmo.targetTime || new Date()}
                    isLive={activeAtmo.isLive}
                    onResetToLive={resetToLive}
                    onTimeChange={handleTimeChange}
                    onCameraChange={setSelectedCameraId}
                    imagery={processedData?.imagery?.[selectedCameraId]}
                  />
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
                ) : processedData ? (
                  <>
                    <HydrographChart
                      locationName="Carolina Beach Tidal Flooding"
                      sentinel={
                        <AtmosphericOverlay
                          precipitationAccumulation={activeAtmo.precip ?? 0}
                          windSpeed={activeAtmo.wind?.speed ?? 0}
                          windDirection={activeAtmo.wind?.dir ?? 0}
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
                        />
                      }
                      isLive={activeAtmo.isLive}
                      time={activeAtmo.targetTime}
                      source={activeAtmo.source}
                      observedPoints={processedData.observedPoints}
                      predictedPoints={processedData.predictedPoints}
                      adjustedPoints={processedData.adjustedPoints}
                      deltaPoints={processedData.deltaPoints}
                      timeOffsetMins={processedData.timeOffsetMins}
                      surgeForecastPoints={processedData.surgeForecastPoints}
                      windPoints={processedData.windPoints}
                      precipPoints={processedData.precipPoints}
                      domainStart={processedData.timeDomain.start}
                      domainEnd={processedData.timeDomain.end}
                      now={processedData.timeDomain.now}
                      thresholds={config?.thresholds}
                      showDelta={config?.display.showDelta}
                      timezone={config?.display.timezone || 'local'}
                      config={chartConfig}
                      floodEvents={processedData.floodEvents}
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
                      resetKey={resetCount}
                      warnings={processedData.warnings}
                      viewMode={config.display.viewMode}
                      locationId={config.locationId}
                    />

                    {/* Google Maps inundation map — FIMAN-style road coloring */}
                    <APIProvider apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''}>
                      <InundationMap
                        waterLevelFt={simulationLevel}
                        roadData={roadData}
                        observedLevelFt={processedData?.observedPoints?.slice(-1)[0]?.v}
                        targetTime={activeAtmo.targetTime || new Date()}
                        onResetToLive={resetToLive}
                        onTimeChange={handleTimeChange}
                        imagery={processedData.imagery}
                      />
                    </APIProvider>

                    <InundationSimulator
                      waterLevelFt={simulationLevel}
                      minLevelFt={0.0}
                      maxLevelFt={10.0}
                      onLevelChange={(val) => {
                        setSimulationLevel(val);
                        setIsUserSimulating(true);
                      }}
                      thresholds={config.thresholds}
                      simulationContext={{
                        targetTime: activeAtmo.targetTime ?? new Date(),
                        wind: activeAtmo.wind ?? undefined,
                        precip: activeAtmo.precip ?? undefined,
                        source: activeAtmo.fullSource,
                        isSimulated: activeAtmo.isSimulated,
                      }}
                    />
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
          onTimeRangeChange={updateTimeRange}
          onDisplayChange={updateDisplay}
          onResetDefaults={resetToDefaults}
          computedOffset={data?.offset || 0}
          offsetDataPoints={data?.nPoints || 0}
          dataSource={data?.source as 'fiman' | 'noaa' | undefined}
          timeOffsetMins={data?.timeOffsetMins}
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

        {/* Chart comment creation modal */}
        <ChartCommentModal
          isOpen={commentModalOpen}
          onDismiss={() => { setCommentModalOpen(false); clearSelected(); }}
          range={selectedTimeRange || (selectedComments?.[0]?.metadata.timeRange ?? null)}
          existingComments={selectedComments || []}
          config={config}
          waterLevel={chartActionLevel}
        />
      </IonContent>
    </IonPage>
  );
};

export default Tab2;

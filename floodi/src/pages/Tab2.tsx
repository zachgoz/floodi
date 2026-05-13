import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
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
import { formatTooltipTime, findNearestPoint } from 'src/components/Tab2/hooks/useChartInteraction';
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
import { FloodEventSidebar } from 'src/components/Tab2/FloodEventSidebar';
import { findLastSimilarLevel } from 'src/lib/dataService';
import { WEBCAMS } from 'src/constants/webcams';
import { APIProvider } from '@vis.gl/react-google-maps';
import type { FloodEvent, WaterLevelPeak } from 'src/types/data';

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

  // Professional data fetching and processing
  const {
    loading,
    error,
    data,
    processedData,
    thresholdCrossing,
    refresh,
  } = useChartData(config);

  // Modularized atmospheric and simulation state
  const {
    activeAtmo,
    simulationLevel,
    setSimulationLevel,
    isUserSimulating,
    setIsUserSimulating,
  } = useAtmosphericState(processedData, manualFocusTime, currentViewport);

  const resetToLive = useCallback(() => {
    baseResetToLive();
    setCurrentViewport(null);
    setManualFocusTime(null);
    setIsUserSimulating(false);
    setResetCount(c => c + 1);
    setCenterRequest({ time: new Date(), id: Date.now() });
  }, [baseResetToLive, setIsUserSimulating]);

  // Reset simulation flag when the user interacts with the chart (changing focus time)
  useEffect(() => {
    if (manualFocusTime || currentViewport?.focusTime) {
      setIsUserSimulating(false);
    }
  }, [manualFocusTime, currentViewport?.focusTime, setIsUserSimulating]);

  // Track the buffered data window so we only refetch when the user scrolls
  // outside what we've already loaded (useChartData fetches ±5 days around
  // the current domain, so minor pans should never trigger a new request).
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

  const [lastSimilarPeak, setLastSimilarPeak] = useState<WaterLevelPeak | null>(null);

  /**
   * Handle flood event selection
   */
  const handleEventSelect = (event: FloodEvent) => {
    setCenterRequest({ time: new Date(event.peakTime), id: Date.now() });
  };

  /**
   * Find last time water level was at the current focus level
   */
  const handleFindLastSimilar = async () => {
    if (!activeAtmo.wl) return;
    try {
      const peak = await findLastSimilarLevel(config.location.id, activeAtmo.wl, activeAtmo.targetTime || new Date());
      setLastSimilarPeak(peak);
      if (peak) {
        setCenterRequest({ time: new Date(peak.t), id: Date.now() });
      }
    } catch (err) {
      console.error('Failed to find similar level:', err);
    }
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

  const formatTime = (date: Date): string => {
    return formatTooltipTime(date, config.display.timezone);
  };

  /**
   * Memoized chart configuration
   */
  const chartConfig = useMemo(() => ({
    thresholds: config.thresholds,
    showDelta: config.display.showDelta,
    timezone: config.display.timezone,
  }), [config.thresholds, config.display.showDelta, config.display.timezone]);

  // Stable domain change request handler — only triggers a refetch when the
  // user has scrolled outside the already-fetched ±5-day buffer window.
  const handleDomainChangeRequest = useCallback((start: Date, end: Date) => {
    const buf = fetchedBufferRef.current;
    if (buf && start >= buf.start && end <= buf.end) {
      // Still within the buffered window — no fetch needed, ChartViewer
      // already has all the data it needs locally.
      return;
    }
    updateTimeRange({
      mode: 'absolute',
      absStart: start.toISOString(),
      absEnd: end.toISOString()
    });
  }, [updateTimeRange]);

  // Comments integration tied to current config
  const chartComments = useChartComments(config);
  const [commentModalOpen, setCommentModalOpen] = useState(false);
  const [chartActionLevel, setChartActionLevel] = useState<number | undefined>(undefined);

  // Open comment modal when a selection range or comment is clicked
  useEffect(() => {
    if (chartComments.selectedTimeRange || chartComments.selectedComments) {
      setCommentModalOpen(true);
    }
  }, [chartComments.selectedTimeRange, chartComments.selectedComments]);


  // Road elevation GeoJSON — fetched from /public/data/
  const [roadData, setRoadData] = useState<GeoJSON.FeatureCollection<GeoJSON.LineString, RoadProperties> | undefined>(undefined);
  useEffect(() => {
    fetch('/data/carolinaBeachRoads.geojson?v=' + new Date().getTime())
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setRoadData(data); })
      .catch(() => { /* file not yet generated — map shows notice */ });
  }, []);

  /**
   * Focus helpers for specific data points
   */


  // Comments integration tied to current config

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
                          surge={activeAtmo.surge}
                          prediction={activeAtmo.prediction}
                          targetTime={activeAtmo.targetTime ?? undefined}
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
                      showComments={chartComments.showComments}
                      comments={chartComments.comments}
                      onCommentHover={(c) => chartComments.handleCommentHover(c)}
                      onCommentClick={(cs) => chartComments.handleCommentClick(cs)}
                      onTimePointSelect={(time: Date, level?: number) => {
                        // Skip the action sheet and go straight to comment form
                        setChartActionLevel(level);
                        chartComments.handleTimeRangeSelect({ at: time });
                      }}
                      onToggleComments={chartComments.toggleCommentOverlay}
                      commentCount={chartComments.commentCount}
                      onViewportChange={(start: Date, end: Date, focusTime: Date) => setCurrentViewport({ start, end, focusTime })}
                      onDomainChangeRequest={handleDomainChangeRequest}
                      loading={loading}
                      mode={config.timeRange.mode}
                      onResetToLive={resetToLive}
                      centerRequest={centerRequest}
                      resetKey={resetCount}
                      warnings={processedData.warnings}
                      viewMode={config.display.viewMode}
                    />

                    {/* Google Maps inundation map — FIMAN-style road coloring */}
                    <APIProvider apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''}>
                      <InundationMap
                        waterLevelFt={simulationLevel}
                        roadData={roadData}
                        observedLevelFt={processedData?.observedPoints?.slice(-1)[0]?.v}
                        targetTime={activeAtmo.targetTime || new Date()}
                        onResetToLive={resetToLive}
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
                        source: activeAtmo.source,
                        isSimulated: activeAtmo.isSimulated,
                      }}
                    />
                  </>
                ) : null}
              </div>

              <div className="dashboard-sidebar">
                <IonButton 
                  expand="block" 
                  fill="outline" 
                  className="ion-margin-bottom"
                  onClick={handleFindLastSimilar}
                  disabled={!activeAtmo.wl}
                >
                  Find Last Similar Level ({activeAtmo.wl?.toFixed(2)}')
                </IonButton>

                {WEBCAMS.map(cam => (
                    <WebcamFeedCard
                      key={cam.id}
                      cameraId={cam.id}
                      locationName={cam.name}
                      targetTime={activeAtmo.targetTime || new Date()}
                      onResetToLive={resetToLive}
                      imagery={processedData.imagery?.[cam.id]}
                    />
                ))}

                <FloodEventSidebar 
                  locationId={config.location.id} 
                  onEventSelect={handleEventSelect} 
                />
              </div>
            </div>
          </div>
        )}

        {/* Threshold crossing information */}
        {!loading && !error && thresholdCrossing && (
          <IonList className="crossing-info">
            <IonItem>
              <IonLabel>
                <h2>
                  Next Flood Crossing ({config.display.timezone === 'gmt' ? 'GMT' : 'Local'})
                </h2>
                <p>
                  {formatTime(thresholdCrossing.time)}
                  <span className="crossing-details">
                    {' '}• Lead time: {Math.round((thresholdCrossing.time.getTime() - (processedData?.timeDomain.now.getTime() || Date.now())) / 60000)} minutes
                  </span>
                </p>
              </IonLabel>
            </IonItem>
          </IonList>
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
        />

        {/* Chart comment creation modal */}
        <ChartCommentModal
          isOpen={commentModalOpen}
          onDismiss={() => { setCommentModalOpen(false); chartComments.clearSelected(); }}
          range={chartComments.selectedTimeRange || (chartComments.selectedComments?.[0]?.metadata.timeRange ?? null)}
          existingComments={chartComments.selectedComments || []}
          config={config}
          waterLevel={chartActionLevel}
        />
      </IonContent>
    </IonPage>
  );
};

export default Tab2;

import React, { useState, useMemo, useCallback } from 'react';
import {
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
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
// import { ChartViewer } from '../components/Tab2/ChartViewer'; // Removed to avoid confusion with default import in HydrographChart
import { SettingsModal } from '../components/Tab2/SettingsModal';
import { useSettingsStorage } from '../components/Tab2/hooks/useSettingsStorage';
import { useChartData } from '../components/Tab2/hooks/useChartData';
import { formatTooltipTime, findNearestPoint } from '../components/Tab2/hooks/useChartInteraction';
import type { Station } from '../components/Tab2/types';
import { useChartComments } from '../components/Tab2/hooks/useChartComments';
import { ChartCommentModal } from '../components/Tab2/ChartCommentModal';
import '../components/Tab2/styles/Tab2.css';
import './Tab2.css';
import '../components/dashboard/DashboardView.css';
import HydrographChart from '../components/dashboard/HydrographChart';
import AtmosphericOverlay from '../components/dashboard/AtmosphericOverlay';
import InundationMap from '../components/dashboard/InundationMap';
import InundationSimulator from '../components/dashboard/InundationSimulator';
import WebcamFeedCard from '../components/dashboard/WebcamFeedCard';
import { APIProvider } from '@vis.gl/react-google-maps';
// Removed unused types

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
    updateStation,
    updateThresholds,
    updateOffset,
    updateTimeRange,
    updateDisplay,
    resetToLive: baseResetToLive,
  } = useSettingsStorage();

  // State declarations (moved up to avoid TDZ)
  const [resetCount, setResetCount] = useState(0);
  const [currentViewport, setCurrentViewport] = React.useState<{ start: Date; end: Date; focusTime: Date } | null>(null);
  const [manualFocusTime, setManualFocusTime] = useState<Date | null>(null);
  const [centerRequest, setCenterRequest] = useState<{ time: Date; id: number } | undefined>(undefined);
  const [simulationLevel, setSimulationLevel] = useState<number>(2.5);

  const resetToLive = useCallback(() => {
    baseResetToLive();
    setCurrentViewport(null);
    setManualFocusTime(null);
    setResetCount(c => c + 1);
  }, [baseResetToLive]);

  // Professional data fetching and processing
  const {
    loading,
    error,
    data,
    processedData,
    thresholdCrossing,
    refresh,
  } = useChartData(config);

  // Track the buffered data window so we only refetch when the user scrolls
  // outside what we've already loaded (useChartData fetches ±5 days around
  // the current domain, so minor pans should never trigger a new request).
  const fetchedBufferRef = React.useRef<{ start: Date; end: Date } | null>(null);
  React.useEffect(() => {
    if (!processedData) return;
    const FETCH_BUFFER_MS = 5 * 24 * 3600_000;
    fetchedBufferRef.current = {
      start: new Date(processedData.timeDomain.start.getTime() - FETCH_BUFFER_MS),
      end: new Date(processedData.timeDomain.end.getTime() + FETCH_BUFFER_MS),
    };
  }, [processedData]);

  /**
   * Handle station selection changes
   */
  const handleStationChange = (station: Station) => {
    updateStation(station);
    setMessages({
      success: `Station updated to ${station.name} (${station.id})`,
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
  React.useEffect(() => {
    if (chartComments.selectedTimeRange || chartComments.selectedComments) {
      setCommentModalOpen(true);
    }
  }, [chartComments.selectedTimeRange, chartComments.selectedComments]);


  // Road elevation GeoJSON — fetched from /public/data/
  const [roadData, setRoadData] = useState<GeoJSON.FeatureCollection | undefined>(undefined);
  React.useEffect(() => {
    fetch('/data/carolinaBeachRoads.geojson?v=' + new Date().getTime())
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setRoadData(data); })
      .catch(() => { /* file not yet generated — map shows notice */ });
  }, []);

  /**
   * Focus helpers for specific data points
   */


  // Derive atmospheric values for the overlay pill and map visualization
  const activeAtmo = useMemo(() => {
    if (!processedData) {
      return { wl: 0, time: null, isLive: true, source: 'Live Conditions', wind: null, precip: null };
    }

    const now = processedData.timeDomain.now;

    const targetT = manualFocusTime || (currentViewport?.focusTime) || now;
    const isLive = !manualFocusTime && (!currentViewport || Math.abs(targetT.getTime() - now.getTime()) < 60000);
    if (manualFocusTime) {
      // Manual focus
    } else if (currentViewport) {
      // Scroll context
    }

    const obsRes = findNearestPoint(processedData.observedPoints, targetT);
    const adjRes = findNearestPoint(processedData.adjustedPoints, targetT);
    const predRes = findNearestPoint(processedData.predictedPoints, targetT);
    const windRes = findNearestPoint(processedData.windPoints, targetT);
    const precipRes = findNearestPoint(processedData.precipPoints, targetT);

    const isObserved = !!(obsRes && obsRes.dtMin < 60);
    const isAdjusted = !isObserved && !!(adjRes && adjRes.dtMin < 60);
    const isPredicted = !isObserved && !isAdjusted && !!(predRes && predRes.dtMin < 60);

    const wl = isObserved ? obsRes!.point.v :
               isAdjusted ? adjRes!.point.v :
               isPredicted ? predRes!.point.v : 0;

    const sourceLabel = isObserved ? 'Observed' :
                        isAdjusted ? 'FloodCast' :
                        isPredicted ? 'Predicted' : (isLive ? 'Live Conditions' : 'No Data');

    const surge = isObserved && predRes && predRes.dtMin < 60
      ? (obsRes!.point.v - predRes.point.v)
      : (isAdjusted && predRes && predRes.dtMin < 60)
        ? (adjRes!.point.v - predRes.point.v)
        : null;

    return { 
      wl, 
      time: targetT, 
      isLive, 
      source: sourceLabel,
      surge,
      prediction: predRes && predRes.dtMin < 60 ? predRes.point.v : null,
      wind: windRes && windRes.dtMin < 60 ? { speed: windRes.point.speed, dir: windRes.point.dir } : null,
      precip: precipRes && precipRes.dtMin < 60 ? { value: precipRes.point.value } : null,
    };
  }, [processedData, currentViewport, manualFocusTime, config?.timeRange]);

  // Sync simulation level (for map)
  React.useEffect(() => {
    if (activeAtmo.wl !== null && activeAtmo.wl !== undefined) {
      setSimulationLevel(activeAtmo.wl);
    }
  }, [activeAtmo.wl]);

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
                          precipitationAccumulation={activeAtmo.precip?.value ?? 0}
                          windSpeed={activeAtmo.wind?.speed ?? 0}
                          windDirection={activeAtmo.wind?.dir ?? 0}
                          observedWaterLevel={activeAtmo.wl ?? 0}
                          isLive={activeAtmo.isLive}
                          source={activeAtmo.source}
                          surge={activeAtmo.surge}
                          prediction={activeAtmo.prediction}
                        />
                      }
                      isLive={activeAtmo.isLive}
                      time={activeAtmo.time}
                      source={activeAtmo.source}
                      observedPoints={processedData.observedPoints}
                      predictedPoints={processedData.predictedPoints}
                      adjustedPoints={processedData.adjustedPoints}
                      deltaPoints={processedData.deltaPoints}
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
                    />

                    {/* Google Maps inundation map — FIMAN-style road coloring */}
                    <APIProvider apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''}>
                      <InundationMap
                        waterLevelFt={simulationLevel}
                        // @ts-expect-error missing strict typing
                        roadData={roadData}
                        observedLevelFt={processedData?.observedPoints?.slice(-1)[0]?.v}
                      />
                    </APIProvider>

                    <InundationSimulator
                      waterLevelFt={simulationLevel}
                      minLevelFt={0.0}
                      maxLevelFt={10.0}
                      onLevelChange={setSimulationLevel}
                      thresholds={config.thresholds}
                      // @ts-expect-error missing strict typing
                      simulationContext={activeAtmo}
                    />
                  </>
                ) : null}
              </div>

              <div className="dashboard-sidebar">
                <WebcamFeedCard
                  imageUrl="https://wl.secoora.org/webcam/SUNNYD_CB_02.2026-04-21T13:42Z.jpg"
                  locationName={`${config.station.name} - Cam`}
                  timestamp={new Date()}
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
                  {formatTime(thresholdCrossing.tCross)}
                  <IonNote className="lead-time" color="medium">
                    {' '}• Lead time: {thresholdCrossing.leadMinutes} minutes
                  </IonNote>
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
          onStationChange={handleStationChange}
          onThresholdsChange={updateThresholds}
          onOffsetConfigChange={updateOffset}
          onTimeRangeChange={updateTimeRange}
          onDisplayChange={updateDisplay}
          computedOffset={data?.offset || 0}
          offsetDataPoints={data?.nPoints || 0}
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

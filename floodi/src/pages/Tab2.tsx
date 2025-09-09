import React, { useState, useMemo } from 'react';
import {
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonPage,
  IonSpinner,
  IonTitle,
  IonToolbar,
  IonRefresher,
  IonRefresherContent,
  IonButtons,
  IonButton,
  IonIcon,
} from '@ionic/react';
import { settingsOutline } from 'ionicons/icons';
import { ChartViewer } from '../components/Tab2/ChartViewer';
import { SettingsModal } from '../components/Tab2/SettingsModal';
import { useSettingsStorage } from '../components/Tab2/hooks/useSettingsStorage';
import { useChartData } from '../components/Tab2/hooks/useChartData';
import { formatTooltipTime } from '../components/Tab2/hooks/useChartInteraction';
import type { Station } from '../components/Tab2/types';
import '../components/Tab2/styles/Tab2.css';
import './Tab2.css';

/**
 * Professional FloodCast Tab2 Component
 * 
 * This is the completely refactored Tab2 component that replaces the original
 * 1,037-line monolithic implementation with a clean, maintainable architecture
 * using professional Ionic patterns and decomposed components.
 * 
 * Key Improvements:
 * - Decomposed into focused, reusable components
 * - Professional state management with custom hooks
 * - Proper Ionic component usage instead of custom implementations
 * - Clean separation of concerns
 * - Comprehensive error handling and loading states
 * - Professional CSS architecture with Ionic design tokens
 * - Full accessibility support
 * - Extensive JSDoc documentation
 * 
 * @returns JSX.Element Professional FloodCast interface
 */
const Tab2: React.FC = () => {
  // Settings modal state
  const [showSettings, setShowSettings] = useState(false);
  
  // User feedback messages
  const [messages, setMessages] = useState<{
    success?: string | null;
    error?: string | null;
  }>({});

  // Professional configuration management
  const {
    config,
    updateStation,
    updateThreshold,
    updateOffset,
    updateTimeRange,
    updateDisplay,
  } = useSettingsStorage();

  // Professional data fetching and processing
  const {
    loading,
    error,
    data,
    processedData,
    thresholdCrossing,
    refresh,
  } = useChartData(config);

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

  /**
   * Format date/time based on current timezone setting
   */
  const formatTime = (date: Date): string => {
    return formatTooltipTime(date, config.display.timezone);
  };

  /**
   * Memoized chart configuration
   */
  const chartConfig = useMemo(() => ({
    threshold: config.threshold,
    showDelta: config.display.showDelta,
    timezone: config.display.timezone,
  }), [config.threshold, config.display.showDelta, config.display.timezone]);

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

      <IonContent fullscreen className="floodcast-content">
        {/* Pull-to-refresh functionality */}
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent 
            pullingText="Pull to refresh data" 
            refreshingSpinner="crescent" 
          />
        </IonRefresher>

        {/* Loading state */}
        {loading && (
          <div className="loading-container">
            <IonSpinner name="crescent" />
            <IonLabel>Loading water level data...</IonLabel>
          </div>
        )}

        {/* Error state */}
        {error && (
          <IonItem color="danger" className="error-item">
            <IonLabel>
              <h2>Failed to load data</h2>
              <p>{error}</p>
            </IonLabel>
            <IonButton 
              slot="end" 
              fill="clear" 
              onClick={() => refresh()}
            >
              Retry
            </IonButton>
          </IonItem>
        )}

        {/* Main chart display */}
        {!error && processedData && (
          <ChartViewer
            observedPoints={processedData.observedPoints}
            predictedPoints={processedData.predictedPoints}
            adjustedPoints={processedData.adjustedPoints}
            deltaPoints={processedData.deltaPoints}
            surgeForecastPoints={processedData.surgeForecastPoints}
            domainStart={processedData.timeDomain.start}
            domainEnd={processedData.timeDomain.end}
            now={processedData.timeDomain.now}
            threshold={config.threshold}
            showDelta={config.display.showDelta}
            timezone={config.display.timezone}
            config={chartConfig}
          />
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
          onThresholdChange={updateThreshold}
          onOffsetConfigChange={updateOffset}
          onTimeRangeChange={updateTimeRange}
          onDisplayChange={updateDisplay}
          computedOffset={data.offset}
          offsetDataPoints={data.nPoints}
          successMessage={messages.success}
          errorMessage={messages.error}
          onClearMessages={clearMessages}
        />
      </IonContent>
    </IonPage>
  );
};

export default Tab2;

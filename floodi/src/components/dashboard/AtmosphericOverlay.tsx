import React, { useState } from 'react';
import { IonIcon, IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonSkeletonText } from '@ionic/react';
import { closeOutline } from 'ionicons/icons';
import './AtmosphericOverlay.css';
import { AtmosphereMetrics, WaterLevelMetric } from './MetricPills';
import { ViewingTimePill } from './ViewingTimePill';
import { HydrologicalInsightContent } from './HydrologicalInsightContent';
import {
  getFloodSeverityColor,
  getFloodSeverityForLevel,
} from 'src/utils/floodSeverity';
import { NextTideInfo } from 'src/utils/tideExtrema';

interface AtmosphericOverlayProps {
  nextTideInfo?: NextTideInfo;
  precipitationAccumulation: number; // in inches
  windSpeed: number; // in mph
  windDirection: number; // in degrees (0 = North)
  targetTime?: Date;
  isLive?: boolean;
  observedWaterLevel?: number; // in ft
  onReset?: () => void;
  source?: string;
  fullSource?: string;
  sourceId?: string;
  surge?: number | null;
  prediction?: number | null;
  viewMode?: 'basic' | 'advanced';
  floodStartTime?: Date;
  floodEndTime?: Date;
  floodDuration?: string;
  maxRoadFloodDepth?: number;
  maxWaterLevel?: number;
  maxWaterLevelTime?: Date;
  thresholds?: { minor: number; moderate: number; major: number; extreme: number };
  statusLabel?: 'Observed' | 'Predicted';
  loading?: boolean;
  showWLInfo?: boolean;
  onShowWLInfoChange?: (show: boolean) => void;
}

export const AtmosphericOverlay: React.FC<AtmosphericOverlayProps> = ({
  nextTideInfo,
  precipitationAccumulation,
  windSpeed,
  windDirection,
  targetTime,
  isLive = true,
  observedWaterLevel = 0,
  source,
  fullSource,
  sourceId,
  surge,
  prediction,
  viewMode = 'basic',
  thresholds,
  floodStartTime,
  floodEndTime,
  floodDuration,
  maxRoadFloodDepth = 0,
  maxWaterLevel,
  maxWaterLevelTime,
  statusLabel = 'Observed',
  loading = false,
  showWLInfo: customShowWLInfo,
  onShowWLInfoChange,
}) => {
  const [localShowWLInfo, setLocalShowWLInfo] = useState(false);
  const showWLInfo = customShowWLInfo !== undefined ? customShowWLInfo : localShowWLInfo;
  const setShowWLInfo = onShowWLInfoChange !== undefined ? onShowWLInfoChange : setLocalShowWLInfo;
  const floodSeverity = thresholds ? getFloodSeverityForLevel(observedWaterLevel, thresholds) : observedWaterLevel >= 5.6 ? 'minor' : null;
  const wlColor = getFloodSeverityColor(floodSeverity);

  // Format time for the modal
  const localTime = targetTime 
    ? targetTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })
    : 'Now';

  return (
    <div className={`atmospheric-sentinel ${isLive ? 'is-live' : 'is-historical'} view-${viewMode}`}>
      {/* Status indicator moved to Hydrograph title subtitle for better layout */}

      <div 
        className="sentinel-metrics tidal-metrics interactive"
        style={!loading ? { '--wl-color': wlColor } as React.CSSProperties : undefined}
        onClick={!loading ? () => setShowWLInfo(true) : undefined}
        role="button"
        aria-label="View detailed water level insights"
      >
        {/* Tidal Group: Predicted + Surge = Final */}
        <div className="tidal-group">
          {viewMode === 'advanced' && (prediction !== null && prediction !== undefined || loading) && (
            <div className="metric-item prediction" title="NOAA Prediction">
              <div className="metric-icon-box">
                <span className="legend-dashed-line" style={{ backgroundColor: 'var(--line-predicted, #95a5a6)', width: '20px' }} />
              </div>
              <div className="metric-details">
                <div className="metric-value-row">
                  <span className="metric-value" style={{ color: 'var(--line-predicted, #95a5a6)' }}>
                    {loading ? <IonSkeletonText animated style={{ width: '32px', height: '20px' }} /> : prediction?.toFixed(2)}
                  </span>
                  {!loading && <span className="metric-unit">ft</span>}
                  {!loading && <span className="metric-status-label">Predicted</span>}
                </div>
                <div className="metric-label-row">
                  <span className="metric-label">Water Level</span>
                </div>
              </div>
            </div>
          )}

          {viewMode === 'advanced' && (surge !== null && surge !== undefined || loading) && (
            <>
              <span className="tidal-operator">+</span>
              <div className="metric-item surge-gauge" title="Surge (Observed - Predicted)">
                <div className="metric-icon-box">
                  {statusLabel === 'Predicted' ? (
                    <span className="legend-dashed-line" style={{ backgroundColor: '#1976d2', width: '16px' }} />
                  ) : (
                    <span className="legend-solid-line" style={{ backgroundColor: '#1976d2', width: '16px' }} />
                  )}
                </div>
                <div className="metric-details">
                  <div className="metric-value-row">
                    <span className="metric-value" style={{ color: '#1976d2' }}>
                      {loading ? <IonSkeletonText animated style={{ width: '32px', height: '20px' }} /> : (surge ? `${surge >= 0 ? '+' : ''}${surge.toFixed(2)}` : '0.00')}
                    </span>
                    {!loading && <span className="metric-unit">ft</span>}
                    {!loading && <span className="metric-status-label">{statusLabel}</span>}
                  </div>
                  <div className="metric-label-row">
                    <span className="metric-label">Water Level</span>
                  </div>
                </div>
              </div>
              <span className="tidal-operator">=</span>
            </>
          )}

          {/* Final Water Level (Observed or FloodCast) */}
          <WaterLevelMetric
            observedWaterLevel={observedWaterLevel}
            wlColor={wlColor}
            statusLabel={statusLabel}
            interactive={false}
            onClick={() => setShowWLInfo(true)}
            loading={loading}
          />
        </div>
      </div>

      {/* Combined Meteorological Pill (Wind + Precip) */}
      <AtmosphereMetrics
        precipitationAccumulation={precipitationAccumulation}
        windSpeed={windSpeed}
        windDirection={windDirection}
        loading={loading}
      />

      {/* Next Tide Glanceable Badge */}
      {!loading && nextTideInfo && (
        <div 
          className="next-tide-badge" 
          data-tour-id="next-tide-badge"
          style={{ cursor: 'pointer' }}
          onClick={() => setShowWLInfo(true)}
          role="button"
          aria-label="View detailed tide insights"
        >
          <div className="metric-details" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div className="metric-value-row">
              <span className={`tide-type ${nextTideInfo.type}`}>
                {nextTideInfo.type === 'high' ? '▲' : '▼'} {nextTideInfo.type === 'high' ? 'High' : 'Low'}
              </span>
              <span className="tide-countdown">
                in {nextTideInfo.minutesRemaining >= 60 ? `${Math.floor(nextTideInfo.minutesRemaining / 60)}h ${nextTideInfo.minutesRemaining % 60}m` : `${nextTideInfo.minutesRemaining}m`}
              </span>
            </div>
            <div className="metric-label-row">
              <span className="metric-label">
                {nextTideInfo.heightDelta >= 0 ? '+' : ''}{nextTideInfo.heightDelta.toFixed(2)} ft
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Water Level Info Modal */}
      <IonModal 
        isOpen={showWLInfo} 
        onDidDismiss={() => setShowWLInfo(false)}
        className="datum-info-modal"
        breakpoints={[0, 0.5, 1.0]}
        initialBreakpoint={1.0}
        handle={true}
      >
        <IonHeader className="ion-no-border">
          <IonToolbar>
            <IonTitle>
              <div className={`insight-modal-title ${isLive ? 'is-live' : 'is-historical'}`}>
                <span>Flood Insight</span>
                <ViewingTimePill time={targetTime} fallbackLabel={localTime} />
              </div>
            </IonTitle>
            <IonButtons slot="end">
              <IonButton onClick={() => setShowWLInfo(false)}>
                <IonIcon icon={closeOutline} />
              </IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          <HydrologicalInsightContent
            nextTideInfo={nextTideInfo}
            precipitationAccumulation={precipitationAccumulation}
            windSpeed={windSpeed}
            windDirection={windDirection}
            targetTime={targetTime}
            isLive={isLive}
            observedWaterLevel={observedWaterLevel}
            source={source}
            fullSource={fullSource}
            sourceId={sourceId}
            surge={surge}
            prediction={prediction}
            viewMode={viewMode}
            thresholds={thresholds}
            floodStartTime={floodStartTime}
            floodEndTime={floodEndTime}
            floodDuration={floodDuration}
            maxRoadFloodDepth={maxRoadFloodDepth}
            maxWaterLevel={maxWaterLevel}
            maxWaterLevelTime={maxWaterLevelTime}
            statusLabel={statusLabel}
            onClose={() => setShowWLInfo(false)}
          />
        </IonContent>
      </IonModal>

    </div>
  );
};

export default AtmosphericOverlay;

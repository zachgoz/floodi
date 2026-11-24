import React, { useState } from 'react';
import { IonIcon, IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonSkeletonText } from '@ionic/react';
import { chevronForwardOutline, closeOutline, timeOutline } from 'ionicons/icons';
import './AtmosphericOverlay.css';
import { AtmosphereMetrics, WaterLevelMetric } from './MetricPills';
import { ViewingTimePill } from './ViewingTimePill';
import { HydrologicalInsightContent } from './HydrologicalInsightContent';
import { useSimilarFloodEvents } from './useSimilarFloodEvents';
import type { FloodEvent } from 'src/types/data';
import {
  getFloodSeverityColor,
  getFloodSeverityForLevel,
} from 'src/utils/floodSeverity';
import { NextTideInfo } from 'src/utils/tideExtrema';
import { LOCAL_ZONE } from 'src/utils/waterForecast';

function formatShortPeakDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    timeZone: LOCAL_ZONE,
    month: 'short',
    day: 'numeric',
  });
}

function formatFullPeakDate(date: Date): string {
  return date.toLocaleString('en-US', {
    timeZone: LOCAL_ZONE,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

interface AtmosphericOverlayProps {
  nextTideInfo?: NextTideInfo;
  precipitationAccumulation: number | null; // in inches
  windSpeed: number | null; // in mph
  windDirection: number | null; // in degrees (0 = North)
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
  statusLabel?: 'Observed' | 'Predicted' | 'Estimated';
  loading?: boolean;
  showWLInfo?: boolean;
  onShowWLInfoChange?: (show: boolean) => void;
  floodEvents?: FloodEvent[];
  now?: Date;
  onJumpToTime?: (time: Date) => void;
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
  floodEvents,
  now,
  onJumpToTime,
}) => {
  const [localShowWLInfo, setLocalShowWLInfo] = useState(false);
  const showWLInfo = customShowWLInfo !== undefined ? customShowWLInfo : localShowWLInfo;
  const setShowWLInfo = onShowWLInfoChange !== undefined ? onShowWLInfoChange : setLocalShowWLInfo;
  const minorThreshold = thresholds?.minor ?? 5.6;
  const floodSeverity = thresholds ? getFloodSeverityForLevel(observedWaterLevel, thresholds) : observedWaterLevel >= 5.6 ? 'minor' : null;
  const wlColor = getFloodSeverityColor(floodSeverity);

  const referenceNow = now ?? new Date();
  const isNearOrAboveFlood = !loading && Number.isFinite(observedWaterLevel) && observedWaterLevel >= minorThreshold - 0.5;
  const similarEvents = useSimilarFloodEvents(
    floodEvents,
    isNearOrAboveFlood ? observedWaterLevel : null,
    referenceNow,
  );
  const topSimilar = similarEvents[0] ?? null;
  const hasSurge = typeof surge === 'number' && Number.isFinite(surge);

  // Format time for the modal
  const localTime = targetTime 
    ? targetTime.toLocaleTimeString([], { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true })
    : 'Now';

  const handleJumpSimilar = (event: FloodEvent) => {
    const peakTime = new Date(event.peakTime);
    if (!Number.isFinite(peakTime.getTime())) return;
    onJumpToTime?.(peakTime);
    setShowWLInfo(false);
  };

  return (
    <div className={`atmospheric-sentinel ${isLive ? 'is-live' : 'is-historical'} view-${viewMode}`}>
      <button
        type="button"
        className="sentinel-metrics tidal-metrics interactive"
        style={!loading ? { '--wl-color': wlColor } as React.CSSProperties : undefined}
        onClick={!loading ? () => setShowWLInfo(true) : undefined}
        disabled={loading}
        aria-label="View water level and flood insight details"
      >
        {/* Tidal Group: Predicted + Surge = Final */}
        <div className="tidal-group">
          {viewMode === 'advanced' && (prediction !== null && prediction !== undefined || loading) && (
            <div className="metric-item prediction">
              <div className="metric-icon-box">
                <span className="legend-dashed-line" style={{ backgroundColor: 'var(--line-predicted, #95a5a6)', width: '20px' }} />
              </div>
              <div className="metric-details">
                <div className="metric-value-row">
                  <span className="metric-value" style={{ color: 'var(--line-predicted, #95a5a6)' }}>
                    {loading ? <IonSkeletonText animated style={{ width: '32px', height: '20px' }} /> : prediction?.toFixed(2)}
                  </span>
                  {!loading && <span className="metric-unit">ft</span>}
                  {!loading && <span className="metric-status-label">Tide</span>}
                </div>
                <div className="metric-label-row">
                  <span className="metric-label">Predicted</span>
                </div>
              </div>
            </div>
          )}

          {viewMode === 'advanced' && (hasSurge || loading) && (
            <>
              <span className="tidal-operator" aria-hidden="true">+</span>
              <div className="metric-item surge-gauge">
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
                      {loading ? <IonSkeletonText animated style={{ width: '32px', height: '20px' }} /> : `${surge! >= 0 ? '+' : ''}${surge!.toFixed(2)}`}
                    </span>
                    {!loading && <span className="metric-unit">ft</span>}
                    {!loading && <span className="metric-status-label">Surge</span>}
                  </div>
                  <div className="metric-label-row">
                    <span className="metric-label">vs Tide</span>
                  </div>
                </div>
              </div>
              <span className="tidal-operator" aria-hidden="true">=</span>
            </>
          )}

          {/* Final Water Level (Observed or FloodCast) */}
          <WaterLevelMetric
            observedWaterLevel={observedWaterLevel}
            wlColor={wlColor}
            statusLabel={statusLabel}
            interactive={false}
            loading={loading}
          />
          {viewMode === 'basic' && !loading && hasSurge && (
            <span className={`sentinel-surge-chip ${surge! >= 0 ? 'is-positive' : 'is-negative'}`}>
              {surge! >= 0 ? '+' : ''}{surge!.toFixed(2)} ft surge
            </span>
          )}
          {!loading && <IonIcon icon={chevronForwardOutline} className="sentinel-chevron" aria-hidden="true" />}
        </div>
      </button>

      {/* Combined Meteorological Pill (Wind + Precip) */}
      <AtmosphereMetrics
        precipitationAccumulation={precipitationAccumulation}
        windSpeed={windSpeed}
        windDirection={windDirection}
        loading={loading}
      />

      {/* Next Tide Glanceable Badge */}
      {!loading && nextTideInfo && (
        <button
          type="button"
          className="next-tide-badge"
          data-tour-id="next-tide-badge"
          onClick={() => setShowWLInfo(true)}
          aria-label={`Next ${nextTideInfo.type} tide details`}
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
        </button>
      )}

      {/* Stationary, mobile-friendly Past Similar Tide chip (replaces unclickable SVG hover tooltip) */}
      {!loading && topSimilar && onJumpToTime && (
        <button
          type="button"
          className="similar-peak-chip"
          onClick={() => handleJumpSimilar(topSimilar)}
          aria-label={`Jump to similar past tide on ${formatShortPeakDate(new Date(topSimilar.peakTime))} at ${topSimilar.peakValue.toFixed(2)} feet`}
        >
          <IonIcon icon={timeOutline} aria-hidden="true" />
          <span>
            Past similar: <strong>{formatShortPeakDate(new Date(topSimilar.peakTime))}</strong> ({topSimilar.peakValue.toFixed(1)} ft)
          </span>
          <IonIcon icon={chevronForwardOutline} aria-hidden="true" />
        </button>
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
              <IonButton onClick={() => setShowWLInfo(false)} aria-label="Close flood insight">
                <IonIcon icon={closeOutline} aria-hidden="true" />
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
          >
            {isNearOrAboveFlood && onJumpToTime && (
              <div className="similar-events-section">
                <div className="similar-events-header">
                  <IonIcon icon={timeOutline} aria-hidden="true" />
                  <h3>View Similar Past Events</h3>
                </div>
                {similarEvents.length > 0 ? (
                  <div className="similar-events-actions">
                    {similarEvents.map(event => (
                      <IonButton
                        key={`${event.peakTime}-${event.peakValue}`}
                        expand="block"
                        fill="outline"
                        className="similar-event-button"
                        style={{ '--event-color': wlColor } as React.CSSProperties}
                        onClick={() => handleJumpSimilar(event)}
                      >
                        {formatFullPeakDate(new Date(event.peakTime))} - {event.peakValue.toFixed(2)}&apos;
                      </IonButton>
                    ))}
                  </div>
                ) : (
                  <p className="similar-events-empty">No historical flood peaks within 1 inch of this level.</p>
                )}
              </div>
            )}
          </HydrologicalInsightContent>
        </IonContent>
      </IonModal>

    </div>
  );
};

export default AtmosphericOverlay;

import React, { useState } from 'react';
import { IonIcon, IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent } from '@ionic/react';
import { closeOutline } from 'ionicons/icons';
import './AtmosphericOverlay.css';
import { AtmosphereMetrics, WaterLevelMetric } from './MetricPills';
import { ViewingTimePill } from './ViewingTimePill';

interface AtmosphericOverlayProps {
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
}

/** Get descriptive name for flood category */
function getFloodCategory(level: number, thresholds?: AtmosphericOverlayProps['thresholds']): string {
  if (!thresholds) return level >= 5.6 ? 'Minor' : 'None';
  
  if (level >= thresholds.extreme) return 'Extreme';
  if (level >= thresholds.major) return 'Major';
  if (level >= thresholds.moderate) return 'Moderate';
  if (level >= thresholds.minor) return 'Minor';
  return 'None';
}

/** Dynamic color for water level based on flood thresholds */
function waterColor(level: number, thresholds?: AtmosphericOverlayProps['thresholds']): string {
  if (!thresholds) {
    // Fallback to defaults if thresholds aren't provided
    if (level < 5.6) return 'var(--line-observed, #2ecc71)'; // Green
    if (level < 7.0) return '#fbc02d'; // Yellow (Minor)
    if (level < 7.7) return '#f57c00'; // Orange (Moderate)
    if (level < 8.5) return '#d32f2f'; // Red (Major)
    return '#7b1fa2'; // Purple (Extreme)
  }

  if (level < thresholds.minor) return 'var(--line-observed, #2ecc71)';
  if (level < thresholds.moderate) return '#fbc02d';
  if (level < thresholds.major) return '#f57c00';
  if (level < thresholds.extreme) return '#d32f2f';
  return '#7b1fa2';
}

/** Format depth in inches or ft' in" */
function formatDepth(feet: number): string {
  if (feet <= 0) return 'None';
  const totalInches = Math.round(feet * 12);
  if (totalInches < 12) {
    return `${totalInches}"`;
  }
  const ft = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return inches > 0 ? `${ft}' ${inches}"` : `${ft}'`;
}

function formatWindowTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
}

function getDataSourceDetails(sourceId?: string, dataSource?: string) {
  if (sourceId === 'fiman') {
    return {
      label: 'Observed Water Level (Fiman station Myrtle Grove Sound @ Canal Dr & Sandpiper Ln - Site ID: 30046)',
      url: 'https://fiman.nc.gov/?id=30046',
      linkLabel: 'View FIMAN Station',
    };
  }

  if (sourceId === 'noaa') {
    return {
      label: 'NOAA Wrightsville Beach Station',
      url: 'https://tidesandcurrents.noaa.gov/waterlevels.html?id=8658163',
      linkLabel: 'View NOAA Station',
    };
  }

  return dataSource ? { label: dataSource } : null;
}

export const AtmosphericOverlay: React.FC<AtmosphericOverlayProps> = ({
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
}) => {
  const [showWLInfo, setShowWLInfo] = useState(false);
  const wlColor = waterColor(observedWaterLevel, thresholds);
  const floodCategory = getFloodCategory(observedWaterLevel, thresholds);
  const dataSource = fullSource || source;
  const dataSourceDetails = getDataSourceDetails(sourceId, dataSource);
  const hasFloodWindow = Boolean(floodStartTime && floodEndTime);

  // Format time for the modal
  const localTime = targetTime 
    ? targetTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })
    : 'Now';

  return (
    <div className={`atmospheric-sentinel ${isLive ? 'is-live' : 'is-historical'} view-${viewMode}`}>
      {/* Status indicator moved to Hydrograph title subtitle for better layout */}

      <div className="sentinel-metrics tidal-metrics">
        {/* Tidal Group: Predicted + Surge = Final */}
        <div className="tidal-group">
          {viewMode === 'advanced' && prediction !== null && prediction !== undefined && (
            <div className="metric-item prediction" title="NOAA Prediction">
              <div className="metric-icon-box">
                <span className="legend-dashed-line" style={{ backgroundColor: 'var(--line-predicted, #95a5a6)', width: '20px' }} />
              </div>
              <div className="metric-details">
                <div className="metric-value-row">
                  <span className="metric-value" style={{ color: 'var(--line-predicted, #95a5a6)' }}>{prediction.toFixed(2)}</span>
                  <span className="metric-unit">ft</span>
                  <span className="metric-status-label">Predicted</span>
                </div>
                <div className="metric-label-row">
                  <span className="metric-label">Water Level</span>
                </div>
              </div>
            </div>
          )}

          {viewMode === 'advanced' && surge !== null && surge !== undefined && (
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
                    <span className="metric-value" style={{ color: '#1976d2' }}>{surge >= 0 ? '+' : ''}{surge.toFixed(2)}</span>
                    <span className="metric-unit">ft</span>
                    <span className="metric-status-label">{statusLabel}</span>
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
            interactive
            onClick={() => setShowWLInfo(true)}
          />
        </div>
      </div>

      {/* Combined Meteorological Pill (Wind + Precip) */}
      <AtmosphereMetrics
        precipitationAccumulation={precipitationAccumulation}
        windSpeed={windSpeed}
        windDirection={windDirection}
      />

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
                <span>Hydrological Insight</span>
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
          <div className="datum-info-content">
            <div className={`modal-summary-section view-${viewMode}`}>
              <div className="insight-observation-section">
                <div className="sentinel-metrics tidal-metrics">
                  <div className="tidal-group">
                    <WaterLevelMetric
                      observedWaterLevel={observedWaterLevel}
                      wlColor={wlColor}
                      statusLabel={statusLabel}
                    />
                  </div>
                </div>
              </div>

              {(windSpeed > 0 || (precipitationAccumulation !== undefined && precipitationAccumulation > 0.005)) && (
                <div className="insight-observation-section">
                  <AtmosphereMetrics
                    precipitationAccumulation={precipitationAccumulation}
                    windSpeed={windSpeed}
                    windDirection={windDirection}
                  />
                </div>
              )}
            </div>

            <div className="datum-insight-grid">
              <div className="insight-row">
                <span className="flooding-label-group">
                  <span className="insight-label">Flooding:</span>
                  <span className="flooding-category-value" style={{ color: wlColor }}>{floodCategory}</span>
                </span>
                <span className="flooding-combined-value">
                  {maxWaterLevelTime && (
                    <span className="flooding-peak-time">Water Peaks after {formatWindowTime(maxWaterLevelTime)}</span>
                  )}
                  <span className="flooding-depth-value">
                    <span>Max Street Flooding: </span>
                    <strong>{formatDepth(maxRoadFloodDepth)}</strong>
                  </span>
                  {maxWaterLevel !== undefined && maxWaterLevelTime && (
                    <span className="flooding-depth-value">
                      <span>Max Water Level: </span>
                      <strong>{maxWaterLevel.toFixed(2)} ft</strong>
                    </span>
                  )}
                </span>
              </div>

              {hasFloodWindow && floodStartTime && floodEndTime && (
                <div className="insight-row">
                  <span className="insight-label">Approx. Flooding Time:</span>
                  <span className="insight-value insight-time-value">
                    {formatWindowTime(floodStartTime)} - {formatWindowTime(floodEndTime)}
                    {floodDuration ? ` (${floodDuration})` : ''}
                  </span>
                </div>
              )}

            </div>

            <div className="insight-paragraph">
              <p>
                At <strong>{localTime}</strong> local time, the water level is {isLive ? 'currently' : 'predicted to be'} <strong>{observedWaterLevel.toFixed(2)} ft MLLW</strong>. 
                {surge !== null && surge !== undefined && (
                  <> This is <strong>{Math.abs(surge).toFixed(2)} ft {surge >= 0 ? 'higher' : 'lower'}</strong> than NOAA originally forecast.</>
                )}
              </p>
            </div>
            
            <div className="datum-source-footer">
              {dataSourceDetails && (
                <h4>
                  Data Source: {dataSourceDetails.label}
                  {dataSourceDetails.url && (
                    <a
                      href={dataSourceDetails.url}
                      target="_blank"
                      rel="noreferrer"
                      className="datum-source-link"
                    >
                      {dataSourceDetails.linkLabel}
                    </a>
                  )}
                </h4>
              )}
              <p>
                Value is relative to the <strong>MLLW (Mean Lower Low Water)</strong> datum. 
                {sourceId === 'floodcast' && " FloodCast uses recent surge trends to improve upon standard NOAA harmonic predictions."}
              </p>
            </div>
            
            <div style={{ marginTop: '24px' }}>
              <IonButton expand="block" mode="ios" onClick={() => setShowWLInfo(false)}>Close</IonButton>
            </div>
          </div>
        </IonContent>
      </IonModal>

    </div>
  );
};

export default AtmosphericOverlay;

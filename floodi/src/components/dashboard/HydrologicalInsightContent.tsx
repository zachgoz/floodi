import React from 'react';
import {
  IonAccordion,
  IonAccordionGroup,
  IonButton,
  IonItem,
  IonLabel,
} from '@ionic/react';
import './HydrologicalInsightContent.css';
import { AtmosphereMetrics, WaterLevelMetric } from './MetricPills';
import {
  getFloodSeverityColor,
  getFloodSeverityForLevel,
  getFloodSeverityLabel,
  type FloodThresholds,
} from 'src/utils/floodSeverity';

interface HydrologicalInsightContentProps {
  precipitationAccumulation: number;
  windSpeed: number;
  windDirection: number;
  targetTime?: Date;
  isLive?: boolean;
  observedWaterLevel?: number;
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
  thresholds?: FloodThresholds;
  statusLabel?: 'Observed' | 'Predicted';
  onClose?: () => void;
  children?: React.ReactNode;
}

function formatDepth(feet: number): string {
  if (feet <= 0) return 'None';
  const totalInches = Math.round(feet * 12);
  if (totalInches < 12) return `${totalInches}"`;
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
      summaryLabel: 'FiMAN observed water level',
      label: 'Observed Water Level (Fiman station Myrtle Grove Sound @ Canal Dr & Sandpiper Ln - Site ID: 30046)',
      url: 'https://fiman.nc.gov/?id=30046',
      linkLabel: 'View FIMAN Station',
    };
  }

  if (sourceId === 'noaa') {
    return {
      summaryLabel: 'NOAA Wrightsville Beach',
      label: 'NOAA Wrightsville Beach Station',
      url: 'https://tidesandcurrents.noaa.gov/waterlevels.html?id=8658163',
      linkLabel: 'View NOAA Station',
    };
  }

  return dataSource ? { summaryLabel: dataSource, label: dataSource } : null;
}

export const HydrologicalInsightContent: React.FC<HydrologicalInsightContentProps> = ({
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
  onClose,
  children,
}) => {
  const floodSeverity = thresholds ? getFloodSeverityForLevel(observedWaterLevel, thresholds) : observedWaterLevel >= 5.6 ? 'minor' : null;
  const wlColor = getFloodSeverityColor(floodSeverity);
  const floodCategory = getFloodSeverityLabel(floodSeverity);
  const dataSource = fullSource || source;
  const dataSourceDetails = getDataSourceDetails(sourceId, dataSource);
  const hasFloodWindow = Boolean(floodStartTime && floodEndTime);
  const localTime = targetTime
    ? targetTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })
    : 'Now';

  return (
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

      {floodSeverity !== null && (
        <div className="insight-paragraph">
          <p>
            At <strong>{localTime}</strong> local time, the water level is {isLive ? 'currently' : 'predicted to be'} <strong>{observedWaterLevel.toFixed(2)} ft MLLW</strong>.
            {surge !== null && surge !== undefined && (
              <> This is <strong>{Math.abs(surge).toFixed(2)} ft {surge >= 0 ? 'higher' : 'lower'}</strong> than NOAA originally forecast.</>
            )}
          </p>
        </div>
      )}

      {children}

      <div className="datum-source-footer">
        {dataSourceDetails && (
          <IonAccordionGroup className="datum-source-accordion">
            <IonAccordion value="data-source">
              <IonItem slot="header" lines="none">
                <IonLabel>
                  <h4>Data Source</h4>
                  <p>{dataSourceDetails.summaryLabel}</p>
                </IonLabel>
              </IonItem>
              <div slot="content" className="datum-source-accordion-content">
                <p>{dataSourceDetails.label}</p>
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
                <p className="datum-source-datum-note">
                  Value is relative to the <strong>MLLW (Mean Lower Low Water)</strong> datum.
                  {sourceId === 'floodcast' && " FloodCast uses recent surge trends to improve upon standard NOAA harmonic predictions."}
                </p>
              </div>
            </IonAccordion>
          </IonAccordionGroup>
        )}
      </div>

      {onClose && (
        <div style={{ marginTop: '24px' }}>
          <IonButton expand="block" mode="ios" onClick={onClose}>Close</IonButton>
        </div>
      )}
    </div>
  );
};

export default HydrologicalInsightContent;

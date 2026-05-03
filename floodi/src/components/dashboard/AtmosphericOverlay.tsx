import React from 'react';
import { IonIcon } from '@ionic/react';
import { waterOutline } from 'ionicons/icons';
import './AtmosphericOverlay.css';

interface AtmosphericOverlayProps {
  precipitationAccumulation: number; // in inches
  windSpeed: number; // in mph
  windDirection: number; // in degrees (0 = North)
  targetTime?: Date;
  isLive?: boolean;
  observedWaterLevel?: number; // in ft
  onReset?: () => void;
  source?: string;
  surge?: number | null;
  prediction?: number | null;
  viewMode?: 'basic' | 'advanced';
  thresholds?: {
    minor: number;
    moderate: number;
    major: number;
    extreme: number;
  };
}

/** Convert a meteorological bearing (0° = N, clockwise) to a compass label */
const COMPASS_DIRS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
function degToCompass(deg: number): string {
  return COMPASS_DIRS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

/** Colour-ramp matching the chart wind arrows: cyan (calm) → yellow → red (strong) */
function windColor(speed: number): string {
  const t = Math.min(1, speed / 35);
  const r = Math.round(t * 220);
  const g = Math.round((1 - t) * 180 + t * 80);
  const b = Math.round((1 - t) * 220);
  return `rgb(${r},${g},${b})`;
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

export const AtmosphericOverlay: React.FC<AtmosphericOverlayProps> = ({
  precipitationAccumulation,
  windSpeed,
  windDirection,
  targetTime,
  isLive = true,
  observedWaterLevel = 0,
  source,
  surge,
  prediction,
  viewMode = 'basic',
  thresholds,
}) => {
  const arrowColor = windColor(windSpeed);
  const wlColor = waterColor(observedWaterLevel, thresholds);
  const observedGreen = 'var(--line-observed, #2ecc71)';
  const arrowLen = 10;

  return (
    <div className={`atmospheric-sentinel ${isLive ? 'is-live' : 'is-historical'} view-${viewMode}`}>
      {/* Status indicator moved to Hydrograph title subtitle for better layout */}

      <div className="sentinel-metrics tidal-metrics">
        {/* Tidal Group: Predicted + Surge = Final */}
        <div className="tidal-group">
          {viewMode === 'advanced' && prediction !== null && prediction !== undefined && (
            <div className="metric-item prediction" title="NOAA Prediction">
              <div className="metric-icon-box">
                <span className="legend-dot" style={{ backgroundColor: 'var(--line-predicted, #95a5a6)', width: '10px', height: '10px' }} />
              </div>
              <div className="metric-details">
                <div className="metric-value-row">
                  <span className="metric-value">{prediction.toFixed(2)}</span>
                  <span className="metric-unit">ft</span>
                </div>
                <div className="metric-label-row">
                  <span className="metric-label">NOAA<br/>Prediction</span>
                </div>
              </div>
            </div>
          )}

          {viewMode === 'advanced' && surge !== null && surge !== undefined && (
            <>
              <span className="tidal-operator">+</span>
              <div className="metric-item surge-gauge" title="Surge (Observed - Predicted)">
                <div className="metric-icon-box">
                  {source === 'FloodCast' ? (
                    <span className="legend-dashed-line" style={{ borderColor: '#1976d2', width: '16px' }} />
                  ) : (
                    <span className="legend-dot" style={{ backgroundColor: '#1976d2', width: '10px', height: '10px' }} />
                  )}
                </div>
                <div className="metric-details">
                  <div className="metric-value-row">
                    <span className="metric-value">{surge >= 0 ? '+' : ''}{surge.toFixed(2)}</span>
                    <span className="metric-unit">ft</span>
                  </div>
                  <div className="metric-label-row">
                    <span className="metric-label">
                      {source === 'FloodCast' ? <>Predicted<br/>Surge</> : <>Observed<br/>Surge</>}
                    </span>
                  </div>
                </div>
              </div>
              <span className="tidal-operator">=</span>
            </>
          )}

          {/* Final Water Level (Observed or FloodCast) */}
          <div className="metric-item water-level highlight" title="Final Water Level">
            <div className="metric-icon-box">
              {source === 'FloodCast' ? (
                <span className="legend-dashed-line" style={{ borderColor: observedGreen, width: '16px' }} />
              ) : (
                <span className="legend-dot" style={{ backgroundColor: observedGreen, width: '10px', height: '10px' }} />
              )}
            </div>
            <div className="metric-details">
              <div className="metric-value-row">
                <span className="metric-value" style={{ color: wlColor }}>{observedWaterLevel.toFixed(2)}</span>
                <span className="metric-unit">ft</span>
              </div>
              <div className="metric-label-row">
                <span className="metric-label">
                  {source === 'Observed' ? <>Observed<br/>Water Level</> : (source === 'FloodCast' ? <>Floodcast<br/>Water Level</> : (viewMode === 'basic' ? <>Water Level</> : <>Total<br/>Water Level</>))}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Wind */}
      <div className="sentinel-metrics atmo-metrics">
        <div className="metric-item wind-level">
          <div className="metric-icon-box">
            <svg
              width={18}
              height={18}
              viewBox="-9 -9 18 18"
              className="wind-arrow-svg"
            >
              <g transform={`rotate(${windDirection + 180})`}>
                <line
                  x1={0} y1={arrowLen / 2}
                  x2={0} y2={-arrowLen / 2}
                  stroke={arrowColor}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                />
                <polygon
                  points={`0,${-arrowLen / 2 - 3} -2.5,${-arrowLen / 2 + 1} 2.5,${-arrowLen / 2 + 1}`}
                  fill={arrowColor}
                />
              </g>
            </svg>
          </div>
          <span className="atmo-time">
            {targetTime?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          <div className="metric-details">
            <div className="metric-value-row">
              <span className="metric-value" style={{ color: arrowColor }}>{windSpeed.toFixed(0)}</span>
              <span className="metric-unit">mph</span>
              <span className="metric-dir">{degToCompass(windDirection)}</span>
            </div>
            <span className="metric-label">Wind</span>
          </div>
        </div>
      </div>

      {precipitationAccumulation !== undefined && precipitationAccumulation > 0.005 && (
        <div className="sentinel-metrics atmo-metrics">
          <div className="metric-item precip-level">
            <div className="metric-icon-box">
              <IonIcon icon={waterOutline} className="metric-icon precip" />
            </div>
            <div className="metric-details">
              <div className="metric-value-row">
                <span className="metric-value">{precipitationAccumulation.toFixed(2)}</span>
                <span className="metric-unit">in</span>
              </div>
              <span className="metric-label">Precip</span>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default AtmosphericOverlay;

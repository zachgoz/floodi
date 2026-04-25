import React from 'react';
import { IonIcon } from '@ionic/react';
import { waterOutline } from 'ionicons/icons';
import './AtmosphericOverlay.css';

interface AtmosphericOverlayProps {
  precipitationAccumulation: number; // in inches
  windSpeed: number; // in mph
  windDirection: number; // in degrees (0 = North)
  time?: Date;
  isLive?: boolean;
  observedWaterLevel?: number; // in ft
  onReset?: () => void;
  source?: string;
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

export const AtmosphericOverlay: React.FC<AtmosphericOverlayProps> = ({
  precipitationAccumulation,
  windSpeed,
  windDirection,
  time,
  isLive = true,
  observedWaterLevel = 0,
  onReset,
  source,
}) => {
  const arrowColor = windColor(windSpeed);
  const arrowLen = 10;

  return (
    <div className={`atmospheric-sentinel ${isLive ? 'is-live' : 'is-historical'}`}>
      {/* Status indicator moved to Hydrograph title subtitle for better layout */}

      <div className="sentinel-metrics">
        {/* Observed Water Level */}
        <div className="metric-item water-level" title="Observed Water Level">
          <div className="metric-icon-box">
            <IonIcon icon={waterOutline} className="metric-icon tide" />
          </div>
          <div className="metric-details">
            <span className="metric-label">
              {isLive ? 'Observed' : (source === 'Scroll Context' ? 'Viewing' : (source || 'Observed'))}
            </span>
            <div className="metric-value-row">
              <span className="metric-value">{observedWaterLevel.toFixed(2)}</span>
              <span className="metric-unit">ft</span>
            </div>
          </div>
        </div>

        {precipitationAccumulation !== undefined && precipitationAccumulation > 0.005 && (
          <>
            <div className="metric-divider" />
            <div className="metric-item precip-level">
              <div className="metric-icon-box">
                <IonIcon icon={waterOutline} className="metric-icon precip" />
              </div>
              <div className="metric-details">
                <span className="metric-label">Precip</span>
                <div className="metric-value-row">
                  <span className="metric-value">{precipitationAccumulation.toFixed(2)}</span>
                  <span className="metric-unit">in</span>
                </div>
              </div>
            </div>
          </>
        )}

        <div className="metric-divider" />

        {/* Wind */}
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
          <div className="metric-details">
            <span className="metric-label">Wind</span>
            <div className="metric-value-row">
              <span className="metric-value" style={{ color: arrowColor }}>{windSpeed.toFixed(0)}</span>
              <span className="metric-unit">mph</span>
              <span className="metric-dir">{degToCompass(windDirection)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AtmosphericOverlay;

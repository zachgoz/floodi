import { IonIcon, IonSkeletonText } from '@ionic/react';
import { helpCircleOutline, waterOutline } from 'ionicons/icons';

/** Convert a meteorological bearing (0deg = N, clockwise) to a compass label */
const COMPASS_DIRS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

function degToCompass(deg: number): string {
  return COMPASS_DIRS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

/** Color-ramp matching the chart wind arrows: cyan (calm) to yellow to red (strong) */
function windColor(speed: number): string {
  const t = Math.min(1, speed / 35);
  const r = Math.round(t * 220);
  const g = Math.round((1 - t) * 180 + t * 80);
  const b = Math.round((1 - t) * 220);
  return `rgb(${r},${g},${b})`;
}

interface WaterLevelMetricProps {
  observedWaterLevel: number;
  wlColor: string;
  statusLabel: 'Observed' | 'Predicted';
  interactive?: boolean;
  onClick?: () => void;
  loading?: boolean;
}

export const WaterLevelMetric: React.FC<WaterLevelMetricProps> = ({
  observedWaterLevel,
  wlColor,
  statusLabel,
  interactive = false,
  onClick,
  loading = false,
}) => (
  <div
    className={`metric-item water-level highlight${interactive ? ' interactive' : ''}${loading ? ' is-loading' : ''}`}
    title={interactive && !loading ? 'Click for details' : undefined}
    onClick={!loading ? onClick : undefined}
  >
    <div className="metric-icon-box">
      {loading ? (
        <IonSkeletonText animated style={{ width: '20px', height: '4px', borderRadius: '2px' }} />
      ) : statusLabel === 'Predicted' ? (
        <span className="legend-dashed-line" style={{ backgroundColor: wlColor, width: '20px' }} />
      ) : (
        <span className="legend-solid-line" style={{ backgroundColor: wlColor, width: '20px' }} />
      )}
    </div>
    <div className="metric-details">
      <div className="metric-value-row">
        {loading ? (
          <IonSkeletonText animated style={{ width: '45px', height: '24px', borderRadius: '4px' }} />
        ) : (
          <span className="metric-value" style={{ color: wlColor }}>{observedWaterLevel.toFixed(2)}</span>
        )}
        <span className="metric-unit">ft</span>
        {!loading && <span className="metric-status-label">{statusLabel}</span>}
      </div>
      <div className="metric-label-row">
        <span className="metric-label">Water Level</span>
        {interactive && !loading && <IonIcon icon={helpCircleOutline} className="metric-help-icon" />}
      </div>
    </div>
  </div>
);

interface AtmosphereMetricsProps {
  precipitationAccumulation: number;
  windSpeed: number;
  windDirection: number;
  arrowLen?: number;
  loading?: boolean;
}

export const AtmosphereMetrics: React.FC<AtmosphereMetricsProps> = ({
  precipitationAccumulation,
  windSpeed,
  windDirection,
  arrowLen = 10,
  loading = false,
}) => {
  const hasWind = windSpeed > 0 || loading;
  const hasPrecip = (precipitationAccumulation !== undefined && precipitationAccumulation > 0.005) || loading;
  const arrowColor = windColor(windSpeed);

  if (!hasWind && !hasPrecip) return null;

  return (
    <div className="sentinel-metrics atmo-metrics meteo-group">
      {hasWind && (
        <div className="metric-item wind-level">
          <div className="metric-icon-box">
            {loading ? (
              <IonSkeletonText animated style={{ width: '18px', height: '18px', borderRadius: '50%' }} />
            ) : (
              <svg
                width={18}
                height={18}
                viewBox="-9 -9 18 18"
                className="wind-arrow-svg"
              >
                <g transform={`rotate(${(typeof windDirection === 'number' ? windDirection : 0) + 180})`}>
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
            )}
          </div>
          <div className="metric-details">
            <div className="metric-value-row">
              {loading ? (
                <IonSkeletonText animated style={{ width: '30px', height: '18px', borderRadius: '4px' }} />
              ) : (
                <>
                  <span className="metric-value" style={{ color: arrowColor }}>{windSpeed.toFixed(0)}</span>
                  <span className="metric-unit">mph</span>
                  <span className="metric-dir">{degToCompass(windDirection)}</span>
                </>
              )}
            </div>
            <span className="metric-label">Wind</span>
          </div>
        </div>
      )}

      {hasWind && hasPrecip && (
        <div className="metric-divider" />
      )}

      {hasPrecip && (
        <div className="metric-item precip-level">
          <div className="metric-icon-box">
            {loading ? (
              <IonSkeletonText animated style={{ width: '18px', height: '18px', borderRadius: '50%' }} />
            ) : (
              <IonIcon icon={waterOutline} className="metric-icon precip" />
            )}
          </div>
          <div className="metric-details">
            <div className="metric-value-row">
              {loading ? (
                <IonSkeletonText animated style={{ width: '40px', height: '18px', borderRadius: '4px' }} />
              ) : (
                <>
                  <span className="metric-value">{precipitationAccumulation.toFixed(2)}</span>
                  <span className="metric-unit">in</span>
                </>
              )}
            </div>
            <span className="metric-label">Precip</span>
          </div>
        </div>
      )}
    </div>
  );
};

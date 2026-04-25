import React from 'react';
import { IonSpinner } from '@ionic/react';
import './HydrographChart.css';
import ChartViewer from '../Tab2/ChartViewer';

/**
 * HydrographChart wraps ChartViewer with a styled card shell that adds a
 * location header, live/historical subtitle, a "Return to Live" control, and
 * an optional atmospheric overlay slot (sentinel).
 *
 * All ChartViewer props pass through unchanged via spread.
 */
type ChartViewerProps = React.ComponentProps<typeof ChartViewer>;

interface HydrographChartProps extends ChartViewerProps {
  /** Display name shown above the chart */
  locationName?: string;
  /** Optional atmospheric overlay rendered in the header (e.g. AtmosphericOverlay) */
  sentinel?: React.ReactNode;
  /** Show the loading spinner overlay on the chart area */
  loading?: boolean;
  /** True when the viewport is at the live/current time */
  isLive?: boolean;
  /** The time shown in the subtitle pill when not live */
  time?: Date | null;
  /** Source label shown in the subtitle (e.g. 'Selection', 'Scroll Context') */
  source?: string;
}

export const HydrographChart: React.FC<HydrographChartProps> = ({
  locationName = 'Carolina Beach',
  sentinel,
  loading = false,
  isLive = true,
  time,
  onViewportChange,
  onResetToLive,
  warnings,
  ...chartProps
}) => {
  return (
    <div className="hydrograph-container">
      <div className="hydrograph-header">
        <div className="title-group">
          <h2 className="hydrograph-title">{locationName}</h2>
          <div className={`hydrograph-subtitle ${isLive ? 'is-live' : 'is-historical'}`}>
            {isLive && <span className="subtitle-dot" />}
            {isLive && <span className="subtitle-text">Live</span>}
            {time && (
              <span className="viewing-time-pill">
                {time.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
            {!isLive && onResetToLive && (
              <button
                className="reset-to-live-btn"
                onClick={onResetToLive}
                aria-label="Return to live time"
              >
                Return to Live
              </button>
            )}
          </div>
        </div>
        {sentinel}
      </div>

      {warnings && warnings.length > 0 && (
        <div className="hydrograph-warnings">
          {warnings.map((w, i) => (
            <div key={i} className="warning-item">
              <span className="warning-icon">⚠️</span>
              <span className="warning-text">{w}</span>
            </div>
          ))}
        </div>
      )}

      <div className="hydrograph-chart-wrapper">
        {loading && (
          <div className="chart-loading-overlay">
            <IonSpinner name="crescent" color="primary" />
          </div>
        )}
        <ChartViewer {...chartProps} onViewportChange={onViewportChange} />
      </div>
    </div>
  );
};

export default HydrographChart;

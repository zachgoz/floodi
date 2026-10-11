import React from 'react';
import { IonSpinner, IonSkeletonText } from '@ionic/react';
import './HydrographChart.css';
import ChartViewer from '../Tab2/ChartViewer';
import { ViewingTimePill } from './ViewingTimePill';
import { ChartInfo } from './ChartInfo';

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
  /** Historical flood events to highlight on the timeline */
  floodEvents?: any[];
  /** Open time-window settings from the date pill */
  onTimeSettingsClick?: () => void;
  onResetView?: () => void;
  experimentalLabel?: string;
  experimentalDescription?: string;
  forecastLabel?: string;
  forecastDescription?: string;
  controls?: React.ReactNode;
  children?: React.ReactNode;
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
  floodEvents,
  onTimeSettingsClick,
  onResetView,
  experimentalLabel = 'Weather model',
  experimentalDescription,
  forecastLabel = 'Forecast',
  forecastDescription,
  controls,
  children,
  ...chartProps
}) => {
  return (
    <section className="hydrograph-container" aria-label="Water level and surge forecast">
      <div className="hydrograph-header">
        <div className="title-group">
          {loading ? (
            <h2 className="hydrograph-title">
              <IonSkeletonText animated style={{ width: '180px', height: '24px' }} />
            </h2>
          ) : (
            <h2 className="hydrograph-title">{locationName}</h2>
          )}

          {loading ? (
            <div className="hydrograph-subtitle">
              <IonSkeletonText animated style={{ width: '100px', height: '16px' }} />
            </div>
          ) : (
            <div className={`hydrograph-subtitle ${isLive ? 'is-live' : 'is-historical'}`}>
              {isLive && <span className="subtitle-dot" />}
              {isLive && <span className="subtitle-text">Live</span>}
              <ViewingTimePill time={time} onClick={onTimeSettingsClick} />
              {!controls && !isLive && onResetToLive && (
                <button
                  className="reset-to-live-btn"
                  onClick={onResetToLive}
                  aria-label="Return to live time"
                >
                  Return to Live
                </button>
              )}
            </div>
          )}
        </div>
        {sentinel}
      </div>

      {controls}

      <div className="chart-legend-row">
        <div className="chart-legend" aria-label="Water level chart legend">
          <span><i className="legend-line observed-line" />Observed</span>
          {chartProps.observedPoints?.some(p => p.estimated) && <span><i className="legend-line estimated-line" />Estimated</span>}
          <span><i className="legend-line tide-line" />Tide</span>
          <span><i className="legend-line forecast-line" />{forecastLabel}</span>
          {chartProps.experimentalPoints?.length ? <span><i className="legend-line experimental-line" />{experimentalLabel}</span> : null}
        </div>
        <ChartInfo label="About water level forecasts">
          <p>Water levels in feet MLLW. Shading marks forecast flooding above the configured threshold. Both charts share their time window.</p>
          {forecastDescription && <p>{forecastDescription}</p>}
          {(chartProps.experimentalLower?.length || 0) > 1 && <p>Thin dashed lines show historical error bounds; weather forecast uncertainty can add further error.</p>}
          {warnings?.map((warning, i) => <p key={i}>{warning}</p>)}
          {chartProps.experimentalPoints?.length ? <p>{experimentalDescription || 'Purple: optional comparison. Flood cards and shading use the primary forecast.'}</p> : null}
          {onResetView && <button className="chart-info-action" onClick={onResetView}>Reset to default view</button>}
        </ChartInfo>
      </div>
      <div className="hydrograph-chart-wrapper">
        {loading && (
          <div className="chart-loading-overlay">
            <IonSpinner name="crescent" color="primary" />
          </div>
        )}
        <ChartViewer 
          {...chartProps} 
          onViewportChange={onViewportChange} 
          floodEvents={floodEvents} 
        />
      </div>
      {children}
    </section>
  );
};

export default HydrographChart;

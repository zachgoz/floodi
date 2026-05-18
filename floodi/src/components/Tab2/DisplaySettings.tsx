import React from 'react';
import {
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonIcon,
  IonSegment,
  IonSegmentButton,
  IonToggle,
  IonInput,
  IonNote,
  IonAccordion,
  IonAccordionGroup,
} from '@ionic/react';
import { settingsOutline } from 'ionicons/icons';
import type { OffsetConfig } from './types';

/**
 * Props for the DisplaySettings component
 */
interface DisplaySettingsProps {
  /** Theme mode setting */
  theme: 'auto' | 'light' | 'dark' | undefined;
  /** Callback when theme changes */
  onThemeChange: (theme: 'auto' | 'light' | 'dark') => void;
  /** View mode setting */
  viewMode: 'basic' | 'advanced' | undefined;
  /** Callback when view mode changes */
  onViewModeChange: (viewMode: 'basic' | 'advanced') => void;
  /** Data source setting */
  dataSource: 'auto' | 'fiman' | 'noaa' | undefined;
  /** Callback when data source changes */
  onDataSourceChange: (source: 'auto' | 'fiman' | 'noaa') => void;
  /** Current surge offset mode */
  offsetConfig: OffsetConfig;
  /** Callback when surge offset settings change */
  onOffsetConfigChange: (config: Partial<OffsetConfig>) => void;
  /** Computed surge offset from auto mode */
  computedOffset: number | null;
  /** Number of data points used for offset calculation */
  offsetDataPoints: number;
  /** The active observation source for surge offset */
  observedSource?: 'fiman' | 'noaa';
  /** Whether to show surge offset trend (Delta obs - pred and forecast) */
  showDelta?: boolean;
  /** Callback when surge trend visibility changes */
  onShowDeltaChange?: (show: boolean) => void;
  /** Whether chart comment markers are visible */
  showComments?: boolean;
  /** Number of visible comments in the current chart domain */
  commentCount?: number;
  /** Callback when comment marker visibility changes */
  onShowCommentsChange?: (show: boolean) => void;
}

/**
 * Professional display settings component for chart display options
 * 
 * Provides controls for various chart display options with room for expansion.
 * Currently manages theme and view mode (basic/advanced).
 * 
 * @param props DisplaySettingsProps
 * @returns JSX.Element
 */
export const DisplaySettings: React.FC<DisplaySettingsProps> = ({ 
  theme = 'auto', 
  onThemeChange,
  viewMode = 'basic',
  onViewModeChange,
  dataSource = 'auto',
  onDataSourceChange,
  offsetConfig,
  onOffsetConfigChange,
  computedOffset,
  offsetDataPoints,
  observedSource,
  showDelta,
  onShowDeltaChange,
  showComments = true,
  commentCount = 0,
  onShowCommentsChange
}) => {
  const handleThemeChange = (event: CustomEvent) => {
    const value = event.detail.value as 'auto' | 'light' | 'dark';
    onThemeChange(value);
  };

  const handleViewModeChange = (event: CustomEvent) => {
    const value = event.detail.value as 'basic' | 'advanced';
    onViewModeChange(value);
  };

  const handleDataSourceChange = (event: CustomEvent) => {
    const value = event.detail.value as 'auto' | 'fiman' | 'noaa';
    onDataSourceChange(value);
  };

  const handleOffsetModeChange = (event: CustomEvent) => {
    const mode = event.detail.value as OffsetConfig['mode'];
    onOffsetConfigChange({ mode: mode || 'auto' });
  };

  const handleManualOffsetChange = (event: CustomEvent) => {
    const value = `${event.detail.value || ''}`;
    onOffsetConfigChange({ value });
  };

  const formatComputedOffset = (): string => {
    if (computedOffset === null) return '-';
    if (offsetDataPoints <= 0) return 'Waiting for observations';
    const sign = computedOffset >= 0 ? '+' : '';
    return `${sign}${computedOffset.toFixed(2)} ft (${offsetDataPoints} pts)`;
  };

  const sourceLabel = observedSource === 'fiman'
    ? 'Using FiMAN observations'
    : observedSource === 'noaa'
      ? 'Using NOAA observations'
      : 'Observation source pending';

  const offsetSummary = offsetConfig.mode === 'manual'
    ? `Manual ${offsetConfig.value ? `${offsetConfig.value} ft` : 'offset'}`
    : formatComputedOffset();

  return (
    <IonList className="display-settings">
      <IonListHeader>
        <IonIcon icon={settingsOutline} slot="start" />
        <IonLabel>Display</IonLabel>
      </IonListHeader>

      <IonItem>
        <IonLabel position="stacked">View Mode</IonLabel>
        <IonSegment value={viewMode} onIonChange={handleViewModeChange}>
          <IonSegmentButton value="basic">
            <IonLabel>Basic</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="advanced">
            <IonLabel>Advanced</IonLabel>
          </IonSegmentButton>
        </IonSegment>
      </IonItem>

      <IonItem>
        <IonLabel position="stacked">Theme</IonLabel>
        <IonSegment value={theme} onIonChange={handleThemeChange}>
          <IonSegmentButton value="auto">
            <IonLabel>Auto</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="light">
            <IonLabel>Light</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="dark">
            <IonLabel>Dark</IonLabel>
          </IonSegmentButton>
        </IonSegment>
      </IonItem>

      <IonItem>
        <IonLabel position="stacked">Preferred Data Source</IonLabel>
        <IonSegment value={dataSource} onIonChange={handleDataSourceChange}>
          <IonSegmentButton value="auto">
            <IonLabel>Auto</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="fiman">
            <IonLabel>FiMAN</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="noaa">
            <IonLabel>NOAA</IonLabel>
          </IonSegmentButton>
        </IonSegment>
      </IonItem>

      <IonAccordionGroup className="surge-offset-accordion">
        <IonAccordion value="surge-offset">
          <IonItem slot="header" lines="full">
            <IonLabel>
              <h3>Surge Offset</h3>
              <p>{offsetConfig.mode === 'auto' ? 'Auto' : 'Manual'} · {offsetSummary} · Trend {showDelta ? 'on' : 'off'}</p>
            </IonLabel>
          </IonItem>
          <div slot="content" className="surge-offset-panel">
            <IonItem lines="none">
              <IonNote color="medium">
                Adjust predictions using recent observed vs predicted differences.
              </IonNote>
            </IonItem>

            <IonItem>
              <IonLabel position="stacked">Offset Mode</IonLabel>
              <IonSegment value={offsetConfig.mode} onIonChange={handleOffsetModeChange}>
                <IonSegmentButton value="auto">
                  <IonLabel>Auto</IonLabel>
                </IonSegmentButton>
                <IonSegmentButton value="manual">
                  <IonLabel>Manual</IonLabel>
                </IonSegmentButton>
              </IonSegment>
            </IonItem>

            {offsetConfig.mode === 'manual' && (
              <IonItem>
                <IonLabel position="stacked">Manual Offset (ft)</IonLabel>
                <IonInput
                  type="number"
                  value={offsetConfig.value}
                  onIonInput={handleManualOffsetChange}
                  placeholder="Enter offset in feet"
                  step="0.01"
                  className="offset-input"
                />
                <IonNote slot="helper" color="medium">
                  Positive values raise predictions, negative values lower them
                </IonNote>
              </IonItem>
            )}

            <IonItem>
              <IonLabel>
                <h3>Computed Surge Offset</h3>
                <p>{sourceLabel}</p>
              </IonLabel>
              <IonNote slot="end" color="medium">
                {formatComputedOffset()}
              </IonNote>
            </IonItem>

            <IonItem>
              <IonLabel>
                <h3>Show offset trend</h3>
                <p>Display past difference and forecast offset</p>
              </IonLabel>
              <IonToggle
                checked={!!showDelta}
                onIonChange={(event: CustomEvent<{ checked: boolean }>) => onShowDeltaChange?.(!!event.detail.checked)}
              />
            </IonItem>
          </div>
        </IonAccordion>
      </IonAccordionGroup>

      <IonItem>
        <IonLabel>
          <h3>Show comments</h3>
          <p>{commentCount} visible on the current chart</p>
        </IonLabel>
        <IonToggle
          checked={showComments}
          onIonChange={(event: CustomEvent<{ checked: boolean }>) => onShowCommentsChange?.(!!event.detail.checked)}
        />
      </IonItem>
    </IonList>
  );
};

export default DisplaySettings;

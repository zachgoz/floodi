import React from 'react';
import {
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonInput,
  IonSegment,
  IonSegmentButton,
  IonIcon,
  IonToggle,
} from '@ionic/react';
import { warningOutline } from 'ionicons/icons';
import type { OffsetConfig } from './types';

/**
 * Props for the FloodSettings component
 */
interface FloodSettingsProps {
  /** Current flood threshold in feet (MLLW) */
  threshold: number;
  /** Callback when threshold changes */
  onThresholdChange: (threshold: number) => void;
  /** Current offset configuration */
  offsetConfig: OffsetConfig;
  /** Callback when offset configuration changes */
  onOffsetConfigChange: (config: Partial<OffsetConfig>) => void;
  /** Computed surge offset from auto mode (can be null) */
  computedOffset: number | null;
  /** Number of data points used for offset calculation */
  offsetDataPoints: number;
  /** Whether to show surge offset trend (Δ obs - pred and forecast) */
  showDelta?: boolean;
  /** Callback when surge trend visibility changes */
  onShowDeltaChange?: (show: boolean) => void;
}

/**
 * Professional flood settings component for threshold and surge offset configuration
 * 
 * Provides intuitive controls for flood threshold and surge offset settings with
 * proper validation and clear descriptions.
 * 
 * @param props FloodSettingsProps
 * @returns JSX.Element
 */
export const FloodSettings: React.FC<FloodSettingsProps> = ({
  threshold,
  onThresholdChange,
  offsetConfig,
  onOffsetConfigChange,
  computedOffset,
  offsetDataPoints,
  showDelta,
  onShowDeltaChange,
}) => {
  /**
   * Handle threshold input changes with validation
   */
  const handleThresholdChange = (event: CustomEvent<{ value?: string }>) => {
    const value = event.detail.value || '';
    const numericValue = parseFloat(value);
    
    if (!isNaN(numericValue) && numericValue > 0) {
      onThresholdChange(numericValue);
    }
  };

  /**
   * Handle offset mode selection
   */
  const handleOffsetModeChange = (event: CustomEvent<{ value?: 'auto' | 'manual' }>) => {
    const mode = (event.detail.value || 'auto');
    onOffsetConfigChange({ mode });
  };

  /**
   * Handle manual offset value changes
   */
  const handleManualOffsetChange = (event: CustomEvent<{ value?: string }>) => {
    const value = event.detail.value || '';
    onOffsetConfigChange({ value });
  };

  /**
   * Format computed offset display
   */
  const formatComputedOffset = (): string => {
    if (computedOffset === null) return '—';
    const sign = computedOffset >= 0 ? '+' : '';
    return `${sign}${computedOffset.toFixed(2)} ft (${offsetDataPoints} pts)`;
  };

  return (
    <IonList className="flood-settings">
      <IonListHeader>
        <IonIcon icon={warningOutline} slot="start" />
        <IonLabel>Flood Settings</IonLabel>
      </IonListHeader>

      {/* Flood Threshold Section */}
      <IonItem lines="none">
        <IonNote color="medium">
          Flood threshold defines when water levels are considered flooding (shown in red on chart).
        </IonNote>
      </IonItem>

      <IonItem>
        <IonLabel position="stacked">Flood Threshold (ft, MLLW)</IonLabel>
        <IonInput
          type="number"
          value={threshold.toString()}
          onIonInput={handleThresholdChange}
          placeholder="Enter threshold in feet"
          min="0"
          step="0.1"
          className="threshold-input"
        />
      </IonItem>

      {/* Surge Offset Section */}
      <IonItem lines="none">
        <IonNote color="medium">
          Surge offset shifts predictions using recent observed vs predicted differences to improve accuracy.
        </IonNote>
      </IonItem>

      <IonItem>
        <div className="time-field">
          <IonLabel>Offset Mode</IonLabel>
          <IonSegment
            value={offsetConfig.mode}
            onIonChange={handleOffsetModeChange}
          >
            <IonSegmentButton value="auto">
              <IonLabel>Auto</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="manual">
              <IonLabel>Manual</IonLabel>
            </IonSegmentButton>
          </IonSegment>
        </div>
      </IonItem>

      {offsetConfig.mode === 'manual' ? (
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
      ) : (
        <IonItem>
          <IonLabel position="stacked">Computed Surge Offset</IonLabel>
          <IonNote slot="end" color="medium">
            {formatComputedOffset()}
          </IonNote>
          <IonNote slot="helper" color="medium">
            Automatically calculated from recent observation differences
          </IonNote>
        </IonItem>
      )}

      {/* Surge offset trend toggle */}
      <IonItem>
        <IonLabel>
          <h3>Show surge offset trend</h3>
          <p>Display past Δ (obs - pred) and forecast offset</p>
        </IonLabel>
        <IonToggle
          checked={!!showDelta}
          onIonChange={(e: CustomEvent<{ checked: boolean }>) => onShowDeltaChange?.(!!e.detail.checked)}
        />
      </IonItem>
    </IonList>
  );
};

export default FloodSettings;

import React from 'react';
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonIcon,
  IonContent,
  IonToast,
} from '@ionic/react';
import { closeOutline } from 'ionicons/icons';
import { StationSelector } from './StationSelector';
import { FloodSettings } from './FloodSettings';
import { TimeSettings } from './TimeSettings';
import { DisplaySettings } from './DisplaySettings';
import type { AppConfiguration, Station } from './types';

/**
 * Props for the SettingsModal component
 */
interface SettingsModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal should be dismissed */
  onDismiss: () => void;
  /** Current application configuration */
  config: AppConfiguration;
  /** Callback when station changes */
  onStationChange: (station: Station) => void;
  /** Callback when threshold changes */
  onThresholdChange: (threshold: number) => void;
  /** Callback when offset configuration changes */
  onOffsetConfigChange: (config: Partial<AppConfiguration['offset']>) => void;
  /** Callback when time range changes */
  onTimeRangeChange: (timeRange: Partial<AppConfiguration['timeRange']>) => void;
  /** Callback when display settings change */
  onDisplayChange: (display: Partial<AppConfiguration['display']>) => void;
  /** Computed surge offset from auto mode */
  computedOffset: number | null;
  /** Number of data points used for offset calculation */
  offsetDataPoints: number;
  /** Success message to show in toast */
  successMessage?: string | null;
  /** Error message to show */
  errorMessage?: string | null;
  /** Callback to clear messages */
  onClearMessages?: () => void;
}

/**
 * Professional settings modal component containing all configuration options
 * 
 * Organizes all settings into logical sections with proper Ionic modal structure.
 * Uses professional styling and accessibility features.
 * 
 * @param props SettingsModalProps
 * @returns JSX.Element
 */
export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onDismiss,
  config,
  onStationChange,
  onThresholdChange,
  onOffsetConfigChange,
  onTimeRangeChange,
  onDisplayChange,
  computedOffset,
  offsetDataPoints,
  successMessage,
  errorMessage,
  onClearMessages,
}) => {
  /**
   * Handle modal dismiss
   */
  const handleDismiss = () => {
    onDismiss();
    // Clear any messages when modal closes
    if (onClearMessages) {
      setTimeout(onClearMessages, 300); // Wait for modal animation
    }
  };

  return (
    <>
      <IonModal
        isOpen={isOpen}
        onDidDismiss={handleDismiss}
        className="settings-modal"
      >
        <IonHeader>
          <IonToolbar>
            <IonTitle>Settings</IonTitle>
            <IonButtons slot="end">
              <IonButton onClick={handleDismiss} aria-label="Close settings">
                <IonIcon icon={closeOutline} />
              </IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>

        <IonContent className="settings-content">
          {/* Station Selection */}
          <StationSelector
            selectedStationId={config.station.id}
            onStationChange={onStationChange}
            error={errorMessage}
            successMessage={successMessage}
          />

          {/* Flood Settings */}
          <FloodSettings
            threshold={config.threshold}
            onThresholdChange={onThresholdChange}
            offsetConfig={config.offset}
            onOffsetConfigChange={onOffsetConfigChange}
            computedOffset={computedOffset}
            offsetDataPoints={offsetDataPoints}
            showDelta={config.display.showDelta}
            onShowDeltaChange={(show) => onDisplayChange({ showDelta: show })}
          />

          {/* Display Settings */}
          <DisplaySettings
            theme={config.display.theme || 'auto'}
            onThemeChange={(theme) => onDisplayChange({ theme })}
          />

          {/* Time Settings */}
          <TimeSettings
            timeRange={config.timeRange}
            onTimeRangeChange={onTimeRangeChange}
            timezone={config.display.timezone}
            onTimezoneChange={(timezone) => onDisplayChange({ timezone })}
          />
        </IonContent>
      </IonModal>

      {/* Toast for success/error messages */}
      <IonToast
        isOpen={!!(successMessage || errorMessage)}
        message={successMessage || errorMessage || ''}
        duration={2000}
        position="bottom"
        color={errorMessage ? 'danger' : 'success'}
        onDidDismiss={onClearMessages}
      />
    </>
  );
};

export default SettingsModal;

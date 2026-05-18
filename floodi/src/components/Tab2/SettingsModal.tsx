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
import { FloodSettings } from './FloodSettings';
import { LocationSettings } from './LocationSettings';
import { DisplaySettings } from './DisplaySettings';
import type { AppConfiguration } from './types';
import { UserMenu } from 'src/components/auth';
import { useHistory } from 'react-router-dom';

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
  /** Callback when location changes */
  onLocationChange: (locationId: string) => void;
  /** Callback when thresholds change */
  onThresholdsChange: (thresholds: Partial<AppConfiguration['thresholds']>) => void;
  /** Callback when offset configuration changes */
  onOffsetConfigChange: (config: Partial<AppConfiguration['offset']>) => void;
  /** Callback when display settings change */
  onDisplayChange: (display: Partial<AppConfiguration['display']>) => void;
  /** Computed surge offset from auto mode */
  computedOffset: number | null;
  /** Number of data points used for offset calculation */
  offsetDataPoints: number;
  /** The data source for observations */
  dataSource?: 'fiman' | 'noaa';
  /** Success message to show in toast */
  successMessage?: string | null;
  /** Error message to show */
  errorMessage?: string | null;
  /** Callback to clear messages */
  onClearMessages?: () => void;
  /** Callback to reset all settings to defaults */
  onResetDefaults: () => void;
  /** Whether chart comment markers are visible */
  showComments?: boolean;
  /** Number of visible comments in the current chart domain */
  commentCount?: number;
  /** Callback when comment marker visibility changes */
  onShowCommentsChange?: (show: boolean) => void;
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
  onLocationChange,
  onThresholdsChange,
  onOffsetConfigChange,
  onDisplayChange,
  computedOffset,
  offsetDataPoints,
  dataSource,
  successMessage,
  errorMessage,
  onClearMessages,
  onResetDefaults,
  showComments,
  commentCount,
  onShowCommentsChange,
}) => {
  const history = useHistory();
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
          {/* User authentication section */}
          <UserMenu
            onNavigate={(path: string) => {
              // Close modal first to prevent overlay sticking on route change
              handleDismiss();
              history.push(path);
            }}
          />

          {/* Location Settings */}
          <LocationSettings
            currentLocationId={config.locationId}
            onLocationChange={onLocationChange}
          />

          {/* Display Settings */}
          <DisplaySettings
            theme={config.display.theme || 'auto'}
            onThemeChange={(theme) => onDisplayChange({ theme })}
            viewMode={config.display.viewMode || 'basic'}
            onViewModeChange={(viewMode) => onDisplayChange({ viewMode })}
            dataSource={config.display.dataSource || 'auto'}
            onDataSourceChange={(dataSource) => onDisplayChange({ dataSource })}
            offsetConfig={config.offset}
            onOffsetConfigChange={onOffsetConfigChange}
            computedOffset={computedOffset}
            offsetDataPoints={offsetDataPoints}
            observedSource={dataSource}
            showDelta={config.display.showDelta}
            onShowDeltaChange={(show) => onDisplayChange({ showDelta: show })}
            showComments={showComments}
            commentCount={commentCount}
            onShowCommentsChange={onShowCommentsChange}
          />

          {/* Flood Settings */}
          <FloodSettings
            thresholds={config.thresholds}
            onThresholdsChange={onThresholdsChange}
          />

          <div style={{ padding: '24px 16px 40px' }}>
            <IonButton 
              expand="block" 
              fill="outline" 
              color="danger" 
              onClick={() => {
                if (window.confirm('Reset all settings to defaults? This cannot be undone.')) {
                  onResetDefaults();
                }
              }}
            >
              Reset to Default Settings
            </IonButton>
          </div>
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

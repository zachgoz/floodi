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
} from '@ionic/react';
import { closeOutline } from 'ionicons/icons';
import { TimeSettings } from './TimeSettings';
import type { AppConfiguration } from './types';

interface TimeSettingsModalProps {
  isOpen: boolean;
  onDismiss: () => void;
  timeRange: AppConfiguration['timeRange'];
  onTimeRangeChange: (timeRange: Partial<AppConfiguration['timeRange']>) => void;
  timezone: AppConfiguration['display']['timezone'];
  onTimezoneChange: (timezone: AppConfiguration['display']['timezone']) => void;
}

export const TimeSettingsModal: React.FC<TimeSettingsModalProps> = ({
  isOpen,
  onDismiss,
  timeRange,
  onTimeRangeChange,
  timezone,
  onTimezoneChange,
}) => (
  <IonModal
    isOpen={isOpen}
    onDidDismiss={onDismiss}
    className="time-settings-modal"
  >
    <IonHeader>
      <IonToolbar>
        <IonTitle>Time Window</IonTitle>
        <IonButtons slot="end">
          <IonButton onClick={onDismiss} aria-label="Close time window settings">
            <IonIcon icon={closeOutline} />
          </IonButton>
        </IonButtons>
      </IonToolbar>
    </IonHeader>

    <IonContent className="settings-content">
      <TimeSettings
        timeRange={timeRange}
        onTimeRangeChange={onTimeRangeChange}
        timezone={timezone}
        onTimezoneChange={onTimezoneChange}
      />
    </IonContent>
  </IonModal>
);

export default TimeSettingsModal;

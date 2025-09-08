import React from 'react';
import {
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonIcon,
  IonSegment,
  IonSegmentButton,
} from '@ionic/react';
import { settingsOutline } from 'ionicons/icons';

/**
 * Props for the DisplaySettings component
 */
interface DisplaySettingsProps {
  /** Theme mode setting */
  theme: 'auto' | 'light' | 'dark' | undefined;
  /** Callback when theme changes */
  onThemeChange: (theme: 'auto' | 'light' | 'dark') => void;
}

/**
 * Professional display settings component for chart display options
 * 
 * Provides controls for various chart display options with room for expansion.
 * Currently manages the delta series visibility toggle.
 * 
 * @param props DisplaySettingsProps
 * @returns JSX.Element
 */
export const DisplaySettings: React.FC<DisplaySettingsProps> = ({ theme = 'auto', onThemeChange }) => {
  const handleThemeChange = (event: CustomEvent) => {
    const value = event.detail.value as 'auto' | 'light' | 'dark';
    onThemeChange(value);
  };

  return (
    <IonList className="display-settings">
      <IonListHeader>
        <IonIcon icon={settingsOutline} slot="start" />
        <IonLabel>Display</IonLabel>
      </IonListHeader>

      <IonItem>
        <IonLabel>Theme</IonLabel>
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
    </IonList>
  );
};

export default DisplaySettings;

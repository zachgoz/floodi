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
  /** View mode setting */
  viewMode: 'basic' | 'advanced' | undefined;
  /** Callback when view mode changes */
  onViewModeChange: (viewMode: 'basic' | 'advanced') => void;
  /** Data source setting */
  dataSource: 'auto' | 'fiman' | 'noaa' | undefined;
  /** Callback when data source changes */
  onDataSourceChange: (source: 'auto' | 'fiman' | 'noaa') => void;
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
  onDataSourceChange
}) => {
  const handleThemeChange = (event: CustomEvent) => {
    const value = event.detail.value as 'auto' | 'light' | 'dark';
    onThemeChange(value);
  };

  const handleViewModeChange = (event: CustomEvent) => {
    const value = event.detail.value as 'basic' | 'advanced';
    onViewModeChange(value);
  };

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
        <IonSegment value={dataSource} onIonChange={(e) => onDataSourceChange(e.detail.value as any)}>
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
    </IonList>
  );
};

export default DisplaySettings;

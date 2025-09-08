import React from 'react';
import {
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonToggle,
  IonIcon,
} from '@ionic/react';
import { settingsOutline } from 'ionicons/icons';

/**
 * Props for the DisplaySettings component
 */
interface DisplaySettingsProps {
  /** Whether to show delta (observed - predicted) series */
  showDelta: boolean;
  /** Callback when showDelta changes */
  onShowDeltaChange: (show: boolean) => void;
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
export const DisplaySettings: React.FC<DisplaySettingsProps> = ({
  showDelta,
  onShowDeltaChange,
}) => {
  /**
   * Handle delta visibility toggle
   */
  const handleDeltaToggle = (event: CustomEvent) => {
    const checked = event.detail.checked as boolean;
    onShowDeltaChange(checked);
  };

  return (
    <IonList className="display-settings">
      <IonListHeader>
        <IonIcon icon={settingsOutline} slot="start" />
        <IonLabel>Display</IonLabel>
      </IonListHeader>

      <IonItem>
        <IonLabel>
          <h3>Show Δ obs - pred</h3>
          <p>Display the difference between observed and predicted water levels</p>
        </IonLabel>
        <IonToggle
          checked={showDelta}
          onIonChange={handleDeltaToggle}
        />
      </IonItem>
    </IonList>
  );
};

export default DisplaySettings;
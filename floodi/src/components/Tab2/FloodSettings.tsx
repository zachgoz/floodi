import React from 'react';
import {
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonInput,
  IonIcon,
  IonAccordion,
  IonAccordionGroup,
} from '@ionic/react';
import { warningOutline } from 'ionicons/icons';
import type { AppConfiguration } from './types';

/**
 * Props for the FloodSettings component
 */
interface FloodSettingsProps {
  /** Current flood thresholds in feet (MLLW) */
  thresholds: AppConfiguration['thresholds'];
  /** Callback when thresholds change */
  onThresholdsChange: (thresholds: Partial<AppConfiguration['thresholds']>) => void;
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
  thresholds,
  onThresholdsChange,
}) => {
  /**
   * Handle threshold input changes with validation
   */
  const handleThresholdChange = (key: keyof AppConfiguration['thresholds']) => (
    event: CustomEvent<{ value?: string | number | null }>
  ) => {
    const value = `${event.detail.value || ''}`;
    const numericValue = parseFloat(value);
    
    if (!isNaN(numericValue) && numericValue > 0) {
      onThresholdsChange({ [key]: numericValue });
    }
  };

  return (
    <IonList className="flood-settings">
      <IonListHeader>
        <IonIcon icon={warningOutline} slot="start" />
        <IonLabel>Flood Settings</IonLabel>
      </IonListHeader>

      <IonAccordionGroup className="threshold-accordion">
        <IonAccordion value="thresholds">
          <IonItem slot="header" lines="full">
            <IonLabel>
              <h3>Flood Thresholds</h3>
              <p>Minor {thresholds.minor.toFixed(1)} ft · Moderate {thresholds.moderate.toFixed(1)} ft · Major {thresholds.major.toFixed(1)} ft</p>
            </IonLabel>
          </IonItem>
          <div slot="content" className="threshold-panel">
            <IonItem lines="none">
              <IonNote color="medium">
                Levels are in feet MLLW and drive chart flood highlighting.
              </IonNote>
            </IonItem>

            <IonItem>
              <IonLabel position="stacked">Minor Flood</IonLabel>
              <IonInput
                type="number"
                value={thresholds.minor.toString()}
                onIonInput={handleThresholdChange('minor')}
                placeholder="Feet"
                min="0"
                step="0.1"
                className="threshold-input"
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Moderate Flood</IonLabel>
              <IonInput
                type="number"
                value={thresholds.moderate.toString()}
                onIonInput={handleThresholdChange('moderate')}
                placeholder="Feet"
                min="0"
                step="0.1"
                className="threshold-input"
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Major Flood</IonLabel>
              <IonInput
                type="number"
                value={thresholds.major.toString()}
                onIonInput={handleThresholdChange('major')}
                placeholder="Feet"
                min="0"
                step="0.1"
                className="threshold-input"
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Extreme Flood</IonLabel>
              <IonInput
                type="number"
                value={thresholds.extreme.toString()}
                onIonInput={handleThresholdChange('extreme')}
                placeholder="Feet"
                min="0"
                step="0.1"
                className="threshold-input"
              />
            </IonItem>
          </div>
        </IonAccordion>
      </IonAccordionGroup>
    </IonList>
  );
};

export default FloodSettings;

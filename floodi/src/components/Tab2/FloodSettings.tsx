import React, { useState } from 'react';
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
import { validThresholds } from './thresholdSettings';

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
  const [error, setError] = useState<string | null>(null);
  /**
   * Handle threshold input changes with validation
   */
  const handleThresholdChange = (key: keyof AppConfiguration['thresholds']) => (
    event: CustomEvent<{ value?: string | number | null }>
  ) => {
    const value = `${event.detail.value || ''}`;
    const numericValue = parseFloat(value);
    
    if (validThresholds({ ...thresholds, [key]: numericValue })) {
      setError(null);
      onThresholdsChange({ [key]: numericValue });
    } else {
      setError('Use positive levels in order: minor < moderate < major < extreme.');
    }
  };

  return (
    <IonList className="flood-settings">
      <IonListHeader>
        <IonIcon icon={warningOutline} slot="start" />
        <IonLabel>Personal Flood Thresholds</IonLabel>
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
                Feet MLLW for this device's charts and event list. Alert thresholds are managed separately.
              </IonNote>
            </IonItem>

            <IonItem>
              <IonInput
                label="Minor Flood"
                labelPlacement="stacked"
                type="number"
                value={thresholds.minor.toString()}
                onIonChange={handleThresholdChange('minor')}
                placeholder="Feet"
                min="0"
                step="0.1"
                className="threshold-input"
              />
            </IonItem>
            <IonItem>
              <IonInput
                label="Moderate Flood"
                labelPlacement="stacked"
                type="number"
                value={thresholds.moderate.toString()}
                onIonChange={handleThresholdChange('moderate')}
                placeholder="Feet"
                min="0"
                step="0.1"
                className="threshold-input"
              />
            </IonItem>
            <IonItem>
              <IonInput
                label="Major Flood"
                labelPlacement="stacked"
                type="number"
                value={thresholds.major.toString()}
                onIonChange={handleThresholdChange('major')}
                placeholder="Feet"
                min="0"
                step="0.1"
                className="threshold-input"
              />
            </IonItem>
            <IonItem>
              <IonInput
                label="Extreme Flood"
                labelPlacement="stacked"
                type="number"
                value={thresholds.extreme.toString()}
                onIonChange={handleThresholdChange('extreme')}
                placeholder="Feet"
                min="0"
                step="0.1"
                className="threshold-input"
              />
            </IonItem>
            {error && <p role="alert" className="ion-padding-horizontal">{error}</p>}
          </div>
        </IonAccordion>
      </IonAccordionGroup>
    </IonList>
  );
};

export default FloodSettings;

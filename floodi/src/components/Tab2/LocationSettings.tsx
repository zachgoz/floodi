/**
 * LocationSettings Component
 * 
 * Allows users to switch between different monitored coastal locations.
 * Updates the global configuration to reflect the chosen town's sensors and thresholds.
 */

import React from 'react';
import {
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonIcon,
  IonSelect,
  IonSelectOption,
  IonNote,
} from '@ionic/react';
import { locationOutline } from 'ionicons/icons';
import { LOCATIONS } from 'src/constants/locations';

interface LocationSettingsProps {
  currentLocationId: string;
  onLocationChange: (locationId: string) => void;
}

export const LocationSettings: React.FC<LocationSettingsProps> = ({
  currentLocationId,
  onLocationChange,
}) => {
  return (
    <IonList className="location-settings">
      <IonListHeader>
        <IonIcon icon={locationOutline} slot="start" />
        <IonLabel>Location</IonLabel>
      </IonListHeader>

      <IonItem>
        <IonLabel position="stacked">Active Town</IonLabel>
        <IonSelect
          value={currentLocationId}
          onIonChange={(e) => onLocationChange(e.detail.value)}
          interface="action-sheet"
          placeholder="Select a town"
        >
          {Object.values(LOCATIONS).map((loc) => (
            <IonSelectOption key={loc.id} value={loc.id}>
              {loc.name}, {loc.state}
            </IonSelectOption>
          ))}
        </IonSelect>
        <IonNote slot="helper" color="medium">
          Switching towns updates NOAA and FiMAN sensor data automatically.
        </IonNote>
      </IonItem>
    </IonList>
  );
};

export default LocationSettings;

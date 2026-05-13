/**
 * FloodEventSidebar Component
 * 
 * Displays a list of recent flood events for the selected location.
 * Allows users to jump to specific historical events on the hydrograph.
 */

import React, { useEffect, useState } from 'react';
import { 
  IonList, 
  IonItem, 
  IonLabel, 
  IonNote, 
  IonBadge, 
  IonListHeader, 
  IonSpinner,
  IonIcon,
  IonButton
} from '@ionic/react';
import { water, timeOutline, chevronForwardOutline } from 'ionicons/icons';
import { fetchFloodEvents } from '../../lib/dataService';
import type { FloodEvent } from '../../types/data';
import { format } from 'date-fns';

interface FloodEventSidebarProps {
  locationId: string;
  onEventSelect: (event: FloodEvent) => void;
}

export const FloodEventSidebar: React.FC<FloodEventSidebarProps> = ({ 
  locationId, 
  onEventSelect 
}) => {
  const [events, setEvents] = useState<FloodEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadEvents() {
      try {
        setLoading(true);
        const data = await fetchFloodEvents(locationId);
        setEvents(data);
      } catch (err) {
        console.error('Failed to load flood events:', err);
      } finally {
        setLoading(false);
      }
    }
    loadEvents();
  }, [locationId]);

  const getBadgeColor = (type: string) => {
    switch (type) {
      case 'extreme': return 'danger';
      case 'major': return 'danger';
      case 'moderate': return 'warning';
      case 'minor': return 'primary';
      default: return 'medium';
    }
  };

  if (loading) {
    return (
      <div className="ion-text-center ion-padding">
        <IonSpinner name="crescent" />
        <p>Loading flood history...</p>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="ion-text-center ion-padding">
        <IonNote>No recent flood events detected.</IonNote>
      </div>
    );
  }

  return (
    <IonList>
      <IonListHeader>
        <IonLabel>Recent Flood Events</IonLabel>
      </IonListHeader>
      
      {events.map((event) => (
        <IonItem key={event.startTime} button onClick={() => onEventSelect(event)}>
          <IonIcon icon={water} slot="start" color={getBadgeColor(event.thresholdType)} />
          <IonLabel>
            <h2>{event.peakValue.toFixed(2)}' Peak</h2>
            <p>{format(new Date(event.peakTime), 'MMM d, h:mm a')}</p>
          </IonLabel>
          <IonBadge slot="end" color={getBadgeColor(event.thresholdType)}>
            {event.thresholdType}
          </IonBadge>
        </IonItem>
      ))}
    </IonList>
  );
};

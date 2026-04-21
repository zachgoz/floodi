import React, { useMemo } from 'react';
import { IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonModal, IonTitle, IonToolbar } from '@ionic/react';
import { closeOutline } from 'ionicons/icons';
import { CommentForm, type CommentFormValues } from 'src/components/comments/CommentForm';
import type { CommentTimeRange } from 'src/types/comment';
import type { AppConfiguration } from './types';
import { formatTimeRangeForDisplay } from 'src/utils/timeRangeHelpers';
import { useComments } from 'src/hooks/useComments';
import { useAuth } from 'src/contexts/AuthContext';

export interface ChartCommentModalProps {
  isOpen: boolean;
  onDismiss: () => void;
  /** Selected time range from chart */
  range: CommentTimeRange | null;
  /** Current app configuration for station/timezone */
  config: AppConfiguration;
}

export const ChartCommentModal: React.FC<ChartCommentModalProps> = ({ isOpen, onDismiss, range, config }) => {
  const { create, loading } = useComments({ stationId: config.station.id, realtime: false });
  const { user } = useAuth();

  const rangeDisplay = useMemo(() => (range ? formatTimeRangeForDisplay(range, config.display.timezone) : null), [range, config.display.timezone]);

  const handleSubmit = async (values: CommentFormValues) => {
    if (!range || !user) return;
    await create({
      content: values.content,
      metadata: {
        station: { id: config.station.id, name: config.station.name || `Station ${config.station.id}` },
        timeRange: { ...range, eventType: values.eventType },
        dataContext: values.dataContexts,
        thresholdValue: values.threshold ?? null,
      },
    });
    onDismiss();
  };

  return (
    <IonModal 
      isOpen={isOpen} 
      onDidDismiss={onDismiss} 
      className="chart-comment-modal" 
      aria-label="Drop Pin Modal"
      initialBreakpoint={0.5}
      breakpoints={[0, 0.5, 0.8]}
    >
      <IonHeader className="ion-no-border">
        <IonToolbar>
          <IonTitle>
            Drop Pin {rangeDisplay ? `at ${rangeDisplay.label.split(' - ')[0]}` : ''}
          </IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onDismiss} aria-label="Close">
              <IonIcon icon={closeOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <CommentForm
          stationId={config.station.id}
          initialRange={range ? { start: new Date(range.startTime), end: new Date(range.endTime) } : undefined}
          loading={loading}
          onSubmit={handleSubmit}
          onCancel={onDismiss}
        />
      </IonContent>
    </IonModal>
  );
};

export default ChartCommentModal;

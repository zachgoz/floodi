import React, { useMemo } from 'react';
import { IonBadge, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonModal, IonTitle, IonToolbar } from '@ionic/react';
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

/**
 * ChartCommentModal
 *
 * Modal wrapper to create a comment for a selected chart time range.
 */
export const ChartCommentModal: React.FC<ChartCommentModalProps> = ({ isOpen, onDismiss, range, config }) => {
  const { create, loading } = useComments({ stationId: config.station.id, realtime: false });
  const { user } = useAuth();

  const rangeDisplay = useMemo(() => (range ? formatTimeRangeForDisplay(range, config.display.timezone) : null), [range, config.display.timezone]);

  const handleSubmit = async (values: CommentFormValues) => {
    if (!range || !user) return;
    await create({
      content: values.content,
      metadata: {
        station: { id: config.station.id, name: config.station.name },
        timeRange: { ...range, eventType: values.eventType },
        dataContext: values.dataContexts,
        thresholdValue: values.threshold ?? null,
      },
    });
    onDismiss();
  };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onDismiss} className="chart-comment-modal" aria-label="Add Comment for Selected Time Range">
      <IonHeader>
        <IonToolbar>
          <IonTitle>
            Add Comment
            {rangeDisplay && (
              <>
                {' '}
                <IonBadge color="medium" aria-label={`Selected range ${rangeDisplay.label}`}>
                  {rangeDisplay.label}
                </IonBadge>
              </>
            )}
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
          chartDomain={range ? { start: new Date(range.startTime), end: new Date(range.endTime) } : undefined}
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

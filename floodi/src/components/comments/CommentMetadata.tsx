import React, { useMemo } from 'react';
import { IonBadge, IonChip, IonIcon, IonLabel, IonText } from '@ionic/react';
import { pinOutline, timeOutline } from 'ionicons/icons';
import { formatTimeRangeForDisplay } from 'src/utils/timeRangeHelpers';
import 'src/components/comments/styles/Comments.css';

export interface CommentMetadataProps {
  metadata: {
    stationName?: string;
    stationId?: string;
    location?: { lat: number; lon: number };
    range?: { start: string; end: string };
    eventType?: 'threshold-crossing' | 'surge-event' | 'normal-tide';
    dataContext?: { observed?: boolean; predicted?: boolean; adjusted?: boolean };
    threshold?: number;
  };
  mode?: 'compact' | 'full';
  timezone?: string;
}

/**
 * CommentMetadata
 *
 * Displays rich metadata for a comment using IonChip and IonBadge
 * components. Supports compact and full display modes.
 */
export const CommentMetadata: React.FC<CommentMetadataProps> = ({ metadata, mode = 'full' }) => {
  const rangeLabel = useMemo(() => {
    if (!metadata.range) return '';
    try {
      return formatTimeRangeForDisplay(metadata.range);
    } catch {
      return `${new Date(metadata.range.start).toLocaleString()} – ${new Date(metadata.range.end).toLocaleString()}`;
    }
  }, [metadata.range]);

  return (
    <div className={`comments-meta comments-meta-${mode}`}>
      {metadata.stationName && (
        <IonChip outline color="primary" className="comments-chip" aria-label="Station">
          <IonIcon icon={pinOutline} />
          <IonLabel>{metadata.stationName}</IonLabel>
        </IonChip>
      )}
      {metadata.stationId && (
        <IonBadge color="light" className="comments-badge" aria-label="Station ID">
          ID: {metadata.stationId}
        </IonBadge>
      )}

      {metadata.range && (
        <IonChip color="medium" className="comments-chip" aria-label="Time range" title={rangeLabel}>
          <IonIcon icon={timeOutline} />
          <IonLabel>{rangeLabel}</IonLabel>
        </IonChip>
      )}

      {metadata.eventType === 'threshold-crossing' && (
        <IonBadge color="danger">threshold</IonBadge>
      )}
      {metadata.eventType === 'surge-event' && <IonBadge color="warning">surge</IonBadge>}
      {metadata.eventType === 'normal-tide' && <IonBadge color="primary">tide</IonBadge>}

      {metadata.dataContext?.observed && <IonBadge color="success">observed</IonBadge>}
      {metadata.dataContext?.predicted && <IonBadge color="medium">predicted</IonBadge>}
      {metadata.dataContext?.adjusted && <IonBadge color="secondary">adjusted</IonBadge>}

      {metadata.threshold != null && <IonBadge color="dark">thr: {metadata.threshold}</IonBadge>}
    </div>
  );
};

export default CommentMetadata;


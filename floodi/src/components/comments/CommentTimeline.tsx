import React, { useMemo, useState } from 'react';
import { IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonItem, IonLabel, IonSelect, IonSelectOption } from '@ionic/react';
import { CommentModel } from 'src/components/comments/CommentItem';
import 'src/components/comments/styles/Comments.css';

export interface CommentTimelineProps {
  timeDomain?: { start: string; end: string };
  comments: CommentModel[];
  fullScreen?: boolean;
  stationId?: string;
}

/**
 * CommentTimeline
 *
 * Visual timeline showing comment ranges positioned over a time axis.
 * This is a simplified, accessible layout with responsive behavior.
 */
export const CommentTimeline: React.FC<CommentTimelineProps> = ({ timeDomain, comments, fullScreen, stationId }) => {
  const [zoom, setZoom] = useState<'1h' | '6h' | '24h' | '7d' | '30d'>('24h');

  const domain = useMemo(() => {
    if (timeDomain) return timeDomain;
    if (comments.length === 0) return undefined;
    const times = comments.flatMap((c) => {
      const rs = c.meta?.range?.start ? Date.parse(c.meta.range.start) : Date.parse(c.createdAt);
      const re = c.meta?.range?.end ? Date.parse(c.meta.range.end) : Date.parse(c.createdAt);
      return [rs, re];
    });
    const min = new Date(Math.min(...times)).toISOString();
    const max = new Date(Math.max(...times)).toISOString();
    return { start: min, end: max };
  }, [timeDomain, comments]);

  return (
    <IonCard className="comments-card comments-timeline">
      <IonCardHeader>
        <IonCardTitle>Timeline{stationId ? ` · ${stationId}` : ''}</IonCardTitle>
      </IonCardHeader>
      <IonCardContent>
        <div className="timeline-controls">
          <IonItem lines="none">
            <IonLabel>Zoom</IonLabel>
            <IonSelect value={zoom} onIonChange={(e) => setZoom(e.detail.value)} interface="popover">
              <IonSelectOption value="1h">1 hr</IonSelectOption>
              <IonSelectOption value="6h">6 hr</IonSelectOption>
              <IonSelectOption value="24h">24 hr</IonSelectOption>
              <IonSelectOption value="7d">7 days</IonSelectOption>
              <IonSelectOption value="30d">30 days</IonSelectOption>
            </IonSelect>
          </IonItem>
          {fullScreen && (
            <div className="timeline-nav">
              <button className="ion-button ion-button-clear" aria-label="Previous period">◀</button>
              <button className="ion-button ion-button-clear" aria-label="Go to now">Now</button>
              <button className="ion-button ion-button-clear" aria-label="Next period">▶</button>
            </div>
          )}
        </div>
        <div className="timeline-axis" aria-hidden="true" />
        <div className="timeline-rows" role="list">
          {domain &&
            comments.map((c) => (
              <TimelineRow key={c.id} domain={domain} comment={c} />
            ))}
        </div>
      </IonCardContent>
    </IonCard>
  );
};

const TimelineRow: React.FC<{ domain: { start: string; end: string }; comment: CommentModel }> = ({
  domain,
  comment,
}) => {
  const ds = new Date(domain.start).getTime();
  const de = new Date(domain.end).getTime();
  const width = Math.max(1, de - ds);
  const rs = new Date(comment.meta?.range?.start ?? comment.createdAt).getTime();
  const re = new Date(comment.meta?.range?.end ?? comment.createdAt).getTime();
  const leftPct = Math.max(0, Math.min(1, (rs - ds) / width)) * 100;
  const rightPct = Math.max(0, Math.min(1, (re - ds) / width)) * 100;
  const spanPct = Math.max(1, rightPct - leftPct);

  const color =
    comment.meta?.eventType === 'threshold-crossing'
      ? 'var(--comment-color-threshold)'
      : comment.meta?.eventType === 'surge-event'
      ? 'var(--comment-color-surge)'
      : 'var(--comment-color-normal)';

  return (
    <div className="timeline-row" role="listitem" aria-label={comment.author?.displayName || 'Comment'}>
      <div className="timeline-bar" style={{ left: `${leftPct}%`, width: `${spanPct}%`, background: color }} />
      <div className="timeline-label">{comment.author?.displayName || 'Anonymous'}</div>
    </div>
  );
};

export default CommentTimeline;

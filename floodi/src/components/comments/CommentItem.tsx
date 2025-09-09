import React, { useMemo, useState } from 'react';
import {
  IonAvatar,
  IonBadge,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
} from '@ionic/react';
import { timeOutline, createOutline, trashOutline, chatboxEllipsesOutline } from 'ionicons/icons';
import { formatTimeRangeForDisplay } from 'src/utils/timeRangeHelpers';
import { sanitizeHtml } from 'src/utils/sanitizeHtml';
import { CommentMetadata } from 'src/components/comments/CommentMetadata';
import 'src/components/comments/styles/Comments.css';

export interface CommentUser {
  id?: string;
  displayName?: string;
  avatarUrl?: string;
  role?: 'user' | 'moderator' | 'admin';
}

export interface CommentDataContext {
  observed?: boolean;
  predicted?: boolean;
  adjusted?: boolean;
}

export interface CommentMeta {
  stationName?: string;
  stationId?: string;
  range?: { start: string; end: string };
  eventType?: 'threshold-crossing' | 'surge-event' | 'normal-tide';
  threshold?: number;
  dataContext?: CommentDataContext;
}

export interface CommentModel {
  id: string;
  author: CommentUser;
  content: string;
  createdAt: string; // ISO
  editedAt?: string; // ISO
  editHistory?: Array<{ at: string; by?: CommentUser; reason?: string; content?: string }>;
  meta?: CommentMeta;
}

export interface CommentItemProps {
  comment: CommentModel;
  display?: 'compact' | 'full';
  onEdit?: (c: CommentModel) => void;
  onDelete?: (c: CommentModel) => void;
  onReply?: (c: CommentModel) => void;
  canEdit?: boolean;
  canDelete?: boolean;
}

function relativeTime(iso: string): string {
  try {
    const d = new Date(iso).getTime();
    const now = Date.now();
    const diff = Math.round((now - d) / 1000);
    if (diff < 60) return `${diff}s ago`;
    const m = Math.round(diff / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    const days = Math.round(h / 24);
    return `${days}d ago`;
  } catch {
    return new Date(iso).toLocaleString();
  }
}

const RoleBadge: React.FC<{ role?: string }> = ({ role }) => {
  if (role === 'admin') return <IonBadge color="tertiary">Admin</IonBadge>;
  if (role === 'moderator') return <IonBadge color="warning">Mod</IonBadge>;
  return null;
};

export const CommentItem: React.FC<CommentItemProps> = ({
  comment,
  display = 'full',
  onEdit,
  onDelete,
  onReply,
  canEdit,
  canDelete,
}) => {
  const [showHistory, setShowHistory] = useState(false);

  const rangeLabel = useMemo(() => {
    const r = comment.meta?.range;
    if (!r) return '';
    try {
      return formatTimeRangeForDisplay(r);
    } catch {
      const s = new Date(r.start).toLocaleString();
      const e = new Date(r.end).toLocaleString();
      return `${s} – ${e}`;
    }
  }, [comment.meta?.range]);

  const content = (
    <div className="comments-item-content">
      <div className="comments-item-meta">
        <IonBadge color="medium" className="comments-chip">
          <IonIcon icon={timeOutline} /> {relativeTime(comment.createdAt)}
        </IonBadge>
        {comment.editedAt && <IonBadge color="light">edited</IonBadge>}
        <CommentMetadata metadata={{
          stationName: comment.meta?.stationName,
          stationId: comment.meta?.stationId,
          range: comment.meta?.range,
          eventType: comment.meta?.eventType,
          dataContext: comment.meta?.dataContext,
          threshold: comment.meta?.threshold,
        }} mode="compact" />
      </div>
      <div className="comments-item-text" dangerouslySetInnerHTML={{ __html: sanitizeHtml(comment.content) }} />
      {/* Station name and range are shown by CommentMetadata; avoid duplicate rendering here. */}
      {comment.editHistory && comment.editHistory.length > 0 && (
        <div className="comments-history">
          <IonButton fill="clear" size="small" onClick={() => setShowHistory((s) => !s)}>
            {showHistory ? 'Hide' : 'Show'} edit history
          </IonButton>
          {showHistory && (
            <IonList>
              {comment.editHistory.map((h, idx) => (
                <IonItem key={idx} lines="none">
                  <IonLabel>
                    <strong>{new Date(h.at).toLocaleString()}</strong>
                    {h.reason && <span> — {h.reason}</span>}
                    {h.content && (
                      <div className="comments-history-content" dangerouslySetInnerHTML={{ __html: sanitizeHtml(h.content) }} />
                    )}
                  </IonLabel>
                </IonItem>
              ))}
            </IonList>
          )}
        </div>
      )}
    </div>
  );

  if (display === 'compact') {
    return (
      <IonItem className="comments-item" lines="full">
        <IonAvatar slot="start">
          <img src={comment.author.avatarUrl || `https://www.gravatar.com/avatar?d=identicon`} alt="avatar" />
        </IonAvatar>
        <IonLabel>
          <h3>
            {comment.author.displayName || 'Anonymous'} <RoleBadge role={comment.author.role} />
          </h3>
          <div className="comments-item-compact" dangerouslySetInnerHTML={{ __html: sanitizeHtml(comment.content) }} />
          <IonNote color="medium">{relativeTime(comment.createdAt)}</IonNote>
        </IonLabel>
        <IonButtons slot="end">
          {onReply && (
            <IonButton fill="clear" onClick={() => onReply(comment)} aria-label="Reply">
              <IonIcon icon={chatboxEllipsesOutline} />
            </IonButton>
          )}
          {canEdit && onEdit && (
            <IonButton fill="clear" onClick={() => onEdit(comment)} aria-label="Edit comment">
              <IonIcon icon={createOutline} />
            </IonButton>
          )}
          {canDelete && onDelete && (
            <IonButton color="danger" fill="clear" onClick={() => onDelete(comment)} aria-label="Delete comment">
              <IonIcon icon={trashOutline} />
            </IonButton>
          )}
        </IonButtons>
      </IonItem>
    );
  }

  return (
    <IonCard className="comments-card comments-item">
      <IonCardHeader>
        <div className="comments-item-header">
          <IonAvatar className="comments-avatar">
            <img src={comment.author.avatarUrl || `https://www.gravatar.com/avatar?d=identicon`} alt="avatar" />
          </IonAvatar>
          <div className="comments-header-text">
            <IonCardTitle>
              {comment.author.displayName || 'Anonymous'} <RoleBadge role={comment.author.role} />
            </IonCardTitle>
            <IonCardSubtitle>{relativeTime(comment.createdAt)}</IonCardSubtitle>
          </div>
          <IonButtons className="comments-actions">
            {onReply && (
              <IonButton fill="clear" onClick={() => onReply(comment)} aria-label="Reply">
                <IonIcon icon={chatboxEllipsesOutline} />
              </IonButton>
            )}
            {canEdit && onEdit && (
              <IonButton fill="clear" onClick={() => onEdit(comment)} aria-label="Edit comment">
                <IonIcon icon={createOutline} />
              </IonButton>
            )}
            {canDelete && onDelete && (
              <IonButton color="danger" fill="clear" onClick={() => onDelete(comment)} aria-label="Delete comment">
                <IonIcon icon={trashOutline} />
              </IonButton>
            )}
          </IonButtons>
        </div>
      </IonCardHeader>
      <IonCardContent>{content}</IonCardContent>
    </IonCard>
  );
};

export default CommentItem;

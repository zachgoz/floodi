import React, { useMemo } from 'react';
import { IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonModal, IonTitle, IonToolbar } from '@ionic/react';
import { closeOutline, shieldCheckmark } from 'ionicons/icons';
import { CommentForm, type CommentFormValues } from 'src/components/comments/CommentForm';
import type { Comment, CommentTimeRange } from 'src/types/comment';
import type { AppConfiguration } from './types';
import { formatTimeRangeForDisplay } from 'src/utils/timeRangeHelpers';
import { useComments } from 'src/hooks/useComments';
import { useAuth } from 'src/contexts/AuthContext';

export interface ChartCommentModalProps {
  isOpen: boolean;
  onDismiss: () => void;
  /** Selected time range from chart */
  range: CommentTimeRange | null;
  /** Existing comments at this time/location */
  existingComments?: Comment[];
  /** Current app configuration for station/timezone */
  config: AppConfiguration;
  /** Optional water level at the selected time */
  waterLevel?: number | null;
}

export const ChartCommentModal: React.FC<ChartCommentModalProps> = ({ isOpen, onDismiss, range, existingComments = [], config, waterLevel }) => {
  const { create, loading } = useComments({ locationId: config?.locationId, realtime: false });
  const { user } = useAuth();

  const rangeDisplay = useMemo(() => (range ? formatTimeRangeForDisplay(range, config?.display?.timezone || 'local') : null), [range, config?.display?.timezone]);
  const commentCount = existingComments.length;
  
  const levelSuffix = waterLevel !== undefined && waterLevel !== null ? ` (${waterLevel.toFixed(1)} ft)` : '';
  const title = commentCount > 1 
    ? `Comment Thread${rangeDisplay ? ` at ${rangeDisplay.label.split(' - ')[0]}` : ''}${levelSuffix}`
    : commentCount === 1
      ? `Comment Details${rangeDisplay ? ` at ${rangeDisplay.label.split(' - ')[0]}` : ''}${levelSuffix}`
      : `Drop Pin${rangeDisplay ? ` at ${rangeDisplay.label.split(' - ')[0]}` : ''}${levelSuffix}`;

  const handleSubmit = async (values: CommentFormValues) => {
    if (!range || !user) return;
    await create({
      content: values.content,
      metadata: {
        locationId: config?.locationId || '',
        station: { 
          id: config?.station?.id || '', 
          name: config?.station?.name || '' 
        },
        timeRange: { ...range, eventType: values.eventType },
        dataContext: values.dataContexts,
        thresholdValue: values.threshold ?? null,
        waterLevel: waterLevel ?? null,
      },
    });
    onDismiss();
  };

  return (
    <>
      <style>
        {`
          /* The Atmospheric Sentinel Design System */
          .glass-modal {
            --background: rgba(247, 249, 251, 0.7);
            --backdrop-opacity: 0.3;
          }
          .glass-modal::part(content) {
            backdrop-filter: blur(24px);
            -webkit-backdrop-filter: blur(24px);
            border-top-left-radius: 24px;
            border-top-right-radius: 24px;
            box-shadow: inset 1px 1px 0px rgba(255,255,255,0.2), 0 -8px 32px rgba(25, 28, 30, 0.15);
          }
          .glass-modal::part(handle) {
            background: rgba(25, 28, 30, 0.15);
            width: 48px;
            height: 5px;
            border-radius: 4px;
          }
          .glass-toolbar {
            --background: transparent;
            --border-width: 0;
            padding-top: 12px;
          }
          .glass-title {
            font-family: 'Inter', sans-serif;
            font-size: 1.125rem;
            font-weight: 600;
            letter-spacing: -0.01em;
            color: #003358;
          }
          .premium-form-container {
            display: flex;
            flex-direction: column;
            gap: 20px;
            padding: 8px 16px 24px 16px;
          }
          .input-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
            background: #ffffff;
            border-radius: 12px;
            padding: 12px 16px;
            box-shadow: 0 2px 8px rgba(25, 28, 30, 0.04);
          }
          .premium-label {
            font-family: 'Inter', sans-serif;
            font-size: 0.875rem;
            color: #515f74;
            font-weight: 500;
            margin-bottom: 4px;
          }
          .premium-textarea {
            --padding-start: 0;
            --padding-end: 0;
            --padding-top: 0;
            --padding-bottom: 0;
            --background: transparent;
            font-family: 'Inter', sans-serif;
            font-size: 1rem;
            color: #191c1e;
            margin-top: 0;
          }
          .char-count {
            display: flex;
            justify-content: flex-end;
            font-family: 'Inter', sans-serif;
            font-size: 0.75rem;
            color: #c1c7d0;
          }
          .form-actions {
            display: flex;
            justify-content: flex-end;
            gap: 12px;
            margin-top: 8px;
          }
          .ghost-btn {
            --color: #003358;
            font-family: 'Inter', sans-serif;
            font-weight: 600;
          }
          .gradient-btn {
            --background: linear-gradient(135deg, #003358, #004a7c);
            --background-activated: #002244;
            --background-hover: #004a7c;
            --border-radius: 24px;
            font-family: 'Inter', sans-serif;
            font-weight: 600;
            letter-spacing: 0.02em;
            margin: 0;
          }
          .thread-container {
            display: flex;
            flex-direction: column;
            gap: 12px;
            margin-bottom: 16px;
          }
          .thread-comment {
            background: rgba(255, 255, 255, 0.7);
            border-radius: 12px;
            padding: 14px;
            box-shadow: 0 2px 8px rgba(25, 28, 30, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.8);
          }
          .thread-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 6px;
          }
          .author-wrapper {
            display: flex;
            align-items: center;
            gap: 6px;
          }
          .official-badge {
            display: flex;
            align-items: center;
            gap: 3px;
            background: #eefbff;
            color: #0076a8;
            padding: 2px 8px;
            border-radius: 6px;
            font-size: 0.6rem;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.03em;
            border: 1px solid #cceeff;
            box-shadow: 0 1px 2px rgba(0, 118, 168, 0.05);
          }
          .badge-icon {
            font-size: 0.8rem;
          }
          .thread-author {
            font-family: 'Inter', sans-serif;
            font-size: 0.8rem;
            font-weight: 600;
            color: #003358;
          }
          .thread-time {
            font-family: 'Inter', sans-serif;
            font-size: 0.7rem;
            color: #8c97a5;
          }
          .thread-content-text {
            font-family: 'Inter', sans-serif;
            font-size: 0.95rem;
            line-height: 1.4;
            color: #191c1e;
            margin: 0;
            white-space: pre-wrap;
          }
          .thread-pill {
            display: inline-block;
            padding: 1px 6px;
            background: rgba(0, 51, 88, 0.06);
            color: #003358;
            border-radius: 8px;
            font-size: 0.65rem;
            font-family: 'Inter', sans-serif;
            margin-top: 6px;
            margin-right: 4px;
            font-weight: 500;
          }
          .divider-label {
            font-family: 'Inter', sans-serif;
            font-size: 0.75rem;
            font-weight: 700;
            color: #003358;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin: 8px 0 12px 0;
            opacity: 0.8;
          }
        `}
      </style>
      <IonModal 
        isOpen={isOpen} 
        onDidDismiss={onDismiss} 
        className="chart-comment-modal glass-modal" 
      aria-label="Drop Pin Modal"
      initialBreakpoint={0.5}
      breakpoints={[0, 0.5, 0.8]}
    >
      <IonHeader className="ion-no-border">
        <IonToolbar className="glass-toolbar">
          <IonTitle className="glass-title">
            {title}
          </IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onDismiss} aria-label="Close" color="dark">
              <IonIcon icon={closeOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        {commentCount > 0 && (
          <div className="thread-container">
            {existingComments.map((c) => {
              if (!c) return null;
              return (
                <div key={c.id || Math.random()} className="thread-comment">
                  <div className="thread-header">
                    <div className="author-wrapper">
                      <span className="thread-author">{c.authorDisplayName || 'Anonymous User'}</span>
                      {c.isOfficial && (
                        <div className="official-badge">
                          <IonIcon icon={shieldCheckmark} className="badge-icon" />
                          <span>Official</span>
                        </div>
                      )}
                    </div>
                    <span className="thread-time">
                      {(c.createdAt?.toDate?.() || (c.createdAt?.seconds ? new Date(c.createdAt.seconds * 1000) : new Date())).toLocaleDateString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="thread-content-text">{c.content}</p>
                  {(Array.isArray(c.metadata?.dataContext) ? c.metadata.dataContext : [c.metadata?.dataContext]).filter(Boolean).map((ctx, idx) => (
                    <span key={`${c.id}-ctx-${ctx}-${idx}`} className="thread-pill">{ctx}</span>
                  ))}
                </div>
              );
            })}
          </div>
        )}
        
        {commentCount > 0 && <div className="divider-label">Reply or add observation</div>}
        
        <CommentForm
          locationId={config?.locationId}
          stationId={config?.station?.id}
          initialRange={range ? { start: new Date(range.startTime).toISOString(), end: new Date(range.endTime).toISOString() } : undefined}
          loading={loading}
          onSubmit={handleSubmit}
          onCancel={onDismiss}
        />
      </IonContent>
    </IonModal>
    </>
  );
};

export default ChartCommentModal;

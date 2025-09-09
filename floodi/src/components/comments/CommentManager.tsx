import React, { useMemo, useState } from 'react';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonNote,
  IonPage,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/react';
import { refreshOutline, createOutline, listOutline, timeOutline } from 'ionicons/icons';
import { CommentForm } from 'src/components/comments/CommentForm';
import { CommentList } from 'src/components/comments/CommentList';
import { CommentTimeline } from 'src/components/comments/CommentTimeline';
import CommentEditModal from 'src/components/comments/CommentEditModal';
import CommentDeleteModal from 'src/components/comments/CommentDeleteModal';
import { CommentModel } from 'src/components/comments/CommentItem';
import { useUserPermissions } from 'src/hooks/useUserPermissions';
import { useComments } from 'src/hooks/useComments';
import 'src/components/comments/styles/Comments.css';

export interface CommentManagerProps {
  stationId: string;
  chartDomain?: { start: string; end: string };
}

/**
 * CommentManager
 *
 * Orchestrates the comment UI including creation, listing, timeline view,
 * and edit/delete flows. Uses app hooks for real-time updates.
 */
export const CommentManager: React.FC<CommentManagerProps> = ({ stationId, chartDomain }) => {
  const [tab, setTab] = useState<'timeline' | 'list' | 'create'>('list');
  const { comments, loading, error, createComment, refresh, canEdit, canDelete, updateComment, deleteComment } =
    useComments?.(stationId) ?? {
      comments: [] as CommentModel[],
      loading: false,
      error: undefined,
      createComment: async () => {},
      refresh: async () => {},
      canEdit: () => false,
      canDelete: () => false,
      updateComment: async () => {},
      deleteComment: async () => {},
    };

  const [editing, setEditing] = useState<CommentModel | null>(null);
  const [deleting, setDeleting] = useState<CommentModel | null>(null);
  const userPerms = useUserPermissions?.() ?? { role: 'user' };
  const canEditMeta = userPerms.role === 'admin' || userPerms.role === 'moderator';

  const stats = useMemo(() => ({ count: comments.length }), [comments]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Comments ({stats.count})</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={() => setTab('create')} aria-label="Create comment">
              <IonIcon icon={createOutline} />
            </IonButton>
            <IonButton onClick={() => refresh?.()} aria-label="Refresh comments">
              <IonIcon icon={refreshOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
        <IonToolbar>
          <IonSegment value={tab} onIonChange={(e) => setTab(e.detail.value)}>
            <IonSegmentButton value="timeline">
              <IonIcon icon={timeOutline} />
              <IonLabel>Timeline</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="list">
              <IonIcon icon={listOutline} />
              <IonLabel>List</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="create">
              <IonIcon icon={createOutline} />
              <IonLabel>Create</IonLabel>
            </IonSegmentButton>
          </IonSegment>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        {loading && <IonSpinner name="dots" />}
        {!!error && <IonNote color="danger">{error}</IonNote>}

        {tab === 'create' && (
          <CommentForm
            stationId={stationId}
            chartDomain={chartDomain}
            onSubmit={async (values) => {
              await createComment?.({ ...values, stationId });
              setTab('list');
            }}
          />
        )}

        {tab === 'list' && (
          <CommentList
            comments={comments}
            loading={loading}
            error={error}
            onRefresh={refresh}
            onEdit={(c) => setEditing(c)}
            onDelete={(c) => setDeleting(c)}
            canEdit={(c) => canEdit?.(c) ?? false}
            canDelete={(c) => canDelete?.(c) ?? false}
          />
        )}

        {tab === 'timeline' && <CommentTimeline timeDomain={chartDomain} comments={comments} />}

        {/* Edit Modal */}
        {editing && (
          <CommentEditModal
            isOpen={!!editing}
            comment={editing}
            onDismiss={() => setEditing(null)}
            onSave={async ({ content, range, reason, eventType, dataContext }) => {
              await updateComment?.(editing.id, { content, range, reason, eventType, dataContext });
              setEditing(null);
            }}
            canEditMetadata={canEditMeta}
          />
        )}

        {/* Delete Modal */}
        {deleting && (
          <CommentDeleteModal
            isOpen={!!deleting}
            comment={deleting}
            onDismiss={() => setDeleting(null)}
            onConfirm={async ({ permanent, reason }) => {
              await deleteComment?.(deleting.id, { permanent, reason });
              setDeleting(null);
            }}
          />
        )}
      </IonContent>
    </IonPage>
  );
};

export default CommentManager;

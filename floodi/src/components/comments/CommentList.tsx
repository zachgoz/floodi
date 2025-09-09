import React, { useEffect, useMemo, useState } from 'react';
import {
  IonContent,
  IonHeader,
  IonInfiniteScroll,
  IonInfiniteScrollContent,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonRefresher,
  IonRefresherContent,
  IonSearchbar,
  IonSelect,
  IonSelectOption,
  IonSkeletonText,
  IonTitle,
  IonToolbar,
} from '@ionic/react';
import { CommentItem, CommentModel } from 'src/components/comments/CommentItem';
import 'src/components/comments/styles/Comments.css';

export interface CommentListProps {
  comments: CommentModel[];
  loading?: boolean;
  error?: string;
  onRefresh?: () => Promise<void> | void;
  onLoadMore?: () => Promise<void> | void;
  onEdit?: (c: CommentModel) => void;
  onDelete?: (c: CommentModel) => void;
  canEdit?: (c: CommentModel) => boolean;
  canDelete?: (c: CommentModel) => boolean;
}

export const CommentList: React.FC<CommentListProps> = ({
  comments,
  loading,
  error,
  onRefresh,
  onLoadMore,
  onEdit,
  onDelete,
  canEdit,
  canDelete,
}) => {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? comments.filter((c) =>
          [c.content, c.author.displayName, c.meta?.stationName]
            .filter(Boolean)
            .some((s) => String(s).toLowerCase().includes(q))
        )
      : comments;
    const sorted = [...base].sort((a, b) => {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      return sort === 'newest' ? tb - ta : ta - tb;
    });
    return sorted;
  }, [comments, query, sort]);

  return (
    <IonContent className="comments-list">
      <IonHeader collapse="condense">
        <IonToolbar>
          <IonTitle size="large">Comments</IonTitle>
        </IonToolbar>
      </IonHeader>

      <div className="comments-controls">
        <IonSearchbar value={query} onIonInput={(e) => setQuery((e.detail.value as string) ?? '')} />
        <IonItem lines="none" className="comments-sort">
          <IonLabel>Sort</IonLabel>
          <IonSelect value={sort} onIonChange={(e) => setSort(e.detail.value)}>
            <IonSelectOption value="newest">Newest first</IonSelectOption>
            <IonSelectOption value="oldest">Oldest first</IonSelectOption>
          </IonSelect>
        </IonItem>
      </div>

      {loading && (
        <div className="comments-skeleton">
          <IonSkeletonText animated style={{ width: '100%', height: 64 }} />
          <IonSkeletonText animated style={{ width: '100%', height: 64 }} />
          <IonSkeletonText animated style={{ width: '100%', height: 64 }} />
        </div>
      )}

      {!!error && <IonNote color="danger">{error}</IonNote>}
      {!loading && filtered.length === 0 && <IonNote color="medium">No comments yet.</IonNote>}

      <IonList inset>
        {filtered.map((c) => (
          <CommentItem
            key={c.id}
            comment={c}
            display="full"
            onEdit={onEdit}
            onDelete={onDelete}
            canEdit={canEdit ? canEdit(c) : false}
            canDelete={canDelete ? canDelete(c) : false}
          />
        ))}
      </IonList>

      {onLoadMore && (
        <IonInfiniteScroll
          onIonInfinite={async (ev) => {
            try {
              await onLoadMore();
            } finally {
              // @ts-ignore Ionic types allow this
              ev.target.complete();
            }
          }}
          threshold="100px"
        >
          <IonInfiniteScrollContent loadingText="Loading more comments..." />
        </IonInfiniteScroll>
      )}

      {onRefresh && (
        <IonRefresher
          slot="fixed"
          onIonRefresh={async (ev) => {
            try {
              await onRefresh();
            } finally {
              ev.detail.complete();
            }
          }}
        >
          <IonRefresherContent />
        </IonRefresher>
      )}
    </IonContent>
  );
};

export default CommentList;

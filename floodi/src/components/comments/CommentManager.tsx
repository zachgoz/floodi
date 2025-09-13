import React, { useMemo, useState, useCallback } from 'react';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonChip,
  IonSearchbar,
  IonNote,
  IonPage,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonTitle,
  IonToolbar,
  IonDatetime,
  IonRefresher,
  IonRefresherContent,
  IonInfiniteScroll,
  IonInfiniteScrollContent,
} from '@ionic/react';
import { refreshOutline, createOutline, listOutline, timeOutline, filterOutline } from 'ionicons/icons';
import { CommentForm } from 'src/components/comments/CommentForm';
import { CommentList } from 'src/components/comments/CommentList';
import { CommentTimeline } from 'src/components/comments/CommentTimeline';
import { StationSelector } from 'src/components/Tab2/StationSelector';
import CommentEditModal from 'src/components/comments/CommentEditModal';
import CommentDeleteModal from 'src/components/comments/CommentDeleteModal';
import { FilterModal } from 'src/components/comments/FilterModal';
import { CommentModel } from 'src/components/comments/CommentItem';
import { useUserPermissions } from 'src/hooks/useUserPermissions';
import { useComments, useCommentPermissions } from 'src/hooks/useComments';
import type { Comment as SvcComment } from 'src/types/comment';
import 'src/components/comments/styles/Comments.css';

export interface CommentManagerProps {
  stationId: string;
  chartDomain?: { start: string; end: string };
  /** Enable full-screen standalone mode features for Tab4 */
  standalone?: boolean;
  /** Optional station integration controls for standalone mode */
  selectedStationId?: string;
  onStationChange?: (stationId: string) => void;
  showStationSelector?: boolean;
  /** Advanced filter state (standalone) */
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  authorFilter?: string;
  onAuthorFilterChange?: (a: string) => void;
  dateRange?: { start: string; end: string } | null;
  onDateRangeChange?: (r: { start: string; end: string } | null) => void;
  dataContext?: { observed?: boolean; predicted?: boolean; adjusted?: boolean } | null;
  onDataContextChange?: (d: { observed?: boolean; predicted?: boolean; adjusted?: boolean } | null) => void;
  /** Use filter modal instead of inline filters */
  useFilterModal?: boolean;
  /** Render header toolbars (for embedded usage) */
  renderHeader?: boolean;
}

/**
 * CommentManager
 *
 * Orchestrates the comment UI including creation, listing, timeline view,
 * and edit/delete flows. Uses app hooks for real-time updates.
 */
export const CommentManager: React.FC<CommentManagerProps> = ({
  stationId,
  chartDomain,
  standalone = false,
  selectedStationId,
  onStationChange,
  showStationSelector = false,
  searchQuery,
  onSearchChange,
  authorFilter,
  onAuthorFilterChange,
  dateRange,
  onDateRangeChange,
  dataContext,
  onDataContextChange,
  useFilterModal = false,
  renderHeader = true,
}) => {
  const [tab, setTab] = useState<'timeline' | 'list' | 'create'>('list');
  const [showFilterModal, setShowFilterModal] = useState(false);
  const { comments: svcComments, loading, error, create, refresh, update, remove, loadMore } =
    useComments({ stationId, realtime: true, pageSize: 30 });

  const perms = useCommentPermissions();

  const [hasMore, setHasMore] = useState<boolean>(true);
  const handleLoadMore = useCallback(async () => {
    const res = await loadMore();
    setHasMore(!!res?.hasMore);
  }, [loadMore]);

  const [editing, setEditing] = useState<CommentModel | null>(null);
  const [deleting, setDeleting] = useState<CommentModel | null>(null);
  const userPerms = useUserPermissions?.() ?? { role: 'user' };
  const canEditMeta = userPerms.role === 'admin' || userPerms.role === 'moderator';

  // Map service comments -> UI model
  const svcById = useMemo(() => new Map(svcComments.map((c) => [c.id, c] as const)), [svcComments]);
  const uiComments: CommentModel[] = useMemo(() => {
    const toFlagObj = (dc: any): { observed?: boolean; predicted?: boolean; adjusted?: boolean } | undefined => {
      if (!dc) return undefined;
      const arr = Array.isArray(dc) ? dc : [dc];
      return {
        observed: arr.includes('observed'),
        predicted: arr.includes('predicted'),
        adjusted: arr.includes('adjusted'),
      };
    };
    const tsToIso = (t: any): string => {
      try {
        if (t?.seconds != null) return new Date(t.seconds * 1000).toISOString();
        if (typeof t === 'string') return new Date(t).toISOString();
      } catch {}
      return new Date().toISOString();
    };
    return svcComments.map((c: SvcComment): CommentModel => ({
      id: c.id,
      author: {
        id: c.authorUid,
        displayName: c.authorDisplayName ?? undefined,
        avatarUrl: c.authorPhotoURL ?? undefined,
      },
      content: c.content,
      createdAt: tsToIso(c.createdAt as any),
      editedAt: c.isEdited ? tsToIso(c.updatedAt as any) : undefined,
      editHistory: (c.editHistory || []).map((h) => ({
        at: tsToIso(h.at as any),
        reason: (h as any).editReason,
        content: (h as any).previousContent,
      })),
      meta: {
        stationName: c.metadata?.station?.name,
        stationId: c.metadata?.station?.id,
        range: c.metadata?.timeRange
          ? { start: c.metadata.timeRange.startTime, end: c.metadata.timeRange.endTime }
          : undefined,
        eventType: (c.metadata?.timeRange as any)?.eventType as any,
        threshold: (c.metadata?.thresholdValue as any) ?? undefined,
        dataContext: toFlagObj(c.metadata?.dataContext),
      },
    }));
  }, [svcComments]);

  const filtered = useMemo(() => {
    let base = uiComments;
    // content + station + author search
    const q = (searchQuery || '').trim().toLowerCase();
    if (q) {
      base = base.filter((c) =>
        [c.content, c.author?.displayName, c.meta?.stationName]
          .filter(Boolean)
          .some((s) => String(s).toLowerCase().includes(q))
      );
    }
    // author substring filter
    if (authorFilter && authorFilter.trim()) {
      const aq = authorFilter.trim().toLowerCase();
      base = base.filter((c) => (c.author?.displayName || '').toLowerCase().includes(aq));
    }
    // date range overlap filter
    if (dateRange && (dateRange.start || dateRange.end)) {
      const ds = dateRange.start ? Date.parse(dateRange.start) : -Infinity;
      const de = dateRange.end ? Date.parse(dateRange.end) : Infinity;
      base = base.filter((c) => {
        const rs = Date.parse(c.meta?.range?.start || c.createdAt);
        const re = Date.parse(c.meta?.range?.end || c.createdAt);
        return rs <= de && re >= ds;
      });
    }
    // data context flags
    if (dataContext) {
      base = base.filter((c) => {
        const dc = c.meta?.dataContext || {};
        const checks: Array<boolean> = [];
        if (dataContext.observed) checks.push(!!dc.observed);
        if (dataContext.predicted) checks.push(!!dc.predicted);
        if (dataContext.adjusted) checks.push(!!dc.adjusted);
        return checks.length === 0 ? true : checks.some(Boolean);
      });
    }
    return base;
  }, [uiComments, searchQuery, authorFilter, dateRange?.start, dateRange?.end, dataContext?.observed, dataContext?.predicted, dataContext?.adjusted]);

  const stats = useMemo(() => {
    const total = uiComments.length;
    const last24hCut = Date.now() - 24 * 3600 * 1000;
    const last24h = uiComments.filter((c) => Date.parse(c.createdAt) >= last24hCut).length;
    return { count: total, total, last24h };
  }, [uiComments]);

  const header = (
    <>
      <IonToolbar>
        <IonTitle>{standalone ? 'Comments' : `Comments (${stats.count})`}</IonTitle>
        <IonButtons slot="end">
          {useFilterModal && (
            <IonButton onClick={() => setShowFilterModal(true)} aria-label="Filter comments">
              <IonIcon icon={filterOutline} />
            </IonButton>
          )}
          <IonButton onClick={() => setTab('create')} aria-label="Create comment">
            <IonIcon icon={createOutline} />
          </IonButton>
          <IonButton onClick={() => refresh?.()} aria-label="Refresh comments">
            <IonIcon icon={refreshOutline} />
          </IonButton>
        </IonButtons>
      </IonToolbar>
      <IonToolbar>
        <IonSegment value={tab} onIonChange={(e) => setTab(e.detail.value as 'timeline' | 'list' | 'create')}>
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

      {standalone && (
        <IonToolbar className="comments-filters">
          {showStationSelector && (
            <div className="comments-station-selector">
              <StationSelector
                selectedStationId={selectedStationId || stationId}
                onStationChange={(s) => onStationChange?.(s.id)}
              />
            </div>
          )}
          {/* Only show filters when not creating comments and not using filter modal */}
          {tab !== 'create' && !useFilterModal && (
            <div className="comments-filter-row">
              <IonItem lines="none" className="comments-filter-search">
                <IonLabel position="stacked">Search</IonLabel>
                <IonSearchbar
                  aria-label="Search comments"
                  value={searchQuery ?? ''}
                  onIonInput={(e) => onSearchChange?.((e.detail.value as string) ?? '')}
                  debounce={300}
                />
              </IonItem>
              <IonItem lines="none" className="comments-filter-author">
                <IonLabel position="stacked">Author</IonLabel>
                <input
                  aria-label="Author filter"
                  className="ion-input"
                  value={authorFilter ?? ''}
                  onChange={(e) => onAuthorFilterChange?.((e.target as HTMLInputElement).value)}
                />
              </IonItem>
              <IonItem lines="none" className="comments-filter-date-start">
                <IonLabel position="stacked">Start</IonLabel>
                <IonDatetime
                  presentation="date-time"
                  value={dateRange?.start}
                  onIonChange={(e) => {
                    const v = (e.detail.value as string) || undefined;
                    if (!v && !dateRange?.end) return onDateRangeChange?.(null);
                    onDateRangeChange?.({ start: v || new Date().toISOString(), end: dateRange?.end || new Date().toISOString() });
                  }}
                />
              </IonItem>
              <IonItem lines="none" className="comments-filter-date-end">
                <IonLabel position="stacked">End</IonLabel>
                <IonDatetime
                  presentation="date-time"
                  value={dateRange?.end}
                  onIonChange={(e) => {
                    const v = (e.detail.value as string) || undefined;
                    if (!v && !dateRange?.start) return onDateRangeChange?.(null);
                    onDateRangeChange?.({ end: v || new Date().toISOString(), start: dateRange?.start || new Date().toISOString() });
                  }}
                />
              </IonItem>
              <IonItem lines="none" className="comments-filter-dc">
                <IonLabel position="stacked">Data</IonLabel>
                <div className="comments-dc-chips">
                  <IonChip
                    outline={!dataContext?.observed}
                    onClick={() => onDataContextChange?.({ ...dataContext, observed: !dataContext?.observed })}
                  >
                    <IonLabel>Observed</IonLabel>
                  </IonChip>
                  <IonChip
                    outline={!dataContext?.predicted}
                    onClick={() => onDataContextChange?.({ ...dataContext, predicted: !dataContext?.predicted })}
                  >
                    <IonLabel>Predicted</IonLabel>
                  </IonChip>
                  <IonChip
                    outline={!dataContext?.adjusted}
                    onClick={() => onDataContextChange?.({ ...dataContext, adjusted: !dataContext?.adjusted })}
                  >
                    <IonLabel>Adjusted</IonLabel>
                  </IonChip>
                </div>
              </IonItem>
            </div>
          )}
        </IonToolbar>
      )}
    </>
  );

  const content = (
    <>
      {loading && <IonSpinner name="dots" />}
      {!!error && <IonNote color="danger">{error}</IonNote>}

        {tab === 'create' && (
          <CommentForm
            stationId={stationId}
            chartDomain={chartDomain}
            onSubmit={async (values) => {
              // Map form -> service payload
              const selectedId = selectedStationId || stationId;
              const metadata: SvcComment['metadata'] = {
                station: { id: selectedId, name: selectedId },
                timeRange: {
                  startTime: values.range?.start || new Date().toISOString(),
                  endTime: values.range?.end || new Date().toISOString(),
                  eventType: values.eventType,
                },
                dataContext: values.dataContexts as any,
                thresholdValue: values.threshold ?? null,
              } as any;
              await create({ content: values.content, metadata });
              setTab('list');
            }}
          />
        )}

        {tab === 'list' && (
          <CommentList
            comments={filtered}
            loading={loading}
            error={error || undefined}
            onRefresh={refresh}
            onLoadMore={handleLoadMore}
            hasMore={hasMore}
            onEdit={(c) => setEditing(c)}
            onDelete={(c) => setDeleting(c)}
            canEdit={(c) => (perms?.canEdit && svcById.get(c.id) ? perms.canEdit(svcById.get(c.id) as SvcComment) : false)}
            canDelete={(c) => (perms?.canDelete && svcById.get(c.id) ? perms.canDelete(svcById.get(c.id) as SvcComment) : false)}
          />
        )}

        {tab === 'timeline' && (
          <CommentTimeline
            timeDomain={chartDomain}
            comments={filtered}
            fullScreen={standalone}
            stationId={selectedStationId || stationId}
          />
        )}

        {/* Edit Modal */}
        {editing && (
          <CommentEditModal
            isOpen={!!editing}
            comment={editing}
            onDismiss={() => setEditing(null)}
            onSave={async ({ content, range, reason, eventType, dataContext }) => {
              const patch: any = {};
              if (content != null) patch.content = content;
              if (reason) patch.editReason = reason;
              if (range || eventType || dataContext) {
                patch.metadata = {};
                if (range) patch.metadata.timeRange = { startTime: range.start, endTime: range.end, ...(eventType ? { eventType } : {}) };
                if (dataContext) {
                  const arr = Object.entries(dataContext)
                    .filter(([, v]) => !!v)
                    .map(([k]) => k) as any;
                  patch.metadata.dataContext = arr.length > 1 ? arr : arr[0] ?? undefined;
                }
              }
              await update(editing.id, patch);
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
              // Soft delete via service remove; ignore permanent in this layer
              await remove(deleting.id);
              setDeleting(null);
            }}
          />
        )}

        {/* Filter Modal */}
        {useFilterModal && (
          <FilterModal
            isOpen={showFilterModal}
            onDismiss={() => setShowFilterModal(false)}
            searchQuery={searchQuery ?? ''}
            onSearchChange={onSearchChange ?? (() => {})}
            authorFilter={authorFilter ?? ''}
            onAuthorFilterChange={onAuthorFilterChange ?? (() => {})}
            dateRange={dateRange ?? null}
            onDateRangeChange={onDateRangeChange ?? (() => {})}
            dataContext={dataContext ?? null}
            onDataContextChange={onDataContextChange ?? (() => {})}
          />
        )}
    </>
  );

  if (standalone) {
    return (
      <>
        {renderHeader && <IonHeader>{header}</IonHeader>}

        {content}

        {/* Infinite scroll for timeline in standalone */}
        {tab === 'timeline' && (
          <IonInfiniteScroll
            disabled={!hasMore}
            threshold="100px"
            onIonInfinite={async (ev) => {
              try {
                await handleLoadMore();
              } finally {
                // @ts-ignore
                ev.target.complete();
              }
            }}
          >
            <IonInfiniteScrollContent loadingText="Loading more comments..." />
          </IonInfiniteScroll>
        )}
      </>
    );
  }

  return (
    <IonPage>
      <IonHeader>{header}</IonHeader>
      <IonContent className="ion-padding">
        {content}
        {tab === 'timeline' && (
          <IonInfiniteScroll
            disabled={!hasMore}
            threshold="100px"
            onIonInfinite={async (ev) => {
              try {
                await handleLoadMore();
              } finally {
                // @ts-ignore
                ev.target.complete();
              }
            }}
          >
            <IonInfiniteScrollContent loadingText="Loading more comments..." />
          </IonInfiniteScroll>
        )}
      </IonContent>
    </IonPage>
  );
};

export default CommentManager;

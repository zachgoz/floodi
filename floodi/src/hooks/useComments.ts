import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Comment, CommentTimeRange, CreateCommentData, UpdateCommentData } from 'src/types/comment';
import {
  createComment as svcCreate,
  deleteComment as svcDelete,
  getCommentsByAuthor,
  getCommentsByStation,
  getCommentsByTimeRange,
  subscribeToComments,
  updateComment as svcUpdate,
} from 'src/lib/commentService';
import { useAuth } from 'src/contexts/AuthContext';
import { useUserPermissions } from 'src/hooks/useUserPermissions';
import { UserRole } from 'src/types/user';
import { validateCommentContent, validateCommentMetadata, validateCommentPermissions } from 'src/utils/commentValidation';
import { useChartData } from 'src/components/Tab2/hooks/useChartData';
import type { AppConfiguration } from 'src/components/Tab2/types';

export interface UseCommentsOptions {
  stationId?: string;
  timeRange?: CommentTimeRange;
  authorUid?: string;
  pageSize?: number;
  realtime?: boolean;
  includeDeleted?: boolean;
}

export const useComments = (opts: UseCommentsOptions = {}) => {
  const { user, userProfile } = useAuth();
  const { role } = useUserPermissions();

  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<unknown | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  const pageSize = opts.pageSize ?? 20;
  const includeDeleted = !!opts.includeDeleted;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let items: Comment[] = [];
      if (opts.stationId && opts.timeRange) {
        items = await getCommentsByTimeRange(opts.stationId, opts.timeRange, { includeDeleted, pageSize });
      } else if (opts.stationId) {
        const res = await getCommentsByStation(opts.stationId, { includeDeleted, pageSize });
        items = res.items;
        setCursor(res.nextCursor);
      } else if (opts.authorUid) {
        items = await getCommentsByAuthor(opts.authorUid, { includeDeleted, pageSize });
      }
      setComments(items);
    } catch (e: unknown) {
      setError((e as { message?: string } | null)?.message || 'Failed to load comments');
    } finally {
      setLoading(false);
    }
  }, [opts.stationId, opts.timeRange?.startTime, opts.timeRange?.endTime, opts.authorUid, includeDeleted, pageSize]);

  useEffect(() => {
    // initial load
    refresh();
  }, [refresh]);

  useEffect(() => {
    // realtime subscription if requested and station scoped
    if (!opts.realtime) return;
    if (!opts.stationId && !opts.authorUid) return;
    if (unsubRef.current) unsubRef.current();
    unsubRef.current = subscribeToComments(
      { stationId: opts.stationId, authorUid: opts.authorUid, includeDeleted, pageSize },
      (items) => {
        // If timeRange filter provided, filter client-side to reflect UI state
        if (opts.timeRange) {
          const start = Date.parse(opts.timeRange.startTime);
          const end = Date.parse(opts.timeRange.endTime);
          const filtered = items.filter((c) => {
            const cStart = Date.parse(c.metadata.timeRange.startTime);
            const cEnd = Date.parse(c.metadata.timeRange.endTime);
            return cStart <= end && cEnd >= start;
          });
          setComments(filtered);
        } else {
          setComments(items);
        }
      }
    );
    return () => {
      if (unsubRef.current) unsubRef.current();
      unsubRef.current = null;
    };
  }, [opts.stationId, opts.authorUid, includeDeleted, pageSize, opts.realtime]);

  const loadMore = useCallback(async () => {
    if (!opts.stationId || !cursor) return { hasMore: false };
    const res = await getCommentsByStation(opts.stationId, { includeDeleted, pageSize, cursor: cursor as any });
    setComments((prev) => [...prev, ...res.items]);
    setCursor(res.nextCursor);
    return { hasMore: !!res.nextCursor };
  }, [opts.stationId, cursor, includeDeleted, pageSize]);

  const create = useCallback(
    async (payload: Omit<CreateCommentData, 'authorUid' | 'authorDisplayName' | 'authorPhotoURL'>) => {
      if (!user) throw new Error('Not authenticated');
      const author = {
        authorUid: user.uid,
        authorDisplayName: user.displayName ?? userProfile?.displayName ?? null,
        authorPhotoURL: user.photoURL ?? userProfile?.photoURL ?? null,
      };
      // local validation before sending
      const metaRes = validateCommentMetadata(payload.metadata);
      if (!metaRes.ok) throw new Error(metaRes.errors.join(', '));
      const contentRes = validateCommentContent(payload.content);
      if (!contentRes.ok) throw new Error(contentRes.errors.join(', '));

      const optimistic: Comment = {
        id: `tmp-${Date.now()}`,
        content: contentRes.sanitized,
        ...author,
        metadata: payload.metadata,
        createdAt: { seconds: Math.floor(Date.now() / 1000) } as any,
        updatedAt: { seconds: Math.floor(Date.now() / 1000) } as any,
        isEdited: false,
        editHistory: [],
        isDeleted: false,
      };
      setComments((prev) => [optimistic, ...prev]);
      try {
        const saved = await svcCreate({ ...payload, ...author }, { role: role as UserRole, currentUserUid: user.uid });
        setComments((prev) => [saved, ...prev.filter((c) => c.id !== optimistic.id)]);
        return saved;
      } catch (e) {
        setComments((prev) => prev.filter((c) => c.id !== optimistic.id));
        throw e;
      }
    },
    [user, userProfile, role]
  );

  const update = useCallback(
    async (id: string, patch: UpdateCommentData) => {
      if (!user) throw new Error('Not authenticated');
      // Optimistic update (content only)
      setComments((prev) => prev.map((c) => (c.id === id && patch.content ? { ...c, content: patch.content } as Comment : c)));
      try {
        await svcUpdate(id, patch, { role: role as UserRole, currentUserUid: user.uid });
      } catch (e) {
        // rollback by refetching
        await refresh();
        throw e;
      }
    },
    [user, role, refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      if (!user) throw new Error('Not authenticated');
      const prev = comments;
      setComments((cs) => cs.filter((c) => c.id !== id));
      try {
        await svcDelete(id, { role: role as UserRole, currentUserUid: user.uid });
      } catch (e) {
        setComments(prev);
        throw e;
      }
    },
    [user, role, comments]
  );

  return {
    comments,
    loading,
    error,
    refresh,
    loadMore,
    create,
    update,
    remove,
  };
};

/** Station-scoped helper integrating with chart time domain. */
export const useStationComments = (config: AppConfiguration, opts?: { realtime?: boolean; pageSize?: number }) => {
  const { processedData } = useChartData(config);
  const timeRange: CommentTimeRange = useMemo(() => ({
    startTime: processedData.timeDomain.start.toISOString(),
    endTime: processedData.timeDomain.end.toISOString(),
  }), [processedData.timeDomain.start, processedData.timeDomain.end]);

  const api = useComments({ stationId: config.station.id, timeRange, realtime: opts?.realtime ?? true, pageSize: opts?.pageSize });
  return api;
};

/** Permission helpers bound to current user. */
export const useCommentPermissions = () => {
  const userPerms = useUserPermissions();
  const { user, userProfile, loading } = useAuth();
  
  return useMemo(() => {
    // If still loading, return permissive functions that will be updated when loading completes
    if (loading || !user) {
      return {
        canCreate: () => false,
        canEdit: (c: Comment) => false,
        canDelete: (c: Comment) => false,
        loading: true,
      };
    }

    // If user is authenticated but profile hasn't loaded, allow basic operations for now
    // The actual permissions will be enforced server-side by Firestore rules
    const effectiveRole = userProfile?.role ?? (user.isAnonymous ? UserRole.Anonymous : UserRole.User);
    
    return {
      canCreate: () => !user.isAnonymous && effectiveRole !== UserRole.Anonymous,
      canEdit: (c: Comment) => {
        if (!user || user.isAnonymous) return false;
        return validateCommentPermissions({
          action: 'edit',
          role: effectiveRole,
          currentUserUid: user.uid,
          comment: {
            authorUid: c.authorUid,
            isDeleted: c.isDeleted,
            createdAt: c.createdAt
          }
        });
      },
      canDelete: (c: Comment) => {
        if (!user || user.isAnonymous) return false;
        return validateCommentPermissions({
          action: 'delete',
          role: effectiveRole,
          currentUserUid: user.uid,
          comment: {
            authorUid: c.authorUid,
            isDeleted: c.isDeleted,
            createdAt: c.createdAt
          }
        });
      },
      loading: false,
    };
  }, [user, userProfile, loading, userPerms.role]);
};

/** Simple form management for creating/updating a comment. */
export const useCommentForm = (initial?: { content?: string; timeRange?: CommentTimeRange }) => {
  const [content, setContent] = useState<string>(initial?.content ?? '');
  const [timeRange, setTimeRange] = useState<CommentTimeRange | undefined>(initial?.timeRange);
  const [errors, setErrors] = useState<string[] | null>(null);

  const validate = useCallback((metadata: Parameters<typeof validateCommentMetadata>[0]) => {
    const errs: string[] = [];
    const c = validateCommentContent(content);
    if (!c.ok) errs.push(...c.errors);
    const m = validateCommentMetadata(metadata);
    if (!m.ok) errs.push(...m.errors);
    setErrors(errs.length ? errs : null);
    return errs.length === 0;
  }, [content]);

  return {
    content,
    setContent,
    timeRange,
    setTimeRange,
    errors,
    validate,
  };
};

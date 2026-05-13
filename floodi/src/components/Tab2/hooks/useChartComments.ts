import { useCallback, useMemo, useState } from 'react';
import type { AppConfiguration } from 'src/components/Tab2/types';
import type { Comment, CommentTimeRange } from 'src/types/comment';
import { useCommentPermissions, useLocationComments } from 'src/hooks/useComments';
import { getCommentsInTimeRange, getTimeRangeFromChartSelection, validateChartTimeRange } from 'src/utils/timeRangeHelpers';

/**
 * Hook that binds location-scoped comments to current chart domain and exposes
 * overlay state, toggles, and interaction handlers for ChartViewer.
 */
export const useChartComments = (config: AppConfiguration) => {
  const perms = useCommentPermissions();
  const { comments, loading, error, refresh } = useLocationComments(config, { realtime: true, pageSize: 100 });

  // Overlay state
  const [showComments, setShowComments] = useState<boolean>(true);
  const [hoveredComment, setHoveredComment] = useState<Comment | null>(null);
  const [selectedTimeRange, setSelectedTimeRange] = useState<CommentTimeRange | null>(null);
  const [selectedComments, setSelectedComments] = useState<Comment[] | null>(null);

  // Filter comments by current chart domain
  const domainRange: CommentTimeRange = useMemo(() => ({
    startTime: config.timeRange.mode === 'relative'
      ? new Date(Date.now() - config.timeRange.lookbackH * 3600_000).toISOString()
      : new Date(config.timeRange.absStart).toISOString(),
    endTime: config.timeRange.mode === 'relative'
      ? new Date(Date.now() + config.timeRange.lookaheadH * 3600_000).toISOString()
      : new Date(config.timeRange.absEnd).toISOString(),
  }), [config.timeRange]);

  const visibleComments: Comment[] = useMemo(() => getCommentsInTimeRange(comments || [], domainRange), [comments, domainRange.startTime, domainRange.endTime]);

  // Handlers
  const toggleCommentOverlay = useCallback(() => setShowComments((v) => !v), []);

  const handleCommentHover = useCallback((c: Comment | null) => setHoveredComment(c), []);
  const handleCommentClick = useCallback((c: Comment[]) => setSelectedComments(c), []);

  const handleTimeRangeSelect = useCallback((sel: { start?: Date; end?: Date; at?: Date }) => {
    const range = getTimeRangeFromChartSelection(sel);
    const v = validateChartTimeRange(config, range);
    if (!v.ok) return;
    setSelectedTimeRange(range);
  }, [config]);

  return {
    // data
    comments: visibleComments,
    commentCount: visibleComments.length,
    loading,
    error,
    refresh,

    // perms
    canCreate: perms.canCreate(),

    // overlay state
    showComments,
    hoveredComment,
    selectedTimeRange,
    selectedComments,

    // handlers
    toggleCommentOverlay,
    handleCommentHover,
    handleCommentClick,
    handleTimeRangeSelect,
    clearSelected: () => {
      setSelectedTimeRange(null);
      setSelectedComments(null);
    },
  } as const;
};

export type UseChartCommentsReturn = ReturnType<typeof useChartComments>;


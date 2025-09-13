import { useCallback, useEffect, useMemo, useState } from 'react';
import { useComments } from 'src/hooks/useComments';
import { useUserPermissions } from 'src/hooks/useUserPermissions';

export interface CommentsTabFilters {
  search: string;
  author: string;
  range: { start: string; end: string } | null;
  dataContext: { observed?: boolean; predicted?: boolean; adjusted?: boolean } | null;
}

/**
 * Hook for managing state and behavior of the dedicated Comments tab.
 */
export const useCommentsTab = (stationIdOverride?: string) => {
  const DEFAULT_STATION = '8658163';
  const [stationId, setStationId] = useState<string>(() => {
    if (stationIdOverride) return stationIdOverride;
    try {
      return localStorage.getItem('comments.tab.station') || DEFAULT_STATION;
    } catch {
      return DEFAULT_STATION;
    }
  });
  const [filterState, setFilterState] = useState<CommentsTabFilters>(() => {
    try {
      const raw = localStorage.getItem('comments.tab.filters.v1');
      if (raw) return JSON.parse(raw);
    } catch {}
    return { search: '', author: '', range: null, dataContext: null };
  });

  const { comments, loading, error, refresh } = useComments({ stationId, realtime: true, pageSize: 30 });
  const { role } = useUserPermissions();

  // Persist station only if not overridden
  useEffect(() => {
    if (!stationIdOverride) {
      try {
        localStorage.setItem('comments.tab.station', stationId);
      } catch {}
    }
  }, [stationId, stationIdOverride]);

  // Persist filters (also persisted by CommentManager for robustness; this ensures page-level persistence too)
  useEffect(() => {
    try {
      localStorage.setItem('comments.tab.filters.v1', JSON.stringify(filterState));
    } catch {}
  }, [filterState.search, filterState.author, filterState.range?.start, filterState.range?.end, filterState.dataContext?.observed, filterState.dataContext?.predicted, filterState.dataContext?.adjusted]);

  const stats = useMemo(() => {
    const total = comments.length;
    const last24hCut = Date.now() - 24 * 3600 * 1000;
    const last24h = comments.filter((c) => Date.parse((c as any).createdAt) >= last24hCut).length;
    return { total, last24h };
  }, [comments]);

  const exportJSON = useCallback(() => {
    const blob = new Blob([JSON.stringify(comments, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `comments-${stationId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [comments, stationId]);

  return {
    stationId: stationIdOverride || stationId,
    setStationId: stationIdOverride ? () => {} : setStationId, // No-op if overridden
    filterState,
    setFilterState,
    comments,
    loading,
    error,
    refresh,
    role,
    stats,
    exportJSON,
  };
};

export default useCommentsTab;


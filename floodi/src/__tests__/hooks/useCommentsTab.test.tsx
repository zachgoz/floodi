import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCommentsTab } from 'src/hooks/useCommentsTab';

vi.mock('src/hooks/useComments', () => ({
  useComments: vi.fn().mockReturnValue({ comments: [], loading: false, error: null, refresh: vi.fn() }),
}));

vi.mock('src/hooks/useUserPermissions', () => ({
  useUserPermissions: () => ({ role: 'user' }),
}));

describe('useCommentsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    try { localStorage.clear(); } catch {}
  });

  it('initializes with defaults and persists station', async () => {
    const { result } = renderHook(() => useCommentsTab());
    expect(result.current.stationId).toBeDefined();
    act(() => result.current.setStationId('1234567'));
    expect(result.current.stationId).toBe('1234567');
    expect(localStorage.getItem('comments.tab.station')).toBe('1234567');
  });

  it('updates and persists filters', async () => {
    const { result } = renderHook(() => useCommentsTab());
    act(() => result.current.setFilterState((s: any) => ({ ...s, search: 'storm' })));
    expect(JSON.parse(localStorage.getItem('comments.tab.filters.v1') || '{}').search).toBe('storm');
  });
});


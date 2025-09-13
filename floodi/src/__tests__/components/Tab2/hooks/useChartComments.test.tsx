import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { useChartComments } from 'src/components/Tab2/hooks/useChartComments';

vi.mock('src/hooks/useComments', async () => {
  return {
    useStationComments: () => ({ comments: [
      {
        id: 'c1',
        content: 'hello',
        authorUid: 'u1',
        authorDisplayName: 'Alice',
        authorPhotoURL: null,
        metadata: {
          station: { id: 'S1', name: 'Station' },
          timeRange: { startTime: new Date(Date.now() - 300000).toISOString(), endTime: new Date(Date.now() + 300000).toISOString(), eventType: 'normal-tide' },
          dataContext: ['observed'],
        },
        createdAt: { seconds: Math.floor(Date.now()/1000) } as any,
        updatedAt: { seconds: Math.floor(Date.now()/1000) } as any,
        isEdited: false,
        editHistory: [],
        isDeleted: false,
      },
    ], loading: false, error: null, refresh: vi.fn() }),
    useCommentPermissions: () => ({ canCreate: () => true, canEdit: () => true, canDelete: () => true }),
  };
});

describe('useChartComments', () => {
  const config = {
    station: { id: 'S1', name: 'Station' },
    threshold: 5,
    offset: { mode: 'auto', value: '' },
    timeRange: { mode: 'relative', lookbackH: 1, lookaheadH: 1, absStart: '', absEnd: '' },
    display: { timezone: 'local', showDelta: true },
  } as any;

  it('initializes and filters comments by current domain', () => {
    const { result } = renderHook(() => useChartComments(config));
    expect(result.current.comments.length).toBeGreaterThan(0);
    expect(result.current.commentCount).toBe(1);
    expect(result.current.showComments).toBe(true);
  });

  it('toggles overlay and creation mode', () => {
    const { result } = renderHook(() => useChartComments(config));
    act(() => result.current.toggleCommentOverlay());
    expect(result.current.showComments).toBe(false);
    act(() => result.current.toggleCreationMode());
    expect(result.current.commentCreationMode).toBe(true);
  });

  it('captures a selected time range', () => {
    const { result } = renderHook(() => useChartComments(config));
    act(() => result.current.handleTimeRangeSelect({ start: new Date(), end: new Date(Date.now()+60000) }));
    expect(result.current.selectedTimeRange).toBeTruthy();
    act(() => result.current.clearSelectedRange());
    expect(result.current.selectedTimeRange).toBeNull();
  });
});


import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useComments } from 'src/hooks/useComments';
import { UserRole } from 'src/types/user';

vi.mock('src/contexts/AuthContext', () => ({ useAuth: vi.fn() }));
import { useAuth } from 'src/contexts/AuthContext';

vi.mock('src/lib/commentService', () => ({
  getCommentsByStation: vi.fn(),
  getCommentsByTimeRange: vi.fn(),
  getCommentsByAuthor: vi.fn(),
  createComment: vi.fn(),
  updateComment: vi.fn(),
  deleteComment: vi.fn(),
  subscribeToComments: vi.fn(),
}));

import * as svc from 'src/lib/commentService';

const mockAuth = (user: { uid: string; displayName?: string | null; photoURL?: string | null } | null) => {
  vi.mocked(useAuth).mockReturnValue({ user, userProfile: user ? { role: UserRole.User } : null } as any);
};

describe('useComments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth({ uid: 'u1', displayName: 'T', photoURL: null });
    vi.mocked(svc.subscribeToComments).mockReturnValue(() => void 0);
  });

  it('loads comments by station', async () => {
    vi.mocked(svc.getCommentsByStation).mockResolvedValueOnce({ items: [{ id: '1' } as any], nextCursor: null });
    const { result } = renderHook(() => useComments({ stationId: '8720218', realtime: false }));
    // wait a tick
    await act(async () => {});
    expect(result.current.comments.length).toBe(1);
  });

  it('creates a comment with optimistic update', async () => {
    vi.mocked(svc.getCommentsByStation).mockResolvedValueOnce({ items: [], nextCursor: null });
    const start = new Date();
    const end = new Date(start.getTime() + 1000);
    vi.mocked(svc.createComment).mockResolvedValueOnce({ id: 'saved', content: 'Hi', authorUid: 'u1', authorDisplayName: 'T', authorPhotoURL: null, metadata: { station: { id: '8720218', name: 'X' }, timeRange: { startTime: start.toISOString(), endTime: end.toISOString() }, dataContext: 'observed' }, createdAt: { seconds: 1 } as any, updatedAt: { seconds: 1 } as any, isEdited: false, editHistory: [], isDeleted: false } as any);
    const { result } = renderHook(() => useComments({ stationId: '8720218', realtime: false }));
    await act(async () => {});
    await act(async () => {
      await result.current.create({ content: 'Hi', metadata: { station: { id: '8720218', name: 'X' }, timeRange: { startTime: start.toISOString(), endTime: end.toISOString() }, dataContext: 'observed' } });
    });
    expect(svc.createComment).toHaveBeenCalled();
    expect(result.current.comments.length).toBe(1);
  });
});

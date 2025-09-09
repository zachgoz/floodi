import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UserRole } from 'src/types/user';

vi.mock('src/lib/firebase', () => ({ db: {} }));

const {
  addDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  doc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  serverTimestamp,
  startAfter,
  onSnapshot,
} = vi.hoisted(() => ({
  addDoc: vi.fn(),
  getDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  doc: vi.fn(),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getDocs: vi.fn(),
  serverTimestamp: vi.fn(() => ({ seconds: Math.floor(Date.now() / 1000) })),
  startAfter: vi.fn(),
  onSnapshot: vi.fn(),
}));

vi.mock('firebase/firestore', async () => ({
  ...(await vi.importActual<object>('firebase/firestore')),
  addDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  doc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  serverTimestamp,
  startAfter,
  onSnapshot,
}));

import {
  createComment,
  getCommentsByStation,
  updateComment,
  deleteComment,
  subscribeToStationComments,
} from 'src/lib/commentService';

const validMeta = {
  station: { id: '8720218', name: 'Key West' },
  timeRange: { startTime: new Date(Date.now() - 3600_000).toISOString(), endTime: new Date().toISOString() },
  dataContext: 'observed' as const,
};

describe('commentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    doc.mockReturnValue({});
    collection.mockReturnValue({});
  });
  afterEach(() => vi.restoreAllMocks());

  it('creates a comment with validation', async () => {
    const addRes = { id: 'c1' } as any;
    addDoc.mockResolvedValueOnce(addRes);
    getDoc.mockResolvedValueOnce({ exists: () => true, id: 'c1', data: () => ({
      content: 'Hello',
      authorUid: 'u1',
      authorDisplayName: 'T',
      authorPhotoURL: null,
      metadata: validMeta,
      createdAt: { seconds: 1 },
      updatedAt: { seconds: 1 },
      isEdited: false,
      editHistory: [],
      isDeleted: false,
    }) });
    const created = await createComment({ content: 'Hello', metadata: validMeta, authorUid: 'u1', authorDisplayName: 'T', authorPhotoURL: null }, { role: UserRole.User, currentUserUid: 'u1' });
    expect(addDoc).toHaveBeenCalled();
    expect(created.id).toBe('c1');
  });

  it('lists station comments with pagination', async () => {
    getDocs.mockResolvedValueOnce({ docs: [ { id: 'a', data: () => ({ content: 'x' }) } ] });
    const page = await getCommentsByStation('8720218', { pageSize: 10 });
    expect(query).toHaveBeenCalled();
    expect(page.items.length).toBe(1);
  });

  it('updates comment content and tracks history', async () => {
    getDoc.mockResolvedValueOnce({ exists: () => true, id: 'c1', data: () => ({
      content: 'Old', authorUid: 'u1', isDeleted: false, editHistory: [], metadata: validMeta,
    }) });
    updateDoc.mockResolvedValueOnce(undefined);
    await updateComment('c1', { content: 'New', editReason: 'Fix typo' }, { role: UserRole.User, currentUserUid: 'u1' });
    expect(updateDoc).toHaveBeenCalled();
  });

  it('soft deletes a comment', async () => {
    getDoc.mockResolvedValueOnce({ exists: () => true, id: 'c1', data: () => ({ authorUid: 'u1', isDeleted: false }) });
    updateDoc.mockResolvedValueOnce(undefined);
    await deleteComment('c1', { role: UserRole.User, currentUserUid: 'u1' });
    expect(updateDoc).toHaveBeenCalled();
  });

  it('subscribes to station comments', async () => {
    const fakeUnsub = vi.fn();
    onSnapshot.mockImplementationOnce((_q, cb) => {
      cb({ docs: [] });
      return fakeUnsub;
    });
    const unsub = subscribeToStationComments('8720218', () => void 0);
    expect(typeof unsub).toBe('function');
  });
});


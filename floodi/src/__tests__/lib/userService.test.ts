import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { UserProfile } from 'src/types/user';

vi.mock('src/lib/firebase', () => ({ db: {} }));

// Define hoisted fns so they are available when the mock factory is hoisted
const {
  getDoc,
  setDoc,
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
} = vi.hoisted(() => ({
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  doc: vi.fn(),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getDocs: vi.fn(),
  serverTimestamp: vi.fn(() => ({ seconds: Date.now() / 1000 })),
}));

vi.mock('firebase/firestore', async () => ({
  ...(await vi.importActual<object>('firebase/firestore')),
  getDoc,
  setDoc,
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
}));

import {
  createUserProfile,
  getUserProfile,
  updateUserProfile,
  deleteUserProfile,
  getUsersByRole,
  updateUserRole,
  getUserPermissions,
} from 'src/lib/userService';
import { UserRole } from 'src/types/user';

describe('userService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    doc.mockReturnValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates and reads a user profile', async () => {
    const uid = 'abc123';
    setDoc.mockResolvedValueOnce(undefined);
    const profile: Partial<UserProfile> = {
      uid,
      email: 'test@example.com',
      displayName: 'T',
      photoURL: null,
      role: UserRole.User,
      isActive: true,
    };
    getDoc.mockResolvedValueOnce({ exists: () => true, data: () => profile });
    const created = await createUserProfile(uid, {
      email: 'test@example.com',
      displayName: 'T',
      photoURL: null,
    }, { isAnonymous: false });
    expect(setDoc).toHaveBeenCalled();
    expect(created?.uid).toBe(uid);
  });

  it('returns null for missing profile', async () => {
    const uid = 'missing';
    getDoc.mockResolvedValueOnce({ exists: () => false });
    const res = await getUserProfile(uid);
    expect(res).toBeNull();
  });

  it('updates and deletes a profile', async () => {
    const uid = 'u1';
    updateDoc.mockResolvedValueOnce(undefined);
    await updateUserProfile(uid, { displayName: 'New' });
    expect(updateDoc).toHaveBeenCalled();

    deleteDoc.mockResolvedValueOnce(undefined);
    await deleteUserProfile(uid);
    expect(deleteDoc).toHaveBeenCalled();
  });

  it('queries users by role', async () => {
    getDocs.mockResolvedValueOnce({ docs: [{ data: () => ({ uid: '1' }) }, { data: () => ({ uid: '2' }) }] });
    const res = await getUsersByRole(UserRole.User);
    expect(collection).toHaveBeenCalled();
    expect(query).toHaveBeenCalled();
    expect(res.length).toBe(2);
  });

  it('updates user role', async () => {
    updateDoc.mockResolvedValueOnce(undefined);
    await updateUserRole('u2', UserRole.Moderator);
    expect(updateDoc).toHaveBeenCalled();
  });

  it('maps user permissions by role', async () => {
    const uid = 'perm';
    getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ uid, role: UserRole.Admin }) });
    const perms = await getUserPermissions(uid);
    expect(perms?.canManageUsers).toBe(true);
  });
});

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  startAfter,
  type QueryDocumentSnapshot,
  type DocumentData,
  type DocumentReference,
} from 'firebase/firestore';
import { db } from 'src/lib/firebase';
import {
  type CreateUserProfileData,
  type UpdateUserProfileData,
  type UserProfile,
  UserRole,
  type UserPermissions,
} from 'src/types/user';
import { getDefaultRoleForUser, getRolePermissions } from 'src/utils/permissions';

const USERS_COLLECTION = 'users';
const PUBLIC_PROFILES_COLLECTION = 'publicProfiles';

/** Build a typed ref to a user doc. */
const userDocRef = (uid: string): DocumentReference => doc(db, USERS_COLLECTION, uid);
const publicProfileDocRef = (uid: string): DocumentReference => doc(db, PUBLIC_PROFILES_COLLECTION, uid);

/** Validate basic uid */
const assertUid = (uid: string) => {
  if (!uid || typeof uid !== 'string') throw new Error('Invalid uid');
};

/**
 * Create a new user profile document in Firestore.
 * - Sets timestamps via serverTimestamp()
 * - Assigns default role if not provided
 */
export const createUserProfile = async (
  uid: string,
  data: CreateUserProfileData,
  opts?: { isAnonymous?: boolean }
): Promise<UserProfile> => {
  assertUid(uid);
  const now = serverTimestamp();
  const role = data.role ?? getDefaultRoleForUser(!!opts?.isAnonymous);

  const payload = {
    uid,
    email: data.email ?? null,
    displayName: data.displayName ?? null,
    photoURL: data.photoURL ?? null,
    role,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: data.lastLoginAt ?? null,
    isActive: data.isActive ?? true,
  } as unknown as UserProfile; // timestamps will be server-side values

  await setDoc(userDocRef(uid), payload);
  // Read back to obtain concrete Timestamps
  const snap = await getDoc(userDocRef(uid));
  if (!snap.exists()) throw new Error('Failed to create user profile');
  // Also mirror to public profile document
  await setDoc(
    publicProfileDocRef(uid),
    {
      uid,
      displayName: payload.displayName ?? null,
      photoURL: payload.photoURL ?? null,
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );
  return snap.data() as UserProfile;
};

/** Get a user profile by uid. */
export const getUserProfile = async (uid: string): Promise<UserProfile | null> => {
  assertUid(uid);
  const snap = await getDoc(userDocRef(uid));
  return snap.exists() ? (snap.data() as UserProfile) : null;
};

/** Update fields of a profile, excluding role. */
export const updateUserProfile = async (
  uid: string,
  data: UpdateUserProfileData
): Promise<void> => {
  assertUid(uid);
  const update = { ...data, updatedAt: serverTimestamp() } as Record<string, unknown>;
  await updateDoc(userDocRef(uid), update);
  // Reflect changes to public profile subset
  const publicUpdate: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (Object.prototype.hasOwnProperty.call(update, 'displayName')) publicUpdate.displayName = (update as any).displayName ?? null;
  if (Object.prototype.hasOwnProperty.call(update, 'photoURL')) publicUpdate.photoURL = (update as any).photoURL ?? null;
  await setDoc(publicProfileDocRef(uid), { uid, ...publicUpdate }, { merge: true });
};

/** Delete a profile document. Use with care. */
export const deleteUserProfile = async (uid: string): Promise<void> => {
  assertUid(uid);
  await deleteDoc(userDocRef(uid));
};

/** Query users by a given role. Optional pagination controls. */
export const getUsersByRole = async (
  role: UserRole,
  options?: { pageSize?: number }
): Promise<UserProfile[]> => {
  const pageSize = options?.pageSize ?? 50;
  const q = query(
    collection(db, USERS_COLLECTION),
    where('role', '==', role),
    orderBy('createdAt', 'desc'),
    limit(pageSize)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as UserProfile);
};

/** Cursor-based pagination for admin user lists. */
export interface UsersPage {
  items: UserProfile[];
  nextCursor: QueryDocumentSnapshot<DocumentData> | null;
}

export const getUsersByRolePage = async (
  role: UserRole,
  options?: { pageSize?: number; cursor?: QueryDocumentSnapshot<DocumentData> | null }
): Promise<UsersPage> => {
  const pageSize = options?.pageSize ?? 50;
  const parts = [
    where('role', '==', role),
    orderBy('createdAt', 'desc'),
    limit(pageSize),
  ] as any[];
  if (options?.cursor) parts.push(startAfter(options.cursor));
  const q = query(collection(db, USERS_COLLECTION), ...parts);
  const snap = await getDocs(q);
  const items = snap.docs.map((d) => d.data() as UserProfile);
  const nextCursor = snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1] : null;
  return { items, nextCursor };
};

/** Update only the role of a user. Intended for admin workflows. */
export const updateUserRole = async (uid: string, newRole: UserRole): Promise<void> => {
  assertUid(uid);
  if (!Object.values(UserRole).includes(newRole)) throw new Error('Invalid role');
  await updateDoc(userDocRef(uid), { role: newRole, updatedAt: serverTimestamp() });
};

/** Retrieve the permission set for a user's role. */
export const getUserPermissions = async (uid: string): Promise<UserPermissions | null> => {
  const profile = await getUserProfile(uid);
  if (!profile) return null;
  return getRolePermissions(profile.role);
};

/** Simple isActive guard. */
export const isUserActive = async (uid: string): Promise<boolean> => {
  const profile = await getUserProfile(uid);
  return !!profile?.isActive;
};

/**
 * Utility to ensure an up-to-date lastLoginAt; call after successful login.
 */
export const touchLastLogin = async (uid: string): Promise<void> => {
  assertUid(uid);
  await updateDoc(userDocRef(uid), { lastLoginAt: serverTimestamp(), updatedAt: serverTimestamp() });
};

/**
 * Ensure a user profile exists and is up to date.
 * - Merges provided data
 * - Sets createdAt only if missing
 * - Updates updatedAt always
 */
export const ensureUserProfile = async (
  uid: string,
  data: CreateUserProfileData,
  opts?: { isAnonymous?: boolean }
): Promise<UserProfile> => {
  assertUid(uid);
  const now = serverTimestamp();

  const existing = await getDoc(userDocRef(uid));
  const role = data.role ?? getDefaultRoleForUser(!!opts?.isAnonymous);

  const profileUpdate: Record<string, unknown> = {
    uid,
    email: data.email ?? null,
    displayName: data.displayName ?? null,
    photoURL: data.photoURL ?? null,
    role,
    updatedAt: now,
    lastLoginAt: data.lastLoginAt ?? null,
  };
  if (!existing.exists() || !(existing.data() as any)?.createdAt) {
    profileUpdate.createdAt = now;
  }
  // Merge to avoid overwriting existing fields
  await setDoc(userDocRef(uid), profileUpdate, { merge: true });

  // Mirror to public profile
  const publicUpdate: Record<string, unknown> = {
    uid,
    displayName: profileUpdate.displayName ?? null,
    photoURL: profileUpdate.photoURL ?? null,
    updatedAt: now,
  };
  if (!existing.exists() || !(existing.data() as any)?.createdAt) {
    publicUpdate.createdAt = now;
  }
  await setDoc(publicProfileDocRef(uid), publicUpdate, { merge: true });

  const snap = await getDoc(userDocRef(uid));
  return (snap.data() as UserProfile) ?? (profileUpdate as unknown as UserProfile);
};

export type { UserProfile } from 'src/types/user';

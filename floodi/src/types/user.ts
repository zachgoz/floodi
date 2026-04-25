import type { Timestamp } from 'firebase/firestore';

/**
 * User roles supported by the application.
 * - anonymous: guest users without an account
 * - user: registered users with standard privileges
 * - moderator: trusted users who can moderate community content
 * - admin: full administrative access including user management
 */
export enum UserRole {
  Anonymous = 'anonymous',
  User = 'user',
  Moderator = 'moderator',
  Admin = 'admin',
}

/**
 * Firestore-backed user profile document stored in `users/{uid}`.
 */
export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  role: UserRole;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastLoginAt: Timestamp | null;
  isActive: boolean;
}

/**
 * Permissions represented as boolean capabilities for a role.
 */
export interface UserPermissions {
  canCreateComments: boolean;
  canEditOwnComments: boolean;
  canDeleteOwnComments: boolean;
  canEditAnyComments: boolean;
  canDeleteAnyComments: boolean;
  canManageUsers: boolean;
  canViewAnalytics: boolean;
}

/** Map of role -> permissions. */
export type RolePermissions = Record<UserRole, UserPermissions>;

/** Payload for creating a profile. Server will set timestamps. */
export interface CreateUserProfileData {
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  role?: UserRole; // optional; default assigned by service
  isActive?: boolean; // default true
  lastLoginAt?: Timestamp | null; // optional
}

/** Payload for updating a profile. Role updates should go through dedicated APIs. */
export type UpdateUserProfileData = Partial<
  Omit<UserProfile, 'uid' | 'createdAt' | 'updatedAt' | 'role'>
> & { role?: never };

/**
 * Actions used by permission helpers. Useful for UI checks.
 */
export type PermissionKey = keyof UserPermissions;

/** Utility role guard */
export const isValidRole = (role: unknown): role is UserRole =>
  role === UserRole.Anonymous ||
  role === UserRole.User ||
  role === UserRole.Moderator ||
  role === UserRole.Admin;


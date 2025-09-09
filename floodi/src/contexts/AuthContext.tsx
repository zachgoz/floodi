import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
  signInAnonymously,
  linkWithCredential,
  EmailAuthProvider,
} from 'firebase/auth';
import { auth } from 'src/lib/firebase';
import type { UserProfile } from 'src/types/user';
import type { UserPermissions } from 'src/types/user';
import { createUserProfile as createProfile, ensureUserProfile, getUserProfile as fetchProfile, updateUserRole as changeUserRole, getUserPermissions as fetchPermissions, touchLastLogin, updateUserProfile as persistUserProfile } from 'src/lib/userService';
import { getDefaultRoleForUser } from 'src/utils/permissions';
import type {
  AuthError,
  AuthState,
  ProfileUpdateData,
} from 'src/types/auth';
import { formatFirebaseAuthError } from 'src/utils/auth';

export interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    displayName?: string,
    photoURL?: string
  ) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateUserProfile: (data: ProfileUpdateData) => Promise<void>;
  signInAnonymously: () => Promise<void>;
  convertAnonymousToRegistered: (
    email: string,
    password: string,
    displayName?: string,
    photoURL?: string
  ) => Promise<void>;
  /** Firestore-backed profile for the current user, if loaded */
  userProfile: UserProfile | null;
  /** Permission set derived from the user's role */
  userPermissions: UserPermissions | null;
  /** Refetch the profile and permissions */
  refreshUserProfile: () => Promise<void>;
  /** Admin-only: update a target user's role */
  updateUserRole: (uid: string, newRole: UserProfile['role']) => Promise<void>;
  /** Get current user permissions (shortcut) */
  getCurrentUserPermissions: () => UserPermissions | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<AuthError | null>(null);
  const isAnonymous = !!user?.isAnonymous;
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [userPermissions, setUserPermissions] = useState<UserPermissions | null>(null);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let mounted = true;
    try {
      unsub = onAuthStateChanged(auth, async (u) => {
        if (!mounted) return;
        setUser(u);
        if (u) {
          try {
            // Touch lastLogin and ensure profile exists
            await touchLastLogin(u.uid).catch(() => undefined);
            const profile = await fetchProfile(u.uid);
            setUserProfile(profile);
            const perms = await fetchPermissions(u.uid);
            setUserPermissions(perms);
          } catch (err) {
            // Non-fatal; keep auth but surface error
            setError({ code: 'profile/load-failed', message: (err as { message?: string } | null)?.message || 'Failed to load profile' });
          }
        } else {
          setUserProfile(null);
          setUserPermissions(null);
        }
        setLoading(false);
      });
    } catch (e: unknown) {
      if (!mounted) return;
      setError({ code: 'auth/config-error', message: (e as { message?: string } | null)?.message || 'Failed to initialize auth.' });
      setLoading(false);
    }
    return () => {
      mounted = false;
      if (unsub) unsub();
    };
  }, []);

  const login = async (email: string, password: string) => {
    setError(null);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      // Ensure profile and permissions are refreshed after login
      await touchLastLogin(cred.user.uid).catch(() => undefined);
      await refreshUserProfile();
    } catch (e: unknown) {
      setError(formatFirebaseAuthError(e));
      throw e;
    }
  };

  const register = async (
    email: string,
    password: string,
    displayName?: string,
    photoURL?: string
  ) => {
    setError(null);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      if (displayName || photoURL) {
        await updateProfile(cred.user, {
          displayName: displayName || undefined,
          photoURL: photoURL || undefined,
        });
      }
      setUser(cred.user);
      // Ensure Firestore profile exists/updated (idempotent)
      await ensureUserProfile(cred.user.uid, {
        email: cred.user.email ?? null,
        displayName: cred.user.displayName ?? null,
        photoURL: cred.user.photoURL ?? null,
      }, { isAnonymous: false });
      await refreshUserProfile();
    } catch (e: unknown) {
      setError(formatFirebaseAuthError(e));
      throw e;
    }
  };

  const logout = async () => {
    setError(null);
    try {
      await signOut(auth);
    } catch (e: unknown) {
      setError(formatFirebaseAuthError(e));
      throw e;
    }
  };

  const resetPassword = async (email: string) => {
    setError(null);
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (e: unknown) {
      setError(formatFirebaseAuthError(e));
      throw e;
    }
  };

  const updateUserProfile = async (data: ProfileUpdateData) => {
    if (!auth.currentUser) {
      const err = { code: 'auth/no-current-user', message: 'No authenticated user.' } as AuthError;
      setError(err);
      throw err;
    }
    setError(null);
    try {
      await updateProfile(auth.currentUser, {
        displayName: data.displayName,
        photoURL: data.photoURL,
      });
      // Persist to Firestore profile as well
      await persistUserProfile(auth.currentUser.uid, {
        displayName: data.displayName,
        photoURL: data.photoURL,
      });
      // Ensure latest profile fields are reflected
      await auth.currentUser?.reload();
      setUser(auth.currentUser);
      await refreshUserProfile();
    } catch (e: unknown) {
      setError(formatFirebaseAuthError(e));
      throw e;
    }
  };

  const signInAnon = async () => {
    setError(null);
    try {
      const { user: u } = await signInAnonymously(auth);
      // Ensure an anonymous profile exists (with role anonymous)
      await createProfile(u.uid, {
        email: null,
        displayName: u.displayName ?? null,
        photoURL: u.photoURL ?? null,
        role: getDefaultRoleForUser(true),
      }, { isAnonymous: true }).catch(() => undefined);
      await refreshUserProfile();
    } catch (e: unknown) {
      setError(formatFirebaseAuthError(e));
      throw e;
    }
  };

  const convertAnonymousToRegistered = async (
    email: string,
    password: string,
    displayName?: string,
    photoURL?: string
  ) => {
    if (!auth.currentUser) {
      // No current user session, fall back to register
      return register(email, password, displayName, photoURL);
    }
    if (!auth.currentUser.isAnonymous) {
      // Prevent registering while already signed in with a non-anonymous account
      const err = { code: 'auth/already-registered-user', message: 'Use profile/settings to manage accounts.' } as AuthError;
      setError(err);
      throw err;
    }
    setError(null);
    try {
      const credential = EmailAuthProvider.credential(email, password);
      const result = await linkWithCredential(auth.currentUser, credential);
      if (displayName || photoURL) {
        await updateProfile(result.user, {
          displayName: displayName || undefined,
          photoURL: photoURL || undefined,
        });
      }
      setUser(result.user);
      // Ensure Firestore profile exists/updated (idempotent)
      await ensureUserProfile(result.user.uid, {
        email: result.user.email ?? null,
        displayName: result.user.displayName ?? null,
        photoURL: result.user.photoURL ?? null,
      }, { isAnonymous: false }).catch(() => undefined);
      await refreshUserProfile();
    } catch (e: unknown) {
      setError(formatFirebaseAuthError(e));
      throw e;
    }
  };

  const refreshUserProfile = async () => {
    if (!auth.currentUser) {
      setUserProfile(null);
      setUserPermissions(null);
      return;
    }
    const profile = await fetchProfile(auth.currentUser.uid);
    setUserProfile(profile);
    const perms = profile ? await fetchPermissions(auth.currentUser.uid) : null;
    setUserPermissions(perms);
  };

  const updateUserRole = async (uid: string, newRole: UserProfile['role']) => {
    await changeUserRole(uid, newRole);
    if (auth.currentUser?.uid === uid) await refreshUserProfile();
  };

  const getCurrentUserPermissions = (): UserPermissions | null => userPermissions;

  const value: AuthContextType = useMemo(
    () => ({
      user,
      loading,
      error,
      isAnonymous,
      userProfile,
      userPermissions,
      login,
      register,
      logout,
      resetPassword,
      updateUserProfile,
      signInAnonymously: signInAnon,
      convertAnonymousToRegistered,
      refreshUserProfile,
      updateUserRole,
      getCurrentUserPermissions,
    }) as AuthContextType,
    [user, loading, error, isAnonymous, userProfile, userPermissions]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
};

export type { User } from 'firebase/auth';

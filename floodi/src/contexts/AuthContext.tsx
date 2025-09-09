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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<AuthError | null>(null);
  const isAnonymous = !!user?.isAnonymous;

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let mounted = true;
    try {
      unsub = onAuthStateChanged(auth, (u) => {
        if (!mounted) return;
        setUser(u);
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
      await signInWithEmailAndPassword(auth, email, password);
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
      // Ensure latest profile fields are reflected
      await auth.currentUser?.reload();
      setUser(auth.currentUser);
    } catch (e: unknown) {
      setError(formatFirebaseAuthError(e));
      throw e;
    }
  };

  const signInAnon = async () => {
    setError(null);
    try {
      await signInAnonymously(auth);
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
    if (!auth.currentUser || !auth.currentUser.isAnonymous) {
      // Fallback to regular register when there is no anonymous session
      return register(email, password, displayName, photoURL);
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
    } catch (e: unknown) {
      setError(formatFirebaseAuthError(e));
      throw e;
    }
  };

  const value: AuthContextType = useMemo(
    () => ({
      user,
      loading,
      error,
      isAnonymous,
      login,
      register,
      logout,
      resetPassword,
      updateUserProfile,
      signInAnonymously: signInAnon,
      convertAnonymousToRegistered,
    }) as AuthContextType,
    [user, loading, error, isAnonymous]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
};

export type { User } from 'firebase/auth';

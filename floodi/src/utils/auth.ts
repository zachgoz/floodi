/** Email validation */
export const isValidEmail = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

/** Password validation: minimum 6 characters */
export const isValidPassword = (pwd: string): boolean => pwd.length >= 6;

/** Display name 2–50 chars */
export const isValidDisplayName = (name: string): boolean => name.length >= 2 && name.length <= 50;

/** Avatar URL validation: accept general HTTPS URLs (no extension required) */
export const isValidAvatarUrl = (value: string): boolean => {
  try {
    const u = new URL(value);
    return u.protocol === 'https:'; // require HTTPS
  } catch {
    return false;
  }
};

/** Format Firebase Auth errors to friendly messages */
export const formatFirebaseAuthError = (err: unknown) => {
  // Handle browser storage quota errors from restricted modes (e.g., Safari Private)
  const name = (err as { name?: string } | null)?.name || '';
  const rawMessage = (err as { message?: string } | null)?.message;
  if (name === 'QuotaExceededError' || /exceeded the quota/i.test(rawMessage || '')) {
    return {
      code: 'auth/storage-quota',
      message: 'Browser storage is restricted or full. Try a normal window or another browser.',
    };
  }

  const code = (err as { code?: string } | null)?.code || 'auth/unknown';
  const map: Record<string, string> = {
    'auth/invalid-credential': 'Invalid email or password.',
    'auth/user-not-found': 'No account found with this email.',
    'auth/wrong-password': 'Incorrect password.',
    'auth/email-already-in-use': 'Email is already in use.',
    'auth/weak-password': 'Password is too weak.',
    'auth/network-request-failed': 'Network error. Please try again.',
  };
  const message = rawMessage;
  return { code, message: map[code] || message || 'Authentication error.' };
};

/** Extract safe redirect path from query string */
export const getRedirectFromSearch = (search: string, fallback = '/'): string => {
  try {
    const usp = new URLSearchParams(search);
    const next = usp.get('redirect') || '';
    // Allow only internal paths beginning with a single '/'
    // Reject protocol-relative (e.g., '//example.com') and absolute URLs (http/https)
    if (/^\/(?!\/)/.test(next)) return next;
    return fallback;
  } catch {
    return fallback;
  }
};

/** Anonymous helpers */
import type { User } from 'firebase/auth';

/** Determines if the current user is anonymous */
export const isAnonymousUser = (user: User | null | undefined): boolean => !!user?.isAnonymous;

/** Formats a friendly display name for anonymous users */
export const formatAnonymousDisplay = (user: User | null | undefined): string => {
  if (!user || !user.isAnonymous) return user?.displayName || '';
  const short = user.uid ? user.uid.slice(0, 6) : 'guest';
  return `Guest (${short})`;
};

export type { AuthError } from 'src/types/auth';

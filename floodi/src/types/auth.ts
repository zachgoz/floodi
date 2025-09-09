import type { User } from 'firebase/auth';

export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated';

/** Structured error used across auth flows */
export interface AuthError {
  code: string;
  message: string;
}

/** Profile update payload */
export interface ProfileUpdateData {
  displayName?: string;
  photoURL?: string;
}

/** Credentials for login */
export interface LoginCredentials {
  email: string;
  password: string;
}

/** Credentials for registration */
export interface RegisterCredentials extends LoginCredentials {
  displayName?: string;
  photoURL?: string;
}

/** App-level view of the current authentication state */
export interface AuthState {
  user: User | null;
  loading: boolean;
  error: AuthError | null;
  /** True when the current Firebase user is anonymous */
  isAnonymous: boolean;
}

/** Firebase user with any potential app-specific decorations */
export type AuthUser = User;

/** Anonymous user type helper */
export type AnonymousUser = User & { isAnonymous: true };

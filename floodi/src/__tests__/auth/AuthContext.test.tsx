import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
// Important: mock dependencies BEFORE importing the module under test

vi.mock('src/lib/firebase', () => {
  return {
    auth: { currentUser: null } as unknown,
  };
});

vi.mock('firebase/auth', () => {
  const listeners: Array<(u: any | null) => void> = [];
  let user: any | null = null;
  return {
    onAuthStateChanged: (_auth: unknown, cb: (u: any | null) => void) => {
      listeners.push(cb);
      setTimeout(() => cb(user), 0);
      return () => {};
    },
    signInWithEmailAndPassword: vi.fn(async (_a: unknown, _e: string) => {
      user = { uid: '123', email: _e, isAnonymous: false };
      listeners.forEach((l) => l(user));
      return { user };
    }),
    createUserWithEmailAndPassword: vi.fn(async (_a: unknown, _e: string) => {
      user = { uid: 'abc', email: _e, isAnonymous: false };
      listeners.forEach((l) => l(user));
      return { user };
    }),
    signInAnonymously: vi.fn(async () => {
      user = { uid: 'anon-1', isAnonymous: true };
      listeners.forEach((l) => l(user));
      return { user };
    }),
    linkWithCredential: vi.fn(async (_u: any, cred: any) => {
      user = { uid: _u.uid, email: cred.email, isAnonymous: false };
      listeners.forEach((l) => l(user));
      return { user };
    }),
    EmailAuthProvider: {
      credential: (email: string, _password: string) => ({ email }),
    },
    sendPasswordResetEmail: vi.fn(async () => {}),
    signOut: vi.fn(async () => {
      user = null;
      listeners.forEach((l) => l(user));
    }),
    updateProfile: vi.fn(async () => {}),
  };
});

import { AuthProvider, useAuth } from 'src/contexts/AuthContext';
import { signInWithEmailAndPassword, sendPasswordResetEmail, signOut, signInAnonymously } from 'firebase/auth';

const Probe: React.FC = () => {
  const { user, loading, login, logout, register, resetPassword, updateUserProfile, signInAnonymously: anon, convertAnonymousToRegistered } = useAuth();
  return (
    <div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="user">{user?.email || ''}</div>
      <button onClick={() => login('a@b.com', 'pw')}>login</button>
      <button onClick={() => register('c@d.com', 'pw')}>register</button>
      <button onClick={() => anon()}>anon</button>
      <button onClick={() => convertAnonymousToRegistered('z@y.com', 'pw')}>convert</button>
      <button onClick={() => resetPassword('a@b.com')}>reset</button>
      <button onClick={() => updateUserProfile({ displayName: 'X' })}>update</button>
      <button onClick={() => logout()}>logout</button>
    </div>
  );
};

describe('AuthContext', () => {
  it('provides auth state and actions', async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    // Initial loading true
    expect(screen.getByTestId('loading').textContent).toBe('true');
    // Anonymous first
    screen.getByText('anon').click();
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe(''));
    // Convert to registered
    screen.getByText('convert').click();
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('z@y.com'));
    // Logout
    screen.getByText('logout').click();
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe(''));
    // Login
    screen.getByText('login').click();
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('a@b.com'));
    // Logout
    screen.getByText('logout').click();
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe(''));
    // Register
    screen.getByText('register').click();
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('c@d.com'));
  });

  it('throws if useAuth outside provider', () => {
    const Spy: React.FC = () => {
      // Calling at top-level should throw since no provider is mounted
      useAuth();
      return null;
    };
    expect(() => render(<Spy />)).toThrowError();
  });

  it('sets error and rethrows on login failure', async () => {
    const ErrProbe: React.FC = () => {
      const { login, error } = useAuth();
      const [thrown, setThrown] = React.useState<unknown>(null);
      return (
        <div>
          <div data-testid="err">{error ? `${error.code}|${error.message}` : ''}</div>
          <div data-testid="thrown">{thrown ? 'yes' : ''}</div>
          <button
            onClick={() =>
              login('bad@user.com', 'nope').catch((e) => {
                setThrown(e);
              })
            }
          >
            go
          </button>
        </div>
      );
    };
    render(
      <AuthProvider>
        <ErrProbe />
      </AuthProvider>
    );
    (signInWithEmailAndPassword as unknown as { mockRejectedValueOnce: (v: unknown) => void }).mockRejectedValueOnce({ code: 'auth/invalid-credential', message: 'xxx' });
    // Trigger
    screen.getByText('go').click();
    await waitFor(() => expect(screen.getByTestId('err').textContent).toContain('auth/invalid-credential'));
    await waitFor(() => expect(screen.getByTestId('thrown').textContent).toBe('yes'));
  });

  it('resetPassword succeeds without setting error', async () => {
    const ResetProbe: React.FC = () => {
      const { resetPassword, error } = useAuth();
      return (
        <div>
          <div data-testid="err">{error ? `${error.code}|${error.message}` : ''}</div>
          <button onClick={() => resetPassword('a@b.com')}>reset</button>
        </div>
      );
    };
    render(
      <AuthProvider>
        <ResetProbe />
      </AuthProvider>
    );
    (sendPasswordResetEmail as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce(undefined);
    screen.getByText('reset').click();
    await waitFor(() => expect(screen.getByTestId('err').textContent).toBe(''));
  });

  it('sets error and rethrows on logout failure', async () => {
    let doLogout: (() => Promise<void>) | null = null;
    const LogoutCapture: React.FC = () => {
      const { logout, error } = useAuth();
      doLogout = logout;
      return <div data-testid="err">{error ? error.code : ''}</div>;
    };
    render(
      <AuthProvider>
        <LogoutCapture />
      </AuthProvider>
    );
    (signOut as unknown as { mockRejectedValueOnce: (v: unknown) => void }).mockRejectedValueOnce({ code: 'auth/network-request-failed' });
    // Call the API directly so we can assert the Promise rejection deterministically
    expect(doLogout).toBeTruthy();
    await expect(doLogout!()).rejects.toBeDefined();
    await waitFor(() => expect(screen.getByTestId('err').textContent).toBe('auth/network-request-failed'));
  });
});

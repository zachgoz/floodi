import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route } from 'react-router-dom';
import { vi } from 'vitest';
import { PrivateRoute } from 'src/components/routing/PrivateRoute';

vi.mock('src/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from 'src/contexts/AuthContext';

describe('PrivateRoute', () => {
  it('renders when unauthenticated for public route', () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: false, isAnonymous: false } as any);
    render(
      <MemoryRouter initialEntries={['/public']}>
        <PrivateRoute path="/public">
          <div>Public</div>
        </PrivateRoute>
      </MemoryRouter>
    );
    expect(screen.getByText('Public')).toBeInTheDocument();
  });

  it('redirects when unauthenticated and requireAuth=true', () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: false, isAnonymous: false } as any);
    render(
      <MemoryRouter initialEntries={['/profile']}>
        <PrivateRoute path="/profile" requireAuth>
          <div>Secret</div>
        </PrivateRoute>
        <Route path="/login">
          <div>Login</div>
        </Route>
      </MemoryRouter>
    );
    expect(screen.getByText('Login')).toBeInTheDocument();
  });

  it('renders when authenticated', () => {
    vi.mocked(useAuth).mockReturnValue({ user: { uid: '1' }, loading: false, isAnonymous: false } as any);
    render(
      <MemoryRouter initialEntries={['/profile']}>
        <PrivateRoute path="/profile" requireAuth>
          <div>Secret</div>
        </PrivateRoute>
      </MemoryRouter>
    );
    expect(screen.getByText('Secret')).toBeInTheDocument();
  });

  it('preserves redirect with path, query and hash', () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: false, isAnonymous: false } as any);
    const TestLogin = () => {
      return (
        <Route
          path="/login"
          render={({ location }) => (
            <div>Login {location.search}</div>
          )}
        />
      );
    };
    render(
      <MemoryRouter initialEntries={['/profile?a=1#x']}>
        <PrivateRoute path="/profile" requireAuth>
          <div>Secret</div>
        </PrivateRoute>
        <TestLogin />
      </MemoryRouter>
    );
    const expected = encodeURIComponent('/profile?a=1#x');
    expect(screen.getByText(new RegExp(`Login \\?redirect=${expected}`))).toBeInTheDocument();
  });

  it('renders a loading spinner when loading', () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: true, isAnonymous: false } as any);
    const { container } = render(
      <MemoryRouter initialEntries={['/profile']}>
        <PrivateRoute path="/profile" requireAuth>
          <div>Secret</div>
        </PrivateRoute>
      </MemoryRouter>
    );
    expect(container.querySelector('ion-spinner')).toBeTruthy();
  });

  it('honors a custom redirectTo prop', () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: false, isAnonymous: false } as any);
    const TestTarget = () => (
      <Route
        path="/welcome"
        render={({ location }) => <div>Welcome {location.search}</div>}
      />
    );
    render(
      <MemoryRouter initialEntries={['/profile']}>
        <PrivateRoute path="/profile" requireAuth redirectTo="/welcome">
          <div>Secret</div>
        </PrivateRoute>
        <TestTarget />
      </MemoryRouter>
    );
    const expected = encodeURIComponent('/profile');
    expect(screen.getByText(new RegExp(`Welcome \\?redirect=${expected}`))).toBeInTheDocument();
  });

  it('allows anonymous users for public routes', () => {
    vi.mocked(useAuth).mockReturnValue({ user: { uid: 'anon' }, loading: false, isAnonymous: true } as any);
    render(
      <MemoryRouter initialEntries={['/public']}>
        <PrivateRoute path="/public">
          <div>Public</div>
        </PrivateRoute>
      </MemoryRouter>
    );
    expect(screen.getByText('Public')).toBeInTheDocument();
  });
});

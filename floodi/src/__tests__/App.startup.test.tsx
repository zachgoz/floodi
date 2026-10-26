import React from 'react';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@ionic/react', () => ({
  IonApp: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  IonTabs: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  IonRouterOutlet: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  IonPage: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  IonContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  IonSpinner: () => <span>Account loading</span>,
  IonTabBar: () => null, IonIcon: () => null, IonLabel: () => null, IonTabButton: () => null,
  setupIonicReact: vi.fn(),
}));
vi.mock('@ionic/react-router', () => ({ IonReactRouter: ({ children }: React.PropsWithChildren) => <BrowserRouter>{children}</BrowserRouter> }));
vi.mock('src/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, userProfile: null, loading: true, isAnonymous: false }) }));
vi.mock('src/hooks/useUserPermissions', () => ({ useUserPermissions: () => ({ loading: true, isAdmin: () => false }) }));
vi.mock('src/pages/Tab2', () => ({ default: () => <div>Dashboard ready</div> }));
vi.mock('src/pages/Tab3', () => ({ default: () => null }));
vi.mock('src/pages/Intro', () => ({ default: () => <div>Intro ready</div> }));
vi.mock('src/pages/auth', () => ({ Login: () => null, Register: () => null, ResetPassword: () => null, Profile: () => <div>Account ready</div> }));
vi.mock('src/pages/PrivacyPolicy', () => ({ PrivacyPolicy: () => null }));
vi.mock('src/components/admin', () => ({ UserRoleManager: () => <div>Admin ready</div> }));
vi.mock('src/components/admin/SimpleAdminBootstrap', () => ({ SimpleAdminBootstrap: () => <div>Bootstrap ready</div> }));
vi.mock('src/components/onboarding/IntroTourOverlay', () => ({ INTRO_STORAGE_KEY: 'floodcast_intro_seen' }));
vi.mock('src/lib/analytics', () => ({ trackScreenView: vi.fn() }));
import App from 'src/App';

beforeEach(() => { localStorage.clear(); window.history.replaceState({}, '', '/'); });
afterEach(() => { localStorage.clear(); });

describe('public dashboard startup', () => {
  it('shows the returning visitor dashboard while account/profile work is still pending', () => {
    localStorage.setItem('floodcast_intro_seen', '1');
    render(<App />);
    expect(screen.getByText('Dashboard ready')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/tab2');
    expect(screen.queryByText('Account loading')).not.toBeInTheDocument();
  });

  it('shows the forecast immediately on a first visit while keeping the tour optional', () => {
    render(<App />);
    expect(screen.getByText('Dashboard ready')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/tab2');
    expect(screen.queryByText('Intro ready')).not.toBeInTheDocument();
  });

  it.each(['/profile', '/admin/users', '/admin/bootstrap'])('keeps account authorization gates active for %s', path => {
    window.history.replaceState({}, '', path);
    render(<App />);
    expect(screen.getByText('Account loading')).toBeInTheDocument();
    expect(screen.queryByText('Account ready')).not.toBeInTheDocument();
    expect(screen.queryByText('Admin ready')).not.toBeInTheDocument();
    expect(screen.queryByText('Bootstrap ready')).not.toBeInTheDocument();
  });
});

import React, { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CitizenStatusResponse, PublicAlertFeedDocument } from 'src/lib/citizenAlerts';

vi.mock('src/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('src/components/alerts/useCitizenAlerts', () => ({ useCitizenAlerts: () => hook }));
vi.mock('firebase/auth', () => ({ sendEmailVerification: vi.fn().mockResolvedValue(undefined) }));
vi.mock('src/lib/citizenAlerts', () => ({
  unsubscribeCitizenAlerts: vi.fn().mockResolvedValue(undefined),
  citizenPublicBaseUrl: () => 'https://demo-floodcast.web.app',
  citizenAlertChartUrl: (generatedAt?: string) =>
    `/api/alerts?chart=1&v=${encodeURIComponent(generatedAt ?? 'now')}`,
}));
vi.mock('@ionic/react', () => ({
  IonPage: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  IonHeader: ({ children }: React.PropsWithChildren) => <header>{children}</header>,
  IonContent: ({ children }: React.PropsWithChildren) => <main>{children}</main>,
  IonToolbar: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  IonTitle: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  IonIcon: () => null,
  IonButton: ({
    children,
    onClick,
    disabled,
    routerLink,
  }: React.PropsWithChildren<{ onClick?: () => void; disabled?: boolean; routerLink?: string }>) =>
    routerLink ? (
      <a href={routerLink}>{children}</a>
    ) : (
      <button disabled={disabled} onClick={onClick}>
        {children}
      </button>
    ),
}));

import { Alerts, UnsubscribeAlerts } from 'src/pages/Alerts';
import { sendEmailVerification } from 'firebase/auth';
import { unsubscribeCitizenAlerts } from 'src/lib/citizenAlerts';

const change = vi.fn();
const refresh = vi.fn();
const user = {
  uid: 'resident',
  email: 'resident@example.com',
  reload: vi.fn().mockResolvedValue(undefined),
  getIdToken: vi.fn().mockResolvedValue('token'),
};
const base = {
  version: 1,
  locationId: 'carolina-beach',
  deliveryReady: false,
  readinessReason: 'email-delivery-not-enabled',
  billingEnabled: false,
  consentVersion: 'citizen-email-v1',
  email: user.email,
  emailVerified: false,
  subscription: null,
  history: [],
} as CitizenStatusResponse;

let hook = {
  data: base,
  feed: null as PublicAlertFeedDocument | null,
  busy: false,
  error: null as string | null,
  refresh,
  change,
  user: null as typeof user | null,
  authLoading: false,
};

const subscription = (status: 'early-access' | 'active' | 'verification-required') =>
  ({
    status,
    email: user.email,
    emailVerified: status === 'active',
    coverage: 'carolina-beach-gauge',
    channel: 'email',
    consentVersion: 'citizen-email-v1',
    createdAt: '2026-10-17T12:00:00Z',
    updatedAt: '2026-10-17T12:00:00Z',
  } as const);

beforeEach(() => {
  vi.clearAllMocks();
  hook = {
    data: { ...base },
    feed: null,
    busy: false,
    error: null,
    refresh,
    change,
    user: null,
    authLoading: false,
  };
});
afterEach(() => cleanup());
const show = () =>
  render(
    <MemoryRouter>
      <Alerts />
    </MemoryRouter>
  );

describe('resident alert setup & Alerts 2.0 public advisories', () => {
  it('gives guests a clear account flow back to alerts without claiming delivery is active', () => {
    show();
    expect(screen.getByRole('link', { name: 'Create account' })).toHaveAttribute(
      'href',
      '/register?redirect=%2Falerts'
    );
    expect(screen.getByText('Early access')).toBeInTheDocument();
    expect(screen.queryByText('Alerts active')).not.toBeInTheDocument();
  });

  it('displays live 48-hour flood advisories, chart PNG, and deep links to unauthenticated guests without login', () => {
    hook.feed = {
      version: 2,
      locationId: 'carolina-beach',
      generatedAt: '2026-10-29T16:00:00Z',
      forecastGeneratedAt: '2026-10-29T16:00:00Z',
      thresholds: { minor: 5.6, moderate: 7.0, major: 7.7, extreme: 8.5 },
      currentSurgeFt: 0.72,
      nextPeakFt: 6.42,
      nextPeakAt: '2026-10-29T19:30:00Z',
      activeAdvisories: [
        {
          episodeId: 'ep-2026-10-29-pm',
          severity: 'minor',
          startAt: '2026-10-29T18:15:00Z',
          endAt: '2026-10-29T20:45:00Z',
          startClipped: false,
          endClipped: false,
          peakAt: '2026-10-29T19:30:00Z',
          peakFt: 6.42,
          aboveFloodStageFt: 0.82,
          tideFt: 5.5,
          surgeFt: 0.92,
          estimatedStreetDepthIn: 9.8,
          durationMinutes: 150,
          windSpeedMph: 22,
          windDirectionDeg: 38,
          windCompass: 'NE',
          precipWindowIn: 0.14,
          drivers: {
            oceanSurgeFt: 0.38,
            windSetupFt: 0.31,
            riverFlowFt: 0.14,
            rainfallRunoffFt: 0.03,
            estuarineHarmonicFt: 0.06,
          },
        },
      ],
      recentBulletins: [
        {
          id: 'b-1',
          episodeId: 'ep-2026-10-29-pm',
          category: 'imminent_warning',
          severity: 'minor',
          issuedAt: '2026-10-29T15:45:00Z',
          headline: 'Imminent Minor Flood Warning — 6.42 ft MLLW',
          summary: 'High water begins in ~2.5 hours along Canal Dr.',
          whatChanged: 'Forecast peak rose +0.34 ft with strengthening NE winds.',
          peakFt: 6.42,
          peakAt: '2026-10-29T19:30:00Z',
          startAt: '2026-10-29T18:15:00Z',
          endAt: '2026-10-29T20:45:00Z',
          durationMinutes: 150,
          estimatedStreetDepthIn: 9.8,
          windSpeedMph: 22,
          windCompass: 'NE',
          precipWindowIn: 0.14,
        },
      ],
    };

    show();
    expect(screen.getByText('6.42 ft MLLW')).toBeInTheDocument();
    expect(screen.getByText('2h 30m')).toBeInTheDocument();
    expect(screen.getByText('~9.8 in')).toBeInTheDocument();
    expect(screen.getByText(/NE 22 mph wind · 0\.14 in rain/)).toBeInTheDocument();
    expect(screen.getByText('Ocean Surge +0.38 ft')).toBeInTheDocument();
    expect(screen.getByText('N/NE Wind +0.31 ft')).toBeInTheDocument();
    expect(screen.getByText('Forecast peak rose +0.34 ft with strengthening NE winds.')).toBeInTheDocument();

    const chartLink = screen.getByRole('link', { name: /View Peak on Live Hydrograph/i });
    expect(chartLink).toHaveAttribute('href', '/tab2?t=2026-10-29T19%3A30%3A00Z');

    const img = screen.getByRole('img', {
      name: /48-hour Carolina Beach operational water-level forecast hydrograph/i,
    });
    expect(img).toHaveAttribute('src', '/api/alerts?chart=1&v=2026-10-29T16%3A00%3A00Z');
  });

  it('requires explicit consent before joining early access', async () => {
    hook.user = user;
    change.mockResolvedValue(base);
    show();
    const button = screen.getByRole('button', { name: 'Join early access' });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(button);
    await waitFor(() => expect(change).toHaveBeenCalledWith('enroll'));
  });

  it('renders accessible fieldset/legend preference checkboxes (without list wrappers) and saves customized categories', async () => {
    hook.user = user;
    hook.data = {
      ...base,
      emailVerified: true,
      deliveryReady: true,
      readinessReason: 'email-pilot-enabled',
      subscription: subscription('active'),
    };
    change.mockResolvedValue(hook.data);

    const { container } = show();

    // Verify modern-web-guidance accessibility: checkboxes grouped in <fieldset>/<legend>, never inside <ul>/<li>
    const fieldsets = container.querySelectorAll('fieldset.alerts-pref-fieldset');
    expect(fieldsets.length).toBe(2);
    const minorCheckbox = screen.getByLabelText('Minor Flood Alerts') as HTMLInputElement;
    expect(minorCheckbox.closest('ul')).toBeNull();
    expect(minorCheckbox).toHaveAttribute('aria-describedby', 'pref-sev-minor-desc');
    expect(minorCheckbox.checked).toBe(true);

    const allClearCheckbox = screen.getByLabelText('All-Clear Advisories') as HTMLInputElement;
    expect(allClearCheckbox.checked).toBe(false);

    // Uncheck Minor Flood Alerts and enable All-Clear Advisories
    fireEvent.click(minorCheckbox);
    fireEvent.click(allClearCheckbox);

    const saveBtn = screen.getByRole('button', { name: 'Save alert preferences' });
    fireEvent.click(saveBtn);

    await waitFor(() =>
      expect(change).toHaveBeenCalledWith('update_preferences', {
        severities: { minor: false, moderate: true, major: true, extreme: true },
        categories: {
          upcomingWatch: true,
          imminentWarning: true,
          forecastChange: true,
          allClear: true,
        },
      })
    );
  });

  it('sends verification only after the resident requests it, using the HTTPS continue URL', async () => {
    hook.user = user;
    show();
    expect(sendEmailVerification).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Send verification link' }));
    await waitFor(() =>
      expect(sendEmailVerification).toHaveBeenCalledWith(user, {
        url: 'https://demo-floodcast.web.app/alerts',
      })
    );
    expect(screen.getByRole('status')).toHaveTextContent('Verification link sent');
  });

  it('does not offer a test or active claim while the provider is disabled', () => {
    hook.user = user;
    hook.data = {
      ...base,
      emailVerified: true,
      subscription: { ...subscription('early-access'), emailVerified: true },
    };
    show();
    expect(screen.getByText(/Flood email delivery is not active yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send test email' })).not.toBeInTheDocument();
  });

  it('does not show an old account verification result or cooldown after switching accounts', async () => {
    let complete!: () => void;
    vi.mocked(sendEmailVerification).mockImplementationOnce(
      () => new Promise<void>(resolve => { complete = resolve; })
    );
    hook.user = user;
    const { rerender } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Send verification link' }));
    hook.user = { ...user, uid: 'another-resident', email: 'another@example.com' };
    hook.data = { ...base, email: hook.user.email };
    rerender(
      <MemoryRouter>
        <Alerts />
      </MemoryRouter>
    );
    await act(async () => {
      complete();
    });
    expect(screen.queryByText(/Verification link sent/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send verification link' })).not.toBeDisabled();
  });

  it('lets a verified pending resident explicitly finish setup when delivery becomes available', async () => {
    hook.user = user;
    hook.data = {
      ...base,
      emailVerified: true,
      deliveryReady: true,
      readinessReason: 'email-pilot-enabled',
      subscription: { ...subscription('verification-required'), emailVerified: true },
    };
    change.mockResolvedValue(hook.data);
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }));
    await waitFor(() => expect(change).toHaveBeenCalledWith('resume'));
  });

  it('shows real delivery acceptance instead of claiming inbox delivery', () => {
    hook.user = user;
    hook.data = {
      ...base,
      emailVerified: true,
      deliveryReady: true,
      readinessReason: 'email-pilot-enabled',
      subscription: subscription('active'),
      history: [
        {
          id: 'test',
          kind: 'test',
          state: 'sent',
          subject: 'Your test alert',
          createdAt: '2026-10-17T12:00:00Z',
          updatedAt: '2026-10-17T12:00:00Z',
        },
      ],
    };
    show();
    expect(screen.getByText('Accepted by email service')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause alerts' })).toBeInTheDocument();
  });

  it('preserves an unsubscribe capability through StrictMode and requires confirmation', async () => {
    (window as Window & { __floodcastUnsubscribeToken?: string }).__floodcastUnsubscribeToken =
      'a'.repeat(64);
    render(
      <StrictMode>
        <MemoryRouter>
          <UnsubscribeAlerts />
        </MemoryRouter>
      </StrictMode>
    );
    expect(unsubscribeCitizenAlerts).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe from email alerts' }));
    await act(async () => {});
    expect(unsubscribeCitizenAlerts).toHaveBeenCalledWith('a'.repeat(64));
    expect(screen.getByRole('heading', { name: 'Request processed' })).toBeInTheDocument();
  });
});

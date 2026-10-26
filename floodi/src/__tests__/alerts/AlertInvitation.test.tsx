import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CitizenStatusResponse } from 'src/lib/citizenAlerts';

const mocks = vi.hoisted(() => ({ read: vi.fn(), change: vi.fn() }));
vi.mock('src/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, loading: false, isAnonymous: false }) }));
vi.mock('src/lib/citizenAlerts', () => ({ readCitizenAlerts: mocks.read, changeCitizenAlerts: mocks.change }));
vi.mock('@ionic/react', () => ({ IonIcon: () => null }));
import { AlertInvitation } from 'src/components/alerts/AlertInvitation';

const readiness = (enabled: boolean): CitizenStatusResponse => ({
  version: 1, locationId: 'carolina-beach', deliveryReady: enabled,
  readinessReason: enabled ? 'email-pilot-enabled' : 'email-delivery-not-enabled', billingEnabled: false,
  consentVersion: 'citizen-email-v1', email: null, emailVerified: false, subscription: null, history: [],
});
const show = () => render(<MemoryRouter><AlertInvitation /></MemoryRouter>);
beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

describe('guest alert invitation readiness', () => {
  it('reads public readiness and offers operational alert setup when the pilot is enabled', async () => {
    mocks.read.mockResolvedValue(readiness(true));
    show();
    await waitFor(() => expect(screen.getByRole('link')).toHaveTextContent('Set up alerts'));
    expect(screen.getByRole('link')).toHaveAttribute('href', '/alerts');
    expect(screen.queryByText(/early access/i)).not.toBeInTheDocument();
    expect(mocks.read).toHaveBeenCalledWith(null, expect.any(AbortSignal));
    expect(mocks.change).not.toHaveBeenCalled();
  });

  it('offers early access only after disabled delivery is confirmed', async () => {
    mocks.read.mockResolvedValue(readiness(false));
    show();
    await waitFor(() => expect(screen.getByRole('link')).toHaveTextContent('Set up early access'));
    expect(mocks.change).not.toHaveBeenCalled();
  });

  it('keeps the invitation usable while readiness is pending without making an availability claim', async () => {
    let resolve!: (value: CitizenStatusResponse) => void;
    mocks.read.mockReturnValue(new Promise<CitizenStatusResponse>(done => { resolve = done; }));
    show();
    expect(screen.getByRole('link')).toHaveTextContent('View alert options');
    expect(screen.getByRole('link')).toHaveAttribute('href', '/alerts');
    expect(screen.queryByText(/early access/i)).not.toBeInTheDocument();
    await act(async () => { resolve(readiness(true)); });
    expect(screen.getByRole('link')).toHaveTextContent('Set up alerts');
  });

  it('uses neutral copy when the readiness service is unavailable', async () => {
    mocks.read.mockRejectedValue(new Error('Unavailable'));
    show();
    await act(async () => {});
    expect(screen.getByRole('link')).toHaveTextContent('View alert options');
    expect(screen.queryByText(/early access/i)).not.toBeInTheDocument();
  });
});

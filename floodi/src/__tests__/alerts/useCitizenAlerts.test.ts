import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
import type { CitizenStatusResponse } from 'src/lib/citizenAlerts';
import { useCitizenAlerts } from 'src/components/alerts/useCitizenAlerts';

const mocks = vi.hoisted(() => ({
  auth: { user: null as User | null, loading: false, isAnonymous: false },
  read: vi.fn(), change: vi.fn(),
}));
vi.mock('src/contexts/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('src/lib/citizenAlerts', () => ({ readCitizenAlerts: mocks.read, changeCitizenAlerts: mocks.change }));
const account = (uid: string) => ({ uid } as User);
const status = (email: string | null): CitizenStatusResponse => ({ version: 1, locationId: 'carolina-beach', deliveryReady: false,
  readinessReason: 'email-delivery-not-enabled', billingEnabled: false, consentVersion: 'citizen-email-v1',
  email, emailVerified: false, subscription: null, history: [] });
function pending<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => { vi.clearAllMocks(); mocks.auth.user = account('a'); mocks.read.mockResolvedValue(status('a@example.com')); });
afterEach(cleanup);

describe('alert preferences identity and request ownership', () => {
  it('never displays an old account response after an account switch', async () => {
    const first = pending<CitizenStatusResponse>(); const second = pending<CitizenStatusResponse>();
    mocks.read.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result, rerender } = renderHook(() => useCitizenAlerts());
    mocks.auth.user = account('b'); rerender();
    await act(async () => { first.resolve(status('a@example.com')); });
    expect(result.current.data).toBeNull();
    await act(async () => { second.resolve(status('b@example.com')); });
    expect(result.current.data?.email).toBe('b@example.com');
  });
  it('hides preferences immediately at sign-out and aborts the account read', async () => {
    const { result, rerender } = renderHook(() => useCitizenAlerts(false));
    await waitFor(() => expect(result.current.data?.email).toBe('a@example.com'));
    const signal = mocks.read.mock.calls[0][1] as AbortSignal;
    mocks.auth.user = null; rerender();
    expect(result.current.data).toBeNull(); expect(signal.aborted).toBe(true);
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });
  it('keeps controls busy through revalidation and prevents duplicate mutations', async () => {
    const update = pending<CitizenStatusResponse>(); const revalidation = pending<CitizenStatusResponse>();
    mocks.change.mockReturnValue(update.promise);
    const { result } = renderHook(() => useCitizenAlerts());
    await waitFor(() => expect(result.current.busy).toBe(false));
    mocks.read.mockReturnValue(revalidation.promise);
    let work!: Promise<CitizenStatusResponse | undefined>;
    act(() => { work = result.current.change('enroll'); void result.current.change('enroll'); });
    expect(mocks.change).toHaveBeenCalledTimes(1);
    act(() => { window.dispatchEvent(new Event('floodcast:alerts-updated')); });
    await act(async () => { update.resolve(status('a@example.com')); await work; });
    expect(result.current.busy).toBe(true);
    await act(async () => { revalidation.resolve(status('a@example.com')); });
    expect(result.current.busy).toBe(false);
  });
  it('does not return a previous account mutation as success to the new account UI', async () => {
    const update = pending<CitizenStatusResponse>(); mocks.change.mockReturnValue(update.promise);
    const { result, rerender } = renderHook(() => useCitizenAlerts());
    await waitFor(() => expect(result.current.busy).toBe(false));
    let work!: Promise<CitizenStatusResponse | undefined>;
    act(() => { work = result.current.change('enroll'); });
    mocks.auth.user = account('b'); mocks.read.mockResolvedValue(status('b@example.com')); rerender();
    let outcome: CitizenStatusResponse | undefined;
    await act(async () => { update.resolve(status('a@example.com')); outcome = await work; });
    expect(outcome).toBeUndefined(); expect(result.current.data?.email).toBe('b@example.com');
  });
});

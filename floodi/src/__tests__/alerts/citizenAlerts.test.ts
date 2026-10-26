import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeCitizenAlerts, isCitizenStatus, readCitizenAlerts, unsubscribeCitizenAlerts, citizenPublicBaseUrl } from 'src/lib/citizenAlerts';
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native } }));
let native = false;
const at = '2026-10-17T12:00:00Z';
export const statusFixture = {
  version: 1, locationId: 'carolina-beach', deliveryReady: false, readinessReason: 'email-delivery-not-enabled', billingEnabled: false,
  consentVersion: 'citizen-email-v1', email: 'resident@example.com', emailVerified: true, subscription: null, history: [],
};
const user = { getIdToken: vi.fn().mockResolvedValue('test-user-token') };
const send = vi.fn();
beforeEach(() => { native = false; vi.stubGlobal('fetch', send); vi.clearAllMocks(); send.mockResolvedValue({ ok: true, json: async () => statusFixture }); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('citizen alert API boundary', () => {
  it('times out even when Firebase token refresh never settles', async () => {
    vi.useFakeTimers();
    const work = readCitizenAlerts({ getIdToken: () => new Promise<string>(() => {}) });
    const failure = expect(work).rejects.toThrow('temporarily unavailable');
    await vi.advanceTimersByTimeAsync(15_000);
    await failure;
    expect(send).not.toHaveBeenCalled();
  });
  it('settles a pending token read when the caller aborts, without submitting a request', async () => {
    const controller = new AbortController();
    const work = readCitizenAlerts({ getIdToken: () => new Promise<string>(() => {}) }, controller.signal);
    const failure = expect(work).rejects.toThrow('temporarily unavailable');
    controller.abort(); await failure;
    expect(send).not.toHaveBeenCalled();
  });
  it('rejects an active claim without verified email and operational delivery', () => {
    const subscription = { status: 'active', email: 'resident@example.com', emailVerified: true, coverage: 'carolina-beach-gauge', channel: 'email', consentVersion: 'citizen-email-v1', createdAt: at, updatedAt: at };
    expect(isCitizenStatus({ ...statusFixture, subscription })).toBe(false);
    expect(isCitizenStatus({ ...statusFixture, deliveryReady: true, emailVerified: false, subscription })).toBe(false);
    expect(isCitizenStatus({ ...statusFixture, deliveryReady: true, readinessReason: 'email-pilot-enabled', subscription })).toBe(true);
  });
  it('reads guest readiness without an identity or credentials', async () => {
    await readCitizenAlerts(null);
    expect(send).toHaveBeenCalledWith('/api/alerts', expect.objectContaining({ method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', headers: {} }));
  });
  it('sends only the action and consent; email/eligibility stay server-owned', async () => {
    await changeCitizenAlerts(user, 'enroll');
    const [url, options] = send.mock.calls[0];
    expect(url).toBe('/api/alerts');
    expect(options.headers.Authorization).toBe('Bearer test-user-token');
    expect(JSON.parse(options.body)).toEqual({ action: 'enroll', consentVersion: 'citizen-email-v1' });
  });
  it('does not put an unsubscribe capability into request URL or auth headers', async () => {
    send.mockResolvedValue({ ok: true, json: async () => ({ unsubscribed: true }) });
    const token = 'a'.repeat(64);
    await unsubscribeCitizenAlerts(token);
    const [url, options] = send.mock.calls[0];
    expect(url).toBe('/api/alerts');
    expect(options.headers.Authorization).toBeUndefined();
    expect(JSON.parse(options.body)).toEqual({ action: 'unsubscribe', token });
  });
  it('does not accept malformed capabilities or HTML fallback as success', async () => {
    await expect(unsubscribeCitizenAlerts('short')).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    send.mockResolvedValue({ ok: true, json: async () => '<!doctype html>' });
    await expect(readCitizenAlerts(null)).rejects.toThrow('temporarily unavailable');
  });
  it('uses a configured HTTPS Hosting origin on native platforms', async () => {
    native = true;
    expect(citizenPublicBaseUrl()).toMatch(/^https:\/\/[a-z0-9-]+\.web\.app$/);
    await readCitizenAlerts(null);
    expect(send.mock.calls[0][0]).toMatch(/^https:\/\/[^/]+\.web\.app\/api\/alerts$/);
  });
});

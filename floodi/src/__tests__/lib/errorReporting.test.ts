import { afterEach, describe, expect, it, vi } from 'vitest';
import { createErrorReporter, installErrorReporting } from 'src/lib/errorReporting';

const origin = 'https://floodcastwebapp.web.app';
const secret = 'resident@example.com password=secret comment-body';
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function setup(overrides: Partial<Parameters<typeof createErrorReporter>[0]> = {}) {
  const send = vi.fn().mockResolvedValue({ status: 204 });
  const reporter = createErrorReporter({
    enabled: true, origin, route: () => '/tab2', online: () => true,
    buildId: 'a1234567', send, ...overrides,
  });
  return { reporter, send };
}
const payload = (send: ReturnType<typeof vi.fn>, index = 0) => JSON.parse(send.mock.calls[index][1].body);
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('privacy-safe frontend error collection', () => {
  it('retains only allowlisted diagnostic fields and sanitized same-origin frames', async () => {
    const { reporter, send } = setup();
    const error = Object.assign(new TypeError(secret), {
      code: 'permission-denied', uid: secret,
      stack: `TypeError: ${secret}\n    at ${secret} (${origin}/assets/index-a123.js:20:9)\n    at x (https://third-party.test/assets/vendor.js:7:9)\n    at x (${origin}/api/outlook?token=secret:1:1)\n    at x (${origin}/assets/app.js?token=secret:1:1)\n    at x (${origin}/profile:1:1)`,
    });
    reporter('react_render_error', error, { provider: 'app', status: 503 });
    await settle();
    expect(payload(send)).toEqual({
      version: 1, code: 'react_render_error', route: '/tab2', buildId: 'a1234567', provider: 'app',
      errorType: 'TypeError', firebaseCode: 'permission-denied', status: 503,
      frames: [{ asset: '/assets/index-a123.js', line: 20, column: 9 }],
    });
    expect(JSON.stringify(send.mock.calls)).not.toContain(secret);
    expect(send).toHaveBeenCalledWith('/api/client-errors', expect.objectContaining({
      credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true,
    }));
  });

  it('preserves the first safe frame in mobile Safari stacks that have no error header', async () => {
    const { reporter, send } = setup();
    reporter('runtime_error', { name: 'TypeError', stack: `privateFunction@${origin}/assets/index-abc123.js:9:11` });
    await settle();
    expect(payload(send).frames).toEqual([{ asset: '/assets/index-abc123.js', line: 9, column: 11 }]);
    expect(JSON.stringify(send.mock.calls)).not.toContain('privateFunction');
  });

  it('never sends arbitrary rejection strings, routes, codes or malformed stack locations', async () => {
    const { reporter, send } = setup({ route: () => `/profile/${secret}?token=secret`, buildId: secret });
    reporter('unhandled_rejection', secret, { provider: 'app' });
    await settle();
    expect(payload(send)).toEqual({ version: 1, code: 'unhandled_rejection', route: 'other', buildId: 'unknown', provider: 'app', errorType: 'UnknownError', frames: [] });
    expect(JSON.stringify(send.mock.calls)).not.toContain(secret);
  });

  it('does not invoke arbitrary error message accessors', async () => {
    const error = { get message(): string { throw new Error('must not read'); }, name: 'Error' };
    const { reporter, send } = setup();
    expect(() => reporter('runtime_error', error)).not.toThrow();
    await settle();
    expect(payload(send).errorType).toBe('Error');
  });

  it('deduplicates repeated failures, caps each tab session and persists only a numeric counter', async () => {
    let now = 1_000;
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) };
    const { reporter, send } = setup({ now: () => now, storage });
    for (let i = 0; i < 14; i++) {
      reporter('runtime_error', new Error(secret));
      await settle();
      reporter('runtime_error', new Error(secret));
      await settle();
      now += 5 * 60_000;
    }
    expect(send).toHaveBeenCalledTimes(10);
    expect([...data.values()]).toEqual(['10']);
    const next = setup({ storage });
    next.reporter('react_render_error');
    await settle();
    expect(next.send).not.toHaveBeenCalled();
  });

  it.each(['offline', 'disabled'] as const)('does not transmit or queue while %s', async scenario => {
    const { reporter, send } = setup(scenario === 'offline' ? { online: () => false } : { enabled: false });
    reporter('runtime_error', new Error(secret));
    await settle();
    expect(send).not.toHaveBeenCalled();
  });

  it('silently absorbs telemetry transport failures without recursion or retries', async () => {
    const send = vi.fn().mockRejectedValue(new Error(secret));
    const { reporter } = setup({ send });
    reporter('runtime_error', new Error(secret));
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('pauses subsequent reporting when the endpoint is rate limited', async () => {
    const send = vi.fn().mockResolvedValue({ status: 429 });
    const { reporter } = setup({ send });
    reporter('runtime_error');
    await settle();
    reporter('react_render_error');
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends native Capacitor errors to the configured HTTPS backend', async () => {
    vi.stubEnv('PROD', '1');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'floodcastwebapp');
    const nativeWindow = Object.assign(new EventTarget(), {
      location: { protocol: 'capacitor:', host: 'localhost', hostname: 'localhost', pathname: '/tab2' },
      navigator: { onLine: true },
      sessionStorage: { getItem: () => null, setItem: () => {} },
    });
    vi.stubGlobal('window', nativeWindow);
    const send = vi.fn().mockResolvedValue({ status: 204 });
    vi.stubGlobal('fetch', send);
    const cleanup = installErrorReporting();
    nativeWindow.dispatchEvent(new ErrorEvent('error', { error: new TypeError(secret) }));
    await settle();
    expect(send).toHaveBeenCalledWith('https://floodcastwebapp.web.app/api/client-errors', expect.objectContaining({ credentials: 'omit' }));
    cleanup();
  });

  it('collects global errors and unhandled rejections without wrapping console methods', async () => {
    vi.stubEnv('PROD', '1');
    const send = vi.fn().mockResolvedValue({ status: 204 });
    vi.stubGlobal('fetch', send);
    const consoleError = console.error;
    const remove = vi.spyOn(window, 'removeEventListener');
    const cleanup = installErrorReporting();
    window.dispatchEvent(new ErrorEvent('error', { error: new TypeError(secret) }));
    await settle();
    const event = new Event('unhandledrejection');
    Object.defineProperty(event, 'reason', { value: secret });
    window.dispatchEvent(event);
    await settle();
    expect(send).toHaveBeenCalledTimes(2);
    expect(payload(send).code).toBe('runtime_error');
    expect(payload(send, 1).code).toBe('unhandled_rejection');
    expect(console.error).toBe(consoleError);
    cleanup();
    expect(remove).toHaveBeenCalledWith('error', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('unhandledrejection', expect.any(Function));
  });
});

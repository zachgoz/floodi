import { afterEach, describe, expect, it, vi } from 'vitest';
import { onCLS, onINP, onLCP } from 'web-vitals';
import { createWebVitalsTelemetry, installWebVitalsTelemetry } from 'src/lib/webVitalsTelemetry';

vi.mock('web-vitals', () => ({ onCLS: vi.fn(), onINP: vi.fn(), onLCP: vi.fn() }));
const setup = (patch = {}) => {
  const saved = new Map<string, string>();
  const send = vi.fn().mockResolvedValue({ status: 204 });
  const options = { enabled: true, route: '/tab2', buildId: 'abc1234', online: () => true, epoch: () => 86_400_000, endpoint: '/api/client-errors', send, storage: { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) }, ...patch };
  return { options, saved, send, tracker: createWebVitalsTelemetry(options) };
};
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('privacy-safe Web Vitals collection', () => {
  it('sends measured scalars once, preserving missing interaction data instead of inventing zero', async () => {
    const { tracker, send } = setup();
    tracker.record('LCP', 3421.4); tracker.record('CLS', .1032345);
    tracker.flush(); tracker.flush(); await Promise.resolve();
    expect(send).toHaveBeenCalledOnce();
    const options = send.mock.calls[0][1];
    expect(options).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true, cache: 'no-store' });
    expect(JSON.parse(options.body)).toEqual({ version: 1, code: 'web_vitals', route: '/tab2', buildId: 'abc1234', scope: 'first-foreground', metrics: { lcpMs: 3421, cls: .10323 } });
  });

  it('rejects invalid measurements/private routes, unsampled visits and offline submissions', async () => {
    for (const patch of [{ enabled: false }, { route: '/profile?email=resident@example.com' }, { online: () => false }]) {
      const { tracker, send } = setup(patch); tracker.record('INP', 120); tracker.flush(); await Promise.resolve(); expect(send).not.toHaveBeenCalled();
    }
    const { tracker, send } = setup();
    tracker.record('LCP', Infinity); tracker.record('CLS', -1); tracker.record('INP', 300001); tracker.flush();
    await Promise.resolve(); expect(send).not.toHaveBeenCalled();
    tracker.record('INP', 128.8); tracker.flush(); await Promise.resolve();
    expect(JSON.parse(send.mock.calls[0][1].body).metrics).toEqual({ inpMs: 129 });
  });

  it('enforces a tab/day limit and does not retry failed collection', async () => {
    const limited = setup(); limited.saved.set('floodcast.web-vitals-budget.v1', '{"day":1,"count":3}');
    limited.tracker.record('CLS', 0); limited.tracker.flush(); await Promise.resolve(); expect(limited.send).not.toHaveBeenCalled();
    const failure = vi.fn().mockRejectedValue(new Error('offline'));
    const { tracker } = setup({ send: failure }); tracker.record('INP', 98); tracker.flush(); await Promise.resolve(); tracker.flush();
    expect(failure).toHaveBeenCalledOnce();
  });

  it('finalizes on first hidden, waits for library callbacks, and unregisters its own lifecycle listeners', async () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const { options, send } = setup();
    const remove = installWebVitalsTelemetry(options);
    await vi.waitFor(() => expect(onLCP).toHaveBeenCalledOnce());
    vi.mocked(onLCP).mock.calls[0][0]({ value: 2330, entries: [{ element: 'private DOM' }], id: 'private navigation' } as never);
    document.dispatchEvent(new Event('visibilitychange'));
    // Metrics finalized synchronously later in the same visibility event arrive
    // before the aggregate is flushed in its queued microtask.
    vi.mocked(onCLS).mock.calls[0][0]({ value: .04 } as never);
    vi.mocked(onINP).mock.calls[0][0]({ value: 180 } as never);
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(JSON.parse(send.mock.calls[0][1].body).metrics).toEqual({ lcpMs: 2330, cls: .04, inpMs: 180 });
    expect(send.mock.calls[0][1].body).not.toMatch(/private|entries|element|navigation|email|uid/);
    remove(); window.dispatchEvent(new Event('pagehide')); await Promise.resolve(); expect(send).toHaveBeenCalledOnce();
  });
});

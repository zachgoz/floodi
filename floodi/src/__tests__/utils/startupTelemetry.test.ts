import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStartupTelemetry, installStartupTelemetry } from 'src/lib/startupTelemetry';
const setup = (patch = {}) => {
  const saved = new Map<string, string>();
  const send = vi.fn().mockResolvedValue({ status: 204 });
  let time = 300;
  const tracker = createStartupTelemetry({ enabled: true, random: () => 0, route: () => '/tab2', buildId: 'abc1234', online: () => true, clock: () => time, epoch: () => 86_400_000, send, storage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }, browserTimings: () => ({ ttfbMs: 150, fcpMs: 220, cacheState: 'network' }), ...patch });
  return { tracker, send, saved, tick: (ms: number) => { time = ms; } };
};
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.sessionStorage.clear(); });
describe('sampled startup telemetry', () => {
  it('sends exactly one allowlisted aggregate using first paint-ready times', async () => {
    const { tracker, send, tick } = setup();
    tracker.mark('shellMs'); tick(1000); tracker.mark('chartMs'); tick(1100); tracker.mark('chartMs'); tracker.mark('outlookMs');
    tracker.flush(); tracker.flush(); await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
    const [url, options] = send.mock.calls[0];
    expect(url).toBe('/api/client-errors');
    expect(options).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', keepalive: true });
    expect(JSON.parse(options.body)).toEqual({ version: 1, code: 'page_load', route: '/tab2', buildId: 'abc1234', outcome: 'ready', cacheState: 'network', timings: { shellMs: 300, chartMs: 1000, outlookMs: 1100, ttfbMs: 150, fcpMs: 220 } });
  });
  it('samples, skips offline/private routes, and never retries failed reports', async () => {
    for (const patch of [{ enabled: false }, { random: () => .9 }, { online: () => false }, { route: () => '/profile/private?email=secret' }]) {
      const { tracker, send } = setup(patch); tracker.mark('shellMs'); tracker.flush(); await Promise.resolve(); expect(send).not.toHaveBeenCalled();
    }
    const failure = vi.fn().mockRejectedValue(new Error('no network'));
    const { tracker } = setup({ send: failure }); tracker.mark('shellMs'); tracker.flush(); await Promise.resolve(); tracker.flush(); expect(failure).toHaveBeenCalledTimes(1);
  });
  it('caps reports per tab/day, validates timing bounds and marks incomplete starts partial', async () => {
    const { tracker, send, saved } = setup();
    saved.set('floodcast.performance-budget.v1', JSON.stringify({ day: 1, count: 3 }));
    tracker.flush(); await Promise.resolve(); expect(send).not.toHaveBeenCalled();
    const other = setup(); other.tick(999999); other.tracker.mark('shellMs'); other.tracker.flush(); await Promise.resolve();
    expect(JSON.parse(other.send.mock.calls[0][1].body).outcome).toBe('partial');
    expect(JSON.parse(other.send.mock.calls[0][1].body).timings.shellMs).toBeUndefined();
    expect(JSON.stringify(other.send.mock.calls[0])).not.toMatch(/userAgent|uid|email|query|comment/);
  });
});

describe('startup readiness wiring', () => {
  it('waits for chart/outlook paint milestones, deduplicates, and removes listeners on cleanup', async () => {
    vi.useFakeTimers(); vi.stubEnv('PROD', true as unknown as string); vi.spyOn(Math, 'random').mockReturnValue(0);
    window.history.replaceState({}, '', '/tab2');
    const send = vi.fn().mockResolvedValue({ status: 204 }); vi.stubGlobal('fetch', send);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(100), 16));
    const remove = installStartupTelemetry();
    window.dispatchEvent(new Event('floodi:shell-ready'));
    window.dispatchEvent(new Event('floodi:chart-ready'));
    await vi.advanceTimersByTimeAsync(32); expect(send).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('floodi:outlook-ready'));
    await vi.advanceTimersByTimeAsync(32); expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0][1].body).outcome).toBe('ready');
    window.dispatchEvent(new Event('floodi:chart-ready'));
    await vi.advanceTimersByTimeAsync(30_000); expect(send).toHaveBeenCalledTimes(1);
    remove();
    const next = installStartupTelemetry(); next();
    window.dispatchEvent(new Event('floodi:chart-ready')); window.dispatchEvent(new Event('floodi:outlook-ready'));
    await vi.advanceTimersByTimeAsync(30_100); expect(send).toHaveBeenCalledTimes(1);
  });
  it('reports partial readiness at its deadline without inventing missing timings', async () => {
    vi.useFakeTimers(); vi.stubEnv('PROD', true as unknown as string); vi.spyOn(Math, 'random').mockReturnValue(0);
    window.history.replaceState({}, '', '/tab2');
    const send = vi.fn().mockResolvedValue({ status: 204 }); vi.stubGlobal('fetch', send);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(100), 16));
    const remove = installStartupTelemetry(); window.dispatchEvent(new Event('floodi:shell-ready'));
    await vi.advanceTimersByTimeAsync(30_000);
    const report = JSON.parse(send.mock.calls[0][1].body);
    expect(report.outcome).toBe('partial'); expect(report.timings.chartMs).toBeUndefined();
    remove();
  });
});

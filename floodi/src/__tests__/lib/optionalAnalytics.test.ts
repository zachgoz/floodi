import type { FirebaseApp } from 'firebase/app';
import { getAnalytics, isSupported } from 'firebase/analytics';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configuredMeasurementId, initializeOptionalAnalytics } from 'src/lib/optionalAnalytics';

vi.mock('firebase/analytics', () => ({ getAnalytics: vi.fn(), isSupported: vi.fn() }));
const app = (measurementId?: string) => ({ options: { measurementId } }) as FirebaseApp;
const measurementId = 'G-EXISTING123';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAnalytics).mockReset();
  vi.mocked(isSupported).mockResolvedValue(true);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllTimers(); vi.useRealTimers(); });

describe('optional Firebase Analytics initialization', () => {
  it.each([undefined, '', 'not-a-property', 'G-private@example.com'])('skips optional SDK network work for an absent/invalid local measurement ID: %s', async value => {
    expect(await initializeOptionalAnalytics(app(value))).toBeUndefined();
    expect(isSupported).not.toHaveBeenCalled();
    expect(getAnalytics).not.toHaveBeenCalled();
  });

  it('passes the existing configured measurement ID to the SDK so its config-fetch fallback is available', async () => {
    const configured = app(measurementId);
    const analytics = { app: configured } as ReturnType<typeof getAnalytics>;
    vi.mocked(getAnalytics).mockReturnValue(analytics);
    expect(await initializeOptionalAnalytics(configured)).toBe(analytics);
    expect(getAnalytics).toHaveBeenCalledWith(configured);
    expect(configured.options.measurementId).toBe(measurementId);
  });

  it('the installed SDK recovers a blocked config fetch through the configured property ID', async () => {
    vi.useFakeTimers();
    const { initializeApp, deleteApp } = await import('firebase/app');
    const actualAnalytics = await vi.importActual<typeof import('firebase/analytics')>('firebase/analytics');
    const configured = initializeApp({ apiKey: 'test-public-key', appId: '1:123456789:web:test', projectId: 'test-project', measurementId }, 'optional-analytics-blocked-fetch');
    const send = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', send);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(getAnalytics).mockImplementation(value => actualAnalytics.getAnalytics(value));
    const instance = await initializeOptionalAnalytics(configured);
    expect(instance?.app).toBe(configured);
    await vi.advanceTimersByTimeAsync(1);
    const events = (window as Window & { dataLayer?: ArrayLike<unknown>[] }).dataLayer || [];
    expect(events.some(event => event[0] === 'config' && event[1] === measurementId)).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    await deleteApp(configured);
  });

  it('does not initialize optional network work while offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(await initializeOptionalAnalytics(app(measurementId))).toBeUndefined();
    expect(isSupported).not.toHaveBeenCalled();
    expect(getAnalytics).not.toHaveBeenCalled();
  });

  it('gracefully skips unsupported storage/cookie environments', async () => {
    vi.mocked(isSupported).mockResolvedValue(false);
    expect(await initializeOptionalAnalytics(app(measurementId))).toBeUndefined();
    expect(getAnalytics).not.toHaveBeenCalled();
  });

  it('absorbs rejected environment checks without reporting optional Analytics as an app crash', async () => {
    vi.mocked(isSupported).mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await initializeOptionalAnalytics(app(measurementId))).toBeUndefined();
    expect(getAnalytics).not.toHaveBeenCalled();
  });

  it('absorbs synchronous SDK initialization failures', async () => {
    vi.mocked(getAnalytics).mockImplementation(() => { throw new Error('Unsupported environment'); });
    expect(await initializeOptionalAnalytics(app(measurementId))).toBeUndefined();
  });

  it('only accepts fixed-format property IDs and trims surrounding whitespace', () => {
    expect(configuredMeasurementId(` ${measurementId} `)).toBe(measurementId);
    expect(configuredMeasurementId(`https://example.com/${measurementId}`)).toBeUndefined();
  });
});

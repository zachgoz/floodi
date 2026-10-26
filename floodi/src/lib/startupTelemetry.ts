import { validateClientPerformanceReport, type ClientPerformanceReport } from '../../functions/src/telemetry/schema';
import { installWebVitalsTelemetry } from './webVitalsTelemetry';

type Timings = ClientPerformanceReport['timings'];
type Options = {
  enabled: boolean;
  route: () => string;
  buildId: string;
  online: () => boolean;
  send: typeof fetch;
  clock: () => number;
  epoch: () => number;
  random: () => number;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  endpoint?: string;
  browserTimings?: () => Partial<Timings> & { cacheState?: ClientPerformanceReport['cacheState'] };
};
const BUDGET_KEY = 'floodcast.performance-budget.v1';
export const STARTUP_SAMPLE_RATE = 0.25;

/** A sampled, one-shot aggregate. No URL parameters, identities, content or raw
 * performance entries cross this boundary. Error reporting has its own budget. */
export function createStartupTelemetry(options: Options) {
  const timings: Timings = {};
  const sampled = options.enabled && options.random() < STARTUP_SAMPLE_RATE;
  let sent = false;
  const mark = (key: 'shellMs' | 'chartMs' | 'outlookMs') => {
    const ms = options.clock();
    if (timings[key] === undefined && Number.isFinite(ms) && ms >= 0 && ms <= 300_000) timings[key] = Math.round(ms);
  };
  const flush = () => {
    if (sent || !sampled || !options.online()) return;
    const route = options.route();
    if (route !== '/' && route !== '/tab2') return;
    const day = Math.floor(options.epoch() / 86_400_000);
    let count = 0;
    try {
      const saved: unknown = JSON.parse(options.storage?.getItem(BUDGET_KEY) || 'null');
      if (saved && typeof saved === 'object' && 'day' in saved && 'count' in saved && saved.day === day && Number.isInteger(saved.count)) count = Number(saved.count);
    } catch { /* Storage is optional and never blocks the dashboard. */ }
    if (count >= 3) { sent = true; return; }
    let browser: ReturnType<NonNullable<Options['browserTimings']>> = {};
    try { browser = options.browserTimings?.() ?? {}; } catch { /* Unsupported browser timing API. */ }
    const measured: Timings = { ...timings };
    for (const key of ['ttfbMs', 'fcpMs'] as const) {
      const value = browser[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 300_000) measured[key] = Math.round(value);
    }
    if (!Object.keys(measured).length) return;
    const report: ClientPerformanceReport = {
      version: 1, code: 'page_load', route,
      buildId: /^(?:[a-f0-9]{7,64}|unknown)$/.test(options.buildId) ? options.buildId : 'unknown',
      outcome: measured.chartMs !== undefined && measured.outlookMs !== undefined ? 'ready' : 'partial',
      cacheState: browser.cacheState ?? 'unknown', timings: measured,
    };
    if (!validateClientPerformanceReport(report)) return;
    sent = true;
    try { options.storage?.setItem(BUDGET_KEY, JSON.stringify({ day, count: count + 1 })); } catch { /* Memory limit still applies. */ }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    void Promise.resolve().then(() => options.send(options.endpoint ?? '/api/client-errors', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', keepalive: true,
      signal: controller.signal, body: JSON.stringify(report),
    })).catch(() => {}).finally(() => clearTimeout(timer));
  };
  return { mark, flush, sampled, ready: () => timings.chartMs !== undefined && timings.outlookMs !== undefined };
}

let installed = false;
export function installStartupTelemetry(): () => void {
  if (installed || typeof window === 'undefined') return () => {};
  installed = true;
  let storage: Storage | undefined;
  try { storage = window.sessionStorage; } catch { /* Private browsing. */ }
  const native = ['capacitor:', 'ionic:'].includes(window.location.protocol) ||
    (window.location.hostname === 'localhost' && !!(window as Window & { Capacitor?: unknown }).Capacitor);
  const project = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  const endpoint = native && typeof project === 'string' && /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project)
    ? `https://${project}.web.app/api/client-errors` : '/api/client-errors';
  const reporter = createStartupTelemetry({
    enabled: import.meta.env.PROD === true, route: () => window.location.pathname,
    buildId: import.meta.env.VITE_APP_BUILD_ID ?? 'unknown',
    online: () => navigator.onLine !== false, send: (...args) => fetch(...args),
    clock: () => performance.now(), epoch: Date.now, random: Math.random, storage, endpoint,
    browserTimings: () => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      const paint = performance.getEntriesByName('first-contentful-paint')[0];
      const script = performance.getEntriesByType('resource').find(entry => {
        const url = new URL(entry.name);
        return url.origin === window.location.origin && /^\/assets\/index-[\w-]+\.js$/.test(url.pathname);
      }) as PerformanceResourceTiming | undefined;
      return {
        ...(nav ? { ttfbMs: nav.responseStart } : {}), ...(paint ? { fcpMs: paint.startTime } : {}),
        cacheState: script && script.decodedBodySize > 0 ? script.transferSize === 0 ? 'cached' : 'network' : 'unknown',
      };
    },
  });
  const removeWebVitals = installWebVitalsTelemetry({
    enabled: reporter.sampled, route: window.location.pathname, buildId: import.meta.env.VITE_APP_BUILD_ID ?? 'unknown',
    online: () => navigator.onLine !== false, epoch: Date.now, send: (...args) => fetch(...args), endpoint, storage,
  });
  // These are UI readiness events, not network completion marks. Two frames
  // allow the committed chart to paint before recording its ready time.
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const onMark = (key: 'shellMs' | 'chartMs' | 'outlookMs') => () => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      reporter.mark(key);
      if (reporter.ready()) reporter.flush();
    }));
  };
  const shell = onMark('shellMs'), chart = onMark('chartMs'), outlook = onMark('outlookMs');
  window.addEventListener('floodi:shell-ready', shell);
  window.addEventListener('floodi:chart-ready', chart);
  window.addEventListener('floodi:outlook-ready', outlook);
  const hidden = () => { if (document.visibilityState === 'hidden') reporter.flush(); };
  const deadline = setTimeout(reporter.flush, 30_000);
  timers.add(deadline);
  document.addEventListener('visibilitychange', hidden);
  window.addEventListener('pagehide', reporter.flush);
  return () => {
    installed = false;
    removeWebVitals();
    for (const timer of timers) clearTimeout(timer);
    window.removeEventListener('floodi:shell-ready', shell);
    window.removeEventListener('floodi:chart-ready', chart);
    window.removeEventListener('floodi:outlook-ready', outlook);
    document.removeEventListener('visibilitychange', hidden);
    window.removeEventListener('pagehide', reporter.flush);
  };
}

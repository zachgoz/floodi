import { validateClientWebVitalsReport, type ClientWebVitalsReport } from '../../functions/src/telemetry/schema';

type Options = {
  enabled: boolean;
  route: string;
  buildId: string;
  online: () => boolean;
  epoch: () => number;
  send: typeof fetch;
  endpoint: string;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
};
const BUDGET_KEY = 'floodcast.web-vitals-budget.v1';

/** Receives only scalar metric values, never the library's attribution entries. */
export function createWebVitalsTelemetry(options: Options) {
  const metrics: ClientWebVitalsReport['metrics'] = {};
  let sent = false;
  const record = (name: 'LCP' | 'INP' | 'CLS', value: number) => {
    const key = name === 'LCP' ? 'lcpMs' : name === 'INP' ? 'inpMs' : 'cls';
    if (sent || !Number.isFinite(value) || value < 0 || value > (key === 'cls' ? 100 : 300_000)) return;
    metrics[key] = key === 'cls' ? Math.round(value * 100_000) / 100_000 : Math.round(value);
  };
  const flush = () => {
    if (sent || !options.enabled || !options.online() || !['/', '/tab2'].includes(options.route)) return;
    const report = { version: 1, code: 'web_vitals', route: options.route, buildId: /^(?:[a-f0-9]{7,64}|unknown)$/.test(options.buildId) ? options.buildId : 'unknown', scope: 'first-foreground', metrics: { ...metrics } };
    if (!validateClientWebVitalsReport(report)) return;
    const day = Math.floor(options.epoch() / 86_400_000);
    let count = 0;
    try {
      const previous = JSON.parse(options.storage?.getItem(BUDGET_KEY) || 'null');
      if (previous?.day === day && Number.isInteger(previous.count) && previous.count >= 0) count = previous.count;
    } catch { /* Optional storage cannot block the dashboard. */ }
    sent = true;
    if (count >= 3) return;
    try { options.storage?.setItem(BUDGET_KEY, JSON.stringify({ day, count: count + 1 })); } catch { /* Memory still limits this page. */ }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    void Promise.resolve().then(() => options.send(options.endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', keepalive: true,
      signal: controller.signal, body: JSON.stringify(report),
    })).catch(() => {}).finally(() => clearTimeout(timeout));
  };
  return { record, flush };
}

/** Called only in the existing sampled production cohort. Buffered observers
 * permit deferring this small standard build until the load event. */
export function installWebVitalsTelemetry(options: Options): () => void {
  if (!options.enabled || !['/', '/tab2'].includes(options.route)) return () => {};
  const tracker = createWebVitalsTelemetry(options);
  let active = true;
  const hidden = () => {
    if (document.visibilityState === 'hidden') {
      // Let the library finalize its pending observer records in this event.
      queueMicrotask(() => { if (active) tracker.flush(); });
    }
  };
  const pagehide = () => queueMicrotask(() => { if (active) tracker.flush(); });
  const start = () => {
    void import('web-vitals').then(({ onLCP, onINP, onCLS }) => {
      if (!active) return;
      onLCP(({ value }) => { if (active) tracker.record('LCP', value); });
      onINP(({ value }) => { if (active) tracker.record('INP', value); });
      onCLS(({ value }) => { if (active) tracker.record('CLS', value); });
      document.addEventListener('visibilitychange', hidden);
      window.addEventListener('pagehide', pagehide);
    }).catch(() => { /* Unsupported/offline metrics never affect application use. */ });
  };
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
  return () => {
    active = false;
    window.removeEventListener('load', start);
    document.removeEventListener('visibilitychange', hidden);
    window.removeEventListener('pagehide', pagehide);
  };
}

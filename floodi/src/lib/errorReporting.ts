import {
  CLIENT_ERROR_CODES, CLIENT_ERROR_ROUTES, CLIENT_ERROR_TYPES, CLIENT_ERROR_PROVIDERS,
  CLIENT_FIREBASE_CODES, SAFE_ASSET_PATH, validateClientErrorReport,
  type ClientErrorCode, type ClientErrorFrame, type ClientErrorReport,
} from '../../functions/src/telemetry/schema';

const SESSION_LIMIT = 10;
const DEDUP_MS = 5 * 60_000;
const BUDGET_KEY = 'floodcast.error-budget.v1';
type ErrorContext = {
  provider?: ClientErrorReport['provider'];
  status?: number;
};
type ReporterOptions = {
  enabled: boolean;
  origin: string;
  endpoint?: string;
  buildId?: string;
  route: () => string;
  online: () => boolean;
  send: typeof fetch;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  now?: () => number;
};

/** Deliberately ignores message, cause, arbitrary fields and component names. */
function safeErrorDetails(error: unknown, origin: string): Pick<ClientErrorReport, 'errorType' | 'firebaseCode' | 'frames'> {
  let name: unknown;
  let code: unknown;
  let stack: unknown;
  try {
    if (error && typeof error === 'object') {
      const object = error as { name?: unknown; code?: unknown; stack?: unknown };
      name = object.name; code = object.code; stack = object.stack;
    }
  } catch { /* Untrusted custom accessors are never allowed to break the app. */ }
  const errorType = CLIENT_ERROR_TYPES.find(value => value === name) ?? 'UnknownError';
  const firebaseCode = CLIENT_FIREBASE_CODES.find(value => value === code);
  const frames: ClientErrorFrame[] = [];
  if (typeof stack === 'string') {
    // Only script URL locations are retained, never function names or text.
    // Safari can put the first useful frame on line one without an error header.
    for (const line of stack.slice(0, 16_384).split('\n').slice(0, 30)) {
      const match = line.match(/((?:https?:|capacitor:|ionic:)\/\/[^\s()]+):(\d+):(\d+)\)?$/);
      if (!match) continue;
      try {
        const url = new URL(match[1]);
        const assetOrigin = `${url.protocol}//${url.host}`;
        if (assetOrigin !== origin || url.search || url.hash || url.username || url.password || !SAFE_ASSET_PATH.test(url.pathname)) continue;
        const frame = { asset: url.pathname, line: Number(match[2]), column: Number(match[3]) };
        if (frame.line > 0 && frame.column > 0 && frame.line < 10_000_000 && frame.column < 10_000_000) frames.push(frame);
        if (frames.length === 5) break;
      } catch { /* Invalid or external stack locations carry no diagnostics. */ }
    }
  }
  return { errorType, frames, ...(firebaseCode ? { firebaseCode } : {}) };
}

export function createErrorReporter(options: ReporterOptions) {
  const now = options.now ?? Date.now;
  const seen = new Map<string, number>();
  let used = 0;
  let pausedUntil = 0;
  try {
    const saved = Number(options.storage?.getItem(BUDGET_KEY));
    if (Number.isInteger(saved) && saved >= 0) used = Math.min(saved, SESSION_LIMIT);
  } catch { /* Private browsing may disable sessionStorage. */ }
  return (code: ClientErrorCode, error?: unknown, context: ErrorContext = {}): void => {
    try {
      if (!options.enabled || !options.online() || used >= SESSION_LIMIT || now() < pausedUntil || !CLIENT_ERROR_CODES.includes(code)) return;
      const rawRoute = options.route();
      const report: ClientErrorReport = {
        version: 1, code,
        route: CLIENT_ERROR_ROUTES.find(route => route === rawRoute) ?? 'other',
        buildId: /^[a-f0-9]{7,64}$/.test(options.buildId ?? '') ? options.buildId! : 'unknown',
        provider: CLIENT_ERROR_PROVIDERS.find(provider => provider === context.provider) ?? 'app',
        ...safeErrorDetails(error, options.origin),
        ...(Number.isInteger(context.status) && context.status! >= 100 && context.status! <= 599 ? { status: context.status } : {}),
      };
      if (!validateClientErrorReport(report)) return;
      const fingerprint = JSON.stringify(report);
      if (now() - (seen.get(fingerprint) ?? -Infinity) < DEDUP_MS) return;
      seen.set(fingerprint, now());
      used += 1;
      try { options.storage?.setItem(BUDGET_KEY, String(used)); } catch { /* Memory budget remains active. */ }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      // Never queue/retry persisted reports. Offline or telemetry failures must
      // not generate more errors, leak referrers/cookies or affect the UI.
      void Promise.resolve().then(() => options.send(options.endpoint ?? '/api/client-errors', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
        keepalive: true, signal: controller.signal, body: fingerprint,
      })).then(response => {
        if (response.status === 429 || response.status === 503) pausedUntil = now() + 60_000;
      }).catch(() => {}).finally(() => { clearTimeout(timer); });
    } catch { /* Diagnostics are best-effort, including synchronous fetch errors. */ }
  };
}

let activeReporter: ReturnType<typeof createErrorReporter> | undefined;
export function reportClientError(code: ClientErrorCode, error?: unknown, context?: ErrorContext): void {
  activeReporter?.(code, error, context);
}

export function installErrorReporting(): () => void {
  if (activeReporter || typeof window === 'undefined') return () => {};
  let storage: Storage | undefined;
  try { storage = window.sessionStorage; } catch { /* Disabled browser storage. */ }
  const origin = `${window.location.protocol}//${window.location.host}`;
  const native = ['capacitor:', 'ionic:'].includes(window.location.protocol) ||
    (window.location.hostname === 'localhost' && !!(window as Window & { Capacitor?: unknown }).Capacitor);
  const project = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  const endpoint = native && typeof project === 'string' && /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project)
    ? `https://${project}.web.app/api/client-errors` : '/api/client-errors';
  activeReporter = createErrorReporter({
    enabled: import.meta.env.PROD === true,
    origin, endpoint, buildId: import.meta.env.VITE_APP_BUILD_ID,
    route: () => window.location.pathname,
    online: () => window.navigator.onLine !== false,
    send: (...args) => fetch(...args), storage,
  });
  const onError = (event: ErrorEvent) => {
    // Resource-load errors have no safe JS exception and are not captured.
    if (event.error) reportClientError('runtime_error', event.error);
  };
  const onRejection = (event: PromiseRejectionEvent) => reportClientError('unhandled_rejection', event.reason);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    activeReporter = undefined;
  };
}

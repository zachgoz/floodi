/** Allowlisted diagnostics only: never include exception text or request/user data. */
export const CLIENT_ERROR_CODES = [
  'runtime_error', 'unhandled_rejection', 'react_render_error',
  'outlook_http_fallback', 'outlook_unavailable', 'outlook_timeout',
  'water_data_unavailable', 'water_data_fallback',
  'comment_write_failed', 'comment_read_failed', 'comment_subscription_failed',
  'monitoring_probe', 'map_unavailable',
] as const;
export type ClientErrorCode = typeof CLIENT_ERROR_CODES[number];
export const CLIENT_ERROR_ROUTES = ['/', '/intro', '/login', '/register', '/reset-password', '/tab2', '/tab3', '/privacy', '/profile', '/admin/users', '/admin/bootstrap', 'other'] as const;
export const CLIENT_ERROR_PROVIDERS = ['app', 'outlook', 'firestore', 'noaa', 'fiman', 'comments'] as const;
export const CLIENT_ERROR_TYPES = ['Error', 'TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'URIError', 'EvalError', 'AbortError', 'UnknownError'] as const;
export const CLIENT_FIREBASE_CODES = ['permission-denied', 'unavailable', 'deadline-exceeded', 'resource-exhausted', 'failed-precondition', 'unauthenticated', 'not-found', 'unknown'] as const;
export const CLIENT_ERROR_MESSAGES: Record<ClientErrorCode, string> = {
  runtime_error: 'Frontend JavaScript error',
  unhandled_rejection: 'Frontend unhandled promise rejection',
  react_render_error: 'Frontend rendering failed',
  outlook_http_fallback: 'Forecast HTTP cache unavailable; using database fallback',
  outlook_unavailable: 'No current forecast cache could be loaded',
  outlook_timeout: 'Forecast cache read exceeded its deadline',
  water_data_unavailable: 'Water level data could not be loaded',
  water_data_fallback: 'Water level source fallback was required',
  comment_write_failed: 'Comment could not be saved',
  comment_read_failed: 'Saved comment could not be read',
  comment_subscription_failed: 'Comment updates are unavailable',
  monitoring_probe: 'Frontend error collection verification',
  map_unavailable: 'Optional flood map unavailable',
};
export interface ClientErrorFrame { asset: string; line: number; column: number }
export interface ClientErrorReport {
  version: 1;
  code: ClientErrorCode;
  route: typeof CLIENT_ERROR_ROUTES[number];
  buildId: string;
  provider: typeof CLIENT_ERROR_PROVIDERS[number];
  errorType: typeof CLIENT_ERROR_TYPES[number];
  firebaseCode?: typeof CLIENT_FIREBASE_CODES[number];
  status?: number;
  frames: ClientErrorFrame[];
}
export const SAFE_ASSET_PATH = /^\/assets\/[A-Za-z0-9_-]{1,120}\.js$/;
const keysAllowed = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
const oneOf = (value: unknown, list: readonly string[]): value is string => typeof value === 'string' && list.includes(value);
export function validateClientErrorReport(value: unknown): value is ClientErrorReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  return keysAllowed(p, ['version', 'code', 'route', 'buildId', 'provider', 'errorType', 'firebaseCode', 'status', 'frames']) &&
    p.version === 1 && oneOf(p.code, CLIENT_ERROR_CODES) && oneOf(p.route, CLIENT_ERROR_ROUTES) &&
    typeof p.buildId === 'string' && /^(?:[a-f0-9]{7,64}|unknown)$/.test(p.buildId) &&
    oneOf(p.provider, CLIENT_ERROR_PROVIDERS) && oneOf(p.errorType, CLIENT_ERROR_TYPES) &&
    (p.firebaseCode === undefined || oneOf(p.firebaseCode, CLIENT_FIREBASE_CODES)) &&
    (p.status === undefined || Number.isInteger(p.status) && Number(p.status) >= 100 && Number(p.status) <= 599) &&
    Array.isArray(p.frames) && p.frames.length <= 5 && p.frames.every(frame => {
      if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return false;
      const f = frame as Record<string, unknown>;
      return keysAllowed(f, ['asset', 'line', 'column']) && typeof f.asset === 'string' && SAFE_ASSET_PATH.test(f.asset) &&
        Number.isInteger(f.line) && Number(f.line) > 0 && Number(f.line) < 10_000_000 &&
        Number.isInteger(f.column) && Number(f.column) > 0 && Number(f.column) < 10_000_000;
    });
}

export const CLIENT_PERFORMANCE_TIMINGS = ['shellMs', 'chartMs', 'outlookMs', 'ttfbMs', 'fcpMs'] as const;
export interface ClientPerformanceReport {
  version: 1;
  code: 'page_load';
  route: '/' | '/tab2';
  buildId: string;
  outcome: 'ready' | 'partial';
  cacheState: 'cached' | 'network' | 'unknown';
  timings: Partial<Record<typeof CLIENT_PERFORMANCE_TIMINGS[number], number>>;
}
export interface ClientWebVitalsReport {
  version: 1;
  code: 'web_vitals';
  route: '/' | '/tab2';
  buildId: string;
  /** One aggregate when the first foreground period ends, not a visit ID. */
  scope: 'first-foreground';
  metrics: { lcpMs?: number; inpMs?: number; cls?: number };
}
export type ClientTelemetryReport = ClientErrorReport | ClientPerformanceReport | ClientWebVitalsReport;

/** No metric entries, DOM targets, URLs, navigation IDs or user identifiers. */
export function validateClientWebVitalsReport(value: unknown): value is ClientWebVitalsReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  if (!keysAllowed(p, ['version', 'code', 'route', 'buildId', 'scope', 'metrics']) ||
      p.version !== 1 || p.code !== 'web_vitals' || !oneOf(p.route, ['/', '/tab2']) || p.scope !== 'first-foreground' ||
      typeof p.buildId !== 'string' || !/^(?:[a-f0-9]{7,64}|unknown)$/.test(p.buildId) ||
      !p.metrics || typeof p.metrics !== 'object' || Array.isArray(p.metrics)) return false;
  const metrics = p.metrics as Record<string, unknown>;
  return Object.keys(metrics).length > 0 && keysAllowed(metrics, ['lcpMs', 'inpMs', 'cls']) &&
    Object.entries(metrics).every(([key, value]) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= (key === 'cls' ? 100 : 300_000));
}

/** Timing reports are distinct from exceptions and cannot carry messages,
 * identifiers, URLs, free-form stage names, or arbitrary numeric metadata. */
export function validateClientPerformanceReport(value: unknown): value is ClientPerformanceReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  if (!keysAllowed(p, ['version', 'code', 'route', 'buildId', 'outcome', 'cacheState', 'timings']) ||
      p.version !== 1 || p.code !== 'page_load' || !oneOf(p.route, ['/', '/tab2']) ||
      typeof p.buildId !== 'string' || !/^(?:[a-f0-9]{7,64}|unknown)$/.test(p.buildId) ||
      !oneOf(p.outcome, ['ready', 'partial']) || !oneOf(p.cacheState, ['cached', 'network', 'unknown']) ||
      !p.timings || typeof p.timings !== 'object' || Array.isArray(p.timings)) return false;
  const timings = p.timings as Record<string, unknown>;
  return Object.keys(timings).length > 0 && keysAllowed(timings, [...CLIENT_PERFORMANCE_TIMINGS]) &&
    Object.values(timings).every(duration => typeof duration === 'number' && Number.isFinite(duration) && duration >= 0 && duration <= 300_000);
}

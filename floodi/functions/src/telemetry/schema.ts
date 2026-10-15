/** Allowlisted diagnostics only: never include exception text or request/user data. */
export const CLIENT_ERROR_CODES = [
  'runtime_error', 'unhandled_rejection', 'react_render_error',
  'outlook_http_fallback', 'outlook_unavailable', 'outlook_timeout',
  'water_data_unavailable', 'water_data_fallback',
  'comment_write_failed', 'comment_read_failed', 'comment_subscription_failed',
  'monitoring_probe',
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

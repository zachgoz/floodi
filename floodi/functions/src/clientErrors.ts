import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { onRequest } from 'firebase-functions/v2/https';
import { createHash } from 'node:crypto';
import { CLIENT_ERROR_MESSAGES, validateClientErrorReport, validateClientPerformanceReport, type ClientTelemetryReport } from './telemetry/schema';

const MAX_BODY_BYTES = 8_192;
const GLOBAL_PER_MINUTE = 50;
const PERFORMANCE_PER_MINUTE = 10;
const INSTANCE_PER_MINUTE = 100;
const SOURCE_PER_MINUTE = 10;
export const CLIENT_ERROR_QUOTA_PATH = '_telemetryLimits/clientErrors';

/** One fixed document, never a document per visitor/error/IP. Old windows are
 * overwritten; denied requests do not write. Saturation is cached per instance. */
export function createClientErrorQuota(db: Pick<admin.firestore.Firestore, 'doc' | 'runTransaction'>) {
  let blockedUntil = 0;
  let blockedPerformanceUntil = 0;
  return async (now: number, isPerformance = false): Promise<boolean> => {
    if (now < blockedUntil || isPerformance && now < blockedPerformanceUntil) return false;
    const minute = Math.floor(now / 60_000);
    const result = await db.runTransaction(async transaction => {
      const ref = db.doc(CLIENT_ERROR_QUOTA_PATH);
      const snap = await transaction.get(ref);
      const value = snap.data();
      const count = value?.minute === minute && Number.isInteger(value?.count) && value.count >= 0 ? Number(value.count) : 0;
      const performanceCount = value?.minute === minute && Number.isInteger(value?.performanceCount) && value.performanceCount >= 0 ? Number(value.performanceCount) : 0;
      if (count >= GLOBAL_PER_MINUTE) return 'global-limit' as const;
      if (isPerformance && performanceCount >= PERFORMANCE_PER_MINUTE) return 'performance-limit' as const;
      transaction.set(ref, { minute, count: count + 1, performanceCount: performanceCount + (isPerformance ? 1 : 0) });
      return 'accepted' as const;
    }, { maxAttempts: 3 });
    if (result === 'global-limit') blockedUntil = (minute + 1) * 60_000;
    if (result === 'performance-limit') blockedPerformanceUntil = (minute + 1) * 60_000;
    return result === 'accepted';
  };
}

export function clientErrorAllowedOrigins(projectId: string | undefined, additional = ''): Set<string> {
  const origins = new Set(['capacitor://localhost', 'ionic://localhost', 'https://localhost', 'http://localhost']);
  if (projectId && /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId)) {
    origins.add(`https://${projectId}.web.app`);
    origins.add(`https://${projectId}.firebaseapp.com`);
  }
  for (const item of additional.split(',')) {
    try {
      const url = new URL(item.trim());
      if (url.protocol === 'https:' && url.origin === item.trim() && !url.username && !url.password) origins.add(url.origin);
    } catch { /* Invalid configuration does not expand the allowlist. */ }
  }
  return origins;
}

interface TelemetryRequest {
  method: string;
  get(name: string): string | undefined;
  body: unknown;
  rawBody?: Buffer;
  ip?: string;
}
interface TelemetryResponse {
  set(name: string, value: string): unknown;
  status(status: number): TelemetryResponse;
  send(value?: string): unknown;
}
interface HandlerDependencies {
  allowedOrigins: Set<string>;
  consume: (now: number, isPerformance?: boolean) => Promise<boolean>;
  log: (report: ClientTelemetryReport) => void;
  now?: () => number;
}

/** Injected boundaries let tests cover rejection/privacy without cloud access. */
export function createClientErrorHandler(dependencies: HandlerDependencies) {
  const now = dependencies.now ?? Date.now;
  let currentMinute = -1;
  const attempts = { error: 0, performance: 0 };
  // Separate bounded attempt budgets keep performance rejections from starving
  // error collection. Ephemeral hash maps: IP is never written to Firestore/application
  // logs. Infrastructure request logs retain the cloud provider's metadata.
  const sourceAttempts = { error: new Map<string, number>(), performance: new Map<string, number>() };
  return async (req: TelemetryRequest, res: TelemetryResponse): Promise<void> => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    const origin = req.get('Origin');
    if (!origin || !dependencies.allowedOrigins.has(origin)) { res.status(403).send(); return; }
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'POST');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      res.set('Access-Control-Max-Age', '3600');
      res.status(204).send(); return;
    }
    if (req.method !== 'POST') { res.set('Allow', 'POST'); res.status(405).send(); return; }
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.get('Content-Type') ?? '')) { res.status(415).send(); return; }
    const length = Number(req.get('Content-Length') ?? 0);
    if (length > MAX_BODY_BYTES || (req.rawBody?.byteLength ?? 0) > MAX_BODY_BYTES) { res.status(413).send(); return; }
    // Firebase normally parses JSON. The size recheck also protects test/custom
    // adapters, without ever logging an invalid body or its validation errors.
    let size: number;
    try { size = Buffer.byteLength(JSON.stringify(req.body), 'utf8'); } catch { res.status(400).send(); return; }
    if (size > MAX_BODY_BYTES) { res.status(413).send(); return; }
    if (!validateClientErrorReport(req.body) && !validateClientPerformanceReport(req.body)) { res.status(400).send(); return; }
    const report = req.body;
    const isPerformance = report.code === 'page_load';
    const category = isPerformance ? 'performance' : 'error';
    const timestamp = now();
    const minute = Math.floor(timestamp / 60_000);
    if (minute !== currentMinute) { currentMinute = minute; attempts.error = attempts.performance = 0; sourceAttempts.error.clear(); sourceAttempts.performance.clear(); }
    attempts[category] += 1;
    // Including the minute makes the short-lived digest unlinkable over time.
    const source = createHash('sha256').update(`${minute}:${req.ip ?? 'unknown'}`).digest('hex');
    const sources = sourceAttempts[category];
    const sourceCount = (sources.get(source) ?? 0) + 1;
    if (sources.size < INSTANCE_PER_MINUTE || sources.has(source)) sources.set(source, sourceCount);
    if (attempts[category] > INSTANCE_PER_MINUTE || sourceCount > SOURCE_PER_MINUTE) { res.set('Retry-After', '60'); res.status(429).send(); return; }
    try {
      if (!await dependencies.consume(timestamp, isPerformance)) { res.set('Retry-After', '60'); res.status(429).send(); return; }
      // No request, exception object, header, user agent or identity is passed.
      dependencies.log(report);
      res.status(204).send();
    } catch {
      // Fail closed: a database/logging outage must not create recursive logs or
      // bypass the durable quota. The browser never retries telemetry requests.
      res.set('Retry-After', '60'); res.status(503).send();
    }
  };
}

let handler: ReturnType<typeof createClientErrorHandler> | undefined;
export const collectClientErrors = onRequest({
  cors: false, maxInstances: 2, concurrency: 20, timeoutSeconds: 15, memory: '256MiB',
}, async (req, res) => {
  if (!handler) {
    if (!admin.apps.length) admin.initializeApp();
    handler = createClientErrorHandler({
      allowedOrigins: clientErrorAllowedOrigins(process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT, process.env.CLIENT_ERROR_ALLOWED_ORIGINS),
      consume: createClientErrorQuota(admin.firestore()),
      log: report => {
        if (report.code === 'page_load') { logger.info('Frontend page load timing', { event: 'frontend_performance', client: report }); return; }
        const severe = ['runtime_error', 'unhandled_rejection', 'react_render_error'].includes(report.code);
        const diagnostic = { event: 'frontend_error', client: report };
        if (report.code === 'monitoring_probe') logger.info(CLIENT_ERROR_MESSAGES[report.code], diagnostic);
        else if (severe) logger.error(CLIENT_ERROR_MESSAGES[report.code], diagnostic);
        else logger.warn(CLIENT_ERROR_MESSAGES[report.code], diagnostic);
      },
    });
  }
  await handler(req, res);
});

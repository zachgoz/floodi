import { CitizenAccount, CitizenActionRequest, CitizenStatusResponse, DeliveryConfiguration } from './types';
import { CitizenRequestError, guestCitizenStatus, parseCitizenAction } from './service';

interface CitizenHttpRequest { method: string; get(name: string): string | undefined; rawBody?: Buffer; body: unknown }
interface CitizenHttpResponse {
  set(name: string, value: string): unknown;
  status(code: number): CitizenHttpResponse;
  json(value: unknown): unknown;
  send(): unknown;
}
export interface CitizenHttpDependencies {
  configuration(): DeliveryConfiguration;
  allowedOrigins(): Set<string>;
  /** Must verify the Firebase token (including revocation), then read current
   * Admin Auth email/verification. Never use client profile/entitlement fields. */
  authenticate(token: string): Promise<CitizenAccount>;
  status(account: CitizenAccount, configuration: DeliveryConfiguration): Promise<CitizenStatusResponse>;
  action(account: CitizenAccount, configuration: DeliveryConfiguration, request: CitizenActionRequest): Promise<void>;
  unsubscribe(token: string): Promise<void>;
  logFailure(): void;
  now?: () => number;
}

export function isCitizenAuthenticationFailure(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  return typeof code === 'string' && ['auth/argument-error', 'auth/invalid-argument', 'auth/invalid-id-token', 'auth/id-token-expired', 'auth/id-token-revoked', 'auth/user-disabled', 'auth/user-not-found'].includes(code);
}

/** Explicit boundaries allow auth, opt-out and privacy behavior to be tested
 * without production credentials, a running Auth emulator or provider effects. */
export function createCitizenHttpHandler(dependencies: CitizenHttpDependencies) {
  let minute = -1;
  let requests = 0;
  return async (req: CitizenHttpRequest, res: CitizenHttpResponse): Promise<void> => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    const origin = req.get('Origin');
    if (origin && !dependencies.allowedOrigins().has(origin)) { res.status(403).json({ error: 'origin-not-allowed' }); return; }
    if (origin) { res.set('Access-Control-Allow-Origin', origin); res.set('Vary', 'Origin'); }
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'GET, POST');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.set('Access-Control-Max-Age', '3600');
      res.status(204).send(); return;
    }
    if (!['GET', 'POST'].includes(req.method)) { res.set('Allow', 'GET, POST'); res.status(405).json({ error: 'method-not-allowed' }); return; }
    const nowMinute = Math.floor((dependencies.now ?? Date.now)() / 60_000);
    if (nowMinute !== minute) { minute = nowMinute; requests = 0; }
    if (++requests > 300) { res.status(429).json({ error: 'please-wait' }); return; }
    if ((req.rawBody?.byteLength ?? 0) > 4096 || Number(req.get('Content-Length') ?? 0) > 4096) { res.status(413).json({ error: 'request-too-large' }); return; }
    if (req.method === 'POST' && !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.get('Content-Type') ?? '')) { res.status(415).json({ error: 'json-required' }); return; }
    try {
      const configuration = dependencies.configuration();
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body as Record<string, unknown> : null;
      if (req.method === 'POST' && body?.action === 'unsubscribe' && 'token' in body) {
        if (Object.keys(body).some(key => !['action', 'token'].includes(key)) || typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token)) throw new CitizenRequestError(400, 'invalid-unsubscribe-token');
        await dependencies.unsubscribe(body.token);
        res.status(200).json({ unsubscribed: true }); return;
      }
      const authorization = req.get('Authorization');
      if (!authorization && req.method === 'GET') { res.status(200).json(guestCitizenStatus(configuration)); return; }
      if (!authorization?.startsWith('Bearer ') || authorization.length > 8192) throw new CitizenRequestError(401, 'sign-in-required');
      let current: CitizenAccount;
      try {
        current = await dependencies.authenticate(authorization.slice(7));
        if (current.disabled) throw new Error('disabled');
      } catch (error) {
        if (error instanceof CitizenRequestError && error.status >= 500) throw error;
        throw new CitizenRequestError(401, 'sign-in-required');
      }
      if (req.method === 'POST') {
        const action = parseCitizenAction(req.body);
        if (!action) throw new CitizenRequestError(400, 'invalid-request');
        await dependencies.action(current, configuration, action);
      }
      res.status(200).json(await dependencies.status(current, configuration));
    } catch (error) {
      if (error instanceof CitizenRequestError) {
        if (error.status >= 500) dependencies.logFailure();
        res.status(error.status).json({ error: error.code }); return;
      }
      dependencies.logFailure();
      res.status(503).json({ error: 'alerts-unavailable' });
    }
  };
}

import fetch, { RequestInit } from 'node-fetch';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { createHash } from 'node:crypto';
import { safeError } from './observability';

type CacheRecord = { expiresAt: number; data: any };
const memory = new Map<string, CacheRecord>();
const pending = new Map<string, Promise<any>>();
const cooldown = new Map<string, number>();
export interface ProviderRequestOptions {
  provider: string;
  cacheMs?: number;
  timeoutMs?: number;
  headers?: RequestInit['headers'];
  sharedCache?: boolean;
}
export class ProviderError extends Error {
  constructor(message: string, public status?: number, public code?: string) { super(message); this.name = 'ProviderError'; }
}
export function retryDelayMs(retryAfter: string | null | undefined, attempt: number, now = Date.now()): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - now;
    if (Number.isFinite(ms) && ms >= 0) return ms;
  }
  return Math.min(4000, 500 * 2 ** attempt);
}
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function cacheDb() { return admin.apps.length ? admin.firestore() : null; }
function validateProviderData(data: any, provider: string): void {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ProviderError(`${provider} returned an invalid JSON response`, undefined, 'API_RESPONSE_INVALID');
  if (data.error) {
    const reason = typeof data.error?.message === 'string' ? data.error.message : typeof data.reason === 'string' ? data.reason : 'API response error';
    throw new ProviderError(`${provider}: ${safeError(new Error(reason)).message}`, undefined, 'API_RESPONSE_ERROR');
  }
}

/** Exact-request caching is shared across scheduled instances. Expired responses
 * are never relabeled as fresh; 429 cool-downs apply across provider URLs. */
export async function providerJson(url: string, options: ProviderRequestOptions): Promise<any> {
  const key = createHash('sha256').update(url).digest('hex');
  const cached = memory.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const running = pending.get(key);
  if (running) return running;
  const request = (async () => {
    const db = options.sharedCache === false ? null : cacheDb();
    const ref = db?.doc(`provider_cache/${key}`);
    const cooldownRef = db?.doc(`provider_cache/cooldown_${options.provider}`);
    if (ref) try {
      const [snapshot, gate] = await Promise.all([ref.get(), cooldownRef!.get()]);
      const shared = snapshot.data();
      const until = gate.data()?.until;
      if (typeof until === 'number' && until > Date.now()) cooldown.set(options.provider, Math.max(cooldown.get(options.provider) || 0, until));
      if (shared && typeof shared.expiresAt === 'number' && Number.isFinite(shared.expiresAt) && shared.expiresAt > Date.now()) {
        // GeoJSON geometry coordinates contain nested arrays, which Firestore
        // cannot encode as entities. Keep provider JSON opaque at rest while
        // retaining compatibility with earlier flat-object cache documents.
        const data = typeof shared.payloadJson === 'string' ? JSON.parse(shared.payloadJson) : shared.data;
        validateProviderData(data, options.provider);
        memory.set(key, { data, expiresAt: shared.expiresAt });
        return data;
      }
    } catch (error) { logger.warn('Provider cache read unavailable', { event: 'provider_cache_failed', provider: options.provider, operation: 'read', error: safeError(error) }); }
    if ((cooldown.get(options.provider) || 0) > Date.now()) throw new ProviderError(`${options.provider} is in rate-limit cooldown`, 429, 'RATE_LIMIT_COOLDOWN');
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(url, { headers: options.headers, timeout: options.timeoutMs ?? 30_000, size: 4_000_000 });
        if (!response.ok) {
          const transient = response.status === 429 || response.status === 408 || response.status >= 500;
          const wait = retryDelayMs(response.headers?.get('retry-after'), attempt);
          if (response.status === 429) {
            const until = Math.max(cooldown.get(options.provider) || 0, Date.now() + Math.max(60_000, Math.min(wait, 24 * 3600_000)));
            cooldown.set(options.provider, until);
            if (cooldownRef && db) try {
              // Separate scheduled jobs can receive different Retry-After
              // values concurrently. A later short limit must never erase a
              // longer limit already established by another request/instance.
              const sharedUntil = await db.runTransaction(async transaction => {
                const snapshot = await transaction.get(cooldownRef);
                const previous = snapshot.data()?.until;
                const next = Math.max(until, typeof previous === 'number' && Number.isFinite(previous) ? previous : 0);
                transaction.set(cooldownRef, { until: next, provider: options.provider, lastUpdated: new Date().toISOString() });
                return next;
              }, { maxAttempts: 3 });
              cooldown.set(options.provider, Math.max(cooldown.get(options.provider) || 0, sharedUntil));
            }
            catch (error) { logger.warn('Provider cooldown write unavailable', { event: 'provider_cache_failed', provider: options.provider, operation: 'cooldown', error: safeError(error) }); }
            // Do not amplify provider rate limits with immediate retries.
            throw new ProviderError(`${options.provider} HTTP ${response.status}`, response.status);
          }
          if (transient && attempt === 0 && wait <= 4000) { await delay(wait); continue; }
          throw new ProviderError(`${options.provider} HTTP ${response.status}`, response.status);
        }
        const data = await response.json();
        validateProviderData(data, options.provider);
        const cache = { data, expiresAt: Date.now() + (options.cacheMs ?? 5 * 60_000) };
        memory.set(key, cache);
        if (memory.size > 128) memory.delete(memory.keys().next().value!);
        const payloadJson = JSON.stringify(data);
        if (ref && Buffer.byteLength(payloadJson, 'utf8') < 700_000) try { await ref.set({ version: 1, payloadJson, expiresAt: cache.expiresAt, provider: options.provider, updatedAt: new Date().toISOString(), deleteAfter: new Date(cache.expiresAt + 86400_000) }); }
        catch (error) { logger.warn('Provider cache write unavailable', { event: 'provider_cache_failed', provider: options.provider, operation: 'write', error: safeError(error) }); }
        return data;
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        const type = error && typeof error === 'object' && 'type' in error ? String(error.type) : '';
        if (!(error instanceof ProviderError) && attempt === 0 && (['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED'].includes(code) || ['request-timeout', 'body-timeout'].includes(type))) { await delay(500); continue; }
        logger.warn('Provider request failed', { event: 'provider_request_failed', provider: options.provider, error: safeError(error), attempt: attempt + 1 });
        throw error;
      }
    }
    throw new ProviderError(`${options.provider} unavailable`);
  })();
  pending.set(key, request);
  try { return await request; } finally { pending.delete(key); }
}

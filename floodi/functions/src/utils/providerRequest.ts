import fetch, { RequestInit } from 'node-fetch';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { createHash } from 'node:crypto';
import { safeError } from './observability';

type CacheRecord = { expiresAt: number; data: any };
const memory = new Map<string, CacheRecord>();
const pending = new Map<string, Promise<any>>();
type RateLimitState = { until: number; streak: number; sequence: number };
const rateLimits = new Map<string, RateLimitState>();
const emptyRateLimit = (): RateLimitState => ({ until: 0, streak: 0, sequence: 0 });
type RateLimitDiagnostics = { retryAfterMs: number | null; cooldownMs: number; cooldownUntil: string; streak: number; source: 'retry-after' | 'adaptive' };
export interface ProviderRequestOptions {
  provider: string;
  cacheMs?: number;
  timeoutMs?: number;
  headers?: RequestInit['headers'];
  sharedCache?: boolean;
}
export class ProviderError extends Error {
  rateLimit?: RateLimitDiagnostics;
  constructor(message: string, public status?: number, public code?: string) { super(message); this.name = 'ProviderError'; }
}
export function parseRetryAfterMs(retryAfter: string | null | undefined, now = Date.now()): number | null {
  if (!retryAfter || !retryAfter.trim()) return null;
  const value = retryAfter.trim();
  if (/^\d+(?:\.\d+)?$/.test(value)) {
    const ms = Number(value) * 1000;
    return Number.isFinite(ms) ? ms : null;
  }
  if (!/[A-Za-z]{3}/.test(value) || !/\d{2}:\d{2}:\d{2}/.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : null;
}
export function retryDelayMs(retryAfter: string | null | undefined, attempt: number, now = Date.now()): number {
  return parseRetryAfterMs(retryAfter, now) ?? Math.min(4000, 500 * 2 ** attempt);
}
function normalizeRateLimit(value: unknown): RateLimitState {
  const state = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    until: typeof state.until === 'number' && Number.isFinite(state.until) ? Math.max(0, state.until) : 0,
    streak: typeof state.streak === 'number' && Number.isSafeInteger(state.streak) && state.streak > 0 ? Math.min(100_000, state.streak) : 0,
    sequence: typeof state.sequence === 'number' && Number.isSafeInteger(state.sequence) && state.sequence > 0 ? state.sequence : 0,
  };
}
function rememberRateLimit(provider: string, incoming: RateLimitState): RateLimitState {
  const previous = rateLimits.get(provider) || emptyRateLimit();
  const latest = incoming.sequence >= previous.sequence ? incoming : previous;
  const merged = { ...latest, until: Math.max(previous.until, incoming.until) };
  rateLimits.set(provider, merged);
  return merged;
}
function nextRateLimit(previous: RateLimitState, retryAfterMs: number | null, now: number): RateLimitState {
  const streak = Math.min(100_000, previous.streak + 1);
  const delayMs = retryAfterMs ?? 15 * 60_000 * 2 ** Math.min(2, streak - 1);
  return {
    until: Math.max(previous.until, now + Math.max(60_000, Math.min(delayMs, 24 * 3600_000))),
    streak,
    sequence: previous.sequence + 1,
  };
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
      rememberRateLimit(options.provider, normalizeRateLimit(gate.data()));
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
    if ((rateLimits.get(options.provider)?.until || 0) > Date.now()) throw new ProviderError(`${options.provider} is in rate-limit cooldown`, 429, 'RATE_LIMIT_COOLDOWN');
    const observedRateLimit = { ...(rateLimits.get(options.provider) || emptyRateLimit()) };
    const requestStartedAt = Date.now();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(url, { headers: options.headers, timeout: options.timeoutMs ?? 30_000, size: 4_000_000 });
        if (!response.ok) {
          const transient = response.status === 429 || response.status === 408 || response.status >= 500;
          const wait = retryDelayMs(response.headers?.get('retry-after'), attempt);
          if (response.status === 429) {
            const limitedAt = Date.now();
            const retryAfterMs = parseRetryAfterMs(response.headers?.get('retry-after'), limitedAt);
            let state = rememberRateLimit(options.provider, nextRateLimit(rateLimits.get(options.provider) || emptyRateLimit(), retryAfterMs, limitedAt));
            if (cooldownRef && db) try {
              // Count only actual outbound 429s. A transaction keeps both the
              // adaptive streak and longest gate consistent across job instances.
              const sharedState = await db.runTransaction(async transaction => {
                const snapshot = await transaction.get(cooldownRef);
                const next = nextRateLimit(normalizeRateLimit(snapshot.data()), retryAfterMs, limitedAt);
                transaction.set(cooldownRef, { ...next, provider: options.provider, lastUpdated: new Date().toISOString() });
                return next;
              }, { maxAttempts: 3 });
              state = rememberRateLimit(options.provider, sharedState);
            }
            catch (error) { logger.warn('Provider cooldown write unavailable', { event: 'provider_cache_failed', provider: options.provider, operation: 'cooldown', error: safeError(error) }); }
            const error = new ProviderError(`${options.provider} HTTP ${response.status}`, response.status);
            error.rateLimit = { retryAfterMs, cooldownMs: Math.max(0, state.until - limitedAt), cooldownUntil: new Date(state.until).toISOString(), streak: state.streak, source: retryAfterMs === null ? 'adaptive' : 'retry-after' };
            // Do not amplify provider rate limits with immediate retries.
            throw error;
          }
          if (transient && attempt === 0 && wait <= 4000) { await delay(wait); continue; }
          throw new ProviderError(`${options.provider} HTTP ${response.status}`, response.status);
        }
        const data = await response.json();
        validateProviderData(data, options.provider);
        // Only a fresh upstream success can reset a streak. Cached data does
        // not prove provider recovery. Sequence checks protect a newer 429 from
        // a successful request that was already in flight when it occurred.
        if (observedRateLimit.streak > 0) {
          if (cooldownRef && db) try {
            const recovered = await db.runTransaction(async transaction => {
              const snapshot = await transaction.get(cooldownRef);
              const current = normalizeRateLimit(snapshot.data());
              if (current.sequence !== observedRateLimit.sequence || current.until > requestStartedAt) return current;
              const next = { ...current, streak: 0, sequence: current.sequence + 1 };
              transaction.set(cooldownRef, { ...next, provider: options.provider, lastUpdated: new Date().toISOString() });
              return next;
            }, { maxAttempts: 3 });
            rememberRateLimit(options.provider, recovered);
          } catch (error) { logger.warn('Provider recovery state unavailable', { event: 'provider_cache_failed', provider: options.provider, operation: 'recovery', error: safeError(error) }); }
          else {
            const current = rateLimits.get(options.provider) || emptyRateLimit();
            if (current.sequence === observedRateLimit.sequence && current.until <= requestStartedAt) rememberRateLimit(options.provider, { ...current, streak: 0, sequence: current.sequence + 1 });
          }
        }
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
        logger.warn('Provider request failed', { event: 'provider_request_failed', provider: options.provider, error: safeError(error), attempt: attempt + 1, ...(error instanceof ProviderError && error.rateLimit ? { rateLimit: error.rateLimit } : {}) });
        throw error;
      }
    }
    throw new ProviderError(`${options.provider} unavailable`);
  })();
  pending.set(key, request);
  try { return await request; } finally { pending.delete(key); }
}

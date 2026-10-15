import type { FirebaseApp } from 'firebase/app';
import { getAnalytics, isSupported, type Analytics } from 'firebase/analytics';

export function configuredMeasurementId(value: unknown): string | undefined {
  return typeof value === 'string' && /^G-[A-Z0-9]{4,32}$/.test(value.trim()) ? value.trim() : undefined;
}

/** Analytics is optional. Its SDK starts an internal, non-awaitable config fetch
 * in getAnalytics(); a locally configured measurement ID lets that SDK recover
 * from blocked configuration requests instead of rejecting its internal promise.
 * Never start that optional network work without a valid existing property ID. */
export async function initializeOptionalAnalytics(app: FirebaseApp): Promise<Analytics | undefined> {
  if (!configuredMeasurementId(app.options.measurementId) ||
      (typeof navigator !== 'undefined' && navigator.onLine === false)) return undefined;
  try {
    return await isSupported() ? getAnalytics(app) : undefined;
  } catch {
    // Unsupported storage/cookies, blocked optional SDK checks and synchronous
    // initialization failures must not affect water data or become app crashes.
    return undefined;
  }
}

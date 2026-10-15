import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from 'src/lib/firebase';
import { reportClientError } from 'src/lib/errorReporting';
import {
  validateForecast,
  type ForecastDocument,
} from '../../../functions/src/forecast/schema';

const POLL_MS = 10 * 60_000;
const RETRY_MS = 30_000;
const READ_TIMEOUT_MS = 20_000;

function currentForecast(value: unknown, locationId: string): value is ForecastDocument {
  const now = Date.now();
  return validateForecast(value) && value.locationId === locationId &&
    Date.parse(value.generatedAt) <= now && Date.parse(value.expiresAt) > now;
}

export function useFloodOutlook(locationId: string) {
  const [cached, setCached] = useState<ForecastDocument | null>(null);
  const refreshRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    let active = true;
    let inFlight: Promise<void> | null = null;
    let controller: AbortController | null = null;
    let cancelRead: (() => void) | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    setCached(null);

    // Only read shared numerical caches. Refreshing a dashboard never triggers
    // model inference, training, or a Gemini request.
    const readCached = async (signal: AbortSignal): Promise<ForecastDocument | null> => {
      try {
        const response = await fetch('/api/outlook', { signal, cache: 'no-store' });
        const value: unknown = response.ok ? await response.json() : null;
        if (currentForecast(value, locationId)) return value;
        reportClientError('outlook_http_fallback', undefined, { provider: 'outlook', status: response.status });
      } catch (error: unknown) {
        if (!signal.aborted) reportClientError('outlook_http_fallback', error, { provider: 'outlook' });
        // Hosting and the local preview serve shared caches. A failed or
        // malformed HTTP cache can still use the existing Firestore fallback.
      }
      if (!active || signal.aborted) return null;
      try {
        const snap = await getDoc(doc(db, `locations/${locationId}/outlook/current`));
        const value: unknown = snap.data();
        if (currentForecast(value, locationId)) return value;
        if (active && !signal.aborted) reportClientError('outlook_unavailable', undefined, { provider: 'firestore' });
        return null;
      } catch (error: unknown) {
        if (active && !signal.aborted) reportClientError('outlook_unavailable', error, { provider: 'firestore' });
        return null;
      }
    };

    const scheduleExpiry = (value: ForecastDocument) => {
      clearTimeout(expiryTimer);
      const expire = () => {
        if (!active) return;
        const remaining = Date.parse(value.expiresAt) - Date.now();
        if (remaining > 0) {
          expiryTimer = setTimeout(expire, Math.min(remaining, 2_147_483_647));
          return;
        }
        setCached(previous => previous === value ? null : previous);
        void read();
      };
      expiryTimer = setTimeout(expire, Math.min(Date.parse(value.expiresAt) - Date.now(), 2_147_483_647));
    };

    const readWithDeadline = (requestController: AbortController) => new Promise<ForecastDocument | null>(resolve => {
      let settled = false;
      const finish = (value: ForecastDocument | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        if (cancelRead === cancel) cancelRead = null;
        resolve(value);
      };
      const cancel = () => finish(null);
      cancelRead = cancel;
      const deadline = setTimeout(() => {
        requestController.abort();
        if (active) reportClientError('outlook_timeout', undefined, { provider: 'outlook' });
        finish(null);
      }, READ_TIMEOUT_MS);
      // Firestore getDoc cannot be aborted. Its late result settles only this
      // bounded read and cannot replace a newer forecast after the deadline.
      void readCached(requestController.signal).then(finish, () => finish(null));
    });

    const read = (): Promise<void> => {
      if (!active) return Promise.resolve();
      if (inFlight) return inFlight;
      clearTimeout(pollTimer);
      const requestController = new AbortController();
      controller = requestController;
      inFlight = (async () => {
        const value = await readWithDeadline(requestController);
        if (!active) return;
        if (value && currentForecast(value, locationId)) {
          setCached(value);
          scheduleExpiry(value);
        } else {
          // Keep a still-current forecast during transient network failures.
          setCached(previous => currentForecast(previous, locationId) ? previous : null);
        }
        pollTimer = setTimeout(() => void read(), value ? POLL_MS : RETRY_MS);
      })().finally(() => {
        inFlight = null;
        if (controller === requestController) controller = null;
      });
      return inFlight;
    };

    const resume = () => { void read(); };
    const visible = () => {
      if (document.visibilityState === 'visible') resume();
    };
    refreshRef.current = read;
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', visible);
    import.meta.hot?.on('floodi:outlook-updated', resume);
    void read();
    return () => {
      active = false;
      controller?.abort();
      cancelRead?.();
      clearTimeout(pollTimer);
      clearTimeout(expiryTimer);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', visible);
      import.meta.hot?.off?.('floodi:outlook-updated', resume);
      if (refreshRef.current === read) refreshRef.current = () => Promise.resolve();
    };
  }, [locationId]);

  return { outlook: currentForecast(cached, locationId) ? cached : null, refresh };
}

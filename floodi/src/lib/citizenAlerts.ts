import { Capacitor } from '@capacitor/core';
import type { User } from 'firebase/auth';
import type { CitizenAction, CitizenStatusResponse } from '../../functions/src/citizenAlerts/types';
import type {
  CitizenAlertPreferences,
  PublicAlertBulletin,
  PublicAlertFeedDocument,
  PublicFloodAdvisory,
} from '../../functions/src/citizenAlerts/operationalAlerts';

export type {
  CitizenStatusResponse,
  CitizenAction,
  CitizenAlertPreferences,
  PublicFloodAdvisory,
  PublicAlertBulletin,
  PublicAlertFeedDocument,
};

export const ALERT_CONSENT_VERSION = 'citizen-email-v1' as const;

export const DEFAULT_CITIZEN_ALERT_PREFERENCES: CitizenAlertPreferences = {
  severities: {
    minor: true,
    moderate: true,
    major: true,
    extreme: true,
  },
  categories: {
    upcomingWatch: true,
    imminentWarning: true,
    forecastChange: true,
    allClear: false,
  },
};

const statuses = ['early-access', 'verification-required', 'active', 'paused', 'unsubscribed'];
const validDate = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));

function isValidPreferences(value: unknown): value is CitizenAlertPreferences {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  if (!p.severities || typeof p.severities !== 'object' || !p.categories || typeof p.categories !== 'object') {
    return false;
  }
  const sev = p.severities as Record<string, unknown>;
  const cat = p.categories as Record<string, unknown>;
  return (
    typeof sev.minor === 'boolean' &&
    typeof sev.moderate === 'boolean' &&
    typeof sev.major === 'boolean' &&
    typeof sev.extreme === 'boolean' &&
    typeof cat.upcomingWatch === 'boolean' &&
    typeof cat.imminentWarning === 'boolean' &&
    typeof cat.forecastChange === 'boolean' &&
    typeof cat.allClear === 'boolean'
  );
}

export function isCitizenStatus(value: unknown): value is CitizenStatusResponse {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (
    v.version !== 1 ||
    v.locationId !== 'carolina-beach' ||
    typeof v.deliveryReady !== 'boolean' ||
    !['email-pilot-enabled', 'email-delivery-not-enabled'].includes(String(v.readinessReason)) ||
    v.billingEnabled !== false ||
    v.consentVersion !== ALERT_CONSENT_VERSION ||
    (v.email !== null && typeof v.email !== 'string') ||
    typeof v.emailVerified !== 'boolean' ||
    !Array.isArray(v.history) ||
    v.history.length > 100
  ) {
    return false;
  }
  if (v.subscription !== null) {
    if (!v.subscription || typeof v.subscription !== 'object') return false;
    const s = v.subscription as Record<string, unknown>;
    if (
      !statuses.includes(String(s.status)) ||
      (s.email !== null && typeof s.email !== 'string') ||
      typeof s.emailVerified !== 'boolean' ||
      s.coverage !== 'carolina-beach-gauge' ||
      s.channel !== 'email' ||
      typeof s.consentVersion !== 'string' ||
      !validDate(s.createdAt) ||
      !validDate(s.updatedAt)
    ) {
      return false;
    }
    if (s.preferences !== undefined && !isValidPreferences(s.preferences)) {
      return false;
    }
    // Never render an operational claim from an inconsistent server response.
    if (s.status === 'active' && (!v.deliveryReady || !v.emailVerified || !s.emailVerified)) return false;
  }
  return v.history.every(
    item =>
      item &&
      typeof item === 'object' &&
      typeof item.id === 'string' &&
      ['enrollment', 'pause', 'unsubscribe', 'test', 'flood', 'preferences'].includes(item.kind) &&
      typeof item.state === 'string' &&
      typeof item.subject === 'string' &&
      validDate(item.createdAt) &&
      validDate(item.updatedAt)
  );
}

export function isPublicAlertFeed(value: unknown): value is PublicAlertFeedDocument {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 2 &&
    typeof v.locationId === 'string' &&
    validDate(v.generatedAt) &&
    Array.isArray(v.activeAdvisories) &&
    Array.isArray(v.recentBulletins)
  );
}

export class CitizenAlertError extends Error {
  constructor(readonly code: string) {
    const messages: Record<string, string> = {
      'sign-in-required': 'Sign in again to manage your alerts.',
      'email-account-required': 'Add an email address to your account first.',
      'verified-active-subscription-required': 'Verify your email and finish setup before sending a test.',
      'delivery-not-enabled': 'Email delivery is not active yet. Your early-access registration is saved.',
      'test-rate-limited': 'A test was recently requested. You can send another in an hour.',
      'please-wait': 'Please wait a moment before trying again.',
      'unauthenticated': 'Sign in again to manage your alerts.',
      'email-required': 'Add an email address to your account first.',
      'email-unverified': 'Verify your email before enabling delivery.',
      'verification-required': 'Verify your email before enabling delivery.',
      'delivery-disabled': 'Email delivery is not active yet. Your early-access registration is saved.',
      'delivery-unavailable': 'Email delivery is not active yet. Please try again later.',
      'rate-limited': 'Please wait a few minutes before trying again.',
      'too-many-requests': 'Please wait a few minutes before trying again.',
      'invalid-token': 'This unsubscribe link is unavailable. Sign in to manage your alerts.',
      'invalid-unsubscribe-token': 'This unsubscribe link is unavailable. Sign in to manage your alerts.',
      'consent-required': 'Confirm that you want to receive flood emails.',
      'subscription-required': 'Enable flood alerts first before updating category preferences.',
    };
    super(messages[code] || 'Alert setup is temporarily unavailable. Please try again.');
    this.name = 'CitizenAlertError';
  }
}

export function citizenPublicBaseUrl(): string {
  const project = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  return Capacitor.isNativePlatform() && typeof project === 'string' && /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project)
    ? `https://${project}.web.app`
    : window.location.origin;
}

function endpoint(query = '') {
  const base = Capacitor.isNativePlatform() ? `${citizenPublicBaseUrl()}/api/alerts` : '/api/alerts';
  return query ? `${base}?${query}` : base;
}

export function citizenAlertChartUrl(generatedAt?: string): string {
  const bucket = generatedAt ? encodeURIComponent(generatedAt) : String(Math.floor(Date.now() / 300_000));
  return endpoint(`chart=1&v=${bucket}`);
}

/** Firebase token refresh can wait on the network before fetch even begins. */
function abortableToken(work: Promise<string>, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new CitizenAlertError('unavailable'));
    work.then(
      value => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', abort);
        reject(error);
      }
    );
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function request(user: Pick<User, 'getIdToken'> | null, body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const deadline = setTimeout(abort, 15_000);
  try {
    if (controller.signal.aborted) throw new CitizenAlertError('unavailable');
    const token = user ? await abortableToken(user.getIdToken(), controller.signal) : null;
    if (controller.signal.aborted) throw new CitizenAlertError('unavailable');
    const response = await fetch(endpoint(), {
      method: body === undefined ? 'GET' : 'POST',
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value: unknown = await response.json();
    if (!response.ok) {
      const code =
        value && typeof value === 'object' && 'error' in value && typeof value.error === 'string'
          ? value.error
          : response.status === 401
          ? 'unauthenticated'
          : response.status === 429
          ? 'rate-limited'
          : 'unavailable';
      throw new CitizenAlertError(code);
    }
    return value;
  } catch (error) {
    if (error instanceof CitizenAlertError) throw error;
    throw new CitizenAlertError('unavailable');
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', abort);
  }
}

export async function readPublicAlertFeed(signal?: AbortSignal): Promise<PublicAlertFeedDocument | null> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const deadline = setTimeout(abort, 10_000);
  try {
    if (controller.signal.aborted) return null;
    const response = await fetch(endpoint('feed=1'), {
      method: 'GET',
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const json: unknown = await response.json();
    return isPublicAlertFeed(json) ? json : null;
  } catch {
    return null;
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', abort);
  }
}

export async function readCitizenAlerts(
  user: Pick<User, 'getIdToken'> | null,
  signal?: AbortSignal
): Promise<CitizenStatusResponse> {
  const value = await request(user, undefined, signal);
  if (!isCitizenStatus(value)) throw new CitizenAlertError('invalid-response');
  return value;
}

export async function changeCitizenAlerts(
  user: Pick<User, 'getIdToken'>,
  action: CitizenAction,
  preferences?: CitizenAlertPreferences
): Promise<CitizenStatusResponse> {
  const payload: Record<string, unknown> = {
    action,
    ...(['enroll', 'resume'].includes(action) ? { consentVersion: ALERT_CONSENT_VERSION } : {}),
    ...(preferences ? { preferences } : {}),
  };
  const value = await request(user, payload);
  if (!isCitizenStatus(value)) throw new CitizenAlertError('invalid-response');
  window.dispatchEvent(new Event('floodcast:alerts-updated'));
  return value;
}

export async function unsubscribeCitizenAlerts(token: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new CitizenAlertError('invalid-token');
  const value = await request(null, { action: 'unsubscribe', token });
  if (!value || typeof value !== 'object' || !('unsubscribed' in value) || value.unsubscribed !== true) {
    throw new CitizenAlertError('invalid-response');
  }
}

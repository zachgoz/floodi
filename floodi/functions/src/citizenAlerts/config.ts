import { DeliveryConfiguration } from './types';

/** Delivery is opt-in at the server boundary. A configured credential alone can
 * never activate citizen notifications, paid entitlement or a shadow intent. */
export function citizenDeliveryConfiguration(env: NodeJS.ProcessEnv = process.env): DeliveryConfiguration {
  const from = env.CITIZEN_ALERT_FROM_EMAIL?.trim() ?? '';
  const apiKey = env.CITIZEN_ALERT_RESEND_API_KEY?.trim() ?? '';
  let publicBaseUrl: string | null = null;
  try {
    const url = new URL(env.CITIZEN_ALERT_PUBLIC_URL ?? '');
    if (url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) publicBaseUrl = url.origin;
  } catch { /* Missing/invalid deployment configuration remains disabled. */ }
  const validEmail = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(from);
  const enabled = env.CITIZEN_ALERT_DELIVERY_ENABLED === 'true' && env.CITIZEN_ALERT_PROVIDER === 'resend' && validEmail && !!apiKey && !!publicBaseUrl;
  return { enabled, provider: enabled ? 'resend' : 'disabled', fromEmail: validEmail ? from : null, publicBaseUrl, apiKey: apiKey || null };
}

import { DeliveryConfiguration } from './types';

export class EmailProviderError extends Error {
  constructor(public readonly retryable: boolean, public readonly status: number | null) { super('email-provider-unavailable'); }
}
export interface EmailMessage {
  id: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  unsubscribeToken: string;
}
export interface EmailProvider { send(message: EmailMessage): Promise<string> }

function appendHtmlFooter(html: string, unsubscribeLink: string): string {
  const safeLink = unsubscribeLink.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const footer = `<div style="max-width:640px;margin:0 auto;padding:0 14px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:11px;line-height:1.5;color:#64748b;text-align:center;">
    FloodCast forecasts can change. Follow official guidance and never drive through floodwater.<br/>
    <a href="${safeLink}" style="color:#94a3b8;text-decoration:underline;">Unsubscribe with one click</a>
  </div>`;
  if (html.includes('</body>')) {
    return html.replace('</body>', `${footer}</body>`);
  }
  return `${html}\n${footer}`;
}

/** Only the fixed provider URL can receive the server secret. Never log request,
 * response body or recipient; provider errors are deliberately reduced to status. */
export function createResendProvider(configuration: DeliveryConfiguration, request: typeof fetch = fetch): EmailProvider {
  return {
    async send(message) {
      if (!configuration.enabled || configuration.provider !== 'resend' || !configuration.apiKey || !configuration.fromEmail || !configuration.publicBaseUrl) throw new EmailProviderError(false, null);
      const link = `${configuration.publicBaseUrl}/alerts/unsubscribe#token=${message.unsubscribeToken}`;
      let response: Response;
      try {
        const payload: Record<string, unknown> = {
          from: configuration.fromEmail,
          to: [message.to],
          subject: message.subject,
          text: `${message.text}\n\nManage or unsubscribe: ${link}\nFloodCast forecasts can change. Follow official guidance and never drive through floodwater.`,
          ...(message.html ? { html: appendHtmlFooter(message.html, link) } : {}),
          headers: { 'List-Unsubscribe': `<${link}>` },
        };
        response = await request('https://api.resend.com/emails', {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12_000),
          headers: { Authorization: `Bearer ${configuration.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `floodcast-${message.id}` },
          body: JSON.stringify(payload),
        });
      } catch { throw new EmailProviderError(true, null); }
      if (!response.ok) {
        // Resend uses 409 for both an in-flight duplicate (retryable) and a
        // changed payload under the same idempotency key (permanent). Inspect
        // only its documented error name; never retain/log the response body.
        let retryable = [408, 425, 429].includes(response.status) || response.status >= 500;
        if (response.status === 409) {
          const error = await response.json().catch(() => null) as { name?: unknown } | null;
          retryable = error?.name !== 'invalid_idempotent_request';
        }
        throw new EmailProviderError(retryable, response.status);
      }
      const result = await response.json().catch(() => null) as { id?: unknown } | null;
      if (!result || typeof result.id !== 'string' || !result.id || result.id.length > 128) throw new EmailProviderError(true, null);
      return result.id;
    },
  };
}

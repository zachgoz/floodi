import * as logger from 'firebase-functions/logger';
import { sanitizeFirestorePayload } from './firestorePayload';

export function safeError(error: unknown, depth = 0): Record<string, string | number> {
  const value = error && typeof error === 'object' ? error as Record<string, any> : {};
  const status = value.response?.status ?? value.status ?? value.statusCode;
  const apiError = value.response?.data?.error;
  const clean = (text: unknown) => String(text ?? '')
    .replace(/Bearer\s+\S+/gi, '[credential]')
    .replace(/\b[A-Za-z0-9_-]*(?:api[_-]?key|token|password|secret|credential)[A-Za-z0-9_-]*\s*[:=]\s*["']?[^\s,"'}]+/gi, '[redacted]')
    .replace(/https?:\/\/[^\s"')]+/gi, '[url]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .slice(0, 600);
  const details: Record<string, string | number> = {
    name: clean(value.name || 'Error'),
    message: clean(apiError?.message || value.message || (typeof error === 'string' ? error : 'Unknown error')),
  };
  if (typeof value.code === 'string' || typeof value.code === 'number') details.code = clean(value.code).slice(0, 80);
  if (typeof status === 'number' && Number.isInteger(status)) details.httpStatus = status;
  if (typeof apiError?.status === 'string') details.apiStatus = clean(apiError.status).slice(0, 80);
  if (typeof value.finishReason === 'string' && /^[A-Z_]{1,50}$/.test(value.finishReason)) details.finishReason = value.finishReason;
  for (const key of ['outputTextLength', 'responseTokens', 'thinkingTokens']) if (typeof value[key] === 'number' && Number.isFinite(value[key])) details[key] = value[key];
  if (depth < 1 && value.cause && value.cause !== error) {
    for (const [key, entry] of Object.entries(safeError(value.cause, depth + 1))) details[`cause${key[0].toUpperCase()}${key.slice(1)}`] = entry;
  }
  if (value.progress && typeof value.progress === 'object') {
    for (const key of ['daysWritten', 'recordsWritten', 'rejectedRecords']) if (typeof value.progress[key] === 'number' && Number.isFinite(value.progress[key])) details[key] = value.progress[key];
  }
  // Never serialize the Error, request config, auth headers, response payload or stack.
  return details;
}

export type SourceHealth = { status: 'ok' | 'empty' | 'failed'; count: number; latestAt?: string; error?: Record<string, string | number> | null };
export function sourceHealth(result: PromiseSettledResult<unknown>, records: Record<string, unknown>): SourceHealth {
  if (result.status === 'rejected') return { status: 'failed', count: 0, error: safeError(result.reason) };
  const clean = sanitizeFirestorePayload(records);
  const times = Object.keys(clean).filter(t => Number.isFinite(Date.parse(t)) && !(clean[t] && typeof clean[t] === 'object' && !Object.keys(clean[t] as object).length)).sort((a, b) => Date.parse(b) - Date.parse(a));
  return { status: times.length ? 'ok' : 'empty', count: times.length, error: null, ...(times[0] ? { latestAt: new Date(times[0]).toISOString() } : {}) };
}

export async function recordJobOutcome(db: FirebaseFirestore.Firestore, job: string, locationId: string, outcome: Record<string, unknown> & { status: 'ok' | 'partial' | 'failed' }): Promise<void> {
  const event = sanitizeFirestorePayload({ error: null, event: 'job_outcome', job, locationId, completedAt: new Date().toISOString(), ...outcome });
  if (outcome.status === 'failed') logger.error('Scheduled job failed', event);
  else if (outcome.status === 'partial') logger.warn('Scheduled job partially completed', event);
  else logger.info('Scheduled job completed', event);
  const sourceLastSuccessfulAt: Record<string, string> = {};
  const sources = outcome.sources && typeof outcome.sources === 'object' ? outcome.sources as Record<string, Partial<SourceHealth>> : {};
  for (const [source, health] of Object.entries(sources)) {
    if (/^[a-zA-Z0-9_-]{1,40}$/.test(source) && health?.status === 'ok' && typeof health.count === 'number' && health.count > 0) sourceLastSuccessfulAt[source] = event.completedAt;
  }
  try {
    await db.doc(`operationalHealth/${job}_${locationId}`).set({ ...event, ...(Object.keys(sourceLastSuccessfulAt).length ? { sourceLastSuccessfulAt } : {}), ...(outcome.status !== 'failed' ? { lastSuccessfulAt: event.completedAt } : {}) }, { merge: true });
  } catch (error) {
    logger.error('Operational health write failed', { event: 'health_write_failed', job, locationId, error: safeError(error) });
    throw error;
  }
}

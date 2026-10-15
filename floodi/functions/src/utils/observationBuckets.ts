import type { firestore } from 'firebase-admin';
import { sanitizeFirestorePayload } from './firestorePayload';

const DAY_MS = 86_400_000;
// Leave ample space for document names/Firestore encoding. This also prevents
// an unexpected upstream payload from consuming the whole document allowance.
export const MAX_OBSERVATION_PATCH_BYTES = 700_000;
export interface ObservationSources {
  noaa?: Record<string, number>;
  fiman?: Record<string, number>;
  weather?: Record<string, unknown>;
  /** Timestamp -> camera -> URL, as returned by the backend sensor ETL. */
  imagery?: Record<string, Record<string, string>>;
  /** Immutable archived image references overlay refreshable camera URLs. */
  persistedImagery?: Record<string, Record<string, string>>;
}
export interface ObservationMaps {
  noaa: Record<string, number>;
  fiman: Record<string, number>;
  weather: Record<string, Record<string, unknown>>;
  imagery: Record<string, Record<string, string>>;
  persistedImagery: Record<string, Record<string, string>>;
}
export const emptyObservationMaps = (): ObservationMaps => ({ noaa: {}, fiman: {}, weather: {}, imagery: {}, persistedImagery: {} });
type SourceCounts = { noaa: number; fiman: number; weather: number; imagery: number };
export class ObservationBucketWriteError extends Error {
  constructor(readonly progress: { daysWritten: number; recordsWritten: number; rejectedRecords: number; sourceRecords: SourceCounts }, cause: unknown) {
    super('Observation daily bucket write failed', { cause });
  }
}

export function utcDaysInRange(start: Date, end: Date): string[] {
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || start > end) return [];
  const days: string[] = [];
  for (let ms = Math.floor(+start / DAY_MS) * DAY_MS; ms <= +end; ms += DAY_MS) {
    days.push(new Date(ms).toISOString().slice(0, 10));
  }
  return days;
}

function timestamp(value: string): string | null {
  // Require an explicit timezone; interpreting a naive upstream timestamp in a
  // server/browser local zone silently puts measurements in the wrong bucket.
  if (!/(Z|[+-]\d\d:\d\d)$/i.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Normalizes both historic imagery layouts without throwing away cameras. */
export function normalizeObservationImagery(input: ObservationSources['imagery']): ObservationMaps['imagery'] {
  const output: ObservationMaps['imagery'] = {};
  for (const [outer, inner] of Object.entries(input || {})) {
    if (!inner || typeof inner !== 'object' || Array.isArray(inner)) continue;
    const outerTime = timestamp(outer);
    for (const [key, value] of Object.entries(inner)) {
      const t = outerTime || timestamp(key);
      const camera = outerTime ? key : outer;
      if (!t || !camera || typeof value !== 'string' || !value || value.length > 4096) continue;
      (output[t] ||= {})[camera] = value;
    }
  }
  return output;
}

export function partitionObservationBuckets(sources: ObservationSources, options: { now?: Date; observedThrough?: Date; weatherObservedThrough?: Date } = {}) {
  const through = +(options.observedThrough || options.now || new Date());
  if (!Number.isFinite(through)) throw new Error('Valid observation cutoff required');
  const buckets: Record<string, ObservationMaps> = {};
  let rejectedRecords = 0;
  for (const source of ['noaa', 'fiman', 'weather'] as const) {
    for (const [key, raw] of Object.entries(sources[source] || {})) {
      const t = timestamp(key);
      const value = sanitizeFirestorePayload(raw);
      const valid = source === 'weather'
        ? value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
        : typeof value === 'number' && Number.isFinite(value);
      const sourceThrough = source === 'weather' && options.weatherObservedThrough ? Math.min(through, +options.weatherObservedThrough) : through;
      if (!t || +new Date(t) > sourceThrough || !valid) { rejectedRecords++; continue; }
      const bucket = buckets[t.slice(0, 10)] ||= emptyObservationMaps();
      if (source === 'weather') bucket.weather[t] = value as Record<string, unknown>;
      else bucket[source][t] = value as number;
    }
  }
  for (const source of ['imagery', 'persistedImagery'] as const) {
    for (const [t, cameras] of Object.entries(normalizeObservationImagery(sources[source]))) {
      if (+new Date(t) > through) { rejectedRecords++; continue; }
      const bucket = buckets[t.slice(0, 10)] ||= emptyObservationMaps();
      for (const [camera, url] of Object.entries(cameras)) {
        const target = url.startsWith('storage://') ? 'persistedImagery' : 'imagery';
        if (source === 'persistedImagery' && target !== 'persistedImagery') { rejectedRecords++; continue; }
        (bucket[target][t] ||= {})[camera] = url;
      }
    }
  }
  for (const [day, bucket] of Object.entries(buckets)) {
    if (Object.values(bucket).every(records => Object.keys(records).length === 0)) delete buckets[day];
  }
  return { buckets, rejectedRecords };
}

export function observationPatch(sources: ObservationSources, lastUpdated: string): Record<string, unknown> {
  const patch: Record<string, unknown> = { lastUpdated };
  for (const source of ['noaa', 'fiman', 'weather', 'imagery', 'persistedImagery'] as const) {
    if (Object.keys(sources[source] || {}).length) patch[source] = sources[source];
  }
  if (Buffer.byteLength(JSON.stringify(patch)) > MAX_OBSERVATION_PATCH_BYTES) {
    throw new Error('Observation day exceeds the safe document payload size');
  }
  return patch;
}

/** Daily atomic leaf merges never read, rewrite or delete legacy month maps. */
export async function writeObservationBuckets(
  db: Pick<firestore.Firestore, 'doc'>,
  locationId: string,
  sources: ObservationSources,
  options: { now?: Date; observedThrough?: Date } = {},
) {
  const now = options.now || new Date();
  const { buckets, rejectedRecords } = partitionObservationBuckets(sources, { ...options, now });
  let daysWritten = 0;
  let recordsWritten = 0;
  const sourceRecords: SourceCounts = { noaa: 0, fiman: 0, weather: 0, imagery: 0 };
  // Sequential bounded writes let callers accurately fail/retry on write errors;
  // every completed day is idempotent and remains useful after a partial failure.
  for (const [day, bucket] of Object.entries(buckets).sort()) {
    try {
      await db.doc(`locations/${locationId}/observations/${day}`).set(observationPatch(bucket, now.toISOString()), { merge: true });
    } catch (cause) {
      throw new ObservationBucketWriteError({ daysWritten, recordsWritten, rejectedRecords, sourceRecords }, cause);
    }
    daysWritten++;
    recordsWritten += Object.values(bucket).reduce((count, records) => count + Object.keys(records).length, 0);
    for (const source of ['noaa', 'fiman', 'weather'] as const) sourceRecords[source] += Object.keys(bucket[source]).length;
    sourceRecords.imagery += Object.keys(bucket.imagery).length + Object.keys(bucket.persistedImagery).length;
  }
  return { daysWritten, recordsWritten, rejectedRecords, sourceRecords };
}

/** Read only the requested UTC days plus legacy monthly documents. Daily leaves
 * win, and missing partial weather fields/cameras retain their older values. */
export async function readObservationRange(
  db: Pick<firestore.Firestore, 'doc'>,
  locationId: string,
  start: Date,
  end: Date,
  options: { now?: Date } = {},
): Promise<ObservationMaps> {
  const days = utcDaysInRange(start, end);
  const ids = [...new Set(days.map(day => day.slice(0, 7))), ...days];
  const snapshots = await Promise.all(ids.map(id => db.doc(`locations/${locationId}/observations/${id}`).get()));
  const merged = emptyObservationMaps();
  const now = options.now || new Date();
  for (let index = 0; index < snapshots.length; index++) {
    const snapshot = snapshots[index];
    if (!snapshot.exists) continue;
    const data = snapshot.data() || {};
    const recordedAt = typeof data.lastUpdated === 'string' ? new Date(data.lastUpdated) : new Date(0);
    const { buckets } = partitionObservationBuckets(data, {
      now,
      // Some legacy monthly buckets mixed forecast weather into observations.
      // Keep raw data intact but never promote rows after its recorded cutoff.
      weatherObservedThrough: ids[index].length === 7 ? (Number.isFinite(+recordedAt) ? recordedAt : new Date(0)) : now,
    });
    for (const bucket of Object.values(buckets)) {
      for (const source of ['noaa', 'fiman'] as const) {
        for (const [t, value] of Object.entries(bucket[source])) if (+new Date(t) >= +start && +new Date(t) <= +end) merged[source][t] = value;
      }
      for (const source of ['weather', 'imagery', 'persistedImagery'] as const) {
        for (const [t, value] of Object.entries(bucket[source])) {
          if (+new Date(t) >= +start && +new Date(t) <= +end) merged[source][t] = { ...merged[source][t], ...value };
        }
      }
    }
  }
  for (const [t, cameras] of Object.entries(merged.persistedImagery)) merged.imagery[t] = { ...merged.imagery[t], ...cameras };
  return merged;
}

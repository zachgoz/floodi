import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { fetchNoaaObserved, fetchNoaaPredictions } from './etl/noaa';
import { fetchFimanData } from './etl/fiman';
import { detectPeaks, detectFloodEvents } from './etl/processor';
import { fetchNwsObservations, fetchNwsForecast } from './etl/weather';
import { persistImageryBatch } from './utils/storage';
import { sanitizeFirestorePayload } from './utils/firestorePayload';
import { ObservationBucketWriteError, readObservationRange, writeObservationBuckets } from './utils/observationBuckets';
import { recordJobOutcome, safeError, sourceHealth } from './utils/observability';
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const LOCATIONS = [
  {
    id: 'carolina-beach',
    name: 'Carolina Beach',
    noaaStationId: '8658163',
    fimanSensorId: 'SUNNYD_CB_03',
    coords: { lat: 34.0352, lon: -77.8931 },
    thresholds: { minor: 5.6, moderate: 7.0, major: 7.7, extreme: 8.5 },
    navd88ToMllwOffset: 2.75
  }
];

export const syncWaterLevels = onSchedule({ schedule: 'every 10 minutes', memory: '1GiB', timeoutSeconds: 540, maxInstances: 1, concurrency: 1 }, async () => {
  const failures: unknown[] = [];
  for (const loc of LOCATIONS) {
    const now = new Date();
    const start = new Date(+now - 24 * 3600_000);
    let measurementWrites = 0;
    try {
      const [noaaResult, fimanResult, weatherResult] = await Promise.allSettled([
        fetchNoaaObserved(loc.noaaStationId, start, now),
        fetchFimanData(loc.fimanSensorId, start, now, loc.navd88ToMllwOffset),
        fetchNwsObservations(loc.coords.lat, loc.coords.lon, start, now),
      ]);
      const noaa = eligibleObservations(noaaResult.status === 'fulfilled' ? noaaResult.value : {}, now);
      const fiman = eligibleObservations(fimanResult.status === 'fulfilled' ? fimanResult.value.waterLevels : {}, now);
      const imagery = fimanResult.status === 'fulfilled' ? fimanResult.value.imagery : {};
      const weather = eligibleObservations(weatherResult.status === 'fulfilled' ? weatherResult.value : {}, now);
      const sources = { noaa: sourceHealth(noaaResult, noaa), fiman: sourceHealth(fimanResult, fiman), weather: sourceHealth(weatherResult, weather) };
      // Commit measurements BEFORE optional camera URL writes, downloads or
      // derived products. Image/network failures cannot roll these writes back.
      const result = await writeObservationBuckets(db, loc.id, { noaa, fiman, weather }, { now, observedThrough: now });
      measurementWrites = result.sourceRecords.noaa + result.sourceRecords.fiman;
      if (!measurementWrites || !result.recordsWritten) {
        await recordJobOutcome(db, 'syncWaterLevels', loc.id, { attemptedAt: now.toISOString(), status: 'failed', sources, measurementWrites: 0 });
        throw new Error('No useful observation source records were available');
      }
      let partial = Object.values(sources).some(source => source.status !== 'ok');
      let imageResult = { attempted: 0, succeeded: 0, failed: 0, deferred: false };
      let archivedImagery: Record<string, Record<string, string>> = {};
      try {
        if (Object.keys(imagery).length) await writeObservationBuckets(db, loc.id, { imagery }, { now });
        const stored = await readObservationRange(db, loc.id, start, now, { now });
        archivedImagery = stored.persistedImagery;
        const images = await persistImageryBatch(loc.id, stored.imagery, stored.fiman, loc.thresholds.minor);
        const { patch, ...stats } = images;
        imageResult = stats;
        for (const [t, cameras] of Object.entries(patch)) archivedImagery[t] = { ...archivedImagery[t], ...cameras };
        if (Object.keys(patch).length) await writeObservationBuckets(db, loc.id, { imagery: patch }, { now });
        partial ||= stats.failed > 0;
      } catch (error) {
        partial = true;
        logger.warn('Optional imagery unavailable after observations committed', { event: 'camera_archive_failed', locationId: loc.id, error: safeError(error) });
      }
      try {
        for (const peak of detectPeaks(fiman)) {
          await db.doc(`locations/${loc.id}/peaks/fiman_${peak.t.replace(/[:.-]/g, '')}`).set({ t: peak.t, v: peak.v, source: 'fiman', type: 'observed' }, { merge: true });
        }
        for (const event of detectFloodEvents(fiman, loc.thresholds)) {
          // Only durable references may overwrite an event's saved camera keys.
          const peakImages = archivedImagery[event.peakTime];
          await db.doc(`locations/${loc.id}/flood_events/fiman_${event.startTime.replace(/[:.-]/g, '')}`).set({ ...event, source: 'fiman', ...(peakImages && Object.keys(peakImages).length ? { peakImages } : {}) }, { merge: true });
        }
      } catch (error) {
        partial = true;
        logger.warn('Derived event update failed after observations committed', { event: 'derived_events_failed', locationId: loc.id, error: safeError(error) });
      }
      await recordJobOutcome(db, 'syncWaterLevels', loc.id, { attemptedAt: now.toISOString(), status: partial ? 'partial' : 'ok', sources, measurementWrites, daysWritten: result.daysWritten, rejectedRecords: result.rejectedRecords, imagery: imageResult });
    } catch (error) {
      if (error instanceof ObservationBucketWriteError) measurementWrites = error.progress.sourceRecords.noaa + error.progress.sourceRecords.fiman;
      failures.push(error);
      await recordJobOutcome(db, 'syncWaterLevels', loc.id, { attemptedAt: now.toISOString(), status: 'failed', measurementWrites, error: safeError(error) });
    }
  }
  if (failures.length) throw new AggregateError(failures, 'Observation sync did not complete successfully');
});

export const syncPredictions = onSchedule({ schedule: 'every 24 hours', memory: '512MiB', timeoutSeconds: 540, maxInstances: 1, concurrency: 1 }, async () => {
  const failures: unknown[] = [];
  for (const loc of LOCATIONS) {
    const now = new Date();
    const end = new Date(+now + 15 * 24 * 3600_000);
    try {
      const [predictionResult, weatherResult] = await Promise.allSettled([fetchNoaaPredictions(loc.noaaStationId, now, end), fetchNwsForecast(loc.coords.lat, loc.coords.lon)]);
      const predictions = predictionResult.status === 'fulfilled' ? predictionResult.value : {};
      const weather = weatherResult.status === 'fulfilled' ? weatherResult.value : {};
      const sources = { noaa: sourceHealth(predictionResult, predictions), weather: sourceHealth(weatherResult, weather) };
      let recordsWritten = 0;
      for (const month of getMonthsInRange(now, end)) {
        const available = availableBucketFields({ data: filterByMonth(predictions, month), weather: filterByMonth(weather, month) });
        if (!Object.keys(available).length) continue;
        await db.doc(`locations/${loc.id}/predictions/${month}`).set({ ...available, lastUpdated: now.toISOString() }, { merge: true });
        recordsWritten += Object.values(available).reduce((n, source) => n + Object.keys(source).length, 0);
      }
      if (!recordsWritten) {
        await recordJobOutcome(db, 'syncPredictions', loc.id, { attemptedAt: now.toISOString(), status: 'failed', sources, recordsWritten });
        throw new Error('No useful prediction source records were available');
      }
      for (const peak of detectPeaks(predictions)) await db.doc(`locations/${loc.id}/peaks/pred_${peak.t.replace(/[:.-]/g, '')}`).set({ t: peak.t, v: peak.v, source: 'noaa', type: 'predicted' }, { merge: true });
      await recordJobOutcome(db, 'syncPredictions', loc.id, { attemptedAt: now.toISOString(), status: Object.values(sources).some(source => source.status !== 'ok') ? 'partial' : 'ok', sources, recordsWritten });
    } catch (error) {
      failures.push(error);
      await recordJobOutcome(db, 'syncPredictions', loc.id, { attemptedAt: now.toISOString(), status: 'failed', error: safeError(error) });
    }
  }
  if (failures.length) throw new AggregateError(failures, 'Prediction sync did not complete successfully');
});

type BucketFields = Record<string, Record<string, unknown>>;
function availableBucketFields(fields: BucketFields): BucketFields {
  const clean = sanitizeFirestorePayload(fields);
  return Object.fromEntries(Object.entries(clean).map(([source, records]) => [source, Object.fromEntries(Object.entries(records).filter(([, value]) => !(value && typeof value === 'object' && !Object.keys(value).length)))] as const).filter(([, records]) => Object.keys(records).length));
}
function getMonthsInRange(start: Date, end: Date): string[] {
  const months: string[] = [];
  const curr = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (curr <= last) { months.push(curr.toISOString().slice(0, 7)); curr.setUTCMonth(curr.getUTCMonth() + 1); }
  return months;
}
function filterByMonth<T>(data: Record<string, T>, month: string): Record<string, T> { return Object.fromEntries(Object.entries(data).filter(([t]) => t.startsWith(month))); }

function eligibleObservations<T>(records: Record<string, T>, now: Date): Record<string, T> {
  const clean = sanitizeFirestorePayload(records);
  return Object.fromEntries(Object.entries(clean).filter(([t, value]) =>
    /(Z|[+-]\d\d:\d\d)$/i.test(t) && Number.isFinite(Date.parse(t)) && Date.parse(t) <= +now &&
    (typeof value === 'number' ? Number.isFinite(value) : !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0)
  ));
}

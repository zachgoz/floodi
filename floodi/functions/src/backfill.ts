import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import { fetchNoaaObserved } from './etl/noaa';
import { fetchFimanData } from './etl/fiman';
import { detectPeaks, detectFloodEvents } from './etl/processor';
import { fetchNwsObservations } from './etl/weather';
import { sanitizeFirestorePayload } from './utils/firestorePayload';
import { writeObservationBuckets, ObservationBucketWriteError, partitionObservationBuckets } from './utils/observationBuckets';
import { safeError } from './utils/observability';
import * as logger from 'firebase-functions/logger';

// Initialize admin if not already
if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

const LOCATIONS = [
  {
    id: 'carolina-beach',
    noaaStationId: '8658163',
    fimanSensorId: 'SUNNYD_CB_03',
    coords: { lat: 34.0352, lon: -77.8931 },
    navd88ToMllwOffset: 2.75,
    thresholds: { minor: 5.6, moderate: 7.0, major: 7.7, extreme: 8.5 }
  }
];

export const runBackfillData = onRequest({ timeoutSeconds: 540, memory: '1GiB', invoker: 'private', maxInstances: 1, concurrency: 1 }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Use an authenticated administrative POST request');
    return;
  }
  const rawDays = req.query?.days;
  const days = rawDays === undefined ? 60 : typeof rawDays === 'string' && /^[1-9]\d*$/.test(rawDays) ? Number(rawDays) : NaN;
  if (!Number.isInteger(days) || days < 1 || days > 60) {
    res.status(400).send('days must be an integer from 1 to 60');
    return;
  }
  const endTotal = new Date();
  const startTotal = new Date(endTotal.getTime() - days * 24 * 3600_000);

  const summary = { requestedChunks: 0, completedChunks: 0, partialChunks: 0, failedChunks: 0, daysWritten: 0, recordsWritten: 0, rejectedRecords: 0, sourceRecords: { fiman: 0, noaa: 0, weather: 0, imagery: 0 }, sourceFailures: { fiman: 0, noaa: 0, weather: 0 } };
  logger.info('Backfill started', { start: startTotal.toISOString(), end: endTotal.toISOString(), days });

  // Process in 15-day chunks to respect NOAA limits
  const CHUNK_MS = 15 * 24 * 3600_000;

  for (const loc of LOCATIONS) {
    console.log(`Processing ${loc.id}...`);
    
    let currStart = new Date(startTotal);
    while (currStart < endTotal) {
      let currEnd = new Date(currStart.getTime() + CHUNK_MS);
      if (currEnd > endTotal) currEnd = endTotal;
      
      console.log(`  Fetching chunk ${currStart.toISOString()} to ${currEnd.toISOString()}...`);
      
      summary.requestedChunks++;
      let partial = false;
      try {
        const [fimanResult, noaaResult, weatherResult] = await Promise.allSettled([
          fetchFimanData(loc.fimanSensorId, currStart, currEnd, loc.navd88ToMllwOffset),
          fetchNoaaObserved(loc.noaaStationId, currStart, currEnd),
          fetchNwsObservations(loc.coords.lat, loc.coords.lon, currStart, currEnd)
        ]);
        const fimanData = sourceData(fimanResult, 'FiMAN observations', loc.id);
        const noaaData = sourceData(noaaResult, 'NOAA observations', loc.id);
        const weatherData = sourceData(weatherResult, 'weather observations', loc.id);
        
        for (const [source, result] of [['fiman', fimanResult], ['noaa', noaaResult], ['weather', weatherResult]] as const) {
          if (result.status === 'rejected') { summary.sourceFailures[source]++; partial = true; }
        }
        const written = await writeObservationBuckets(db, loc.id, {
          fiman: fimanData?.waterLevels, noaa: noaaData || undefined,
          imagery: fimanData?.imagery, weather: weatherData || undefined,
        }, { now: endTotal, observedThrough: currEnd });
        summary.daysWritten += written.daysWritten;
        summary.recordsWritten += written.recordsWritten;
        summary.rejectedRecords += written.rejectedRecords;
        for (const source of ['fiman', 'noaa', 'weather', 'imagery'] as const) summary.sourceRecords[source] += written.sourceRecords[source];
        if (written.recordsWritten === 0) {
          summary.failedChunks++;
          logger.error('Backfill chunk produced no valid observations', { locationId: loc.id, start: currStart.toISOString(), end: currEnd.toISOString() });
          currStart = new Date(currEnd.getTime() + 1);
          continue;
        }

        // Deterministic IDs upsert recovered peaks/events. Never delete a
        // whole month of derived history for a partial-range recovery.
        const acceptedFiman: Record<string, number> = Object.fromEntries(Object.values(partitionObservationBuckets({ fiman: fimanData?.waterLevels }, { observedThrough: currEnd }).buckets).flatMap(bucket => Object.entries(bucket.fiman)));
        const peaks = detectPeaks(acceptedFiman);
        for (const peak of peaks) {
          const peakId = `fiman_${peak.t.replace(/[:.-]/g, '')}`;
          await db.doc(`locations/${loc.id}/peaks/${peakId}`).set(sanitizeFirestorePayload({
            t: peak.t,
            v: peak.v,
            source: 'fiman',
            type: 'observed'
          }), { merge: true });
        }

        const events = detectFloodEvents(acceptedFiman, loc.thresholds);
        for (const event of events) {
          const eventId = `fiman_${event.startTime.replace(/[:.-]/g, '')}`;
          await db.doc(`locations/${loc.id}/flood_events/${eventId}`).set(sanitizeFirestorePayload({
            ...event,
            source: 'fiman'
          }), { merge: true });
        }

        if (partial) summary.partialChunks++;
        else summary.completedChunks++;
      } catch (err) {
        summary.failedChunks++;
        if (err instanceof ObservationBucketWriteError) {
          summary.daysWritten += err.progress.daysWritten;
          summary.recordsWritten += err.progress.recordsWritten;
          summary.rejectedRecords += err.progress.rejectedRecords;
          for (const source of ['fiman', 'noaa', 'weather', 'imagery'] as const) summary.sourceRecords[source] += err.progress.sourceRecords[source];
        }
        logger.error('Backfill chunk failed', { locationId: loc.id, start: currStart.toISOString(), end: currEnd.toISOString(), error: safeError(err) });
      }
      
      currStart = new Date(currEnd.getTime() + 1); // increment by 1ms to avoid overlap
    }
  }
  
  const outcome = summary.recordsWritten === 0 ? 'failed' : summary.failedChunks || summary.partialChunks ? 'partial' : 'complete';
  logger.info('Backfill finished', { outcome, ...summary });
  res.status(outcome === 'failed' ? 503 : outcome === 'partial' ? 207 : 200).send({ outcome, ...summary });
});

function sourceData<T>(result: PromiseSettledResult<T>, source: string, locationId: string): T | null {
  if (result.status === 'fulfilled') return result.value;
  logger.warn('Backfill source unavailable; continuing independent sources', { source, locationId, error: safeError(result.reason) });
  return null;
}

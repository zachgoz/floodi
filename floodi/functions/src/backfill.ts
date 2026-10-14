import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import { fetchNoaaObserved } from './etl/noaa';
import { fetchFimanData } from './etl/fiman';
import { detectPeaks, detectFloodEvents } from './etl/processor';
import { fetchNwsObservations } from './etl/weather';
import { sanitizeFirestorePayload } from './utils/firestorePayload';

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

function getMonthsInRange(start: Date, end: Date): string[] {
  const months: string[] = [];
  const curr = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (curr <= end) {
    months.push(curr.toISOString().substring(0, 7));
    curr.setUTCMonth(curr.getUTCMonth() + 1);
  }
  return [...new Set(months)];
}

function filterByMonth<T>(data: Record<string, T>, month: string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [t, v] of Object.entries(data)) {
    if (t.startsWith(month)) out[t] = v;
  }
  return out;
}

export const runBackfillData = onRequest({ timeoutSeconds: 540, memory: '1GiB' }, async (req, res) => {
  const rawDays = req.query?.days;
  const days = rawDays === undefined ? 60 : typeof rawDays === 'string' && /^[1-9]\d*$/.test(rawDays) ? Number(rawDays) : NaN;
  if (!Number.isInteger(days) || days < 1 || days > 60) {
    res.status(400).send('days must be an integer from 1 to 60');
    return;
  }
  const endTotal = new Date();
  const startTotal = new Date(endTotal.getTime() - days * 24 * 3600_000);

  console.log(`Backfilling data from ${startTotal.toISOString()} to ${endTotal.toISOString()}...`);

  // Process in 15-day chunks to respect NOAA limits
  const CHUNK_MS = 15 * 24 * 3600_000;

  for (const loc of LOCATIONS) {
    console.log(`Processing ${loc.id}...`);
    
    let currStart = new Date(startTotal);
    while (currStart < endTotal) {
      let currEnd = new Date(currStart.getTime() + CHUNK_MS);
      if (currEnd > endTotal) currEnd = endTotal;
      
      console.log(`  Fetching chunk ${currStart.toISOString()} to ${currEnd.toISOString()}...`);
      
      try {
        const [fimanResult, noaaResult, weatherResult] = await Promise.allSettled([
          fetchFimanData(loc.fimanSensorId, currStart, currEnd, loc.navd88ToMllwOffset),
          fetchNoaaObserved(loc.noaaStationId, currStart, currEnd),
          fetchNwsObservations(loc.coords.lat, loc.coords.lon, currStart, currEnd)
        ]);
        const fimanData = sourceData(fimanResult, 'FiMAN observations', loc.id);
        const noaaData = sourceData(noaaResult, 'NOAA observations', loc.id);
        const weatherData = sourceData(weatherResult, 'weather observations', loc.id);
        
        const months = getMonthsInRange(currStart, currEnd);
        for (const month of months) {
          const monthFiman = filterByMonth(fimanData?.waterLevels || {}, month);
          const monthImagery = filterByMonth(fimanData?.imagery || {}, month);
          const monthNoaa = filterByMonth(noaaData || {}, month);
          const monthWeather = filterByMonth(weatherData || {}, month);
          const available = Object.fromEntries(Object.entries(sanitizeFirestorePayload({
            fiman: monthFiman, noaa: monthNoaa, imagery: monthImagery, weather: monthWeather,
          })).map(([source, records]) => [source, Object.fromEntries(Object.entries(records)
            .filter(([, record]) => !(record && typeof record === 'object' && !Object.keys(record).length)))] as const)
            .filter(([, records]) => Object.keys(records).length));
          
          if (Object.keys(available).length > 0) {
            console.log(`    Writing ${Object.keys(monthFiman).length} FiMAN, ${Object.keys(monthNoaa).length} NOAA records for ${month}...`);
            const monthRef = db.doc(`locations/${loc.id}/observations/${month}`);
            // Atomic nested-field merge keeps older samples and partially
            // available weather fields without reading or rewriting the month.
            await monthRef.set(sanitizeFirestorePayload({
              ...available,
              lastUpdated: new Date().toISOString(),
            }), { merge: true });
          }
        }

        // Deterministic IDs upsert recovered peaks/events. Never delete a
        // whole month of derived history for a partial-range recovery.
        const peaks = detectPeaks(fimanData?.waterLevels || {});
        for (const peak of peaks) {
          const peakId = `fiman_${peak.t.replace(/[:.-]/g, '')}`;
          await db.doc(`locations/${loc.id}/peaks/${peakId}`).set(sanitizeFirestorePayload({
            t: peak.t,
            v: peak.v,
            source: 'fiman',
            type: 'observed'
          }), { merge: true });
        }

        const events = detectFloodEvents(fimanData?.waterLevels || {}, loc.thresholds);
        for (const event of events) {
          const eventId = `fiman_${event.startTime.replace(/[:.-]/g, '')}`;
          await db.doc(`locations/${loc.id}/flood_events/${eventId}`).set(sanitizeFirestorePayload({
            ...event,
            source: 'fiman'
          }), { merge: true });
        }

      } catch (err) {
        console.error(`    Error backfilling chunk for ${loc.id}:`, err);
      }
      
      currStart = new Date(currEnd.getTime() + 1); // increment by 1ms to avoid overlap
    }
  }
  
  console.log('Backfill complete!');
  res.status(200).send('Backfill complete');
});

function sourceData<T>(result: PromiseSettledResult<T>, source: string, locationId: string): T | null {
  if (result.status === 'fulfilled') return result.value;
  console.warn(`Failed to backfill ${source} for ${locationId}; other available sources will continue:`, result.reason);
  return null;
}

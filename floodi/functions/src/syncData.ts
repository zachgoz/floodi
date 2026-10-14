import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { fetchNoaaObserved, fetchNoaaPredictions } from './etl/noaa';
import { fetchFimanData } from './etl/fiman';
import { detectPeaks, detectFloodEvents } from './etl/processor';
import { fetchNwsObservations, fetchNwsForecast } from './etl/weather';
import { persistImage } from './utils/storage';
import { sanitizeFirestorePayload } from './utils/firestorePayload';

// Initialize admin if not already
if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Hardcoded locations for the ETL. 
 */
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



export const syncWaterLevels = onSchedule({
  schedule: 'every 10 minutes',
  memory: '1GiB',
  timeoutSeconds: 540
}, async (event) => {
  const now = new Date();
  const start = new Date(now.getTime() - 24 * 3600_000); // Lookback 24h
  const end = now;

  for (const loc of LOCATIONS) {
    try {
      console.log(`Syncing observed data for ${loc.id}...`);
      
      const [noaaResult, fimanResult, weatherResult] = await Promise.allSettled([
        fetchNoaaObserved(loc.noaaStationId, start, end),
        fetchFimanData(loc.fimanSensorId, start, end, loc.navd88ToMllwOffset),
        fetchNwsObservations(loc.coords.lat, loc.coords.lon, start, end)
      ]);
      const noaaData = sourceData(noaaResult, 'NOAA observations', loc.id);
      const fimanData = sourceData(fimanResult, 'FiMAN observations', loc.id);
      const weatherData = sourceData(weatherResult, 'weather observations', loc.id);

      // 1. Persist Selective Imagery
      const persistedImagery: Record<string, Record<string, string>> = {};
      for (const [t, cams] of Object.entries(fimanData?.imagery || {})) {
        const v = fimanData?.waterLevels[t];
        const date = new Date(t);
        const isTopOfHour = date.getUTCMinutes() < 10;
        const isFlood = v !== undefined && Number.isFinite(v) && v >= loc.thresholds.minor;

        if (isFlood || isTopOfHour) {
          persistedImagery[t] = {};
          for (const [camId, url] of Object.entries(cams)) {
            try {
              const dest = `imagery/${loc.id}/${camId}/${t.replace(/[:.-]/g, '')}.jpg`;
              await persistImage(url, dest);
              persistedImagery[t][camId] = `storage://${dest}`;
            } catch (err) {
              console.error(`Failed to persist image for ${camId} at ${t}:`, err);
              persistedImagery[t][camId] = url;
            }
          }
        } else {
          persistedImagery[t] = cams;
        }
      }

      // 2. Merge only individual supplied fields atomically. Reading and
      // rewriting whole monthly maps is unnecessary and can expire or race.
      const months = getMonthsInRange(start, end);
      for (const month of months) {
        const monthRef = db.doc(`locations/${loc.id}/observations/${month}`);
        
        const monthNoaa = filterByMonth(noaaData || {}, month);
        const monthFiman = filterByMonth(fimanData?.waterLevels || {}, month);
        const monthImagery = filterByMonth(persistedImagery, month);
        const monthWeather = filterByMonth(weatherData || {}, month);
        const available = availableBucketFields({ noaa: monthNoaa, fiman: monthFiman, imagery: monthImagery, weather: monthWeather });
        if (!Object.keys(available).length) continue;

        await monthRef.set(sanitizeFirestorePayload({ ...available, lastUpdated: now.toISOString() }), { merge: true });
      }

      // 3. Process Peaks and Events (Observed)
      const peaks = detectPeaks(fimanData?.waterLevels || {});
      for (const peak of peaks) {
        const peakId = `fiman_${peak.t.replace(/[:.-]/g, '')}`;
        await db.doc(`locations/${loc.id}/peaks/${peakId}`).set({
          t: peak.t,
          v: peak.v,
          source: 'fiman',
          type: 'observed'
        });
      }

      const events = detectFloodEvents(fimanData?.waterLevels || {}, loc.thresholds);
      for (const event of events) {
        const eventId = `fiman_${event.startTime.replace(/[:.-]/g, '')}`;
        const peakTime = event.peakTime;
        const peakImages = persistedImagery[peakTime] || {};

        await db.doc(`locations/${loc.id}/flood_events/${eventId}`).set({
          ...event,
          source: 'fiman',
          peakImages
        });
      }

      console.log(`Finished observed sync for ${loc.id}`);
    } catch (err) {
      console.error(`Failed to sync observed ${loc.id}:`, err);
    }
  }
});

export const syncPredictions = onSchedule({
  schedule: 'every 24 hours',
  memory: '512MiB',
  timeoutSeconds: 540
}, async (event) => {
  const now = new Date();
  const start = now;
  const end = new Date(now.getTime() + 15 * 24 * 3600_000); // 15d forecast (NWS hourly is ~7d, daily is more, but we want high res if possible)

  for (const loc of LOCATIONS) {
    try {
      console.log(`Syncing predictions for ${loc.id}...`);
      const [predictionResult, weatherResult] = await Promise.allSettled([
        fetchNoaaPredictions(loc.noaaStationId, start, end),
        fetchNwsForecast(loc.coords.lat, loc.coords.lon)
      ]);
      const predData = sourceData(predictionResult, 'NOAA predictions', loc.id);
      const weatherForecast = sourceData(weatherResult, 'weather predictions', loc.id);
      
      // Update Monthly Buckets
      const months = getMonthsInRange(start, end);
      for (const month of months) {
        const monthRef = db.doc(`locations/${loc.id}/predictions/${month}`);
        const monthData = filterByMonth(predData || {}, month);
        const monthWeather = filterByMonth(weatherForecast || {}, month);
        const available = availableBucketFields({ data: monthData, weather: monthWeather });
        if (!Object.keys(available).length) continue;
        
        await monthRef.set(sanitizeFirestorePayload({ ...available, lastUpdated: now.toISOString() }), { merge: true });
      }

      // Process Peaks (Future)
      const peaks = detectPeaks(predData || {});
      for (const peak of peaks) {
        const peakId = `pred_${peak.t.replace(/[:.-]/g, '')}`;
        await db.doc(`locations/${loc.id}/peaks/${peakId}`).set({
          t: peak.t,
          v: peak.v,
          source: 'noaa',
          type: 'predicted'
        });
      }
      console.log(`Finished prediction sync for ${loc.id}`);
    } catch (err) {
      console.error(`Failed to sync predictions for ${loc.id}:`, err);
    }
  }
});

// Helper functions
function sourceData<T>(result: PromiseSettledResult<T>, source: string, locationId: string): T | null {
  if (result.status === 'fulfilled') return result.value;
  console.warn(`Failed to fetch ${source} for ${locationId}; existing source records are preserved:`, result.reason);
  return null;
}

type BucketFields = Record<string, Record<string, unknown>>;

function availableBucketFields(fields: BucketFields): BucketFields {
  const clean = sanitizeFirestorePayload(fields);
  return Object.fromEntries(Object.entries(clean)
    .map(([source, records]) => [source, Object.fromEntries(Object.entries(records)
      .filter(([, value]) => !(value && typeof value === 'object' && !Object.keys(value).length)))] as const)
    .filter(([, records]) => Object.keys(records).length));
}

function getMonthsInRange(start: Date, end: Date): string[] {
  const months: string[] = [];
  const curr = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const finalMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (curr <= finalMonth) {
    months.push(curr.toISOString().substring(0, 7));
    curr.setUTCMonth(curr.getUTCMonth() + 1);
  }
  return months;
}

function filterByMonth<T>(data: Record<string, T>, month: string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [t, v] of Object.entries(data)) {
    if (t.startsWith(month)) out[t] = v;
  }
  return out;
}

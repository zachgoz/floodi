import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { fetchNoaaObserved, fetchNoaaPredictions } from './etl/noaa';
import { fetchFimanData } from './etl/fiman';
import { detectPeaks, detectFloodEvents } from './etl/processor';
import { fetchNwsObservations, fetchNwsForecast } from './etl/weather';
import { persistImage } from './utils/storage';

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
      
      const [noaaData, fimanData, weatherData] = await Promise.all([
        fetchNoaaObserved(loc.noaaStationId, start, end),
        fetchFimanData(loc.fimanSensorId, start, end, loc.navd88ToMllwOffset),
        fetchNwsObservations(loc.coords.lat, loc.coords.lon)
      ]);

      // 1. Persist Selective Imagery
      const persistedImagery: Record<string, Record<string, string>> = {};
      for (const [t, cams] of Object.entries(fimanData.imagery)) {
        const v = fimanData.waterLevels[t] || 0;
        const date = new Date(t);
        const isTopOfHour = date.getUTCMinutes() < 10;
        const isFlood = v >= loc.thresholds.minor;

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

      // 2. Update Monthly Buckets (Observations) via Transaction to prevent wiping data
      const months = getMonthsInRange(start, end);
      for (const month of months) {
        const monthRef = db.doc(`locations/${loc.id}/observations/${month}`);
        
        const monthNoaa = filterByMonth(noaaData, month);
        const monthFiman = filterByMonth(fimanData.waterLevels, month);
        const monthImagery = filterByMonth(persistedImagery, month);
        const monthWeather = filterByMonth(weatherData, month);

        await db.runTransaction(async (tx) => {
          const doc = await tx.get(monthRef);
          const existing = doc.exists ? doc.data() : {};
          
          tx.set(monthRef, {
            noaa: { ...(existing?.noaa || {}), ...monthNoaa },
            fiman: { ...(existing?.fiman || {}), ...monthFiman },
            imagery: { ...(existing?.imagery || {}), ...monthImagery },
            weather: { ...(existing?.weather || {}), ...monthWeather },
            lastUpdated: now.toISOString()
          }, { merge: true });
        });
      }

      // 3. Process Peaks and Events (Observed)
      const peaks = detectPeaks(fimanData.waterLevels);
      for (const peak of peaks) {
        const peakId = `fiman_${peak.t.replace(/[:.-]/g, '')}`;
        await db.doc(`locations/${loc.id}/peaks/${peakId}`).set({
          t: peak.t,
          v: peak.v,
          source: 'fiman',
          type: 'observed'
        });
      }

      const events = detectFloodEvents(fimanData.waterLevels, loc.thresholds);
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

      console.log(`Successfully synced observed ${loc.id}`);
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
      const [predData, weatherForecast] = await Promise.all([
        fetchNoaaPredictions(loc.noaaStationId, start, end),
        fetchNwsForecast(loc.coords.lat, loc.coords.lon)
      ]);
      
      // Update Monthly Buckets
      const months = getMonthsInRange(start, end);
      for (const month of months) {
        const monthRef = db.doc(`locations/${loc.id}/predictions/${month}`);
        const monthData = filterByMonth(predData, month);
        const monthWeather = filterByMonth(weatherForecast, month);
        
        await db.runTransaction(async (tx) => {
          const doc = await tx.get(monthRef);
          const existing = doc.exists ? doc.data() : {};
          
          tx.set(monthRef, {
            data: { ...(existing?.data || {}), ...monthData },
            weather: { ...(existing?.weather || {}), ...monthWeather },
            lastUpdated: now.toISOString()
          }, { merge: true });
        });
      }

      // Process Peaks (Future)
      const peaks = detectPeaks(predData);
      for (const peak of peaks) {
        const peakId = `pred_${peak.t.replace(/[:.-]/g, '')}`;
        await db.doc(`locations/${loc.id}/peaks/${peakId}`).set({
          t: peak.t,
          v: peak.v,
          source: 'noaa',
          type: 'predicted'
        });
      }
      console.log(`Successfully synced predictions for ${loc.id}`);
    } catch (err) {
      console.error(`Failed to sync predictions for ${loc.id}:`, err);
    }
  }
});

// Helper functions
function getMonthsInRange(start: Date, end: Date): string[] {
  const months: string[] = [];
  const curr = new Date(start);
  while (curr <= end) {
    months.push(curr.toISOString().substring(0, 7));
    curr.setMonth(curr.getMonth() + 1);
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

import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import { fetchNoaaObserved } from './etl/noaa';
import { fetchFimanData } from './etl/fiman';
import { detectPeaks, detectFloodEvents } from './etl/processor';
import { fetchNwsObservations } from './etl/weather';

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
  const curr = new Date(start.getFullYear(), start.getMonth(), 1);
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

export const runBackfillData = onRequest({ timeoutSeconds: 540, memory: '1GiB' }, async (req, res) => {
  const endTotal = new Date();
  const startTotal = new Date(endTotal.getTime() - 60 * 24 * 3600_000); // Backfill 60 days

  console.log(`Backfilling data from ${startTotal.toISOString()} to ${endTotal.toISOString()}...`);

  // Process in 15-day chunks to respect NOAA limits
  const CHUNK_MS = 15 * 24 * 3600_000;

  const clearedMonths = new Set<string>();

  for (const loc of LOCATIONS) {
    console.log(`Processing ${loc.id}...`);
    
    let currStart = new Date(startTotal);
    while (currStart < endTotal) {
      let currEnd = new Date(currStart.getTime() + CHUNK_MS);
      if (currEnd > endTotal) currEnd = endTotal;
      
      console.log(`  Fetching chunk ${currStart.toISOString()} to ${currEnd.toISOString()}...`);
      
      try {
        const [fimanData, noaaData, weatherData] = await Promise.all([
          fetchFimanData(loc.fimanSensorId, currStart, currEnd, loc.navd88ToMllwOffset),
          fetchNoaaObserved(loc.noaaStationId, currStart, currEnd),
          fetchNwsObservations(loc.coords.lat, loc.coords.lon, currStart, currEnd)
        ]);
        
        const months = getMonthsInRange(currStart, currEnd);
        for (const month of months) {
          const monthFiman = filterByMonth(fimanData.waterLevels, month);
          const monthImagery = filterByMonth(fimanData.imagery, month);
          const monthNoaa = filterByMonth(noaaData, month);
          const monthWeather = filterByMonth(weatherData, month);
          
          if (Object.keys(monthFiman).length > 0 || Object.keys(monthNoaa).length > 0) {
            console.log(`    Writing ${Object.keys(monthFiman).length} FiMAN, ${Object.keys(monthNoaa).length} NOAA records for ${month}...`);
            const monthRef = db.doc(`locations/${loc.id}/observations/${month}`);
            
            const monthKey = `${loc.id}_${month}`;
            const shouldClear = !clearedMonths.has(monthKey);
            const nextMonthStr = new Date(new Date(month + '-02').getFullYear(), new Date(month + '-02').getMonth() + 1, 1).toISOString().substring(0, 7);

            // Step 1: Clean up stale peaks/events outside the write transaction (requires composite index).
            // If the index is still building, skip cleanup gracefully — data is upserted by deterministic ID anyway.
            if (shouldClear) {
              console.log(`    Clearing existing FiMAN peaks/events for ${monthKey}...`);
              try {
                const peaksSnap = await db.collection(`locations/${loc.id}/peaks`)
                  .where('source', '==', 'fiman')
                  .where('t', '>=', month)
                  .where('t', '<', nextMonthStr)
                  .get();
                const peakBatch = db.batch();
                peaksSnap.docs.forEach(d => peakBatch.delete(d.ref));
                await peakBatch.commit();

                const eventsSnap = await db.collection(`locations/${loc.id}/flood_events`)
                  .where('source', '==', 'fiman')
                  .where('startTime', '>=', month)
                  .where('startTime', '<', nextMonthStr)
                  .get();
                const eventsBatch = db.batch();
                eventsSnap.docs.forEach(d => eventsBatch.delete(d.ref));
                await eventsBatch.commit();
              } catch (indexErr: any) {
                // Index may still be building — log and continue. Peaks are upserted by deterministic ID.
                console.warn(`    Skipping peaks/events cleanup for ${monthKey} (index not ready): ${indexErr.message}`);
              }
            }

            // Step 2: Write observation data (fiman, noaa, weather, imagery).
            await db.runTransaction(async (tx) => {
              const doc = await tx.get(monthRef);
              const existing = doc.exists ? doc.data() : {};

              tx.set(monthRef, {
                fiman: { ...(shouldClear ? {} : (existing?.fiman || {})), ...monthFiman },
                noaa: { ...(shouldClear ? {} : (existing?.noaa || {})), ...monthNoaa },
                imagery: { ...(shouldClear ? {} : (existing?.imagery || {})), ...monthImagery },
                weather: { ...(shouldClear ? {} : (existing?.weather || {})), ...monthWeather },
                lastUpdated: new Date().toISOString()
              }, { merge: true });
            });
            
            clearedMonths.add(monthKey);
          }
        }

        // Process Peaks and Events from the backfilled data
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
          await db.doc(`locations/${loc.id}/flood_events/${eventId}`).set({
            ...event,
            source: 'fiman'
          });
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

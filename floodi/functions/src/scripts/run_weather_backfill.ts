/**
 * Standalone script to backfill weather data for all locations.
 * Usage: npx ts-node src/scripts/run_weather_backfill.ts
 *
 * This script fetches historical weather data from NWS + Open-Meteo and writes it
 * to Firestore, merging with existing data (not clearing other fields).
 */

import * as admin from 'firebase-admin';
import { fetchNwsObservations } from '../etl/weather';
import { writeObservationBuckets } from '../utils/observationBuckets';

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

const LOCATIONS = [
  {
    id: 'carolina-beach',
    coords: { lat: 34.0352, lon: -77.8931 },
  }
];

async function run() {
  const endTotal = new Date();
  const startTotal = new Date(endTotal.getTime() - 60 * 24 * 3600_000); // 60 days back

  console.log(`Backfilling weather from ${startTotal.toISOString()} to ${endTotal.toISOString()}\n`);

  // Open-Meteo supports up to 60 days with past_days. We fetch the entire
  // range in one call (it handles large windows efficiently) and then split by month.
  const CHUNK_MS = 30 * 24 * 3600_000; // 30-day chunks to stay within API limits

  for (const loc of LOCATIONS) {
    console.log(`\n=== ${loc.id} ===`);

    let currStart = new Date(startTotal);
    while (currStart < endTotal) {
      let currEnd = new Date(currStart.getTime() + CHUNK_MS);
      if (currEnd > endTotal) currEnd = endTotal;

      console.log(`Fetching ${currStart.toISOString().substring(0, 10)} → ${currEnd.toISOString().substring(0, 10)}...`);

      try {
        const weatherData = await fetchNwsObservations(
          loc.coords.lat,
          loc.coords.lon,
          currStart,
          currEnd
        );

        const allKeys = Object.keys(weatherData).sort();
        console.log(`  Got ${allKeys.length} hourly points.`);

        const result = await writeObservationBuckets(db, loc.id, { weather: weatherData }, { now: endTotal, observedThrough: currEnd });
        console.log(`  Wrote ${result.recordsWritten} observations across ${result.daysWritten} daily buckets.`);
      } catch (err) {
        console.error(`  Error for chunk starting ${currStart.toISOString()}:`, err);
        process.exitCode = 1;
      }

      currStart = new Date(currEnd.getTime() + 1);
    }
  }

  console.log('\n✅ Weather backfill complete!');
}

run();

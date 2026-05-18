/**
 * Data Service for FloodCast
 * 
 * Provides centralized access to water level observations, predictions,
 * and flood events stored in Firestore. Uses a bucket-based model
 * (monthly documents) for efficient fetching and caching.
 */

import { db, storage } from 'src/lib/firebase';
import { doc, getDoc, collection, query, where, orderBy, getDocs, limit, Timestamp } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import { fetchObservedWaterLevels, fetchPredictions as fetchNoaaPredictions } from 'src/lib/noaa';
import { LOCATIONS } from 'src/constants/locations';
import type { ObservationBucket, PredictionBucket, WaterLevelPeak, FloodEvent } from 'src/types/data';
import { markPerf, measurePerf } from 'src/lib/perfLogger';

/**
 * Resolves a URL that might be a storage:// path.
 */
export async function getImageUrl(pathOrUrl: string): Promise<string> {
  if (pathOrUrl.startsWith('storage://')) {
    const path = pathOrUrl.replace('storage://', '');
    try {
      return await getDownloadURL(ref(storage, path));
    } catch (err) {
      console.error('Failed to get download URL for', path, err);
      return '';
    }
  }
  return pathOrUrl;
}

const bucketCache: Record<string, any> = {};

/**
 * Service for accessing water level data stored in Firestore buckets.
 */

export async function prefetchMonths(locationId: string, months: string[], type: 'obs' | 'pred' = 'obs') {
  return Promise.all(
    months.map(async (month) => {
      const cacheKey = `${type}:${locationId}:${month}`;
      if (bucketCache[cacheKey]) return bucketCache[cacheKey];

      const collection = type === 'obs' ? 'observations' : 'predictions';
      bucketCache[cacheKey] = (async () => {
        try {
          const snap = await measurePerf('firestore.bucket.getDoc', () => getDoc(doc(db, `locations/${locationId}/${collection}/${month}`)), {
            locationId,
            collection,
            month,
          });
          return snap.exists() ? snap.data() : null;
        } catch (err) {
          console.warn(`Failed to prefetch ${type} for ${month}:`, err);
          delete bucketCache[cacheKey]; // Don't cache failures permanently
          return null;
        }
      })();
      return bucketCache[cacheKey];
    })
  );
}

export async function fetchObservations(locationId: string, start: Date, end: Date) {
  const requestedMonths = getMonthsInRange(start, end);
  const metadata = {
    locationId,
    start: start.toISOString(),
    end: end.toISOString(),
    requestedMonths,
  };
  
  // Proactive pre-fetch: Add previous and next month to the fetch list for seamless scrolling
  const prevMonth = new Date(start);
  prevMonth.setMonth(prevMonth.getMonth() - 1);
  const nextMonth = new Date(end);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  
  const allMonths = [...new Set([
    prevMonth.toISOString().substring(0, 7),
    ...requestedMonths,
    nextMonth.toISOString().substring(0, 7)
  ])];

  const results = await measurePerf('dataService.fetchObservations.prefetchMonths', () => prefetchMonths(locationId, allMonths, 'obs'), {
    ...metadata,
    allMonths,
  });

  const merged: { 
    noaa: Record<string, number>; 
    fiman: Record<string, number>; 
    imagery: Record<string, Record<string, string>>;
    weather: Record<string, any>;
  } = {
    noaa: {},
    fiman: {},
    imagery: {},
    weather: {}
  };

  // Only merge data for requested months into the final result
  // The others remain in bucketCache for future quick access
  for (let i = 0; i < allMonths.length; i++) {
    const month = allMonths[i];
    if (!requestedMonths.includes(month)) continue;
    
    const bucket = (await results[i]) as ObservationBucket | null;
    if (!bucket) continue;
    
    // Use Object.assign for performance with large objects
    if (bucket.noaa) Object.assign(merged.noaa, bucket.noaa);
    if (bucket.fiman) Object.assign(merged.fiman, bucket.fiman);
    if (bucket.imagery) Object.assign(merged.imagery, bucket.imagery);
    if ((bucket as any).weather) Object.assign(merged.weather, (bucket as any).weather);
  }

  markPerf('dataService.fetchObservations.complete', {
    ...metadata,
    noaaPoints: Object.keys(merged.noaa).length,
    fimanPoints: Object.keys(merged.fiman).length,
    imageryCameras: Object.keys(merged.imagery).length,
    weatherPoints: Object.keys(merged.weather).length,
  });

  return merged;
}

/**
 * High-level orchestration for water level observations.
 * Fetches from Firestore but falls back to Live NOAA API if data is stale.
 */
export async function fetchUnifiedObservations(locationId: string, start: Date, end: Date) {
  const metadata = {
    locationId,
    start: start.toISOString(),
    end: end.toISOString(),
  };
  const dbData = await measurePerf('dataService.fetchUnifiedObservations.db', () => fetchObservations(locationId, start, end)).catch(err => {
    console.warn('[dataService] fetchObservations failed:', err);
    return { noaa: {}, fiman: {}, imagery: {}, weather: {} };
  });

  const now = new Date();
  const location = LOCATIONS[locationId] || LOCATIONS['carolina-beach'];
  const stationId = location.noaaStationId;

  // Gap filling logic
  const lastPrimaryObsT = Object.keys(dbData.noaa).concat(Object.keys(dbData.fiman))
    .reduce((max, t) => {
      const ms = new Date(t).getTime();
      return ms > max ? ms : max;
    }, 0);

  const GAP_FILL_THRESHOLD_MS = 30 * 60_000;
  if (now.getTime() - lastPrimaryObsT > GAP_FILL_THRESHOLD_MS && end >= now) {
    const gapStart = new Date(Math.max(start.getTime(), lastPrimaryObsT > 0 ? lastPrimaryObsT - 60_000 : start.getTime()));
    console.log(`[dataService] DB data stale (last point: ${lastPrimaryObsT ? new Date(lastPrimaryObsT).toISOString() : 'none'}). Gap-filling with NOAA...`);
    markPerf('dataService.fetchUnifiedObservations.gapFillNeeded', {
      ...metadata,
      gapStart: gapStart.toISOString(),
      lastPrimaryObservation: lastPrimaryObsT ? new Date(lastPrimaryObsT).toISOString() : null,
    });

    const noaaLive = await measurePerf('dataService.fetchUnifiedObservations.noaaGapFill', () => fetchObservedWaterLevels({
      station: stationId,
      start: gapStart,
      end: now,
      interval: 6,
      provider: 'noaa',
    }).catch(() => null), metadata);

    if (noaaLive?.data) {
      // Merge live data into the NOAA series
      Object.assign(dbData.noaa, noaaLive.data);
      console.log(`[dataService] Gap-filled ${Object.keys(noaaLive.data).length} NOAA points`);
    }
  }

  markPerf('dataService.fetchUnifiedObservations.complete', {
    ...metadata,
    noaaPoints: Object.keys(dbData.noaa).length,
    fimanPoints: Object.keys(dbData.fiman).length,
    imageryCameras: Object.keys(dbData.imagery).length,
    weatherPoints: Object.keys(dbData.weather).length,
  });

  return dbData;
}

/**
 * Unified predictions fetcher
 */
export async function fetchUnifiedPredictions(locationId: string, start: Date, end: Date) {
  const dbData = await measurePerf('dataService.fetchUnifiedPredictions.db', () => fetchPredictions(locationId, start, end), {
    locationId,
    start: start.toISOString(),
    end: end.toISOString(),
  }).catch(err => {
    console.warn('[dataService] fetchPredictions failed:', err);
    return { data: {}, weather: {} };
  });

  // If we have no predictions or they don't cover the full range, we could fill gaps here
  // But usually predictions are static enough that DB is fine.
  
  return dbData;
}

/**
 * Extracts and formats weather data (wind/precip) from merged observation/prediction buckets
 */
export function extractWeatherData(mergedData: { weather: Record<string, any> }) {
  const wind: Record<string, { speed: number, dir: number }> = {};
  const precip: Record<string, number> = {};

  for (const [t, w] of Object.entries(mergedData.weather)) {
    if (w.windSpeed !== undefined && w.windDirection !== undefined) {
      wind[t] = { speed: w.windSpeed, dir: w.windDirection };
    }
    if (w.precip !== undefined) {
      precip[t] = w.precip;
    }
  }

  return { wind, precip };
}


export async function fetchPredictions(locationId: string, start: Date, end: Date) {
  const requestedMonths = getMonthsInRange(start, end);
  const metadata = {
    locationId,
    start: start.toISOString(),
    end: end.toISOString(),
    requestedMonths,
  };
  
  // Pre-fetch: Add next month for future planning
  const nextMonth = new Date(end);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  
  const allMonths = [...new Set([
    ...requestedMonths,
    nextMonth.toISOString().substring(0, 7)
  ])];

  const results = await measurePerf('dataService.fetchPredictions.prefetchMonths', () => prefetchMonths(locationId, allMonths, 'pred'), {
    ...metadata,
    allMonths,
  });

  const merged: { data: Record<string, number>; weather: Record<string, any> } = {
    data: {},
    weather: {}
  };

  for (let i = 0; i < allMonths.length; i++) {
    const month = allMonths[i];
    if (!requestedMonths.includes(month)) continue;

    const bucket = (await results[i]) as PredictionBucket | null;
    if (!bucket) continue;
    
    if (bucket.data) Object.assign(merged.data, bucket.data);
    // @ts-ignore
    if (bucket.weather) Object.assign(merged.weather, bucket.weather);
  }

  markPerf('dataService.fetchPredictions.complete', {
    ...metadata,
    predictionPoints: Object.keys(merged.data).length,
    weatherPoints: Object.keys(merged.weather).length,
  });

  return merged;
}

export async function fetchPeaks(locationId: string, start: Date, end: Date) {
  const q = query(
    collection(db, `locations/${locationId}/peaks`),
    where('t', '>=', start.toISOString()),
    where('t', '<=', end.toISOString()),
    orderBy('t', 'asc')
  );

  const snap = await getDocs(q);
  return snap.docs.map(d => d.data() as WaterLevelPeak);
}

export async function fetchFloodEvents(locationId: string, limitCount = 50) {
  const q = query(
    collection(db, `locations/${locationId}/flood_events`),
    orderBy('startTime', 'desc'),
    limit(limitCount)
  );

  const snap = await measurePerf('firestore.floodEvents.getDocs', () => getDocs(q), { locationId, limitCount });
  return snap.docs.map(d => d.data() as FloodEvent);
}

/**
 * Finds the most recent historical peak that is similar to the target level.
 * Used for comparing predicted floods with past real-world events.
 */
export async function findLastSimilarLevel(locationId: string, targetLevel: number, beforeTime: Date) {
  // Query observed peaks that are within a reasonable range of the target
  // We use multiple filters to narrow it down, then sort by time
  const q = query(
    collection(db, `locations/${locationId}/peaks`),
    where('type', '==', 'observed'),
    where('v', '>=', targetLevel - 1.0), // Broad window for initial query
    where('v', '<=', targetLevel + 1.0),
    where('t', '<', beforeTime.toISOString()),
    orderBy('t', 'desc'),
    limit(20)
  );

  const snap = await getDocs(q);
  const matches = snap.docs.map(d => d.data() as WaterLevelPeak);
  
  // Find the one closest to our target level
  if (matches.length === 0) return null;

  return matches.reduce((best, curr) => {
    const currDiff = Math.abs(curr.v - targetLevel);
    const bestDiff = Math.abs(best.v - targetLevel);
    return currDiff < bestDiff ? curr : best;
  });
}

// Helpers
/**
 * Generates an array of ISO date strings (YYYY-MM-DD) for each day in the range.
 * @param start Start date
 * @param end End date
 * @returns Array of day strings
 */
function getDaysInRange(start: Date, end: Date): string[] {
  const days: string[] = [];
  const curr = new Date(start);
  while (curr <= end) {
    days.push(curr.toISOString().split('T')[0]);
    curr.setDate(curr.getDate() + 1);
  }
  return [...new Set(days)];
}

/**
 * Generates an array of month strings (YYYY-MM) for each month in the range.
 * @param start Start date
 * @param end End date
 * @returns Array of month strings
 */
function getMonthsInRange(start: Date, end: Date): string[] {
  const months: string[] = [];
  const endMonth = end.toISOString().substring(0, 7);
  
  const iter = new Date(start.getFullYear(), start.getMonth(), 1);
  while (iter.toISOString().substring(0, 7) <= endMonth) {
    months.push(iter.toISOString().substring(0, 7));
    iter.setMonth(iter.getMonth() + 1);
  }
  return [...new Set(months)];
}

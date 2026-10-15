/**
 * Data Service for FloodCast
 * 
 * Provides centralized access to water level observations, predictions,
 * and flood events stored in Firestore. Uses a bucket-based model
 * (daily observations with legacy monthly history) for fetching and caching.
 */

import { db, storage } from 'src/lib/firebase';
import { doc, getDoc, collection, query, where, orderBy, getDocs, limit } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import { fetchObservedWaterLevels } from 'src/lib/noaa';
import { LOCATIONS } from 'src/constants/locations';
import type { ObservationBucket, PredictionBucket, WaterLevelPeak, FloodEvent } from 'src/types/data';
import { markPerf, measurePerf } from 'src/lib/perfLogger';
import { reportClientError } from 'src/lib/errorReporting';

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

const bucketCache: Record<string, { timestamp: number; value: Promise<unknown> }> = {};
export function clearDataServiceCache() {
  Object.keys(bucketCache).forEach(key => delete bucketCache[key]);
}

/**
 * Service for accessing water level data stored in Firestore buckets.
 */

export async function prefetchMonths(locationId: string, months: string[], type: 'obs' | 'pred' = 'obs') {
  return Promise.all(
    months.map(async (month) => {
      const cacheKey = `${type}:${locationId}:${month}`;
      if (bucketCache[cacheKey] && Date.now() - bucketCache[cacheKey].timestamp < 5 * 60_000) return bucketCache[cacheKey].value;

      const collection = type === 'obs' ? 'observations' : 'predictions';
      const value = (async () => {
        try {
          const snap = await measurePerf('firestore.bucket.getDoc', () => getDoc(doc(db, `locations/${locationId}/${collection}/${month}`)), {
            locationId,
            collection,
            month,
          });
          return snap.exists() ? snap.data() : null;
        } catch (err) {
          console.warn(`Failed to prefetch ${type} for ${month}:`, err);
          reportClientError('water_data_unavailable', err, { provider: 'firestore' });
          delete bucketCache[cacheKey]; // Don't cache failures permanently
          return null;
        }
      })();
      bucketCache[cacheKey] = { timestamp: Date.now(), value };
      return value;
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
  const prevMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
  const nextMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 1));
  
  const allMonths = [...new Set([
    prevMonth.toISOString().substring(0, 7),
    ...requestedMonths,
    nextMonth.toISOString().substring(0, 7)
  ])];

  const now = new Date();
  const days = getDaysInRange(start, new Date(Math.min(+end, +now)));
  // Legacy months remain readable while daily buckets replace unbounded month
  // writes. Fetch only days in the requested range, and use the same TTL cache.
  const ids = [...allMonths, ...days];
  const results = await measurePerf('dataService.fetchObservations.prefetchMonths', () => prefetchMonths(locationId, ids, 'obs'), {
    ...metadata,
    allMonths,
  });

  const merged: { 
    noaa: Record<string, number>; 
    fiman: Record<string, number>; 
    imagery: Record<string, Record<string, string>>;
    weather: Record<string, Record<string, unknown>>;
  } = {
    noaa: {},
    fiman: {},
    imagery: {},
    weather: {}
  };
  const archivedImagery: Record<string, Record<string, string>> = {};

  // Only merge data for requested months into the final result
  // The others remain in bucketCache for future quick access
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (id.length === 7 && !requestedMonths.includes(id)) continue;
    
    const bucket = (await results[i]) as ObservationBucket | null;
    if (!bucket) continue;
    
    for (const source of ['noaa', 'fiman'] as const) {
      for (const [t, value] of Object.entries(bucket[source] || {})) {
        const ms = observationTimestamp(t);
        if (Number.isFinite(ms) && ms <= +now && Number.isFinite(value)) merged[source][new Date(ms).toISOString()] = value;
      }
    }
    // Both timestamp->camera and camera->timestamp occurred in legacy data.
    for (const source of ['imagery', 'persistedImagery'] as const) {
      for (const [outer, entries] of Object.entries(bucket[source] || {})) {
        if (!entries || typeof entries !== 'object') continue;
        const outerMs = observationTimestamp(outer);
        for (const [key, url] of Object.entries(entries)) {
          const ms = Number.isFinite(outerMs) ? outerMs : observationTimestamp(key);
          const camera = Number.isFinite(outerMs) ? key : outer;
          if (!Number.isFinite(ms) || ms > +now || typeof url !== 'string') continue;
          const target = url.startsWith('storage://') ? archivedImagery : merged.imagery;
          if (source === 'persistedImagery' && target !== archivedImagery) continue;
          (target[camera] ||= {})[new Date(ms).toISOString()] = url;
        }
      }
    }
    const updated = Date.parse(bucket.lastUpdated || '');
    const weatherCutoff = id.length === 7 ? (Number.isFinite(updated) ? Math.min(+now, updated) : 0) : +now;
    for (const [t, weather] of Object.entries(bucket.weather || {})) {
      const ms = observationTimestamp(t);
      if (!Number.isFinite(ms) || ms > weatherCutoff || !weather || typeof weather !== 'object' || Array.isArray(weather)) continue;
      const canonical = new Date(ms).toISOString();
      merged.weather[canonical] = { ...merged.weather[canonical], ...weather };
    }
  }
  for (const [camera, images] of Object.entries(archivedImagery)) merged.imagery[camera] = { ...merged.imagery[camera], ...images };

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
 * Refreshes each stale source from its own provider while retaining archived
 * history. NOAA freshness must never hide a stopped local gauge archive.
 */
export async function fetchUnifiedObservations(locationId: string, start: Date, end: Date) {
  const metadata = {
    locationId,
    start: start.toISOString(),
    end: end.toISOString(),
  };
  const dbData: Awaited<ReturnType<typeof fetchObservations>> = await measurePerf('dataService.fetchUnifiedObservations.db', () => fetchObservations(locationId, start, end)).catch(err => {
    console.warn('[dataService] fetchObservations failed:', err);
    reportClientError('water_data_unavailable', err, { provider: 'firestore' });
    return { noaa: {}, fiman: {}, imagery: {}, weather: {} };
  });

  const now = new Date();
  const location = LOCATIONS[locationId] || LOCATIONS['carolina-beach'];
  const stationId = location.noaaStationId;

  const GAP_FILL_THRESHOLD_MS = 30 * 60_000;
  const latestObservation = (series: Record<string, number>) => Object.entries(series)
    .reduce((latest, [timestamp, value]) => {
      const ms = Date.parse(timestamp);
      return Number.isFinite(value) && Number.isFinite(ms) && ms <= +now ? Math.max(latest, ms) : latest;
    }, 0);
  const latestNoaa = latestObservation(dbData.noaa);
  const latestFiman = latestObservation(dbData.fiman);
  const noaaStale = +now - latestNoaa > GAP_FILL_THRESHOLD_MS;
  const fimanStale = !!location.webcamIds?.length && +now - latestFiman > GAP_FILL_THRESHOLD_MS;

  // Panning historical or future-only windows must not trigger current readings.
  if (start <= now && end >= now && (noaaStale || fimanStale)) {
    const provider = noaaStale && fimanStale ? 'both' : fimanStale ? 'fiman' : 'noaa';
    reportClientError('water_data_fallback', undefined, { provider: 'firestore' });
    const staleTimes = [
      ...(noaaStale ? [latestNoaa] : []),
      ...(fimanStale ? [latestFiman] : []),
    ];
    const firstMissingAt = Math.min(...staleTimes);
    const gapStart = new Date(Math.max(+start, firstMissingAt > 0 ? firstMissingAt - 60_000 : +start));
    markPerf('dataService.fetchUnifiedObservations.gapFillNeeded', {
      ...metadata,
      provider,
      gapStart: gapStart.toISOString(),
      latestNoaa: latestNoaa ? new Date(latestNoaa).toISOString() : null,
      latestFiman: latestFiman ? new Date(latestFiman).toISOString() : null,
    });

    const live = await measurePerf('dataService.fetchUnifiedObservations.liveGapFill', () => fetchObservedWaterLevels({
      station: stationId,
      start: gapStart,
      end: now,
      interval: 6,
      datum: 'MLLW',
      units: 'english',
      provider,
    }).catch(err => {
      console.warn(`[dataService] ${provider} observation refresh failed:`, err);
      reportClientError('water_data_unavailable', err, { provider: provider === 'both' ? 'app' : provider });
      return null;
    }), metadata);

    if (live) {
      const mergeReadings = (source: 'fiman' | 'noaa', series: Record<string, number>) => {
        for (const [timestamp, value] of Object.entries(series)) {
          const ms = Date.parse(timestamp);
          if (Number.isFinite(value) && Number.isFinite(ms) && ms >= +gapStart && ms <= +now) {
            dbData[source][timestamp] = value;
          }
        }
      };
      // A failed FiMAN request can return NOAA fallback data. Honor its declared
      // source; another station's readings must never become local measurements.
      mergeReadings(live.source, live.data);
      if (live.alternate) mergeReadings(live.source === 'fiman' ? 'noaa' : 'fiman', live.alternate);
      for (const [camera, images] of Object.entries(live.imagery || {})) {
        const cameraImages = dbData.imagery[camera] ||= {};
        for (const [t, url] of Object.entries(images)) {
          if (!cameraImages[t]?.startsWith('storage://')) cameraImages[t] = url;
        }
      }
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
export function extractWeatherData(mergedData: { weather: Record<string, Record<string, unknown>> }) {
  const wind: Record<string, { speed: number, dir: number }> = {};
  const precip: Record<string, number> = {};

  for (const [t, w] of Object.entries(mergedData.weather)) {
    if (typeof w.windSpeed === 'number' && Number.isFinite(w.windSpeed) && typeof w.windDirection === 'number' && Number.isFinite(w.windDirection)) {
      wind[t] = { speed: w.windSpeed, dir: w.windDirection };
    }
    if (typeof w.precip === 'number' && Number.isFinite(w.precip)) {
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

  const merged: { data: Record<string, number>; weather: Record<string, Record<string, unknown>> } = {
    data: {},
    weather: {}
  };

  for (let i = 0; i < allMonths.length; i++) {
    const month = allMonths[i];
    if (!requestedMonths.includes(month)) continue;

    const bucket = (await results[i]) as PredictionBucket | null;
    if (!bucket) continue;
    
    if (bucket.data) Object.assign(merged.data, bucket.data);
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
function observationTimestamp(value: string): number {
  return /(Z|[+-]\d\d:\d\d)$/i.test(value) ? Date.parse(value) : NaN;
}

/**
 * Generates an array of ISO date strings (YYYY-MM-DD) for each day in the range.
 * @param start Start date
 * @param end End date
 * @returns Array of day strings
 */
function getDaysInRange(start: Date, end: Date): string[] {
  const days: string[] = [];
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || start > end) return days;
  for (let ms = Math.floor(+start / 86_400_000) * 86_400_000; ms <= +end; ms += 86_400_000) {
    days.push(new Date(ms).toISOString().split('T')[0]);
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
  
  const iter = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (iter.toISOString().substring(0, 7) <= endMonth) {
    months.push(iter.toISOString().substring(0, 7));
    iter.setUTCMonth(iter.getUTCMonth() + 1);
  }
  return [...new Set(months)];
}

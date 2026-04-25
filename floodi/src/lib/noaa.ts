/**
 * @fileoverview NOAA Tides and Currents API Integration
 * 
 * This module provides a comprehensive interface to the NOAA Tides and Currents API,
 * enabling FloodCast to retrieve water level data, predictions, and perform surge
 * analysis for flood forecasting.
 * 
 * Key Features:
 * - Observed water level data retrieval
 * - Tide predictions from harmonic analysis
 * - Storm surge estimation through observed vs predicted comparison
 * - Flood threshold crossing detection
 * - Future water level projections with surge adjustment
 * 
 * @see {@link https://api.tidesandcurrents.noaa.gov/api/prod/} NOAA API Documentation
 * @see {@link https://tidesandcurrents.noaa.gov/web_services_info.html} NOAA Web Services Info
 */

/**
 * Time series data structure mapping ISO datetime strings to water level values
 * 
 * @typedef {Record<string, number>} TimeSeries
 * @example
 * {
 *   "2024-01-15T12:00Z": 2.45,  // Water level in feet (or meters) at noon UTC
 *   "2024-01-15T12:06Z": 2.52,  // 6 minutes later
 *   "2024-01-15T12:12Z": 2.58   // 12 minutes later
 * }
 */
export type TimeSeries = Record<string, number>; // ISO minute string (UTC) -> value

/**
 * Base URL for the NOAA Tides and Currents API
 * This is the production endpoint that provides real-time and predicted data
 */
const NOAA_BASE = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';

/**
 * Formats a Date object into NOAA's expected datetime format
 * 
 * NOAA API requires dates in 'yyyymmdd HH:MM' format in GMT/UTC timezone.
 * This function converts JavaScript Date objects to this specific format.
 * 
 * @param {Date} d - The date to format
 * @returns {string} Formatted datetime string for NOAA API (e.g., "20240115 14:30")
 * 
 * @example
 * const date = new Date('2024-01-15T14:30:00Z');
 * console.log(fmtBeginEnd(date)); // "20240115 14:30"
 */
function fmtBeginEnd(d: Date): string {
  // NOAA expects 'yyyymmdd HH:MM' in GMT
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${y}${m}${day} ${hh}:${mm}`;
}

/**
 * Splits a date range into smaller chunks to respect API limits (e.g., NOAA 31-day limit)
 */
function splitDateRange(start: Date, end: Date, maxDays: number): { s: Date; e: Date }[] {
  const chunks: { s: Date; e: Date }[] = [];
  let curr = new Date(start);
  const maxMs = maxDays * 24 * 3600_000;

  while (curr < end) {
    let chunkEnd = new Date(curr.getTime() + maxMs);
    if (chunkEnd > end) chunkEnd = end;
    chunks.push({ s: new Date(curr), e: new Date(chunkEnd) });
    // Advance slightly (1ms) to avoid overlapping the exact boundary if needed, 
    // but for time series we usually want contiguous chunks.
    curr = chunkEnd;
  }
  return chunks;
}

// (removed unused isoMinute helper)

/**
 * Makes HTTP requests to the NOAA Tides and Currents API with error handling
 * 
 * This function handles the low-level API communication, including URL construction,
 * CORS handling, HTTP error checking, and NOAA-specific error response parsing.
 * 
 * @param {Record<string, string | number>} params - Query parameters for the API request
 * @returns {Promise<any>} Parsed JSON response from NOAA API
 * @throws {Error} When HTTP request fails or NOAA API returns an error
 * 
 * @example
 * const params = {
 *   product: 'water_level',
 *   station: '8518750',
 *   begin_date: '20240115 12:00',
 *   end_date: '20240115 18:00'
 * };
 * const data = await requestNOAA(params);
 */
async function requestNOAA(params: Record<string, string | number>): Promise<unknown> {
  const usp = new URLSearchParams(params as Record<string, string>);
  const url = `${NOAA_BASE}?${usp.toString()}`;
  
  // Make request with CORS enabled for web browser compatibility
  const res = await fetch(url, { mode: 'cors' });
  
  // Check for HTTP-level errors — also try to read body for NOAA's own error message
  if (!res.ok) {
    let reason = '';
    try {
      const body = await res.json() as { error?: { message?: string } };
      if (body?.error?.message) {
        reason = body.error.message.trim();
      }
    } catch { /* body wasn't JSON, ignore */ }
    throw new Error(
      `HTTP Status\t${res.status}\n` +
      (reason ? `Reason\t${reason}\n` : '') +
      `Request URL\t${url}`
    );
  }

  const data: unknown = await res.json();

  // Check for NOAA API-specific errors in response body (HTTP 200 but error field present)
  if (typeof data === 'object' && data && 'error' in data) {
    const err = (data as { error?: { message?: string } }).error;
    if (err) {
      // Log more details for debugging
      console.error('NOAA API Internal Error:', {
        message: err.message,
        url,
        params
      });
      throw new Error(
        `HTTP Status\t200\n` +
        `Reason\t${err.message?.trim() || 'unknown'}\n` +
        `Request URL\t${url}`
      );
    }
  }

  
  return data;
}

/**
 * Fetches observed water level data from NOAA stations
 * 
 * Retrieves actual measured water levels from NOAA tide gauges. This data
 * represents real-world conditions and is essential for storm surge analysis
 * when compared against harmonic predictions.
 * 
 * @param {Object} opts - Configuration options for the request
 * @param {string} opts.station - NOAA station ID (e.g., '8518750' for New London, CT)
 * @param {Date} opts.start - Start time for data retrieval (inclusive)
 * @param {Date} opts.end - End time for data retrieval (inclusive)
 * @param {number} [opts.interval=6] - Data interval in minutes (6 is standard for water levels)
 * @param {string} [opts.datum='MLLW'] - Vertical datum reference (MLLW, MSL, MTL, etc.)
 * @param {'english' | 'metric'} [opts.units='english'] - Unit system (english=feet, metric=meters)
 * @returns {Promise<TimeSeries>} Time series of observed water levels
 * @throws {Error} When station doesn't exist, date range is invalid, or API fails
 * 
 * @example
 * // Get 24 hours of observed data for New London, CT
 * const observed = await fetchObservedWaterLevels({
 *   station: '8518750',
 *   start: new Date('2024-01-15T00:00Z'),
 *   end: new Date('2024-01-16T00:00Z'),
 *   interval: 6,  // 6-minute intervals (standard)
 *   datum: 'MLLW' // Mean Lower Low Water
 * });
 */
export async function fetchObservedWaterLevels(opts: {
  station: string;
  start: Date;
  end: Date;
  interval?: number; // minutes
  datum?: string;
  units?: 'english' | 'metric';
}): Promise<TimeSeries> {
  const { station, start, end, interval = 6, datum = 'MLLW', units = 'english' } = opts;
  
  // NOAA CO-OPS has a 31-day limit for water_level requests.
  const chunks = splitDateRange(start, end, 31);
  
  const fetchChunk = async (s: Date, e: Date) => {
    const params = {
      product: 'water_level',
      application: 'canal-dr-flood',
      format: 'json',
      time_zone: 'gmt',
      units,
      datum,
      station,
      interval: String(interval),
      begin_date: fmtBeginEnd(s),
      end_date: fmtBeginEnd(e),
    };
    
    try {
      const data = await requestNOAA(params) as { data?: Array<{ v: string; t: string }> };
      const chunkOut: TimeSeries = {};
      for (const row of data?.data ?? []) {
        const v = parseFloat(row.v);
        const t = row.t as string;
        if (!isFinite(v) || !t) continue;
        const iso = t.replace(' ', 'T') + 'Z';
        chunkOut[iso] = v;
      }
      return chunkOut;
    } catch (err) {
      console.warn(`Chunk fetch failed [${fmtBeginEnd(s)} - ${fmtBeginEnd(e)}]:`, err);
      return {};
    }
  };

  const results = await Promise.all(chunks.map(c => fetchChunk(c.s, c.e)));
  return Object.assign({}, ...results);
}

/**
 * Fetches harmonic tide predictions from NOAA
 * 
 * Retrieves tide predictions based on harmonic analysis of long-term tidal patterns.
 * These predictions represent astronomical tides without weather effects (storm surge).
 * Comparing predictions to observations reveals storm surge and other meteorological impacts.
 * 
 * @param {Object} opts - Configuration options for the request
 * @param {string} opts.station - NOAA station ID (e.g., '8518750' for New London, CT)
 * @param {Date} opts.start - Start time for predictions (inclusive)
 * @param {Date} opts.end - End time for predictions (inclusive)
 * @param {number} [opts.interval=6] - Prediction interval in minutes
 * @param {string} [opts.datum='MLLW'] - Vertical datum reference
 * @param {'english' | 'metric'} [opts.units='english'] - Unit system
 * @returns {Promise<TimeSeries>} Time series of predicted water levels
 * @throws {Error} When station doesn't exist, date range is invalid, or API fails
 * 
 * @example
 * // Get 48 hours of tide predictions
 * const predictions = await fetchPredictions({
 *   station: '8518750',
 *   start: new Date('2024-01-15T00:00Z'),
 *   end: new Date('2024-01-17T00:00Z'),
 *   datum: 'MLLW'
 * });
 */
export async function fetchPredictions(opts: {
  station: string;
  start: Date;
  end: Date;
  interval?: number; // minutes
  datum?: string;
  units?: 'english' | 'metric';
}): Promise<TimeSeries> {
  const { station, start, end, interval = 6, datum = 'MLLW', units = 'english' } = opts;
  
  // While predictions have a larger limit (years), we chunk at 31 days for consistency
  // and to avoid potential timeout issues with very large payloads.
  const chunks = splitDateRange(start, end, 31);

  const fetchChunk = async (s: Date, e: Date) => {
    const params = {
      product: 'predictions',
      application: 'canal-dr-flood',
      format: 'json',
      time_zone: 'gmt',
      units,
      datum,
      station,
      interval: String(interval),
      begin_date: fmtBeginEnd(s),
      end_date: fmtBeginEnd(e),
    };
    
    try {
      const data = await requestNOAA(params) as { predictions?: Array<{ v: string; t: string }> };
      const chunkOut: TimeSeries = {};
      for (const row of data?.predictions ?? []) {
        const v = parseFloat(row.v);
        const t = row.t as string;
        if (!isFinite(v) || !t) continue;
        const iso = t.replace(' ', 'T') + 'Z';
        chunkOut[iso] = v;
      }
      return chunkOut;
    } catch (err) {
      console.warn(`Predictions chunk fetch failed [${fmtBeginEnd(s)} - ${fmtBeginEnd(e)}]:`, err);
      return {};
    }
  };

  const results = await Promise.all(chunks.map(c => fetchChunk(c.s, c.e)));
  return Object.assign({}, ...results);
}

/**
 * Estimates storm surge offset by comparing observed vs predicted water levels
 * 
 * Storm surge is the meteorological component of water level rise caused by wind,
 * atmospheric pressure, and other weather factors. This function calculates the
 * median difference between observed and predicted levels to estimate current surge.
 * 
 * The median is used instead of mean to reduce impact of outliers and data gaps.
 * This surge offset can then be applied to future predictions for improved forecasting.
 * 
 * @param {TimeSeries} observed - Actual measured water levels
 * @param {TimeSeries} predicted - Harmonic tide predictions
 * @returns {Object} Surge analysis results
 * @returns {number} returns.offset - Estimated surge offset in same units as input data
 * @returns {number} returns.n - Number of matching data points used in calculation
 * 
 * @example
 * const observed = await fetchObservedWaterLevels({...});
 * const predicted = await fetchPredictions({...});
 * const { offset, n } = estimateSurgeOffset(observed, predicted);
 * 
 * if (n > 10) {  // Ensure sufficient data
 *   console.log(`Current surge: ${offset.toFixed(2)} feet based on ${n} observations`);
 * }
 */
export function estimateSurgeOffset(observed: TimeSeries, predicted: TimeSeries): { offset: number; n: number } {
  const diffs: number[] = [];
  
  // Find all timestamps where both observed and predicted data exist
  for (const k of Object.keys(observed)) {
    if (k in predicted) {
      // Calculate difference: positive = surge above prediction, negative = below
      diffs.push(observed[k] - predicted[k]);
    }
  }
  
  // Return zero offset if no matching data points
  if (diffs.length === 0) return { offset: 0, n: 0 };
  
  // Sort differences to find median (robust against outliers)
  diffs.sort((a, b) => a - b);
  const mid = Math.floor(diffs.length / 2);
  
  // Calculate median: middle value for odd count, average of middle two for even count
  const offset = diffs.length % 2 ? diffs[mid] : (diffs[mid - 1] + diffs[mid]) / 2;
  
  return { offset, n: diffs.length };
}

/**
 * Finds the next time when water levels will cross above a flood threshold
 * 
 * This function analyzes time series data to predict when water levels will exceed
 * a specified threshold, providing early flood warning capabilities. It uses linear
 * interpolation between data points for more accurate crossing time estimation.
 * 
 * @param {TimeSeries} series - Water level time series (observed + surge adjusted predictions)
 * @param {number} threshold - Flood threshold to detect (in same units as series data)
 * @param {Date} now - Current time reference point
 * @returns {Object|null} Crossing information or null if no crossing found
 * @returns {Date} returns.tCross - Estimated time of threshold crossing
 * @returns {number} returns.leadMinutes - Minutes from now until crossing (warning lead time)
 * 
 * @example
 * // Find when water will exceed 4.5 feet (minor flood stage)
 * const crossing = findNextThresholdCrossing(adjustedSeries, 4.5, new Date());
 * 
 * if (crossing) {
 *   const { tCross, leadMinutes } = crossing;
 *   console.log(`Flood threshold will be crossed at ${tCross}`);
 *   console.log(`Warning lead time: ${leadMinutes} minutes`);
 * }
 */
export function findNextThresholdCrossing(series: TimeSeries, threshold: number, now: Date): {
  tCross: Date;
  leadMinutes: number;
} | null {
  // Convert TimeSeries to sorted array of [Date, value] pairs
  const entries = Object.entries(series)
    .map(([k, v]) => [new Date(k), v] as const)
    .sort((a, b) => a[0].getTime() - b[0].getTime());
  
  // Need at least 2 points to detect crossings
  if (entries.length < 2) return null;
  
  const nowMs = now.getTime();
  
  // Filter to recent past and future data (keep 6 minutes of past for context)
  const filtered = entries.filter(([t]) => t.getTime() >= nowMs - 6 * 60 * 1000);
  if (filtered.length < 2) return null;
  
  // Search for upward threshold crossing
  let [prevT, prevV] = filtered[0];
  for (let i = 1; i < filtered.length; i++) {
    const [t, v] = filtered[i];
    
    // Check for upward crossing: below threshold to at/above threshold
    if (prevV < threshold && v >= threshold) {
      const span = t.getTime() - prevT.getTime();
      let x = t.getTime(); // Default to end of interval
      
      // Use linear interpolation for more accurate crossing time
      if (span > 0 && v !== prevV) {
        // Calculate interpolation fraction where crossing occurs
        const frac = Math.max(0, Math.min(1, (threshold - prevV) / (v - prevV)));
        x = prevT.getTime() + frac * span;
      }
      
      // Calculate lead time in minutes
      const leadMinutes = Math.round((x - nowMs) / 60000);
      
      return { tCross: new Date(x), leadMinutes };
    }
    
    prevT = t; 
    prevV = v;
  }
  
  // No crossing found in the data
  return null;
}

/**
 * Builds surge-adjusted water level forecasts for flood prediction
 * 
 * This is the main forecasting function that combines observed data, harmonic predictions,
 * and storm surge analysis to create improved water level forecasts. It's essential for
 * providing accurate flood warnings beyond simple tide predictions.
 * 
 * Process:
 * 1. Fetch recent observed data to calculate current storm surge
 * 2. Fetch harmonic predictions for the same historical period
 * 3. Calculate surge offset from the difference
 * 4. Apply this offset to future predictions for adjusted forecasts
 * 
 * @param {Object} opts - Configuration options for forecast generation
 * @param {string} opts.station - NOAA station ID
 * @param {Date} opts.now - Current time reference
 * @param {number} opts.lookbackHours - Hours of historical data for surge calculation
 * @param {number} opts.lookaheadHours - Hours of future forecast to generate
 * @param {number} [opts.interval=6] - Data interval in minutes
 * @param {string} [opts.datum='MLLW'] - Vertical datum reference
 * @param {'english' | 'metric'} [opts.units='english'] - Unit system
 * @returns {Promise<Object>} Forecast results with adjusted predictions and metadata
 * @returns {TimeSeries} returns.adjusted - Surge-adjusted future water levels
 * @returns {number} returns.offset - Storm surge offset applied (positive = above normal)
 * @returns {number} returns.n - Number of data points used for surge calculation
 * 
 * @example
 * // Generate 24-hour flood forecast using 6 hours of recent data
 * const forecast = await buildAdjustedFuture({
 *   station: '8518750',
 *   now: new Date(),
 *   lookbackHours: 6,    // Use 6 hours of data for surge estimation
 *   lookaheadHours: 24,  // Generate 24-hour forecast
 *   datum: 'MLLW'
 * });
 * 
 * console.log(`Surge offset: ${forecast.offset.toFixed(2)} feet`);
 * console.log(`Based on ${forecast.n} observations`);
 * 
 * // Check for flood threshold crossings
 * const crossing = findNextThresholdCrossing(forecast.adjusted, 4.5, new Date());
 */
export async function buildAdjustedFuture(opts: {
  station: string;
  now: Date;
  lookbackHours: number;
  lookaheadHours: number;
  interval?: number;
  datum?: string;
  units?: 'english' | 'metric';
}): Promise<{ adjusted: TimeSeries; offset: number; n: number }> {
  const { station, now, lookbackHours, lookaheadHours, interval = 6, datum = 'MLLW', units = 'english' } = opts;
  
  // Define time windows for analysis
  const pastStart = new Date(now.getTime() - lookbackHours * 3600_000);
  const pastEnd = now;
  
  // Fetch historical data in parallel for efficiency
  const [observed, predictedPast] = await Promise.all([
    fetchObservedWaterLevels({ station, start: pastStart, end: pastEnd, interval, datum, units }),
    fetchPredictions({ station, start: pastStart, end: pastEnd, interval, datum, units }),
  ]);
  
  // Calculate current storm surge offset
  const { offset, n } = estimateSurgeOffset(observed, predictedPast);
  
  // Define forecast time window
  const futStart = now;
  const futEnd = new Date(now.getTime() + lookaheadHours * 3600_000);
  
  // Get future tide predictions
  const predictedFuture = await fetchPredictions({ 
    station, 
    start: futStart, 
    end: futEnd, 
    interval, 
    datum, 
    units 
  });
  
  // Apply surge adjustment to future predictions
  const adjusted: TimeSeries = {};
  for (const [k, v] of Object.entries(predictedFuture)) {
    adjusted[k] = v + offset; // Add current surge to harmonic prediction
  }
  
  return { adjusted, offset, n };
}

/**
 * Fetches wind data and converts to format compatible with our TimeSeries logic.
 * Combines NOAA CO-OPS (historical) with NWS (forecast).
 */
export async function fetchWind(opts: {
  station: string;
  start: Date;
  end: Date;
  units?: 'english' | 'metric';
  lat?: number;
  lng?: number;
}): Promise<Record<string, { speed: number; dir: number }>> {
  const now = new Date();
  const out: Record<string, { speed: number; dir: number }> = {};
  
  // 1. Fetch historical/current wind from NOAA CO-OPS
  if (opts.start < now) {
    const historicalEnd = new Date(Math.min(opts.end.getTime(), now.getTime()));
    const chunks = splitDateRange(opts.start, historicalEnd, 31);

    const fetchChunk = async (s: Date, e: Date) => {
      const params = {
        product: 'wind',
        application: 'canal-dr-flood',
        format: 'json',
        time_zone: 'gmt',
        units: opts.units || 'english',
        station: opts.station,
        begin_date: fmtBeginEnd(s),
        end_date: fmtBeginEnd(e),
      };
      
      try {
        const data = await requestNOAA(params) as { data?: any[] };
        const chunkOut: Record<string, { speed: number; dir: number }> = {};
        for (const row of data?.data ?? []) {
          const sVal = parseFloat(row.s);
          const dVal = parseFloat(row.d);
          const tVal = row.t as string;
          if (!isFinite(sVal) || !isFinite(dVal) || !tVal) continue;
          const iso = tVal.replace(' ', 'T') + 'Z';
          chunkOut[iso] = { speed: sVal, dir: dVal };
        }
        return chunkOut;
      } catch (err) {
        console.warn(`Wind chunk fetch failed [${fmtBeginEnd(s)} - ${fmtBeginEnd(e)}]:`, err);
        return {};
      }
    };

    const results = await Promise.all(chunks.map(c => fetchChunk(c.s, c.e)));
    Object.assign(out, ...results);
  }

  // 2. Fetch forecast wind from NWS if needed
  if (opts.end > now) {
    try {
      let { lat, lng } = opts;
      if (!lat || !lng) {
        if (opts.station === '8658163') {
          lat = 34.2133; lng = -77.7850;
        }
      }
      
      if (lat && lng) {
        const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
        let meta = nwsMetaCache[cacheKey];
        if (!meta) {
          const pointsData = await requestNWS(`https://api.weather.gov/points/${lat},${lng}`);
          const stationsData = await requestNWS(pointsData.properties.observationStations);
          meta = { 
            gridId: pointsData.properties.gridId, 
            gridX: pointsData.properties.gridX, 
            gridY: pointsData.properties.gridY,
            stationId: stationsData.features[0]?.properties?.stationIdentifier || 'KILM'
          };
          nwsMetaCache[cacheKey] = meta;
        }

        const gridData = await requestNWS(`https://api.weather.gov/gridpoints/${meta.gridId}/${meta.gridX},${meta.gridY}`);
        const windSpeeds = gridData.properties.windSpeed?.values || [];
        const windDirs = gridData.properties.windDirection?.values || [];
        
        // NWS provides these as separate series of intervals. We'll merge them.
        for (const item of windSpeeds) {
          const { start, durationMs } = parseNWSInterval(item.validTime);
          if (start.getTime() + durationMs < now.getTime()) continue;
          
          // Speed is in km/h usually in gridpoints? No, check uom.
          // properties.windSpeed.uom is usually "wmoUnit:km_h-1"
          let speed = item.value || 0;
          if (gridData.properties.windSpeed.uom === 'wmoUnit:km_h-1') {
            speed = speed * 0.621371; // km/h to mph
          }

          const hours = Math.max(1, Math.floor(durationMs / 3600_000));
          for (let i = 0; i < hours; i++) {
            const t = new Date(start.getTime() + i * 3600_000);
            if (t < now) continue;
            const iso = t.toISOString();
            out[iso] = { speed, dir: 0 }; // Direction added next
          }
        }

        for (const item of windDirs) {
          const { start, durationMs } = parseNWSInterval(item.validTime);
          const hours = Math.max(1, Math.floor(durationMs / 3600_000));
          for (let i = 0; i < hours; i++) {
            const t = new Date(start.getTime() + i * 3600_000);
            const iso = t.toISOString();
            if (out[iso]) out[iso].dir = item.value || 0;
          }
        }
      }
    } catch (e) {
      console.warn('NWS Wind forecast fetch failed:', e);
    }
  }
  
  return out;
}

/**
 * Helper to fetch deep historical precipitation from Open-Meteo archive.
 * Used for data older than ~7 days where NWS standard observations expire.
 */
async function fetchOpenMeteoPrecipitation(lat: number, lng: number, start: Date, end: Date): Promise<Record<string, number>> {
  const startStr = start.toISOString().split('T')[0];
  const endStr = end.toISOString().split('T')[0];
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=${startStr}&end_date=${endStr}&hourly=precipitation`;
  
  try {
    const res = await fetch(url);
    const data = await res.json();
    const out: Record<string, number> = {};
    if (data.hourly) {
      for (let i = 0; i < data.hourly.time.length; i++) {
        const t = new Date(data.hourly.time[i] + 'Z').toISOString();
        const v = data.hourly.precipitation[i] || 0;
        out[t] = v / 25.4; // mm to inches
      }
    }
    return out;
  } catch (e) {
    console.warn('Open-Meteo fetch failed:', e);
    return {};
  }
}

/**
 * Makes a request to the National Weather Service (NWS) API.
 * NWS strictly requires a custom User-Agent header.
 */
async function requestNWS(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'FloodCast (floodcast-dev@googlegroups.com)',
      'Accept': 'application/geo+json'
    }
  });
  
  if (!res.ok) {
    throw new Error(`NWS API error: ${res.status} ${res.statusText}`);
  }
  
  return res.json();
}

/**
 * Helper to parse NWS interval strings (e.g., "2026-04-25T00:00:00Z/PT6H")
 */
function parseNWSInterval(interval: string): { start: Date; durationMs: number } {
  const [startStr, durationStr] = interval.split('/');
  const start = new Date(startStr);
  let durationMs = 3600_000; // Default 1h
  const match = durationStr.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/);
  if (match) {
    const days = parseInt(match[1] || '0');
    const hours = parseInt(match[2] || '0');
    const mins = parseInt(match[3] || '0');
    durationMs = (days * 86400 + hours * 3600 + mins * 60) * 1000;
  }
  return { start, durationMs };
}

// Simple in-memory cache for NWS metadata to avoid redundant point lookups
const nwsMetaCache: Record<string, { gridId: string; gridX: number; gridY: number; stationId: string }> = {};

/**
 * Fetches precipitation data from the National Weather Service (NWS).
 * Uses three stages:
 * 1. Metadata lookup (points) to get grid coords and nearest station.
 * 2. Observations fetch for historical data.
 * 3. Gridpoints fetch for forecast data.
 */
export async function fetchNWSPrecipitation(opts: {
  lat: number;
  lng: number;
  start: Date;
  end: Date;
}): Promise<Record<string, number>> {
  const cacheKey = `${opts.lat.toFixed(4)},${opts.lng.toFixed(4)}`;
  const out: Record<string, number> = {};
  const now = new Date();

  // Stage 0: Deep History (Open-Meteo)
  // If start is more than 6 days ago, fetch archive data
  const deepPastThreshold = new Date(now.getTime() - 6 * 24 * 3600_000);
  if (opts.start < deepPastThreshold) {
    try {
      const omData = await fetchOpenMeteoPrecipitation(opts.lat, opts.lng, opts.start, new Date(Math.min(opts.end.getTime(), deepPastThreshold.getTime())));
      Object.assign(out, omData);
    } catch (e) {
      console.warn('Deep history fetch failed:', e);
    }
  }

  try {
    // Stage 1: Metadata
    let meta = nwsMetaCache[cacheKey];
    if (!meta) {
      const pointsData = await requestNWS(`https://api.weather.gov/points/${opts.lat},${opts.lng}`);
      const gridId = pointsData.properties.gridId;
      const gridX = pointsData.properties.gridX;
      const gridY = pointsData.properties.gridY;
      
      // Get nearest station
      const stationsData = await requestNWS(pointsData.properties.observationStations);
      const stationId = stationsData.features[0]?.properties?.stationIdentifier || 'KILM'; // Fallback
      
      meta = { gridId, gridX, gridY, stationId };
      nwsMetaCache[cacheKey] = meta;
    }

    // Stage 2: Historical Observations
    try {
      // Only fetch from NWS for the period after deep history (last 6 days)
      const nwsObsStart = opts.start < deepPastThreshold ? deepPastThreshold : opts.start;
      const obsData = await requestNWS(`https://api.weather.gov/stations/${meta.stationId}/observations?start=${nwsObsStart.toISOString()}&end=${now.toISOString()}`);
      for (const feature of obsData.features || []) {
        const props = feature.properties;
        const time = props.timestamp;
        
        // NWS observations provide several precipitation fields. 
        // precipitationLastHour is the standard for hourly strips.
        // If it's null, we look at the 'value' field of the precipitationLastHour object.
        let valMeters = props.precipitationLastHour?.value || 0;
        
        // If last hour is missing, maybe we can interpolate from last 3 or 6
        if (valMeters === 0) {
          if (props.precipitationLast3Hours?.value) valMeters = props.precipitationLast3Hours.value / 3;
          else if (props.precipitationLast6Hours?.value) valMeters = props.precipitationLast6Hours.value / 6;
        }
        
        out[time] = valMeters * 39.3701; // meters to inches
      }
    } catch (e) {
      console.warn('NWS Historical fetch failed:', e);
    }

    // Stage 3: Forecast Gridpoints
    try {
      const gridData = await requestNWS(`https://api.weather.gov/gridpoints/${meta.gridId}/${meta.gridX},${meta.gridY}`);
      const precipValues = gridData.properties.quantitativePrecipitation?.values || [];
      
      for (const item of precipValues) {
        const { start, durationMs } = parseNWSInterval(item.validTime);
        const valueInches = (item.value || 0) / 25.4; // Gridpoints use mm
        
        // Distribute value over the duration in hourly increments
        const hours = Math.max(1, Math.floor(durationMs / 3600_000));
        const valPerHour = valueInches / hours;
        
        for (let i = 0; i < hours; i++) {
          const t = new Date(start.getTime() + i * 3600_000).toISOString();
          out[t] = valPerHour;
        }
      }
    } catch (e) {
      console.warn('NWS Forecast fetch failed:', e);
    }

    return out;
  } catch (err) {
    console.warn('Failed to fetch NWS precipitation metadata:', err);
    return {};
  }
}

/**
 * Fetches precipitation data from NOAA (Legacy / Redirected to NWS)
 */
export async function fetchPrecipitation(opts: {
  station: string;
  start: Date;
  end: Date;
  units?: 'english' | 'metric';
  lat?: number;
  lng?: number;
}): Promise<Record<string, number>> {
  let { lat, lng } = opts;
  if (!lat || !lng) {
    if (opts.station === '8658163') {
      lat = 34.2133;
      lng = -77.7850;
    } else {
      return {};
    }
  }

  return fetchNWSPrecipitation({ lat, lng, start: opts.start, end: opts.end });
}

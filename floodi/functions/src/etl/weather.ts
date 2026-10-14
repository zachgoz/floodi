import fetch from 'node-fetch';

/**
 * NWS Weather ETL utilities
 */

export interface WeatherData {
  temp?: number;
  windSpeed?: number;
  windDirection?: number;
  pressure?: number;
  precip?: number;
  description?: string;
  icon?: string;
}

const HEADERS = { 'User-Agent': 'FloodCast (zach@floodi.app)' };
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Missing measurements stay absent: null is not calm wind or zero rainfall. */
function measurement(value: unknown, convert: (value: number) => number = value => value, minimum = -Infinity, maximum = Infinity): number | undefined {
  if (!finite(value) || value < minimum || value > maximum) return undefined;
  const result = convert(value);
  return Number.isFinite(result) ? result : undefined;
}

function weatherRecord(values: Record<string, unknown>): WeatherData {
  return Object.fromEntries(Object.entries(values).filter(([, value]) =>
    finite(value) || (typeof value === 'string' && value.trim().length > 0)
  ));
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export async function fetchNwsObservations(lat: number, lon: number, start?: Date, end?: Date): Promise<Record<string, WeatherData>> {
  // 1. Get nearest station
  const pointRes = await fetch(`https://api.weather.gov/points/${lat},${lon}`, {
    headers: HEADERS, timeout: 30_000
  });
  if (!pointRes.ok) throw new Error(`NWS Point API error: ${pointRes.statusText}`);
  const pointData = await pointRes.json() as any;
  
  const stationsRes = await fetch(pointData.properties.observationStations, {
    headers: HEADERS, timeout: 30_000
  });
  if (!stationsRes.ok) throw new Error(`NWS Stations API error: ${stationsRes.statusText}`);
  const stationsData = await stationsRes.json() as any;
  const stationId = stationsData.features?.[0]?.id;
  if (typeof stationId !== 'string') throw new Error('NWS Stations API returned no observation station');

  // 2. Fetch observations
  let url = `${stationId}/observations`;
  if (start && end) {
    url += `?start=${start.toISOString()}&end=${end.toISOString()}`;
  } else {
    url += `?limit=24`;
  }

  const obsRes = await fetch(url, {
    headers: HEADERS, timeout: 30_000
  });
  if (!obsRes.ok) throw new Error(`NWS Observations API error: ${obsRes.statusText}`);
  const obsData = await obsRes.json() as any;

  const out: Record<string, WeatherData> = {};
  for (const feature of obsData.features || []) {
    const p = feature?.properties;
    const t = p?.timestamp;
    if (!validTimestamp(t)) continue;
    const record = weatherRecord({
      temp: measurement(p.temperature?.value, value => (value * 9/5) + 32),
      windSpeed: measurement(p.windSpeed?.value, value => value * 0.621371, 0),
      windDirection: measurement(p.windDirection?.value, undefined, 0, 360),
      pressure: measurement(p.barometricPressure?.value, value => value / 100, Number.MIN_VALUE),
      precip: measurement(p.precipitationLastHour?.value, value => value * 0.0393701, 0),
      description: p.textDescription,
      icon: p.icon
    });
    if (Object.keys(record).length) out[t] = record;
  }

  // 3. Fetch from Open-Meteo to augment/replace wind and precip data
  let omUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation,surface_pressure,wind_speed_10m,wind_direction_10m`;
  
  if (start && end) {
    const startStr = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}-${String(start.getUTCDate()).padStart(2, '0')}`;
    const endStr = `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, '0')}-${String(end.getUTCDate()).padStart(2, '0')}`;
    omUrl += `&start_date=${startStr}&end_date=${endStr}`;
  } else {
    omUrl += `&past_days=1`;
  }

  try {
    const omRes = await fetch(omUrl, {
      headers: HEADERS, timeout: 30_000
    });
    if (omRes.ok) {
      const omData = await omRes.json() as any;
      const hourly = omData.hourly;
      if (Array.isArray(hourly?.time)) {
        for (let i = 0; i < hourly.time.length; i++) {
          const t = hourly.time[i] + ':00+00:00';
          if (!validTimestamp(t)) continue;
          if (Date.parse(t) > +(end || new Date()) || (start && Date.parse(t) < +start)) continue; // Open-Meteo returns '2026-05-12T00:00', append seconds and timezone
          
          const tempF = measurement(hourly.temperature_2m?.[i], value => (value * 9/5) + 32);
          const windMph = measurement(hourly.wind_speed_10m?.[i], value => value * 0.621371, 0);
          const windDir = measurement(hourly.wind_direction_10m?.[i], undefined, 0, 360);
          const precipIn = measurement(hourly.precipitation?.[i], value => value * 0.0393701, 0);
          const pressureHpa = measurement(hourly.surface_pressure?.[i], undefined, Number.MIN_VALUE);

          // Merge with NWS data if exists, otherwise create new
          const record = { ...out[t] };
          
          // Always prefer Open-Meteo for wind and precip since NWS historical data is often missing or limited
          if (tempF !== undefined) record.temp = record.temp ?? tempF;
          if (windMph !== undefined) record.windSpeed = windMph;
          if (windDir !== undefined) record.windDirection = windDir;
          if (precipIn !== undefined) record.precip = precipIn;
          if (pressureHpa !== undefined) record.pressure = record.pressure ?? pressureHpa;
          if (Object.keys(record).length) out[t] = record;
        }
      }
    } else {
      console.warn('Open-Meteo API error:', omRes.statusText);
    }
  } catch (e) {
    console.warn('Failed to fetch Open-Meteo data:', e);
  }

  return out;
}


/** Convert a compass direction string (NWS forecast API) to degrees. Returns undefined if already a number or unrecognized. */
const COMPASS_TO_DEG: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
  E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
  W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

function compassToDeg(val: string | number | undefined): number | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'number') return measurement(val, undefined, 0, 360);
  const upper = String(val).trim().toUpperCase();
  return COMPASS_TO_DEG[upper];
}

export async function fetchNwsForecast(lat: number, lon: number): Promise<Record<string, WeatherData>> {
  const pointRes = await fetch(`https://api.weather.gov/points/${lat},${lon}`, {
    headers: HEADERS, timeout: 30_000
  });
  if (!pointRes.ok) throw new Error(`NWS Point API error: ${pointRes.statusText}`);
  const pointData = await pointRes.json() as any;
  
  const forecastRes = await fetch(pointData.properties.forecastHourly, {
    headers: HEADERS, timeout: 30_000
  });
  if (!forecastRes.ok) throw new Error(`NWS Forecast API error: ${forecastRes.statusText}`);
  const forecastData = await forecastRes.json() as any;

  const out: Record<string, WeatherData> = {};
  for (const period of forecastData.properties?.periods || []) {
    const t = period?.startTime;
    if (!validTimestamp(t)) continue;
    const record = weatherRecord({
      temp: measurement(period.temperature, value => period.temperatureUnit === 'C' ? (value * 9/5) + 32 : value),
      windSpeed: measurement(typeof period.windSpeed === 'string' ? parseFloat(period.windSpeed) : undefined, undefined, 0),
      windDirection: compassToDeg(period.windDirection),
      description: period.shortForecast,
      icon: period.icon
    });
    if (Object.keys(record).length) out[t] = record;
  }
  return out;
}

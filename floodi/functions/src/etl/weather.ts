import { providerJson } from '../utils/providerRequest';
import * as logger from 'firebase-functions/logger';
import { safeError } from '../utils/observability';

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
  const out: Record<string, WeatherData> = {};
  let nwsFailure: unknown;
  try {
    const pointData = await providerJson(`https://api.weather.gov/points/${lat},${lon}`, { provider: 'nws', headers: HEADERS, cacheMs: 24 * 3600_000 });
    const stationsData = await providerJson(pointData.properties.observationStations, { provider: 'nws', headers: HEADERS, cacheMs: 24 * 3600_000 });
    const stationId = stationsData.features?.[0]?.id;
    if (typeof stationId !== 'string') throw new Error('NWS Stations API returned no observation station');
    const url = start && end ? `${stationId}/observations?start=${start.toISOString()}&end=${end.toISOString()}` : `${stationId}/observations?limit=24`;
    const obsData = await providerJson(url, { provider: 'nws', headers: HEADERS, cacheMs: 5 * 60_000 });
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

  } catch (error) {
    nwsFailure = error;
    logger.warn('NWS unavailable; attempting independent weather augmentation', { event: 'weather_source_partial', provider: 'nws', error: safeError(error) });
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
    const omData = await providerJson(omUrl, { provider: 'open_meteo', headers: HEADERS, cacheMs: 60 * 60_000 });
    {
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
    }
  } catch (e) {
    logger.warn('Open-Meteo augmentation unavailable', { event: 'weather_source_partial', provider: 'open_meteo', error: safeError(e) });
    if (nwsFailure || !Object.keys(out).length) throw e;
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
  const pointData = await providerJson(`https://api.weather.gov/points/${lat},${lon}`, { provider: 'nws', headers: HEADERS, cacheMs: 24 * 3600_000 });
  const forecastData = await providerJson(pointData.properties.forecastHourly, { provider: 'nws', headers: HEADERS, cacheMs: 30 * 60_000 });

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

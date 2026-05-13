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

export async function fetchNwsObservations(lat: number, lon: number, start?: Date, end?: Date): Promise<Record<string, WeatherData>> {
  // 1. Get nearest station
  const pointRes = await fetch(`https://api.weather.gov/points/${lat},${lon}`, {
    headers: { 'User-Agent': 'FloodCast (zach@floodi.app)' }
  });
  if (!pointRes.ok) throw new Error(`NWS Point API error: ${pointRes.statusText}`);
  const pointData = await pointRes.json() as any;
  
  const stationsRes = await fetch(pointData.properties.observationStations, {
    headers: { 'User-Agent': 'FloodCast (zach@floodi.app)' }
  });
  if (!stationsRes.ok) throw new Error(`NWS Stations API error: ${stationsRes.statusText}`);
  const stationsData = await stationsRes.json() as any;
  const stationId = stationsData.features[0].id;

  // 2. Fetch observations
  let url = `${stationId}/observations`;
  if (start && end) {
    url += `?start=${start.toISOString()}&end=${end.toISOString()}`;
  } else {
    url += `?limit=24`;
  }

  const obsRes = await fetch(url, {
    headers: { 'User-Agent': 'FloodCast (zach@floodi.app)' }
  });
  if (!obsRes.ok) throw new Error(`NWS Observations API error: ${obsRes.statusText}`);
  const obsData = await obsRes.json() as any;

  const out: Record<string, WeatherData> = {};
  for (const feature of obsData.features) {
    const p = feature.properties;
    const t = p.timestamp;
    out[t] = {
      temp: p.temperature?.value != null ? (p.temperature.value * 9/5) + 32 : undefined,
      windSpeed: p.windSpeed?.value != null ? p.windSpeed.value * 0.621371 : undefined,
      windDirection: p.windDirection?.value,
      pressure: p.barometricPressure?.value,
      precip: p.precipitationLastHour?.value,
      description: p.textDescription,
      icon: p.icon
    };
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
      headers: { 'User-Agent': 'FloodCast (zach@floodi.app)' }
    });
    if (omRes.ok) {
      const omData = await omRes.json() as any;
      const hourly = omData.hourly;
      if (hourly && hourly.time) {
        for (let i = 0; i < hourly.time.length; i++) {
          const t = hourly.time[i] + ':00+00:00'; // Open-Meteo returns '2026-05-12T00:00', append seconds and timezone
          
          const tempC = hourly.temperature_2m[i];
          const tempF = tempC != null ? (tempC * 9/5) + 32 : undefined;
          
          const windKmh = hourly.wind_speed_10m[i];
          const windMph = windKmh != null ? windKmh * 0.621371 : undefined;

          const windDir = hourly.wind_direction_10m[i];
          const precipMm = hourly.precipitation[i];
          const precipIn = precipMm != null ? precipMm * 0.0393701 : undefined;
          
          const pressureHpa = hourly.surface_pressure[i];

          // Merge with NWS data if exists, otherwise create new
          if (!out[t]) {
            out[t] = {};
          }
          
          // Always prefer Open-Meteo for wind and precip since NWS historical data is often missing or limited
          if (tempF !== undefined) out[t].temp = out[t].temp ?? tempF;
          if (windMph !== undefined) out[t].windSpeed = windMph; 
          if (windDir !== undefined) out[t].windDirection = windDir;
          if (precipIn !== undefined) out[t].precip = precipIn;
          if (pressureHpa !== undefined) out[t].pressure = out[t].pressure ?? pressureHpa;
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
  if (typeof val === 'number') return val;
  const upper = String(val).trim().toUpperCase();
  return COMPASS_TO_DEG[upper];
}

export async function fetchNwsForecast(lat: number, lon: number): Promise<Record<string, WeatherData>> {
  const pointRes = await fetch(`https://api.weather.gov/points/${lat},${lon}`, {
    headers: { 'User-Agent': 'FloodCast (zach@floodi.app)' }
  });
  if (!pointRes.ok) throw new Error(`NWS Point API error: ${pointRes.statusText}`);
  const pointData = await pointRes.json() as any;
  
  const forecastRes = await fetch(pointData.properties.forecastHourly, {
    headers: { 'User-Agent': 'FloodCast (zach@floodi.app)' }
  });
  if (!forecastRes.ok) throw new Error(`NWS Forecast API error: ${forecastRes.statusText}`);
  const forecastData = await forecastRes.json() as any;

  const out: Record<string, WeatherData> = {};
  for (const period of forecastData.properties.periods) {
    const t = period.startTime;
    out[t] = {
      temp: period.temperature,
      windSpeed: parseFloat(period.windSpeed.split(' ')[0]),
      windDirection: compassToDeg(period.windDirection),
      description: period.shortForecast,
      icon: period.icon
    };
  }
  return out;
}

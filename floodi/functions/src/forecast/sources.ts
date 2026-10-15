import { providerJson } from "../utils/providerRequest";
import * as logger from "firebase-functions/logger";
import { safeError } from "../utils/observability";
import { fetchFimanData } from "../etl/fiman";
import { fetchNoaaPredictions } from "../etl/noaa";
import { WeatherPoint } from "./model";
import { WaterPoint, residuals } from "./water";

export const FORECAST_TIDE_DAYS = 21;
export const FORECAST_WEATHER_DAYS = 16;
export const SITE = {
  id: "carolina-beach",
  sensor: "30046",
  retrievalPlatform: "SUNNYD_CB_03",
  tideStation: "8658163",
  lat: 34.0435,
  lon: -77.8894,
  datum: "MLLW",
  units: "ft",
  offsetFt: 2.75,
  phaseMinutes: 60,
  thresholdFt: 5.6,
};
export function points(series: Record<string, number>): WaterPoint[] {
  return Object.entries(series)
    .map(([t, v]) => ({ t: new Date(t), v }))
    .filter((p) => Number.isFinite(+p.t) && Number.isFinite(p.v))
    .sort((a, b) => +a.t - +b.t);
}
async function json(url: string) {
  const data = await providerJson(url, { provider: 'open_meteo', timeoutMs: 40_000, cacheMs: url.includes('archive-api') ? 24 * 3600_000 : 30 * 60_000 });
  if (data.error)
    throw new Error(`Weather source: ${String(data.reason).slice(0, 160)}`);
  return data;
}
/** Existing Open-Meteo integration, now explicit UTC, mph, inches, and hPa.
 * Archive is reanalysis, not measured local rainfall; record that in provenance.
 */
export async function weatherHistory(
  start: Date,
  end: Date,
): Promise<WeatherPoint[]> {
  const params = new URLSearchParams({
    latitude: String(SITE.lat),
    longitude: String(SITE.lon),
    start_date: start.toISOString().slice(0, 10),
    end_date: end.toISOString().slice(0, 10),
    hourly: "wind_speed_10m,wind_direction_10m,precipitation,pressure_msl",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timezone: "UTC",
  });
  const data = await json(
    `https://archive-api.open-meteo.com/v1/archive?${params}`,
  );
  return parseWeather(data);
}
export async function weatherForecast(): Promise<WeatherPoint[]> {
  const params = new URLSearchParams({
    latitude: String(SITE.lat),
    longitude: String(SITE.lon),
    hourly:
      "wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,pressure_msl",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timezone: "UTC",
    past_days: "3",
    forecast_days: String(FORECAST_WEATHER_DAYS),
  });
  return parseWeather(
    await json(`https://api.open-meteo.com/v1/forecast?${params}`),
  );
}
export function parseWeather(data: {
  hourly?: Record<string, (number | string | null)[]>;
  hourly_units?: Record<string, string>;
  utc_offset_seconds?: number;
}): WeatherPoint[] {
  const h = data.hourly;
  if (!h?.time) return [];
  const units = data.hourly_units;
  if (data.utc_offset_seconds !== 0 || units?.wind_speed_10m !== 'mp/h' || units.wind_direction_10m !== '°' || units.precipitation !== 'inch' || units.pressure_msl !== 'hPa' || (h.wind_gusts_10m && units.wind_gusts_10m !== 'mp/h')) throw new Error('Weather source returned incompatible units or timezone');
  if (h.time.some(t => typeof t !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?Z?$/.test(t) || !Number.isFinite(Date.parse(t.endsWith('Z') ? t : t + 'Z')))) throw new Error('Weather source returned invalid UTC times');
  const val = (key: string, i: number) =>
    typeof h[key]?.[i] === "number" ? (h[key][i] as number) : undefined;
  return h.time.map((t, i) => ({
    t: new Date(String(t).endsWith('Z') ? String(t) : String(t) + "Z"),
    windSpeed: val("wind_speed_10m", i),
    windDirection: val("wind_direction_10m", i),
    gust: val("wind_gusts_10m", i),
    precip: val("precipitation", i),
    pressure: val("pressure_msl", i),
  }));
}
export async function collectHistory(start: Date, end: Date) {
  const observed: Record<string, number> = {};
  const predicted: Record<string, number> = {};
  // Provider limits and failure isolation: a failed week is a gap, never zero water.
  const failures: string[] = [];
  for (let ms = +start; ms < +end; ms += 7 * 24 * 3600_000) {
    const a = new Date(ms);
    const b = new Date(Math.min(ms + 7 * 24 * 3600_000, +end));
    try {
      const [sensor, tide] = await Promise.all([
        fetchFimanData(SITE.retrievalPlatform, a, b, SITE.offsetFt),
        fetchNoaaPredictions(SITE.tideStation, new Date(+a - 2 * 3600_000), b),
      ]);
      Object.assign(observed, sensor.waterLevels);
      Object.assign(predicted, tide);
    } catch (e) {
      logger.warn('Historical source interval unavailable', { event: 'history_interval_failed', start: a.toISOString(), end: b.toISOString(), error: safeError(e) });
      failures.push(
        `${a.toISOString().slice(0, 10)}: ${safeError(e).message}`,
      );
    }
  }
  const tide = points(predicted).map((p) => ({
    ...p,
    t: new Date(+p.t + SITE.phaseMinutes * 60_000),
  }));
  // Explicitly localized reference; NOAA and sensor are different stations. This is experimental.
  const reference = {
    station: SITE.sensor,
    datum: SITE.datum,
    units: SITE.units,
  };
  const history = residuals(points(observed), tide, reference, reference);
  const weather = await weatherHistory(start, end);
  return {
    history,
    tide,
    weather,
    failures,
    metadata: {
      sensor: SITE.sensor,
      retrievalPlatform: SITE.retrievalPlatform,
      sensorSeries: "FIMAN (observed), gauge 30046; quality not evaluated records permitted, flagged bad/suspect removed",
      tideStation: SITE.tideStation,
      datum: SITE.datum,
      units: SITE.units,
      navd88ToMllwFt: SITE.offsetFt,
      phaseMinutes: SITE.phaseMinutes,
      calibration:
        "Existing regional-gauge datum conversion and fixed one-hour local tide phase; unverified for operational forecasting.",
      weather: "Open-Meteo reanalysis, UTC, mph, inches, MSL pressure hPa",
      start: start.toISOString(),
      end: end.toISOString(),
    },
  };
}

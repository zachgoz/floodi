import type { PrecipPoint, WindPoint } from 'src/components/Tab2/types';

const HOUR = 3_600_000;
const INTERVAL_HOURS = [1, 2, 3, 4, 6, 8, 12, 24, 48, 72, 168];
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export interface WeatherInterval {
  start: Date;
  end: Date;
  windSpeed: number | null;
  windDirection: number | null;
  windHours: number;
  rain: number | null;
  rainHours: number;
  expectedHours: number;
}

export function rainLabel(rain: number | null, complete: boolean): string {
  if (rain === null || (!complete && rain === 0)) return '—';
  if (!complete && rain < 0.01) return '>0 in';
  const value = rain > 0 && rain < 0.01 ? '<0.01' : rain.toFixed(2);
  return `${complete ? '' : '≥'}${value} in`;
}

export function compassDirection(degrees: number): string {
  return Number.isFinite(degrees) ? COMPASS[Math.round(((degrees % 360) + 360) % 360 / 22.5) % 16] : '—';
}

/** Preserve an unknown direction instead of silently making it north. */
export function parseWindDirection(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return ((value % 360) + 360) % 360;
  if (typeof value === 'string') {
    const index = COMPASS.indexOf(value.trim().toUpperCase());
    if (index >= 0) return index * 22.5;
  }
  return Number.NaN;
}

/** Weather shares the water chart's UTC domain; bin density follows its rendered width. */
export function weatherTimeline(
  windPoints: WindPoint[], precipPoints: PrecipPoint[], start: Date, end: Date, width: number,
  options: { intervalHours?: 1 } = {},
): { intervals: WeatherInterval[]; intervalHours: number } {
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || end <= start) return { intervals: [], intervalHours: 1 };
  const slots = Math.max(1, Math.floor(Math.max(0, width) / 80));
  const desiredHours = (+end - +start) / HOUR / slots;
  const intervalHours = options.intervalHours === 1 ? 1 : (INTERVAL_HOURS.find(hours => hours >= desiredHours) ?? Math.ceil(desiredHours / 24) * 24);
  const span = intervalHours * HOUR;
  // Anchor the first cell to the visible hour, so a mobile viewport does not
  // split its only legible weather cell across an arbitrary multi-day boundary.
  const first = Math.floor(+start / HOUR) * HOUR;
  const intervals: WeatherInterval[] = [];

  // Observations may include irregular NWS reports alongside hourly Open-Meteo
  // points. Keep one wind sample per hour and prefer the exact hourly sample.
  const hourlyWind = new Map<number, WindPoint>();
  for (const point of windPoints) {
    if (!Number.isFinite(+point.t) || !Number.isFinite(point.speed) || point.speed < 0 || point.t < start || point.t >= end) continue;
    const hour = Math.floor(+point.t / HOUR);
    const previous = hourlyWind.get(hour);
    if (!previous || +point.t % HOUR === 0 || (+previous.t % HOUR !== 0 && point.t > previous.t)) hourlyWind.set(hour, point);
  }

  // Rain is a preceding-hour accumulation. Prefer exact hourly windows and
  // reject overlapping rolling-hour reports, which would double-count rain.
  const rainWindows: PrecipPoint[] = [];
  const rainCandidates = precipPoints.filter(point => Number.isFinite(+point.t) && Number.isFinite(point.value) && point.value >= 0 && +point.t - HOUR >= +start && point.t <= end)
    .sort((a, b) => Number(+a.t % HOUR !== 0) - Number(+b.t % HOUR !== 0) || +a.t - +b.t);
  for (const point of rainCandidates) {
    if (!rainWindows.some(previous => +point.t - HOUR < +previous.t && +point.t > +previous.t - HOUR)) rainWindows.push(point);
  }

  for (let t = first; t < +end; t += span) {
    const intervalStart = Math.max(t, +start);
    const intervalEnd = Math.min(t + span, +end);
    const wind = [...hourlyWind.values()].filter(point => +point.t >= intervalStart && +point.t < intervalEnd);
    const speed = wind.length ? wind.reduce((sum, point) => sum + point.speed, 0) / wind.length : null;
    let direction: number | null = null;
    if (wind.length && wind.every(point => Number.isFinite(point.dir))) {
      const north = wind.reduce((sum, point) => sum + point.speed * Math.cos(point.dir * Math.PI / 180), 0);
      const east = wind.reduce((sum, point) => sum + point.speed * Math.sin(point.dir * Math.PI / 180), 0);
      const strength = wind.reduce((sum, point) => sum + point.speed, 0);
      if (strength > 0 && Math.hypot(north, east) / strength >= 0.25) direction = (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
    }
    const rain = rainWindows.filter(point => +point.t - HOUR >= intervalStart && +point.t <= intervalEnd);
    intervals.push({
      start: new Date(intervalStart), end: new Date(intervalEnd), windSpeed: speed, windDirection: direction,
      windHours: wind.length, rain: rain.length ? rain.reduce((sum, point) => sum + point.value, 0) : null,
      rainHours: rain.length, expectedHours: (intervalEnd - intervalStart) / HOUR,
    });
  }
  return { intervals, intervalHours };
}

export type TimeSeries = Record<string, number>; // ISO minute string (UTC) -> value

const NOAA_BASE = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';

function fmtBeginEnd(d: Date): string {
  // NOAA expects 'yyyymmdd HH:MM' in GMT
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${y}${m}${day} ${hh}:${mm}`;
}

function isoMinute(d: Date): string {
  // 2025-09-05 12:24 -> '2025-09-05T12:24Z'
  const copy = new Date(d.getTime());
  copy.setUTCSeconds(0, 0);
  return copy.toISOString().slice(0, 16) + 'Z';
}

async function requestNOAA(params: Record<string, string | number>): Promise<any> {
  const usp = new URLSearchParams(params as Record<string, string>);
  const url = `${NOAA_BASE}?${usp.toString()}`;
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) {
    throw new Error(`NOAA request failed: ${res.status}`);
  }
  const data = await res.json();
  if (data && data.error) {
    throw new Error(`NOAA API error: ${data.error?.message || 'unknown'}`);
  }
  return data;
}

export async function fetchObservedWaterLevels(opts: {
  station: string;
  start: Date;
  end: Date;
  interval?: number; // minutes
  datum?: string;
  units?: 'english' | 'metric';
}): Promise<TimeSeries> {
  const { station, start, end, interval = 6, datum = 'MLLW', units = 'english' } = opts;
  const params = {
    product: 'water_level',
    application: 'canal-dr-flood',
    format: 'json',
    time_zone: 'gmt',
    units,
    datum,
    station,
    interval: String(interval),
    begin_date: fmtBeginEnd(start),
    end_date: fmtBeginEnd(end),
  };
  const data = await requestNOAA(params);
  const out: TimeSeries = {};
  for (const row of data?.data ?? []) {
    const v = parseFloat(row.v);
    const t = row.t as string; // 'YYYY-MM-DD HH:MM'
    if (!isFinite(v) || !t) continue;
    // Convert to ISO minute UTC
    const iso = t.replace(' ', 'T') + 'Z';
    out[iso] = v;
  }
  return out;
}

export async function fetchPredictions(opts: {
  station: string;
  start: Date;
  end: Date;
  interval?: number; // minutes
  datum?: string;
  units?: 'english' | 'metric';
}): Promise<TimeSeries> {
  const { station, start, end, interval = 6, datum = 'MLLW', units = 'english' } = opts;
  const params = {
    product: 'predictions',
    application: 'canal-dr-flood',
    format: 'json',
    time_zone: 'gmt',
    units,
    datum,
    station,
    interval: String(interval),
    begin_date: fmtBeginEnd(start),
    end_date: fmtBeginEnd(end),
  };
  const data = await requestNOAA(params);
  const out: TimeSeries = {};
  for (const row of data?.predictions ?? []) {
    const v = parseFloat(row.v);
    const t = row.t as string; // 'YYYY-MM-DD HH:MM'
    if (!isFinite(v) || !t) continue;
    const iso = t.replace(' ', 'T') + 'Z';
    out[iso] = v;
  }
  return out;
}

export function estimateSurgeOffset(observed: TimeSeries, predicted: TimeSeries): { offset: number; n: number } {
  const diffs: number[] = [];
  for (const k of Object.keys(observed)) {
    if (k in predicted) {
      diffs.push(observed[k] - predicted[k]);
    }
  }
  if (diffs.length === 0) return { offset: 0, n: 0 };
  diffs.sort((a, b) => a - b);
  const mid = Math.floor(diffs.length / 2);
  const offset = diffs.length % 2 ? diffs[mid] : (diffs[mid - 1] + diffs[mid]) / 2;
  return { offset, n: diffs.length };
}

export function findNextThresholdCrossing(series: TimeSeries, threshold: number, now: Date): {
  tCross: Date;
  leadMinutes: number;
} | null {
  const entries = Object.entries(series)
    .map(([k, v]) => [new Date(k), v] as const)
    .sort((a, b) => a[0].getTime() - b[0].getTime());
  if (entries.length < 2) return null;
  const nowMs = now.getTime();
  // Keep points from slightly in the past to future
  const filtered = entries.filter(([t]) => t.getTime() >= nowMs - 6 * 60 * 1000);
  if (filtered.length < 2) return null;
  let [prevT, prevV] = filtered[0];
  for (let i = 1; i < filtered.length; i++) {
    const [t, v] = filtered[i];
    if (prevV < threshold && v >= threshold) {
      const span = t.getTime() - prevT.getTime();
      let x = t.getTime();
      if (span > 0 && v !== prevV) {
        const frac = Math.max(0, Math.min(1, (threshold - prevV) / (v - prevV)));
        x = prevT.getTime() + frac * span;
      }
      const leadMinutes = Math.round((x - nowMs) / 60000);
      return { tCross: new Date(x), leadMinutes };
    }
    prevT = t; prevV = v;
  }
  return null;
}

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
  const pastStart = new Date(now.getTime() - lookbackHours * 3600_000);
  const pastEnd = now;
  const [observed, predictedPast] = await Promise.all([
    fetchObservedWaterLevels({ station, start: pastStart, end: pastEnd, interval, datum, units }),
    fetchPredictions({ station, start: pastStart, end: pastEnd, interval, datum, units }),
  ]);
  const { offset, n } = estimateSurgeOffset(observed, predictedPast);
  const futStart = now;
  const futEnd = new Date(now.getTime() + lookaheadHours * 3600_000);
  const predictedFuture = await fetchPredictions({ station, start: futStart, end: futEnd, interval, datum, units });
  const adjusted: TimeSeries = {};
  for (const [k, v] of Object.entries(predictedFuture)) {
    adjusted[k] = v + offset;
  }
  return { adjusted, offset, n };
}


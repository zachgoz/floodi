import { providerJson } from '../utils/providerRequest';

const NOAA_BASE = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';

function fmtDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${y}${m}${day} ${hh}:${mm}`;
}

export async function fetchNoaaObserved(station: string, start: Date, end: Date) {
  const params = new URLSearchParams({
    product: 'water_level',
    application: 'floodcast-etl',
    format: 'json',
    time_zone: 'gmt',
    units: 'english',
    datum: 'MLLW',
    station,
    begin_date: fmtDate(start),
    end_date: fmtDate(end),
  });

  const data = await providerJson(`${NOAA_BASE}?${params.toString()}`, { provider: 'noaa', cacheMs: 5 * 60_000 });
  if (data.error) throw new Error(`NOAA: ${String(data.error.message).slice(0, 200)}`);
  const out: Record<string, number> = {};
  
  for (const row of data.data || []) {
    const v = (typeof row.v === 'string' && row.v.trim() !== '') || typeof row.v === 'number' ? Number(row.v) : NaN;
    const t = typeof row.t === 'string' ? row.t.replace(' ', 'T') + 'Z' : '';
    if (Number.isFinite(v) && Number.isFinite(Date.parse(t))) out[t] = v;
  }
  
  return out;
}

export async function fetchNoaaPredictions(station: string, start: Date, end: Date) {
  const params = new URLSearchParams({
    product: 'predictions',
    application: 'floodcast-etl',
    format: 'json',
    time_zone: 'gmt',
    units: 'english',
    datum: 'MLLW',
    station,
    begin_date: fmtDate(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()))),
    end_date: fmtDate(new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate(), 23, 59))),
    interval: 'hilo' // We might want full 6-min predictions for better charting
  });

  // For ETL, we actually want the high-resolution 6-min predictions to bucket them.
  params.delete('interval');
  params.append('interval', '6');

  const data = await providerJson(`${NOAA_BASE}?${params.toString()}`, { provider: 'noaa', cacheMs: 24 * 3600_000 });
  if (data.error) throw new Error(`NOAA: ${String(data.error.message).slice(0, 200)}`);
  const out: Record<string, number> = {};
  
  // Cache a fixed UTC-day request across scheduler invocations, then return
  // only the caller's requested interval. Astronomical predictions are static.
  for (const row of data.predictions || []) {
    const v = (typeof row.v === 'string' && row.v.trim() !== '') || typeof row.v === 'number' ? Number(row.v) : NaN;
    const t = typeof row.t === 'string' ? row.t.replace(' ', 'T') + 'Z' : '';
    if (Number.isFinite(v) && Number.isFinite(Date.parse(t)) && Date.parse(t) >= +start && Date.parse(t) <= +end) out[t] = v;
  }
  
  return out;
}

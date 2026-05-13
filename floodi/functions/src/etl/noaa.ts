import fetch from 'node-fetch';

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

  const res = await fetch(`${NOAA_BASE}?${params.toString()}`);
  if (!res.ok) throw new Error(`NOAA API error: ${res.statusText}`);
  
  const data = await res.json() as any;
  const out: Record<string, number> = {};
  
  for (const row of data.data || []) {
    const v = parseFloat(row.v);
    const t = row.t.replace(' ', 'T') + 'Z';
    if (!isNaN(v)) out[t] = v;
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
    begin_date: fmtDate(start),
    end_date: fmtDate(end),
    interval: 'hilo' // We might want full 6-min predictions for better charting
  });

  // For ETL, we actually want the high-resolution 6-min predictions to bucket them.
  params.delete('interval');
  params.append('interval', '6');

  const res = await fetch(`${NOAA_BASE}?${params.toString()}`);
  if (!res.ok) throw new Error(`NOAA API error: ${res.statusText}`);
  
  const data = await res.json() as any;
  const out: Record<string, number> = {};
  
  for (const row of data.predictions || []) {
    const v = parseFloat(row.v);
    const t = row.t.replace(' ', 'T') + 'Z';
    if (!isNaN(v)) out[t] = v;
  }
  
  return out;
}

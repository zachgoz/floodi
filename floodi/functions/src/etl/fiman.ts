import { localSensorLevels, regionalGaugeLevels } from '../forecast/sensor';
import fetch from 'node-fetch';
import * as logger from 'firebase-functions/logger';

const FIMAN_BASE = 'https://data.sunnydayflooding.com/services/data.php';

export async function fetchFimanData(sensorId: string, start: Date, end: Date, offset: number = 0, preferRaw = false) {
  const timeStr = `${start.toISOString().split('.')[0]}Z/${end.toISOString().split('.')[0]}Z`;
  
  const params = new URLSearchParams({
    format: 'json',
    pretty: 'true',
    time: timeStr,
    platform: sensorId,
    datum: 'MLLW',
    allStations: 'true',
    standard: 'false',
    qcFilter: 'false',
    dataView: 'less',
    health: 'summary',
    www: 'true'
  });

  const res = await fetch(`${FIMAN_BASE}?${params.toString()}`, { timeout: 30_000 });
  if (!res.ok) { const error = new Error(`FiMAN HTTP ${res.status}`) as Error & { status: number }; error.status = res.status; throw error; }
  
  const data = await res.json() as any;
  return parseFimanPayload(data, sensorId, offset, preferRaw);
}

export function parseFimanPayload(data: any, sensorId: string, offset = 0, preferRaw = false) {
  
  // Find the specific station feature (robust matching)
  const feature = (Array.isArray(data?.features) ? data.features : []).find((f: any) => {
    const platformId = f?.properties?.platform_id;
    const pid = typeof platformId === 'string' ? platformId.toLowerCase() : '';
    if (!pid) return false;
    const sid = sensorId.toLowerCase();
    return pid === sid || pid === `sunnyd_${sid}` || sid === `sunnyd_${pid}`;
  });

  if (!feature) {
    logger.warn('Requested FiMAN station missing', { event: 'provider_station_missing', provider: 'fiman', sensorId });
    return { waterLevels: {}, imagery: {} };
  }

  const parameters = Array.isArray(feature.properties?.parameters) ? feature.properties.parameters.filter((p: any) => p && typeof p.id === 'string') : [];
  
  const waterLevels = preferRaw ? localSensorLevels(parameters, offset, true) : regionalGaugeLevels(parameters, offset);
  const imagery: Record<string, Record<string, string>> = {};
  const imgAliases = ['Camera', 'webcam_img_url', 'Webcam'];

  // Camera corruption must never reject valid water measurements.
  let skipped = 0;
  for (const camera of parameters.filter((p: any) => p && imgAliases.includes(p.id))) {
    const times = camera.observations?.times;
    const values = camera.observations?.values;
    if (!Array.isArray(times) || !Array.isArray(values)) { skipped++; continue; }
    const firstUrl = values.find((value: unknown) => typeof value === 'string' && /^https?:\/\//.test(value));
    if (!firstUrl) { skipped++; continue; }
    let camId: string;
    try { camId = new URL(firstUrl).pathname.split('/').pop()?.split('.')[0] || 'UNKNOWN'; }
    catch { skipped++; continue; }
    camId = camId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
    for (let i = 0; i < times.length; i++) {
      const rawTime = times[i];
      const url = values[i];
      if (typeof rawTime !== 'string' || typeof url !== 'string' || !/^https?:\/\//.test(url)) { skipped++; continue; }
      const parsed = Date.parse(/(Z|[+-]\d\d:\d\d)$/.test(rawTime) ? rawTime : rawTime + 'Z');
      if (!Number.isFinite(parsed)) { skipped++; continue; }
      const t = new Date(parsed).toISOString();
      (imagery[t] ||= {})[camId] = url;
    }
  }
  if (skipped) logger.warn('Malformed camera records skipped', { event: 'camera_records_skipped', provider: 'fiman', count: skipped });

  return { waterLevels, imagery };
}

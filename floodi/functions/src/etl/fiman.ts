import { localSensorLevels, regionalGaugeLevels } from '../forecast/sensor';
import fetch from 'node-fetch';

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
  if (!res.ok) throw new Error(`FiMAN API error: ${res.statusText}`);
  
  const data = await res.json() as any;
  
  // Find the specific station feature (robust matching)
  const feature = data.features?.find((f: any) => {
    const pid = f.properties?.platform_id?.toLowerCase();
    const sid = sensorId.toLowerCase();
    return pid === sid || pid === `sunnyd_${sid}` || sid === `sunnyd_${pid}`;
  });

  if (!feature) {
    console.warn(`No FiMAN feature found for sensorId: ${sensorId}. Available: ${data.features?.map((f: any) => f.properties?.platform_id).join(', ')}`);
    return { waterLevels: {}, imagery: {} };
  }

  const parameters = feature.properties?.parameters || [];
  
  const waterLevels = preferRaw ? localSensorLevels(parameters, offset, true) : regionalGaugeLevels(parameters, offset);
  const imagery: Record<string, Record<string, string>> = {};
  const imgAliases = ['Camera', 'webcam_img_url', 'Webcam'];

  // Handle imagery
  parameters.filter((p: any) => imgAliases.includes(p.id)).forEach((cp: any) => {
    if (cp?.observations?.times) {
      const { times, values } = cp.observations;
      const firstUrl = values[0] || '';
      const camId = firstUrl.split('/').pop()?.split('.')[0] || 'UNKNOWN';
      
      for (let i = 0; i < times.length; i++) {
        const t = new Date(/(Z|[+-]\d\d:\d\d)$/.test(times[i]) ? times[i] : times[i] + 'Z').toISOString();
        if (!imagery[t]) imagery[t] = {};
        imagery[t][camId] = values[i];
      }
    }
  });

  return { waterLevels, imagery };
}

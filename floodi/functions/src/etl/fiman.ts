import fetch from 'node-fetch';

const FIMAN_BASE = 'https://data.sunnydayflooding.com/services/data.php';

export async function fetchFimanData(sensorId: string, start: Date, end: Date, offset: number = 0) {
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

  const res = await fetch(`${FIMAN_BASE}?${params.toString()}`);
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
  
  const waterLevels: Record<string, number> = {};
  const imagery: Record<string, Record<string, string>> = {};

  // The FiMAN API response embeds multiple water_level parameters for each sensor feature:
  //   - "water_level_raw"    → the actual raw sensor reading (NAVD88, meters)
  //   - "water_level"        → appears 2-3 times: once as a QC-filtered sensor series and
  //                            once as NOAA CO-OPS 6-min data embedded for reference.
  //                            The NOAA embedding always has the most observations (regular
  //                            6-min grid), so "pick max obs" reliably selects the WRONG series.
  //   - "FIMAN (observed)"   → alternative id used by some older/different sensors
  //   - "Hohonu (observed)"  → alternative id used by Hohonu brand sensors
  //
  // Strategy: ONLY use official "FIMAN (observed)" data. 
  // We ignore "water_level_raw" and generic "water_level" (often NOAA reference data)
  // to ensure we only record official FiMAN sensor observations.
  const WL_TARGETS = ["FIMAN (observed)", "Hohonu (observed)"];
  const imgAliases = ["Camera", "webcam_img_url", "Webcam"];

  const foundIds = parameters.map((p: any) => p.id);
  console.log(`[fiman] Found ${parameters.length} parameters for ${sensorId}: ${foundIds.join(', ')}`);
  
  // 1. Try exact match first (case-insensitive and trimmed)
  let bestWlParam = parameters.find((p: any) => 
    WL_TARGETS.some(target => p.id?.trim().toLowerCase() === target.toLowerCase()) && 
    (p.observations?.times?.length || 0) > 0
  );

  // 2. Try partial match if no exact match
  if (!bestWlParam) {
    bestWlParam = parameters.find((p: any) => 
      WL_TARGETS.some(target => p.id?.toLowerCase().includes(target.toLowerCase())) && 
      (p.observations?.times?.length || 0) > 0
    );
  }

  if (bestWlParam) {
    console.log(`[fiman] SUCCESS: Selected target parameter "${bestWlParam.id}" for ${sensorId} (${bestWlParam.observations.times.length} points)`);
  } else {
    console.warn(`[fiman] FAILURE: No matching water level parameter in [${foundIds.join(', ')}] for ${sensorId}.`);
    // DO NOT FALL BACK to "Water level" as it is often NOAA reference data.
  }

  if (bestWlParam?.observations?.times) {
    const { times, values } = bestWlParam.observations;
    const isMeters = bestWlParam.units === 'm';
    for (let i = 0; i < times.length; i++) {
      let v = parseFloat(values[i]);
      if (isNaN(v)) continue;

      if (isMeters) v *= 3.28084; // Convert m to ft
      
      // The FiMAN API ignores the 'datum' parameter for these specific sensor-specific fields
      // (verified via scratch diagnostics). We must always apply the NAVD88 -> MLLW offset manually.
      v += offset;
      
      const t = new Date(times[i] + 'Z').toISOString();
      waterLevels[t] = v;
    }
  }

  // Handle imagery
  parameters.filter((p: any) => imgAliases.includes(p.id)).forEach((cp: any) => {
    if (cp?.observations?.times) {
      const { times, values } = cp.observations;
      const firstUrl = values[0] || '';
      const camId = firstUrl.split('/').pop()?.split('.')[0] || 'UNKNOWN';
      
      for (let i = 0; i < times.length; i++) {
        const t = new Date(times[i] + 'Z').toISOString();
        if (!imagery[t]) imagery[t] = {};
        imagery[t][camId] = values[i];
      }
    }
  });

  return { waterLevels, imagery };
}

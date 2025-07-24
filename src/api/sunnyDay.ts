export interface SunnyDayDatum {
  time: string;
  value: number;
}

export async function fetchSunnyDayData(platform: string, startIso: string, endIso: string): Promise<SunnyDayDatum[]> {
  const params = new URLSearchParams({
    format: 'json',
    pretty: 'false',
    time: `${startIso}/${endIso}`,
    platform,
    standard: 'false',
    qcFilter: 'false',
    health: 'summary',
    region: '',
    datum: 'MLLW',
    windPrediction: 'wind speed prediction',
    www: 'true',
    dataView: 'less',
    allStations: 'true'
  });

  const url = `https://data.sunnydayflooding.com/services/data.php?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch Sunny Day data: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();

  // Attempt to find first parameter with observation times/values
  const feature = data.features?.[0];
  if (!feature) return [];
  const param = feature.properties?.parameters?.find((p: any) => Array.isArray(p?.observations?.times));
  if (!param) return [];
  const times: string[] = param.observations.times;
  const values: string[] = param.observations.values;
  const result: SunnyDayDatum[] = [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const v = parseFloat(values[i]);
    if (!isNaN(v)) {
      result.push({ time: t, value: v });
    }
  }
  return result;
}

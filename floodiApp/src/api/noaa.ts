export interface NoaaPredictionPoint {
  t: string;
  v: string;
}

export interface NoaaObservationPoint {
  t: string;
  v: string;
}

export interface NoaaPredictionResponse {
  predictions: NoaaPredictionPoint[];
}

export interface NoaaObservationResponse {
  data: NoaaObservationPoint[];
}

export async function fetchNoaaPredictions(station: string, beginDate: string, endDate: string): Promise<NoaaPredictionPoint[]> {
  const params = new URLSearchParams({
    product: 'predictions',
    begin_date: beginDate,
    end_date: endDate,
    datum: 'NAVD',
    station,
    time_zone: 'GMT',
    units: 'english',
    format: 'json',
    application: 'floodi'
  });

  const url = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch NOAA predictions: ${res.status} ${res.statusText}`);
  }
  const data: NoaaPredictionResponse = await res.json();
  return data.predictions;
}

export async function fetchNoaaObservations(station: string, beginDate: string, endDate: string): Promise<NoaaObservationPoint[]> {
  const params = new URLSearchParams({
    product: 'water_level',
    begin_date: beginDate,
    end_date: endDate,
    datum: 'NAVD',
    station,
    time_zone: 'GMT',
    units: 'english',
    format: 'json',
    application: 'floodi'
  });

  const url = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch NOAA observations: ${res.status} ${res.statusText}`);
  }
  const data: NoaaObservationResponse = await res.json();
  return data.data;
}

export interface NoaaPredictionPoint {
  t: string;
  v: string;
}

export interface NoaaPredictionResponse {
  predictions: NoaaPredictionPoint[];
}

export async function fetchNoaaPredictions(station: string, beginDate: string, endDate: string): Promise<NoaaPredictionPoint[]> {
  const params = new URLSearchParams({
    product: 'predictions',
    begin_date: beginDate,
    end_date: endDate,
    datum: 'MLLW',
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

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchNoaaPredictions, fetchNoaaObservations } from './api/noaa';
import { fetchSunnyDayData } from './api/sunnyDay';
import { calculateFloodForecast, summarizeFloodWindows, FloodForecastPoint, FloodWindow } from './prediction';
import { cachedFetch } from './api/cache';

export function useFloodForecast(stationId: string, platform: string, start: Date, end: Date, elevation: number) {
  const startYmd = start.toISOString().slice(0,10).replace(/-/g,'');
  const endYmd = end.toISOString().slice(0,10).replace(/-/g,'');

  const predictionsQuery = useQuery({
    queryKey: ['noaa', stationId, startYmd, endYmd],
    queryFn: () =>
      cachedFetch(
        `noaa-${stationId}-${startYmd}-${endYmd}`,
        () => fetchNoaaPredictions(stationId, startYmd, endYmd)
      )
  });

  const observationsQuery = useQuery({
    queryKey: ['noaa-obs', stationId, startYmd, endYmd],
    queryFn: () =>
      cachedFetch(
        `noaa-obs-${stationId}-${startYmd}-${endYmd}`,
        () => fetchNoaaObservations(stationId, startYmd, endYmd)
      )
  });

  const sensorQuery = useQuery({
    queryKey: ['sunny', platform, start.toISOString(), end.toISOString()],
    queryFn: () =>
      cachedFetch(
        `sunny-${platform}-${start.toISOString()}-${end.toISOString()}`,
        () => fetchSunnyDayData(platform, start.toISOString(), end.toISOString())
      )
  });

  const forecast = React.useMemo<FloodForecastPoint[] | undefined>(() => {
    if (!predictionsQuery.data) return undefined;
    return calculateFloodForecast(predictionsQuery.data, elevation);
  }, [predictionsQuery.data, elevation]);

  const windows = React.useMemo<FloodWindow[] | undefined>(() => {
    if (!forecast) return undefined;
    return summarizeFloodWindows(forecast, stationId);
  }, [forecast, stationId]);

  return {
    predictionsQuery,
    observationsQuery,
    sensorQuery,
    forecast,
    windows
  };
}

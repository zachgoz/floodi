import { useMemo, useState, useEffect } from 'react';
import { findNearestPoint } from './useChartInteraction';
import type { Point, WindPoint, PrecipPoint } from '../types';

export interface AtmosphericState {
  wl: number | null;
  targetTime: Date | null;
  isLive: boolean;
  source: string;
  fullSource: string;
  sourceId: 'fiman' | 'noaa' | 'floodcast' | 'live' | 'none';
  surge: number | null;
  isSimulated: boolean;
  prediction: number | null;
  wind: { speed: number; dir: number } | null;
  precip: number | null;
  statusLabel: 'Observed' | 'Predicted' | 'Estimated';
}

export interface HydrographWaterLevelResolution {
  wl: number | null;
  isObserved: boolean;
  isEstimated: boolean;
  isAdjusted: boolean;
  isPredicted: boolean;
  obsRes: ReturnType<typeof findNearestPoint<Point>>;
  adjRes: ReturnType<typeof findNearestPoint<Point>>;
  predRes: ReturnType<typeof findNearestPoint<Point>>;
}

/**
 * Shared water-level resolver used by both the hydrograph readout and the live
 * top-bar gauge status so live values never drift apart.
 */
export function resolveHydrographWaterLevel(
  processedData: {
    observedPoints: Point[];
    adjustedPoints: Point[];
    predictedPoints: Point[];
    timeDomain: { now: Date };
  } | null | undefined,
  targetT: Date,
): HydrographWaterLevelResolution {
  if (!processedData) {
    return {
      wl: null,
      isObserved: false,
      isEstimated: false,
      isAdjusted: false,
      isPredicted: false,
      obsRes: null,
      adjRes: null,
      predRes: null,
    };
  }
  const now = processedData.timeDomain.now;
  const lastObsT = processedData.observedPoints.length > 0
    ? Math.max(...processedData.observedPoints.map((p: Point) => p.t.getTime()))
    : now.getTime();
  const isPastHandover = targetT.getTime() > lastObsT;

  const obsRes = findNearestPoint<Point>(processedData.observedPoints, targetT);
  const adjRes = findNearestPoint<Point>(processedData.adjustedPoints, targetT);
  const predRes = findNearestPoint<Point>(processedData.predictedPoints, targetT);

  const isObserved = !!(obsRes && obsRes.dtMin < 60 && !isPastHandover);
  const isEstimated = isObserved && obsRes?.point.estimated === true;
  const forecastStart = processedData.adjustedPoints[0]?.t;
  const forecastEnd = processedData.adjustedPoints.at(-1)?.t;
  const withinForecast = !!(forecastStart && forecastEnd && targetT >= forecastStart && targetT <= forecastEnd);
  const isAdjusted = !!(adjRes && adjRes.dtMin < 60 && isPastHandover && withinForecast);
  const isPredicted = !isObserved && !isAdjusted && !!(predRes && predRes.dtMin < 60);

  const wl = isObserved ? obsRes!.point.v :
             isAdjusted ? adjRes!.point.v :
             isPredicted ? predRes!.point.v : null;

  return { wl, isObserved, isEstimated, isAdjusted, isPredicted, obsRes, adjRes, predRes };
}

/**
 * Custom hook to derive atmospheric values for the overlay pill and map visualization.
 * Handles both real-time data focus (via chart hover or scroll) and manual simulation.
 */
export function useAtmosphericState(
  processedData: any,
  manualFocusTime: Date | null,
  currentViewport: { focusTime: Date } | null,
  initialSimulationLevel: number = 2.5
) {
  const [simulationLevel, setSimulationLevel] = useState<number>(initialSimulationLevel);
  const [isUserSimulating, setIsUserSimulating] = useState(false);


  const activeAtmo = useMemo((): AtmosphericState => {
    if (!processedData) {
      return { 
        wl: null,
        targetTime: null, 
        isLive: true, 
        source: 'Live Conditions', 
        fullSource: 'Live Conditions',
        sourceId: 'live',
        wind: null, 
        precip: null, 
        surge: null, 
        isSimulated: false, 
        prediction: null,
        statusLabel: 'Observed'
      };
    }

    const now = processedData.timeDomain.now;
    const targetT = manualFocusTime || currentViewport?.focusTime || now;
    const isLive = !manualFocusTime && (!currentViewport || (Math.abs(targetT.getTime() - now.getTime()) < 60000 || Math.abs(targetT.getTime() - Date.now()) < 2 * 60000));

    const { wl, isObserved, isEstimated, isAdjusted, isPredicted, obsRes, predRes } =
      resolveHydrographWaterLevel(processedData, targetT);
    const windRes = findNearestPoint<WindPoint>(processedData.windPoints, targetT);
    const precipRes = findNearestPoint<PrecipPoint>(processedData.precipPoints, targetT);

    const sourceName = (obsRes?.point.source || processedData.source || 'NOAA').toUpperCase() === 'FIMAN' ? 'Fiman' : 'NOAA';

    const sourceShort = isEstimated ? 'Localized NOAA Estimate' :
                        isObserved ? `Water Level (${sourceName})` :
                        isAdjusted ? 'Predicted Water Level' :
                        isPredicted ? 'NOAA Prediction' : (isLive ? 'Live Conditions' : 'No Data');

    const sourceFull = isEstimated ? 'Estimated Water Level (phase-aligned NOAA proxy)' :
                        isObserved ? `Observed Water Level (${sourceName})` :
                        isAdjusted ? 'FloodCast Water Level' :
                        isPredicted ? 'NOAA Predicted Water Level' : (isLive ? 'Live Conditions' : 'No Data');

    const sourceId = isObserved ? (sourceName.toLowerCase() === 'fiman' ? 'fiman' : 'noaa') :
                     isAdjusted ? 'floodcast' :
                     isPredicted ? 'noaa' : (isLive ? 'live' : 'none');

    const surge = (() => {
      if (wl === null || !predRes || predRes.dtMin > 60) return null;
      return wl - predRes.point.v;
    })();

    const isSimulated = isUserSimulating;

    return { 
      wl: isSimulated ? simulationLevel : wl, 
      targetTime: targetT, 
      isLive, 
      source: sourceShort,
      fullSource: sourceFull,
      sourceId,
      surge,
      isSimulated,
      prediction: predRes && predRes.dtMin < 60 ? predRes.point.v : null,
      wind: windRes && windRes.dtMin < 60 ? { speed: windRes.point.speed, dir: windRes.point.dir } : null,
      precip: precipRes && precipRes.dtMin < 60 ? precipRes.point.value : null,
      statusLabel: isEstimated ? 'Estimated' : isPredicted || isAdjusted ? 'Predicted' : 'Observed',
    };
  }, [processedData, currentViewport, manualFocusTime, simulationLevel, isUserSimulating]);

  // Sync simulation level (for map) when not simulating
  useEffect(() => {
    if (!isUserSimulating && activeAtmo.wl !== null && activeAtmo.wl !== undefined) {
      setSimulationLevel(activeAtmo.wl);
    }
  }, [activeAtmo.wl, isUserSimulating]);

  return {
    activeAtmo,
    simulationLevel,
    setSimulationLevel,
    isUserSimulating,
    setIsUserSimulating,
  };
}

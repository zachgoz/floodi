import { useMemo, useState, useEffect } from 'react';
import { findNearestPoint } from './useChartInteraction';
import type { Point, WindPoint, PrecipPoint } from '../types';

export interface AtmosphericState {
  wl: number;
  targetTime: Date | null;
  isLive: boolean;
  source: string;
  surge: number | null;
  isSimulated: boolean;
  prediction: number | null;
  wind: { speed: number; dir: number } | null;
  precip: number | null;
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
        wl: 0, 
        targetTime: null, 
        isLive: true, 
        source: 'Live Conditions', 
        wind: null, 
        precip: null, 
        surge: null, 
        isSimulated: false, 
        prediction: null 
      };
    }

    const now = processedData.timeDomain.now;
    const targetT = manualFocusTime || currentViewport?.focusTime || now;
    const isLive = !manualFocusTime && (!currentViewport || Math.abs(targetT.getTime() - now.getTime()) < 60000);

    // Find the latest measurement time to determine the handover point
    const lastObsT = processedData.observedPoints.length > 0 
      ? Math.max(...processedData.observedPoints.map((p: Point) => p.t.getTime())) 
      : now.getTime();
    const isPastHandover = targetT.getTime() > lastObsT;

    const obsRes = findNearestPoint(processedData.observedPoints, targetT);
    const adjRes = findNearestPoint(processedData.adjustedPoints, targetT);
    const predRes = findNearestPoint(processedData.predictedPoints, targetT);
    const windRes = findNearestPoint<WindPoint>(processedData.windPoints, targetT);
    const precipRes = findNearestPoint<PrecipPoint>(processedData.precipPoints, targetT);

    const isObserved = !!(obsRes && obsRes.dtMin < 60 && !isPastHandover);
    const isAdjusted = !!(adjRes && adjRes.dtMin < 60 && isPastHandover);
    const isPredicted = !isObserved && !isAdjusted && !!(predRes && predRes.dtMin < 60);

    const wl = isObserved ? obsRes!.point.v :
               isAdjusted ? adjRes!.point.v :
               isPredicted ? predRes!.point.v : 0;

    const sourceLabel = isObserved ? `Observed (${(obsRes?.point.source || processedData.source || 'NOAA').toUpperCase()})` :
                        isAdjusted ? 'FloodCast Prediction' :
                        isPredicted ? 'NOAA Prediction' : (isLive ? 'Live Conditions' : 'No Data');

    const surge = (() => {
      if (!predRes || predRes.dtMin > 60) return null;
      return wl - predRes.point.v;
    })();

    const isSimulated = isUserSimulating;

    return { 
      wl: isSimulated ? simulationLevel : wl, 
      targetTime: targetT, 
      isLive, 
      source: sourceLabel,
      surge,
      isSimulated,
      prediction: predRes && predRes.dtMin < 60 ? predRes.point.v : null,
      wind: windRes && windRes.dtMin < 60 ? { speed: windRes.point.speed, dir: windRes.point.dir } : null,
      precip: precipRes && precipRes.dtMin < 60 ? precipRes.point.value : null,
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

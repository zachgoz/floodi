import { useMemo } from 'react';
import { interpolate } from 'src/utils/waterForecast';
import { projectResidualPattern } from '../../../functions/src/forecast/pattern';
import { selectWaterForecast } from 'src/utils/selectWaterForecast';
import { decomposeResidualHarmonics } from 'src/utils/residualHarmonics';
import { useChartData } from 'src/components/Tab2/hooks/useChartData';
import { useChallengerOutlook } from 'src/components/dashboard/useChallengerOutlook';
import type { AppConfiguration, Point } from 'src/components/Tab2/types';

const FORECAST_INTERPOLATE_GAP_MS = 3 * 3600_000;

export function useOperationalForecast(config: AppConfiguration) {
  const {
    loading,
    error,
    data,
    processedData,
    refresh,
  } = useChartData(config);

  const {
    challenger,
    refresh: refreshChallenger,
    totalPoints: challengerTotalPoints,
    lowerPoints: challengerLowerPoints,
    upperPoints: challengerUpperPoints,
    residualPoints: challengerResidualPoints,
  } = useChallengerOutlook(config.locationId);

  const anchoredChallengerResidual = useMemo(() => {
    if (!challengerResidualPoints.length) return [];
    const anchor = processedData?.deltaPoints.at(-1);
    if (!anchor) return challengerResidualPoints;
    const futureChallenger = challengerResidualPoints.filter(p => +p.t > +anchor.t);
    return futureChallenger.length ? [anchor, ...futureChallenger] : [anchor];
  }, [challengerResidualPoints, processedData]);

  const anchoredChallengerTotal = useMemo(() => {
    if (!challengerTotalPoints.length) return [];
    const anchor = processedData?.observedPoints.findLast(p => !p.estimated);
    if (!anchor) return challengerTotalPoints;
    const futureChallenger = challengerTotalPoints.filter(p => +p.t > +anchor.t);
    return futureChallenger.length ? [anchor, ...futureChallenger] : [anchor];
  }, [challengerTotalPoints, processedData]);

  const anchoredChallengerLower = useMemo(() => {
    if (!challengerLowerPoints.length) return [];
    const anchor = processedData?.observedPoints.findLast(p => !p.estimated);
    if (!anchor) return challengerLowerPoints;
    const futureChallenger = challengerLowerPoints.filter(p => +p.t > +anchor.t);
    return futureChallenger.length ? [anchor, ...futureChallenger] : [anchor];
  }, [challengerLowerPoints, processedData]);

  const anchoredChallengerUpper = useMemo(() => {
    if (!challengerUpperPoints.length) return [];
    const anchor = processedData?.observedPoints.findLast(p => !p.estimated);
    if (!anchor) return challengerUpperPoints;
    const futureChallenger = challengerUpperPoints.filter(p => +p.t > +anchor.t);
    return futureChallenger.length ? [anchor, ...futureChallenger] : [anchor];
  }, [challengerUpperPoints, processedData]);

  const patternProjection = useMemo(() => {
    if (!processedData) return null;
    const reference = { station: processedData.observationStation, datum: 'MLLW', units: 'ft' };
    return projectResidualPattern(
      processedData.deltaPoints,
      processedData.predictedPoints.map(p => p.t),
      processedData.timeDomain.now,
      reference,
      reference,
    );
  }, [processedData]);

  const surgeEstimatePoints = useMemo(() => {
    if (!processedData) return [];
    const estimates = processedData.observedPoints.filter(p => p.estimated).flatMap(p => {
      const tide = interpolate(processedData.predictedPoints, p.t, FORECAST_INTERPOLATE_GAP_MS);
      return tide === null ? [] : [{ ...p, v: p.v - tide }];
    });
    const anchor = processedData.deltaPoints.at(-1);
    return estimates.length ? [...(anchor ? [anchor] : []), ...estimates] : [];
  }, [processedData]);

  const selectedForecast = useMemo(() => selectWaterForecast({
    outlook: null,
    weatherCompatible: false,
    weatherTotalPoints: [],
    weatherResidualPoints: [],
    steadyTotalPoints: processedData?.adjustedPoints || [],
    tidePoints: processedData?.predictedPoints || [],
    now: processedData?.timeDomain.now || new Date(),
    validationNow: new Date(),
    manualOverride: config.offset.mode === 'manual',
  }), [processedData, config.offset.mode]);

  const isTimesFmPrimary = Boolean(
    config.offset.mode !== 'manual' &&
    challenger &&
    challenger.locationId === config.locationId &&
    (challengerTotalPoints.length > 0 || challengerResidualPoints.length > 0)
  );
  const hasBackendBasinPhysics = Boolean(challenger?.points?.some(p => p.drivers));
  const selectedBounds = useMemo(() => ({
    lower: selectedForecast.lowerPoints ?? [],
    upper: selectedForecast.upperPoints ?? [],
  }), [selectedForecast.lowerPoints, selectedForecast.upperPoints]);

  const decomposedHarmonics = useMemo(() => {
    const anchor = processedData?.deltaPoints?.at(-1);
    return decomposeResidualHarmonics(processedData?.deltaPoints || [], anchor?.t ?? new Date(), 48);
  }, [processedData?.deltaPoints]);

  const subtidalStormAnomalies = useMemo(() => {
    if (!challenger?.points?.length || hasBackendBasinPhysics) return [] as Point[];
    const rawSubtidal = challenger.points.map(p => ({
      tMs: Date.parse(p.t),
      v: typeof p.noaaSurgeFt === 'number' && Number.isFinite(p.noaaSurgeFt) ? p.noaaSurgeFt : p.residualFt,
    })).filter(p => Number.isFinite(p.tMs) && Number.isFinite(p.v));
    if (!rawSubtidal.length) return [] as Point[];

    const halfWinMs = 6.2103 * 3600_000;
    const smoothed = rawSubtidal.map(pt => {
      const neighbors = rawSubtidal.filter(n => Math.abs(n.tMs - pt.tMs) <= halfWinMs);
      const meanVal = neighbors.reduce((s, n) => s + n.v, 0) / neighbors.length;
      return { t: new Date(pt.tMs), v: meanVal };
    });
    const baseSubtidal0 = smoothed[0].v;
    return smoothed.map(pt => ({ t: pt.t, v: pt.v - baseSubtidal0 }));
  }, [challenger, hasBackendBasinPhysics]);

  const operationalSurgePoints = useMemo(() => {
    if (!isTimesFmPrimary || !challengerResidualPoints.length) {
      return selectedForecast.residualPoints;
    }
    const chalEndMs = +challengerResidualPoints.at(-1)!.t;
    const anchor = processedData?.deltaPoints.at(-1);
    const startMs = anchor ? +anchor.t : Date.now();
    const surge: Point[] = [];
    if (anchor) surge.push(anchor);

    const futureTides = (processedData?.predictedPoints || []).filter(p => +p.t > startMs);
    if (hasBackendBasinPhysics) {
      if (futureTides.length > 0) {
        const lastBackendRes = challengerResidualPoints.at(-1)!.v;
        for (const tp of futureTides) {
          const tMs = +tp.t;
          if (tMs <= chalEndMs) {
            const res = interpolate(anchoredChallengerResidual, tp.t, FORECAST_INTERPOLATE_GAP_MS);
            if (res !== null) {
              surge.push({ t: tp.t, v: Math.round(res * 1000) / 1000 });
            }
          } else {
            const hoursPast = Math.max(0, (tMs - chalEndMs) / 3600_000);
            const blend = Math.exp(-hoursPast / 48);
            const harmonicTail = decomposedHarmonics.projectSurge(tp.t);
            const res = blend * lastBackendRes + (1 - blend) * harmonicTail;
            surge.push({ t: tp.t, v: Math.round(res * 1000) / 1000 });
          }
        }
      } else {
        for (const cp of anchoredChallengerResidual) {
          if (anchor && +cp.t <= +anchor.t) continue;
          surge.push({ t: cp.t, v: Math.round(cp.v * 1000) / 1000 });
        }
      }
      return surge;
    }

    if (futureTides.length > 0) {
      let lastStormAnomaly = 0;
      for (const tp of futureTides) {
        const tMs = +tp.t;
        if (tMs <= chalEndMs && subtidalStormAnomalies.length > 0) {
          const anom = interpolate(subtidalStormAnomalies, tp.t, FORECAST_INTERPOLATE_GAP_MS) ?? 0;
          lastStormAnomaly = anom;
          const subtidalTarget = decomposedHarmonics.subtidalMean + anom;
          const res = decomposedHarmonics.projectSurge(tp.t, subtidalTarget);
          surge.push({ t: tp.t, v: Math.round(res * 1000) / 1000 });
        } else {
          const hoursPast = Math.max(0, (tMs - chalEndMs) / 3600_000);
          const decayedAnom = lastStormAnomaly * Math.exp(-hoursPast / 48);
          const subtidalTarget = decomposedHarmonics.subtidalMean + decayedAnom;
          const res = decomposedHarmonics.projectSurge(tp.t, subtidalTarget);
          surge.push({ t: tp.t, v: Math.round(res * 1000) / 1000 });
        }
      }
    } else {
      for (const cp of anchoredChallengerResidual) {
        if (anchor && +cp.t <= +anchor.t) continue;
        const anom = subtidalStormAnomalies.length
          ? (interpolate(subtidalStormAnomalies, cp.t, FORECAST_INTERPOLATE_GAP_MS) ?? 0)
          : 0;
        const subtidalTarget = decomposedHarmonics.subtidalMean + anom;
        const res = decomposedHarmonics.projectSurge(cp.t, subtidalTarget);
        surge.push({ t: cp.t, v: Math.round(res * 1000) / 1000 });
      }
    }

    return surge.map(p => ({ ...p, v: Math.max(-5.0, Math.min(15.0, p.v)) }));
  }, [isTimesFmPrimary, hasBackendBasinPhysics, challengerResidualPoints, anchoredChallengerResidual, processedData, selectedForecast.residualPoints, subtidalStormAnomalies, decomposedHarmonics]);

  const operationalForecastPoints = useMemo(() => {
    if (!isTimesFmPrimary || !challengerResidualPoints.length || !processedData?.predictedPoints?.length) {
      return selectedForecast.totalPoints;
    }
    const anchor = processedData.observedPoints.findLast(p => !p.estimated);
    const startMs = anchor ? +anchor.t : Date.now();

    const points: Point[] = [];
    if (anchor) points.push(anchor);

    const futureTides = processedData.predictedPoints.filter(p => +p.t > startMs);
    const surgeMap = new Map(operationalSurgePoints.map(p => [+p.t, p.v]));

    for (const tp of futureTides) {
      const surgeVal = surgeMap.get(+tp.t) ?? interpolate(operationalSurgePoints, tp.t, FORECAST_INTERPOLATE_GAP_MS);
      if (surgeVal !== null) {
        points.push({ t: tp.t, v: Math.round((tp.v + surgeVal) * 1000) / 1000 });
      } else {
        const fallbackRes = decomposedHarmonics.projectSurge(tp.t);
        points.push({ t: tp.t, v: Math.round((tp.v + fallbackRes) * 1000) / 1000 });
      }
    }

    return points.map(p => ({ ...p, v: Math.max(-3.0, Math.min(22.0, p.v)) }));
  }, [isTimesFmPrimary, challengerResidualPoints, processedData, selectedForecast.totalPoints, operationalSurgePoints, decomposedHarmonics]);

  const operationalLower = useMemo(() => {
    if (!isTimesFmPrimary || !challengerLowerPoints.length) {
      return selectedBounds.lower;
    }
    const chalEndMs = +challengerLowerPoints.at(-1)!.t;
    const bounds: Point[] = [];
    const totalMap = new Map(operationalForecastPoints.map(p => [+p.t, p.v]));

    const anchor = processedData?.observedPoints.findLast(p => !p.estimated);
    const startMs = anchor ? +anchor.t : Date.now();
    const tideInWindow = (processedData?.predictedPoints || []).filter(p => +p.t > startMs && +p.t <= chalEndMs);
    for (const tp of tideInWindow) {
      const estTotal = totalMap.get(+tp.t) ?? tp.v;
      const rawLow = interpolate(anchoredChallengerLower, tp.t, FORECAST_INTERPOLATE_GAP_MS);
      const rawTot = interpolate(anchoredChallengerTotal, tp.t, FORECAST_INTERPOLATE_GAP_MS);
      const spread = rawLow !== null && rawTot !== null ? Math.max(0.2, rawTot - rawLow) : 0.35;
      bounds.push({ t: tp.t, v: Math.round((estTotal - spread) * 1000) / 1000 });
    }

    const futureTides = (processedData?.predictedPoints || []).filter(p => +p.t > chalEndMs);
    for (const tp of futureTides) {
      const hoursPast = (+tp.t - chalEndMs) / 3600_000;
      const uncertainty = Math.min(1.2, 0.8 + 0.001 * hoursPast);
      const estTotal = totalMap.get(+tp.t) ?? tp.v;
      bounds.push({ t: tp.t, v: Math.round((estTotal - uncertainty) * 1000) / 1000 });
    }
    return bounds;
  }, [isTimesFmPrimary, challengerLowerPoints, anchoredChallengerLower, anchoredChallengerTotal, selectedBounds.lower, processedData?.observedPoints, processedData?.predictedPoints, operationalForecastPoints]);

  const operationalUpper = useMemo(() => {
    if (!isTimesFmPrimary || !challengerUpperPoints.length) {
      return selectedBounds.upper;
    }
    const chalEndMs = +challengerUpperPoints.at(-1)!.t;
    const bounds: Point[] = [];
    const totalMap = new Map(operationalForecastPoints.map(p => [+p.t, p.v]));

    const anchor = processedData?.observedPoints.findLast(p => !p.estimated);
    const startMs = anchor ? +anchor.t : Date.now();
    const tideInWindow = (processedData?.predictedPoints || []).filter(p => +p.t > startMs && +p.t <= chalEndMs);
    for (const tp of tideInWindow) {
      const estTotal = totalMap.get(+tp.t) ?? tp.v;
      const rawUp = interpolate(anchoredChallengerUpper, tp.t, FORECAST_INTERPOLATE_GAP_MS);
      const rawTot = interpolate(anchoredChallengerTotal, tp.t, FORECAST_INTERPOLATE_GAP_MS);
      const spread = rawUp !== null && rawTot !== null ? Math.max(0.2, rawUp - rawTot) : 0.35;
      bounds.push({ t: tp.t, v: Math.round((estTotal + spread) * 1000) / 1000 });
    }

    const futureTides = (processedData?.predictedPoints || []).filter(p => +p.t > chalEndMs);
    for (const tp of futureTides) {
      const hoursPast = (+tp.t - chalEndMs) / 3600_000;
      const uncertainty = Math.min(1.2, 0.8 + 0.001 * hoursPast);
      const estTotal = totalMap.get(+tp.t) ?? tp.v;
      bounds.push({ t: tp.t, v: Math.round((estTotal + uncertainty) * 1000) / 1000 });
    }
    return bounds;
  }, [isTimesFmPrimary, challengerUpperPoints, anchoredChallengerUpper, anchoredChallengerTotal, selectedBounds.upper, processedData?.observedPoints, processedData?.predictedPoints, operationalForecastPoints]);

  const operationalForecastLabel = isTimesFmPrimary
    ? 'Forecast'
    : selectedForecast.method === 'steady'
    ? 'Steady forecast'
    : 'Tide only';
  const operationalForecastDescription = isTimesFmPrimary
    ? 'Solid blue line shows the primary operational forecast combining NOAA astronomical tides (8658163), NOAA ETSS ocean & Cape Fear River surge guidance, directional N/NE Myrtle Grove Sound wind setup, USGS Lock #1 discharge, Google TimesFM AI, and 48-hour estuarine tidal harmonics.'
    : selectedForecast.reason;

  const forecastData = useMemo(() => processedData ? {
    ...processedData,
    adjustedPoints: operationalForecastPoints,
    surgeForecastPoints: operationalSurgePoints,
  } : null, [processedData, operationalForecastPoints, operationalSurgePoints]);

  return {
    loading,
    error,
    data,
    processedData,
    refresh,
    challenger,
    refreshChallenger,
    patternProjection,
    surgeEstimatePoints,
    selectedForecast,
    isTimesFmPrimary,
    operationalSurgePoints,
    operationalForecastPoints,
    operationalLower,
    operationalUpper,
    operationalForecastLabel,
    operationalForecastDescription,
    forecastData,
  };
}

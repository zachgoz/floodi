import { validateForecast } from '../../functions/src/forecast/schema';
import type { ForecastDocument } from '../../functions/src/forecast/schema';
import { projectHistoricalResidual, validateHistoricalPatternSummary } from '../../functions/src/forecast/historicalOutlook';
import type { Point } from 'src/components/Tab2/types';
import { interpolate } from './waterForecast';

const HOUR_MS = 3_600_000;
const MAX_COVERAGE_DELAY_MS = 15 * 60_000;
const MAX_FORECAST_GAP_MS = 30 * 60_000;
const LEADS = [1, 3, 6, 12, 24];
const EXTENSION_LEADS = [12, 24, 48, 72];

export interface WaterForecastSelectionInput {
  outlook: ForecastDocument | null;
  weatherCompatible: boolean;
  weatherTotalPoints: Point[];
  weatherResidualPoints: Point[];
  steadyTotalPoints: Point[];
  tidePoints: Point[];
  now: Date;
  /** Issue validity uses wall time even when the chart's live tick is older. */
  validationNow?: Date;
  manualOverride?: boolean;
}

export interface SelectedWaterForecast {
  totalPoints: Point[];
  residualPoints: Point[];
  method: 'weather' | 'learned' | 'steady' | 'tide';
  extensionMethod?: 'residual-reversion';
  tailMethod?: 'historical-pattern';
  lowerPoints?: Point[];
  upperPoints?: Point[];
  weatherSupportedUntil?: Date | null;
  confidence: 'limited' | 'unavailable';
  horizonEnd: Date | null;
  reason: string;
}

const validPoint = (point: Point) => Number.isFinite(+point.t) && Number.isFinite(point.v);
const orderedPoints = (points: Point[]) => [...new Map(points.filter(validPoint).map(point => [+point.t, point])).values()].sort((a, b) => +a.t - +b.t);


function fallback(input: WaterForecastSelectionInput, reason: string): SelectedWaterForecast {
  const steady = orderedPoints(input.steadyTotalPoints);
  if (steady.some(point => +point.t > +input.now)) {
    return {
      totalPoints: steady,
      residualPoints: steady.flatMap(point => {
        const tide = interpolate(input.tidePoints, point.t);
        return tide === null ? [] : [{ t: point.t, v: point.v - tide }];
      }),
      method: 'steady', confidence: 'limited', horizonEnd: steady.at(-1)!.t,
      reason: `${reason} Using the existing water-level projection.`,
    };
  }
  const tide = orderedPoints(input.tidePoints).filter(point => +point.t >= +input.now);
  return {
    totalPoints: tide,
    residualPoints: [],
    method: 'tide', confidence: 'unavailable', horizonEnd: tide.at(-1)?.t ?? null,
    reason: `${reason} Only astronomical tide is available.`,
  };
}

/** Select one physical total-water forecast for charts and hazard calculations.
 * Historical point skill permits a limited-confidence weather forecast; it does
 * not claim issued-weather, peak or flood-event validation. Server totals are
 * never reanchored or extended with a silent persistence tail. Farther outlooks
 * identify their historical baseline separately from measured weather skill.
 */
export function selectWaterForecast(input: WaterForecastSelectionInput): SelectedWaterForecast {
  if (!Number.isFinite(+input.now)) {
    return { totalPoints: [], residualPoints: [], method: 'tide', confidence: 'unavailable', horizonEnd: null, reason: 'Current time is unavailable.' };
  }
  if (input.manualOverride) return fallback(input, 'A manual water-level adjustment is selected.');
  const outlook = input.outlook;
  if (!outlook || !validateForecast(outlook) || !['available', 'experimental'].includes(outlook.status)) {
    return fallback(input, 'A numerical weather forecast is unavailable.');
  }
  if (!input.weatherCompatible) return fallback(input, 'The weather forecast uses a different water-level reference.');
  const validationNow = input.validationNow ?? input.now;
  const age = +validationNow - Date.parse(outlook.generatedAt);
  if (!Number.isFinite(+validationNow) || age < 0 || age > 2 * HOUR_MS || Date.parse(outlook.expiresAt) <= +validationNow) {
    return fallback(input, 'The weather forecast is expired or its issue time is invalid.');
  }
  const leads = outlook.leadValidation;
  const requiredLeads = outlook.method === 'residual-response' ? [1, 3, 6] : LEADS;
  const passesPointScreen = requiredLeads.every(lead => {
    const result = leads?.find(value => value.leadHours === lead);
    return !!result && result.testPairs >= 100 && result.modelMaeFt !== null && result.persistenceMaeFt !== null && result.persistenceMaeFt > 0 && result.modelMaeFt <= result.persistenceMaeFt * .95;
  });
  const validation = outlook.validation;
  const modelPeakError = validation?.model.peakMaeFt ?? null;
  const steadyPeakError = validation?.persistence.peakMaeFt ?? null;
  const adversePeak = modelPeakError !== null && steadyPeakError !== null && modelPeakError > steadyPeakError;
  if (!passesPointScreen || adversePeak) return fallback(input, 'The weather forecast has not passed the historical point-error screen.');

  const origin = Date.parse(outlook.forecastOriginAt ?? outlook.observationAt ?? outlook.generatedAt);
  const baseEnd = origin + (outlook.method === 'residual-response' ? 6 : 24) * HOUR_MS;
  const sourceEnd = Date.parse(outlook.points.at(-1)!.t);
  const extension = outlook.extension;
  const extensionApproved = !!extension && extension.method === 'residual-reversion' &&
    Date.parse(extension.startsAt) <= baseEnd && Date.parse(extension.startsAt) >= origin &&
    Date.parse(extension.endsAt) > baseEnd &&
    outlook.points.some(point => point.t === extension.startsAt) &&
    EXTENSION_LEADS.every(lead => {
      const result = extension.leadValidation.find(value => value.leadHours === lead);
      if (!result || result.testPairs < 100 || result.modelMaeFt === null || result.persistenceMaeFt === null ||
        !Number.isFinite(result.modelMaeFt) || result.modelMaeFt < 0 ||
        !Number.isFinite(result.persistenceMaeFt) || result.persistenceMaeFt < 0 ||
        result.absoluteError90Ft === null || !Number.isFinite(result.absoluteError90Ft) || result.absoluteError90Ft < 0) return false;
      const component = result.method ?? 'residual-reversion';
      if (component === 'steady-residual') {
        // A baseline is transparent evidence, not a claim of learned skill.
        // Only the intermediate bridge may use it; later leads must improve.
        return lead <= 24 && result.modelMaeFt === result.persistenceMaeFt;
      }
      return component === 'residual-reversion' && result.persistenceMaeFt > 0 && result.modelMaeFt <= result.persistenceMaeFt * .95;
    }) && extension.peakWindows >= 7 && extension.peakMaeFt <= extension.persistencePeakMaeFt;
  const extensionHasBaseline = extensionApproved && extension!.leadValidation.some(lead => lead.method === 'steady-residual');
  const tail = outlook.tail;
  // The shared validator verifies coverage and recomputes skill flags from the
  // supplied metrics. A truthful historical baseline is allowed without
  // claiming that it beat persistence at every lead.
  const tailApproved = !!tail && tail.method === 'historical-pattern' && validateHistoricalPatternSummary(tail.summary);
  const tide = orderedPoints(input.tidePoints);
  // Backend and loaded NOAA windows may have different endpoints. Select only
  // the overlap, then append beyond the backend when real NOAA tides exist.
  const tideEnd = tide.at(-1)?.t.getTime() ?? -Infinity;
  const supportedEnd = Math.min(sourceEnd, tailApproved ? tideEnd : extensionApproved ? Math.min(origin + 72 * HOUR_MS, Date.parse(extension!.endsAt)) : baseEnd);
  const totals = input.weatherTotalPoints;
  if (totals.some((point, i) => !validPoint(point) || (i > 0 && +point.t <= +totals[i - 1].t))) {
    return fallback(input, 'The weather forecast contains invalid or unordered water levels.');
  }
  const sourceTotals = new Map(outlook.points.map(point => [Date.parse(point.t), point.totalFt]));
  const residualByTime = new Map(input.weatherResidualPoints.filter(validPoint).map(point => [+point.t, point.v]));
  const futurePoints = totals.filter(point => +point.t >= +input.now && +point.t <= supportedEnd);
  // Retain the preceding native forecast sample when now lies between samples.
  // Otherwise an ongoing event appears to begin in the future at every refresh.
  // Its original timestamp and physical total stay intact.
  const preceding = [...totals].reverse().find(point => +point.t < +input.now && +input.now - +point.t <= MAX_FORECAST_GAP_MS);
  const points = preceding ? [preceding, ...futurePoints] : futurePoints;
  if (futurePoints.length < 2 || +futurePoints[0].t - +input.now > MAX_COVERAGE_DELAY_MS || points.some((point, i) => i > 0 && +point.t - +points[i - 1].t > MAX_FORECAST_GAP_MS)) {
    return fallback(input, 'The weather forecast has insufficient current or continuous coverage.');
  }
  if (points.some(point => {
    const serverTotal = sourceTotals.get(+point.t);
    const residual = residualByTime.get(+point.t);
    const tideLevel = interpolate(tide, point.t);
    return serverTotal === undefined || Math.abs(point.v - serverTotal) > 1e-6 || residual === undefined || tideLevel === null || Math.abs(point.v - tideLevel - residual) > 1e-6;
  })) return fallback(input, 'The forecast lines do not share the same physical water level.');

  const residualPoints = points.map(point => ({ t: point.t, v: residualByTime.get(+point.t)! }));
  const sourceByTime = new Map(outlook.points.map(point => [Date.parse(point.t), point]));
  const lowerPoints = points.map(point => ({ t: point.t, v: sourceByTime.get(+point.t)!.lowerFt }));
  const upperPoints = points.map(point => ({ t: point.t, v: sourceByTime.get(+point.t)!.upperFt }));
  if (tailApproved) {
    const availableEnd = Math.min(sourceEnd, tideEnd);
    // When NOAA ends between native server samples, keep the exact physical
    // server curve by interpolating its total and bounds at that NOAA endpoint.
    if (+points.at(-1)!.t < availableEnd) {
      const t = new Date(availableEnd);
      const sourcePoints = outlook.points.map(point => ({ t: new Date(point.t), v: point.totalFt }));
      const total = interpolate(sourcePoints, t), tideLevel = interpolate(tide, t);
      const lower = interpolate(outlook.points.map(point => ({ t: new Date(point.t), v: point.lowerFt })), t);
      const upper = interpolate(outlook.points.map(point => ({ t: new Date(point.t), v: point.upperFt })), t);
      if (total !== null && tideLevel !== null && lower !== null && upper !== null) {
        points.push({ t, v: total }); residualPoints.push({ t, v: total - tideLevel });
        lowerPoints.push({ t, v: lower }); upperPoints.push({ t, v: upper });
      }
    }
    if (tideEnd > sourceEnd) {
      const times = tide.filter(point => +point.t > sourceEnd).map(point => point.t);
      // Keep the issue's original anchor for lead-time uncertainty even when
      // the displayed curve has dropped earlier samples as live time advances.
      const projectionPrefix = outlook.points.flatMap(point => {
        const t = new Date(point.t), tideLevel = interpolate(tide, t);
        return tideLevel === null ? [] : [{ t, v: point.totalFt - tideLevel }];
      });
      const projected = projectHistoricalResidual(tail!.summary, tide, times, projectionPrefix);
      const lastTotal = points.at(-1)!.v;
      const lastWidth = Math.max(lastTotal - lowerPoints.at(-1)!.v, upperPoints.at(-1)!.v - lastTotal);
      for (let i = 0; i < projected.points.length; i++) {
        const residual = projected.points[i], tideLevel = interpolate(tide, residual.t);
        // A true data gap ends the supported outlook; no generated bridge.
        if (+residual.t - +points.at(-1)!.t > MAX_FORECAST_GAP_MS || tideLevel === null) break;
        const total = tideLevel + residual.v, error = Math.max(lastWidth, projected.errorFt[i]);
        points.push({ t: residual.t, v: total }); residualPoints.push(residual);
        lowerPoints.push({ t: residual.t, v: total - error }); upperPoints.push({ t: residual.t, v: total + error });
      }
    }
  }

  return {
    totalPoints: points,
    residualPoints, lowerPoints, upperPoints,
    method: outlook.method === 'residual-response' ? 'learned' : 'weather', confidence: 'limited', horizonEnd: points.at(-1)!.t,
    ...(extensionApproved ? { extensionMethod: 'residual-reversion' as const } : {}),
    ...(tailApproved ? { tailMethod: 'historical-pattern' as const, weatherSupportedUntil: tail!.weatherSupportedUntil === null ? null : new Date(tail!.weatherSupportedUntil) } : {}),
    reason: tailApproved ? 'The evaluated near-term forecast is preserved. Weather contributes while supported; farther values use an explicit historical baseline with seasonal coverage. Its long-range error has not improved at every lead, and peak and event accuracy remain uncertain. Beyond fourteen days the error envelope is extrapolated.' : extensionHasBaseline ? 'The forecast combines the evaluated near-term response, an explicit steady-residual bridge, and separately screened two- and three-day residual estimates. Historical combined-curve peak checks passed; confidence remains limited.' : extensionApproved ? 'The recent measured response transitions into a separately evaluated residual-reversion forecast for up to three days. Longer-range point and peak errors passed the historical comparison; confidence remains limited.' : outlook.method === 'residual-response' ? 'A separately evaluated six-hour forecast uses recent measured residual changes and astronomical tide. Weather inputs are incomplete or outside the learned range; longer predictions are withheld.' : 'Historical point and peak errors improved over a steady residual. Issued-weather accuracy and reliable event detection still require further evidence.',
  };
}

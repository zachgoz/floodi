import { FORECAST_DRIVER_METADATA } from './attribution';
import { WeatherPoint, Metrics, Validation } from './model';
import { ForecastDocument } from './schema';
import { SITE } from './sources';
import { projectWeatherResidual, projectShortRangeResidual, projectLongRangeResidual, LONG_RANGE_FEATURES, LONG_RANGE_LEADS, ResidualObservation, trainWeatherResponse, WeatherResponseModel, WEATHER_OBSERVATION_MAX_GAP_MS, WEATHER_RESPONSE_FEATURES, WEATHER_RESPONSE_LEADS } from './weatherResponse';
import { projectHistoricalOutlook, validateHistoricalOutlookModel } from './historicalOutlook';
import { floodWindows, interpolate, surgeTrend, WaterPoint } from './water';

const HOUR = 3600_000;
const ordered = <T extends { t: Date }>(points: T[]) => [...new Map(points.filter(p => Number.isFinite(+p.t)).map(p => [+p.t, p])).values()].sort((a, b) => +a.t - +b.t);
// The peak screens must be regenerated for the supported tide-aware curve;
// older caches validate sparse linear interpolation instead.
export const GAUGE_FORECAST_MODEL_VERSION = 'gauge-weather-response-v7';
export interface GaugeForecastOptions { model?: WeatherResponseModel | null; includeDrivers?: boolean }
type SerializedWeatherResponseModel = Omit<WeatherResponseModel, 'trainedUntil' | 'holdoutStarts' | 'testStart' | 'testEnd'> & { trainedUntil: string; holdoutStarts: string; testStart: string; testEnd: string };
export interface GaugeModelCache {
  version: typeof GAUGE_FORECAST_MODEL_VERSION;
  createdAt: string;
  trainingPath: string;
  reference: { station: string; tideStation: string; datum: string; units: string; phaseMinutes: number; offsetFt: number };
  model: SerializedWeatherResponseModel | null;
}

export function serializeGaugeModel(model: WeatherResponseModel | null, createdAt: Date, trainingPath: string): GaugeModelCache {
  return {
    version: GAUGE_FORECAST_MODEL_VERSION, createdAt: createdAt.toISOString(), trainingPath,
    reference: { station: SITE.sensor, tideStation: SITE.tideStation, datum: SITE.datum, units: SITE.units, phaseMinutes: SITE.phaseMinutes, offsetFt: SITE.offsetFt },
    model: model ? { ...model, trainedUntil: model.trainedUntil.toISOString(), holdoutStarts: model.holdoutStarts.toISOString(), testStart: model.testStart.toISOString(), testEnd: model.testEnd.toISOString() } : null,
  };
}
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isoTime = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*Z$/.test(value) && Number.isFinite(Date.parse(value));

/** Revive a daily server model only after its version, reference, date order,
 * validation and ridge vectors have been checked. Old raw-sensor models cannot
 * be accepted as the dashboard gauge, and malformed caches never trigger a fit.
 */
export function restoreGaugeModel(cache: unknown, now: Date): WeatherResponseModel | null {
  if (!Number.isFinite(+now) || !isRecord(cache) || cache.version !== GAUGE_FORECAST_MODEL_VERSION || !isoTime(cache.createdAt) || +now < Date.parse(cache.createdAt) || +now - Date.parse(cache.createdAt) > 72 * HOUR || typeof cache.trainingPath !== 'string' || !cache.trainingPath.startsWith(`forecast-training/${SITE.id}/`) || !isRecord(cache.reference) || cache.reference.station !== SITE.sensor || cache.reference.tideStation !== SITE.tideStation || cache.reference.datum !== SITE.datum || cache.reference.units !== SITE.units || cache.reference.phaseMinutes !== SITE.phaseMinutes || cache.reference.offsetFt !== SITE.offsetFt || !isRecord(cache.model)) return null;
  const model = cache.model;
  const referencesMatch = ['reference', 'tideReference'].every(key => isRecord(model[key]) && model[key].station === SITE.sensor && model[key].datum === SITE.datum && model[key].units === SITE.units);
  if (!referencesMatch || !['trainedUntil', 'holdoutStarts', 'testStart', 'testEnd'].every(key => isoTime(model[key])) || !finite(model.maxObservationGapMs) || model.maxObservationGapMs <= 0 || model.maxObservationGapMs > WEATHER_OBSERVATION_MAX_GAP_MS) return null;
  const trainedUntil = new Date(String(model.trainedUntil)), holdoutStarts = new Date(String(model.holdoutStarts)), testStart = new Date(String(model.testStart)), testEnd = new Date(String(model.testEnd));
  if (+trainedUntil > +now || +trainedUntil < +now - 14 * 24 * HOUR || +holdoutStarts > +testStart || +testStart > +testEnd || +testEnd > +now) return null;
  const validRegressions = (entries: unknown, expectedLeads: number[], featureCount = WEATHER_RESPONSE_FEATURES.length) => Array.isArray(entries) && entries.length === expectedLeads.length && entries.every((entry, i) => {
    if (!isRecord(entry) || entry.leadHours !== expectedLeads[i] || !isRecord(entry.model) || !finite(entry.model.intercept)) return false;
    const regression = entry.model;
    return ['means', 'scales', 'coefficients', 'minimums', 'maximums'].every(key => Array.isArray(regression[key]) && regression[key].length === featureCount && regression[key].every(finite)) && (regression.scales as number[]).every(scale => scale > 0) && (regression.minimums as number[]).every((minimum, j) => minimum <= (regression.maximums as number[])[j]);
  });
  const validLeads = (leads: unknown, expectedLeads: number[]) => Array.isArray(leads) && leads.length === expectedLeads.length && leads.every((lead, i) => isRecord(lead) && lead.leadHours === expectedLeads[i] && ['trainingPairs', 'testPairs'].every(key => finite(lead[key]) && Number.isInteger(lead[key]) && lead[key] >= 0) && ['modelMaeFt', 'persistenceMaeFt', 'absoluteError90Ft'].every(key => lead[key] === null || (finite(lead[key]) && lead[key] >= 0)) && (lead.improvement === null || finite(lead.improvement)) && typeof lead.passes === 'boolean');
  const passesLeadScreen = (leads: unknown[]) => leads.every(lead => isRecord(lead) && lead.passes === true && finite(lead.testPairs) && lead.testPairs >= 100 && finite(lead.modelMaeFt) && finite(lead.persistenceMaeFt) && lead.persistenceMaeFt > 0 && lead.modelMaeFt <= lead.persistenceMaeFt * .95 && finite(lead.improvement) && lead.improvement >= .05);
  const validPeakScreen = (value: unknown) => isRecord(value) && typeof value.eligible === 'boolean' && finite(value.peakWindows) && Number.isInteger(value.peakWindows) && value.peakWindows >= 0 && ['peakMaeFt', 'persistencePeakMaeFt'].every(key => value[key] === null || (finite(value[key]) && value[key] >= 0)) && (!value.eligible || (value.peakWindows >= 7 && finite(value.peakMaeFt) && finite(value.persistencePeakMaeFt) && value.peakMaeFt <= value.persistencePeakMaeFt));
  const passesLongScreen = (leads: unknown[]) => leads.every(lead => {
    if (!isRecord(lead)) return false;
    if (lead.method === 'steady-residual') return [12, 24].includes(Number(lead.leadHours)) && finite(lead.testPairs) && lead.testPairs >= 100 && finite(lead.modelMaeFt) && finite(lead.persistenceMaeFt) && Math.abs(lead.modelMaeFt - lead.persistenceMaeFt) < 1e-9 && finite(lead.absoluteError90Ft) && lead.absoluteError90Ft >= 0 && lead.improvement === 0 && lead.passes === false;
    return (lead.method === undefined || lead.method === 'residual-reversion') && passesLeadScreen([lead]);
  });
  if (!validRegressions(model.regressions, WEATHER_RESPONSE_LEADS)) return null;
  const validation = model.validation;
  if (!isRecord(validation) || validation.weatherInput !== 'reanalysis hindcast' || typeof validation.pointEligible !== 'boolean' || typeof validation.eligible !== 'boolean' || !finite(validation.peakWindows) || !Number.isInteger(validation.peakWindows) || validation.peakWindows < 0 || !['peakMaeFt', 'persistencePeakMaeFt'].every(key => validation[key] === null || (finite(validation[key]) && validation[key] >= 0)) || !validLeads(validation.leads, WEATHER_RESPONSE_LEADS)) return null;
  const adversePeak = finite(validation.peakMaeFt) && finite(validation.persistencePeakMaeFt) && validation.peakMaeFt > validation.persistencePeakMaeFt;
  if (validation.pointEligible && (adversePeak || !passesLeadScreen(validation.leads as unknown[]))) return null;
  if (validation.eligible && (!validation.pointEligible || validation.peakWindows < 7 || !finite(validation.peakMaeFt) || !finite(validation.persistencePeakMaeFt))) return null;
  if (model.shortRange !== undefined) {
    const shortRange = model.shortRange;
    const shortLeads = [1, 3, 6];
    if (!isRecord(shortRange) || !validRegressions(shortRange.regressions, shortLeads) || !validLeads(shortRange.leads, shortLeads) || typeof shortRange.eligible !== 'boolean' || !finite(shortRange.peakWindows) || !Number.isInteger(shortRange.peakWindows) || shortRange.peakWindows < 0 || !['peakMaeFt', 'persistencePeakMaeFt'].every(key => shortRange[key] === null || (finite(shortRange[key]) && shortRange[key] >= 0))) return null;
    if (shortRange.eligible && (!passesLeadScreen(shortRange.leads as unknown[]) || shortRange.peakWindows < 7 || !finite(shortRange.peakMaeFt) || !finite(shortRange.persistencePeakMaeFt) || shortRange.peakMaeFt > shortRange.persistencePeakMaeFt)) return null;
  }
  if (model.longRange !== undefined) {
    const longRange = model.longRange;
    if (!isRecord(longRange) || !validRegressions(longRange.regressions, LONG_RANGE_LEADS, LONG_RANGE_FEATURES.length) || !validLeads(longRange.leads, LONG_RANGE_LEADS) || typeof longRange.eligible !== 'boolean' || !finite(longRange.peakWindows) || !Number.isInteger(longRange.peakWindows) || longRange.peakWindows < 0 || !['peakMaeFt', 'persistencePeakMaeFt'].every(key => longRange[key] === null || (finite(longRange[key]) && longRange[key] >= 0))) return null;
    const leads = longRange.leads as Record<string, unknown>[];
    const baselineBridge = leads.some(lead => lead.method === 'steady-residual');
    if (leads.some(lead => lead.method !== undefined && !['steady-residual', 'residual-reversion'].includes(String(lead.method)))) return null;
    if ((longRange.regressions as Record<string, unknown>[]).some((regression, i) => regression.method !== leads[i].method)) return null;
    if (leads.some(lead => lead.method === 'steady-residual' && (![12, 24].includes(Number(lead.leadHours)) || !finite(lead.modelMaeFt) || !finite(lead.persistenceMaeFt) || Math.abs(lead.modelMaeFt - lead.persistenceMaeFt) >= 1e-9 || lead.improvement !== 0 || lead.passes !== false))) return null;
    if (baselineBridge && (!isRecord(longRange.prefixValidation) || !['residual-response', 'weather-response'].every(key => validPeakScreen((longRange.prefixValidation as Record<string, unknown>)[key])))) return null;
    if (longRange.prefixValidation !== undefined && (!isRecord(longRange.prefixValidation) || !Object.keys(longRange.prefixValidation).every(key => ['residual-response', 'weather-response'].includes(key) && validPeakScreen((longRange.prefixValidation as Record<string, unknown>)[key])))) return null;
    if (baselineBridge && (longRange.regressions as Record<string, unknown>[]).some((entry, i) => leads[i].method === 'steady-residual' && (!isRecord(entry.model) || entry.model.intercept !== 0 || !(entry.model.coefficients as number[]).every(value => value === 0)))) return null;
    const peakPasses = isRecord(longRange.prefixValidation) ? Object.values(longRange.prefixValidation).some(value => isRecord(value) && value.eligible === true) : !baselineBridge && validPeakScreen(longRange) && longRange.eligible === true;
    if (longRange.eligible && (!passesLongScreen(leads) || !peakPasses)) return null;
  }
  if (model.historicalOutlook !== undefined) {
    if (!validateHistoricalOutlookModel(model.historicalOutlook)) return null;
    const outlook = model.historicalOutlook;
    if ([outlook.reference, outlook.tideReference].some(reference => reference.station !== SITE.sensor || reference.datum !== SITE.datum || reference.units !== SITE.units) || Date.parse(outlook.trainingStart) > Date.parse(outlook.trainedUntil) || Date.parse(outlook.trainedUntil) > +now || Date.parse(outlook.testStart) > Date.parse(outlook.testEnd) || Date.parse(outlook.testEnd) > +now) return null;
  }
  if (!Array.isArray(model.limitations) || !model.limitations.every(value => typeof value === 'string')) return null;
  return { ...(model as unknown as WeatherResponseModel), trainedUntil, holdoutStarts, testStart, testEnd };
}

/** Calls are reserved server-side, including failed attempts, to bound cost. */
export function explanationIsDue(lastAttemptAt: unknown, now: Date): boolean {
  return Number.isFinite(+now) && (!isoTime(lastAttemptAt) || +now - Date.parse(lastAttemptAt) >= HOUR);
}

/** Gauge-specific forecast with historical point skill and limited confidence.
 * No Gemini-generated numerical values. Unavailable event validation remains
 * unknown. Scheduled inference uses a daily cached model; local CLI evaluation
 * can omit the model option to fit the same algorithm from its supplied archive.
 */
export function buildGaugeForecast(
  historyInput: ResidualObservation[], historicalTide: WaterPoint[], historyWeather: WeatherPoint[],
  futureTide: WaterPoint[], futureWeather: WeatherPoint[], now: Date,
  options: GaugeForecastOptions = {},
): ForecastDocument {
  const includeDrivers = options.includeDrivers !== false;
  const history = ordered(historyInput.filter(p => !p.estimated && p.t <= now && Number.isFinite(p.v)));
  const tides = ordered([...historicalTide, ...futureTide]);
  const weather = ordered([...historyWeather, ...futureWeather.filter(w => w.t <= now)]);
  const ref = { station: SITE.sensor, datum: SITE.datum, units: SITE.units };
  const recent = surgeTrend(history, now);
  const anchor = history.at(-1);
  const model = Object.prototype.hasOwnProperty.call(options, 'model') ? options.model : trainWeatherResponse(history, tides, weather, ref, ref);
  const document: ForecastDocument = {
    version: 1, status: 'unavailable', method: 'weather-response', confidence: 'limited', validationStage: 'historical-hindcast', generatedAt: now.toISOString(), expiresAt: new Date(+now + 2 * HOUR).toISOString(),
    locationId: SITE.id, sensor: SITE.sensor, tideStation: SITE.tideStation, datum: 'MLLW', units: 'ft',
    phaseMinutes: SITE.phaseMinutes, thresholdFt: SITE.thresholdFt, currentResidualFt: recent.value, trend: recent.trend,
    observationAt: anchor?.t.toISOString(), forecastOriginAt: anchor?.t.toISOString(),
    points: [], validation: null, evidence: [{ id: 'availability', text: 'An evaluated gauge forecast is unavailable: measured history, recent gauge data and complete weather inputs are required.' }],
    explanation: { headline: 'No evaluated forecast', evidenceIds: ['availability'] }, explanationSource: 'fallback',
    sources: ['FIMAN gauge 30046 via Sunny Day Flooding; feet NAVD88 converted using the existing app offset', 'NOAA CO-OPS 8658163; localized astronomical prediction in feet MLLW', 'Open-Meteo gridded reanalysis and issued weather-model forecast at existing Carolina Beach coordinates'],
    limitations: ['Forecast confidence is limited: historical point skill does not establish issued-weather or flood-event accuracy.', 'The existing 2.75 ft datum conversion and 60 minute localized tide reference require calibration.', 'Weather hindcasts omit issued forecast errors; no operational confidence probability is established.', 'Provider quality-not-evaluated samples include isolated spike candidates; observations are not silently cleaned.', 'Gridded weather coordinates refer to the existing nearby platform, not a verified rain gauge or an independently surveyed gauge coordinate.', 'Peak metrics use complete observed windows only; flooding onset, duration and event detection require additional evaluation.', 'Inches above the flood threshold are not calibrated street inundation.'],
  };
  if (!model) return document;
  let leads = model.validation.leads;
  let count = leads.reduce((sum, l) => sum + l.testPairs, 0);
  const weightedMae = (key: 'modelMaeFt' | 'persistenceMaeFt') => count && leads.every(l => l[key] !== null) ? leads.reduce((sum, l) => sum + l[key]! * l.testPairs, 0) / count : null;
  const metrics = (maeFt: number | null, peakMaeFt: number | null): Metrics => ({ samples: count, maeFt, peakMaeFt, onsetMaeMinutes: null, durationMaeMinutes: null, hits: null, misses: null, falseAlarms: null, matchedEvents: null });
  let error = Math.max(...leads.flatMap(l => l.absoluteError90Ft === null ? [] : [l.absoluteError90Ft]));
  const validation: Validation = {
    kind: 'chronological-weather-response-hindcast', trainEnd: new Date(+model.holdoutStarts - 1).toISOString(), testStart: model.testStart.toISOString(), testEnd: model.testEnd.toISOString(),
    trainingSamples: leads.reduce((sum, l) => sum + l.trainingPairs, 0),
    model: metrics(weightedMae('modelMaeFt'), model.validation.peakMaeFt),
    persistence: metrics(weightedMae('persistenceMaeFt'), model.validation.persistencePeakMaeFt),
    tideOnly: metrics(null, null), error90Ft: Number.isFinite(error) ? error : null,
    limitation: 'Purged chronological holdout; target residual changes at 1/3/6/12/24-hour leads, using realized weather. Overlapping issues are dependent. Peak metrics require complete observed windows; unmeasured flooding onset, duration and detection metrics remain null. The error envelope is a hindcast percentile, not a calibrated probability interval.',
  };
  document.validation = validation;
  document.leadValidation = leads.map(({ leadHours, testPairs, modelMaeFt, persistenceMaeFt, absoluteError90Ft }) => ({ leadHours, testPairs, modelMaeFt, persistenceMaeFt, absoluteError90Ft }));
  if ((!model.validation.pointEligible && !model.shortRange?.eligible) || !anchor || recent.value === null) {
    document.evidence = [{ id: 'availability', text: 'The weather model has insufficient coverage, stale observations or did not improve held-out residual predictions. No curve is generated.' }];
    return document;
  }
  // The gauge reports with delay. Forecast from the actual measurement's time,
  // nowcasting that delay with issued meteorology; do not retimestamp the gauge
  // or train on the display's estimated NOAA bridge. Do not issue new forecasts
  // from an observation over one hour old; cached issues retain their timestamp.
  const targets = futureTide.filter(p => p.t >= now && +p.t <= +anchor.t + 24 * HOUR);
  let projected = projectWeatherResidual(model, history, tides, weather, futureWeather, [now, ...targets.map(p => p.t)], anchor.t, ref, ref, { allowPointValidatedExperimental: true, includeDrivers });
  if (!projected.length && model.shortRange?.eligible) {
    projected = projectShortRangeResidual(model, history, tides, [now, ...targets.map(p => p.t)], anchor.t, ref, ref, { includeDrivers });
    if (projected.length) {
      document.method = 'residual-response';
      leads = model.shortRange.leads;
      count = leads.reduce((sum, lead) => sum + lead.testPairs, 0);
      error = Math.max(...leads.flatMap(lead => lead.absoluteError90Ft === null ? [] : [lead.absoluteError90Ft]));
      validation.trainingSamples = leads.reduce((sum, lead) => sum + lead.trainingPairs, 0);
      validation.model = metrics(weightedMae('modelMaeFt'), model.shortRange.peakMaeFt);
      validation.persistence = metrics(weightedMae('persistenceMaeFt'), model.shortRange.persistencePeakMaeFt);
      validation.error90Ft = Number.isFinite(error) ? error : null;
      validation.limitation = 'Chronological same-pair holdout of a six-hour measured-residual, recent-change and astronomical-tide model. Peak metrics preserve all native observed readings. Issued forecast errors and matched-event timing are not included in these cached screening metrics.';
      document.leadValidation = leads.map(({ leadHours, testPairs, modelMaeFt, persistenceMaeFt, absoluteError90Ft }) => ({ leadHours, testPairs, modelMaeFt, persistenceMaeFt, absoluteError90Ft }));
    }
  }
  document.points = projected.flatMap(p => {
    const tide = interpolate(tides, p.t);
    if (tide === null) return [];
    const total = tide + p.v;
    return [{ t: p.t.toISOString(), tideFt: tide, residualFt: p.v, totalFt: total, lowerFt: total - error, upperFt: total + error, ...(p.drivers ? { drivers: p.drivers } : {}) }];
  });
  if (document.points.length < 10 || !Number.isFinite(error)) {
    document.points = [];
    document.evidence = [{ id: 'availability', text: 'Required inputs are incomplete or outside the learned range. No supported numerical forecast is available.' }];
    return document;
  }
  const nearTermPoints = [...document.points];
  const nearTermLimitations = [...document.limitations];
  // Preserve the approved near-term prefix exactly, then evaluate the selected
  // lead models against each target's tide and blend across lead times. A
  // declared 12/24-hour baseline bridge does not claim learned improvement.
  const longRange = model.longRange;
  const baselineBridge = longRange?.leads.some(lead => lead.method === 'steady-residual') ?? false;
  const prefixValidation = longRange?.prefixValidation?.[document.method!];
  const prefixPeak = prefixValidation ?? (!baselineBridge ? longRange : undefined);
  const peakPasses = prefixPeak && prefixPeak.eligible && prefixPeak.peakWindows >= 7 && finite(prefixPeak.peakMaeFt) && finite(prefixPeak.persistencePeakMaeFt) && prefixPeak.peakMaeFt <= prefixPeak.persistencePeakMaeFt;
  const longPasses = longRange?.eligible && peakPasses && longRange.leads.length === LONG_RANGE_LEADS.length && longRange.leads.every((lead, i) => {
    if (lead.leadHours !== LONG_RANGE_LEADS[i] || lead.testPairs < 100 || !finite(lead.modelMaeFt) || !finite(lead.persistenceMaeFt) || !finite(lead.absoluteError90Ft) || lead.absoluteError90Ft < 0) return false;
    if (lead.method === 'steady-residual') return [12, 24].includes(lead.leadHours) && Math.abs(lead.modelMaeFt - lead.persistenceMaeFt) < 1e-9 && lead.improvement === 0 && !lead.passes;
    return (lead.method === undefined || lead.method === 'residual-reversion') && lead.passes && lead.persistenceMaeFt > 0 && lead.modelMaeFt <= lead.persistenceMaeFt * .95 && finite(lead.improvement) && lead.improvement >= .05;
  });
  if (longRange && longPasses) {
    const junction = document.points.at(-1)!;
    const longTargets = futureTide.filter(point => point.t >= now && +point.t <= +anchor.t + 72 * HOUR);
    const extended = projectLongRangeResidual(model, history, tides, [now, ...longTargets.map(point => point.t)], anchor.t, ref, ref, { prefix: projected, includeDrivers });
    const errorControls = [{ leadHours: (+new Date(junction.t) - +anchor.t) / HOUR, error }];
    for (const lead of longRange.leads) if (lead.leadHours > errorControls[0].leadHours) errorControls.push({ leadHours: lead.leadHours, error: Math.max(errorControls.at(-1)!.error, lead.absoluteError90Ft!) });
    const envelopeAt = (at: Date) => {
      const lead = (+at - +anchor.t) / HOUR;
      const upperIndex = errorControls.findIndex(point => point.leadHours >= lead);
      if (upperIndex <= 0) return errorControls[0].error;
      const before = errorControls[upperIndex - 1], after = errorControls[upperIndex];
      return before.error + (after.error - before.error) * (lead - before.leadHours) / (after.leadHours - before.leadHours);
    };
    const tail = ordered(extended.filter(point => +point.t > Date.parse(junction.t) && +point.t <= +anchor.t + 72 * HOUR && Number.isFinite(point.v))).flatMap(point => {
      const tide = interpolate(tides, point.t);
      if (tide === null) return [];
      const total = tide + point.v, envelope = envelopeAt(point.t);
      return [{ t: point.t.toISOString(), tideFt: tide, residualFt: point.v, totalFt: total, lowerFt: total - envelope, upperFt: total + envelope, ...(point.drivers ? { drivers: point.drivers } : {}) }];
    });
    const supportedTail = tail.length && Date.parse(tail[0].t) - Date.parse(junction.t) <= 30 * 60_000 && tail.every((point, i) => i === 0 || Date.parse(point.t) - Date.parse(tail[i - 1].t) <= 30 * 60_000) && Date.parse(tail.at(-1)!.t) >= +anchor.t + 71 * HOUR;
    if (supportedTail) {
      document.points.push(...tail);
      document.extension = {
        method: 'residual-reversion', startsAt: junction.t, endsAt: tail.at(-1)!.t,
        leadValidation: longRange.leads.map(({ leadHours, testPairs, modelMaeFt, persistenceMaeFt, absoluteError90Ft, method }) => ({ leadHours, testPairs, modelMaeFt, persistenceMaeFt, absoluteError90Ft, ...(method ? { method } : {}) })),
        peakMaeFt: prefixPeak!.peakMaeFt!, persistencePeakMaeFt: prefixPeak!.persistencePeakMaeFt!, peakWindows: prefixPeak!.peakWindows,
      };
      document.limitations.push(baselineBridge ? 'Beyond the near-term forecast, the 12/24-hour bridge holds the measured residual steady; evaluated learned residual behavior provides the 48/72-hour outlook. Changing storms and issued-weather errors remain uncertain.' : 'Beyond the near-term model, the three-day outlook uses learned residual reversion and tidal behavior; changing storm conditions and issued-weather errors remain uncertain.');
      document.limitations.push('Lower historical point errors have not consistently improved peak errors or flood-event detection in later replays. The three-day centerline cannot exclude flooding; event timing and detection are not validated.');
    }
  }
  if (model.historicalOutlook) {
    const junction = nearTermPoints.at(-1)!;
    const end = ordered(futureTide).at(-1)?.t;
    const step = 15 * 60_000;
    const tailTimes: Date[] = [];
    if (end && +end > Date.parse(junction.t)) {
      for (let time = Math.floor(Date.parse(junction.t) / step + 1) * step; time <= +end; time += step) tailTimes.push(new Date(time));
      if (tailTimes.at(-1)?.getTime() !== +end) tailTimes.push(end);
    }
    const outlook = projectHistoricalOutlook(model.historicalOutlook, history, tides, weather, futureWeather, [...projected.map(point => point.t), ...tailTimes], anchor.t, ref, ref, { prefix: projected, includeDrivers });
    if (outlook.summary && outlook.validation?.eligible) {
      const lower = new Map(outlook.lower.map(point => [+point.t, point.v]));
      const upper = new Map(outlook.upper.map(point => [+point.t, point.v]));
      const candidate = ordered(outlook.points.filter(point => +point.t > Date.parse(junction.t))).flatMap(point => {
        const tide = interpolate(tides, point.t), lo = lower.get(+point.t), hi = upper.get(+point.t);
        if (tide === null || !finite(point.v) || !finite(lo) || !finite(hi) || lo > point.v || hi < point.v) return [];
        const total = tide + point.v;
        return [{ t: point.t.toISOString(), tideFt: tide, residualFt: point.v, totalFt: total, lowerFt: tide + Math.min(lo, point.v - error), upperFt: tide + Math.max(hi, point.v + error), ...(point.drivers ? { drivers: point.drivers } : {}) }];
      });
      const complete = candidate.length && end && Date.parse(candidate.at(-1)!.t) === +end && Date.parse(candidate[0].t) - Date.parse(junction.t) <= step && candidate.every((point, i) => i === 0 || Date.parse(point.t) - Date.parse(candidate[i - 1].t) <= step);
      if (complete) {
        document.points = [...nearTermPoints, ...candidate];
        delete document.extension;
        document.limitations = [...new Set([...nearTermLimitations, ...outlook.validation.limitations])];
        document.tail = {
          method: 'historical-pattern', startsAt: junction.t, endsAt: candidate.at(-1)!.t,
          weatherSupportedUntil: outlook.weatherSupportedUntil ? new Date(Math.min(+outlook.weatherSupportedUntil, Date.parse(candidate.at(-1)!.t))).toISOString() : null,
          summary: outlook.summary, validation: outlook.validation,
        };
        document.limitations.push(outlook.weatherSupportedUntil ? 'The full NOAA outlook uses issued weather where supported, then a historical residual baseline. The available training season does not establish annual seasonal effects. Uncertainty grows beyond the evaluated leads.' : 'Long-range weather inputs are unsupported. The full NOAA outlook uses a historical residual baseline, which cannot anticipate a new storm and does not establish annual seasonal effects.');
        if (!outlook.summary.historicalEligible) document.limitations.push('The historical baseline did not improve all evaluated lead times and is provided as context beyond supported weather, with limited confidence.');
      }
    }
  }
  if (document.points.some(point => point.drivers)) document.driverInfo = { ...FORECAST_DRIVER_METADATA, factorOrder: [...FORECAST_DRIVER_METADATA.factorOrder] };
  document.status = 'available';
  const events = floodWindows(document.points.map(p => ({ t: new Date(p.t), v: p.totalFt })), SITE.thresholdFt);
  const last = document.points.at(-1)!;
  const change = last.residualFt - document.points[0].residualFt;
  document.evidence = [
    { id: 'availability', text: document.tail ? (document.tail.weatherSupportedUntil ? 'The outlook spans the available astronomical tides, using supported weather followed by a historical residual baseline. Confidence is limited.' : 'The outlook spans the available astronomical tides using a historical residual baseline. Weather inputs cannot support the long-range forecast. Confidence is limited.') : document.method === 'residual-response' ? (document.extension ? 'Using the evaluated short-range forecast followed by a learned three-day residual and tide outlook. Weather is missing or outside the learned range. Confidence is limited.' : 'Using a separately evaluated six-hour forecast of recent measured levels and tide changes. Weather is missing or outside the learned range; long-range predictions are withheld. Confidence is limited.') : 'Forecast available with limited confidence. Historical point errors improved; issued-weather and flood-event accuracy require further validation.' },
    { id: 'anomaly', text: `Measured residual ${anchor.v >= 0 ? '+' : ''}${anchor.v.toFixed(2)} ft · ${recent.trend.toLowerCase()}.` },
    { id: 'risk', text: events.length ? 'The total water-level forecast exceeds flood stage within the available window. Confidence in timing and severity is limited.' : 'The total water-level forecast stays below flood stage within the available window. Confidence is limited.' },
    { id: 'weather', text: document.tail ? `The complete outlook estimates a ${Math.abs(change).toFixed(2)} ft net ${change >= 0 ? 'increase' : 'decrease'} in residual. ${document.tail.weatherSupportedUntil ? 'Weather contributes while supported; subsequent tides use the historical residual baseline.' : 'Long-range weather is unsupported; subsequent tides use the historical residual baseline.'} Uncertainty grows with lead time.` : document.method === 'residual-response' ? (document.extension ? `Measured residual patterns and tidal behavior predict a ${Math.abs(change).toFixed(2)} ft net ${change >= 0 ? 'increase' : 'decrease'} over the available three-day outlook. Future weather-driven departures remain uncertain.` : `Recent measured changes and tidal phase predict a ${Math.abs(change).toFixed(2)} ft ${change >= 0 ? 'increase' : 'decrease'} in residual over the next available six hours. Weather-driven changes beyond this range remain uncertain.`) : (document.extension ? `The near-term weather forecast is followed by learned residual patterns and tidal behavior through three days, with a ${Math.abs(change).toFixed(2)} ft net ${change >= 0 ? 'increase' : 'decrease'} over the complete outlook. Individual causal contributions are not established.` : `The combined tide, wind, pressure and rainfall model predicts a ${Math.abs(change).toFixed(2)} ft ${change >= 0 ? 'increase' : 'decrease'} in residual over the available forecast. Individual causal contributions are not established.`) },
    { id: 'observation', text: `Forecast starts from the gauge measurement at ${anchor.t.toISOString()}; ${(Math.max(0, +now - +anchor.t) / 60_000).toFixed(0)} minutes of reporting delay are estimated using ${document.method === 'residual-response' ? 'recent measured changes and astronomical tide' : 'issued weather'}. No NOAA proxy readings enter this model.` },
    { id: 'validation', text: `${document.extension || document.tail ? 'Near-term held-out' : 'Held-out'} residual error averaged ${validation.model.maeFt!.toFixed(2)} ft versus ${validation.persistence.maeFt!.toFixed(2)} ft for holding the residual steady. ${document.method === 'residual-response' ? 'The short-range predictor uses measured levels and astronomical tide changes.' : 'Realized weather was used; actual weather forecast errors are excluded.'}` },
    { id: 'uncertainty', text: (document.tail ? 'The envelope reflects measured historical errors, with additional growth beyond the evaluated lead times. It is not a calibrated probability interval or an annual seasonal forecast.' : document.extension ? `The error envelope grows from ±${error.toFixed(2)} ft near term using the per-lead held-out absolute-error percentiles through three days. It is not a calibrated probability interval and excludes weather forecast uncertainty.` : `The ±${error.toFixed(2)} ft envelope uses the largest per-lead held-out absolute-error percentile. It is not a calibrated probability interval and excludes weather forecast uncertainty.`) },
  ];
  document.explanation = { headline: events.length ? 'Elevated flood risk' : 'Flood outlook', evidenceIds: ['anomaly', 'weather', 'availability'] };
  return document;
}

/** Local-only counterfactual replay of frozen issued forecasts. No daily-model retraining,
 * provider requests, credentials, production writes, or forecast promotion. */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildGaugeForecast, GAUGE_FORECAST_MODEL_VERSION, restoreGaugeModel } from '../forecast/gaugePipeline';
import type { ForecastDocument, ForecastPoint } from '../forecast/schema';
import { validateForecast } from '../forecast/schema';
import { SITE } from '../forecast/sources';
import { FORECAST_REFERENCE_VERSION } from '../forecast/publication';
import type { WeatherPoint } from '../forecast/model';
import { floodWindows, interpolate, type WaterPoint } from '../forecast/water';
import { completeObservationWindow, matchIntervalEvents, prepareObservations } from '../verification/scorer';
import { FORECAST_MAX_GAP_MS, OBSERVATION_MAX_GAP_MS, VERIFICATION_LEADS_HOURS, type LedgerEvent } from '../verification/types';

const HOUR = 3_600_000;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const timestamp = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*Z$/.test(value) && Number.isFinite(Date.parse(value));
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
export const CURVE_LEAD_BANDS = [3, 6, 12, 24, 48, 72] as const;
export type CurveCohort = 'development' | 'selection' | 'final-test' | 'outside-cohorts';

export function issuedCurveCohort(origin: string): CurveCohort {
  if (!timestamp(origin)) throw new Error('Invalid replay origin');
  const day = origin.slice(0, 10);
  if (day >= '2026-10-14' && day <= '2026-10-20') return 'development';
  if (day >= '2026-10-21' && day <= '2026-10-22') return 'selection';
  if (day >= '2026-10-23' && day <= '2026-10-25') return 'final-test';
  return 'outside-cohorts';
}

function parseSeries(value: unknown): WaterPoint[] | null {
  if (!Array.isArray(value) || value.some(point => !record(point) || !timestamp(point.t) || !finite(point.v))) return null;
  const points = value.map(point => ({ t: new Date(point.t as string), v: point.v as number }));
  if (points.some((point, index) => index > 0 && +points[index - 1].t >= +point.t)) return null;
  return points;
}

export interface PreparedCurveReplay {
  origin: string;
  publicationAt: string;
  archived: ForecastDocument;
  candidate: ForecastDocument;
  tide: WaterPoint[];
  originalModelVersion: string;
}
type CandidateBuilder = typeof buildGaugeForecast;

/** A local version substitution permits the new projection to reuse the exact
 * archived coefficients. It does not accept old-shape peak validation in the
 * production cache, or establish that the counterfactual curve is operational. */
export function prepareIssuedCurveReplay(
  value: unknown, modelCaches: Record<string, unknown>, asOf: Date,
  candidateBuilder: CandidateBuilder = buildGaugeForecast,
): { replay: PreparedCurveReplay | null; exclusion: string | null } {
  const reject = (exclusion: string) => ({ replay: null, exclusion });
  if (!Number.isFinite(+asOf) || !record(value) || !timestamp(value.origin) || Date.parse(value.origin) > +asOf || !record(value.publication)) return reject('invalid-origin-or-publication');
  const forecast = value.forecast;
  if (!validateForecast(forecast)) return reject('invalid-archived-forecast');
  if (forecast.status === 'unavailable') return reject('issue-unavailable');
  if (Date.parse(forecast.expiresAt) <= Date.parse(value.origin)) return reject('issue-expired');
  const publishedAt = value.publication.publishedAt;
  if (!timestamp(publishedAt) || Date.parse(forecast.generatedAt) > Date.parse(publishedAt) || Date.parse(publishedAt) > Date.parse(value.origin)) return reject('invalid-publication-timing');
  const legacyReference = value.publication.publicationBasis === 'legacy-create-time' && (value.publication.referenceVersion === null || value.publication.referenceVersion === undefined);
  if ((!legacyReference && value.publication.referenceVersion !== FORECAST_REFERENCE_VERSION) || forecast.sensor !== SITE.sensor || forecast.tideStation !== SITE.tideStation || forecast.datum !== SITE.datum || forecast.units !== SITE.units || forecast.phaseMinutes !== SITE.phaseMinutes || forecast.thresholdFt !== SITE.thresholdFt) return reject('incompatible-reference');
  const input = value.input;
  if (!record(input) || input.version !== 1 || input.issuedAt !== forecast.generatedAt || !record(input.reference)) return reject('invalid-issued-input');
  const reference = input.reference;
  if (reference.station !== SITE.sensor || reference.tideStation !== SITE.tideStation || reference.datum !== SITE.datum || reference.units !== SITE.units || reference.phaseMinutes !== SITE.phaseMinutes || reference.offsetFt !== SITE.offsetFt || reference.thresholdFt !== SITE.thresholdFt) return reject('incompatible-input-reference');
  const history = parseSeries(input.recentResidual), tide = parseSeries(input.tide);
  if (!history?.length || !tide?.length || history.some(point => +point.t > Date.parse(forecast.generatedAt))) return reject('invalid-or-future-history');
  if (Array.isArray(input.recentResidual) && input.recentResidual.some(point => record(point) && point.estimated === true)) return reject('estimated-history');
  if (forecast.observationAt !== history.at(-1)!.t.toISOString()) return reject('observation-anchor-mismatch');
  if (!Array.isArray(input.weather) || input.weather.some(row => !record(row) || !timestamp(row.t) || ['windSpeed', 'windDirection', 'pressure', 'precip'].some(key => row[key] !== undefined && !finite(row[key])))) return reject('invalid-issued-weather');
  const weather: WeatherPoint[] = input.weather.map(row => ({ ...row, t: new Date(row.t as string) }));
  if (weather.some((row, index) => index > 0 && +weather[index - 1].t >= +row.t)) return reject('invalid-issued-weather');
  if (record(input.sources) && input.sources.weatherRetrievedAt !== null && input.sources.weatherRetrievedAt !== undefined && (!timestamp(input.sources.weatherRetrievedAt) || Date.parse(input.sources.weatherRetrievedAt) > Date.parse(forecast.generatedAt))) return reject('future-weather-retrieval');
  const cache = timestamp(input.modelCreatedAt) ? modelCaches[input.modelCreatedAt] : null;
  if (!record(cache) || cache.createdAt !== input.modelCreatedAt || !['gauge-weather-response-v6', GAUGE_FORECAST_MODEL_VERSION].includes(String(cache.version))) return reject('missing-or-unsupported-frozen-model');
  const issuedAt = new Date(forecast.generatedAt);
  const model = restoreGaugeModel({ ...cache, version: GAUGE_FORECAST_MODEL_VERSION }, issuedAt);
  if (!model) return reject('invalid-frozen-model');
  const candidate = candidateBuilder(history, [], weather.filter(row => row.t <= issuedAt), tide, weather, issuedAt, { model, includeDrivers: false });
  if (!validateForecast(candidate) || candidate.status === 'unavailable' || candidate.generatedAt !== forecast.generatedAt || candidate.observationAt !== forecast.observationAt) return reject('candidate-unavailable');
  return { replay: { origin: value.origin, publicationAt: publishedAt, archived: forecast, candidate, tide, originalModelVersion: String(cache.version) }, exclusion: null };
}

interface PointPair {
  targetAt: string;
  leadHours: number;
  bandHours: number;
  archivedErrorFt: number;
  candidateErrorFt: number;
  archivedResidualErrorFt: number;
  candidateResidualErrorFt: number;
}
const curveSeries = (points: ForecastPoint[], key: 'totalFt' | 'residualFt') => points.map(point => ({ t: new Date(point.t), v: point[key] }));
function bounded(points: WaterPoint[], start: Date, end: Date, maxGap: number): WaterPoint[] | null {
  if (!completeObservationWindow(points, start, end, maxGap)) return null;
  return [{ t: start, v: interpolate(points, start, maxGap)! }, ...points.filter(point => point.t > start && point.t < end), { t: end, v: interpolate(points, end, maxGap)! }];
}
function ledger(points: WaterPoint[], threshold: number, maxGap: number): LedgerEvent[] {
  return floodWindows(points, threshold, maxGap).map(event => ({ id: event.startTime.toISOString(), startAt: event.startTime.toISOString(), endAt: event.endTime?.toISOString() || null, lastSampleAt: event.lastSampleTime.toISOString(), peakAt: event.peakTime.toISOString(), peakFt: event.peakValue, startClipped: event.startClipped, complete: !event.startClipped && event.endTime !== null, onsetBracket: null, endBracket: null }));
}

/** Uses the same native cadence, strict threshold and positive-interval-overlap
 * matching as the prospective scorer; missing windows are never counted dry. */
export function evaluateIssuedFloodWindow(origin: Date, actual: WaterPoint[], prediction: WaterPoint[], threshold = SITE.thresholdFt, hours = 24) {
  if (![6, 12, 24].includes(hours)) throw new Error('Event windows must be 6, 12 or 24 hours');
  const end = new Date(+origin + hours * HOUR);
  const truth = bounded(actual, origin, end, OBSERVATION_MAX_GAP_MS), forecast = bounded(prediction, origin, end, FORECAST_MAX_GAP_MS);
  if (!truth || !forecast) return { status: 'excluded' as const, exclusion: !truth ? 'observation-unsupported' : 'forecast-unsupported', observedNewIds: [], missedIds: [], unmatchedPredictedIds: [], matches: [], peakErrorFt: null, peakTimingErrorMinutes: null };
  const observed = ledger(truth, threshold, OBSERVATION_MAX_GAP_MS), predicted = ledger(forecast, threshold, FORECAST_MAX_GAP_MS);
  const pairs = matchIntervalEvents(observed, predicted, end.toISOString());
  const matched = new Set(pairs.map(pair => pair.observedIndex)), matchedPredicted = new Set(pairs.map(pair => pair.predictedIndex));
  const truthPeak = truth.reduce((peak, point) => point.v > peak.v ? point : peak), forecastPeak = forecast.reduce((peak, point) => point.v > peak.v ? point : peak);
  return {
    status: 'scored' as const, exclusion: null,
    observedNewIds: observed.filter(event => !event.startClipped).map(event => event.id),
    missedIds: observed.filter((event, index) => !event.startClipped && !matched.has(index)).map(event => event.id),
    unmatchedPredictedIds: predicted.filter((_, index) => !matchedPredicted.has(index)).map(event => event.id),
    matches: pairs.map(pair => {
      const a = observed[pair.observedIndex], p = predicted[pair.predictedIndex];
      return { observedId: a.id, predictedId: p.id, newOnset: !a.startClipped, complete: a.complete && p.complete, onsetErrorMinutes: !a.startClipped && !p.startClipped ? (Date.parse(p.startAt) - Date.parse(a.startAt)) / 60_000 : null, peakErrorFt: a.complete && p.complete ? p.peakFt - a.peakFt : null, peakTimingErrorMinutes: a.complete && p.complete ? (Date.parse(p.peakAt) - Date.parse(a.peakAt)) / 60_000 : null, durationErrorMinutes: a.complete && p.complete ? ((Date.parse(p.endAt!) - Date.parse(p.startAt)) - (Date.parse(a.endAt!) - Date.parse(a.startAt))) / 60_000 : null };
    }),
    peakErrorFt: forecastPeak.v - truthPeak.v,
    peakTimingErrorMinutes: (+forecastPeak.t - +truthPeak.t) / 60_000,
  };
}

function residualExtremaErrors(actual: WaterPoint[], forecast: WaterPoint[]) {
  const peak = (points: WaterPoint[]) => points.reduce((best, point) => point.v > best.v ? point : best);
  const valley = (points: WaterPoint[]) => points.reduce((best, point) => point.v < best.v ? point : best);
  const actualPeak = peak(actual), predictedPeak = peak(forecast), actualValley = valley(actual), predictedValley = valley(forecast);
  return { peakErrorFt: predictedPeak.v - actualPeak.v, valleyErrorFt: predictedValley.v - actualValley.v, peakTimingErrorMinutes: (+predictedPeak.t - +actualPeak.t) / 60_000, valleyTimingErrorMinutes: (+predictedValley.t - +actualValley.t) / 60_000 };
}

export function evaluateIssuedCurvePairs(replay: PreparedCurveReplay, observations: WaterPoint[], asOf: Date) {
  const origin = new Date(replay.origin);
  const truth = prepareObservations(observations.filter(point => point.t <= asOf));
  const archived = curveSeries(replay.archived.points, 'totalFt'), candidate = curveSeries(replay.candidate.points, 'totalFt');
  const oldResidual = curveSeries(replay.archived.points, 'residualFt'), newResidual = curveSeries(replay.candidate.points, 'residualFt');
  const target = (leadHours: number): PointPair | null => {
    const at = new Date(+origin + leadHours * HOUR);
    if (at > asOf) return null;
    const measured = interpolate(truth, at, OBSERVATION_MAX_GAP_MS), oldFt = interpolate(archived, at, FORECAST_MAX_GAP_MS), newFt = interpolate(candidate, at, FORECAST_MAX_GAP_MS);
    const tideFt = interpolate(replay.tide, at, FORECAST_MAX_GAP_MS), oldR = interpolate(oldResidual, at, FORECAST_MAX_GAP_MS), newR = interpolate(newResidual, at, FORECAST_MAX_GAP_MS);
    if ([measured, oldFt, newFt, tideFt, oldR, newR].some(value => value === null)) return null;
    return { targetAt: at.toISOString(), leadHours, bandHours: CURVE_LEAD_BANDS.find(end => leadHours <= end)!, archivedErrorFt: oldFt! - measured!, candidateErrorFt: newFt! - measured!, archivedResidualErrorFt: oldR! - (measured! - tideFt!), candidateResidualErrorFt: newR! - (measured! - tideFt!) };
  };
  const denseTargets = Array.from({ length: 144 }, (_, i) => target((i + 1) / 2)).filter((row): row is PointPair => row !== null);
  const leads = VERIFICATION_LEADS_HOURS.map(hours => target(hours)).filter((row): row is PointPair => row !== null);
  const eventWindows = [6, 12, 24].filter(hours => +origin + hours * HOUR <= +asOf).map(hours => ({ hours, archived: evaluateIssuedFloodWindow(origin, truth, archived, SITE.thresholdFt, hours), candidate: evaluateIssuedFloodWindow(origin, truth, candidate, SITE.thresholdFt, hours) }));
  const fullDay = eventWindows.find(window => window.hours === 24);
  const event = fullDay ? { archived: fullDay.archived, candidate: fullDay.candidate } : null;
  const shapeEnd = new Date(+origin + 24 * HOUR);
  const shapeTruth = shapeEnd <= asOf ? bounded(truth, origin, shapeEnd, OBSERVATION_MAX_GAP_MS) : null;
  const shapeArchived = shapeTruth ? bounded(oldResidual, origin, shapeEnd, FORECAST_MAX_GAP_MS) : null;
  const shapeCandidate = shapeTruth ? bounded(newResidual, origin, shapeEnd, FORECAST_MAX_GAP_MS) : null;
  const residualTruth = shapeTruth?.map(point => {
    const tide = interpolate(replay.tide, point.t, FORECAST_MAX_GAP_MS);
    return tide === null ? null : { t: point.t, v: point.v - tide };
  });
  const residualShape24h = residualTruth && residualTruth.every((point): point is WaterPoint => point !== null) && shapeArchived && shapeCandidate ? { archived: residualExtremaErrors(residualTruth, shapeArchived), candidate: residualExtremaErrors(residualTruth, shapeCandidate) } : null;
  const endpointChanges = (replay.archived.method === 'residual-response' ? [1, 3, 6] : [1, 3, 6, 12, 24]).flatMap(hours => {
    if (!replay.archived.observationAt) return [];
    const at = new Date(Date.parse(replay.archived.observationAt) + hours * HOUR);
    const before = interpolate(oldResidual, at, FORECAST_MAX_GAP_MS), after = interpolate(newResidual, at, FORECAST_MAX_GAP_MS);
    return before === null || after === null ? [] : [{ at: at.toISOString(), leadFromObservationHours: hours, archivedResidualFt: before, candidateResidualFt: after, changeFt: after - before }];
  });
  const joinAt = replay.candidate.tail?.startsAt || replay.candidate.extension?.startsAt;
  const join = joinAt ? (() => {
    const index = newResidual.findIndex(point => point.t.toISOString() === joinAt);
    const at = newResidual[index], before = newResidual[index - 1], after = newResidual[index + 1];
    return at && before && after ? { at: joinAt, beforeGapMinutes: (+at.t - +before.t) / 60_000, afterGapMinutes: (+after.t - +at.t) / 60_000, beforeStepFt: at.v - before.v, afterStepFt: after.v - at.v } : null;
  })() : null;
  const horizon = { archivedEndsAt: replay.archived.points.at(-1)!.t, candidateEndsAt: replay.candidate.points.at(-1)!.t, maxCandidateGapMinutes: Math.max(0, ...newResidual.slice(1).map((point, index) => (+point.t - +newResidual[index].t) / 60_000)) };
  return { origin: replay.origin, cohort: issuedCurveCohort(replay.origin), originalModelVersion: replay.originalModelVersion, denseTargets, leads, endpointChanges, join, horizon, event, eventWindows, residualShape24h, fixedDailyOrigin: origin.getUTCHours() === 0 && origin.getUTCMinutes() === 0 };
}

type CurveEvaluation = ReturnType<typeof evaluateIssuedCurvePairs>;
function pairMetrics(rows: PointPair[]) {
  return { samples: rows.length, archivedMaeFt: mean(rows.map(row => Math.abs(row.archivedErrorFt))), candidateMaeFt: mean(rows.map(row => Math.abs(row.candidateErrorFt))), archivedBiasFt: mean(rows.map(row => row.archivedErrorFt)), candidateBiasFt: mean(rows.map(row => row.candidateErrorFt)), archivedResidualMaeFt: mean(rows.map(row => Math.abs(row.archivedResidualErrorFt))), candidateResidualMaeFt: mean(rows.map(row => Math.abs(row.candidateResidualErrorFt))) };
}
export function summarizeIssuedCurves(rows: CurveEvaluation[]) {
  return (['development', 'selection', 'final-test', 'outside-cohorts'] as const).map(cohort => {
    const group = rows.filter(row => row.cohort === cohort);
    const eventSummary = (fixedOnly: boolean, hours = 24) => (['archived', 'candidate'] as const).map(method => {
      const windows = group.filter(row => !fixedOnly || row.fixedDailyOrigin).flatMap(row => {
        const window = row.eventWindows.find(value => value.hours === hours);
        return window && window.archived.status === 'scored' && window.candidate.status === 'scored' ? [window[method]] : [];
      });
      const matches = windows.flatMap(window => window.matches).filter(match => match.newOnset && match.complete);
      return { method, commonWindows: windows.length, observedNewEventPairs: windows.reduce((sum, window) => sum + window.observedNewIds.length, 0), uniqueObservedNewEvents: new Set(windows.flatMap(window => window.observedNewIds)).size, missedEventPairs: windows.reduce((sum, window) => sum + window.missedIds.length, 0), uniqueMissedNewEvents: new Set(windows.flatMap(window => window.missedIds)).size, unmatchedPredictedEventPairs: windows.reduce((sum, window) => sum + window.unmatchedPredictedIds.length, 0), completeMatchedEventPairs: matches.length, peakMaeFt: mean(matches.flatMap(match => match.peakErrorFt === null ? [] : [Math.abs(match.peakErrorFt)])), onsetMaeMinutes: mean(matches.flatMap(match => match.onsetErrorMinutes === null ? [] : [Math.abs(match.onsetErrorMinutes)])), durationMaeMinutes: mean(matches.flatMap(match => match.durationErrorMinutes === null ? [] : [Math.abs(match.durationErrorMinutes)])), windowPeakMaeFt: mean(windows.map(window => Math.abs(window.peakErrorFt!))), windowPeakTimingMaeMinutes: mean(windows.map(window => Math.abs(window.peakTimingErrorMinutes!))) };
    });
    const residualShape24h = (['archived', 'candidate'] as const).map(method => {
      const shapes = group.flatMap(row => row.residualShape24h ? [row.residualShape24h[method]] : []);
      return { method, commonCompleteWindows: shapes.length, peakMaeFt: mean(shapes.map(shape => Math.abs(shape.peakErrorFt))), valleyMaeFt: mean(shapes.map(shape => Math.abs(shape.valleyErrorFt))), peakTimingMaeMinutes: mean(shapes.map(shape => Math.abs(shape.peakTimingErrorMinutes))), valleyTimingMaeMinutes: mean(shapes.map(shape => Math.abs(shape.valleyTimingErrorMinutes))) };
    });
    return { cohort, origins: group.length, denseBands: CURVE_LEAD_BANDS.map(hours => ({ throughHours: hours, ...pairMetrics(group.flatMap(row => row.denseTargets).filter(row => row.bandHours === hours)) })), leads: VERIFICATION_LEADS_HOURS.map(hours => ({ leadHours: hours, ...pairMetrics(group.flatMap(row => row.leads).filter(row => row.leadHours === hours)) })), maximumNearTermEndpointChangeFt: Math.max(0, ...group.flatMap(row => row.endpointChanges).map(point => Math.abs(point.changeFt))), shortenedHorizons: group.filter(row => Date.parse(row.horizon.candidateEndsAt) < Date.parse(row.horizon.archivedEndsAt)).length, maximumCandidateGapMinutes: Math.max(0, ...group.map(row => row.horizon.maxCandidateGapMinutes)), residualShape24h, overlapping6hWindows: eventSummary(false, 6), overlapping12hWindows: eventSummary(false, 12), overlapping24hWindows: eventSummary(false), fixedMidnight24hWindows: eventSummary(true) };
  });
}

export function parseIssuedCurveArgs(args: string[]) {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!['--input', '--out', '--as-of', '--proposal'].includes(key) || values.has(key) || !value || value.startsWith('--')) throw new Error('Use --input LOCAL_DIRECTORY --out LOCAL_REPORT [--as-of ISO_UTC] [--proposal LABEL]');
    values.set(key, value);
  }
  if (!values.get('--input') || !values.get('--out') || (values.has('--as-of') && !timestamp(values.get('--as-of')))) throw new Error('Local input, output and valid optional UTC cutoff are required');
  const proposal = values.get('--proposal') || 'continuous-tide-aware-curve';
  if (!/^[a-z0-9-]{1,100}$/.test(proposal)) throw new Error('Proposal label must be a short lowercase identifier');
  return { input: resolve(values.get('--input')!), out: resolve(values.get('--out')!), asOf: new Date(values.get('--as-of') || Date.now()), proposal };
}

function main() {
  const args = parseIssuedCurveArgs(process.argv.slice(2));
  const numericalCodeHash = createHash('sha256').update(readFileSync(require.resolve('../forecast/weatherResponse'))).update(readFileSync(require.resolve('../forecast/gaugePipeline'))).digest('hex');
  const read = (file: string): unknown => JSON.parse(readFileSync(join(args.input, file), 'utf8'));
  const rawObservations = read('observations.json'), caches = read('models.json');
  if (!Array.isArray(rawObservations) || rawObservations.some(point => !record(point) || !timestamp(point.t) || !finite(point.v)) || !record(caches)) throw new Error('Invalid local observations or model map');
  const observations = prepareObservations(rawObservations.map(point => ({ t: new Date(point.t as string), v: point.v as number })));
  const files = readdirSync(args.input).filter(name => /^issue-.*\.json$/.test(name)).sort();
  if (!files.length) throw new Error('No local issue archives');
  const evaluated: CurveEvaluation[] = [], exclusions: { file: string; reason: string }[] = [];
  for (const file of files) {
    const result = prepareIssuedCurveReplay(read(file), caches, args.asOf);
    if (!result.replay) exclusions.push({ file, reason: result.exclusion! });
    else evaluated.push(evaluateIssuedCurvePairs(result.replay, observations, args.asOf));
  }
  const report = { version: 1, proposal: args.proposal, evaluationType: 'retrospective-counterfactual-replay', numericalCodeHash, candidateModelCacheVersion: GAUGE_FORECAST_MODEL_VERSION, createdAt: new Date().toISOString(), asOf: args.asOf.toISOString(), localOnly: true, dailyModelRetrainingPerformed: false, frozenDailyCoefficients: true, sourceDirectory: args.input, files: files.length, evaluatedOrigins: evaluated.length, exclusions, cohorts: summarizeIssuedCurves(evaluated), evaluations: evaluated,
    limitations: ['Counterfactual replay with exact frozen issued inputs and coefficients; archived backend output is not a reconstruction of every dashboard selection or delivered alert.', 'Replay-only cache-version substitution retains legacy structural/eligibility checks. Old peak gates do not validate the new curve; this report does not promote a model.', 'Development October 14–20, selection October 21–22 and final test October 23–25 are fixed origin-date groups; overlapping target times and hourly windows are dependent, not independent storms.', 'Cohort names are date labels: a proposal refined after reviewing previous results is retrospective and cannot claim that the final-test group remained untouched.', 'Only common supported targets enter either error metric. Missing or future outcomes are excluded, never dry observations.', 'Native observations allow at most 30min+10s gaps; crossings are interpolated and between-sample peaks remain unknown.', 'Unique missed event IDs can also be hit at another origin; use fixed daily cohorts and explicit per-origin results when interpreting detection.', 'Current gauge datum/phase calibration and historical observation provenance limitations remain. No probability interval or street-depth accuracy is inferred.'] };
  writeFileSync(args.out, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ output: args.out, evaluatedOrigins: evaluated.length, excludedOrigins: exclusions.length, cohorts: report.cohorts }));
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : 'Local issued-curve evaluation failed'); process.exitCode = 1; }
}

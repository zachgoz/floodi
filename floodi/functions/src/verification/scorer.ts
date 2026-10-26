import { createHash } from 'node:crypto';
import { floodWindows, interpolate, type FloodWindow, type WaterPoint } from '../forecast/water';
import {
  EVENT_WINDOW_HOURS, FORECAST_MAX_GAP_MS, OBSERVATION_MAX_GAP_MS,
  VERIFICATION_LEADS_HOURS, VERIFICATION_VERSION,
  type CrossingBracket, type EventMatch, type EventWindowScore, type LedgerEvent, type PublishedIssue,
  type TargetScore, type VerificationDay, type VerificationDayInput,
  type VerificationExclusion, type VerificationMethod, type VerificationReference,
} from './types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const METHODS: VerificationMethod[] = ['served', 'tide-only', 'persistence'];
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const timestamp = (value: unknown): value is string => typeof value === 'string' && /Z$/.test(value) && Number.isFinite(Date.parse(value));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function verificationDayStart(day: string): Date {
  if (!/^\d{4}-\d\d-\d\d$/.test(day)) throw new Error('Verification requires a UTC YYYY-MM-DD day');
  const start = new Date(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(+start) || start.toISOString().slice(0, 10) !== day) throw new Error('Invalid verification day');
  return start;
}

export function hourlyOrigins(day: string): Date[] {
  const start = +verificationDayStart(day);
  return Array.from({ length: 24 }, (_, hour) => new Date(start + hour * HOUR));
}

/** Select by actual availability, including unavailable/expired publications. */
export function selectPublishedIssue(issues: PublishedIssue[], origin: Date): PublishedIssue | null {
  return issues.filter(issue => timestamp(issue.publishedAt) && +new Date(issue.publishedAt) <= +origin)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || b.issueId.localeCompare(a.issueId))[0] || null;
}

/** Conflicting native values at one timestamp are unknown, not arbitrarily averaged. */
export function prepareObservations(points: WaterPoint[]): WaterPoint[] {
  const values = new Map<number, number | null>();
  for (const point of points) {
    if (!Number.isFinite(+point.t) || !finite(point.v)) continue;
    const previous = values.get(+point.t);
    values.set(+point.t, previous === undefined || previous === point.v ? point.v : null);
  }
  return [...values].flatMap(([t, v]) => v === null ? [] : [{ t: new Date(t), v }]).sort((a, b) => +a.t - +b.t);
}

/** Require endpoint brackets and every native interval; never extrapolate. */
export function completeObservationWindow(points: WaterPoint[], start: Date, end: Date, maxGap = OBSERVATION_MAX_GAP_MS): boolean {
  if (+end <= +start || interpolate(points, start, maxGap) === null || interpolate(points, end, maxGap) === null) return false;
  return !points.some((point, index) => index > 0 && +point.t > +start && +points[index - 1].t < +end && +point.t - +points[index - 1].t > maxGap);
}

function boundedSeries(points: WaterPoint[], start: Date, end: Date, maxGap: number): WaterPoint[] | null {
  if (!completeObservationWindow(points, start, end, maxGap)) return null;
  return [
    { t: start, v: interpolate(points, start, maxGap)! },
    ...points.filter(point => +point.t > +start && +point.t < +end),
    { t: end, v: interpolate(points, end, maxGap)! },
  ];
}

function compatibleReference(value: Record<string, unknown>, reference: VerificationReference): boolean {
  return value.locationId === reference.locationId && value.sensor === reference.sensor &&
    value.tideStation === reference.tideStation && value.datum === reference.datum && value.units === reference.units &&
    value.phaseMinutes === reference.phaseMinutes && value.thresholdFt === reference.thresholdFt;
}

function issueExclusion(issue: PublishedIssue | null, origin: Date, reference: VerificationReference): VerificationExclusion | null {
  if (!issue) return 'no-published-issue';
  if (!timestamp(issue.generatedAt) || !timestamp(issue.publishedAt) || Date.parse(issue.generatedAt) > Date.parse(issue.publishedAt) || issue.issueId !== issue.generatedAt)
    return 'invalid-publication';
  if (issue.publicationBasis === 'atomic-publication' && (issue.referenceVersion !== reference.version ||
      !issue.publicationReference || !compatibleReference(issue.publicationReference as unknown as Record<string, unknown>, reference) || issue.publicationReference.offsetFt !== reference.offsetFt)) return 'incompatible-reference';
  const forecast = issue.forecast;
  if (!forecast || !timestamp(forecast.expiresAt) || forecast.generatedAt !== issue.generatedAt || forecast.version !== 1 ||
      Date.parse(forecast.expiresAt) <= Date.parse(forecast.generatedAt) ||
      (forecast.observationAt !== undefined && (!timestamp(forecast.observationAt) || Date.parse(forecast.observationAt) > Date.parse(forecast.generatedAt))) ||
      !['available', 'experimental', 'unavailable'].includes(forecast.status)) return 'invalid-archive-contract';
  if (!compatibleReference(forecast as unknown as Record<string, unknown>, reference)) return 'incompatible-reference';
  if (Date.parse(forecast.expiresAt) <= +origin) return 'issue-expired';
  if (forecast.status === 'unavailable') return 'issue-unavailable';
  if (!Array.isArray(forecast.points) || forecast.points.length < 2 || forecast.points.some((point, index, points) =>
    !timestamp(point.t) || !finite(point.totalFt) || !finite(point.tideFt) || !finite(point.residualFt) ||
    Math.abs(point.totalFt - point.tideFt - point.residualFt) > 1e-6 ||
    (index > 0 && Date.parse(points[index - 1].t) >= Date.parse(point.t)))) return 'invalid-archive-contract';
  return null;
}

function inputSeries(issue: PublishedIssue, reference: VerificationReference): { tide: WaterPoint[]; residual: number | null; exclusion: VerificationExclusion | null } {
  const input = issue.input;
  if (!record(input)) return { tide: [], residual: null, exclusion: 'input-unavailable' };
  const ref = input.reference;
  if (input.version !== 1 || input.issuedAt !== issue.generatedAt || !record(ref) ||
      ref.station !== reference.sensor || ref.tideStation !== reference.tideStation || ref.datum !== reference.datum ||
      ref.units !== reference.units || ref.offsetFt !== reference.offsetFt || ref.phaseMinutes !== reference.phaseMinutes ||
      ref.thresholdFt !== reference.thresholdFt || !Array.isArray(input.tide) || !Array.isArray(input.recentResidual))
    return { tide: [], residual: null, exclusion: 'incompatible-input' };
  const parse = (rows: unknown[]): WaterPoint[] | null => {
    if (rows.some(row => !record(row) || !timestamp(row.t) || !finite(row.v))) return null;
    const points = prepareObservations(rows.map(row => ({ t: new Date((row as { t: string }).t), v: (row as { v: number }).v })));
    return points.length === rows.length ? points : null;
  };
  const tide = parse(input.tide);
  const residual = parse(input.recentResidual);
  if (!tide || !residual || residual.some(point => +point.t > Date.parse(issue.generatedAt)))
    return { tide: [], residual: null, exclusion: 'incompatible-input' };
  const anchor = residual.at(-1);
  return { tide, residual: anchor && Date.parse(issue.generatedAt) - +anchor.t <= HOUR ? anchor.v : null, exclusion: null };
}

function methodSeries(issue: PublishedIssue, reference: VerificationReference, method: VerificationMethod): { points: WaterPoint[]; exclusion: VerificationExclusion | null } {
  if (method === 'served') return { points: issue.forecast!.points.map(point => ({ t: new Date(point.t), v: point.totalFt })), exclusion: null };
  const input = inputSeries(issue, reference);
  if (input.exclusion) return { points: [], exclusion: input.exclusion };
  if (method === 'persistence' && input.residual === null) return { points: [], exclusion: 'residual-anchor-unavailable' };
  return { points: input.tide.map(point => ({ ...point, v: point.v + (method === 'persistence' ? input.residual! : 0) })), exclusion: null };
}

function crossingBracket(points: WaterPoint[], at: Date, threshold: number, rising: boolean, maxGap: number): CrossingBracket | null {
  for (let index = 1; index < points.length; index++) {
    const before = points[index - 1], after = points[index];
    if (+before.t > +at || +after.t < +at || +after.t - +before.t > maxGap) continue;
    if (rising ? before.v <= threshold && after.v > threshold : before.v > threshold && after.v <= threshold)
      return { beforeAt: before.t.toISOString(), beforeFt: before.v, afterAt: after.t.toISOString(), afterFt: after.v };
  }
  return null;
}

function ledgerEvent(event: FloodWindow, points: WaterPoint[], threshold: number, maxGap: number): LedgerEvent {
  return {
    id: event.startTime.toISOString(), startAt: event.startTime.toISOString(), endAt: event.endTime?.toISOString() || null,
    lastSampleAt: event.lastSampleTime.toISOString(), peakAt: event.peakTime.toISOString(), peakFt: event.peakValue,
    startClipped: event.startClipped, complete: !event.startClipped && event.endTime !== null,
    onsetBracket: event.startClipped ? null : crossingBracket(points, event.startTime, threshold, true, maxGap),
    endBracket: event.endTime ? crossingBracket(points, event.endTime, threshold, false, maxGap) : null,
  };
}

/** Maximum cardinality, then greatest interval overlap. Monotonic matching cannot
 * pair two disjoint tide cycles just because their peaks are close in time. */
export function matchIntervalEvents(observed: LedgerEvent[], predicted: LedgerEvent[], endAt: string): { observedIndex: number; predictedIndex: number; overlapMinutes: number }[] {
  const overlap = (a: LedgerEvent, b: LedgerEvent) => Math.max(0,
    Math.min(Date.parse(a.endAt || endAt), Date.parse(b.endAt || endAt)) - Math.max(Date.parse(a.startAt), Date.parse(b.startAt)));
  type Cell = { count: number; duration: number; pairs: { observedIndex: number; predictedIndex: number; overlapMinutes: number }[] };
  const matrix: Cell[][] = Array.from({ length: observed.length + 1 }, () => Array.from({ length: predicted.length + 1 }, () => ({ count: 0, duration: 0, pairs: [] })));
  for (let i = 1; i <= observed.length; i++) for (let j = 1; j <= predicted.length; j++) {
    const candidates = [matrix[i - 1][j], matrix[i][j - 1]];
    const shared = overlap(observed[i - 1], predicted[j - 1]);
    if (shared > 0) {
      const previous = matrix[i - 1][j - 1];
      candidates.push({ count: previous.count + 1, duration: previous.duration + shared,
        pairs: [...previous.pairs, { observedIndex: i - 1, predictedIndex: j - 1, overlapMinutes: shared / 60_000 }] });
    }
    matrix[i][j] = candidates.sort((a, b) => b.count - a.count || b.duration - a.duration)[0];
  }
  return matrix[observed.length][predicted.length].pairs;
}

function excludedWindow(origin: Date, method: VerificationMethod, issue: PublishedIssue | null, exclusion: VerificationExclusion): EventWindowScore {
  return { originAt: origin.toISOString(), endAt: new Date(+origin + EVENT_WINDOW_HOURS * HOUR).toISOString(), method, issueId: issue?.issueId || null,
    status: 'excluded', exclusion, cohort: 'unknown', observedEvents: 0, observedNewOnsets: 0, observedUnderway: 0,
    predictedEvents: 0, matchedNewOnsets: 0, missedNewOnsets: 0, matchedUnderway: 0, unmatchedPredictedEvents: 0,
    correctDryWindow: null, windowPeakErrorFt: null, matches: [], observedNewEventIds: [], missedNewEventIds: [], unmatchedPredictedEventIds: [], underwayEventIds: [] };
}

function scoreEventWindow(origin: Date, method: VerificationMethod, issue: PublishedIssue, actual: WaterPoint[], forecast: WaterPoint[], reference: VerificationReference, nativeTruth: WaterPoint[]): EventWindowScore {
  const end = new Date(+origin + EVENT_WINDOW_HOURS * HOUR);
  const observed = floodWindows(actual, reference.thresholdFt, OBSERVATION_MAX_GAP_MS).map(event => ledgerEvent(event, nativeTruth, reference.thresholdFt, OBSERVATION_MAX_GAP_MS));
  const predicted = floodWindows(forecast, reference.thresholdFt, FORECAST_MAX_GAP_MS).map(event => ledgerEvent(event, forecast, reference.thresholdFt, FORECAST_MAX_GAP_MS));
  const pairs = matchIntervalEvents(observed, predicted, end.toISOString());
  const matchedObserved = new Set(pairs.map(pair => pair.observedIndex));
  const matches: EventMatch[] = pairs.map(pair => {
    const a = observed[pair.observedIndex], p = predicted[pair.predictedIndex];
    return { observedId: a.id, predictedId: p.id, cohort: a.startClipped ? 'underway' : 'new-onset', overlapMinutes: pair.overlapMinutes,
      onsetErrorMinutes: !a.startClipped && !p.startClipped ? (Date.parse(p.startAt) - Date.parse(a.startAt)) / 60_000 : null,
      peakErrorFt: a.complete && p.complete ? p.peakFt - a.peakFt : null,
      durationErrorMinutes: a.complete && p.complete ? ((Date.parse(p.endAt!) - Date.parse(p.startAt)) - (Date.parse(a.endAt!) - Date.parse(a.startAt))) / 60_000 : null,
      forecastAvailableBeforeOnsetMinutes: !a.startClipped && Date.parse(a.startAt) > Date.parse(issue.publishedAt) ? (Date.parse(a.startAt) - Date.parse(issue.publishedAt)) / 60_000 : null,
    };
  });
  return { originAt: origin.toISOString(), endAt: end.toISOString(), method, issueId: issue.issueId, status: 'scored', exclusion: null,
    cohort: actual[0].v > reference.thresholdFt ? 'already-flooding' : 'dry-at-origin', observedEvents: observed.length,
    observedNewOnsets: observed.filter(event => !event.startClipped).length, observedUnderway: observed.filter(event => event.startClipped).length,
    predictedEvents: predicted.length, matchedNewOnsets: matches.filter(match => match.cohort === 'new-onset').length,
    missedNewOnsets: observed.filter((event, index) => !event.startClipped && !matchedObserved.has(index)).length,
    matchedUnderway: matches.filter(match => match.cohort === 'underway').length, unmatchedPredictedEvents: predicted.length - pairs.length,
    correctDryWindow: !observed.length && !predicted.length,
    windowPeakErrorFt: Math.max(...forecast.map(point => point.v)) - Math.max(...actual.map(point => point.v)), matches,
    observedNewEventIds: observed.filter(event => !event.startClipped).map(event => event.id),
    missedNewEventIds: observed.filter((event, index) => !event.startClipped && !matchedObserved.has(index)).map(event => event.id),
    unmatchedPredictedEventIds: predicted.filter((_, index) => !pairs.some(pair => pair.predictedIndex === index)).map(event => event.id),
    underwayEventIds: observed.filter(event => event.startClipped).map(event => event.id),
  };
}

/** Pure replay of frozen issued outputs and native subsequent observations. */
export function scoreVerificationDay(input: VerificationDayInput): VerificationDay {
  const start = verificationDayStart(input.day), end = new Date(+start + DAY);
  if (!Number.isFinite(+input.asOf)) throw new Error('Valid verification asOf required');
  const observations = prepareObservations(input.observations.filter(point => +point.t <= +input.asOf));
  const targetScores: TargetScore[] = [], eventWindows: EventWindowScore[] = [];
  let fullyObservedOriginWindows = 0;
  for (const origin of hourlyOrigins(input.day)) {
    const issue = selectPublishedIssue(input.issues, origin);
    const baseExclusion = input.archiveReadTruncated ? 'archive-read-truncated' : issueExclusion(issue, origin, input.reference);
    const eventEnd = new Date(+origin + EVENT_WINDOW_HOURS * HOUR);
    const actual = +eventEnd <= +input.asOf ? boundedSeries(observations, origin, eventEnd, OBSERVATION_MAX_GAP_MS) : null;
    if (actual) fullyObservedOriginWindows++;
    for (const method of METHODS) {
      const series = !baseExclusion && issue ? methodSeries(issue, input.reference, method) : { points: [], exclusion: baseExclusion };
      for (const leadHours of VERIFICATION_LEADS_HOURS) {
        const target = new Date(+origin + leadHours * HOUR);
        const observedFt = +target <= +input.asOf ? interpolate(observations, target, OBSERVATION_MAX_GAP_MS) : null;
        const predictedFt = !series.exclusion ? interpolate(series.points, target, FORECAST_MAX_GAP_MS) : null;
        const exclusion: VerificationExclusion | null = +target > +input.asOf ? 'target-not-matured' :
          baseExclusion || series.exclusion || (observedFt === null ? 'observation-unsupported' : predictedFt === null ? 'forecast-unsupported' : null);
        const observationAt = issue?.forecast?.observationAt;
        targetScores.push({ originAt: origin.toISOString(), targetAt: target.toISOString(), leadHours, method, issueId: issue?.issueId || null,
          publishedAt: issue?.publishedAt || null, publicationBasis: issue?.publicationBasis || null,
          publicationToTargetHours: issue ? (+target - Date.parse(issue.publishedAt)) / HOUR : null,
          observationAgeMinutesAtPublication: observationAt && timestamp(observationAt) && issue ? (Date.parse(issue.publishedAt) - Date.parse(observationAt)) / 60_000 : null,
          status: exclusion ? 'excluded' : 'scored', exclusion,
          observedFt: exclusion ? null : observedFt, predictedFt: exclusion ? null : predictedFt,
          errorFt: exclusion ? null : predictedFt! - observedFt! });
      }
      const exclusion: VerificationExclusion | null = +eventEnd > +input.asOf ? 'target-not-matured' :
        baseExclusion || series.exclusion || (!actual ? 'observation-unsupported' : null);
      const prediction = !exclusion ? boundedSeries(series.points, origin, eventEnd, FORECAST_MAX_GAP_MS) : null;
      eventWindows.push(exclusion || !prediction ? excludedWindow(origin, method, issue, exclusion || 'forecast-unsupported') :
        scoreEventWindow(origin, method, issue!, actual!, prediction, input.reference, observations));
    }
  }
  const exclusions: Record<string, number> = {};
  for (const row of [...targetScores, ...eventWindows]) if (row.exclusion) exclusions[row.exclusion] = (exclusions[row.exclusion] || 0) + 1;
  const eventLedger = floodWindows(observations, input.reference.thresholdFt, OBSERVATION_MAX_GAP_MS)
    .filter(event => +event.startTime >= +start && +event.startTime < +end)
    .map(event => ledgerEvent(event, observations, input.reference.thresholdFt, OBSERVATION_MAX_GAP_MS));
  const selected = [...new Set(targetScores.flatMap(row => row.issueId ? [row.issueId] : []))].sort();
  const inputHash = createHash('sha256').update(JSON.stringify({ version: VERIFICATION_VERSION, day: input.day, reference: input.reference,
    maturityCutoff: Math.min(+input.asOf, +end + 72 * HOUR),
    truncated: !!input.archiveReadTruncated, observations: observations.map(point => [point.t.toISOString(), point.v]),
    issues: selected.map(id => input.issues.find(issue => issue.issueId === id)), sourceCoverage: input.sourceCoverage || null })).digest('hex');
  const leadMetrics = VERIFICATION_LEADS_HOURS.flatMap(leadHours => METHODS.map(method => {
    const errors = targetScores.filter(row => row.leadHours === leadHours && row.method === method && row.status === 'scored').map(row => row.errorFt!);
    return { leadHours, method, samples: errors.length, maeFt: mean(errors.map(Math.abs)), biasFt: mean(errors) };
  }));
  const pairedLeadComparisons = VERIFICATION_LEADS_HOURS.flatMap(leadHours => (['tide-only', 'persistence'] as const).map(baseline => {
    const common = hourlyOrigins(input.day).flatMap(origin => {
      const rows = targetScores.filter(row => row.originAt === origin.toISOString() && row.leadHours === leadHours && row.status === 'scored');
      const served = rows.find(row => row.method === 'served'), base = rows.find(row => row.method === baseline);
      return served && base ? [{ served: Math.abs(served.errorFt!), baseline: Math.abs(base.errorFt!) }] : [];
    });
    return { leadHours, baseline, commonSamples: common.length, servedMaeFt: mean(common.map(row => row.served)), baselineMaeFt: mean(common.map(row => row.baseline)) };
  }));
  const eventMetrics = METHODS.map(method => {
    const windows = eventWindows.filter(row => row.method === method && row.status === 'scored');
    const matches = windows.flatMap(window => window.matches);
    const complete = matches.filter(match => match.durationErrorMinutes !== null && match.peakErrorFt !== null);
    return { unit: 'overlapping-origin-event-pairs' as const, method, originWindows: windows.length, dryAtOriginWindows: windows.filter(window => window.cohort === 'dry-at-origin').length,
      alreadyFloodingWindows: windows.filter(window => window.cohort === 'already-flooding').length, correctDryWindows: windows.filter(window => window.correctDryWindow).length,
      newOnsetHits: windows.reduce((sum, window) => sum + window.matchedNewOnsets, 0), newOnsetMisses: windows.reduce((sum, window) => sum + window.missedNewOnsets, 0),
      underwayMatches: windows.reduce((sum, window) => sum + window.matchedUnderway, 0), unmatchedPredictedEvents: windows.reduce((sum, window) => sum + window.unmatchedPredictedEvents, 0),
      completeMatchedEvents: complete.length, onsetMaeMinutes: mean(matches.flatMap(match => match.onsetErrorMinutes === null ? [] : [Math.abs(match.onsetErrorMinutes)])),
      peakMaeFt: mean(complete.map(match => Math.abs(match.peakErrorFt!))), durationMaeMinutes: mean(complete.map(match => Math.abs(match.durationErrorMinutes!))),
      windowPeakMaeFt: mean(windows.map(window => Math.abs(window.windowPeakErrorFt!))) };
  });
  const dayStartEventCohort = eventWindows.filter(window => window.originAt === start.toISOString()).map(window => ({
    originAt: window.originAt, method: window.method, status: window.status, exclusion: window.exclusion,
    observedNewEventIds: window.observedNewEventIds, hitEventIds: window.matches.filter(match => match.cohort === 'new-onset').map(match => match.observedId),
    missedEventIds: window.missedNewEventIds, unmatchedPredictedEventIds: window.unmatchedPredictedEventIds, underwayEventIds: window.underwayEventIds,
  }));
  const pairedEventComparisons = (['tide-only', 'persistence'] as const).map(baseline => {
    const pairs = hourlyOrigins(input.day).flatMap(origin => {
      const served = eventWindows.find(window => window.originAt === origin.toISOString() && window.method === 'served' && window.status === 'scored');
      const base = eventWindows.find(window => window.originAt === origin.toISOString() && window.method === baseline && window.status === 'scored');
      if (!served || !base) return [];
      return served.matches.flatMap(match => {
        const corresponding = base.matches.find(other => other.observedId === match.observedId);
        return corresponding && [match, corresponding].every(value => value.onsetErrorMinutes !== null && value.peakErrorFt !== null && value.durationErrorMinutes !== null) ? [{ served: match, baseline: corresponding }] : [];
      });
    });
    const metrics = (matches: EventMatch[]) => ({ onsetMaeMinutes: mean(matches.map(match => Math.abs(match.onsetErrorMinutes!))),
      peakMaeFt: mean(matches.map(match => Math.abs(match.peakErrorFt!))), durationMaeMinutes: mean(matches.map(match => Math.abs(match.durationErrorMinutes!))) });
    return { baseline, commonCompleteOriginEventPairs: pairs.length, served: metrics(pairs.map(pair => pair.served)), baselineMetrics: metrics(pairs.map(pair => pair.baseline)) };
  });
  return { version: VERIFICATION_VERSION, day: input.day, evaluatedAt: input.asOf.toISOString(), reference: input.reference, inputHash, readiness: 'not-assessed',
    policy: { origins: 'hourly-UTC', leadHours: VERIFICATION_LEADS_HOURS, eventWindowHours: EVENT_WINDOW_HOURS,
      eventMatching: 'maximum-cardinality-positive-interval-overlap', observationMaxGapMs: OBSERVATION_MAX_GAP_MS, forecastMaxGapMs: FORECAST_MAX_GAP_MS,
      legacyAvailability: 'archive-create-time-conservative', truth: 'configured-ingestion-native-gauge' },
    coverage: { origins: 24, archiveReadTruncated: !!input.archiveReadTruncated, observationPoints: observations.length,
      observedThrough: observations.at(-1)?.t.toISOString() || null, fullyObservedOriginWindows, source: input.sourceCoverage || null, exclusions },
    eventLedger, targetScores, eventWindows, dayStartEventCohort, leadMetrics, pairedLeadComparisons, eventMetrics, pairedEventComparisons,
    limitations: [
      'This is prospective as-issued gauge verification, not proof of operational reliability, street depth, or alert delivery.',
      'The served method labels archived backend numerical output. Historical dashboard selection, manual overrides and client fallbacks are not reconstructed; this is not an audit of the exact curve each visitor saw.',
      'Hourly origins and overlapping 24-hour event windows are dependent samples; event-window totals are not unique storms or independent events.',
      'The event ledger is unique within this UTC onset day; clipped starts or ends remain unresolved and do not receive fabricated timing or peak errors.',
      'Legacy archive creation is a conservative availability bound; exact earlier publication time and historical client delivery are unknown.',
      'Atomic publication availability uses the later of its server timestamp and marker commit/create time.',
      'Truth uses native gauge values transformed by the configured ingestion reference. Daily observation buckets do not independently retain historical datum-calibration versions.',
      'Native 30-minute observations can miss a between-sample peak. No finer observed sampling is invented.',
      'Crossing times are linear estimates inside retained native sample brackets, not minute-resolution measured onset or recovery.',
      'Nominal leads are measured from the hourly decision origin; publicationToTargetHours retains the exact actual forecast-availability lead.',
      'Historical observations may arrive late or be corrected; the versioned day is recomputable and the input hash identifies the evaluated snapshot.',
      'Only archived issued tides and residual anchors support baselines; missing input archives remain unavailable rather than being reconstructed with later data.',
      'Positive interval overlap is required for event matching. No post-hoc peak-distance tolerance is selected to improve scores.',
      'No calibrated probability, confidence score, readiness threshold, or measured warning-delivery claim is inferred from these metrics.',
    ] };
}

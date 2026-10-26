import type { ForecastDocument } from '../forecast/schema';

export const VERIFICATION_VERSION = 'prospective-v1';
export const VERIFICATION_LEADS_HOURS = [1, 3, 6, 12, 24, 48, 72] as const;
export const EVENT_WINDOW_HOURS = 24;
/** Native gauge cadence is 30 minutes; tolerate timestamp jitter, never a missed sample. */
export const OBSERVATION_MAX_GAP_MS = 30 * 60_000 + 10_000;
export const FORECAST_MAX_GAP_MS = 15 * 60_000;

export interface VerificationReference {
  version: string;
  locationId: string;
  sensor: string;
  tideStation: string;
  datum: 'MLLW';
  units: 'ft';
  offsetFt: number;
  phaseMinutes: number;
  thresholdFt: number;
}

/** A publication candidate may be selected before its larger frozen payload is loaded. */
export interface PublishedIssue {
  issueId: string;
  generatedAt: string;
  publishedAt: string;
  publicationBasis: 'atomic-publication' | 'legacy-create-time';
  archivePath: string;
  inputPath: string | null;
  modelPath: string | null;
  referenceVersion: string | null;
  codeVersion: string | null;
  publicationReference?: Omit<VerificationReference, 'version'>;
  forecast?: ForecastDocument;
  input?: unknown;
}

export type VerificationMethod = 'served' | 'tide-only' | 'persistence';
export type VerificationExclusion =
  | 'archive-read-truncated' | 'no-published-issue' | 'invalid-publication'
  | 'issue-expired' | 'issue-unavailable' | 'invalid-archive-contract'
  | 'incompatible-reference' | 'input-unavailable' | 'incompatible-input'
  | 'residual-anchor-unavailable' | 'forecast-unsupported' | 'observation-unsupported'
  | 'target-not-matured';

export interface TargetScore {
  originAt: string;
  targetAt: string;
  leadHours: number;
  method: VerificationMethod;
  issueId: string | null;
  publishedAt: string | null;
  publicationBasis: PublishedIssue['publicationBasis'] | null;
  publicationToTargetHours: number | null;
  observationAgeMinutesAtPublication: number | null;
  status: 'scored' | 'excluded';
  exclusion: VerificationExclusion | null;
  observedFt: number | null;
  predictedFt: number | null;
  errorFt: number | null;
}

export interface LedgerEvent {
  id: string;
  startAt: string;
  endAt: string | null;
  lastSampleAt: string;
  peakAt: string;
  peakFt: number;
  startClipped: boolean;
  complete: boolean;
  onsetBracket: CrossingBracket | null;
  endBracket: CrossingBracket | null;
}

export interface CrossingBracket {
  beforeAt: string;
  beforeFt: number;
  afterAt: string;
  afterFt: number;
}

export interface EventMatch {
  observedId: string;
  predictedId: string;
  cohort: 'new-onset' | 'underway';
  overlapMinutes: number;
  onsetErrorMinutes: number | null;
  peakErrorFt: number | null;
  durationErrorMinutes: number | null;
  /** Forecast availability, not alert delivery or a measured warning lead. */
  forecastAvailableBeforeOnsetMinutes: number | null;
}

export interface EventWindowScore {
  originAt: string;
  endAt: string;
  method: VerificationMethod;
  issueId: string | null;
  status: 'scored' | 'excluded';
  exclusion: VerificationExclusion | null;
  cohort: 'dry-at-origin' | 'already-flooding' | 'unknown';
  observedEvents: number;
  observedNewOnsets: number;
  observedUnderway: number;
  predictedEvents: number;
  matchedNewOnsets: number;
  missedNewOnsets: number;
  matchedUnderway: number;
  unmatchedPredictedEvents: number;
  correctDryWindow: boolean | null;
  windowPeakErrorFt: number | null;
  matches: EventMatch[];
  observedNewEventIds: string[];
  missedNewEventIds: string[];
  unmatchedPredictedEventIds: string[];
  underwayEventIds: string[];
}

export interface VerificationDayInput {
  day: string;
  asOf: Date;
  issues: PublishedIssue[];
  observations: { t: Date; v: number }[];
  reference: VerificationReference;
  archiveReadTruncated?: boolean;
  sourceCoverage?: {
    archiveCandidates: number;
    publicationMarkers: number;
    selectedIssues: number;
    observationDaysRead: number;
    missingObservationDays: string[];
    invalidObservationRows: number;
  };
}

export interface VerificationDay {
  version: typeof VERIFICATION_VERSION;
  day: string;
  evaluatedAt: string;
  reference: VerificationReference;
  inputHash: string;
  readiness: 'not-assessed';
  policy: {
    origins: 'hourly-UTC';
    leadHours: readonly number[];
    eventWindowHours: number;
    eventMatching: 'maximum-cardinality-positive-interval-overlap';
    observationMaxGapMs: number;
    forecastMaxGapMs: number;
    legacyAvailability: 'archive-create-time-conservative';
    truth: 'configured-ingestion-native-gauge';
  };
  coverage: {
    origins: number;
    archiveReadTruncated: boolean;
    observationPoints: number;
    observedThrough: string | null;
    fullyObservedOriginWindows: number;
    source: VerificationDayInput['sourceCoverage'] | null;
    exclusions: Record<string, number>;
  };
  /** Unique native observed events whose observed onset belongs to this UTC day. */
  eventLedger: LedgerEvent[];
  targetScores: TargetScore[];
  eventWindows: EventWindowScore[];
  /** One forecast origin per day: these event IDs are not repeated hourly. */
  dayStartEventCohort: {
    originAt: string;
    method: VerificationMethod;
    status: 'scored' | 'excluded';
    exclusion: VerificationExclusion | null;
    observedNewEventIds: string[];
    hitEventIds: string[];
    missedEventIds: string[];
    unmatchedPredictedEventIds: string[];
    underwayEventIds: string[];
  }[];
  leadMetrics: {
    leadHours: number;
    method: VerificationMethod;
    samples: number;
    maeFt: number | null;
    biasFt: number | null;
  }[];
  pairedLeadComparisons: {
    leadHours: number;
    baseline: 'tide-only' | 'persistence';
    commonSamples: number;
    servedMaeFt: number | null;
    baselineMaeFt: number | null;
  }[];
  eventMetrics: {
    unit: 'overlapping-origin-event-pairs';
    method: VerificationMethod;
    originWindows: number;
    dryAtOriginWindows: number;
    alreadyFloodingWindows: number;
    correctDryWindows: number;
    newOnsetHits: number;
    newOnsetMisses: number;
    underwayMatches: number;
    unmatchedPredictedEvents: number;
    completeMatchedEvents: number;
    onsetMaeMinutes: number | null;
    peakMaeFt: number | null;
    durationMaeMinutes: number | null;
    windowPeakMaeFt: number | null;
  }[];
  pairedEventComparisons: {
    baseline: 'tide-only' | 'persistence';
    commonCompleteOriginEventPairs: number;
    served: { onsetMaeMinutes: number | null; peakMaeFt: number | null; durationMaeMinutes: number | null };
    baselineMetrics: { onsetMaeMinutes: number | null; peakMaeFt: number | null; durationMaeMinutes: number | null };
  }[];
  limitations: string[];
}

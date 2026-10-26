import { createHash } from 'node:crypto';
import { ForecastDocument, validateForecast } from '../forecast/schema';
import { floodWindows, interpolate } from '../forecast/water';

const MINUTE = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
export const alertId = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32);

/** These are explicitly preview tolerances, not scientifically validated release
 * criteria. No user, municipality, channel or payment is attached to this policy. */
export interface ShadowPolicy {
  id: string;
  version: string;
  mode: 'shadow';
  scope: 'shared-gauge';
  locationId: string;
  referenceVersion: string;
  sensor: string;
  tideStation: string;
  datum: 'MLLW';
  units: 'ft';
  offsetFt: number;
  phaseMinutes: number;
  thresholdFt: number;
  maximumIssueAgeMinutes: number;
  maximumObservationAgeMinutes: number;
  maximumPointGapMinutes: number;
  previewHorizonHours: number;
  meaningfulTimeChangeMinutes: number;
  meaningfulPeakChangeFt: number;
  identityPeakToleranceMinutes: number;
}

export interface ShadowPublication {
  version: 1;
  locationId: string;
  issueId: string;
  generatedAt: string;
  publishedAt: string;
  archivePath: string;
  inputPath: string | null;
  modelPath: string | null;
  referenceVersion: string;
  sensor: string;
  tideStation: string;
  datum: 'MLLW';
  units: 'ft';
  offsetFt: number;
  phaseMinutes: number;
  thresholdFt: number;
  status: string;
}

export interface EpisodeWindow {
  startAt: string;
  endAt: string | null;
  lastSampleAt: string;
  peakAt: string;
  peakFt: number;
  startClipped: boolean;
  /** An elapsed onset/peak may be retained from an earlier prediction. These
   * source IDs prevent retained values from being mistaken for measured truth. */
  predictedStartIssueId: string;
  predictedPeakIssueId: string;
}
export type ShadowEpisodeStatus = 'predicted' | 'revised_lower' | 'elapsed_unverified' | 'unresolved' | 'superseded';
export interface ShadowEpisode {
  id: string;
  status: ShadowEpisodeStatus;
  window: EpisodeWindow;
  /** Last window that produced a meaningful revision. Small changes accumulate
   * against this value, rather than forever disappearing between adjacent runs. */
  revisionWindow: EpisodeWindow;
  revision: number;
  createdAt: string;
  evaluatedAt: string;
  originalIssueId: string;
  latestIssueId: string;
  splitFrom: string | null;
  mergedInto: string | null;
}
export interface ShadowState {
  version: 1;
  policyId: string;
  policyVersion: string;
  referenceVersion: string;
  lastIssueId: string;
  lastGeneratedAt: string;
  lastPublishedAt: string;
  evidenceStatus: 'usable' | 'unresolved';
  evidenceReason: string | null;
  checkedAt: string;
  episodes: ShadowEpisode[];
}
export interface ShadowRevision {
  id: string;
  episodeId: string;
  revision: number;
  kind: 'first_forecast' | 'forecast_changed' | 'forecast_revised_lower' | 'forecast_window_elapsed' | 'evidence_unavailable' | 'forecast_restored' | 'split' | 'merged';
  previousStatus: ShadowEpisodeStatus | null;
  status: ShadowEpisodeStatus;
  window: EpisodeWindow;
  issueId: string;
  archivePath: string;
  inputPath: string | null;
  modelPath: string | null;
  evaluatedAt: string;
  policyId: string;
  policyVersion: string;
  referenceVersion: string;
  thresholdFt: number;
  basis: 'predicted-gauge-threshold-only';
  splitFrom: string | null;
  mergedInto: string | null;
}
export interface ShadowIntent {
  id: string;
  episodeId: string;
  revisionId: string;
  issueId: string;
  policyId: string;
  policyVersion: string;
  referenceVersion: string;
  state: 'simulated' | 'expired' | 'superseded';
  delivery: 'not-attempted';
  decision: 'would-notify' | 'record-only';
  kind: ShadowRevision['kind'];
  createdAt: string;
  expiresAt: string;
  archivePath: string;
  message: string;
}
export interface ShadowTransition {
  result: 'applied' | 'duplicate' | 'out-of-order';
  decisionId: string;
  state: ShadowState | null;
  revisions: ShadowRevision[];
  intents: ShadowIntent[];
  reason: string | null;
}

export function assessShadowEvidence(publication: ShadowPublication, value: unknown, policy: ShadowPolicy, now: Date): { reason: string | null; forecast: ForecastDocument | null; startAt: string | null; endAt: string | null } {
  const fail = (reason: string) => ({ reason, forecast: null, startAt: null, endAt: null });
  if (publication.version !== 1 || publication.locationId !== policy.locationId ||
      publication.issueId !== publication.generatedAt || publication.archivePath !== `forecast_archive/${policy.locationId}/issues/${publication.issueId}` ||
      publication.inputPath !== `forecast_input_archive/${policy.locationId}/issues/${publication.issueId}` ||
      !publication.modelPath?.startsWith(`forecast_model_archive/${policy.locationId}/models/`) ||
      publication.referenceVersion !== policy.referenceVersion ||
      ['sensor', 'tideStation', 'datum', 'units', 'offsetFt', 'phaseMinutes', 'thresholdFt'].some(key => publication[key as keyof ShadowPublication] !== policy[key as keyof ShadowPolicy])) return fail('incompatible-publication');
  const generated = Date.parse(publication.generatedAt), published = Date.parse(publication.publishedAt);
  if (!Number.isFinite(+now) || !Number.isFinite(generated) || !Number.isFinite(published) || generated > published || published > +now || +now - generated > policy.maximumIssueAgeMinutes * MINUTE || +now - published > policy.maximumIssueAgeMinutes * MINUTE) return fail('stale-or-invalid-publication');
  if (!validateForecast(value)) return fail('invalid-forecast-schema');
  const forecast = value;
  if (forecast.status !== 'available' || publication.status !== forecast.status || forecast.generatedAt !== publication.generatedAt ||
      ['locationId', 'sensor', 'tideStation', 'datum', 'units', 'phaseMinutes', 'thresholdFt'].some(key => forecast[key as keyof ForecastDocument] !== policy[key as keyof ShadowPolicy])) return fail('forecast-unavailable-or-incompatible');
  const observed = Date.parse(forecast.observationAt ?? '');
  if (!Number.isFinite(observed) || observed > generated || +now - observed > policy.maximumObservationAgeMinutes * MINUTE || Date.parse(forecast.expiresAt) <= +now) return fail('stale-or-missing-observation');
  // The historical tail remains available to the dashboard, but is not silently
  // promoted into operational alert skill by this preview. Score it separately.
  const baseHours = forecast.method === 'residual-response' ? 6 : 24;
  const origin = Date.parse(forecast.forecastOriginAt ?? forecast.observationAt!);
  const end = Math.min(+now + policy.previewHorizonHours * 3600_000, origin + baseHours * 3600_000, Date.parse(forecast.points.at(-1)!.t));
  const points = forecast.points.filter(p => Date.parse(p.t) >= +now - policy.maximumPointGapMinutes * MINUTE && Date.parse(p.t) <= end + policy.maximumPointGapMinutes * MINUTE).map(p => ({ t: new Date(p.t), v: p.totalFt }));
  if (end <= +now || interpolate(points, now, policy.maximumPointGapMinutes * MINUTE) === null || interpolate(points, new Date(end), policy.maximumPointGapMinutes * MINUTE) === null || points.some((p, i) => i > 0 && +p.t - +points[i - 1].t > policy.maximumPointGapMinutes * MINUTE)) return fail('incomplete-forecast-coverage');
  return { reason: null, forecast, startAt: now.toISOString(), endAt: iso(end) };
}

function candidateWindows(forecast: ForecastDocument, startAt: string, endAt: string, policy: ShadowPolicy): EpisodeWindow[] {
  const start = Date.parse(startAt), end = Date.parse(endAt);
  const all = forecast.points.map(p => ({ t: new Date(p.t), v: p.totalFt }));
  const points = [{ t: new Date(start), v: interpolate(all, new Date(start), policy.maximumPointGapMinutes * MINUTE)! },
    ...all.filter(p => +p.t > start && +p.t < end),
    { t: new Date(end), v: interpolate(all, new Date(end), policy.maximumPointGapMinutes * MINUTE)! }];
  return floodWindows(points, policy.thresholdFt, policy.maximumPointGapMinutes * MINUTE).map(w => ({ startAt: w.startTime.toISOString(), endAt: w.endTime?.toISOString() ?? null, lastSampleAt: w.lastSampleTime.toISOString(), peakAt: w.peakTime.toISOString(), peakFt: w.peakValue, startClipped: w.startClipped, predictedStartIssueId: forecast.generatedAt, predictedPeakIssueId: forecast.generatedAt }));
}

const ending = (window: EpisodeWindow) => Date.parse(window.endAt ?? window.lastSampleAt);
function overlap(a: EpisodeWindow, b: EpisodeWindow): number {
  return Math.max(0, Math.min(ending(a), ending(b)) - Math.max(Date.parse(a.startAt), Date.parse(b.startAt)));
}
function matchScore(a: EpisodeWindow, b: EpisodeWindow, policy: ShadowPolicy): number {
  const shared = overlap(a, b), peakDelta = Math.abs(Date.parse(a.peakAt) - Date.parse(b.peakAt));
  if (shared > 0) return 1000 + shared / MINUTE - peakDelta / (24 * 3600_000);
  const separation = Math.max(Date.parse(a.startAt), Date.parse(b.startAt)) - Math.min(ending(a), ending(b));
  return peakDelta <= policy.identityPeakToleranceMinutes * MINUTE && separation <= policy.identityPeakToleranceMinutes * MINUTE ? 1 / (1 + peakDelta / MINUTE) : 0;
}

/** Maximum-score chronological one-to-one alignment. A split can inherit only
 * one old identity; a merge can retain only one. No greedy peak pairing can use
 * the same episode twice or swap ordered tide cycles. */
export function matchShadowEpisodes(previous: ShadowEpisode[], candidates: EpisodeWindow[], policy: ShadowPolicy): Array<[number, number]> {
  const table: { score: number; pairs: Array<[number, number]> }[][] = Array.from({ length: previous.length + 1 }, () => Array.from({ length: candidates.length + 1 }, () => ({ score: 0, pairs: [] })));
  for (let i = 1; i <= previous.length; i++) for (let j = 1; j <= candidates.length; j++) {
    let best = table[i - 1][j].score >= table[i][j - 1].score ? table[i - 1][j] : table[i][j - 1];
    const score = matchScore(previous[i - 1].window, candidates[j - 1], policy);
    const diagonal = table[i - 1][j - 1];
    if (score > 0 && diagonal.score + score > best.score) best = { score: diagonal.score + score, pairs: [...diagonal.pairs, [i - 1, j - 1]] };
    table[i][j] = best;
  }
  return table[previous.length][candidates.length].pairs;
}

function changed(a: EpisodeWindow, b: EpisodeWindow, policy: ShadowPolicy): boolean {
  const time = policy.meaningfulTimeChangeMinutes * MINUTE;
  // Clipping at the moving evaluation origin is not a new onset prediction.
  return (!a.startClipped && !b.startClipped && Math.abs(Date.parse(a.startAt) - Date.parse(b.startAt)) >= time) ||
    (a.endAt === null) !== (b.endAt === null) || (a.endAt !== null && b.endAt !== null && Math.abs(Date.parse(a.endAt) - Date.parse(b.endAt)) >= time) ||
    Math.abs(Date.parse(a.peakAt) - Date.parse(b.peakAt)) >= time || Math.abs(a.peakFt - b.peakFt) >= policy.meaningfulPeakChangeFt;
}

export function evaluateShadowPublication(publication: ShadowPublication, forecast: unknown, previous: ShadowState | null, policy: ShadowPolicy, now: Date): ShadowTransition {
  if (previous && (previous.policyVersion !== policy.version || previous.referenceVersion !== policy.referenceVersion || previous.policyId !== policy.id)) throw new Error('Shadow policy/reference changed: use a new versioned policy ID');
  if (!Number.isFinite(Date.parse(publication.generatedAt)) || !Number.isFinite(Date.parse(publication.publishedAt)) || Date.parse(publication.generatedAt) > +now || Date.parse(publication.publishedAt) > +now) throw new Error('Invalid or future shadow publication cannot advance state');
  const comparison = previous ? Date.parse(publication.generatedAt) - Date.parse(previous.lastGeneratedAt) : 1;
  const baseId = alertId(`${policy.id}|${policy.version}|${publication.issueId}`);
  if (comparison < 0 || (comparison === 0 && previous?.lastIssueId !== publication.issueId)) return { result: 'out-of-order', decisionId: baseId, state: previous, revisions: [], intents: [], reason: 'older-issue' };
  const evidence = assessShadowEvidence(publication, forecast, policy, now);
  const usable = evidence.reason === null;
  const evidenceStatus = usable ? 'usable' : 'unresolved';
  const decisionId = usable ? baseId : `${baseId}-unresolved`;
  if (comparison === 0 && previous?.evidenceStatus === evidenceStatus) return { result: 'duplicate', decisionId, state: previous, revisions: [], intents: [], reason: evidence.reason };
  const evaluatedAt = now.toISOString();
  const state: ShadowState = { version: 1, policyId: policy.id, policyVersion: policy.version, referenceVersion: policy.referenceVersion, lastIssueId: publication.issueId, lastGeneratedAt: publication.generatedAt, lastPublishedAt: publication.publishedAt, evidenceStatus, evidenceReason: evidence.reason, checkedAt: evaluatedAt, episodes: [] };
  const revisions: ShadowRevision[] = [], intents: ShadowIntent[] = [];
  const amend = (episode: ShadowEpisode, kind: ShadowRevision['kind'], old: ShadowEpisode | null) => {
    episode.revision = (old?.revision ?? 0) + 1;
    episode.revisionWindow = { ...episode.window };
    const revisionId = alertId(`${decisionId}|${episode.id}|${episode.revision}|${kind}`);
    revisions.push({ id: revisionId, episodeId: episode.id, revision: episode.revision, kind, previousStatus: old?.status ?? null, status: episode.status, window: { ...episode.window }, issueId: publication.issueId, archivePath: publication.archivePath, inputPath: publication.inputPath, modelPath: publication.modelPath, evaluatedAt, policyId: policy.id, policyVersion: policy.version, referenceVersion: policy.referenceVersion, thresholdFt: policy.thresholdFt, basis: 'predicted-gauge-threshold-only', splitFrom: episode.splitFrom, mergedInto: episode.mergedInto });
    const notify = usable && ['first_forecast', 'forecast_changed', 'forecast_revised_lower', 'forecast_restored', 'split', 'merged'].includes(kind);
    const expiry = Math.min(Date.parse((forecast as ForecastDocument | null)?.expiresAt ?? evaluatedAt), Date.parse(publication.generatedAt) + policy.maximumIssueAgeMinutes * MINUTE, ending(episode.window));
    const expired = !Number.isFinite(expiry) || expiry <= +now;
    const message = kind === 'forecast_revised_lower' ? 'Forecast revised lower at the monitored gauge. This does not confirm that streets are dry.' : kind === 'evidence_unavailable' ? 'Forecast evidence is unavailable. The previous flood outlook remains unresolved.' : kind === 'forecast_window_elapsed' ? 'The predicted window has elapsed; local flooding or road clearance has not been verified.' : 'Predicted water level exceeds the configured gauge flood threshold. Local street depth and road status are not established by this prediction.';
    intents.push({ id: revisionId, episodeId: episode.id, revisionId, issueId: publication.issueId, policyId: policy.id, policyVersion: policy.version, referenceVersion: policy.referenceVersion, state: expired ? 'expired' : 'simulated', delivery: 'not-attempted', decision: notify && !expired ? 'would-notify' : 'record-only', kind, createdAt: evaluatedAt, expiresAt: iso(Number.isFinite(expiry) ? expiry : +now), archivePath: publication.archivePath, message });
  };
  const oldEpisodes = (previous?.episodes ?? []).map(episode => ({ ...episode, window: { ...episode.window }, revisionWindow: { ...episode.revisionWindow } }));
  if (!usable) {
    state.episodes = oldEpisodes.map(old => {
      if (['revised_lower', 'elapsed_unverified', 'superseded'].includes(old.status)) return old;
      const episode: ShadowEpisode = { ...old, status: 'unresolved', evaluatedAt, latestIssueId: publication.issueId };
      if (old.status !== 'unresolved') amend(episode, 'evidence_unavailable', old);
      return episode;
    });
    return { result: 'applied', decisionId, state, revisions, intents, reason: evidence.reason };
  }
  const windows = candidateWindows(evidence.forecast!, evidence.startAt!, evidence.endAt!, policy);
  if (windows.length > 32 || oldEpisodes.length > 64) throw new Error('Shadow event safety bound exceeded; no state changes committed');
  const eligible = oldEpisodes.filter(e => e.status !== 'superseded' && ending(e.window) >= +now - 24 * 3600_000).sort((a, b) => Date.parse(a.window.startAt) - Date.parse(b.window.startAt) || a.id.localeCompare(b.id));
  const matches = matchShadowEpisodes(eligible, windows, policy);
  const byCandidate = new Map(matches.map(([i, j]) => [j, eligible[i]]));
  const retained = new Set(matches.map(([i]) => eligible[i].id));
  const matchedIds = new Map<number, string>();
  for (let j = 0; j < windows.length; j++) {
    const rawWindow = windows[j], old = byCandidate.get(j);
    const window = { ...rawWindow };
    if (old && rawWindow.startClipped) {
      // Advancing the clock clips the remaining forecast at now. That is not a
      // changed onset. Keep the earlier predicted onset (or its unknown bound).
      if (Date.parse(old.window.startAt) <= Date.parse(rawWindow.startAt)) {
        window.startAt = old.window.startAt;
        window.startClipped = old.window.startClipped;
        window.predictedStartIssueId = old.window.predictedStartIssueId ?? old.originalIssueId;
      }
      // Likewise, the maximum of the remaining tail naturally falls after a
      // peak passes. Retain that elapsed predicted peak, with its source issue,
      // unless this issue predicts a higher remaining peak. No observation or
      // confirmed recovery is inferred from the retained forecast metadata.
      if (Date.parse(old.window.peakAt) <= +now && old.window.peakFt >= rawWindow.peakFt) {
        window.peakAt = old.window.peakAt;
        window.peakFt = old.window.peakFt;
        window.predictedPeakIssueId = old.window.predictedPeakIssueId ?? old.originalIssueId;
      }
    }
    const parent = !old ? eligible.filter(e => overlap(e.window, window) > 0 && retained.has(e.id)).sort((a, b) => overlap(b.window, window) - overlap(a.window, window) || a.id.localeCompare(b.id))[0] : undefined;
    const id = old?.id ?? alertId(`${policy.id}|${policy.version}|${publication.issueId}|${window.startAt}|${j}`);
    matchedIds.set(j, id);
    const episode: ShadowEpisode = old ? { ...old, status: 'predicted', window, evaluatedAt, latestIssueId: publication.issueId, mergedInto: null } : { id, status: 'predicted', window, revisionWindow: window, revision: 0, createdAt: evaluatedAt, evaluatedAt, originalIssueId: publication.issueId, latestIssueId: publication.issueId, splitFrom: parent?.id ?? null, mergedInto: null };
    const kind = !old ? parent ? 'split' : 'first_forecast' : old.status !== 'predicted' ? 'forecast_restored' : changed(old.revisionWindow, window, policy) ? 'forecast_changed' : null;
    if (kind) amend(episode, kind, old ?? null);
    state.episodes.push(episode);
  }
  for (const old of oldEpisodes) {
    if (retained.has(old.id)) continue;
    const mergedCandidate = windows.map((window, j) => ({ window, j })).filter(({ window, j }) => byCandidate.has(j) && overlap(old.window, window) > 0).sort((a, b) => overlap(old.window, b.window) - overlap(old.window, a.window) || a.j - b.j)[0];
    // A previously merged identity is never restored or re-merged by accident.
    if (old.status === 'superseded') { state.episodes.push(old); continue; }
    let episode: ShadowEpisode;
    if (mergedCandidate) {
      episode = { ...old, status: 'superseded', mergedInto: matchedIds.get(mergedCandidate.j)!, evaluatedAt, latestIssueId: publication.issueId };
      amend(episode, 'merged', old);
    } else if (ending(old.window) <= +now) {
      episode = { ...old, status: 'elapsed_unverified', evaluatedAt, latestIssueId: publication.issueId };
      if (old.status !== episode.status) amend(episode, 'forecast_window_elapsed', old);
    } else if (Date.parse(old.window.startAt) >= +now && ending(old.window) <= Date.parse(evidence.endAt!)) {
      episode = { ...old, status: 'revised_lower', evaluatedAt, latestIssueId: publication.issueId };
      if (old.status !== episode.status) amend(episode, 'forecast_revised_lower', old);
    } else {
      episode = { ...old, status: 'unresolved', evaluatedAt, latestIssueId: publication.issueId };
      if (old.status !== episode.status) amend(episode, 'evidence_unavailable', old);
    }
    state.episodes.push(episode);
  }
  // Old completed identities stay in their immutable episode/revision documents;
  // the transactional working set only needs the most recent two days. Unresolved
  // future windows are retained and are never converted into an all-clear.
  state.episodes = state.episodes.filter(e => !['elapsed_unverified', 'superseded', 'revised_lower'].includes(e.status) || ending(e.window) >= +now - 48 * 3600_000);
  if (state.episodes.length > 64) throw new Error('Shadow episode working set exceeds safety bound; no state changes committed');
  return { result: 'applied', decisionId, state, revisions, intents, reason: null };
}

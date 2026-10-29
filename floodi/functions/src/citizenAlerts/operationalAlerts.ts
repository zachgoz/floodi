import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import type { ChallengerOutlookDocument, ChallengerPoint } from '../forecast/challenger';
import type { SurgeDriversBreakdown } from '../forecast/basinPhysics';

export type FloodSeverityTier = 'minor' | 'moderate' | 'major' | 'extreme';
export type OperationalAlertCategory =
  | 'upcoming_watch'
  | 'imminent_warning'
  | 'forecast_change'
  | 'all_clear';

export interface FloodThresholdSet {
  minor: number;    // 5.6 ft MLLW
  moderate: number; // 7.0 ft MLLW
  major: number;    // 7.7 ft MLLW
  extreme: number;  // 8.5 ft MLLW
}

export const CAROLINA_BEACH_THRESHOLDS: FloodThresholdSet = {
  minor: 5.6,
  moderate: 7.0,
  major: 7.7,
  extreme: 8.5,
};

export interface CitizenAlertPreferences {
  severities: {
    minor: boolean;
    moderate: boolean;
    major: boolean;
    extreme: boolean;
  };
  categories: {
    upcomingWatch: boolean;
    imminentWarning: boolean;
    forecastChange: boolean;
    allClear: boolean;
  };
}

export const DEFAULT_CITIZEN_PREFERENCES: CitizenAlertPreferences = {
  severities: {
    minor: true,
    moderate: true,
    major: true,
    extreme: true,
  },
  categories: {
    upcomingWatch: true,
    imminentWarning: true,
    forecastChange: true,
    allClear: false,
  },
};

export interface PublicFloodAdvisory {
  episodeId: string;
  severity: FloodSeverityTier;
  startAt: string;
  peakAt: string;
  endAt: string;
  durationMinutes: number;
  startClipped: boolean;
  endClipped: boolean;
  peakFt: number;
  aboveFloodStageFt: number;
  estimatedStreetDepthIn: number;
  tideFt: number;
  surgeFt: number;
  windSpeedMph: number | null;
  windDirectionDeg: number | null;
  windCompass: string | null;
  precipWindowIn: number;
  drivers?: SurgeDriversBreakdown;
}

export interface PublicAlertBulletin {
  id: string;
  episodeId: string;
  issuedAt: string;
  category: OperationalAlertCategory;
  severity: FloodSeverityTier;
  headline: string;
  summary: string;
  whatChanged: string | null;
  peakFt: number;
  peakAt: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  estimatedStreetDepthIn: number;
  windSpeedMph: number | null;
  windCompass: string | null;
  precipWindowIn: number;
}

export interface OperationalEpisodeRecord {
  episodeId: string;
  status: 'active' | 'cleared';
  severity: FloodSeverityTier;
  notifiedSeverity: FloodSeverityTier | null;
  imminentSent: boolean;
  revision: number;
  firstDetectedAt: string;
  lastUpdatedAt: string;
  lastNotifiedAt: string | null;
  lastNotifiedPeakFt: number | null;
  lastNotifiedPeakAt: string | null;
  advisory: PublicFloodAdvisory;
}

export interface OperationalAlertEngineState {
  version: 2;
  locationId: string;
  lastEvaluatedIssueAt: string;
  updatedAt: string;
  episodes: OperationalEpisodeRecord[];
  recentBulletins: PublicAlertBulletin[];
}

export interface PublicAlertFeedDocument {
  version: 2;
  locationId: string;
  generatedAt: string;
  forecastGeneratedAt: string;
  thresholds: FloodThresholdSet;
  currentSurgeFt: number | null;
  nextPeakFt: number | null;
  nextPeakAt: string | null;
  activeAdvisories: PublicFloodAdvisory[];
  recentBulletins: PublicAlertBulletin[];
}

export interface OperationalNotificationEvent {
  intentId: string;
  locationId: string;
  issuedAt: string;
  expiresAt: string;
  category: OperationalAlertCategory;
  highestSeverity: FloodSeverityTier;
  primaryAdvisory: PublicFloodAdvisory;
  additionalAdvisories: PublicFloodAdvisory[];
  previousPeakFt: number | null;
  previousSeverity: FloodSeverityTier | null;
  whatChanged: string | null;
  bulletin: PublicAlertBulletin;
}

const HOUR_MS = 3600_000;
const MINUTE_MS = 60_000;
const HYSTERESIS_FT = 0.15;
const SAME_TIER_COOLDOWN_MS = 6 * HOUR_MS;
const MEANINGFUL_PEAK_DELTA_FT = 0.30;
const MEANINGFUL_TIME_DELTA_MS = 60 * MINUTE_MS;
const EPISODE_MATCH_WINDOW_MS = 4.5 * HOUR_MS;
const IMMINENT_LEAD_MS = 3.5 * HOUR_MS;
const EVALUATION_HORIZON_MS = 48 * HOUR_MS;

const SEVERITY_RANK: Record<FloodSeverityTier, number> = {
  minor: 1,
  moderate: 2,
  major: 3,
  extreme: 4,
};

export function classifyFloodSeverity(
  waterFt: number,
  thresholds: FloodThresholdSet = CAROLINA_BEACH_THRESHOLDS,
  previousSeverity?: FloodSeverityTier | null
): FloodSeverityTier | null {
  if (!Number.isFinite(waterFt)) return null;

  // Apply 0.15 ft downward hysteresis when an episode is already active at a tier
  const extCut = previousSeverity === 'extreme' ? thresholds.extreme - HYSTERESIS_FT : thresholds.extreme;
  const majCut =
    previousSeverity === 'major' || previousSeverity === 'extreme'
      ? thresholds.major - HYSTERESIS_FT
      : thresholds.major;
  const modCut =
    previousSeverity === 'moderate' || previousSeverity === 'major' || previousSeverity === 'extreme'
      ? thresholds.moderate - HYSTERESIS_FT
      : thresholds.moderate;
  const minCut = previousSeverity ? thresholds.minor - HYSTERESIS_FT : thresholds.minor;

  if (waterFt >= extCut) return 'extreme';
  if (waterFt >= majCut) return 'major';
  if (waterFt >= modCut) return 'moderate';
  if (waterFt >= minCut) return 'minor';
  return null;
}

export function bearingToCompass(deg: number | null | undefined): string | null {
  if (typeof deg !== 'number' || !Number.isFinite(deg)) return null;
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const norm = ((deg % 360) + 360) % 360;
  return dirs[Math.round(norm / 22.5) % 16];
}

export function normalizeCitizenPreferences(raw: unknown): CitizenAlertPreferences | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (Object.keys(obj).some(k => !['severities', 'categories'].includes(k))) return null;

  const sev = obj.severities;
  const cat = obj.categories;
  if (!sev || typeof sev !== 'object' || Array.isArray(sev)) return null;
  if (!cat || typeof cat !== 'object' || Array.isArray(cat)) return null;

  const sevRec = sev as Record<string, unknown>;
  const catRec = cat as Record<string, unknown>;
  const sevKeys = ['minor', 'moderate', 'major', 'extreme'];
  const catKeys = ['upcomingWatch', 'imminentWarning', 'forecastChange', 'allClear'];

  if (Object.keys(sevRec).some(k => !sevKeys.includes(k))) return null;
  if (Object.keys(catRec).some(k => !catKeys.includes(k))) return null;
  if (sevKeys.some(k => typeof sevRec[k] !== 'boolean')) return null;
  if (catKeys.some(k => typeof catRec[k] !== 'boolean')) return null;

  return {
    severities: {
      minor: Boolean(sevRec.minor),
      moderate: Boolean(sevRec.moderate),
      major: Boolean(sevRec.major),
      extreme: Boolean(sevRec.extreme),
    },
    categories: {
      upcomingWatch: Boolean(catRec.upcomingWatch),
      imminentWarning: Boolean(catRec.imminentWarning),
      forecastChange: Boolean(catRec.forecastChange),
      allClear: Boolean(catRec.allClear),
    },
  };
}

export function resolveEffectivePreferences(raw: unknown): CitizenAlertPreferences {
  return normalizeCitizenPreferences(raw) ?? {
    severities: { ...DEFAULT_CITIZEN_PREFERENCES.severities },
    categories: { ...DEFAULT_CITIZEN_PREFERENCES.categories },
  };
}

export function subscriberMatchesNotification(
  rawPreferences: unknown,
  severity: FloodSeverityTier,
  category: OperationalAlertCategory
): boolean {
  const prefs = resolveEffectivePreferences(rawPreferences);
  if (!prefs.severities[severity]) return false;
  switch (category) {
    case 'upcoming_watch':
      return prefs.categories.upcomingWatch;
    case 'imminent_warning':
      return prefs.categories.imminentWarning;
    case 'forecast_change':
      return prefs.categories.forecastChange;
    case 'all_clear':
      return prefs.categories.allClear;
    default:
      return false;
  }
}

function interpolateCrossingIso(a: ChallengerPoint, b: ChallengerPoint, thresholdFt: number): string {
  const aMs = Date.parse(a.t);
  const bMs = Date.parse(b.t);
  const dv = b.totalFt - a.totalFt;
  if (!Number.isFinite(aMs) || !Number.isFinite(bMs) || Math.abs(dv) < 1e-6) {
    return b.t;
  }
  const frac = Math.max(0, Math.min(1, (thresholdFt - a.totalFt) / dv));
  return new Date(Math.round(aMs + frac * (bMs - aMs))).toISOString();
}

/**
 * Extracts discrete tidal flood excursions within the 48-hour operational horizon.
 * Flags `endClipped: true` when water is still rising at the right boundary so
 * right-edge horizon scrolling never triggers fake peak-escalation notifications.
 */
export function extractOperationalAdvisories(
  points: ChallengerPoint[],
  originMs: number,
  thresholds: FloodThresholdSet = CAROLINA_BEACH_THRESHOLDS,
  horizonMs = EVALUATION_HORIZON_MS
): PublicFloodAdvisory[] {
  const horizonEndMs = originMs + horizonMs;
  const valid = (points || [])
    .filter(p => p && Number.isFinite(Date.parse(p.t)) && Number.isFinite(p.totalFt))
    .sort((a, b) => Date.parse(a.t) - Date.parse(b.t))
    .filter(p => Date.parse(p.t) >= originMs - 15 * MINUTE_MS && Date.parse(p.t) <= horizonEndMs + 30 * MINUTE_MS);

  if (valid.length < 2) return [];

  const advisories: PublicFloodAdvisory[] = [];
  let inFlood = false;
  let startIso = '';
  let startClipped = false;
  let excursionPts: ChallengerPoint[] = [];

  for (let i = 0; i < valid.length; i++) {
    const pt = valid[i];
    const above = pt.totalFt >= thresholds.minor;
    if (above && !inFlood) {
      inFlood = true;
      startClipped = i === 0;
      startIso = i > 0 ? interpolateCrossingIso(valid[i - 1], pt, thresholds.minor) : pt.t;
      excursionPts = [pt];
    } else if (above && inFlood) {
      excursionPts.push(pt);
    } else if (!above && inFlood) {
      const endIso = interpolateCrossingIso(valid[i - 1], pt, thresholds.minor);
      const adv = buildAdvisoryFromExcursion(excursionPts, startIso, endIso, startClipped, false, thresholds);
      if (adv) advisories.push(adv);
      inFlood = false;
      excursionPts = [];
    }
  }

  if (inFlood && excursionPts.length > 0) {
    const lastPt = excursionPts[excursionPts.length - 1];
    const prevPt = excursionPts.length >= 2 ? excursionPts[excursionPts.length - 2] : null;
    // endClipped is true if the excursion hasn't crested yet (still rising or flat at right horizon edge)
    const stillRisingAtEdge = !prevPt || lastPt.totalFt >= prevPt.totalFt - 0.02;
    const adv = buildAdvisoryFromExcursion(
      excursionPts,
      startIso,
      lastPt.t,
      startClipped,
      stillRisingAtEdge,
      thresholds
    );
    if (adv) advisories.push(adv);
  }

  return advisories;
}

function buildAdvisoryFromExcursion(
  pts: ChallengerPoint[],
  startAt: string,
  endAt: string,
  startClipped: boolean,
  endClipped: boolean,
  thresholds: FloodThresholdSet
): PublicFloodAdvisory | null {
  if (!pts.length) return null;
  let peakPt = pts[0];
  let maxWind: number | null = null;
  let peakWindDir: number | null = null;
  let precipSum = 0;

  for (const p of pts) {
    if (p.totalFt > peakPt.totalFt) peakPt = p;
    if (typeof p.windSpeedMph === 'number' && (maxWind === null || p.windSpeedMph > maxWind)) {
      maxWind = p.windSpeedMph;
      peakWindDir = typeof p.windDirectionDeg === 'number' ? p.windDirectionDeg : null;
    }
    if (typeof p.precipIn === 'number' && Number.isFinite(p.precipIn)) {
      // Points are 30-min steps; hourly precipIn sampled twice per hour -> scale by 0.5
      precipSum += p.precipIn * 0.5;
    }
  }

  const severity = classifyFloodSeverity(peakPt.totalFt, thresholds);
  if (!severity) return null;

  const peakMs = Date.parse(peakPt.t);
  // Stable tide-cycle bucket ID (~6h bucket centered on peak) so minor peak-time shifts reuse ID cleanly
  const tideCycleBucket = Math.round(peakMs / (6 * HOUR_MS));
  const episodeId = `cb-tide-${tideCycleBucket}`;
  const durationMinutes = Math.max(15, Math.round((Date.parse(endAt) - Date.parse(startAt)) / MINUTE_MS));
  const aboveFloodStageFt = Math.max(0, Math.round((peakPt.totalFt - thresholds.minor) * 100) / 100);
  const estimatedStreetDepthIn = Math.max(0, Math.round((peakPt.totalFt - thresholds.minor) * 12 * 10) / 10);

  return {
    episodeId,
    severity,
    startAt,
    peakAt: peakPt.t,
    endAt,
    durationMinutes,
    startClipped,
    endClipped,
    peakFt: Math.round(peakPt.totalFt * 100) / 100,
    aboveFloodStageFt,
    estimatedStreetDepthIn,
    tideFt: Math.round(peakPt.tideFt * 100) / 100,
    surgeFt: Math.round(peakPt.residualFt * 100) / 100,
    windSpeedMph: maxWind !== null ? Math.round(maxWind) : typeof peakPt.windSpeedMph === 'number' ? Math.round(peakPt.windSpeedMph) : null,
    windDirectionDeg: peakWindDir ?? (typeof peakPt.windDirectionDeg === 'number' ? peakPt.windDirectionDeg : null),
    windCompass: bearingToCompass(peakWindDir ?? peakPt.windDirectionDeg),
    precipWindowIn: Math.round(precipSum * 100) / 100,
    drivers: peakPt.drivers,
  };
}

const etFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function severityTitle(severity: FloodSeverityTier): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

function makeIntentHash(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 32);
}

/**
 * Pure state-transition evaluator enforcing all anti-spam guarantees:
 *   1. Right-edge `endClipped` excursions are excluded from triggering notifications until crest enters 48h window.
 *   2. 0.15 ft downward hysteresis prevents 5.61 <-> 5.59 ft threshold flip-flop spam.
 *   3. 6-hour same-tier cooldown suppresses 10-minute model jitter; tier escalations bypass cooldown immediately.
 *   4. Transient forecast outages freeze active state without emitting `unresolved` or `forecast_restored` spam.
 *   5. Multiple simultaneous newly-detected tide windows consolidate into a single multi-tide digest notification.
 */
export function evaluateOperationalAlertStep(
  previousState: OperationalAlertEngineState | null,
  forecast: ChallengerOutlookDocument | null,
  now = new Date(),
  thresholds: FloodThresholdSet = CAROLINA_BEACH_THRESHOLDS
): {
  nextState: OperationalAlertEngineState;
  feed: PublicAlertFeedDocument;
  notifications: OperationalNotificationEvent[];
} {
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const locationId = forecast?.locationId ?? previousState?.locationId ?? 'carolina-beach';

  const baseState: OperationalAlertEngineState = previousState
    ? {
        ...previousState,
        episodes: previousState.episodes.map(e => ({ ...e })),
        recentBulletins: [...previousState.recentBulletins],
      }
    : {
        version: 2,
        locationId,
        lastEvaluatedIssueAt: '',
        updatedAt: nowIso,
        episodes: [],
        recentBulletins: [],
      };

  // Transient outage guard: if forecast is null, unavailable, or empty, freeze episodes untouched (zero spam!)
  if (!forecast || forecast.status !== 'available' || !Array.isArray(forecast.points) || forecast.points.length < 12) {
    const activeFrozen = baseState.episodes
      .filter(e => e.status === 'active' && Date.parse(e.advisory.endAt) > nowMs)
      .map(e => e.advisory);
    return {
      nextState: baseState,
      feed: {
        version: 2,
        locationId,
        generatedAt: nowIso,
        forecastGeneratedAt: baseState.lastEvaluatedIssueAt || nowIso,
        thresholds,
        currentSurgeFt: null,
        nextPeakFt: activeFrozen[0]?.peakFt ?? null,
        nextPeakAt: activeFrozen[0]?.peakAt ?? null,
        activeAdvisories: activeFrozen,
        recentBulletins: baseState.recentBulletins.slice(0, 20),
      },
      notifications: [],
    };
  }

  const rawAdvisories = extractOperationalAdvisories(forecast.points, nowMs, thresholds);
  // Keep non-endClipped advisories for notification triggers; display complete advisories in public feed
  const completeAdvisories = rawAdvisories.filter(a => !a.endClipped);

  const matchedPrevIds = new Set<string>();
  const nextEpisodes: OperationalEpisodeRecord[] = [];
  const pendingTriggers: Array<{
    category: OperationalAlertCategory;
    advisory: PublicFloodAdvisory;
    prevPeakFt: number | null;
    prevSeverity: FloodSeverityTier | null;
    whatChanged: string | null;
  }> = [];

  for (const adv of completeAdvisories) {
    const advPeakMs = Date.parse(adv.peakAt);
    const existing = baseState.episodes.find(
      ep =>
        !matchedPrevIds.has(ep.episodeId) &&
        Math.abs(Date.parse(ep.advisory.peakAt) - advPeakMs) <= EPISODE_MATCH_WINDOW_MS
    );

    if (!existing) {
      // Brand-new complete flood episode within 48h!
      const record: OperationalEpisodeRecord = {
        episodeId: adv.episodeId,
        status: 'active',
        severity: adv.severity,
        notifiedSeverity: adv.severity,
        imminentSent: Date.parse(adv.startAt) - nowMs <= IMMINENT_LEAD_MS,
        revision: 1,
        firstDetectedAt: nowIso,
        lastUpdatedAt: nowIso,
        lastNotifiedAt: nowIso,
        lastNotifiedPeakFt: adv.peakFt,
        lastNotifiedPeakAt: adv.peakAt,
        advisory: adv,
      };
      const isImminentNow = Date.parse(adv.startAt) - nowMs <= IMMINENT_LEAD_MS;
      pendingTriggers.push({
        category: isImminentNow ? 'imminent_warning' : 'upcoming_watch',
        advisory: adv,
        prevPeakFt: null,
        prevSeverity: null,
        whatChanged: null,
      });
      nextEpisodes.push(record);
    } else {
      matchedPrevIds.add(existing.episodeId);
      const effectiveSeverity =
        classifyFloodSeverity(adv.peakFt, thresholds, existing.severity) ?? adv.severity;
      const stabilizedAdv: PublicFloodAdvisory = {
        ...adv,
        episodeId: existing.episodeId,
        severity: effectiveSeverity,
      };

      const wasCleared = existing.status === 'cleared';
      const prevNotifiedSev = existing.notifiedSeverity ?? existing.severity;
      const tierEscalated = SEVERITY_RANK[effectiveSeverity] > SEVERITY_RANK[prevNotifiedSev];
      const onsetLeadMs = Date.parse(stabilizedAdv.startAt) - nowMs;
      const entersImminent =
        !existing.imminentSent && onsetLeadMs > -30 * MINUTE_MS && onsetLeadMs <= IMMINENT_LEAD_MS;

      const msSinceLastNotify = existing.lastNotifiedAt ? nowMs - Date.parse(existing.lastNotifiedAt) : Infinity;
      const cooldownElapsed = msSinceLastNotify >= SAME_TIER_COOLDOWN_MS;
      const peakDeltaFt =
        existing.lastNotifiedPeakFt !== null ? stabilizedAdv.peakFt - existing.lastNotifiedPeakFt : 0;
      const peakTimeShiftMs =
        existing.lastNotifiedPeakAt !== null
          ? Math.abs(Date.parse(stabilizedAdv.peakAt) - Date.parse(existing.lastNotifiedPeakAt))
          : 0;
      const meaningfulSameTierShift =
        cooldownElapsed &&
        (Math.abs(peakDeltaFt) >= MEANINGFUL_PEAK_DELTA_FT || peakTimeShiftMs >= MEANINGFUL_TIME_DELTA_MS);

      let notifyCategory: OperationalAlertCategory | null = null;
      let whatChanged: string | null = null;

      if (wasCleared && stabilizedAdv.peakFt >= thresholds.minor + 0.05) {
        notifyCategory = onsetLeadMs <= IMMINENT_LEAD_MS ? 'imminent_warning' : 'upcoming_watch';
        whatChanged = `Forecast rose back above ${thresholds.minor.toFixed(1)} ft MLLW to ${stabilizedAdv.peakFt.toFixed(2)} ft.`;
      } else if (tierEscalated) {
        notifyCategory = 'forecast_change';
        whatChanged = `Upgraded from ${severityTitle(prevNotifiedSev)} to ${severityTitle(
          effectiveSeverity
        )} Flood (${existing.lastNotifiedPeakFt?.toFixed(2) ?? ''} → ${stabilizedAdv.peakFt.toFixed(2)} ft MLLW).`;
      } else if (entersImminent) {
        notifyCategory = 'imminent_warning';
        whatChanged = `Flooding begins within ~${Math.max(
          15,
          Math.round(Math.max(0, onsetLeadMs) / MINUTE_MS)
        )} minutes (${etFormatter.format(new Date(stabilizedAdv.startAt))} ET).`;
      } else if (meaningfulSameTierShift) {
        notifyCategory = 'forecast_change';
        const sign = peakDeltaFt >= 0 ? '+' : '';
        whatChanged =
          Math.abs(peakDeltaFt) >= MEANINGFUL_PEAK_DELTA_FT
            ? `Peak forecast shifted ${sign}${peakDeltaFt.toFixed(2)} ft to ${stabilizedAdv.peakFt.toFixed(2)} ft MLLW.`
            : `Peak timing shifted by ${Math.round(peakTimeShiftMs / MINUTE_MS)} minutes to ${etFormatter.format(
                new Date(stabilizedAdv.peakAt)
              )} ET.`;
      }

      const updatedRecord: OperationalEpisodeRecord = {
        ...existing,
        status: 'active',
        severity: effectiveSeverity,
        notifiedSeverity: notifyCategory ? effectiveSeverity : existing.notifiedSeverity,
        imminentSent: existing.imminentSent || notifyCategory === 'imminent_warning' || entersImminent,
        revision: notifyCategory ? existing.revision + 1 : existing.revision,
        lastUpdatedAt: nowIso,
        lastNotifiedAt: notifyCategory ? nowIso : existing.lastNotifiedAt,
        lastNotifiedPeakFt: notifyCategory ? stabilizedAdv.peakFt : existing.lastNotifiedPeakFt,
        lastNotifiedPeakAt: notifyCategory ? stabilizedAdv.peakAt : existing.lastNotifiedPeakAt,
        advisory: stabilizedAdv,
      };

      if (notifyCategory) {
        pendingTriggers.push({
          category: notifyCategory,
          advisory: stabilizedAdv,
          prevPeakFt: existing.lastNotifiedPeakFt,
          prevSeverity: existing.notifiedSeverity,
          whatChanged,
        });
      }
      nextEpisodes.push(updatedRecord);
    }
  }

  // Check previously active future episodes that disappeared from completeAdvisories:
  // Apply 0.15 ft hysteresis before marking cleared so 5.61 -> 5.58 ft never fires false all-clear!
  for (const prev of baseState.episodes) {
    if (matchedPrevIds.has(prev.episodeId)) continue;
    const prevEndMs = Date.parse(prev.advisory.endAt);
    if (prevEndMs <= nowMs) {
      // Naturally elapsed in the past -> prune silently without firing all-clear spam
      continue;
    }

    // Find max forecasted water level within ±3h of the previous episode's peak
    const prevPeakMs = Date.parse(prev.advisory.peakAt);
    let localMaxFt = -Infinity;
    for (const pt of forecast.points) {
      const ptMs = Date.parse(pt.t);
      if (Math.abs(ptMs - prevPeakMs) <= 3 * HOUR_MS && pt.totalFt > localMaxFt) {
        localMaxFt = pt.totalFt;
      }
    }

    if (prev.status === 'active' && Number.isFinite(localMaxFt) && localMaxFt >= thresholds.minor - HYSTERESIS_FT) {
      // Within hysteresis band [5.45, 5.60): keep episode alive in hysteresis hold without spamming!
      nextEpisodes.push({
        ...prev,
        lastUpdatedAt: nowIso,
        advisory: {
          ...prev.advisory,
          peakFt: Math.round(localMaxFt * 100) / 100,
          aboveFloodStageFt: Math.max(0, Math.round((localMaxFt - thresholds.minor) * 100) / 100),
          estimatedStreetDepthIn: Math.max(0, Math.round((localMaxFt - thresholds.minor) * 12 * 10) / 10),
        },
      });
    } else if (prev.status === 'active') {
      // Dropped decisively below 5.45 ft -> transition once to 'cleared' and emit optional all_clear
      const clearedRecord: OperationalEpisodeRecord = {
        ...prev,
        status: 'cleared',
        revision: prev.revision + 1,
        lastUpdatedAt: nowIso,
        lastNotifiedAt: nowIso,
      };
      nextEpisodes.push(clearedRecord);
      pendingTriggers.push({
        category: 'all_clear',
        advisory: {
          ...prev.advisory,
          peakFt: Number.isFinite(localMaxFt) ? Math.round(localMaxFt * 100) / 100 : prev.advisory.peakFt,
          aboveFloodStageFt: 0,
          estimatedStreetDepthIn: 0,
        },
        prevPeakFt: prev.lastNotifiedPeakFt,
        prevSeverity: prev.notifiedSeverity,
        whatChanged: `Forecast crest dropped below flood threshold to ${
          Number.isFinite(localMaxFt) ? localMaxFt.toFixed(2) : '<5.45'
        } ft MLLW.`,
      });
    } else if (nowMs - Date.parse(prev.lastUpdatedAt) < 24 * HOUR_MS) {
      // Keep cleared record for 24h memory
      nextEpisodes.push(prev);
    }
  }

  // Multi-tide consolidation: group simultaneous upcoming_watch triggers into one consolidated notification!
  const notifications: OperationalNotificationEvent[] = [];
  const watchTriggers = pendingTriggers.filter(t => t.category === 'upcoming_watch');
  const otherTriggers = pendingTriggers.filter(t => t.category !== 'upcoming_watch');

  const emitEvent = (
    primary: (typeof pendingTriggers)[0],
    extras: PublicFloodAdvisory[]
  ): OperationalNotificationEvent => {
    const allAdvs = [primary.advisory, ...extras];
    let highestSev = primary.advisory.severity;
    for (const a of allAdvs) {
      if (SEVERITY_RANK[a.severity] > SEVERITY_RANK[highestSev]) highestSev = a.severity;
    }

    const peakEt = etFormatter.format(new Date(primary.advisory.peakAt));
    const headline =
      primary.category === 'all_clear'
        ? `All-Clear: Flood Forecast Revised Below Threshold (${peakEt} ET)`
        : primary.category === 'imminent_warning'
          ? `Imminent ${severityTitle(highestSev)} Flood Warning · Crest ${primary.advisory.peakFt.toFixed(2)} ft`
          : primary.category === 'forecast_change'
            ? `${severityTitle(highestSev)} Flood Forecast Updated · Crest ${primary.advisory.peakFt.toFixed(2)} ft`
            : extras.length > 0
              ? `${severityTitle(highestSev)} Flood Watch · ${allAdvs.length} Upcoming High-Water Cycles`
              : `${severityTitle(highestSev)} Flood Watch · Crest ${primary.advisory.peakFt.toFixed(2)} ft MLLW`;

    const summary =
      primary.category === 'all_clear'
        ? primary.whatChanged ?? 'Forecasted high tide has fallen below the 5.6 ft MLLW minor flood stage.'
        : `Peak ${primary.advisory.peakFt.toFixed(2)} ft MLLW (+${primary.advisory.aboveFloodStageFt.toFixed(
            2
          )} ft above stage, ~${primary.advisory.estimatedStreetDepthIn.toFixed(1)}" low-street water) around ${peakEt} ET.${
            extras.length > 0 ? ` Plus ${extras.length} additional flood tide cycle(s) in the next 48h.` : ''
          }`;

    const intentId = makeIntentHash(
      `${locationId}|${primary.advisory.episodeId}|${primary.category}|${highestSev}|${forecast.generatedAt}`
    );

    const bulletin: PublicAlertBulletin = {
      id: intentId,
      episodeId: primary.advisory.episodeId,
      issuedAt: nowIso,
      category: primary.category,
      severity: highestSev,
      headline,
      summary,
      whatChanged: primary.whatChanged,
      peakFt: primary.advisory.peakFt,
      peakAt: primary.advisory.peakAt,
      startAt: primary.advisory.startAt,
      endAt: primary.advisory.endAt,
      durationMinutes: primary.advisory.durationMinutes,
      estimatedStreetDepthIn: primary.advisory.estimatedStreetDepthIn,
      windSpeedMph: primary.advisory.windSpeedMph,
      windCompass: primary.advisory.windCompass,
      precipWindowIn: primary.advisory.precipWindowIn,
    };

    return {
      intentId,
      locationId,
      issuedAt: nowIso,
      expiresAt: new Date(Math.max(nowMs + 45 * MINUTE_MS, Date.parse(primary.advisory.endAt))).toISOString(),
      category: primary.category,
      highestSeverity: highestSev,
      primaryAdvisory: primary.advisory,
      additionalAdvisories: extras,
      previousPeakFt: primary.prevPeakFt,
      previousSeverity: primary.prevSeverity,
      whatChanged: primary.whatChanged,
      bulletin,
    };
  };

  if (watchTriggers.length > 0) {
    // Pick highest-peak watch as primary, attach remaining watches as consolidated digest
    const sortedWatches = [...watchTriggers].sort((a, b) => b.advisory.peakFt - a.advisory.peakFt);
    notifications.push(
      emitEvent(
        sortedWatches[0],
        sortedWatches.slice(1).map(w => w.advisory)
      )
    );
  }
  for (const trig of otherTriggers) {
    notifications.push(emitEvent(trig, []));
  }

  const updatedBulletins = [
    ...notifications.map(n => n.bulletin),
    ...baseState.recentBulletins,
  ].slice(0, 25);

  const activeAdvisories = nextEpisodes
    .filter(e => e.status === 'active' && Date.parse(e.advisory.endAt) > nowMs)
    .map(e => e.advisory)
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));

  const nextState: OperationalAlertEngineState = {
    version: 2,
    locationId,
    lastEvaluatedIssueAt: forecast.generatedAt,
    updatedAt: nowIso,
    episodes: nextEpisodes,
    recentBulletins: updatedBulletins,
  };

  const feed: PublicAlertFeedDocument = {
    version: 2,
    locationId,
    generatedAt: nowIso,
    forecastGeneratedAt: forecast.generatedAt,
    thresholds,
    currentSurgeFt: typeof forecast.currentResidualFt === 'number' ? forecast.currentResidualFt : null,
    nextPeakFt: forecast.peak?.totalFt ?? null,
    nextPeakAt: forecast.peak?.t ?? null,
    activeAdvisories,
    recentBulletins: updatedBulletins.slice(0, 20),
  };

  return { nextState, feed, notifications };
}

/**
 * Evaluates the newly published Operational Forecast against persisted episode state,
 * updates the public in-app alert feed (`locations/{siteId}/forecast_challengers/timesfm-3/alerts/current`),
 * and writes consolidated `operational_v2` outbox intents to `shadow_alert_outbox/{intentId}`.
 */
export async function runOperationalAlertsForForecast(
  db: Firestore,
  forecast: ChallengerOutlookDocument,
  now = new Date()
): Promise<{ activeCount: number; notificationsEmitted: number }> {
  const siteId = forecast.locationId || 'carolina-beach';
  const stateRef = db.doc(`operational_alert_states/${siteId}`);
  const feedRef = db.doc(`locations/${siteId}/forecast_challengers/timesfm-3/alerts/current`);

  const stateSnap = await stateRef.get();
  const prevState = stateSnap.exists ? (stateSnap.data() as OperationalAlertEngineState) : null;
  if (prevState?.lastEvaluatedIssueAt === forecast.generatedAt) {
    return {
      activeCount: prevState.episodes.filter(e => e.status === 'active').length,
      notificationsEmitted: 0,
    };
  }

  const { nextState, feed, notifications } = evaluateOperationalAlertStep(
    prevState,
    forecast,
    now,
    CAROLINA_BEACH_THRESHOLDS
  );

  const writes: Array<Promise<unknown>> = [stateRef.set(nextState), feedRef.set(feed)];

  for (const notif of notifications) {
    writes.push(
      db.doc(`shadow_alert_outbox/${notif.intentId}`).set({
        kind: 'operational_v2',
        intentId: notif.intentId,
        locationId: notif.locationId,
        forecastGeneratedAt: forecast.generatedAt,
        issuedAt: notif.issuedAt,
        expiresAt: notif.expiresAt,
        decision: 'would-notify',
        state: 'simulated',
        event: notif,
      })
    );
  }

  await Promise.all(writes);
  return {
    activeCount: feed.activeAdvisories.length,
    notificationsEmitted: notifications.length,
  };
}


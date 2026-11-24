export interface WebcamCandidate {
  rawUrl: string;
  date: Date;
  archived: boolean;
}

const MAX_ARCHIVED_CANDIDATES = 6;
const SECOORA_GUESS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function isSupportedImageUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('storage://')) {
    return trimmed.slice('storage://'.length).replace(/^\/+/, '').length > 0;
  }
  return trimmed.startsWith('https://') || trimmed.startsWith('http://');
}

/**
 * Builds an ordered list of imagery candidates for a requested timestamp:
 * - If the closest frame <= targetTime is archived (storage://), prefer archived frames first.
 * - If the closest frame <= targetTime is an external URL (e.g. SECOORA), try that single
 *   exact-time frame first so recent/live views get 6-minute resolution, then immediately
 *   fall back to archived (storage://) frames without firing dozens of dead external 404s.
 * - For historical views with no prior archived frame, optionally include the closest
 *   archived frame within `allowAfterMs` (never exceeding `now`).
 */
export function buildWebcamCandidates(
  imagery: Record<string, string> | undefined,
  targetTime: Date,
  options: { now?: Date; allowAfterMs?: number; maxArchived?: number } = {},
): WebcamCandidate[] {
  const targetMs = targetTime.getTime();
  if (!imagery || !Number.isFinite(targetMs)) return [];

  const nowMs = options.now && Number.isFinite(options.now.getTime()) ? options.now.getTime() : Date.now();
  const allowAfterMs = Math.max(0, options.allowAfterMs ?? 0);
  const maxArchived = Math.max(1, options.maxArchived ?? MAX_ARCHIVED_CANDIDATES);

  const beforeTarget: Array<{ ms: number; rawUrl: string; archived: boolean }> = [];
  const afterArchived: Array<{ ms: number; rawUrl: string; archived: boolean }> = [];

  for (const [iso, raw] of Object.entries(imagery)) {
    if (!isSupportedImageUrl(raw)) continue;
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) continue;
    const rawUrl = raw.trim();
    const archived = rawUrl.startsWith('storage://');

    if (ms <= targetMs) {
      beforeTarget.push({ ms, rawUrl, archived });
    } else if (archived && allowAfterMs > 0 && ms <= targetMs + allowAfterMs && ms <= nowMs) {
      afterArchived.push({ ms, rawUrl, archived: true });
    }
  }

  beforeTarget.sort((a, b) => b.ms - a.ms);
  afterArchived.sort((a, b) => a.ms - b.ms);

  const archivedBefore = beforeTarget.filter(item => item.archived).slice(0, maxArchived);
  const externalBefore = beforeTarget.filter(item => !item.archived);
  const ordered: WebcamCandidate[] = [];
  const seen = new Set<string>();

  const push = (item: { ms: number; rawUrl: string; archived: boolean } | undefined) => {
    if (!item) return;
    const key = `${item.ms}|${item.rawUrl}`;
    if (seen.has(key)) return;
    seen.add(key);
    ordered.push({ rawUrl: item.rawUrl, date: new Date(item.ms), archived: item.archived });
  };

  const newest = beforeTarget[0];
  if (newest && !newest.archived) {
    push(newest);
    for (const item of archivedBefore) push(item);
    if (archivedBefore.length === 0 && afterArchived.length > 0) {
      push(afterArchived[0]);
    }
  } else {
    for (const item of archivedBefore) push(item);
    if (archivedBefore.length === 0 && afterArchived.length > 0) {
      push(afterArchived[0]);
    }
    // Keep at most one external fallback if every archive lookup failed
    if (externalBefore.length > 0) push(externalBefore[0]);
  }

  return ordered;
}

/**
 * Only brute-force guess SECOORA minute URLs for recent timestamps; older frames
 * are purged upstream and would only generate dozens of guaranteed 404 requests.
 */
export function shouldUseSecooraGuessFallback(targetTime: Date, now: Date): boolean {
  const targetMs = targetTime.getTime();
  const nowMs = now.getTime();
  if (!Number.isFinite(targetMs) || !Number.isFinite(nowMs)) return false;
  return nowMs - targetMs <= SECOORA_GUESS_WINDOW_MS;
}

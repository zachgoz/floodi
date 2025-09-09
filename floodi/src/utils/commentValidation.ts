import { UserRole } from 'src/types/user';
import type {
  Comment,
  CommentMetadata,
  CommentTimeRange,
  CreateCommentData,
} from 'src/types/comment';
import { canCreateComments, canDeleteComment, canEditComment } from 'src/utils/permissions';

/** Content limits */
export const COMMENT_MIN_LEN = 1;
export const COMMENT_MAX_LEN = 2000;

/** Time limits */
const MAX_RANGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_ABS_OFFSET_MS = 365 * 24 * 60 * 60 * 1000; // 1 year window

/** NOAA station ID: numeric, typically 5-7+ digits */
const NOAA_STATION_ID = /^[0-9]{3,10}$/;

/** Simple inappropriate content blacklist (extend as needed) */
const BAD_WORDS = [/\bshit\b/i, /\bfuck\b/i, /<script/i];

/**
 * Basic HTML sanitizer allowing a safe subset of tags and minimal attributes.
 * Not as comprehensive as DOMPurify, but adequate for client-side rendering
 * combined with Firestore rules and serverTimestamp usage.
 */
export const sanitizeCommentContent = (html: string): string => {
  if (!html) return '';
  // Remove script/style/iframe and comments
  let out = html
    .replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script>/gi, '')
    .replace(/<\s*style[^>]*>[\s\S]*?<\s*\/\s*style>/gi, '')
    .replace(/<\s*iframe[^>]*>[\s\S]*?<\s*\/\s*iframe>/gi, '')
    .replace(/<!--([\s\S]*?)-->/g, '');

  // Strip all event handlers and javascript: URLs
  out = out.replace(/ on[a-z]+\s*=\s*"[^"]*"/gi, '');
  out = out.replace(/ on[a-z]+\s*=\s*'[^']*'/gi, '');
  out = out.replace(/javascript:\s*/gi, '');

  // Allowlist tags
  const allowed = ['b', 'strong', 'i', 'em', 'br', 'p', 'ul', 'ol', 'li', 'a'];
  // Remove disallowed tags but keep text content; preserve closing tags
  out = out.replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (m, tag: string, attrs: string) => {
    const t = tag.toLowerCase();
    const isClosing = m.startsWith('</');
    if (!allowed.includes(t)) return '';
    if (isClosing) {
      // Preserve closing tags; handle </a> without attributes
      if (t === 'a') return '</a>';
      return `</${t}>`;
    }
    if (t === 'a') {
      // Keep only safe href
      const hrefMatch = attrs.match(/href\s*=\s*(["'])(.*?)\1/i);
      const href = hrefMatch ? hrefMatch[2] : '';
      try {
        const u = new URL(href, 'https://example.com');
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return '<a rel="noopener noreferrer">';
      } catch {
        return '<a rel=\"noopener noreferrer\">';
      }
      return `<a href="${href}" rel="noopener noreferrer">`;
    }
    return `<${t}>`;
  });

  // Normalize whitespace
  out = out.replace(/\s+$/g, '').trim();
  return out;
};

export const validateCommentContent = (raw: string): { ok: boolean; errors: string[]; sanitized: string } => {
  const errors: string[] = [];
  const text = (raw ?? '').toString();
  const sanitized = sanitizeCommentContent(text);
  const len = sanitized.replace(/<[^>]+>/g, '').trim().length; // length of visible text

  if (len < COMMENT_MIN_LEN) errors.push('Comment is too short.');
  if (len > COMMENT_MAX_LEN) errors.push('Comment exceeds maximum length.');
  for (const bad of BAD_WORDS) if (bad.test(text)) errors.push('Comment contains inappropriate content.');

  return { ok: errors.length === 0, errors, sanitized };
};

export const isValidIso = (s: string): boolean => {
  if (typeof s !== 'string') return false;
  const t = Date.parse(s);
  return Number.isFinite(t);
};

export const validateTimeRange = (range: CommentTimeRange): { ok: boolean; errors: string[] } => {
  const errors: string[] = [];
  if (!isValidIso(range.startTime) || !isValidIso(range.endTime)) errors.push('Invalid time range.');
  const start = Date.parse(range.startTime || '');
  const end = Date.parse(range.endTime || '');
  if (!(end > start)) errors.push('Time range must have end after start.');
  if (end - start > MAX_RANGE_MS) errors.push('Time range exceeds maximum duration of 7 days.');
  const now = Date.now();
  if (Math.abs(start - now) > MAX_ABS_OFFSET_MS || Math.abs(end - now) > MAX_ABS_OFFSET_MS) {
    errors.push('Time range is too far from present.');
  }
  return { ok: errors.length === 0, errors };
};

export const validateStationId = (stationId: string): boolean => NOAA_STATION_ID.test(stationId);

export const validateCommentMetadata = (meta: CommentMetadata): { ok: boolean; errors: string[] } => {
  const errors: string[] = [];
  if (!meta?.station?.id || !validateStationId(meta.station.id)) errors.push('Invalid station ID.');
  if (!meta?.station?.name || typeof meta.station.name !== 'string') errors.push('Invalid station name.');
  const tr = validateTimeRange(meta.timeRange);
  if (!tr.ok) errors.push(...tr.errors);
  const contexts = Array.isArray(meta.dataContext) ? meta.dataContext : [meta.dataContext];
  const validCtx = ['observed', 'predicted', 'adjusted'];
  if (!contexts.length || !contexts.every((c) => validCtx.includes(c))) errors.push('Invalid data context.');
  if (meta.thresholdValue != null && typeof meta.thresholdValue !== 'number') errors.push('Invalid threshold value.');
  return { ok: errors.length === 0, errors };
};

export const isValidEditReason = (reason: unknown): boolean => {
  if (reason == null) return true;
  if (typeof reason !== 'string') return false;
  const r = reason.trim();
  return r.length > 0 && r.length <= 200;
};

export type PermissionAction = 'create' | 'edit' | 'delete';

export interface PermissionContext {
  action: PermissionAction;
  role: UserRole;
  currentUserUid: string | null | undefined;
  comment?: Pick<Comment, 'authorUid' | 'isDeleted' | 'createdAt'> | null;
}

const msFromTimestampLike = (v: any): number | null => {
  if (!v) return null;
  if (typeof v === 'number') return v;
  if (typeof v?.toMillis === 'function') return v.toMillis();
  if (typeof v?.seconds === 'number') return Math.floor(v.seconds * 1000);
  if (v instanceof Date) return v.getTime();
  return null;
};

export const validateCommentPermissions = (ctx: PermissionContext): boolean => {
  const { action, role, currentUserUid, comment } = ctx;
  if (action === 'create') return canCreateComments(role);
  if (!currentUserUid) return false;
  if (action === 'edit') {
    if (!comment || comment.isDeleted) return false;
    const isOwner = comment.authorUid === currentUserUid;
    const createdMs = msFromTimestampLike((comment as any).createdAt);
    // If createdAt is unavailable (e.g., in tests or legacy docs), default to allowing owner edits.
    const within24h = createdMs == null ? true : Date.now() < createdMs + 24 * 60 * 60 * 1000;
    return (isOwner && within24h && canEditComment(role, comment.authorUid, currentUserUid)) || role === UserRole.Admin || role === UserRole.Moderator;
  }
  if (action === 'delete') {
    if (!comment) return false;
    const isOwner = comment.authorUid === currentUserUid;
    const createdMs = msFromTimestampLike((comment as any).createdAt);
    // If createdAt is unavailable (e.g., in tests or legacy docs), default to allowing owner deletes.
    const within24h = createdMs == null ? true : Date.now() < createdMs + 24 * 60 * 60 * 1000;
    return (isOwner && within24h && canDeleteComment(role, comment.authorUid, currentUserUid)) || role === UserRole.Admin || role === UserRole.Moderator;
  }
  return false;
};

/**
 * Simple per-user rate limiting helper to mitigate spam.
 * In-memory token bucket keyed by uid; callers should provide current time.
 */
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 5; // max 5 comments per minute

type Window = { start: number; count: number };
const buckets = new Map<string, Window>();

export const canCreateAnotherComment = (uid: string, now: number = Date.now()): boolean => {
  const w = buckets.get(uid);
  if (!w) {
    buckets.set(uid, { start: now, count: 1 });
    return true;
  }
  if (now - w.start > RATE_LIMIT_WINDOW_MS) {
    buckets.set(uid, { start: now, count: 1 });
    return true;
  }
  if (w.count < RATE_LIMIT_MAX) {
    w.count += 1;
    buckets.set(uid, w);
    return true;
  }
  return false;
};

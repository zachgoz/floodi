import type { AppConfiguration } from 'src/components/Tab2/types';
import type { Comment, CommentTimeRange } from 'src/types/comment';

/** Create a comment time range from chart config + domain. */
export const createTimeRangeFromChart = (
  config: AppConfiguration,
  domain: { start: Date; end: Date; now?: Date }
): CommentTimeRange => {
  const startTime = domain.start.toISOString();
  const endTime = domain.end.toISOString();
  const label = formatTimeRangeLabel({ startTime, endTime });
  return {
    startTime,
    endTime,
    label,
    eventType: 'normal-tide',
  };
};

/** Human-friendly time range label */
export const formatTimeRangeLabel = (range: CommentTimeRange, hint?: string): string => {
  const s = new Date(range.startTime);
  const e = new Date(range.endTime);
  const sameDay = s.toDateString() === e.toDateString();
  const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const date = (d: Date) => d.toLocaleDateString();
  const core = sameDay
    ? `${date(s)} ${time(s)}–${time(e)}`
    : `${date(s)} ${time(s)} → ${date(e)} ${time(e)}`;
  return hint ? `${hint} (${core})` : core;
};

/** True if two ranges overlap (inclusive). */
export const isTimeRangeOverlapping = (a: CommentTimeRange, b: CommentTimeRange): boolean => {
  const a0 = Date.parse(a.startTime);
  const a1 = Date.parse(a.endTime);
  const b0 = Date.parse(b.startTime);
  const b1 = Date.parse(b.endTime);
  return a0 <= b1 && b0 <= a1;
};

/** Expand around a timestamp by +/- bufferMs into a range. */
export const expandTimeRange = (center: Date | string, bufferMs: number): CommentTimeRange => {
  const t = typeof center === 'string' ? Date.parse(center) : center.getTime();
  return {
    startTime: new Date(t - bufferMs).toISOString(),
    endTime: new Date(t + bufferMs).toISOString(),
    label: formatTimeRangeLabel({ startTime: new Date(t - bufferMs).toISOString(), endTime: new Date(t + bufferMs).toISOString() }),
  };
};

/** Validate a time range against chart configuration (basic checks). */
export const validateChartTimeRange = (
  _config: AppConfiguration,
  range: CommentTimeRange
): { ok: boolean; errors: string[] } => {
  const errors: string[] = [];
  const s = Date.parse(range.startTime);
  const e = Date.parse(range.endTime);
  if (!(e > s)) errors.push('Invalid chart time range.');
  const MAX = 7 * 24 * 60 * 60 * 1000;
  if (e - s > MAX) errors.push('Range too large for chart.');
  return { ok: errors.length === 0, errors };
};

/** Convert chart interactions to a time range. */
export const getTimeRangeFromChartSelection = (sel: { start?: Date; end?: Date; at?: Date }): CommentTimeRange => {
  if (sel.start && sel.end) {
    return {
      startTime: sel.start.toISOString(),
      endTime: sel.end.toISOString(),
      label: formatTimeRangeLabel({ startTime: sel.start.toISOString(), endTime: sel.end.toISOString() }),
    };
  }
  const at = sel.at ?? new Date();
  return expandTimeRange(at, 15 * 60 * 1000); // default +/-15 minutes
};

/** Format for display according to timezone preference. */
export const formatTimeRangeForDisplay = (
  range: CommentTimeRange,
  timezone: 'local' | 'gmt' = 'local'
): { start: string; end: string; label: string } => {
  const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', timeZone: timezone === 'gmt' ? 'UTC' : undefined };
  const s = new Date(range.startTime);
  const e = new Date(range.endTime);
  const start = s.toLocaleString(undefined, opts);
  const end = e.toLocaleString(undefined, opts);
  const label = range.label ?? formatTimeRangeLabel(range);
  return { start, end, label };
};

/** Filter comments by overlap with a range. */
export const getCommentsInTimeRange = (comments: Comment[], range: CommentTimeRange): Comment[] =>
  comments.filter((c) => isTimeRangeOverlapping(c.metadata.timeRange, range));

/** Serialize/deserialize for URL or storage */
export const serializeRange = (range: CommentTimeRange): string =>
  [range.startTime, range.endTime, range.label || '', range.eventType || ''].join('|');

export const deserializeRange = (raw: string): CommentTimeRange => {
  const [startTime, endTime, label, eventType] = (raw || '').split('|');
  return { startTime, endTime, label: label || undefined, eventType: eventType || undefined };
};

/** Stats helpers */
export const durationMs = (r: CommentTimeRange) => Date.parse(r.endTime) - Date.parse(r.startTime);

export const overlapPercentage = (a: CommentTimeRange, b: CommentTimeRange): number => {
  const a0 = Date.parse(a.startTime), a1 = Date.parse(a.endTime);
  const b0 = Date.parse(b.startTime), b1 = Date.parse(b.endTime);
  const overlap = Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  const base = a1 - a0 || 1;
  return Math.round((overlap / base) * 100);
};


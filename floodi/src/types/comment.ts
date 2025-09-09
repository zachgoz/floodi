import type { Timestamp } from 'firebase/firestore';

/**
 * Comment system types for FloodCast.
 *
 * Comments can be linked to a chart time range for contextual discussion about
 * tides, thresholds, and surge conditions. Time ranges use ISO strings and can
 * be categorized for richer UX (e.g., threshold crossing, surge event).
 */

export type CommentDataContext = 'observed' | 'predicted' | 'adjusted';

/** Time interval associated with a comment. */
export interface CommentTimeRange {
  /** Inclusive ISO start time */
  startTime: string;
  /** Inclusive ISO end time; must be after startTime */
  endTime: string;
  /** Optional user-facing label for this interval */
  label?: string;
  /** Optional event type classification */
  eventType?: 'threshold-crossing' | 'surge-event' | 'normal-tide' | string;
}

/** Station info embedded in comment metadata for fast rendering. */
export interface CommentStationInfo {
  id: string; // NOAA station ID
  name: string;
}

/**
 * Comment metadata links a comment to chart data context and station.
 */
export interface CommentMetadata {
  station: CommentStationInfo;
  timeRange: CommentTimeRange;
  dataContext: CommentDataContext | CommentDataContext[];
  /** Optional threshold value for threshold-related discussions */
  thresholdValue?: number | null;
}

/** Track edits for transparency and moderation. */
export interface CommentEditRecord {
  at: Timestamp;
  previousContent: string;
  editReason?: string;
}

/** Primary Comment document interface. */
export interface Comment {
  id: string;
  content: string; // sanitized HTML
  authorUid: string;
  authorDisplayName: string | null;
  authorPhotoURL: string | null;
  metadata: CommentMetadata;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  isEdited: boolean;
  editHistory: CommentEditRecord[];
  isDeleted: boolean;
}

/** Payload for creating a comment. */
export interface CreateCommentData {
  content: string;
  metadata: CommentMetadata;
  authorUid: string;
  authorDisplayName: string | null;
  authorPhotoURL: string | null;
}

/** Payload for updating a comment. */
export interface UpdateCommentData {
  content?: string;
  metadata?: Partial<CommentMetadata> & {
    station?: Partial<CommentStationInfo>;
    timeRange?: Partial<CommentTimeRange>;
  };
  editReason?: string;
}

/** Query helpers */
export interface CommentFilter {
  stationId?: string;
  authorUid?: string;
  timeRange?: CommentTimeRange;
  includeDeleted?: boolean;
}

export type CommentSort =
  | { field: 'createdAt'; direction: 'asc' | 'desc' }
  | { field: 'metadata.timeRange.startTime'; direction: 'asc' | 'desc' };

/** Guard: quick check if an object looks like a time range */
export const isCommentTimeRange = (v: unknown): v is CommentTimeRange => {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.startTime === 'string' && typeof r.endTime === 'string';
};

/** Guard: CommentMetadata shape (shallow) */
export const isCommentMetadata = (v: unknown): v is CommentMetadata => {
  if (!v || typeof v !== 'object') return false;
  const r = v as any;
  return !!r.station?.id && !!r.timeRange?.startTime && !!r.timeRange?.endTime;
};

/**
 * Sorting helpers
 */
export const compareByCreatedAt = (a: Comment, b: Comment, dir: 'asc' | 'desc' = 'desc') => {
  const delta = (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0);
  return dir === 'asc' ? delta : -delta;
};

export const compareByRangeStart = (a: Comment, b: Comment, dir: 'asc' | 'desc' = 'asc') => {
  const da = Date.parse(a.metadata.timeRange.startTime) || 0;
  const db = Date.parse(b.metadata.timeRange.startTime) || 0;
  const delta = da - db;
  return dir === 'asc' ? delta : -delta;
};

/**
 * Docs
 *
 * - Time Range Linking: Comments carry a `metadata.timeRange` with ISO start/end that
 *   align to FloodCast chart domains produced by hooks in `src/components/Tab2/hooks`.
 * - Station Linking: `metadata.station` embeds the selected NOAA station for the chart.
 * - Data Context: `metadata.dataContext` indicates which series the comment refers to.
 * - Edit History: on updates, prior sanitized content is appended to `editHistory` with
 *   a timestamp and optional reason; `isEdited` flips true.
 */

export type { Timestamp };


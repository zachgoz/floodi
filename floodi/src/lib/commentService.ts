import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from 'src/lib/firebase';
import type {
  Comment,
  CreateCommentData,
  UpdateCommentData,
  CommentTimeRange,
} from 'src/types/comment';
import { sanitizeCommentContent, validateCommentContent, validateCommentMetadata, validateCommentPermissions, canCreateAnotherComment, type PermissionAction } from 'src/utils/commentValidation';
import { UserRole } from 'src/types/user';

const COMMENTS_COLLECTION = 'comments';

const commentDocRef = (id: string): DocumentReference => doc(db, COMMENTS_COLLECTION, id);

export interface Page<T> {
  items: T[];
  nextCursor: QueryDocumentSnapshot<DocumentData> | null;
}

/** Validate permissions for an action. */
const assertPermission = (
  action: PermissionAction,
  role: UserRole,
  currentUserUid: string | null | undefined,
  comment?: Pick<Comment, 'authorUid' | 'isDeleted' | 'createdAt'> | null
) => {
  const ok = validateCommentPermissions({ action, role, currentUserUid, comment });
  if (!ok) throw new Error('Permission denied');
};

/** Create a comment document with server timestamps. */
export const createComment = async (
  data: CreateCommentData,
  ctx: { role: UserRole; currentUserUid: string }
): Promise<Comment> => {
  assertPermission('create', ctx.role, ctx.currentUserUid, null);
  // Client-side rate limiting to mitigate bursts
  if (!canCreateAnotherComment(ctx.currentUserUid)) {
    throw new Error('Rate limit exceeded. Please wait a moment before commenting again.');
  }

  if (data.authorUid !== ctx.currentUserUid) throw new Error('authorUid mismatch');
  const metaRes = validateCommentMetadata(data.metadata);
  if (!metaRes.ok) throw new Error(`Invalid metadata: ${metaRes.errors.join(', ')}`);
  const contentRes = validateCommentContent(data.content);
  if (!contentRes.ok) throw new Error(`Invalid content: ${contentRes.errors.join(', ')}`);

  const now = serverTimestamp();
  const payload = {
    content: contentRes.sanitized,
    authorUid: data.authorUid,
    authorDisplayName: data.authorDisplayName ?? null,
    authorPhotoURL: data.authorPhotoURL ?? null,
    metadata: data.metadata,
    createdAt: now,
    updatedAt: now,
    isEdited: false,
    editHistory: [],
    isDeleted: false,
  } as unknown as Comment;

  const col = collection(db, COMMENTS_COLLECTION);
  const added = await addDoc(col, payload);
  const snap = await getDoc(added);
  if (!snap.exists()) throw new Error('Failed to create comment');
  return { id: snap.id, ...(snap.data() as Omit<Comment, 'id'>) } as Comment;
};

/** Fetch a single comment by id. */
export const getComment = async (id: string): Promise<Comment | null> => {
  const snap = await getDoc(commentDocRef(id));
  return snap.exists() ? ({ id: snap.id, ...(snap.data() as Omit<Comment, 'id'>) } as Comment) : null;
};

/** List comments for a station ordered by createdAt (desc) with pagination. */
export const getCommentsByStation = async (
  stationId: string,
  options?: { includeDeleted?: boolean; pageSize?: number; cursor?: QueryDocumentSnapshot<DocumentData> | null }
): Promise<Page<Comment>> => {
  const pageSize = options?.pageSize ?? 20;
  const parts: any[] = [
    where('metadata.station.id', '==', stationId),
    orderBy('createdAt', 'desc'),
    limit(pageSize),
  ];
  if (!options?.includeDeleted) parts.unshift(where('isDeleted', '==', false));
  if (options?.cursor) parts.push(startAfter(options.cursor));
  const q = query(collection(db, COMMENTS_COLLECTION), ...parts);
  const snap = await getDocs(q);
  const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Comment, 'id'>) } as Comment));
  const nextCursor = snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1] : null;
  return { items, nextCursor };
};

/**
 * Query for comments overlapping a time window (partial server-side, final client-side filter).
 * Firestore supports range filters on a single field; we filter by startTime <= end and then
 * refine by endTime >= start locally.
 */
export const getCommentsByTimeRange = async (
  stationId: string,
  range: CommentTimeRange,
  options?: { includeDeleted?: boolean; pageSize?: number }
): Promise<Comment[]> => {
  const endIso = range.endTime;
  const parts: any[] = [
    where('metadata.station.id', '==', stationId),
    where('metadata.timeRange.startTime', '<=', endIso),
    orderBy('metadata.timeRange.startTime', 'asc'),
    limit(options?.pageSize ?? 100),
  ];
  if (!options?.includeDeleted) parts.unshift(where('isDeleted', '==', false));
  const q = query(collection(db, COMMENTS_COLLECTION), ...parts);
  const snap = await getDocs(q);
  const start = Date.parse(range.startTime);
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<Comment, 'id'>) } as Comment))
    .filter((c) => Date.parse(c.metadata.timeRange.endTime) >= start);
};

/** List comments by author. */
export const getCommentsByAuthor = async (
  authorUid: string,
  options?: { includeDeleted?: boolean; pageSize?: number }
): Promise<Comment[]> => {
  const parts: any[] = [
    where('authorUid', '==', authorUid),
    orderBy('createdAt', 'desc'),
    limit(options?.pageSize ?? 50),
  ];
  if (!options?.includeDeleted) parts.unshift(where('isDeleted', '==', false));
  const q = query(collection(db, COMMENTS_COLLECTION), ...parts);
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Comment, 'id'>) } as Comment));
};

/** Update comment content/metadata with edit history. */
export const updateComment = async (
  id: string,
  updates: UpdateCommentData,
  ctx: { role: UserRole; currentUserUid: string }
): Promise<void> => {
  const existing = await getComment(id);
  if (!existing) throw new Error('Comment not found');
  assertPermission('edit', ctx.role, ctx.currentUserUid, { authorUid: existing.authorUid, isDeleted: existing.isDeleted, createdAt: existing.createdAt });
  const updateDocPayload: Record<string, unknown> = { updatedAt: serverTimestamp() };

  if (updates.content != null) {
    const res = validateCommentContent(updates.content);
    if (!res.ok) throw new Error(`Invalid content: ${res.errors.join(', ')}`);
    updateDocPayload.content = res.sanitized;
    updateDocPayload.isEdited = true;
    // Append edit history entry (server will set timestamp)
    const prev = sanitizeCommentContent(existing.content);
    const editRecord = {
      at: serverTimestamp(),
      previousContent: prev,
      ...(updates.editReason ? { editReason: updates.editReason } : {}),
    } as any;
    updateDocPayload.editHistory = [...(existing.editHistory ?? []), editRecord];
  }

  if (updates.metadata) {
    const merged = {
      ...existing.metadata,
      ...updates.metadata,
      station: { ...existing.metadata.station, ...(updates.metadata.station ?? {}) },
      timeRange: { ...existing.metadata.timeRange, ...(updates.metadata.timeRange ?? {}) },
    } as any;
    const metaRes = validateCommentMetadata(merged);
    if (!metaRes.ok) throw new Error(`Invalid metadata: ${metaRes.errors.join(', ')}`);
    updateDocPayload.metadata = merged;
  }

  await updateDoc(commentDocRef(id), updateDocPayload);
};

/** Soft delete a comment (toggle isDeleted). */
export const deleteComment = async (
  id: string,
  ctx: { role: UserRole; currentUserUid: string }
): Promise<void> => {
  const existing = await getComment(id);
  if (!existing) return;
  assertPermission('delete', ctx.role, ctx.currentUserUid, { authorUid: existing.authorUid, isDeleted: existing.isDeleted, createdAt: existing.createdAt });
  await updateDoc(commentDocRef(id), { isDeleted: true, updatedAt: serverTimestamp() });
};

/** Hard delete (admin only). */
export const hardDeleteComment = async (id: string, ctx: { role: UserRole }): Promise<void> => {
  if (ctx.role !== UserRole.Admin) throw new Error('Admin required');
  await deleteDoc(commentDocRef(id));
};

/** Query comments overlapping range for chart usage. */
export const getCommentsForChartTimeRange = async (
  stationId: string,
  range: CommentTimeRange
): Promise<Comment[]> => getCommentsByTimeRange(stationId, range, { includeDeleted: false });

/** Real-time subscription to comments (generic). */
export const subscribeToComments = (
  opts: { stationId?: string; authorUid?: string; includeDeleted?: boolean; pageSize?: number },
  cb: (comments: Comment[]) => void
): Unsubscribe => {
  const parts: any[] = [orderBy('createdAt', 'desc'), limit(opts.pageSize ?? 50)];
  if (opts.stationId) parts.unshift(where('metadata.station.id', '==', opts.stationId));
  if (opts.authorUid) parts.unshift(where('authorUid', '==', opts.authorUid));
  if (!opts.includeDeleted) parts.unshift(where('isDeleted', '==', false));
  const q = query(collection(db, COMMENTS_COLLECTION), ...parts);
  return onSnapshot(q, (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Comment, 'id'>) } as Comment));
    cb(items);
  });
};

/** Real-time subscription to station comments only. */
export const subscribeToStationComments = (
  stationId: string,
  cb: (comments: Comment[]) => void,
  opts?: { includeDeleted?: boolean; pageSize?: number }
): Unsubscribe => subscribeToComments({ stationId, includeDeleted: opts?.includeDeleted, pageSize: opts?.pageSize }, cb);

/** Counts */
export const countCommentsByStation = async (stationId: string, includeDeleted = false): Promise<number> => {
  const parts: any[] = [where('metadata.station.id', '==', stationId)];
  if (!includeDeleted) parts.push(where('isDeleted', '==', false));
  const q = query(collection(db, COMMENTS_COLLECTION), ...parts);
  const snap = await getDocs(q);
  return snap.size;
};

export const countCommentsByAuthor = async (authorUid: string, includeDeleted = false): Promise<number> => {
  const parts: any[] = [where('authorUid', '==', authorUid)];
  if (!includeDeleted) parts.push(where('isDeleted', '==', false));
  const q = query(collection(db, COMMENTS_COLLECTION), ...parts);
  const snap = await getDocs(q);
  return snap.size;
};

/** Batch operations */
export const softDeleteComments = async (
  ids: string[],
  ctx: { role: UserRole; currentUserUid: string }
): Promise<void> => {
  const batch = writeBatch(db);
  for (const id of ids) {
    const existing = await getComment(id);
    if (!existing) continue;
    const permitted = validateCommentPermissions({ action: 'delete', role: ctx.role, currentUserUid: ctx.currentUserUid, comment: { authorUid: existing.authorUid, isDeleted: existing.isDeleted, createdAt: existing.createdAt } });
    if (!permitted) continue;
    batch.update(commentDocRef(id), { isDeleted: true, updatedAt: serverTimestamp() } as any);
  }
  await batch.commit();
};

export type { Comment };

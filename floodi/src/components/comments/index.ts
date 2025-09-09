/**
 * Comment UI Components
 *
 * This module provides UI building blocks for comment creation,
 * display, editing, deletion, and timeline visualization. Use
 * these exports to compose comment functionality across the app.
 */

export { TimeRangePicker } from 'src/components/comments/TimeRangePicker';
export type { TimeRange, TimeRangeMode, CommentEventType } from 'src/components/comments/TimeRangePicker';

export { CommentForm } from 'src/components/comments/CommentForm';

export { CommentItem } from 'src/components/comments/CommentItem';
export type { CommentModel } from 'src/components/comments/CommentItem';

export { default as CommentEditModal } from 'src/components/comments/CommentEditModal';
export { default as CommentDeleteModal } from 'src/components/comments/CommentDeleteModal';

export { CommentList } from 'src/components/comments/CommentList';
export { CommentTimeline } from 'src/components/comments/CommentTimeline';
export { CommentMetadata } from 'src/components/comments/CommentMetadata';

export { CommentManager } from 'src/components/comments/CommentManager';


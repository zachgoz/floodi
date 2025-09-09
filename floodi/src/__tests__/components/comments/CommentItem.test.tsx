/**
 * CommentItem tests
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { CommentItem, CommentModel } from 'src/components/comments/CommentItem';
import { vi } from 'vitest';

vi.mock('src/utils/timeRangeHelpers', () => ({
  formatTimeRangeForDisplay: (r: any) => `${new Date(r.start).toISOString()} – ${new Date(r.end).toISOString()}`,
}));

describe('CommentItem', () => {
  const baseComment: CommentModel = {
    id: 'c1',
    author: { displayName: 'Alice', avatarUrl: '', role: 'user' },
    content: 'Hello <b>world</b>',
    createdAt: new Date().toISOString(),
    meta: {
      stationName: 'Station A',
      range: {
        start: new Date(Date.now() - 60000).toISOString(),
        end: new Date().toISOString(),
      },
      dataContext: { observed: true },
      eventType: 'normal-tide',
    },
  };

  it('renders author and content', () => {
    render(<CommentItem comment={baseComment} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Station A')).toBeInTheDocument();
  });
});

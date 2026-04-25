/**
 * CommentForm tests
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { CommentForm } from 'src/components/comments/CommentForm';
import { useCommentPermissions } from 'src/hooks/useComments';

vi.mock('src/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, isAnonymous: false }),
}));
vi.mock('src/hooks/useComments', () => ({
  useCommentPermissions: vi.fn(() => ({ canCreate: () => true, canEdit: () => true, canDelete: () => true, loading: false })),
}));
// Mock heavy sub-tree to avoid Ionic web component overhead in this suite
vi.mock('src/components/comments/TimeRangePicker', () => ({
  TimeRangePicker: () => <div data-testid="mock-time-range-picker" />,
}));
vi.mock('src/utils/timeRangeHelpers', () => ({
  formatTimeRangeForDisplay: (r: any) => `${new Date(r.start).toISOString()} – ${new Date(r.end).toISOString()}`,
  validateChartTimeRange: () => ({ valid: true }),
}));

describe('CommentForm', () => {
  const chartDomain = {
    start: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    end: new Date().toISOString(),
  };

  it('renders content textarea and submit button', () => {
    render(<CommentForm stationId="s1" chartDomain={chartDomain} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText('Comment content')).toBeInTheDocument();
    expect(screen.getByLabelText('Submit comment')).toBeInTheDocument();
  }, 5000);

  it('validates empty content on submit', () => {
    const onSubmit = vi.fn();
    render(<CommentForm stationId="s1" chartDomain={chartDomain} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByLabelText('Submit comment'));
    expect(onSubmit).not.toHaveBeenCalled();
  }, 5000);

  it('shows form submit button when user can create comments', () => {
    render(<CommentForm stationId="s1" chartDomain={chartDomain} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText('Submit comment')).toBeInTheDocument();
  });

  it('does not call onSubmit when content is empty', () => {
    const onSubmit = vi.fn();
    render(<CommentForm stationId="s1" chartDomain={chartDomain} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByLabelText('Submit comment'));
    // Empty content — submission should be blocked by validation
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

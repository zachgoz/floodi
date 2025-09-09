/**
 * CommentForm tests
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { CommentForm } from 'src/components/comments/CommentForm';

vi.mock('src/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, isAnonymous: false }),
}));
vi.mock('src/hooks/useComments', () => ({
  useCommentPermissions: () => ({ canCreate: true }),
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
    expect(screen.getByRole('button', { name: /submit comment/i })).toBeInTheDocument();
  });

  it('validates empty content on submit', () => {
    const onSubmit = vi.fn();
    render(<CommentForm stationId="s1" chartDomain={chartDomain} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: /submit comment/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});


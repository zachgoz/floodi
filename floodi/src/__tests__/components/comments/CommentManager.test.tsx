/**
 * CommentManager tests
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { CommentManager } from 'src/components/comments/CommentManager';

vi.mock('src/hooks/useComments', () => ({
  useComments: () => ({
    comments: [],
    loading: false,
    error: undefined,
    createComment: vi.fn(),
    refresh: vi.fn(),
    canEdit: () => true,
    canDelete: () => true,
    updateComment: vi.fn(),
    deleteComment: vi.fn(),
  }),
}));

describe('CommentManager', () => {
  it('renders and switches tabs', () => {
    render(<CommentManager stationId="s1" />);
    expect(screen.getByText(/comments/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/timeline/i));
    fireEvent.click(screen.getByText(/create/i));
  });
});


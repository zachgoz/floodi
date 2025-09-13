/**
 * CommentManager tests
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { CommentManager } from 'src/components/comments/CommentManager';

vi.mock('src/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'u1', email: 'u@e.com' },
    isAnonymous: false,
    userProfile: null,
    userPermissions: { role: 'user' },
  }),
}));

vi.mock('src/hooks/useComments', () => ({
  useComments: () => ({
    comments: [],
    loading: false,
    error: undefined,
    create: vi.fn(),
    refresh: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    loadMore: vi.fn(),
  }),
  useCommentPermissions: () => ({ canCreate: () => true, canEdit: () => true, canDelete: () => true }),
}));

describe('CommentManager', () => {
  it('renders and switches tabs', () => {
    const { container } = render(<CommentManager stationId="s1" />);
    // Top header title contains count; avoid ambiguous matches
    expect(screen.getByText(/Comments \(0\)/i)).toBeInTheDocument();

    // Use header button to switch to create tab (avoids IonSegment custom events)
    fireEvent.click(screen.getByLabelText('Create comment'));
    expect(screen.getByText(/Create Comment/i)).toBeInTheDocument();

    // Now switch to timeline via dispatching Ionic's custom event on the segment
    const segment = container.querySelector('ion-segment');
    expect(segment).toBeTruthy();
    fireEvent(segment as Element, new CustomEvent('ionChange', { detail: { value: 'timeline' } } as any));
    // Timeline view should mount; assert specific timeline container exists
    expect(container.querySelector('.comments-timeline .timeline-controls')).toBeTruthy();
  });

  it('supports standalone filters', () => {
    const { container } = render(
      <CommentManager
        stationId="s1"
        standalone
        searchQuery="rain"
        onSearchChange={() => {}}
        authorFilter="sam"
        onAuthorFilterChange={() => {}}
        dataContext={{ observed: true }}
        onDataContextChange={() => {}}
      />
    );
    // Filter UI should be present
    expect(container.querySelector('.comments-filters')).toBeTruthy();
  });
});

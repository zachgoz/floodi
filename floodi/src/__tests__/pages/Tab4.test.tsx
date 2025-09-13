/**
 * Tab4 (Comments) page tests
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import Tab4 from 'src/pages/Tab4';

vi.mock('src/hooks/useCommentsTab', () => ({
  useCommentsTab: () => ({
    stationId: '8658163',
    setStationId: vi.fn(),
    filterState: { search: '', author: '', range: null, dataContext: null },
    setFilterState: vi.fn(),
    comments: [],
    loading: false,
    error: null,
    refresh: vi.fn(),
    role: 'user',
    stats: { total: 0, last24h: 0 },
    exportJSON: vi.fn(),
  }),
}));

vi.mock('src/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'u1', email: 'u@e.com' },
    isAnonymous: false,
    userProfile: null,
    userPermissions: { role: 'user' },
  }),
}));

vi.mock('src/components/Tab2/StationSelector', () => ({
  StationSelector: ({ selectedStationId }: any) => (
    <div data-testid="station-selector">station:{selectedStationId}</div>
  ),
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

describe('Tab4 Comments Page', () => {
  it('renders header and station selector', () => {
    render(<Tab4 />);
    // Look for the main header title specifically
    const header = screen.getByRole('banner');
    expect(header).toHaveTextContent('Comments');
    expect(screen.getByTestId('station-selector')).toBeInTheDocument();
  });

  it('shows stats and integrates CommentManager', () => {
    render(<Tab4 />);
    expect(screen.getAllByText('0')).toBeTruthy(); // total and last24h counts
    // Create button exists via CommentManager
    expect(screen.getByLabelText('Create comment')).toBeInTheDocument();
  });
});


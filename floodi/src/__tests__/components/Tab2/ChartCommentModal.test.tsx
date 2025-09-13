import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ChartCommentModal } from 'src/components/Tab2/ChartCommentModal';

// Mock IonModal to render children directly when open (Ionic overlays don't mount in JSDOM)
vi.mock('@ionic/react', async () => {
  const actual = await vi.importActual<any>('@ionic/react');
  return {
    ...actual,
    IonModal: ({ isOpen, children, onDidDismiss, className, 'aria-label': ariaLabel }: any) => (
      isOpen ? (
        <div data-testid="ion-modal" className={className} aria-label={ariaLabel}>
          {children}
        </div>
      ) : null
    ),
  };
});

vi.mock('src/hooks/useComments', () => ({
  useComments: () => ({ create: vi.fn(), loading: false }),
  useCommentPermissions: () => ({ canCreate: () => true, canEdit: () => true, canDelete: () => true }),
}));

// Mock AuthContext so CommentForm inside the modal can render
vi.mock('src/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'u1', email: 'u@e.com' },
    isAnonymous: false,
    userProfile: null,
  }),
}));

describe('ChartCommentModal', () => {
  const config = {
    station: { id: 'S1', name: 'Station' },
    threshold: 5,
    offset: { mode: 'auto', value: '' },
    timeRange: { mode: 'relative', lookbackH: 1, lookaheadH: 1, absStart: '', absEnd: '' },
    display: { timezone: 'local', showDelta: true },
  } as any;

  it('renders with selected time range', () => {
    const range = { startTime: new Date().toISOString(), endTime: new Date(Date.now()+60000).toISOString() };
    render(<ChartCommentModal isOpen={true} onDismiss={() => {}} range={range as any} config={config} />);
    expect(screen.getByText(/Add Comment/i)).toBeInTheDocument();
  });
});

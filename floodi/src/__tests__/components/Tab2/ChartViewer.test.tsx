import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ChartViewer } from 'src/components/Tab2/ChartViewer';

describe('ChartViewer with comments', () => {
  const now = new Date();
  const start = new Date(now.getTime() - 60 * 60 * 1000);
  const end = new Date(now.getTime() + 60 * 60 * 1000);

  const pt = (t: Date, v: number) => ({ t, v });

  it('renders comment markers and add action', () => {
    const comments = [
      {
        id: 'c1',
        content: 'hello world',
        authorUid: 'u', authorDisplayName: 'A', authorPhotoURL: null,
        metadata: {
          station: { id: 'S1', name: 'Station' },
          timeRange: { startTime: start.toISOString(), endTime: new Date(start.getTime()+300000).toISOString(), eventType: 'normal-tide' },
          dataContext: ['observed'],
        },
        createdAt: { seconds: 0 } as any,
        updatedAt: { seconds: 0 } as any,
        isEdited: false, editHistory: [], isDeleted: false,
      },
    ];
    const onTimePointSelect = vi.fn();
    
    const { container } = render(
      <ChartViewer
        locationId="L1"
        observedPoints={[pt(start, 0), pt(now, 1)]}
        predictedPoints={[pt(start, 0.1), pt(end, 0.2)]}
        adjustedPoints={[pt(now, 1.1), pt(end, 1.2)]}
        deltaPoints={[]}
        surgeForecastPoints={[]}
        domainStart={start}
        domainEnd={end}
        now={now}
        thresholds={{ minor: 2, moderate: 3, major: 4, extreme: 5 }}
        showDelta={false}
        timezone={'local'}
        config={{} as any}
        showComments={true}
        comments={comments as any}
        onToggleComments={() => {}}
        onTimePointSelect={onTimePointSelect}
      />
    );
    
    // Check for the new Add Comment button which replaced the legacy controls
    const addButton = screen.getByText(/Add Comment/i);
    expect(addButton).toBeInTheDocument();
    
    // Verify legacy toggle controls are absent (was 'Show Comments' or similar)
    expect(screen.queryByText(/Show Community Insights/i)).not.toBeInTheDocument();
    
    // Check that markers are rendered in the SVG
    const markers = container.querySelectorAll('.comment-marker');
    expect(markers.length).toBeGreaterThan(0);

    // Test button click
    addButton.click();
    expect(onTimePointSelect).toHaveBeenCalled();
  });

  it('hides comment markers when showComments is false', () => {
    const comments = [
      {
        id: 'c1',
        content: 'hello world',
        authorUid: 'u', authorDisplayName: 'A', authorPhotoURL: null,
        metadata: {
          station: { id: 'S1', name: 'Station' },
          timeRange: { startTime: start.toISOString(), endTime: new Date(start.getTime()+300000).toISOString(), eventType: 'normal-tide' },
          dataContext: ['observed'],
        },
        createdAt: { seconds: 0 } as any,
        updatedAt: { seconds: 0 } as any,
        isEdited: false, editHistory: [], isDeleted: false,
      },
    ];
    
    const { container } = render(
      <ChartViewer
        locationId="L1"
        observedPoints={[pt(start, 0), pt(now, 1)]}
        predictedPoints={[pt(start, 0.1), pt(end, 0.2)]}
        adjustedPoints={[pt(now, 1.1), pt(end, 1.2)]}
        deltaPoints={[]}
        surgeForecastPoints={[]}
        domainStart={start}
        domainEnd={end}
        now={now}
        thresholds={{ minor: 2, moderate: 3, major: 4, extreme: 5 }}
        showDelta={false}
        timezone={'local'}
        config={{} as any}
        showComments={false}
        comments={comments as any}
        onToggleComments={() => {}}
        onTimePointSelect={() => {}}
      />
    );
    
    const markers = container.querySelectorAll('.comment-marker');
    expect(markers.length).toBe(0);
  });
});



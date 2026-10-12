import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ChartViewer } from 'src/components/Tab2/ChartViewer';

describe('ChartViewer with comments', () => {
  const now = new Date('2026-10-10T10:00:00Z');
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
        timeRange={{ mode: 'relative', lookbackH: 1, lookaheadH: 1 }}
        config={{} as any}
        showComments={true}
        comments={comments as any}
        onToggleComments={() => {}}
        onTimePointSelect={onTimePointSelect}
      />
    );
    
    const addButton = screen.getByLabelText('Add comment at current chart time');
    expect(addButton).toBeInTheDocument();
    // Keep the action out of the plot so it cannot cover wind and rain values.
    const toolbar = screen.getByRole('toolbar', { name: 'Chart comments' });
    expect(toolbar).toContainElement(addButton);
    expect(toolbar.closest('svg')).toBeNull();
    expect(toolbar.closest('.chart-plot')).toBeNull();
    expect(container.querySelector('svg')).not.toContainElement(addButton);
    
    // Verify legacy toggle controls are absent (was 'Show Comments' or similar)
    expect(screen.queryByText(/Show Community Insights/i)).not.toBeInTheDocument();
    
    // Check that markers are rendered in the SVG
    const markers = container.querySelectorAll('.comment-marker');
    expect(markers.length).toBeGreaterThan(0);

    // Test button click
    fireEvent.click(addButton);
    expect(onTimePointSelect).toHaveBeenCalledTimes(1);
    expect(onTimePointSelect).toHaveBeenCalledWith(now, 1);
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

  it('comments on the selected playhead time after panning instead of changing to live time', () => {
    const onTimePointSelect = vi.fn();
    const laterStart = new Date(+now + 90 * 60_000);
    const selectedTime = new Date(+now + 150 * 60_000);
    const laterEnd = new Date(+now + 210 * 60_000);
    const props = {
      locationId: 'L1',
      observedPoints: [pt(start, 0), pt(now, 1)],
      predictedPoints: [pt(start, 0.1), pt(selectedTime, 0.8)],
      adjustedPoints: [pt(now, 1.1), pt(selectedTime, 1.8), pt(laterEnd, 1.6)],
      deltaPoints: [],
      domainStart: start,
      domainEnd: end,
      now,
      thresholds: { minor: 2, moderate: 3, major: 4, extreme: 5 },
      showDelta: false,
      timezone: 'local' as const,
      timeRange: { mode: 'relative' as const, lookbackH: 1, lookaheadH: 1 },
      onTimePointSelect,
    };
    const { rerender, container } = render(<ChartViewer {...props} />);
    rerender(<ChartViewer {...props} viewportRequest={{ start: laterStart, end: laterEnd, id: 1 }} />);
    fireEvent.click(screen.getByLabelText('Add comment at current chart time'));
    expect(onTimePointSelect).toHaveBeenCalledTimes(1);
    expect(onTimePointSelect).toHaveBeenCalledWith(selectedTime, 1.8);
    expect(container.querySelector('svg')).toHaveAttribute('data-domain-start', laterStart.toISOString());
    expect(container.querySelector('svg')).toHaveAttribute('data-domain-end', laterEnd.toISOString());
  });

  it('lets residents add a comment when a water level is unavailable', () => {
    const onTimePointSelect = vi.fn();
    render(<ChartViewer locationId="L1" observedPoints={[]} predictedPoints={[]} adjustedPoints={[]} deltaPoints={[]}
      domainStart={start} domainEnd={end} now={now} thresholds={{ minor: 2, moderate: 3, major: 4, extreme: 5 }}
      showDelta={false} timezone="local" timeRange={{ mode: 'relative', lookbackH: 1, lookaheadH: 1 }}
      onTimePointSelect={onTimePointSelect} />);
    fireEvent.click(screen.getByLabelText('Add comment at current chart time'));
    expect(onTimePointSelect).toHaveBeenCalledTimes(1);
    expect(onTimePointSelect).toHaveBeenCalledWith(now, undefined);
  });

  it('does not reserve a comments toolbar when comment creation is unavailable', () => {
    render(<ChartViewer locationId="L1" observedPoints={[]} predictedPoints={[]} adjustedPoints={[]} deltaPoints={[]}
      domainStart={start} domainEnd={end} now={now} thresholds={{ minor: 2, moderate: 3, major: 4, extreme: 5 }}
      showDelta={false} timezone="local" />);
    expect(screen.queryByLabelText('Add comment at current chart time')).not.toBeInTheDocument();
    expect(screen.queryByRole('toolbar', { name: 'Chart comments' })).not.toBeInTheDocument();
  });

  it('supports adding a comment from the focused plot without intercepting browser shortcuts', () => {
    const onTimePointSelect = vi.fn();
    const { container } = render(<ChartViewer locationId="L1" observedPoints={[pt(start, 0), pt(now, 1)]}
      predictedPoints={[]} adjustedPoints={[]} deltaPoints={[]} domainStart={start} domainEnd={end} now={now}
      thresholds={{ minor: 2, moderate: 3, major: 4, extreme: 5 }} showDelta={false} timezone="local"
      timeRange={{ mode: 'relative', lookbackH: 1, lookaheadH: 1 }} onTimePointSelect={onTimePointSelect} />);
    const plot = container.querySelector('.chart-plot')!;
    fireEvent.keyDown(plot, { key: 'n' });
    expect(onTimePointSelect).toHaveBeenCalledWith(now, 1);
    onTimePointSelect.mockClear();
    fireEvent.keyDown(plot, { key: 'n', ctrlKey: true });
    fireEvent.keyDown(plot, { key: 'n', metaKey: true });
    expect(onTimePointSelect).not.toHaveBeenCalled();
  });
});



import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ChartViewer } from 'src/components/Tab2/ChartViewer';

describe('ChartViewer with comments', () => {
  const now = new Date();
  const start = new Date(now.getTime() - 60 * 60 * 1000);
  const end = new Date(now.getTime() + 60 * 60 * 1000);

  const pt = (t: Date, v: number) => ({ t, v });

  it('renders comment markers and controls', () => {
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
    render(
      <ChartViewer
        observedPoints={[pt(start, 0), pt(now, 1)]}
        predictedPoints={[pt(start, 0.1), pt(end, 0.2)]}
        adjustedPoints={[pt(now, 1.1), pt(end, 1.2)]}
        deltaPoints={[]}
        surgeForecastPoints={[]}
        domainStart={start}
        domainEnd={end}
        now={now}
        threshold={2}
        showDelta={false}
        timezone={'local'}
        config={{} as any}
        showComments={true}
        comments={comments as any}
        onToggleComments={() => {}}
        onToggleCreationMode={() => {}}
        commentCreationMode={false}
      />
    );
    expect(screen.getByRole('group', { name: /Comment overlay controls/i })).toBeInTheDocument();
  });
});


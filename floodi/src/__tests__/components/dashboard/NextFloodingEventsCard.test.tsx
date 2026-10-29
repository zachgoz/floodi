import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { NextFloodingEventsCard } from 'src/components/dashboard/NextFloodingEventsCard';

vi.mock('@ionic/react', async () => {
  const actual = await vi.importActual<typeof import('@ionic/react')>('@ionic/react');
  return {
    ...actual,
    IonModal: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) => isOpen ? <div role="dialog">{children}</div> : null,
  };
});

vi.mock('src/components/dashboard/HydrologicalInsightContent', () => ({
  HydrologicalInsightContent: ({ floodStartTime, floodEndTime, maxWaterLevel, windSpeed, precipitationAccumulation }: {
    floodStartTime: Date; floodEndTime: Date; maxWaterLevel: number; windSpeed: number | null; precipitationAccumulation: number | null;
  }) => <div data-testid="event-details" data-start={floodStartTime.toISOString()}
    data-end={floodEndTime.toISOString()} data-peak={maxWaterLevel} data-wind={String(windSpeed)} data-rain={String(precipitationAccumulation)} />,
}));

const now = new Date('2026-10-10T10:00:00Z');
const points = Array.from({ length: 13 }, (_, index) => ({
  t: new Date(+now + index * 6 * 60_000),
  v: index % 3 === 1 ? 6 : 4,
}));
const props = {
  adjustedPoints: points,
  predictedPoints: [], windPoints: [], precipPoints: [],
  thresholds: { minor: 5, moderate: 7, major: 8, extreme: 9 },
  now, onTimeChange: vi.fn(),
};

describe('compact next flooding events', () => {
  it('shows two events initially and expands or collapses the remaining events', () => {
    const { container } = render(<NextFloodingEventsCard {...props} />);
    expect(container.querySelectorAll('.next-flood-item')).toHaveLength(2);
    fireEvent.click(screen.getByText('View 2 more'));
    expect(container.querySelectorAll('.next-flood-item')).toHaveLength(4);
    fireEvent.click(screen.getByText('Show fewer'));
    expect(container.querySelectorAll('.next-flood-item')).toHaveLength(2);
  });

  it('opens the actual threshold window and peak when the compact event row is tapped', () => {
    const { container } = render(<NextFloodingEventsCard {...props} />);
    const row = container.querySelector('.next-flood-item') as HTMLElement;
    expect(within(row).getByText('6:03 AM – 6:09 AM')).toBeInTheDocument();
    expect(within(row).getByText('Minor')).toBeInTheDocument();
    expect(within(row).getByText('Peak Water Level')).toBeInTheDocument();
    expect(within(row).getByText('Max Street Flooding')).toBeInTheDocument();
    fireEvent.click(row);
    const details = within(screen.getByRole('dialog')).getByTestId('event-details');
    expect(details).toHaveAttribute('data-start', '2026-10-10T10:03:00.000Z');
    expect(details).toHaveAttribute('data-end', '2026-10-10T10:09:00.000Z');
    expect(details).toHaveAttribute('data-peak', '6');
    expect(details).toHaveAttribute('data-wind', 'null');
    expect(details).toHaveAttribute('data-rain', 'null');
  });

  it('shows the estimate beside each depth and keeps longer calibration detail in the disclosure', () => {
    const { container } = render(<NextFloodingEventsCard {...props} />);
    expect(screen.getAllByLabelText('Estimated')).toHaveLength(2);
    expect(screen.getAllByText('Estimated')).toHaveLength(2);
    const info = container.querySelector('.chart-info')!;
    expect(info).not.toHaveAttribute('open');
    expect(within(info as HTMLElement).getByText(/Street elevations have not been calibrated/)).toBeInTheDocument();
    for (const row of container.querySelectorAll('.next-flood-item')) {
      expect(within(row as HTMLElement).queryByText(/Street elevations have not been calibrated/)).not.toBeInTheDocument();
    }
  });

  it('marks only events at or after the historical-pattern tail as planning outlooks', () => {
    const { container } = render(<NextFloodingEventsCard {...props} planningOutlookStart={new Date(+now + 20 * 60_000)} />);
    const rows = container.querySelectorAll('.next-flood-item');
    expect(within(rows[0] as HTMLElement).queryByText('Planning outlook')).not.toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('Planning outlook')).toBeInTheDocument();
    fireEvent.click(rows[0]);
    expect(screen.getByLabelText('Close flood insight')).toBeInTheDocument();
  });
});

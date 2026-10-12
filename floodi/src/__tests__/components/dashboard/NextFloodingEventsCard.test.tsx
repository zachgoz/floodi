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
  HydrologicalInsightContent: ({ floodStartTime, floodEndTime, maxWaterLevel }: {
    floodStartTime: Date; floodEndTime: Date; maxWaterLevel: number;
  }) => <div data-testid="event-details" data-start={floodStartTime.toISOString()}
    data-end={floodEndTime.toISOString()} data-peak={maxWaterLevel} />,
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
  });

  it('preserves the estimate disclosure without placing explanatory text in the event rows', () => {
    const { container } = render(<NextFloodingEventsCard {...props} />);
    expect(screen.getAllByLabelText('Estimated')).toHaveLength(2);
    const info = container.querySelector('.chart-info')!;
    expect(info).not.toHaveAttribute('open');
    expect(within(info as HTMLElement).getByText(/Street elevations have not been calibrated/)).toBeInTheDocument();
    for (const row of container.querySelectorAll('.next-flood-item')) {
      expect(within(row as HTMLElement).queryByText(/Street elevations have not been calibrated/)).not.toBeInTheDocument();
    }
  });
});

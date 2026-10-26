import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartViewer } from 'src/components/Tab2/ChartViewer';

const start = new Date('2026-10-11T00:00:00Z');
const hour = (value: number) => new Date(+start + value * 3_600_000);
const props = {
  locationId: 'carolina-beach', domainStart: start, domainEnd: hour(24), now: hour(12),
  observedPoints: [{ t: start, v: 4 }], predictedPoints: [{ t: start, v: 4 }, { t: hour(24), v: 4 }], adjustedPoints: [], deltaPoints: [],
  thresholds: { minor: 5.6, moderate: 7, major: 7.7, extreme: 8.5 }, showDelta: false, timezone: 'local' as const,
  windPoints: [{ t: hour(1), speed: 12, dir: 45 }], precipPoints: [{ t: hour(2), value: 0.01 }],
};
afterEach(cleanup);

describe('weather on the shared chart viewport', () => {
  it('links weather rows to external surge/tide zoom requests', () => {
    const { rerender } = render(<ChartViewer {...props} />);
    const water = screen.getByRole('img', { name: 'Water level chart showing observed, predicted, and adjusted predictions over time' });
    expect(screen.getByTestId('weather-timeline')).toHaveAttribute('data-domain-start', water.getAttribute('data-domain-start'));
    expect(screen.getByTestId('weather-timeline')).toHaveAttribute('data-domain-end', water.getAttribute('data-domain-end'));
    rerender(<ChartViewer {...props} viewportRequest={{ id: 1, start: hour(1), end: hour(7) }} />);
    expect(screen.getByTestId('weather-timeline')).toHaveAttribute('data-domain-start', hour(1).toISOString());
    expect(screen.getByTestId('weather-timeline')).toHaveAttribute('data-domain-end', hour(7).toISOString());
    expect(water).toHaveAttribute('data-domain-end', hour(7).toISOString());
    expect(screen.queryByText('PRECIP / WIND')).not.toBeInTheDocument();
  });

  it('opens readable hourly values outside the plot without changing the shared zoom', () => {
    const onViewportChange = vi.fn();
    const { container } = render(<ChartViewer {...props} now={start} onViewportChange={onViewportChange}
      windPoints={[{ t: start, speed: 8, dir: 0 }, { t: hour(1), speed: 24, dir: 90 }]} />);
    const water = container.querySelector('.chart-plot svg')!;
    const startBefore = water.getAttribute('data-domain-start');
    const endBefore = water.getAttribute('data-domain-end');
    onViewportChange.mockClear();
    expect(screen.queryByTestId('hourly-weather')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hourly' }));
    const detail = screen.getByTestId('hourly-weather');
    expect(detail.closest('.chart-plot')).toBeNull();
    expect(detail).toHaveAttribute('data-domain-start', startBefore);
    expect(detail).toHaveAttribute('data-domain-end', endBefore);
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('24')).toBeInTheDocument();
    expect(water).toHaveAttribute('data-domain-start', startBefore);
    expect(water).toHaveAttribute('data-domain-end', endBefore);
    expect(onViewportChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Auto' }));
    expect(screen.queryByTestId('hourly-weather')).not.toBeInTheDocument();
    expect(water).toHaveAttribute('data-domain-end', endBefore);
  });

  it('keeps hourly detail on the synchronized tide/surge viewport after a pan request', () => {
    const { rerender, container } = render(<ChartViewer {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hourly' }));
    rerender(<ChartViewer {...props} viewportRequest={{ id: 1, start: hour(1), end: hour(7) }} />);
    const detail = screen.getByTestId('hourly-weather');
    const water = container.querySelector('.chart-plot svg')!;
    expect(detail).toHaveAttribute('data-domain-start', hour(1).toISOString());
    expect(detail).toHaveAttribute('data-domain-end', hour(7).toISOString());
    expect(water).toHaveAttribute('data-domain-start', hour(1).toISOString());
    expect(water).toHaveAttribute('data-domain-end', hour(7).toISOString());
    expect(screen.getByRole('button', { name: 'Hourly' })).toHaveAttribute('aria-pressed', 'true');
  });
});

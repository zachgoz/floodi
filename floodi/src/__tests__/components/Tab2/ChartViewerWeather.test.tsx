import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
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
    const water = screen.getByRole('img');
    expect(screen.getByTestId('weather-timeline')).toHaveAttribute('data-domain-start', water.getAttribute('data-domain-start'));
    expect(screen.getByTestId('weather-timeline')).toHaveAttribute('data-domain-end', water.getAttribute('data-domain-end'));
    rerender(<ChartViewer {...props} viewportRequest={{ id: 1, start: hour(1), end: hour(7) }} />);
    expect(screen.getByTestId('weather-timeline')).toHaveAttribute('data-domain-start', hour(1).toISOString());
    expect(screen.getByTestId('weather-timeline')).toHaveAttribute('data-domain-end', hour(7).toISOString());
    expect(water).toHaveAttribute('data-domain-end', hour(7).toISOString());
    expect(screen.queryByText('PRECIP / WIND')).not.toBeInTheDocument();
  });
});

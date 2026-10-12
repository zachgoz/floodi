import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AtmosphereMetrics } from 'src/components/dashboard/MetricPills';

describe('wind readout', () => {
  it('keeps a known speed without inventing a direction', () => {
    const { container } = render(<AtmosphereMetrics windSpeed={12} windDirection={Number.NaN} precipitationAccumulation={0} />);
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByLabelText('Wind direction unavailable')).toBeInTheDocument();
    expect(container.querySelector('.wind-arrow-svg')).toBeNull();
    expect(screen.queryByText('N')).not.toBeInTheDocument();
  });

  it('retains a real northerly bearing and its arrow', () => {
    const { container } = render(<AtmosphereMetrics windSpeed={12} windDirection={0} precipitationAccumulation={0} />);
    expect(screen.getByText('N')).toBeInTheDocument();
    expect(container.querySelector('.wind-arrow-svg g')).toHaveAttribute('transform', 'rotate(180)');
  });
});

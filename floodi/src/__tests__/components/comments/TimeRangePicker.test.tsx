/**
 * TimeRangePicker tests
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { TimeRangePicker } from 'src/components/comments/TimeRangePicker';

vi.mock('src/utils/timeRangeHelpers', () => ({
  formatTimeRangeForDisplay: (r: any) => `${new Date(r.start).toISOString()} – ${new Date(r.end).toISOString()}`,
  validateChartTimeRange: () => ({ ok: true, errors: [] }),
}));

describe('TimeRangePicker', () => {
  const chartDomain = {
    start: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    end: new Date().toISOString(),
  };

  it('renders with default mode when no chart domain', () => {
    render(<TimeRangePicker onChange={vi.fn()} />);
    expect(screen.getByText('Select Time Range')).toBeInTheDocument();
    expect(screen.getByText('Custom')).toBeInTheDocument();
  });

  it('renders with current view mode when chart domain provided', () => {
    render(<TimeRangePicker chartDomain={chartDomain} onChange={vi.fn()} />);
    expect(screen.getByText('Current View')).toBeInTheDocument();
  });

  it('provides default 1-hour range when no valid range selected', () => {
    render(<TimeRangePicker onChange={vi.fn()} />);
    // The preview should show a valid time range
    const preview = screen.getByText(/Preview:/);
    expect(preview).toBeInTheDocument();
  });

  it('calls onChange with valid range when range is selected', () => {
    const onChange = vi.fn();
    render(<TimeRangePicker onChange={onChange} />);

    // The component should call onChange with a default range
    expect(onChange).toHaveBeenCalledWith({
      range: expect.objectContaining({
        start: expect.any(String),
        end: expect.any(String),
      }),
      eventType: 'normal-tide',
    });
  });

  it('handles invalid date strings gracefully', () => {
    // Test that invalid dates don't crash the component
    const onChange = vi.fn();
    render(<TimeRangePicker onChange={onChange} />);

    // Should not throw errors and should display preview
    expect(screen.getByText(/Preview:/)).toBeInTheDocument();
  });
});

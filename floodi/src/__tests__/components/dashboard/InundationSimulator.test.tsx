import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi } from 'vitest';
import { InundationSimulator } from 'src/components/dashboard/InundationSimulator';
import { trackSimulationLevel } from 'src/lib/analytics';

// Mock the tracking utility
vi.mock('src/lib/analytics', () => ({
  trackSimulationLevel: vi.fn(),
  trackEvent: vi.fn(),
  trackScreenView: vi.fn(),
}));

describe('InundationSimulator debounced tracking', () => {
  const defaultProps = {
    waterLevelFt: 2.5,
    minLevelFt: 0.0,
    maxLevelFt: 10.0,
    onLevelChange: vi.fn(),
    thresholds: {
      minor: 5.6,
      moderate: 7.0,
      major: 7.7,
      extreme: 8.5,
    },
    locationId: 'carolina-beach',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders correctly with default water level readout', () => {
    render(<InundationSimulator {...defaultProps} />);
    expect(screen.getByText('2.50 ft')).toBeInTheDocument();
  });

  it('debounces the simulation adjust tracking events during slider change', () => {
    const onLevelChange = vi.fn();
    render(<InundationSimulator {...defaultProps} onLevelChange={onLevelChange} />);

    const slider = screen.getByLabelText(/Adjust flood simulation water level/i);

    // Simulate slider dragging: multiple changes in rapid succession
    fireEvent.change(slider, { target: { value: '3.0' } });
    fireEvent.change(slider, { target: { value: '3.5' } });
    fireEvent.change(slider, { target: { value: '4.0' } });

    // Level change prop callback should fire immediately for smooth visual feedback
    expect(onLevelChange).toHaveBeenCalledTimes(3);

    // Analytics should NOT have been called yet because we are debouncing
    expect(trackSimulationLevel).not.toHaveBeenCalled();

    // Advance timer by 500ms (less than debounce threshold)
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(trackSimulationLevel).not.toHaveBeenCalled();

    // Advance timer by another 500ms to hit the 1-second threshold
    act(() => {
      vi.advanceTimersByTime(500);
    });

    // Analytics should be called exactly once with the final value
    expect(trackSimulationLevel).toHaveBeenCalledTimes(1);
    expect(trackSimulationLevel).toHaveBeenCalledWith('8658163', 4.0);
  });
});

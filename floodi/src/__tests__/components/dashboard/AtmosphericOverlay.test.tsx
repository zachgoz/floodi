import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AtmosphericOverlay } from 'src/components/dashboard/AtmosphericOverlay';
import type { FloodEvent } from 'src/types/data';

vi.mock('@ionic/react', async () => {
  const actual = await vi.importActual<typeof import('@ionic/react')>('@ionic/react');
  return {
    ...actual,
    IonModal: ({ isOpen, children }: { isOpen?: boolean; children?: React.ReactNode }) =>
      isOpen ? <div role="dialog">{children}</div> : null,
  };
});

const now = new Date('2026-11-24T15:00:00Z');
const thresholds = { minor: 5.6, moderate: 7.0, major: 7.7, extreme: 8.5 };

const pastFloodEvents: FloodEvent[] = [
  {
    startTime: '2026-10-15T12:00:00Z',
    endTime: '2026-10-15T15:00:00Z',
    peakTime: '2026-10-15T13:30:00Z',
    peakValue: 6.82,
    thresholdType: 'minor',
    thresholdValue: 5.6,
    source: 'fiman',
  },
  {
    startTime: '2026-09-20T10:00:00Z',
    endTime: '2026-09-20T12:30:00Z',
    peakTime: '2026-09-20T11:15:00Z',
    peakValue: 6.79,
    thresholdType: 'minor',
    thresholdValue: 5.6,
    source: 'fiman',
  },
];

describe('AtmosphericOverlay decluttered readout & tappable past events', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('uses native buttons for readout triggers, displays surge inline, and hides past-similar chip when below elevated stage', () => {
    const onJumpToTime = vi.fn();
    render(
      <AtmosphericOverlay
        observedWaterLevel={3.85}
        surge={0.42}
        windSpeed={11}
        windDirection={45}
        precipitationAccumulation={0}
        thresholds={thresholds}
        floodEvents={pastFloodEvents}
        now={now}
        onJumpToTime={onJumpToTime}
        nextTideInfo={{
          type: 'high',
          time: new Date('2026-11-24T18:00:00Z'),
          value: 5.1,
          minutesRemaining: 180,
          heightDelta: 1.25,
        }}
      />,
    );

    const wlButton = screen.getByRole('button', { name: 'View water level and flood insight details' });
    expect(wlButton.tagName).toBe('BUTTON');
    expect(wlButton).toHaveTextContent('3.85');
    expect(wlButton).toHaveTextContent('+0.42 ft surge');

    // Next-tide badge lives in the HydrographChart date header now, not duplicated inside AtmosphericOverlay
    expect(screen.queryByRole('button', { name: 'Next high tide details' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Jump to similar past/i })).toBeNull();
  });

  it('handles degenerate NaN/null weather and empty flood events without crashing or showing fake values', () => {
    render(
      <AtmosphericOverlay
        observedWaterLevel={6.80}
        surge={Number.NaN}
        windSpeed={null}
        windDirection={null}
        precipitationAccumulation={null}
        thresholds={thresholds}
        floodEvents={[]}
        now={now}
        onJumpToTime={vi.fn()}
      />,
    );

    expect(screen.getByText('6.80')).toBeInTheDocument();
    expect(screen.queryByText(/ft surge/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Jump to similar past tide/i })).toBeNull();
  });

  it('renders a stationary tappable past-similar chip above the chart and jumps directly to the matching historical peak', () => {
    const onJumpToTime = vi.fn();
    render(
      <AtmosphericOverlay
        observedWaterLevel={6.80}
        surge={1.15}
        windSpeed={22}
        windDirection={35}
        precipitationAccumulation={0.45}
        statusLabel="Predicted"
        isLive={false}
        targetTime={new Date('2026-11-25T12:45:00Z')}
        thresholds={thresholds}
        floodEvents={pastFloodEvents}
        now={now}
        onJumpToTime={onJumpToTime}
      />,
    );

    // Sun, Sep 20 (6.79 ft) is closer to 6.80 ft than Thu, Oct 15 (6.82 ft)
    const pastChip = screen.getByRole('button', { name: /Jump to similar past flood on Sun, Sep 20 at 6\.79 feet/i });
    expect(pastChip.tagName).toBe('BUTTON');
    expect(pastChip).toHaveTextContent('Past similar: Sun, Sep 20 (6.79 ft)');

    fireEvent.click(pastChip);
    expect(onJumpToTime).toHaveBeenCalledTimes(1);
    expect(onJumpToTime.mock.calls[0][0]).toEqual(new Date('2026-09-20T11:15:00Z'));
  });

  it('shows Closest past flood with weekday and exact inch delta when forecast exceeds recorded peaks', () => {
    const onJumpToTime = vi.fn();
    render(
      <AtmosphericOverlay
        observedWaterLevel={7.24}
        surge={1.45}
        windSpeed={28}
        windDirection={35}
        precipitationAccumulation={0.78}
        statusLabel="Predicted"
        isLive={false}
        targetTime={new Date('2026-11-25T12:45:00Z')}
        thresholds={thresholds}
        floodEvents={pastFloodEvents}
        now={now}
        onJumpToTime={onJumpToTime}
      />,
    );

    const closestChip = screen.getByRole('button', { name: /Jump to closest past flood on Thu, Oct 15 at 6\.82 feet/i });
    expect(closestChip).toHaveTextContent('Closest past flood: Thu, Oct 15 (6.82 ft, 5" lower)');
    fireEvent.click(closestChip);
    expect(onJumpToTime).toHaveBeenCalledWith(new Date('2026-10-15T13:30:00Z'));
  });

  it('exposes all matching similar past events inside the Flood Insight modal when opened', () => {
    const onJumpToTime = vi.fn();
    const onShowWLInfoChange = vi.fn();
    render(
      <AtmosphericOverlay
        observedWaterLevel={6.80}
        surge={1.15}
        windSpeed={22}
        windDirection={35}
        precipitationAccumulation={0.45}
        statusLabel="Predicted"
        isLive={false}
        targetTime={new Date('2026-11-25T12:45:00Z')}
        thresholds={thresholds}
        floodEvents={pastFloodEvents}
        now={now}
        onJumpToTime={onJumpToTime}
        showWLInfo={true}
        onShowWLInfoChange={onShowWLInfoChange}
      />,
    );

    expect(screen.getByText('View Similar Past Events')).toBeInTheDocument();
    const octBtn = screen.getByText(/Oct 15.*6\.82'/i);
    fireEvent.click(octBtn);

    expect(onJumpToTime).toHaveBeenCalledTimes(1);
    expect(onJumpToTime.mock.calls[0][0]).toEqual(new Date('2026-10-15T13:30:00Z'));
    expect(onShowWLInfoChange).toHaveBeenCalledWith(false);
  });
});

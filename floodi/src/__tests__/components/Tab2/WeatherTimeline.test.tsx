import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WeatherTimeline } from 'src/components/Tab2/WeatherTimeline';

function pointer(target: Element, type: string, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  fireEvent(target, event);
}

const start = new Date('2026-10-11T00:00:00Z');
const hour = (value: number) => new Date(+start + value * 3_600_000);
const props = { start, end: hour(24), now: hour(12), x: 50, y: 200, width: 240, timezone: 'local' as const,
  windPoints: Array.from({ length: 24 }, (_, index) => ({ t: hour(index), speed: 12, dir: 45 })),
  precipPoints: Array.from({ length: 24 }, (_, index) => ({ t: hour(index + 1), value: 0.01 })),
};
afterEach(cleanup);

describe('legible weather rows', () => {
  it('shows numeric wind, compass-from direction and rain totals with units on mobile', () => {
    render(<svg><WeatherTimeline {...props} /></svg>);
    expect(screen.getByText('Wind')).toBeInTheDocument();
    expect(screen.getByText('Rain')).toBeInTheDocument();
    expect(screen.getAllByText('12 mph')).toHaveLength(3);
    expect(screen.getAllByText('NE')).toHaveLength(3);
    expect(screen.getAllByText('0.08 in')).toHaveLength(3);
    expect(screen.getByText('8h')).toBeInTheDocument();
    expect(screen.getAllByRole('button')[0].getAttribute('aria-label')).toContain('from NE');
  });

  it('shares the water viewport and adjusts aggregation when the user zooms', () => {
    const { rerender } = render(<svg><WeatherTimeline {...props} /></svg>);
    expect(screen.getByTestId('weather-timeline')).toHaveAttribute('data-domain-end', hour(24).toISOString());
    rerender(<svg><WeatherTimeline {...props} end={hour(6)} /></svg>);
    expect(screen.getByTestId('weather-timeline')).toHaveAttribute('data-domain-end', hour(6).toISOString());
    expect(screen.getByText('2h')).toBeInTheDocument();
    expect(screen.getAllByText('0.02 in')).toHaveLength(3);
  });

  it('provides tap and keyboard detail reading without adding permanent annotation', () => {
    render(<svg><WeatherTimeline {...props} /></svg>);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(within(screen.getByRole('status')).getByText('Wind avg: 12.0 mph · NE')).toBeInTheDocument();
    expect(within(screen.getByRole('status')).getByText('Rain: 0.08 in')).toBeInTheDocument();
    fireEvent.keyDown(screen.getAllByRole('button')[0], { key: 'Escape' });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getAllByRole('button')[1], { key: 'Enter' });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('opens a pointer tap but suppresses a drag click, including movement that returns to its origin', () => {
    render(<svg><WeatherTimeline {...props} /></svg>);
    const button = screen.getAllByRole('button')[0];
    pointer(button, 'pointerdown', 30, 250);
    pointer(button, 'pointerup', 33, 251);
    fireEvent.click(button, { detail: 1 });
    expect(screen.getByRole('status')).toBeInTheDocument();
    fireEvent.keyDown(button, { key: 'Escape' });
    pointer(button, 'pointerdown', 30, 250);
    pointer(button, 'pointermove', 40, 250);
    pointer(button, 'pointerup', 30, 250);
    fireEvent.click(button, { detail: 1 });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    pointer(button, 'pointerdown', 30, 250);
    pointer(button, 'pointerup', 36, 250);
    fireEvent.click(button, { detail: 1 });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('suppresses canceled touch clicks and still supports the next tap or keyboard activation', () => {
    render(<svg><WeatherTimeline {...props} /></svg>);
    const button = screen.getAllByRole('button')[0];
    pointer(button, 'pointerdown', 30, 250);
    pointer(button, 'pointercancel', 30, 250);
    fireEvent.click(button, { detail: 1 });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    pointer(button, 'pointerdown', 30, 250);
    pointer(button, 'pointerup', 30, 250);
    fireEvent.click(button, { detail: 1 });
    expect(screen.getByRole('status')).toBeInTheDocument();
    fireEvent.keyDown(button, { key: 'Escape' });
    pointer(button, 'pointerdown', 30, 250);
    pointer(button, 'pointercancel', 30, 250);
    fireEvent.keyDown(button, { key: ' ' });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows unavailable data as dashes, and distinguishes partial rain from a complete dry interval', () => {
    const { rerender } = render(<svg><WeatherTimeline {...props} windPoints={[]} precipPoints={[]} /></svg>);
    expect(screen.queryByText('0 mph')).not.toBeInTheDocument();
    expect(screen.queryByText('0.00 in')).not.toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(6);
    rerender(<svg><WeatherTimeline {...props} precipPoints={[{ t: hour(1), value: 0.2 }]} /></svg>);
    expect(screen.getByText('≥0.20 in')).toBeInTheDocument();
    expect(screen.queryByText('0.00 in')).not.toBeInTheDocument();
    rerender(<svg><WeatherTimeline {...props} precipPoints={props.precipPoints.map(point => ({ ...point, value: 0 }))} /></svg>);
    expect(screen.getAllByText('0.00 in')).toHaveLength(3);
  });

  it('preserves unknown wind direction without an invented north arrow', () => {
    const { container } = render(<svg><WeatherTimeline {...props} windPoints={props.windPoints.map(point => ({ ...point, dir: Number.NaN }))} /></svg>);
    expect(screen.getAllByText('12 mph')).toHaveLength(3);
    expect(screen.queryByText('N')).not.toBeInTheDocument();
    expect(container.querySelector('path')).toBeNull();
    expect(container.innerHTML).not.toContain('rotate(NaN)');
  });

  it('labels future weather and handles the New York daylight-saving transition', () => {
    const novStart = new Date('2026-11-01T04:00:00Z');
    render(<svg><WeatherTimeline {...props} start={novStart} end={new Date(+novStart + 8 * 3_600_000)} now={novStart} width={80} /></svg>);
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-label')).toContain('EDT');
    expect(button.getAttribute('aria-label')).toContain('EST');
    expect(button.getAttribute('aria-label')).toContain('Includes forecast weather');
  });
});

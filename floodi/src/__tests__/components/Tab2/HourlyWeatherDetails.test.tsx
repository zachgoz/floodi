import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HourlyWeatherDetails } from 'src/components/Tab2/HourlyWeatherDetails';

const start = new Date('2026-10-11T12:00:00Z');
const hour = (value: number) => new Date(+start + value * 3_600_000);
const props = { start, end: hour(3), now: start, timezone: 'local' as const,
  windPoints: [{ t: start, speed: 8.2, dir: 0 }, { t: hour(1), speed: 24, dir: 90 }, { t: hour(2), speed: 4, dir: 180 }],
  precipPoints: [{ t: hour(1), value: 0.2 }, { t: hour(2), value: 0 }],
};
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('hourly weather detail', () => {
  it('shows real hourly wind and rainfall rather than the overview average', () => {
    render(<HourlyWeatherDetails {...props} />);
    expect(screen.getByText('8.2')).toBeInTheDocument();
    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('0.20')).toBeInTheDocument();
    expect(screen.getByText('0.00')).toBeInTheDocument();
    expect(screen.getByText('mph')).toBeInTheDocument();
    const missingRain = screen.getByRole('group', { name: /10:00 AM EDT.*Rain unavailable/ });
    expect(within(missingRain).getByText('—')).toBeInTheDocument();
    expect(screen.getByTestId('hourly-weather')).toHaveAttribute('data-domain-end', hour(3).toISOString());
  });

  it('reflects the exact shared zoom window without outside data or fabricated rain', () => {
    const { rerender } = render(<HourlyWeatherDetails {...props} />);
    rerender(<HourlyWeatherDetails {...props} start={hour(0.5)} end={hour(1.5)} />);
    expect(screen.getByTestId('hourly-weather')).toHaveAttribute('data-domain-start', hour(0.5).toISOString());
    expect(screen.getByTestId('hourly-weather')).toHaveAttribute('data-domain-end', hour(1.5).toISOString());
    expect(screen.queryByText('8.2')).not.toBeInTheDocument();
    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.queryByText('0.20')).not.toBeInTheDocument();
    expect(screen.getAllByRole('group')).toHaveLength(2);
  });

  it('keeps direction unavailable without an invented north arrow', () => {
    const { container } = render(<HourlyWeatherDetails {...props} end={hour(1)} windPoints={[{ t: start, speed: 12, dir: Number.NaN }]} />);
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.queryByText('N')).not.toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByRole('group')).toHaveAccessibleName(/direction unavailable or variable/);
  });

  it('distinguishes the repeated New York hour at the daylight-saving transition', () => {
    const novStart = new Date('2026-11-01T05:00:00Z');
    const { rerender } = render(<HourlyWeatherDetails {...props} start={novStart} end={new Date(+novStart + 2 * 3_600_000)} now={novStart} windPoints={[]} precipPoints={[]} />);
    expect(screen.getByText('1:00 AM EDT')).toBeInTheDocument();
    expect(screen.getByText('1:00 AM EST')).toBeInTheDocument();
    rerender(<HourlyWeatherDetails {...props} start={novStart} end={new Date(+novStart + 2 * 3_600_000)} now={novStart} timezone="gmt" windPoints={[]} precipPoints={[]} />);
    expect(screen.getByText('5:00 AM')).toBeInTheDocument();
    expect(screen.getByText('6:00 AM')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Hourly weather,/ })).toHaveAccessibleName(/UTC/);
  });

  it('keeps long forecasts small and supports touch-scroll, paging and keyboard navigation', () => {
    const longProps = { ...props, end: hour(24 * 32), windPoints: Array.from({ length: 24 * 32 }, (_, index) => ({ t: hour(index), speed: index, dir: 45 })) };
    render(<HourlyWeatherDetails {...longProps} />);
    expect(screen.getAllByRole('group').length).toBeLessThan(12);
    expect(screen.getByRole('button', { name: 'Earlier weather hours' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Later weather hours' }));
    expect(screen.getByRole('button', { name: 'Earlier weather hours' })).not.toBeDisabled();
    const scroll = screen.getByRole('region', { name: /Hourly weather,/ });
    fireEvent.scroll(scroll, { target: { scrollLeft: 80 * 400 } });
    expect(screen.getByText('400')).toBeInTheDocument();
    expect(screen.getAllByRole('group').length).toBeLessThan(12);
    fireEvent.keyDown(scroll, { key: 'End' });
    expect(screen.getByText('767')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Later weather hours' })).toBeDisabled();
    fireEvent.keyDown(scroll, { key: 'Home' });
    expect(screen.getByRole('button', { name: 'Earlier weather hours' })).toBeDisabled();
  });

  it('starts near the current hour and retains the detail scroll when data updates', () => {
    const { rerender } = render(<HourlyWeatherDetails {...props} end={hour(48)} now={hour(24)} />);
    const scroll = screen.getByRole('region', { name: /Hourly weather,/ });
    expect(scroll.scrollLeft).toBe(23 * 80);
    fireEvent.scroll(scroll, { target: { scrollLeft: 80 * 12 } });
    rerender(<HourlyWeatherDetails {...props} end={hour(48)} now={hour(25)} windPoints={[...props.windPoints]} />);
    expect(scroll.scrollLeft).toBe(80 * 12);
  });

  it('keeps tomorrow visible when the live chart advances by minutes or crosses an hour', () => {
    const { rerender } = render(<HourlyWeatherDetails {...props} end={hour(48)} />);
    const scroll = screen.getByRole('region', { name: /Hourly weather,/ });
    fireEvent.scroll(scroll, { target: { scrollLeft: 80 * 24 } });
    rerender(<HourlyWeatherDetails {...props} start={hour(1 / 60)} end={hour(48 + 1 / 60)} now={hour(1 / 60)} />);
    expect(scroll.scrollLeft).toBe(80 * 24);
    expect(screen.getByRole('group', { name: /^Oct 12, 8:00 AM EDT/ })).toBeInTheDocument();
    rerender(<HourlyWeatherDetails {...props} start={hour(1 + 1 / 60)} end={hour(49 + 1 / 60)} now={hour(1 + 1 / 60)} />);
    expect(scroll.scrollLeft).toBe(80 * 23);
    expect(screen.getByRole('group', { name: /^Oct 12, 8:00 AM EDT/ })).toBeInTheDocument();
  });

  it('preserves the visible absolute hour on overlapping zooms and clamps disjoint ranges', () => {
    const { rerender } = render(<HourlyWeatherDetails {...props} end={hour(48)} />);
    const scroll = screen.getByRole('region', { name: /Hourly weather,/ });
    fireEvent.scroll(scroll, { target: { scrollLeft: 80 * 24 } });
    rerender(<HourlyWeatherDetails {...props} start={hour(20)} end={hour(30)} />);
    expect(scroll.scrollLeft).toBe(80 * 4);
    rerender(<HourlyWeatherDetails {...props} start={hour(20)} end={hour(23)} />);
    expect(scroll.scrollLeft).toBe(0);
    expect(screen.getByRole('button', { name: 'Later weather hours' })).toBeDisabled();
    rerender(<HourlyWeatherDetails {...props} start={hour(72)} end={hour(96)} />);
    expect(scroll.scrollLeft).toBe(0);
    rerender(<HourlyWeatherDetails {...props} start={hour(-48)} end={hour(-24)} />);
    expect(scroll.scrollLeft).toBe(24 * 80 - 320);
    expect(screen.getByRole('button', { name: 'Later weather hours' })).toBeDisabled();
  });

  it('uses the measured viewport width when opening near the final forecast hour', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640);
    render(<HourlyWeatherDetails {...props} end={hour(24)} now={hour(23)} />);
    const scroll = screen.getByRole('region', { name: /Hourly weather,/ });
    expect(scroll.scrollLeft).toBe(24 * 80 - 640);
    expect(screen.getByRole('button', { name: 'Later weather hours' })).toBeDisabled();
    expect(screen.getByRole('group', { name: /Current hour/ })).toBeInTheDocument();
  });

  it('observes a viewport that becomes available later and clamps scrolling when resized wider', () => {
    let callback: ResizeObserverCallback | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(value: ResizeObserverCallback) { callback = value; }
      observe = observe;
      disconnect = disconnect;
    });
    const { rerender, unmount } = render(<HourlyWeatherDetails {...props} end={start} />);
    expect(observe).not.toHaveBeenCalled();
    rerender(<HourlyWeatherDetails {...props} end={hour(24)} now={hour(23)} />);
    expect(observe).toHaveBeenCalledOnce();
    const scroll = screen.getByRole('region', { name: /Hourly weather,/ });
    expect(scroll.scrollLeft).toBe(24 * 80 - 320);
    // Real ResizeObserver callbacks run after layout; resize preserves the
    // inspected time unless the browser must clamp the right edge.
    const entry = { contentRect: { width: 640 } } as ResizeObserverEntry;
    act(() => callback?.([entry], {} as ResizeObserver));
    expect(scroll.scrollLeft).toBe(24 * 80 - 640);
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('handles an invalid or empty time window without invented data', () => {
    const { rerender } = render(<HourlyWeatherDetails {...props} start={new Date('invalid')} />);
    expect(screen.getByText('No weather available in this time window.')).toBeInTheDocument();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    rerender(<HourlyWeatherDetails {...props} end={start} />);
    expect(screen.getByText('No weather available in this time window.')).toBeInTheDocument();
  });
});

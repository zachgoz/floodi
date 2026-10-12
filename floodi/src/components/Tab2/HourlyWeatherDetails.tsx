import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PrecipPoint, WindPoint } from './types';
import { compassDirection, rainLabel, weatherTimeline } from 'src/utils/weatherTimeline';
import './HourlyWeatherDetails.css';

const HOUR = 3_600_000;
const CELL_WIDTH = 80;
const OVERSCAN = 3;

export interface HourlyWeatherDetailsProps {
  windPoints: WindPoint[];
  precipPoints: PrecipPoint[];
  start: Date;
  end: Date;
  now: Date;
  timezone: 'local' | 'gmt';
}

/** Genuine hourly weather within the shared viewport, without compressing labels. */
export function HourlyWeatherDetails({ windPoints, precipPoints, start, end, now, timezone }: HourlyWeatherDetailsProps) {
  const { intervals } = useMemo(() => weatherTimeline(windPoints, precipPoints, start, end, CELL_WIDTH, { intervalHours: 1 }), [windPoints, precipPoints, start, end]);
  const viewport = useRef<HTMLDivElement>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [width, setWidth] = useState(320);
  const startTime = +start;
  const endTime = +end;
  const currentTime = useRef(+now);
  currentTime.current = +now;
  const hasIntervals = intervals.length > 0;
  const trackWidth = useRef(intervals.length * CELL_WIDTH);
  trackWidth.current = intervals.length * CELL_WIDTH;
  const viewportWidth = useRef(320);
  const previousOrigin = useRef<number | null>(null);
  const actualScrollLeft = useRef(0);
  const timeZone = timezone === 'gmt' ? 'UTC' : 'America/New_York';
  const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone });
  const clockFormat = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone });
  const zoneFormat = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short', timeZone });
  const zoneName = (date: Date) => zoneFormat.formatToParts(date).find(part => part.type === 'timeZoneName')?.value ?? '';
  const dateClock = (date: Date) => `${dateFormat.format(date)}, ${clockFormat.format(date)} ${zoneName(date)}`;

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => {
      const nextWidth = entries[0]?.contentRect.width;
      if (nextWidth && Number.isFinite(nextWidth)) {
        viewportWidth.current = nextWidth;
        setWidth(nextWidth);
        element.scrollLeft = Math.min(element.scrollLeft, Math.max(0, trackWidth.current - nextWidth));
        actualScrollLeft.current = element.scrollLeft;
        setScrollLeft(element.scrollLeft);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasIntervals]);

  // Initialize near live once. Subsequent chart pans, zooms and live advances
  // retain the detail strip's visible UTC hour, clamped to the new range. Keep
  // the actual previous scroll in a ref because narrowing the DOM track can
  // make the browser clamp scrollLeft before this effect runs.
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) { previousOrigin.current = null; actualScrollLeft.current = 0; return; }
    const nextOrigin = Math.floor(startTime / HOUR) * HOUR;
    const currentIndex = currentTime.current >= startTime && currentTime.current < endTime ? Math.floor((currentTime.current - Math.floor(startTime / HOUR) * HOUR) / HOUR) : 0;
    const measuredWidth = element.clientWidth || viewportWidth.current;
    viewportWidth.current = measuredWidth;
    setWidth(measuredWidth);
    const requestedLeft = previousOrigin.current === null ? currentIndex * CELL_WIDTH - CELL_WIDTH : actualScrollLeft.current + (previousOrigin.current - nextOrigin) / HOUR * CELL_WIDTH;
    const nextLeft = Math.max(0, Math.min(trackWidth.current - measuredWidth, requestedLeft));
    element.scrollLeft = nextLeft;
    previousOrigin.current = nextOrigin;
    actualScrollLeft.current = element.scrollLeft;
    setScrollLeft(element.scrollLeft);
  }, [startTime, endTime, hasIntervals]);

  const first = Math.max(0, Math.floor(scrollLeft / CELL_WIDTH) - OVERSCAN);
  const last = Math.min(intervals.length, Math.ceil((scrollLeft + width) / CELL_WIDTH) + OVERSCAN);
  const totalWidth = intervals.length * CELL_WIDTH;
  const shift = (direction: number) => {
    const element = viewport.current;
    if (!element) return;
    const nextLeft = Math.max(0, Math.min(Math.max(0, totalWidth - width), element.scrollLeft + direction * Math.max(CELL_WIDTH, width - CELL_WIDTH)));
    element.scrollLeft = nextLeft;
    actualScrollLeft.current = element.scrollLeft;
    setScrollLeft(element.scrollLeft);
  };

  return <section className="hourly-weather" aria-label="Hourly wind and rainfall" data-testid="hourly-weather" data-domain-start={Number.isFinite(startTime) ? start.toISOString() : undefined} data-domain-end={Number.isFinite(endTime) ? end.toISOString() : undefined}>
    <div className="hourly-weather-header">
      <span className="hourly-weather-heading">Hourly weather</span>
      <div className="hourly-weather-navigation">
        <button type="button" aria-label="Earlier weather hours" onClick={() => shift(-1)} disabled={scrollLeft <= 0}><span aria-hidden="true">‹</span></button>
        <button type="button" aria-label="Later weather hours" onClick={() => shift(1)} disabled={scrollLeft + width >= totalWidth}><span aria-hidden="true">›</span></button>
      </div>
    </div>
    {!intervals.length ? <p className="hourly-weather-empty">No weather available in this time window.</p> : <div className="hourly-weather-body">
      <div className="hourly-weather-labels" aria-hidden="true"><span /><span>Wind<br /><small>mph</small></span><span>Rain<br /><small>in</small></span></div>
      <div className="hourly-weather-viewport" ref={viewport} tabIndex={0} role="region" aria-label={`Hourly weather, ${dateClock(start)} to ${dateClock(end)}`} onScroll={event => { actualScrollLeft.current = event.currentTarget.scrollLeft; setScrollLeft(event.currentTarget.scrollLeft); }} onKeyDown={event => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); shift(event.key === 'ArrowLeft' ? -1 : 1); }
        if (event.key === 'Home') { event.preventDefault(); event.currentTarget.scrollLeft = 0; actualScrollLeft.current = event.currentTarget.scrollLeft; setScrollLeft(event.currentTarget.scrollLeft); }
        if (event.key === 'End') { event.preventDefault(); const nextLeft = Math.max(0, totalWidth - width); event.currentTarget.scrollLeft = nextLeft; actualScrollLeft.current = event.currentTarget.scrollLeft; setScrollLeft(event.currentTarget.scrollLeft); }
      }}>
        <div className="hourly-weather-track" style={{ width: totalWidth }}>
          {intervals.slice(first, last).map((interval, offset) => {
            const index = first + offset;
            const speed = interval.windSpeed === null ? '—' : interval.windSpeed.toFixed(1).replace(/\.0$/, '');
            const direction = interval.windSpeed === null ? '—' : interval.windSpeed === 0 ? 'Calm' : interval.windDirection === null ? '—' : compassDirection(interval.windDirection);
            const rain = rainLabel(interval.rain, interval.rainHours >= interval.expectedHours).replace(/ in$/, '');
            const clock = clockFormat.format(interval.start);
            const repeatedClock = [intervals[index - 1], intervals[index + 1]].some(other => other && dateFormat.format(other.start) === dateFormat.format(interval.start) && clockFormat.format(other.start) === clock);
            const isCurrent = now >= interval.start && now < interval.end;
            const accessible = `${dateClock(interval.start)} to ${dateClock(interval.end)}. ${isCurrent ? 'Current hour. ' : ''}${interval.windSpeed === null ? 'Wind unavailable' : `Wind ${speed} mph${interval.windDirection === null ? ', direction unavailable or variable' : ` from ${direction}`}`}. ${interval.rain === null ? 'Rain unavailable' : `Rain ${rainLabel(interval.rain, interval.rainHours >= interval.expectedHours)}`}.${interval.end > now ? ' Includes forecast weather.' : ''}`;
            return <div key={+interval.start} className={`hourly-weather-cell${isCurrent ? ' is-current' : ''}`} style={{ left: index * CELL_WIDTH, width: CELL_WIDTH }} role="group" aria-label={accessible} data-hour-start={interval.start.toISOString()}>
              <div className="hourly-weather-time"><span>{dateFormat.format(interval.start)}</span><strong>{clock}{repeatedClock && ` ${zoneName(interval.start)}`}</strong></div>
              <div className="hourly-weather-wind"><strong>{speed}</strong><span>{interval.windDirection !== null && interval.windSpeed !== null && interval.windSpeed > 0 && <svg width="12" height="12" viewBox="-6 -6 12 12" aria-hidden="true"><path d="M 0 5 L 0 -5 M -3 -2 L 0 -5 L 3 -2" transform={`rotate(${interval.windDirection + 180})`} /></svg>}{direction}</span></div>
              <div className="hourly-weather-rain"><strong>{rain}</strong></div>
            </div>;
          })}
        </div>
      </div>
    </div>}
  </section>;
}

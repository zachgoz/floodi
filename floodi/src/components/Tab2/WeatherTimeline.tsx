import { useMemo, useRef, useState } from 'react';
import type { PrecipPoint, WindPoint } from './types';
import { compassDirection, rainLabel, weatherTimeline } from 'src/utils/weatherTimeline';

export const WEATHER_TIMELINE_HEIGHT = 68;

interface WeatherTimelineProps {
  windPoints: WindPoint[];
  precipPoints: PrecipPoint[];
  start: Date;
  end: Date;
  now: Date;
  x: number;
  y: number;
  width: number;
  timezone: 'local' | 'gmt';
}

/** Two legible weather rows on the water plot's exact time scale. */
export function WeatherTimeline({ windPoints, precipPoints, start, end, now, x, y, width, timezone }: WeatherTimelineProps) {
  const { intervals, intervalHours } = useMemo(() => weatherTimeline(windPoints, precipPoints, start, end, width), [windPoints, precipPoints, start, end, width]);
  const [selectedKey, setSelectedKey] = useState<number | null>(null);
  const gesture = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const selected = intervals.find(interval => +interval.start === selectedKey);
  const xOf = (time: Date) => x + (+time - +start) / (+end - +start) * width;
  const intervalLabel = `${intervals.some(interval => interval.expectedHours < intervalHours) ? '≤' : ''}${intervalHours >= 24 ? `${intervalHours / 24}d` : `${intervalHours}h`}`;
  const timeZone = timezone === 'gmt' ? 'UTC' : 'America/New_York';
  const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone });
  const clockFormat = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone });
  const zoneFormat = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short', timeZone });
  const zoneName = (date: Date) => zoneFormat.formatToParts(date).find(part => part.type === 'timeZoneName')?.value ?? '';
  const rangeLabel = (a: Date, b: Date) => `${dateFormat.format(a)}, ${clockFormat.format(a)}${zoneName(a) === zoneName(b) ? '' : ` ${zoneName(a)}`} – ${dateFormat.format(a) === dateFormat.format(b) ? '' : `${dateFormat.format(b)}, `}${clockFormat.format(b)} ${zoneName(b)}`;
  const maximumRain = Math.max(0.01, ...intervals.map(interval => interval.rain ?? 0));
  const selectedWind = selected?.windSpeed === null || !selected ? 'Unavailable' : `${selected.windSpeed.toFixed(1)} mph${selected.windDirection === null ? ' · —' : ` · ${compassDirection(selected.windDirection)}`}`;
  const selectedRain = selected?.rain === null || !selected ? 'Unavailable' : `${selected.rain.toFixed(2)} in${selected.rainHours < selected.expectedHours ? ` (${selected.rainHours}/${Number(selected.expectedHours.toFixed(1))}h)` : ''}`;

  return <g aria-label={`Weather timeline: average wind and ${intervalLabel} rain totals`} data-testid="weather-timeline" data-domain-start={start.toISOString()} data-domain-end={end.toISOString()}>
    <rect x={0} y={y} width={x + width} height={WEATHER_TIMELINE_HEIGHT} fill="var(--chart-plot-bg)" />
    <line x1={x} x2={x + width} y1={y} y2={y} stroke="var(--chart-plot-stroke)" />
    <line x1={x} x2={x + width} y1={y + 34} y2={y + 34} stroke="var(--chart-grid)" />
    <text x={4} y={y + 15} fontSize={11} fill="var(--chart-label-text)" fontWeight={600}>Wind</text>
    <text x={4} y={y + 29} fontSize={11} fill="var(--chart-axis-text)">avg</text>
    <text x={4} y={y + 49} fontSize={11} fill="var(--ion-color-primary, #0077b6)" fontWeight={600}>Rain</text>
    <text x={4} y={y + 63} fontSize={11} fill="var(--chart-axis-text)">{intervalLabel}</text>
    {intervals.map(interval => {
      const left = Math.max(x, xOf(interval.start));
      const right = Math.min(x + width, xOf(interval.end));
      const cellWidth = right - left;
      const midpoint = (left + right) / 2;
      const completeRain = interval.rainHours >= interval.expectedHours;
      const windText = interval.windSpeed === null ? '—' : `${Math.round(interval.windSpeed)} mph`;
      const directionText = interval.windSpeed === null ? '' : interval.windSpeed === 0 ? 'Calm' : interval.windDirection === null ? '—' : compassDirection(interval.windDirection);
      const coverage = `${interval.windHours} hourly readings`;
      const accessible = `${rangeLabel(interval.start, interval.end)}. Average wind ${windText}${interval.windDirection === null ? ', direction unavailable or variable' : ` from ${directionText}`}, ${coverage}. Rain ${rainLabel(interval.rain, completeRain)}, ${interval.rainHours}/${Number(interval.expectedHours.toFixed(1))} hours.${+interval.end > +now ? ' Includes forecast weather.' : ''}`;
      const activate = () => setSelectedKey(previous => previous === +interval.start ? null : +interval.start);
      return <g key={+interval.start} role="button" tabIndex={0} aria-label={accessible} aria-pressed={selectedKey === +interval.start}
        onPointerDown={event => {
          suppressClick.current = false;
          gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
        }}
        onPointerMove={event => {
          const active = gesture.current;
          if (active?.pointerId === event.pointerId && Math.hypot(event.clientX - active.x, event.clientY - active.y) >= 6) { active.moved = true; suppressClick.current = true; }
        }}
        onPointerUp={event => {
          const active = gesture.current;
          if (active?.pointerId === event.pointerId) {
            suppressClick.current = active.moved || Math.hypot(event.clientX - active.x, event.clientY - active.y) >= 6;
            gesture.current = null;
          }
        }}
        onPointerCancel={() => { gesture.current = null; suppressClick.current = true; }}
        onClick={() => {
          if (suppressClick.current) { suppressClick.current = false; return; }
          suppressClick.current = false;
          activate();
        }}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); suppressClick.current = false; activate(); } else if (event.key === 'Escape') setSelectedKey(null); }} style={{ cursor: 'pointer' }}>
        <title>{accessible}</title>
        <rect x={left} y={y} width={cellWidth} height={WEATHER_TIMELINE_HEIGHT} fill={selectedKey === +interval.start ? 'var(--chart-grid)' : 'transparent'} />
        <line x1={right} x2={right} y1={y + 3} y2={y + 65} stroke="var(--chart-grid)" />
        {interval.rain !== null && interval.rain > 0 && <rect x={left + 5} y={y + 65 - Math.max(2, interval.rain / maximumRain * 8)} width={Math.max(0, cellWidth - 10)} height={Math.max(2, interval.rain / maximumRain * 8)} fill="var(--ion-color-primary, #0077b6)" opacity={0.45} rx={2} />}
        {cellWidth >= 56 && <g aria-hidden="true">
          <text x={midpoint} y={y + 15} textAnchor="middle" fontSize={12} fill="var(--chart-label-text)" fontWeight={600}>{windText}</text>
          <text x={midpoint + (interval.windDirection === null ? 0 : 5)} y={y + 29} textAnchor="middle" fontSize={11} fill="var(--chart-axis-text)">{directionText}</text>
          {interval.windDirection !== null && <path d="M 0 5 L 0 -5 M -3 -2 L 0 -5 L 3 -2" transform={`translate(${midpoint - 14},${y + 25}) rotate(${interval.windDirection + 180})`} stroke="var(--chart-label-text)" strokeWidth={1.5} fill="none" />}
          <text x={midpoint} y={y + 51} textAnchor="middle" fontSize={12} fill="var(--ion-color-primary, #0077b6)" fontWeight={600}>{rainLabel(interval.rain, completeRain)}</text>
        </g>}
      </g>;
    })}
    {now >= start && now <= end && <line x1={xOf(now)} x2={xOf(now)} y1={y} y2={y + WEATHER_TIMELINE_HEIGHT} stroke="var(--ion-color-primary, #0077b6)" strokeWidth={1.5} opacity={0.65} style={{ pointerEvents: 'none' }} />}
    {selected && <g role="status" aria-live="polite" style={{ pointerEvents: 'none' }}>
      <rect x={x} y={y - 69} width={width} height={64} rx={6} fill="var(--chart-tooltip-bg)" stroke="var(--chart-tooltip-stroke)" />
      <text x={x + 8} y={y - 52} fontSize={11} fill="var(--chart-label-text)">{rangeLabel(selected.start, selected.end)}</text>
      <text x={x + 8} y={y - 35} fontSize={12} fill="var(--chart-label-text)">Wind avg: {selectedWind}</text>
      <text x={x + 8} y={y - 18} fontSize={12} fill="var(--ion-color-primary, #0077b6)">Rain: {selectedRain}</text>
    </g>}
  </g>;
}

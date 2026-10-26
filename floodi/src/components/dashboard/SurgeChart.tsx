import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Point } from 'src/components/Tab2/types';
import { liveViewport, surgeTrend } from 'src/utils/waterForecast';
import { selectSurgeReadout } from 'src/utils/surgeReadout';
import { ForecastFactors } from './ForecastFactors';
import type { ForecastDocument } from '../../../functions/src/forecast/schema';
import { ChartInfo } from './ChartInfo';
import type { ResidualPatternAnalysis } from '../../../functions/src/forecast/pattern';
import './ForecastPanels.css';

type Viewport = { start: Date; end: Date };
interface Props {
  points: Point[];
  estimatedPoints?: Point[];
  forecast?: Point[];
  experimentalForecast?: Point[];
  forecastLabel?: string;
  forecastDescription?: string;
  forecastDocument?: ForecastDocument | null;
  comparisonLabel?: string;
  timezone?: 'local' | 'gmt';
  source?: string;
  now?: Date;
  viewport?: Viewport | null;
  forecastEndAt?: Date | null;
  focusTime?: Date;
  focusRatio?: number;
  onViewportChange?: (start: Date, end: Date) => void;
  onResetToLive?: () => void;
  showTrendProjection?: boolean;
  trendAvailable?: boolean;
  previewLabel?: string;
  previewDescription?: string;
  patternAnalysis?: ResidualPatternAnalysis;
  onToggleTrendProjection?: () => void;
  embedded?: boolean;
  showControls?: boolean;
}

// Keep the neighboring samples so clipping does not leave gaps at the viewport edges.
function samplesInWindow(points: Point[], domain: Viewport) {
  const valid = points.filter(p => Number.isFinite(+p.t) && Number.isFinite(p.v)).sort((a, b) => +a.t - +b.t);
  const first = valid.findIndex(p => +p.t >= +domain.start);
  if (first < 0) return [];
  const end = valid.findIndex(p => +p.t > +domain.end);
  if (end === 0) return [];
  return valid.slice(Math.max(0, first - 1), end < 0 ? undefined : end + 1);
}

export function SurgeChart({ points, estimatedPoints = [], forecast = [], experimentalForecast = [], forecastLabel = 'Forecast', forecastDescription, forecastDocument, comparisonLabel = 'Comparison', timezone = 'local', source,
  now = new Date(), viewport, forecastEndAt, focusTime, focusRatio = 1, onViewportChange, onResetToLive, showTrendProjection, trendAvailable, onToggleTrendProjection, previewLabel = '1h Trend', previewDescription, patternAnalysis, embedded = false, showControls = true }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(800);
  const plotWidth = width - 70;
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(320, svg.getBoundingClientRect().width)));
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);
  const [localDomain, setLocalDomain] = useState(() => liveViewport(new Date(+now - 24 * 3600_000), now, now, focusRatio));
  const [localLive, setLocalLive] = useState(true);
  const domain = viewport || localDomain;
  // Keep long NOAA-range views intact during every gesture, including a pan.
  // The loaded range is a limit for zooming, never an automatic recentering.
  const futureRatio = 1 - focusRatio;
  const fullSpan = forecastEndAt && Number.isFinite(+forecastEndAt) && futureRatio > 0
    ? Math.max(0, (+forecastEndAt - +now) / futureRatio) : 0;
  const maxWindowMs = Math.max(7 * 24 * 3600_000 / (viewport && futureRatio > 0 ? futureRatio : 1),
    +domain.end - +domain.start, fullSpan);
  const focus = focusTime || new Date(+domain.start + (+domain.end - +domain.start) * focusRatio);
  const live = viewport ? Math.abs(+focus - +now) < 5 * 60_000 : localLive;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ start: number; end: number; distance: number; mid: number } | null>(null);
  const id = useId().replace(/:/g, '');
  const change = (next: Viewport) => {
    setLocalDomain(next);
    setLocalLive(false);
    onViewportChange?.(next.start, next.end);
  };
  // The tide chart owns live updates when linked; only standalone charts need a timer.
  useEffect(() => {
    if (viewport || !localLive) return;
    const timer = setInterval(() => setLocalDomain(d => liveViewport(d.start, d.end, new Date(), focusRatio)), 60_000);
    return () => clearInterval(timer);
  }, [viewport, localLive, focusRatio]);
  const visible = useMemo(() => samplesInWindow(points, domain), [points, domain]);
  const visibleEstimates = useMemo(() => samplesInWindow(estimatedPoints, domain), [estimatedPoints, domain]);
  const visibleForecast = useMemo(() => samplesInWindow(forecast, domain), [forecast, domain]);
  const visibleExperimental = useMemo(() => samplesInWindow(experimentalForecast, domain), [experimentalForecast, domain]);
  const bounds = Math.max(0.5, ...[...visible, ...visibleEstimates, ...visibleForecast, ...visibleExperimental].map(p => Math.abs(p.v))) * 1.15;
  const x = (t: Date) => 50 + ((+t - +domain.start) / (+domain.end - +domain.start)) * plotWidth;
  const y = (v: number) => 130 - (v / bounds) * 94;
  const displayHandoff = [...points, ...estimatedPoints].reduce((latest, point) => Number.isFinite(+point.t)
    ? Math.max(latest, +point.t) : latest, +domain.start);
  const forecastClipStart = Math.min(width - 20, Math.max(50, x(new Date(displayHandoff))));
  const current = surgeTrend(points, now);
  const readout = selectSurgeReadout(points, estimatedPoints, forecast, focus, live);
  const select = (hours: number) => {
    change(liveViewport(new Date(+now - hours * 3600_000), now, now, focusRatio));
    setLocalLive(true);
  };
  const zoom = (factor: number, anchor = 0.5) => {
    const span = Math.min(maxWindowMs, Math.max(3600_000, (+domain.end - +domain.start) * factor));
    const pivot = +domain.start + (+domain.end - +domain.start) * anchor;
    change({ start: new Date(pivot - span * anchor), end: new Date(pivot + span * (1 - anchor)) });
  };
  const returnToLive = () => {
    if (onResetToLive) onResetToLive();
    else change(liveViewport(domain.start, domain.end, new Date(), focusRatio));
    setLocalLive(true);
  };
  const time = (t: Date) => new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZone: timezone === 'gmt' ? 'UTC' : 'America/New_York',
  }).format(t);
  const beginGesture = () => {
    const ps = [...pointers.current.values()];
    gesture.current = ps.length ? {
      start: +domain.start, end: +domain.end,
      distance: ps.length === 2 ? Math.abs(ps[0].x - ps[1].x) : 0,
      mid: ps.reduce((a, p) => a + p.x, 0) / ps.length,
    } : null;
  };
  // A non-passive listener is needed for trackpad pinch and horizontal wheel panning.
  const wheelHandler = useRef<(event: WheelEvent) => void>(() => {});
  wheelHandler.current = e => {
    if (!e.ctrlKey && Math.abs(e.deltaX) <= Math.abs(e.deltaY) && !e.shiftKey) return;
    e.preventDefault();
    const rect = svgRef.current!.getBoundingClientRect();
    if (e.ctrlKey) zoom(Math.exp(e.deltaY * 0.005), Math.max(0, Math.min(1, (e.clientX - rect.left - 50 * rect.width / width) / (plotWidth * rect.width / width))));
    else {
      const shift = ((e.deltaX || e.deltaY) / Math.max(1, rect.width * plotWidth / width)) * (+domain.end - +domain.start);
      change({ start: new Date(+domain.start + shift), end: new Date(+domain.end + shift) });
    }
  };
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const listener = (e: WheelEvent) => wheelHandler.current(e);
    svg.addEventListener('wheel', listener, { passive: false });
    return () => svg.removeEventListener('wheel', listener);
  }, []);

  // Match the tide chart's native touch handling so Ionic scrolling cannot claim
  // horizontal pans or pinches. Vertical gestures still scroll the dashboard.
  const touchGesture = useRef<{ start: number; end: number; x: number; y: number; distance: number; vertical: boolean } | null>(null);
  const touchHandlers = useRef<{ start: (e: TouchEvent) => void; move: (e: TouchEvent) => void }>({ start: () => {}, move: () => {} });
  touchHandlers.current = {
    start: e => {
      const ts = [...e.touches];
      if (!ts.length) { touchGesture.current = null; return; }
      if (ts.length === 2 && e.cancelable) e.preventDefault();
      touchGesture.current = {
        start: +domain.start, end: +domain.end,
        x: ts.reduce((sum, t) => sum + t.clientX, 0) / ts.length,
        y: ts.reduce((sum, t) => sum + t.clientY, 0) / ts.length,
        distance: ts.length === 2 ? Math.hypot(ts[1].clientX - ts[0].clientX, ts[1].clientY - ts[0].clientY) : 0,
        vertical: false,
      };
    },
    move: e => {
      const ts = [...e.touches];
      const g = touchGesture.current;
      if (!g || !ts.length || g.vertical) return;
      const mid = ts.reduce((sum, t) => sum + t.clientX, 0) / ts.length;
      if (ts.length === 1) {
        const dy = Math.abs(ts[0].clientY - g.y);
        const dx = Math.abs(mid - g.x);
        if (dy > 5 && dy > dx) { g.vertical = true; return; }
        if (dx < 5) return;
      }
      if (e.cancelable) e.preventDefault();
      const rect = svgRef.current!.getBoundingClientRect();
      const cssWidth = rect.width * plotWidth / width;
      if (!cssWidth) return;
      const ratio = ts.length === 2 && g.distance > 0 ? g.distance / Math.max(20, Math.hypot(ts[1].clientX - ts[0].clientX, ts[1].clientY - ts[0].clientY)) : 1;
      const span = Math.min(maxWindowMs, Math.max(3600_000, (g.end - g.start) * ratio));
      const anchor = Math.max(0, Math.min(1, (g.x - rect.left - 50 * rect.width / width) / cssWidth));
      const start = g.start + (g.end - g.start - span) * anchor + (g.x - mid) / cssWidth * (g.end - g.start);
      change({ start: new Date(start), end: new Date(start + span) });
    },
  };
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const start = (e: TouchEvent) => touchHandlers.current.start(e);
    const move = (e: TouchEvent) => touchHandlers.current.move(e);
    svg.addEventListener('touchstart', start, { passive: false });
    svg.addEventListener('touchmove', move, { passive: false });
    svg.addEventListener('touchend', start, { passive: false });
    svg.addEventListener('touchcancel', start, { passive: false });
    return () => {
      svg.removeEventListener('touchstart', start);
      svg.removeEventListener('touchmove', move);
      svg.removeEventListener('touchend', start);
      svg.removeEventListener('touchcancel', start);
    };
  }, []);

  return (
    <section className={`forecast-panel dashboard-surge-card${embedded ? ' surge-chart-embedded' : ''}`} aria-label="Surge and water-level anomalies">
      <div className="forecast-panel-heading">
        <div><h2>Surge Trends</h2>{!embedded && <span className="chart-linked" title="Zoom and pan either chart to move both" aria-label="Time window linked to water level chart">↔</span>}</div>
        <div className="surge-readout">
          <strong>{!readout ? 'Unavailable' : <>{`${readout.value >= 0 ? '+' : ''}${readout.value.toFixed(2)}`} <small>ft</small></>}</strong>
          <span>{readout ? `${readout.source} · ${time(readout.at)}` : time(focus)}</span>
          {live && readout && readout.source !== 'Forecast' && <span className="surge-live-trend">{current.trend === 'Increasing' ? '↗ ' : current.trend === 'Decreasing' ? '↘ ' : '→ '}{current.trend}</span>}
        </div>
      </div>
      {showControls && <div className="surge-controls" role="group" aria-label="Shared chart time window">
        {[12, 24, 48, 168].map(h => <button key={h}
          aria-label={h === 168 ? '7 days' : `${h} hours`}
          aria-pressed={live && Math.abs((+domain.end - +domain.start) / 3600_000 - h) < 0.01}
          onClick={() => select(h)}>{h === 168 ? '7d' : `${h}h`}</button>)}
        <button onClick={() => zoom(0.5)} aria-label="Zoom in anomaly chart">+</button>
        <button onClick={() => zoom(2)} aria-label="Zoom out anomaly chart">−</button>
        {!live && <button className="surge-live-button" onClick={returnToLive}>Return to Live</button>}
      </div>}
      <div className="chart-legend-row">
        <div className="chart-legend" aria-label="Surge chart legend">
          <span><i className="legend-line positive-line" />Above tide</span>
          <span><i className="legend-line negative-line" />Below tide</span>
          {estimatedPoints.length > 1 && <span><i className="legend-line estimated-residual-line" />Estimated</span>}
          {forecast.length > 1 && <span><i className="legend-line residual-forecast-line" />{forecastLabel}</span>}
          {experimentalForecast.length > 1 && !showTrendProjection && <span><i className="legend-line experimental-line" />{comparisonLabel}</span>}
          {onToggleTrendProjection && <label className="trend-preview-toggle" title={trendAvailable ? previewDescription || 'One-hour damped trend comparison' : 'Recent observations are insufficient for a trend projection'}><input type="checkbox" aria-label="Show trend preview" checked={!!showTrendProjection && !!trendAvailable} disabled={!trendAvailable} onChange={onToggleTrendProjection} /><i className="legend-line experimental-line" />{previewLabel} preview</label>}
        </div>
        <ChartInfo label="About surge measurements">
          <p>Observed water level minus astronomical tide, in feet. Zero is the tide prediction; residuals can reflect weather, hydrology and measurement effects.</p>
          <p>{source === 'fiman' ? 'FiMAN gauge 30046; localized NOAA tide reference.' : 'NOAA station residual.'} Zooming or panning either chart moves both.</p>
          {estimatedPoints.length > 1 && <p>The dotted bridge uses the phase-aligned NOAA estimate while the local sensor reports. It does not enter the measured trend or model training.</p>}
          <p>The line connects measured samples across gaps for readability; values between samples are interpolated visually. No observations are invented. The dashed forecast reconstructs the same physical water level as the main chart.</p>
          {forecastDescription && <p>{forecastDescription}</p>}
          {points.at(-1) && <p>Latest observation: {time(points.at(-1)!.t)}. Trend compares the preceding three hours; changes under 0.03 ft/hour are stable.</p>}
          {experimentalForecast.length > 1 && <p>{showTrendProjection ? previewDescription || 'Purple: one-hour preview of the recent measured trend. Forecast reliability is not established.' : `Purple: ${comparisonLabel.toLowerCase()}.`} Flood cards use the primary forecast.</p>}
          {patternAnalysis && <p>Repeating-pattern check: {patternAnalysis.reason} {patternAnalysis.validation?.improvementFraction !== null && patternAnalysis.validation?.improvementFraction !== undefined ? `Recent holdout error ${patternAnalysis.validation.improvementFraction >= 0 ? 'decreased' : 'increased'} ${Math.abs(patternAnalysis.validation.improvementFraction * 100).toFixed(0)}%.` : ''}</p>}
        </ChartInfo>
      </div>
      <svg ref={svgRef} tabIndex={0} aria-keyshortcuts="ArrowLeft ArrowRight" onKeyDown={event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const shift = (+domain.end - +domain.start) / 4 * (event.key === 'ArrowLeft' ? -1 : 1);
        change({ start: new Date(+domain.start + shift), end: new Date(+domain.end + shift) });
      }} viewBox={`0 0 ${width} 270`} role="img"
        data-domain-start={domain.start.toISOString()} data-domain-end={domain.end.toISOString()}
        aria-label={`Anomaly chart. ${readout ? `${readout.source}: ${readout.value.toFixed(2)} feet at ${time(readout.at)}` : 'No value at selected time'}. Positive anomalies above zero; negative anomalies below zero.`}
        className="surge-svg" style={{ touchAction: 'pan-y' }}
        onPointerDown={e => {
          if (e.pointerType === 'touch') return;
          e.currentTarget.setPointerCapture(e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          beginGesture();
        }}
        onPointerMove={e => {
          if (e.pointerType === 'touch') return;
          if (!pointers.current.has(e.pointerId) || !gesture.current) return;
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const ps = [...pointers.current.values()];
          const g = gesture.current;
          const mid = ps.reduce((a, p) => a + p.x, 0) / ps.length;
          const cssPlotWidth = e.currentTarget.getBoundingClientRect().width * plotWidth / width;
          if (!cssPlotWidth) return;
          const ratio = ps.length === 2 && g.distance > 0 ? g.distance / Math.max(20, Math.abs(ps[0].x - ps[1].x)) : 1;
          const span = Math.min(maxWindowMs, Math.max(3600_000, (g.end - g.start) * ratio));
          const center = (g.start + g.end) / 2 + ((g.mid - mid) / cssPlotWidth) * (g.end - g.start);
          if (Math.abs(g.mid - mid) > 4 || ps.length === 2) change({ start: new Date(center - span / 2), end: new Date(center + span / 2) });
        }}
        onPointerUp={e => { if (e.pointerType !== 'touch') { pointers.current.delete(e.pointerId); beginGesture(); } }}
        onPointerCancel={e => { if (e.pointerType !== 'touch') { pointers.current.clear(); gesture.current = null; } }}>
        <defs>
          <clipPath id={`surge-${id}`}><rect x="50" y="24" width={plotWidth} height="208" /></clipPath>
          <clipPath id={`surge-forecast-${id}`}><rect data-testid="surge-forecast-clip" x={forecastClipStart} y="24"
            width={Math.max(0, width - 20 - forecastClipStart)} height="208" /></clipPath>
        </defs>
        {[-bounds, 0, bounds].map(v => <g key={v}>
          <line x1="50" x2={width - 20} y1={y(v)} y2={y(v)} stroke={v === 0 ? 'var(--ion-text-color)' : 'var(--chart-grid, #dce4e9)'} strokeWidth={v === 0 ? 2 : 1} />
          <text x="42" y={y(v) + 4} textAnchor="end" fill="currentColor" fontSize="12">{v === 0 ? '0 ft' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`}</text>
        </g>)}
        <g clipPath={`url(#surge-${id})`}>
          {visible.slice(1).map((p, i) => {
            const prev = visible[i];
            const cross = prev.v * p.v < 0 ? new Date(+prev.t + (-prev.v / (p.v - prev.v)) * (+p.t - +prev.t)) : null;
            return <g key={+p.t} data-testid="residual-segment">
              <line x1={x(prev.t)} y1={y(prev.v)} x2={x(cross || p.t)} y2={y(cross ? 0 : p.v)} stroke={prev.v >= 0 ? '#c76a27' : '#137bbb'} strokeWidth="3" />
              {cross && <line x1={x(cross)} y1={y(0)} x2={x(p.t)} y2={y(p.v)} stroke={p.v > 0 ? '#c76a27' : '#137bbb'} strokeWidth="3" />}
            </g>;
          })}
          {visibleEstimates.length > 1 && <polyline data-testid="estimated-residual" points={visibleEstimates.map(p => `${x(p.t)},${y(p.v)}`).join(' ')} fill="none" stroke="#a27956" strokeWidth="3" strokeDasharray="3 3" />}
          {visibleForecast.length > 1 && <polyline data-testid="residual-forecast" clipPath={`url(#surge-forecast-${id})`} points={visibleForecast.map(p => `${x(p.t)},${y(p.v)}`).join(' ')} fill="none" stroke="#637b86" strokeWidth="3" strokeDasharray="7 5" />}
          {visibleExperimental.length > 1 && <polyline data-testid="experimental-residual-forecast" clipPath={`url(#surge-forecast-${id})`} points={visibleExperimental.map(p => `${x(p.t)},${y(p.v)}`).join(' ')} fill="none" stroke="#8462bf" strokeWidth="3" strokeDasharray="7 5" />}
          {readout && +readout.at === +focus && <circle data-testid="surge-selected-point" cx={x(focus)} cy={y(readout.value)} r="5" fill="var(--ion-color-primary, #0084b9)" stroke="var(--dash-card-bg, #fff)" strokeWidth="2" />}
          <line x1={x(focus)} x2={x(focus)} y1="24" y2="232" stroke="var(--ion-color-primary, #0084b9)" strokeWidth="2" />
        </g>
        {(width < 600 ? [0, 1] : [0, 0.5, 1]).map(f => <text key={f} x={50 + f * plotWidth} y="254" textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'} fill="currentColor" fontSize="12">{time(new Date(+domain.start + f * (+domain.end - +domain.start)))}</text>)}
      </svg>
      {readout?.source === 'Forecast' && <ForecastFactors document={forecastDocument} at={readout.at} residual={readout.value} />}
      {!visible.length && !visibleForecast.length && <p className="forecast-empty">No data in this window</p>}
    </section>
  );
}

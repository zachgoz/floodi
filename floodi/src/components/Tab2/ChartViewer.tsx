import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import type { Point, ChartConfig } from './types';
import { useChartInteraction, formatTooltipTime } from './hooks/useChartInteraction';
import { isCommentTimeRange, type Comment, type CommentTimeRange } from 'src/types/comment';
import { getTimeRangeFromChartSelection } from 'src/utils/timeRangeHelpers';
import { IonBadge, IonButton, IonButtons, IonIcon } from '@ionic/react';
import { addCircleOutline, chatbubbleOutline, eye, eyeOff } from 'ionicons/icons';

/**
 * Props for the ChartViewer component
 */
interface ChartViewerProps {
  /** Observed data points */
  observedPoints: Point[];
  /** Predicted data points */
  predictedPoints: Point[];
  /** Adjusted prediction data points */
  adjustedPoints: Point[];
  /** Delta (observed - predicted) data points */
  deltaPoints: Point[];
  /** Future surge forecast (offset trend) points */
  surgeForecastPoints?: Point[];
  /** Time domain start */
  domainStart: Date;
  /** Time domain end */
  domainEnd: Date;
  /** Current time marker */
  now: Date;
  /** Flood threshold level */
  threshold: number;
  /** Whether to show delta series */
  showDelta: boolean;
  /** Timezone for time formatting */
  timezone: 'local' | 'gmt';
  /** Chart configuration */
  config?: Partial<ChartConfig>;
  /** Callback for chart interactions */
  onChartInteraction?: (point: Point | null) => void;
  /** Toggle comment overlay visibility */
  showComments?: boolean;
  /** Comments to render as markers on the timeline */
  comments?: Comment[];
  /** Fire when hovering a comment marker */
  onCommentHover?: (comment: Comment | null) => void;
  /** Fire when clicking a comment marker */
  onCommentClick?: (comment: Comment) => void;
  /** Fire when a time range is selected for comment creation */
  onTimeRangeSelect?: (range: CommentTimeRange) => void;
  /** Enable time range selection mode for comment creation */
  commentCreationMode?: boolean;
  /** Handlers for in-component controls (optional) */
  onToggleComments?: () => void;
  onToggleCreationMode?: () => void;
  /** Count for display in the overlay controls */
  commentCount?: number;
}

/**
 * Utility functions for chart rendering
 */

/**
 * Convert series data to SVG polyline points string
 */
function buildPolyline(points: Point[], xOf: (d: Date) => number, yOf: (v: number) => number): string {
  return points.map(p => `${xOf(p.t)},${yOf(p.v)}`).join(' ');
}

/**
 * Segment points by threshold for color-coded rendering
 */
function segmentByThreshold(points: Point[], threshold: number): { points: Point[]; above: boolean }[] {
  const segments: { points: Point[]; above: boolean }[] = [];
  if (points.length < 2) return segments;

  let previous = points[0];
  let isAbove = previous.v >= threshold;
  let currentSegment: Point[] = [previous];

  for (let i = 1; i < points.length; i++) {
    const current = points[i];
    const currentAbove = current.v >= threshold;

    if (currentAbove === isAbove) {
      currentSegment.push(current);
    } else {
      // Threshold crossing - interpolate intersection point
      const deltaValue = current.v - previous.v;
      const fraction = deltaValue !== 0 ? (threshold - previous.v) / deltaValue : 0;
      const clampedFraction = Math.max(0, Math.min(1, fraction));
      const crossTime = new Date(
        previous.t.getTime() + clampedFraction * (current.t.getTime() - previous.t.getTime())
      );
      const crossPoint: Point = { t: crossTime, v: threshold };

      currentSegment.push(crossPoint);
      if (currentSegment.length >= 2) {
        segments.push({ points: currentSegment, above: isAbove });
      }

      // Start new segment at crossing point
      currentSegment = [crossPoint, current];
      isAbove = currentAbove;
    }
    previous = current;
  }

  if (currentSegment.length >= 2) {
    segments.push({ points: currentSegment, above: isAbove });
  }

  return segments;
}

/**
 * Professional chart viewer component with interactive SVG rendering
 * 
 * Renders water level data with flood highlighting, interactive tooltips,
 * and responsive design. Replaces the massive inline SVG code from the original.
 * 
 * @param props ChartViewerProps
 * @returns JSX.Element
 */
export const ChartViewer: React.FC<ChartViewerProps> = ({
  observedPoints,
  predictedPoints,
  adjustedPoints,
  deltaPoints,
  surgeForecastPoints = [],
  domainStart,
  domainEnd,
  now,
  threshold,
  showDelta,
  timezone,
  config = {},
  onChartInteraction,
  // comment integration (optional)
  showComments = false,
  comments = [],
  onCommentHover,
  onCommentClick,
  onTimeRangeSelect,
  commentCreationMode = false,
  onToggleComments,
  onToggleCreationMode,
  commentCount,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 900, h: 420 });

  const { hoverT, setHoverT, calculateTooltipData, calculateCommentTooltipData } = useChartInteraction();

  // Selection state for creating a comment time range
  const [isSelecting, setIsSelecting] = useState<boolean>(false);
  const [selectionStart, setSelectionStart] = useState<Date | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<Date | null>(null);

  // Handle responsive resizing
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const newSize = {
          w: Math.max(320, Math.floor(width)),
          h: Math.max(240, Math.floor(height)),
        };
        setSize(newSize);
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  // Chart dimensions and scaling
  const chartConfig = useMemo((): ChartConfig => {
    const bottomMargin = size.w <= 480 ? 48 : 30;
    return {
      size,
      margins: { l: 50, r: 20, t: 10, b: bottomMargin },
      threshold,
      showDelta,
      timezone,
      ...config,
    };
  }, [size, threshold, showDelta, timezone, config]);

  const { margins } = chartConfig;
  const innerW = size.w - margins.l - margins.r;
  const innerH = size.h - margins.t - margins.b;

  // Y-axis scaling
  const yMinMax = useMemo(() => {
    const allValues = [
      ...observedPoints.map(p => p.v),
      ...adjustedPoints.map(p => p.v),
      ...predictedPoints.map(p => p.v),
      ...(showDelta ? deltaPoints.map(p => p.v) : []),
      ...(showDelta ? surgeForecastPoints.map(p => p.v) : []),
      threshold,
    ];

    if (allValues.length === 0) return { min: 0, max: 1 };

    let min = Math.min(...allValues);
    let max = Math.max(...allValues);

    if (min === max) {
      min -= 0.5;
      max += 0.5;
    }

    const padding = (max - min) * 0.1;
    return { min: min - padding, max: max + padding };
  }, [observedPoints, adjustedPoints, predictedPoints, deltaPoints, threshold, showDelta]);

  // Scaling functions
  const t0 = domainStart.getTime();
  const t1 = domainEnd.getTime();
  const xOf = useCallback((date: Date) => margins.l + ((date.getTime() - t0) / (t1 - t0)) * innerW, [margins.l, t0, t1, innerW]);
  const yOf = useCallback((value: number) => margins.t + (1 - (value - yMinMax.min) / (yMinMax.max - yMinMax.min)) * innerH, [margins.t, yMinMax.min, yMinMax.max, innerH]);

  // Flood highlighting rectangles
  const floodRects = useMemo(() => {
    const rects: { x: number; w: number }[] = [];
    if (adjustedPoints.length < 2) return rects;

    let isAbove = false;
    let segmentStart: Date | null = null;

    for (let i = 1; i < adjustedPoints.length; i++) {
      const previous = adjustedPoints[i - 1];
      const current = adjustedPoints[i];
      const prevAbove = previous.v >= threshold;
      const currAbove = current.v >= threshold;

      if (!isAbove && (prevAbove || (!prevAbove && currAbove))) {
        // Entering flood zone
        let startTime = previous.t;
        if (!prevAbove && currAbove && current.v !== previous.v) {
          const fraction = (threshold - previous.v) / (current.v - previous.v);
          startTime = new Date(previous.t.getTime() + fraction * (current.t.getTime() - previous.t.getTime()));
        }
        segmentStart = startTime;
        isAbove = true;
      }

      if (isAbove && !currAbove) {
        // Leaving flood zone
        let endTime = current.t;
        if (current.v !== previous.v) {
          const fraction = (threshold - previous.v) / (current.v - previous.v);
          endTime = new Date(previous.t.getTime() + fraction * (current.t.getTime() - previous.t.getTime()));
        }

        if (segmentStart) {
          const x = xOf(segmentStart);
          const width = Math.max(1, xOf(endTime) - x);
          rects.push({ x, w: width });
        }
        isAbove = false;
        segmentStart = null;
      }
    }

    // Handle ongoing flood at end
    if (isAbove && segmentStart) {
      const x = xOf(segmentStart);
      const width = Math.max(1, xOf(domainEnd) - x);
      rects.push({ x, w: width });
    }

    return rects;
  }, [adjustedPoints, threshold, xOf, domainEnd]);

  // Mouse/pointer interaction
  const computeTimeAtPointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const pixelX = event.clientX - rect.left;
    const fraction = Math.max(0, Math.min(1, (pixelX - margins.l * (rect.width / size.w)) / (innerW * (rect.width / size.w))));
    const timeMs = t0 + fraction * (t1 - t0);
    return new Date(timeMs);
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const hoverTime = computeTimeAtPointer(event);
    if (!hoverTime) return;

    setHoverT(hoverTime);
    if (commentCreationMode && isSelecting) {
      setSelectionEnd(hoverTime);
    }
    if (onChartInteraction) {
      // Find nearest point for callback
      const timeMs = hoverTime.getTime();
      const nearestObs = observedPoints.reduce((best, point) => {
        const dt = Math.abs(point.t.getTime() - timeMs);
        const bestDt = best ? Math.abs(best.t.getTime() - timeMs) : Infinity;
        return dt < bestDt ? point : best;
      }, null as Point | null);
      onChartInteraction(nearestObs);
    }
  };

  const handlePointerLeave = () => {
    setHoverT(null);
    if (onChartInteraction) {
      onChartInteraction(null);
    }
    if (isSelecting) {
      setIsSelecting(false);
      setSelectionStart(null);
      setSelectionEnd(null);
    }
  };

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!commentCreationMode) return;
    const t = computeTimeAtPointer(event);
    if (!t) return;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
    setIsSelecting(true);
    setSelectionStart(t);
    setSelectionEnd(t);
  };

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!commentCreationMode || !isSelecting) return;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
    const t = computeTimeAtPointer(event);
    if (!t || !selectionStart) {
      setIsSelecting(false);
      return;
    }
    const range = getTimeRangeFromChartSelection({ start: selectionStart, end: t });
    onTimeRangeSelect?.(range);
    setIsSelecting(false);
    setSelectionStart(null);
    setSelectionEnd(null);
  };

  // Tooltip data calculation
  const tooltipData = useMemo(() => {
    if (!hoverT) return null;
    return calculateTooltipData(hoverT, observedPoints, predictedPoints, adjustedPoints, deltaPoints, threshold, showDelta);
  }, [hoverT, observedPoints, predictedPoints, adjustedPoints, deltaPoints, threshold, showDelta, calculateTooltipData]);

  const handleContainerKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const k = e.key.toLowerCase();
    if (k === 'c') onToggleComments?.();
    if (k === 'n') onToggleCreationMode?.();
  };

  return (
    <div className="chart-viewer" ref={containerRef} onKeyDown={handleContainerKeyDown} tabIndex={0} aria-keyshortcuts="C N">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${size.w} ${size.h}`}
        width={size.w}
        height={size.h}
        role="img"
        aria-label="Water level chart showing observed, predicted, and adjusted predictions over time"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        // Allow vertical page scroll while interacting with the chart on mobile
        style={{ touchAction: 'pan-y pinch-zoom', cursor: 'crosshair' }}
      >
        {/* Background */}
        <rect x={0} y={0} width={size.w} height={size.h} fill="var(--chart-bg)" />
        
        {/* Plot area */}
        <rect 
          x={margins.l} 
          y={margins.t} 
          width={innerW} 
          height={innerH} 
          fill="var(--chart-plot-bg)" 
          stroke="var(--chart-plot-stroke)" 
        />

        {/* Flood zones */}
        {floodRects.map((rect, i) => (
          <rect 
            key={i}
            x={rect.x} 
            y={margins.t} 
            width={rect.w} 
            height={innerH} 
            fill="rgba(255,0,0,0.08)" 
          />
        ))}

        {/* Threshold line */}
        <line 
          x1={margins.l} 
          x2={margins.l + innerW} 
          y1={yOf(threshold)} 
          y2={yOf(threshold)} 
          stroke="#e74c3c" 
          strokeDasharray="6 4" 
        />
        <text 
          x={margins.l + 6} 
          y={yOf(threshold) - 6} 
          fill="#e74c3c" 
          fontSize="12"
        >
          {threshold.toFixed(1)} ft threshold
        </text>

        {/* Current time marker */}
        <line 
          x1={xOf(now)} 
          x2={xOf(now)} 
          y1={margins.t} 
          y2={margins.t + innerH} 
          stroke="#888" 
          strokeDasharray="2 4" 
        />
        <text 
          x={xOf(now) + 4} 
          y={margins.t + 12} 
          fill="var(--chart-axis-text)" 
          fontSize="12"
        >
          {formatTooltipTime(now, timezone)} {timezone === 'gmt' ? 'GMT' : ''}
        </text>

        {/* Data series */}
        {/* Observed data (segmented by threshold) */}
        {observedPoints.length > 1 && segmentByThreshold(observedPoints, threshold).map((segment, i) => (
          <polyline
            key={`obs-${i}`}
            fill="none"
            stroke={segment.above ? '#e74c3c' : '#2ecc71'}
            strokeWidth="2"
            points={buildPolyline(segment.points, xOf, yOf)}
          />
        ))}

        {/* Predicted data */}
        {predictedPoints.length > 1 && (
          <polyline 
            fill="none" 
            stroke="#95a5a6" 
            strokeWidth="2" 
            opacity={0.9}
            points={buildPolyline(predictedPoints, xOf, yOf)} 
          />
        )}

        {/* Selection overlay for comment creation */}
        {commentCreationMode && isSelecting && selectionStart && selectionEnd && (
          (() => {
            const x0 = xOf(selectionStart);
            const x1p = xOf(selectionEnd);
            const x = Math.min(x0, x1p);
            const w = Math.max(1, Math.abs(x1p - x0));
            return (
              <rect
                className="chart-selection-rect"
                x={x}
                y={margins.t}
                width={w}
                height={innerH}
                fill="rgba(25,118,210,0.15)"
                stroke="#1976d2"
                strokeDasharray="4 3"
              />
            );
          })()
        )}

        {/* Comment markers */}
        {showComments && comments.length > 0 && (
          <g aria-label="Comment markers" className="chart-comment-markers">
            {(() => {
              // cluster by x position (bins)
              const bins = new Map<number, Comment[]>();
              const binSize = 14; // px
              for (const c of comments) {
                const tr = c.metadata?.timeRange;
                if (!isCommentTimeRange(tr)) continue;
                const s = Date.parse(tr.startTime);
                const e = Date.parse(tr.endTime);
                if (!Number.isFinite(s) || !Number.isFinite(e) || s > e) continue;
                const mid = new Date((s + e) / 2);
                const x = xOf(mid);
                const bin = Math.round(x / binSize);
                const arr = bins.get(bin) || [];
                arr.push(c);
                bins.set(bin, arr);
              }

              const colorFor = (evt?: string) => evt === 'threshold-crossing' ? '#e74c3c' : evt === 'surge-event' ? '#f39c12' : '#3498db';
              const y = margins.t + 6; // top area

              const els: JSX.Element[] = [];
              let idx = 0;
              bins.forEach((arr, bin) => {
                const x = bin * binSize;
                if (arr.length === 1) {
                  const c = arr[0];
                  const tr = c.metadata?.timeRange;
                  if (!isCommentTimeRange(tr)) return;
                  const s = Date.parse(tr.startTime);
                  const e = Date.parse(tr.endTime);
                  if (!Number.isFinite(s) || !Number.isFinite(e) || s > e) return;
                  const mid = new Date((s + e) / 2);
                  const cx = xOf(mid);
                  const color = colorFor(tr.eventType);
                  els.push(
                    <g key={`cm-${c.id}-${idx++}`} transform={`translate(${cx}, ${y})`}>
                      <circle
                        className="comment-marker"
                        r={5}
                        fill={color}
                        stroke="#000"
                        role="button"
                        aria-label={`Comment ${c.authorDisplayName || 'unknown'}: ${c.content?.replace(/<[^>]+>/g,'').slice(0,40)}...`}
                        tabIndex={0}
                        onMouseEnter={() => onCommentHover?.(c)}
                        onMouseLeave={() => onCommentHover?.(null)}
                        onClick={() => onCommentClick?.(c)}
                        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onCommentClick?.(c)}
                        style={{ cursor: 'pointer' }}
                      />
                    </g>
                  );
                } else {
                  // cluster badge
                  const cx = Math.max(margins.l + 6, Math.min(margins.l + innerW - 6, x));
                  els.push(
                    <g key={`cluster-${bin}-${idx++}`} transform={`translate(${cx}, ${y})`}>
                      <circle r={8} fill="#7f8c8d" stroke="#000" />
                      <text x={-3.5} y={4} fontSize="10" fill="#fff">{arr.length}</text>
                    </g>
                  );
                }
              });

              return els;
            })()}
          </g>
        )}

        {/* Adjusted predictions (segmented by threshold, dashed) */}
        {adjustedPoints.length > 1 && segmentByThreshold(adjustedPoints, threshold).map((segment, i) => (
          <polyline
            key={`adj-${i}`}
            fill="none"
            stroke={segment.above ? '#e74c3c' : '#2ecc71'}
            strokeWidth="2"
            strokeDasharray="5 4"
            points={buildPolyline(segment.points, xOf, yOf)}
          />
        ))}

        {/* Delta series (past) */}
        {showDelta && deltaPoints.length > 1 && (
          <g>
            <line 
              x1={margins.l} 
              x2={margins.l + innerW} 
              y1={yOf(0)} 
              y2={yOf(0)} 
              stroke="#1976d2" 
              strokeDasharray="4 4" 
              opacity={0.5} 
            />
            <polyline 
              fill="none" 
              stroke="#1976d2" 
              strokeWidth="2" 
              points={buildPolyline(deltaPoints, xOf, yOf)} 
            />
          </g>
        )}

        {/* Future surge forecast (dashed) */}
        {showDelta && surgeForecastPoints.length > 1 && (
          <polyline
            fill="none"
            stroke="#1976d2"
            strokeWidth="2"
            strokeDasharray="5 4"
            opacity={0.9}
            points={buildPolyline(surgeForecastPoints, xOf, yOf)}
          />
        )}

        {/* Y-axis ticks and labels */}
        {Array.from({ length: 6 }).map((_, i) => {
          const value = yMinMax.min + (i / 5) * (yMinMax.max - yMinMax.min);
          const y = yOf(value);
          return (
            <g key={i}>
              <line 
                x1={margins.l} 
                x2={margins.l + innerW} 
                y1={y} 
                y2={y} 
                stroke="var(--chart-grid)" 
              />
              <text 
                x={4} 
                y={y + 4} 
                fill="var(--chart-axis-text)" 
                fontSize="12"
              >
                {value.toFixed(1)} ft
              </text>
            </g>
          );
        })}

        {/* Legend */}
        {innerW > 420 ? (
          <g transform={`translate(${margins.l}, ${size.h - 10})`}>
            <line x1={0} x2={20} y1={0} y2={0} stroke="#2ecc71" strokeWidth={2} />
            <text x={24} y={4} fill="var(--chart-label-text)" fontSize="12">Observed</text>
            <line x1={90} x2={110} y1={0} y2={0} stroke="#95a5a6" strokeWidth={2} />
            <text x={120} y={4} fill="var(--chart-label-text)" fontSize="12">Prediction</text>
            <line x1={210} x2={230} y1={0} y2={0} stroke="#2ecc71" strokeWidth={2} strokeDasharray="5 4" />
            <text x={240} y={4} fill="var(--chart-label-text)" fontSize="12">Adjusted prediction</text>
            {showDelta && (
              <>
                <line x1={380} x2={400} y1={0} y2={0} stroke="#1976d2" strokeWidth={2} />
                <text x={410} y={4} fill="var(--chart-label-text)" fontSize="12">Surge offset (past)</text>
                <line x1={520} x2={540} y1={0} y2={0} stroke="#1976d2" strokeWidth={2} strokeDasharray="5 4" />
                <text x={548} y={4} fill="var(--chart-label-text)" fontSize="12">Surge forecast</text>
              </>
            )}
          </g>
        ) : (
          <g>
            <g transform={`translate(${margins.l}, ${size.h - 24})`}>
              <line x1={0} x2={20} y1={0} y2={0} stroke="#2ecc71" strokeWidth={2} />
              <text x={24} y={4} fill="var(--chart-label-text)" fontSize="12">Observed</text>
              <line x1={120} x2={140} y1={0} y2={0} stroke="#95a5a6" strokeWidth={2} />
              <text x={144} y={4} fill="var(--chart-label-text)" fontSize="12">Prediction</text>
            </g>
            <g transform={`translate(${margins.l}, ${size.h - 8})`}>
              <line x1={0} x2={20} y1={0} y2={0} stroke="#2ecc71" strokeWidth={2} strokeDasharray="5 4" />
              <text x={24} y={4} fill="var(--chart-label-text)" fontSize="12">Adjusted prediction</text>
              {showDelta && (
                <>
                  <line x1={180} x2={200} y1={0} y2={0} stroke="#1976d2" strokeWidth={2} />
                  <text x={204} y={4} fill="var(--chart-label-text)" fontSize="12">Surge offset (past)</text>
                  <line x1={320} x2={340} y1={0} y2={0} stroke="#1976d2" strokeWidth={2} strokeDasharray="5 4" />
                  <text x={344} y={4} fill="var(--chart-label-text)" fontSize="12">Surge forecast</text>
                </>
              )}
            </g>
          </g>
        )}

        {/* Interactive tooltip */}
        {(tooltipData || (showComments && comments.length > 0)) && hoverT && (
          <g>
            {/* Crosshair */}
            <line 
              x1={xOf(hoverT)} 
              x2={xOf(hoverT)} 
              y1={margins.t} 
              y2={margins.t + innerH} 
              stroke="#bbb" 
              strokeDasharray="3 3" 
            />

            {/* Data point markers */}
            {tooltipData?.rows?.map((row, i) => (
              row.point && (
                <circle 
                  key={`marker-${i}`}
                  cx={xOf(row.point.t)} 
                  cy={yOf(row.point.v)} 
                  r={3.5} 
                  fill={row.color} 
                  stroke="#000" 
                />
              )
            ))}

            {/* Tooltip box */}
            {(() => {
              const baseX = xOf(hoverT) + 8;
              const baseY = margins.t + 8;
              const boxWidth = 220;
              const lineHeight = 14;
              const rowsCount = tooltipData ? tooltipData.rows.length : 0;
              const commentTip = showComments ? calculateCommentTooltipData(hoverT, comments, { max: 3 }) : null;
              const commentRows = commentTip ? Math.min(3, commentTip.preview.length) + 1 : 0;
              const boxHeight = (rowsCount + 1 + commentRows) * lineHeight + 12;
              const adjustedX = Math.min(baseX, margins.l + innerW - boxWidth - 4);

              return (
                <g>
                  <rect 
                    x={adjustedX} 
                    y={baseY} 
                    width={boxWidth} 
                    height={boxHeight} 
                    rx={6} 
                    ry={6} 
                    fill="var(--chart-tooltip-bg)" 
                    stroke="var(--chart-tooltip-stroke)" 
                  />
                  <text 
                    x={adjustedX + 8} 
                    y={baseY + 16} 
                    fill="var(--chart-label-text)" 
                    fontSize="12"
                  >
                    {formatTooltipTime(hoverT, timezone)} {timezone === 'gmt' ? 'GMT' : ''}
                  </text>
                  {tooltipData && tooltipData.rows.map((row, i) => (
                    <g key={`tooltip-row-${i}`}>
                      <line
                        x1={adjustedX + 6}
                        x2={adjustedX + 16}
                        y1={baseY + 30 + i * lineHeight - 4}
                        y2={baseY + 30 + i * lineHeight - 4}
                        stroke={row.color}
                        strokeWidth={2}
                        strokeDasharray={row.dashed ? '5 4' : undefined}
                      />
                      <text 
                        x={adjustedX + 20} 
                        y={baseY + 30 + i * lineHeight} 
                        fill="var(--chart-label-text)" 
                        fontSize="12"
                      >
                        {row.label}: {row.value}
                      </text>
                    </g>
                  ))}
                  {commentTip && (
                    <>
                      <line x1={adjustedX + 6} x2={adjustedX + boxWidth - 6} y1={baseY + 30 + rowsCount * lineHeight - 8} y2={baseY + 30 + rowsCount * lineHeight - 8} stroke="var(--chart-grid)" />
                      <text x={adjustedX + 8} y={baseY + 30 + rowsCount * lineHeight} fill="var(--chart-label-text)" fontSize="12">
                        Comments: {commentTip.total}
                      </text>
                      {commentTip.preview.map((c, j) => (
                        <text key={`ctip-${c.id}`} x={adjustedX + 8} y={baseY + 30 + (rowsCount + 1 + j) * lineHeight} fill="var(--chart-axis-text)" fontSize="11">
                          {c.author}: {c.contentPreview}
                        </text>
                      ))}
                    </>
                  )}
                </g>
              );
            })()}
          </g>
        )}
      </svg>
      {/* Floating controls */}
      <div className="chart-comment-controls" role="group" aria-label="Comment overlay controls">
        <IonButtons>
          <IonButton onClick={onToggleComments} aria-label={showComments ? 'Hide comments (C)' : 'Show comments (C)'}>
            <IonIcon icon={showComments ? eye : eyeOff} />
            {typeof commentCount === 'number' && <IonBadge color="medium" style={{ marginLeft: 6 }}>{commentCount}</IonBadge>}
          </IonButton>
          <IonButton onClick={onToggleCreationMode} aria-label={commentCreationMode ? 'Disable creation mode (N)' : 'Enable creation mode (N)'} color={commentCreationMode ? 'primary' : undefined}>
            <IonIcon icon={addCircleOutline} />
          </IonButton>
          <IonButton disabled aria-label="Comments">
            <IonIcon icon={chatbubbleOutline} />
          </IonButton>
        </IonButtons>
      </div>
    </div>
  );
};

export default ChartViewer;

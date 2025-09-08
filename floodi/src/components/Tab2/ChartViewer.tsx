import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import type { Point, ChartConfig } from './types';
import { useChartInteraction, formatTooltipTime } from './hooks/useChartInteraction';

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
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 900, h: 420 });

  const { hoverT, setHoverT, calculateTooltipData } = useChartInteraction();

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
  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const pixelX = event.clientX - rect.left;
    const fraction = Math.max(0, Math.min(1, (pixelX - margins.l * (rect.width / size.w)) / (innerW * (rect.width / size.w))));
    const timeMs = t0 + fraction * (t1 - t0);
    const hoverTime = new Date(timeMs);

    setHoverT(hoverTime);
    if (onChartInteraction) {
      // Find nearest point for callback
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
  };

  // Tooltip data calculation
  const tooltipData = useMemo(() => {
    if (!hoverT) return null;
    return calculateTooltipData(hoverT, observedPoints, predictedPoints, adjustedPoints, deltaPoints, threshold, showDelta);
  }, [hoverT, observedPoints, predictedPoints, adjustedPoints, deltaPoints, threshold, showDelta, calculateTooltipData]);

  return (
    <div className="chart-viewer" ref={containerRef}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${size.w} ${size.h}`}
        width={size.w}
        height={size.h}
        role="img"
        aria-label="Water level chart showing observed, predicted, and adjusted predictions over time"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
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
        {tooltipData && hoverT && (
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
            {tooltipData.rows.map((row, i) => (
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
              const boxWidth = 170;
              const lineHeight = 14;
              const boxHeight = (tooltipData.rows.length + 1) * lineHeight + 8;
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
                  {tooltipData.rows.map((row, i) => (
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
                </g>
              );
            })()}
          </g>
        )}
      </svg>
    </div>
  );
};

export default ChartViewer;

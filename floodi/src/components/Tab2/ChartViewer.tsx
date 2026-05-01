import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import type { Point, ChartConfig, WindPoint, PrecipPoint } from './types';
import { useChartInteraction, formatTooltipTime, findNearestPoint } from './hooks/useChartInteraction';
import { isCommentTimeRange, type Comment, type CommentTimeRange } from 'src/types/comment';
import { getTimeRangeFromChartSelection } from 'src/utils/timeRangeHelpers';
import { IonBadge, IonButton, IonButtons, IonIcon, IonText } from '@ionic/react';
import { addCircleOutline, chatbubbleOutline, eye, eyeOff, refreshOutline, syncOutline } from 'ionicons/icons';

/** Convert a meteorological bearing (0° = N, clockwise) to a compass label */
const COMPASS_DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
function degToCompass(deg: number): string {
  return COMPASS_DIRS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

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
  /** Hourly wind vector points */
  windPoints?: WindPoint[];
  /** Hourly precipitation accumulation points */
  precipPoints?: PrecipPoint[];
  /** Time domain start */
  domainStart: Date;
  /** Time domain end */
  domainEnd: Date;
  /** Current time marker */
  now: Date;
  /** Flood threshold levels */
  thresholds: ChartConfig['thresholds'];
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
  /** Fire when clicking a comment marker or cluster */
  onCommentClick?: (comments: Comment[]) => void;
  /** Fire when a time point is selected for comment creation */
  onTimePointSelect?: (time: Date, level?: number) => void;
  /** Handlers for in-component controls (optional) */
  onToggleComments?: () => void;
  /** Count for display in the overlay controls */
  commentCount?: number;
  /** Fire when domain needs to change due to pan/zoom out of bounds */
  onDomainChangeRequest?: (start: Date, end: Date) => void;
  /** Fire when the hover cursor moves */
  onHoverTimeChange?: (time: Date | null) => void;
  /** Fire when the visible viewport changes (immediate) */
  onViewportChange?: (start: Date, end: Date, focusTime: Date) => void;
  /** Global time range mode */
  mode?: 'relative' | 'absolute';
  /** Fire to reset to relative (live) time */
  onResetToLive?: () => void;
  /** Currently selected/simulation time (for scroll line) */
  selectedTime?: Date | null;
  /** Request to scroll the chart to center on a specific time */
  centerRequest?: { time: Date; id: number };
  /** Explicit trigger to reset pan state */
  resetKey?: number;
  /** Complete time range configuration for stable markers */
  timeRange?: {
    mode: 'relative' | 'absolute';
    lookbackH: number;
    lookaheadH: number;
  };
  /** List of data fetching warnings */
  warnings?: string[];
  /** View mode setting */
  viewMode?: 'basic' | 'advanced';
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
 * Generate time ticks for the X-axis based on domain duration
 */
function generateTimeTicks(start: Date, end: Date): Date[] {
  const durationMs = end.getTime() - start.getTime();
  const ticks: Date[] = [];
  
  // Decide interval based on duration
  let intervalMs: number;
  if (durationMs <= 3 * 3600000) intervalMs = 1800000; // 30 min
  else if (durationMs <= 12 * 3600000) intervalMs = 3600000; // 1 hr
  else if (durationMs <= 36 * 3600000) intervalMs = 3 * 3600000; // 3 hr
  else if (durationMs <= 72 * 3600000) intervalMs = 6 * 3600000; // 6 hr
  else if (durationMs <= 144 * 3600000) intervalMs = 12 * 3600000; // 12 hr
  else intervalMs = 24 * 3600000; // 24 hr

  const firstTick = new Date(Math.ceil(start.getTime() / intervalMs) * intervalMs);
  for (let t = firstTick.getTime(); t <= end.getTime(); t += intervalMs) {
    ticks.push(new Date(t));
  }
  return ticks;
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
  windPoints = [],
  precipPoints = [],
  domainStart,
  domainEnd,
  now,
  thresholds,
  showDelta,
  timezone,
  config = {},
  onChartInteraction,
  // comment integration (optional)
  showComments = false,
  comments = [],
  onCommentHover,
  onCommentClick,
  onTimePointSelect,
  onToggleComments,
  commentCount,
  onDomainChangeRequest,
  onHoverTimeChange,
  onViewportChange,
  mode,
  onResetToLive,
  selectedTime,
  centerRequest,
  resetKey,
  timeRange,
  viewMode = 'basic',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 900, h: 420 });

  const { hoverT, setHoverT, calculateTooltipData, calculateCommentTooltipData } = useChartInteraction();

  // Detect touch-primary devices (iOS / Android) once at mount
  const isTouchDeviceRef = useRef(
    typeof window !== 'undefined' &&
      (navigator.maxTouchPoints > 0 || 'ontouchstart' in window)
  );

  // Touch interaction state for tap detection
  // Using refs (not state) so that updates are synchronous and immediately
  // visible to the next pointer event handler — critical on mobile where
  // pointermove fires at 60+ fps and useState batching causes stale closures.
  const pointerDownPosRef = useRef<{ x: number, y: number, t: Date } | null>(null);

  // Pan and Zoom internal state (refs for same reason as above)
  const [viewDomain, setViewDomain] = useState<{ start: Date, end: Date } | null>(null);
  const panStateRef = useRef<{ startX: number, startT0: number, startT1: number } | null>(null);
  const wheelTimeoutRef = useRef<any>(null);

  // Multi-touch interaction state
  const activePointersRef = useRef(new Map<number, { x: number; y: number }>());

  // Manage local view domain vs parent domain
  useEffect(() => {
    // If the props (from a fetch) now match our local viewDomain, we can clear the override
    // to let the props drive the view again (preventing 'zoom out' or 'snap' effects).
    if (viewDomain) {
      const dv0 = Math.abs(viewDomain.start.getTime() - domainStart.getTime());
      const dv1 = Math.abs(viewDomain.end.getTime() - domainEnd.getTime());
      // 1000ms threshold to handle rounding/ISO string jitter
      if (dv0 < 1000 && dv1 < 1000) {
        setViewDomain(null);
      }
    }
  }, [domainStart.getTime(), domainEnd.getTime()]);

  // Calculate where the "viewing line" should be based on the initial 'now' position
  const nowRatio = useMemo(() => {
    // We use the config's lookback/lookahead to determine a perfectly stable playhead position.
    // This prevents the "drift" caused by the real-time 'now' advancing or switching to absolute mode.
    if (timeRange) {
      const { lookbackH, lookaheadH } = timeRange;
      const total = lookbackH + lookaheadH;
      if (total > 0) return lookbackH / total;
    }
    // Default to 1/3 if no config available
    return 0.333;
  }, [timeRange?.lookbackH, timeRange?.lookaheadH]); 

  // Handle center requests
  useEffect(() => {
    if (centerRequest) {
      const activeStart = viewDomain?.start || domainStart;
      const activeEnd = viewDomain?.end || domainEnd;
      const durationMs = activeEnd.getTime() - activeStart.getTime();
      const newStart = new Date(centerRequest.time.getTime() - durationMs * nowRatio);
      const newEnd = new Date(centerRequest.time.getTime() + durationMs * (1 - nowRatio));
      setViewDomain({ start: newStart, end: newEnd });
    }
  }, [centerRequest]);

  // Handle explicit reset requests
  useEffect(() => {
    if (resetKey !== undefined && resetKey > 0) {
      setViewDomain(null);
    }
  }, [resetKey]);

  const activeStart = viewDomain?.start || domainStart;
  const activeEnd = viewDomain?.end || domainEnd;

  // Calculate the time at the center of the viewport (the blue focus line)
  const centerTime = useMemo(() => {
    const t0 = activeStart.getTime();
    const t1 = activeEnd.getTime();
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) return now;
    return new Date(t0 + (t1 - t0) * nowRatio);
  }, [activeStart, activeEnd, nowRatio, now]);

  // Find water level at the center point for the button label
  const centerLevel = useMemo(() => {
    const obsRes = findNearestPoint(observedPoints, centerTime);
    const adjRes = findNearestPoint(adjustedPoints, centerTime);
    const predRes = findNearestPoint(predictedPoints, centerTime);

    if (obsRes && obsRes.dtMin < 60) return obsRes.point.v;
    if (adjRes && adjRes.dtMin < 60) return adjRes.point.v;
    if (predRes && predRes.dtMin < 60) return predRes.point.v;
    return null;
  }, [centerTime, observedPoints, adjustedPoints, predictedPoints]);

  const lastViewportChangeRef = useRef<number>(0);

  // Immediate notification of viewport changes to parent for simulation sync
  useEffect(() => {
    if (!onViewportChange) return;
    const nowMs = Date.now();
    const timeSinceLast = nowMs - lastViewportChangeRef.current;
    
    if (timeSinceLast >= 50) {
      onViewportChange(activeStart, activeEnd, centerTime);
      lastViewportChangeRef.current = nowMs;
    } else {
      const timer = setTimeout(() => {
        onViewportChange(activeStart, activeEnd, centerTime);
        lastViewportChangeRef.current = Date.now();
      }, 50 - timeSinceLast);
      return () => clearTimeout(timer);
    }
  }, [activeStart.getTime(), activeEnd.getTime(), centerTime, onViewportChange]);

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

  // Height of the atmospheric strip (precip + wind) at the very bottom of the chart
  const ATMO_STRIP_H = 44;

  // Chart dimensions and scaling
  const chartConfig = useMemo((): ChartConfig => {
    const baseBottom = size.w <= 480 ? 48 : 30;
    return {
      size,
      margins: { l: 50, r: 20, t: 25, b: baseBottom + ATMO_STRIP_H + 6 },
      thresholds,
      showDelta,
      timezone,
      ...config,
    };
  }, [size, thresholds, showDelta, timezone, config, ATMO_STRIP_H]);

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
      ...Object.values(thresholds),
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
  }, [observedPoints, adjustedPoints, predictedPoints, deltaPoints, thresholds, showDelta]);

  // Scaling functions
  const t0 = activeStart.getTime();
  const t1 = activeEnd.getTime();
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
      const prevAbove = previous.v >= thresholds.minor;
      const currAbove = current.v >= thresholds.minor;

      if (!isAbove && (prevAbove || (!prevAbove && currAbove))) {
        // Entering flood zone
        let startTime = previous.t;
        if (!prevAbove && currAbove && current.v !== previous.v) {
          const fraction = (thresholds.minor - previous.v) / (current.v - previous.v);
          startTime = new Date(previous.t.getTime() + fraction * (current.t.getTime() - previous.t.getTime()));
        }
        segmentStart = startTime;
        isAbove = true;
      }

      if (isAbove && !currAbove) {
        // Leaving flood zone
        let endTime = current.t;
        if (current.v !== previous.v) {
          const fraction = (thresholds.minor - previous.v) / (current.v - previous.v);
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
  }, [adjustedPoints, thresholds.minor, xOf, domainEnd]);

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
    // Update pointer position in registry
    activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const svg = svgRef.current;
    if (!svg) return;

    // On touch devices, suppress hover crosshair/tooltip – it doesn't make sense without a cursor
    if (!isTouchDeviceRef.current || event.pointerType === 'mouse') {
      const hoverTime = computeTimeAtPointer(event);
      if (hoverTime) {
        setHoverT(hoverTime);
        onHoverTimeChange?.(hoverTime);
      } else {
        setHoverT(null);
        onHoverTimeChange?.(null);
      }

      if (onChartInteraction && hoverTime) {
        const nearestDelta = findNearestPoint(deltaPoints, hoverTime);
        const nearestObs = findNearestPoint(observedPoints, hoverTime);
        onChartInteraction(nearestObs?.point || nearestDelta?.point || null);
      }
    }

    // ─── Mouse Pan ───
    if (event.pointerType === 'mouse' && panStateRef.current) {
      const dx = event.clientX - panStateRef.current.startX;
      const rect = svg.getBoundingClientRect();
      const scaleX = rect.width / size.w;
      const timeShift = -(dx / scaleX) / innerW * (panStateRef.current.startT1 - panStateRef.current.startT0);
      setViewDomain({
        start: new Date(panStateRef.current.startT0 + timeShift),
        end: new Date(panStateRef.current.startT1 + timeShift)
      });
    }
  };

  const persistDomainChange = useCallback(() => {
    if (!viewDomain) return;
    const v0 = viewDomain.start.getTime();
    const v1 = viewDomain.end.getTime();
    const d0 = domainStart.getTime();
    const d1 = domainEnd.getTime();

    // Notify parent about the domain change. 
    // We simply request the exact view domain we are looking at (shifting).
    // The useChartData hook will handle fetching extra buffer for us.
    if (Math.abs(v0 - d0) > 1000 || Math.abs(v1 - d1) > 1000) {
      onDomainChangeRequest?.(viewDomain.start, viewDomain.end);
    }
  }, [viewDomain, domainStart.getTime(), domainEnd.getTime(), onDomainChangeRequest]);

  const persistRef = useRef(persistDomainChange);
  persistRef.current = persistDomainChange;

  // Automatically persist domain changes after a short debounce period (e.g. stop scrolling)
  useEffect(() => {
    if (!viewDomain) return;
    const timer = setTimeout(() => persistRef.current(), 300);
    return () => clearTimeout(timer);
  }, [viewDomain]);

  const handlePointerLeave = () => {
    setHoverT(null);
    onHoverTimeChange?.(null);
    if (onChartInteraction) {
      onChartInteraction(null);
    }
    if (panStateRef.current) {
      panStateRef.current = null;
      persistDomainChange();
    }
    pointerDownPosRef.current = null;
    activePointersRef.current.clear();
  };

  /**
   * Fired when the browser cancels an in-progress pointer gesture (e.g. the OS
   * takes over the touch for a notification or the gesture is declared a scroll by
   * the browser). Clean up all interaction state so the chart doesn't get stuck
   * in a "panning" state with stale coordinates.
   */
  const handlePointerCancel = (event: React.PointerEvent<SVGSVGElement>) => {
    activePointersRef.current.delete(event.pointerId);
    panStateRef.current = null;
    pointerDownPosRef.current = null;
    setHoverT(null);
    onHoverTimeChange?.(null);
  };

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const t = computeTimeAtPointer(event);
    if (!t) return;

    // For mouse, we start panning immediately
    if (event.pointerType === 'mouse') {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch (e) { /* Ignore capture errors */ }
      panStateRef.current = { startX: event.clientX, startT0: t0, startT1: t1 };
    }

    pointerDownPosRef.current = { x: event.clientX, y: event.clientY, t };
  };

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    activePointersRef.current.delete(event.pointerId);

    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch (e) { /* Ignore release errors */ }

    if (panStateRef.current) {
      panStateRef.current = null;
      persistDomainChange();
    }

    const pos = pointerDownPosRef.current;
    if (pos) {
      const dx = event.clientX - pos.x;
      const dy = event.clientY - pos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Tap detection (single pointer) - NO LONGER TRIGGERS onTimePointSelect
      // We only use pointer up to clear pan state and calculate distance.
      pointerDownPosRef.current = null;
    }
  };

  // Stable refs so native touch handlers always see current values without
  // needing to re-register listeners (which would cause flicker on mobile).
  const t0Ref = useRef(t0);
  const t1Ref = useRef(t1);
  const innerWRef = useRef(innerW);
  const sizeRef = useRef(size);
  const marginsRef = useRef(margins);
  t0Ref.current = t0;
  t1Ref.current = t1;
  innerWRef.current = innerW;
  sizeRef.current = size;
  marginsRef.current = margins;

  // Native touch + wheel handlers.
  //
  // Touch panning is handled here (not via React's onPointerDown/Move) because
  // Ionic's IonContent installs its own native `touchstart` listeners that
  // claim scroll gestures before React's synthetic pointer events fire.
  // Using native addEventListener with `passive: false` + `preventDefault()`
  // lets us intercept the gesture first, before IonContent's scroll engine.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    // ── Touch pan state (kept in the effect closure for zero-overhead access) ──
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartT0 = 0;
    let touchStartT1 = 0;
    let isHorizontalPan = false;
    let isVerticalScroll = false;
    
    let pinchStartDist = 0;
    let pinchStartT0 = 0;
    let pinchStartT1 = 0;
    let pinchStartMidTime = 0;
    let pinchStartMidX = 0;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        // Single finger – start tracking. We DO NOT call preventDefault() here
        // so that vertical scrolling is allowed to start. We will conditionally
        // call preventDefault() in onTouchMove if it's a horizontal pan.
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartT0 = t0Ref.current;
        touchStartT1 = t1Ref.current;
        pinchStartDist = 0; // reset pinch
        isHorizontalPan = false;
        isVerticalScroll = false;
      } else if (e.touches.length === 2) {
        if (e.cancelable) e.preventDefault();
        const dx = e.touches[1].clientX - e.touches[0].clientX;
        const dy = e.touches[1].clientY - e.touches[0].clientY;
        pinchStartDist = Math.hypot(dx, dy);
        pinchStartT0 = t0Ref.current;
        pinchStartT1 = t1Ref.current;
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        pinchStartMidX = midX;
        const rect = svg.getBoundingClientRect();
        const sw = sizeRef.current.w;
        const iw = innerWRef.current;
        const ml = marginsRef.current.l;
        const fraction = Math.max(0, Math.min(1,
          (midX - rect.left - ml * (rect.width / sw)) / (iw * (rect.width / sw))
        ));
        pinchStartMidTime = pinchStartT0 + fraction * (pinchStartT1 - pinchStartT0);
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      const rect = svg.getBoundingClientRect();
      const sw = sizeRef.current.w;
      const iw = innerWRef.current;
      const ml = marginsRef.current.l;
      const scaleX = rect.width / sw;

      if (e.touches.length === 1 && touchStartT1 > touchStartT0) {
        if (isVerticalScroll) return; // Allow browser to scroll vertically

        const dx = e.touches[0].clientX - touchStartX;
        const dy = e.touches[0].clientY - touchStartY;

        if (!isHorizontalPan && !isVerticalScroll) {
          // Lock direction after moving at least 4 pixels
          if (Math.abs(dy) > 4 && Math.abs(dy) > Math.abs(dx)) {
            isVerticalScroll = true;
            return;
          } else if (Math.abs(dx) > 4 && Math.abs(dx) > Math.abs(dy)) {
            isHorizontalPan = true;
          }
        }

        if (isHorizontalPan || (Math.abs(dx) > 0 && Math.abs(dx) > Math.abs(dy))) {
          if (e.cancelable) e.preventDefault();
          // dx in CSS pixels → SVG units → fraction of domain
          const timeShift = -(dx / scaleX) / iw * (touchStartT1 - touchStartT0);
          setViewDomain({
            start: new Date(touchStartT0 + timeShift),
            end:   new Date(touchStartT1 + timeShift),
          });
        }
      } else if (e.touches.length === 2 && pinchStartDist > 0) {
        if (e.cancelable) e.preventDefault();
        const dx2 = e.touches[1].clientX - e.touches[0].clientX;
        const dy2 = e.touches[1].clientY - e.touches[0].clientY;
        const dist = Math.hypot(dx2, dy2);
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;

        if (dist > 0) {
          const zoomRatio = pinchStartDist / dist;
          const span = (pinchStartT1 - pinchStartT0) * zoomRatio;
          const t0z = pinchStartMidTime - (pinchStartMidTime - pinchStartT0) * zoomRatio;
          const t1z = pinchStartMidTime + (pinchStartT1 - pinchStartMidTime) * zoomRatio;
          const panShift = -((midX - pinchStartMidX) / scaleX) / iw * span;
          setViewDomain({
            start: new Date(t0z + panShift),
            end:   new Date(t1z + panShift),
          });
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        // All fingers lifted – persist the final domain
        persistRef.current();
        touchStartT0 = 0;
        touchStartT1 = 0;
        pinchStartDist = 0;
      }
    };

    // ── Wheel (trackpad horizontal swipe + pinch zoom) ──
    const onWheel = (e: WheelEvent) => {
      const rect = svg.getBoundingClientRect();
      const sw = sizeRef.current.w;
      const iw = innerWRef.current;
      const ml = marginsRef.current.l;
      const pixelX = e.clientX - rect.left;
      const fraction = Math.max(0, Math.min(1,
        (pixelX - ml * (rect.width / sw)) / (iw * (rect.width / sw))
      ));
      const cur0 = t0Ref.current;
      const cur1 = t1Ref.current;

      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && !e.ctrlKey) {
        const scaleX = rect.width / sw;
        const timeShift = (e.deltaX / scaleX) / iw * (cur1 - cur0);
        setViewDomain({ start: new Date(cur0 + timeShift), end: new Date(cur1 + timeShift) });
        return;
      }
      if (!e.ctrlKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) return;

      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
      const cursorTime = cur0 + fraction * (cur1 - cur0);
      setViewDomain({
        start: new Date(cursorTime - (cursorTime - cur0) * zoomFactor),
        end:   new Date(cursorTime + (cur1 - cursorTime) * zoomFactor),
      });
    };

    svg.addEventListener('touchstart', onTouchStart, { passive: false });
    svg.addEventListener('touchmove',  onTouchMove,  { passive: false });
    svg.addEventListener('touchend',   onTouchEnd,   { passive: true  });
    svg.addEventListener('wheel',      onWheel,      { passive: false });

    return () => {
      svg.removeEventListener('touchstart', onTouchStart);
      svg.removeEventListener('touchmove',  onTouchMove);
      svg.removeEventListener('touchend',   onTouchEnd);
      svg.removeEventListener('wheel',      onWheel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty – all current values accessed via refs

  // Tooltip data calculation
  const tooltipData = useMemo(() => {
    if (!hoverT) return null;
    return calculateTooltipData(hoverT, observedPoints, predictedPoints, adjustedPoints, deltaPoints, now, thresholds.minor, showDelta, viewMode);
  }, [hoverT, observedPoints, predictedPoints, adjustedPoints, deltaPoints, thresholds.minor, showDelta, viewMode, calculateTooltipData]);

  /** Handle reset of both local zoom and global absolute range */
  const handleReset = () => {
    setViewDomain(null);
    onResetToLive?.();
  };

  const handleContainerKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const k = e.key.toLowerCase();
    if (k === 'c') onToggleComments?.();
  };

  return (
    <div className="chart-viewer" ref={containerRef} onKeyDown={handleContainerKeyDown} tabIndex={0} aria-keyshortcuts="C N" style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}>

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
        onPointerCancel={handlePointerCancel}
        // touch-action: pan-y — allow the browser to naturally handle vertical scrolling
        // over the chart, but defer horizontal gestures to our custom pointer/touch events.
        // Once a horizontal pan is detected, e.preventDefault() in onTouchMove stops
        // the browser from cancelling the gesture.
        style={{ touchAction: 'pan-y', cursor: isTouchDeviceRef.current ? 'default' : 'crosshair' }}
      >
        {/* Background */}
        <rect x={0} y={0} width={size.w} height={size.h} fill="var(--chart-bg)" />

        {/* ─── Atmospheric strip: precipitation bars + wind arrows (below plot area) ─── */}
        {(() => {
          if (precipPoints.length === 0 && windPoints.length === 0) return null;

          // Strip sits just below the plot area
          const stripTop = margins.t + innerH + 4;
          const stripH = ATMO_STRIP_H;
          const precipH = stripH * 0.60;
          const windY = stripTop + 13; // wind arrows in upper portion

          const maxPrecip = Math.max(0.01, ...precipPoints.map(p => p.value));

          return (
            <g aria-label="Atmospheric data strip">
              {/* Removed Strip background */}

              {/* Label */}
              <text x={margins.l + 4} y={stripTop + 10} fontSize={9}
                fill="rgba(140,180,220,0.8)" fontFamily="monospace">PRECIP / WIND</text>

              {/* ── Precipitation bars (grow upward from strip bottom) ── */}
              {precipPoints.map((pp, i) => {
                if (pp.value <= 0) return null;
                const cx = xOf(pp.t);
                if (cx < margins.l || cx > margins.l + innerW) return null;
                const barH = Math.max(1, (pp.value / maxPrecip) * precipH * 0.85);
                const nextT = precipPoints[i + 1]?.t;
                const barW = nextT
                  ? Math.max(2, Math.min(32, xOf(nextT) - cx - 2))
                  : 8;
                const opacity = 0.4 + (pp.value / maxPrecip) * 0.55;
                return (
                  <rect
                    key={`precip-${i}`}
                    x={cx - barW / 2}
                    y={stripTop + stripH - barH}
                    width={barW}
                    height={barH}
                    fill={`rgba(80,160,240,${opacity.toFixed(2)})`}
                    rx={1}
                  />
                );
              })}

              {/* ── Wind arrows ── */}
              {(() => {
                // Render arrows based on a fixed time interval (e.g. 3 hours)
                // rather than index, to handle varying data densities (6m vs 1h).
                const ARROW_INTERVAL_MS = 3 * 3600000;
                const arrows: React.ReactElement[] = [];
                
                // Track last time an arrow was placed
                let lastPlacedMs = 0;

                windPoints.forEach((wp, i) => {
                  const cx = xOf(wp.t);
                  if (cx < margins.l + 6 || cx > margins.l + innerW - 6) return;

                  const tMs = wp.t.getTime();
                  if (tMs - lastPlacedMs < ARROW_INTERVAL_MS * 0.9) return; // 0.9 for slight tolerance

                  lastPlacedMs = tMs;

                  const maxSpeed = 50;
                  const arrowLen = 8 + Math.min(14, (wp.speed / maxSpeed) * 14);
                  const rot = wp.dir + 180;
                  const t = Math.min(1, wp.speed / 35);
                  const r = Math.round(t * 220);
                  const g = Math.round((1 - t) * 180 + t * 80);
                  const b = Math.round((1 - t) * 220);
                  const arrowColor = `rgb(${r},${g},${b})`;

                  arrows.push(
                    <g key={`wind-${i}`} transform={`translate(${cx},${windY}) rotate(${rot})`}>
                      <line x1={0} y1={arrowLen / 2} x2={0} y2={-arrowLen / 2}
                        stroke={arrowColor} strokeWidth={1.5} />
                      <polygon
                        points={`0,${-arrowLen / 2 - 4} -3,${-arrowLen / 2 + 2} 3,${-arrowLen / 2 + 2}`}
                        fill={arrowColor}
                      />
                    </g>
                  );
                });
                return arrows;
              })()}
            </g>
          );
        })()}

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

        {/* Flood Visual Indicators */}
        {thresholds && [
          { label: 'Minor Flooding', ft: thresholds.minor, color: '#ffdc1e' },
          { label: 'Moderate Flooding', ft: thresholds.moderate, color: '#ffa500' },
          { label: 'Major Flooding', ft: thresholds.major, color: '#d22323' },
          { label: 'Extreme Flooding', ft: thresholds.extreme, color: '#a020f0' }
        ].map(({ label, ft, color }) => (
          <g key={label}>
            <line
              x1={margins.l}
              x2={margins.l + innerW}
              y1={yOf(ft)}
              y2={yOf(ft)}
              stroke={color}
              strokeDasharray="4 4"
              opacity={0.6}
            />
            <text
              x={margins.l + 4}
              y={yOf(ft) - 4}
              fill={color}
              fontSize="12"
              fontWeight="900"
              style={{ 
                paintOrder: 'stroke',
                stroke: 'var(--chart-bg, #ffffff)',
                strokeWidth: '4px',
                strokeLinecap: 'round',
                strokeLinejoin: 'round'
              }}
            >
              {label.replace(' Flooding', '').toUpperCase()} {ft.toFixed(1)}'
            </text>
          </g>
        ))}


        {/* Data series */}

        {/* Surge Fill (Area between observed and predicted) */}
        {viewMode === 'advanced' && observedPoints.length > 1 && predictedPoints.length > 1 && (() => {
          const maxObsT = observedPoints[observedPoints.length - 1].t.getTime();
          const matchingPredicted = predictedPoints.filter(p => p.t.getTime() <= maxObsT);

          if (matchingPredicted.length < 2) return null;

          const obsPath = observedPoints.map(p => `${xOf(p.t)},${yOf(p.v)}`).join(' ');
          const predPath = [...matchingPredicted].reverse().map(p => `${xOf(p.t)},${yOf(p.v)}`).join(' ');

          return (
            <polygon
              points={`${obsPath} ${predPath}`}
              fill="rgba(25, 118, 210, 0.15)"
            />
          );
        })()}

        {/* Observed data (segmented by threshold) */}
        {observedPoints.length > 1 && thresholds && segmentByThreshold(observedPoints, thresholds.minor).map((segment, i) => (
          <polyline
            key={`obs-${i}`}
            fill="none"
            stroke={segment.above ? '#e74c3c' : '#2ecc71'}
            strokeWidth="2"
            points={buildPolyline(segment.points, xOf, yOf)}
          />
        ))}

        {/* Predicted data */}
        {viewMode === 'advanced' && predictedPoints.length > 1 && (
          <polyline
            fill="none"
            stroke="#95a5a6"
            strokeWidth="2"
            opacity={0.9}
            points={buildPolyline(predictedPoints, xOf, yOf)}
          />
        )}

        {/* Removed selection overlay, we only use point-in-time taps now */}

        {/* Comment markers */}
        {showComments && comments.length > 0 && (
          <g aria-label="Comment markers" className="chart-comment-markers">
            {(() => {
              // Stable clustering by absolute time buckets (e.g. 30 mins)
              // rather than pixel bins which change during scroll.
              const timeBins = new Map<number, Comment[]>();
              const bucketMs = 30 * 60000; // 30 minute buckets
              
              for (const c of comments) {
                const tr = c.metadata?.timeRange;
                if (!isCommentTimeRange(tr)) continue;
                const s = Date.parse(tr.startTime);
                const e = Date.parse(tr.endTime);
                if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
                const midMs = (s + e) / 2;
                const bucket = Math.floor(midMs / bucketMs);
                const arr = timeBins.get(bucket) || [];
                arr.push(c);
                timeBins.set(bucket, arr);
              }

              const colorFor = (evt?: string) => evt === 'threshold-crossing' ? '#e74c3c' : evt === 'surge-event' ? '#f39c12' : '#3498db';

              const getNearestObservedY = (timeMs: number) => {
                const obsRes = findNearestPoint(observedPoints, new Date(timeMs));
                const adjRes = findNearestPoint(adjustedPoints, new Date(timeMs));
                const predRes = findNearestPoint(predictedPoints, new Date(timeMs));
                
                let v = 0;
                if (obsRes && obsRes.dtMin < 60) v = obsRes.point.v;
                else if (adjRes && adjRes.dtMin < 60) v = adjRes.point.v;
                else if (predRes && predRes.dtMin < 60) v = predRes.point.v;
                else return margins.t + 6;

                return yOf(v);
              };

              const els: React.ReactElement[] = [];
              let idx = 0;
              timeBins.forEach((arr, bucket) => {
                // Calculate position for the cluster or single marker
                let displayTimeMs: number;
                let color: string;
                const isCluster = arr.length > 1;

                if (!isCluster) {
                  const c = arr[0];
                  const tr = c.metadata?.timeRange;
                  if (!tr) return;
                  displayTimeMs = (Date.parse(tr.startTime) + Date.parse(tr.endTime)) / 2;
                  color = colorFor(tr.eventType);
                } else {
                  // Center of the bucket for clusters
                  displayTimeMs = bucket * bucketMs + bucketMs / 2;
                  color = '#7f8c8d';
                }

                const cx = xOf(new Date(displayTimeMs));
                // Only render if within visible horizontal range (plus small margin)
                if (cx < margins.l - 20 || cx > margins.l + innerW + 20) return;

                const cy = getNearestObservedY(displayTimeMs);

                if (!isCluster) {
                  const c = arr[0];
                  els.push(
                    <g key={`cm-${c.id}-${idx++}`} transform={`translate(${cx}, ${cy})`}>
                      <circle
                        className="comment-marker"
                        r={5}
                        fill={color}
                        stroke="#000"
                        role="button"
                        aria-label={`Comment ${c.authorDisplayName || 'unknown'}`}
                        tabIndex={0}
                        onMouseEnter={() => onCommentHover?.(c)}
                        onMouseLeave={() => onCommentHover?.(null)}
                        onClick={(e) => { e.stopPropagation(); onCommentClick?.([c]); }}
                        style={{ cursor: 'pointer' }}
                      />
                    </g>
                  );
                } else {
                  els.push(
                    <g
                      key={`cluster-${bucket}-${idx++}`}
                      transform={`translate(${cx}, ${cy})`}
                      onClick={(e) => { e.stopPropagation(); onCommentClick?.(arr); }}
                      style={{ cursor: 'pointer' }}
                      role="button"
                      tabIndex={0}
                    >
                      <circle r={8} fill={color} stroke="#000" />
                      <text x={-3.5} y={4} fontSize="10" fill="#fff" style={{ pointerEvents: 'none' }}>{arr.length}</text>
                    </g>
                  );
                }
              });

              return els;
            })()}
          </g>
        )}

        {/* Adjusted predictions (segmented by threshold, dashed) */}
        {adjustedPoints.length > 1 && thresholds && segmentByThreshold(adjustedPoints, thresholds.minor).map((segment, i) => (
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

        {/* X-axis ticks and labels at Tide Peaks */}
        {(() => {
          // Identify peaks (high/low tides) from the full predicted data
          const peaks: Date[] = [];
          for (let i = 1; i < predictedPoints.length - 1; i++) {
            const curr = predictedPoints[i].v;
            const prev = predictedPoints[i - 1].v;
            const next = predictedPoints[i + 1].v;
            
            const isHigh = (curr >= prev && curr > next) || (curr > prev && curr >= next);
            const isLow = (curr <= prev && curr < next) || (curr < prev && curr <= next);
            
            if (isHigh || isLow) {
              // Ensure we don't add redundant points or points that aren't actually peaks
              if (peaks.length > 0) {
                const lastPeakTime = peaks[peaks.length - 1].getTime();
                if (Math.abs(predictedPoints[i].t.getTime() - lastPeakTime) < 3600000) continue; // Skip if within 1hr of last peak (noise)
              }
              peaks.push(predictedPoints[i].t);
            }
          }

          // Track last label X positions to prevent overlap
          let lastPeakLabelX = -100;
          let lastDateLabelX = -100;

          return peaks.map((tick, i) => {
            const x = xOf(tick);
            // Relaxed boundary check to show peaks right on the edge
            if (x < margins.l - 5 || x > margins.l + innerW + 5) return null;
            
            // Determine if we should show the time label near the peak
            // Clutter control: minimum 70px between peak labels
            const showPeakLabel = (x - lastPeakLabelX) > 70;
            if (showPeakLabel) lastPeakLabelX = x;
            
            return (
              <g key={`xtick-${i}`}>
                <line
                  x1={x}
                  x2={x}
                  y1={margins.t}
                  y2={margins.t + innerH}
                  stroke="var(--chart-grid)"
                  opacity={0.3}
                />
                {showPeakLabel && (() => {
                  // Find values for this specific peak to determine Y position
                  const predPoint = predictedPoints.find(p => p.t.getTime() === tick.getTime());
                  const nearestObs = findNearestPoint(observedPoints, tick);
                  const nearestAdj = findNearestPoint(adjustedPoints, tick);
                  
                  if (!predPoint) return null;

                  // Get max/min values at this time across all series to avoid overlap
                  const valsAtTime = [predPoint.v];
                  if (nearestObs && Math.abs(nearestObs.point.t.getTime() - tick.getTime()) < 300000) valsAtTime.push(nearestObs.point.v);
                  if (nearestAdj && Math.abs(nearestAdj.point.t.getTime() - tick.getTime()) < 300000) valsAtTime.push(nearestAdj.point.v);

                  const maxV = Math.max(...valsAtTime);
                  const minV = Math.min(...valsAtTime);
                  
                  const idx = predictedPoints.findIndex(p => p.t.getTime() === tick.getTime());
                  let isHigh = true;
                  if (idx > 0 && idx < predictedPoints.length - 1) {
                    const curr = predictedPoints[idx].v;
                    const prev = predictedPoints[idx - 1].v;
                    const next = predictedPoints[idx + 1].v;
                    // Robust check: it's a high if it's not a low.
                    // A low is strictly less than at least one neighbor and <= both.
                    const isLow = (curr <= prev && curr < next) || (curr < prev && curr <= next);
                    isHigh = !isLow;
                  } else if (idx === 0 && predictedPoints.length > 1) {
                    isHigh = predictedPoints[0].v > predictedPoints[1].v;
                  } else if (idx === predictedPoints.length - 1 && idx > 0) {
                    isHigh = predictedPoints[idx].v > predictedPoints[idx - 1].v;
                  }

                  const finalY = isHigh ? yOf(maxV) - 10 : yOf(minV) + 20;

                  return (
                    <text
                      x={x}
                      y={finalY}
                      textAnchor="middle"
                      fill="var(--chart-axis-text)"
                      fontSize="11"
                      fontWeight="700"
                      style={{ paintOrder: 'stroke', stroke: 'var(--chart-bg, #ffffff)', strokeWidth: '3.1px' }}
                    >
                      {new Intl.DateTimeFormat(undefined, { 
                        hour: 'numeric', 
                        minute: '2-digit',
                        hour12: true,
                        timeZone: timezone === 'gmt' ? 'UTC' : undefined 
                      }).format(tick).replace(/\s?[AP]M$/, (m) => m.trim().toLowerCase())}
                    </text>
                  );
                })()}
                <text
                  x={x}
                  y={margins.t + innerH + 34}
                  textAnchor="middle"
                  fill="var(--chart-axis-text)"
                  fontSize="12"
                  fontWeight="500"
                >
                  {(() => {
                    const isFirstTick = i === 0;
                    const prevTick = i > 0 ? peaks[i-1] : null;
                    const isNewDay = prevTick ? tick.getDate() !== prevTick.getDate() : true;
                    
                    // Clutter control for date labels: only show on new day and if space permits (>60px)
                    const showDateLabel = (isNewDay || isFirstTick) && (x - lastDateLabelX > 60);
                    if (showDateLabel) {
                      lastDateLabelX = x;
                      return new Intl.DateTimeFormat(undefined, {
                        month: 'short',
                        day: 'numeric',
                        timeZone: timezone === 'gmt' ? 'UTC' : undefined
                      }).format(tick);
                    }
                    return '';
                  })()}
                </text>
              </g>
            );
          });
        })()}

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
                fontSize="14"
                fontWeight="600"
              >
                {value.toFixed(1)} ft
              </text>
            </g>
          );
        })}

        {/* Legend - REMOVED per user request */}

        {/* Interactive tooltip – suppressed on touch devices (no cursor hover) */}
        {!isTouchDeviceRef.current && (tooltipData || (showComments && comments.length > 0)) && hoverT && (
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
              const boxWidth = 230;
              const lineHeight = 14;
              const rowsCount = tooltipData ? tooltipData.rows.length : 0;
              const commentTip = showComments ? calculateCommentTooltipData(hoverT, comments, { max: 3 }) : null;
              const commentRows = commentTip ? Math.min(3, commentTip.preview.length) + 1 : 0;

              // Find nearest-hour wind & precip
              const hoverMs = hoverT.getTime();
              const nearestWind = windPoints.length > 0
                ? windPoints.reduce((best, wp) =>
                  Math.abs(wp.t.getTime() - hoverMs) < Math.abs(best.t.getTime() - hoverMs) ? wp : best
                )
                : null;
              const nearestPrecip = precipPoints.length > 0
                ? precipPoints.reduce((best, pp) =>
                  Math.abs(pp.t.getTime() - hoverMs) < Math.abs(best.t.getTime() - hoverMs) ? pp : best
                )
                : null;
              const atmoItems = [
                ...(nearestWind ? [{ type: 'wind', data: nearestWind }] : []),
                ...(nearestPrecip && nearestPrecip.value > 0 ? [{ type: 'precip', data: nearestPrecip }] : []),
              ];
              const extraRows = atmoItems.length;

              const boxHeight = (rowsCount + 1 + commentRows + extraRows) * lineHeight + 12;
              const adjustedX = Math.min(baseX, margins.l + innerW - boxWidth - 4);

              let baseY = margins.t + 8;
              if (tooltipData && tooltipData.rows.length > 0) {
                const targetPoint = tooltipData.rows.find(r => r.point)?.point;
                if (targetPoint) {
                  // float tooltip above the point, or below if it hits top
                  const pointY = yOf(targetPoint.v);
                  if (pointY - boxHeight - 12 > margins.t) {
                    baseY = pointY - boxHeight - 12;
                  } else {
                    baseY = pointY + 12;
                  }
                }
              }
              // final clamp to chart area
              baseY = Math.max(margins.t, Math.min(baseY, margins.t + innerH - boxHeight));

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
                  {/* Atmospheric rows with icons */}
                  {atmoItems.map((item, i) => {
                    const y = baseY + 30 + (rowsCount + i) * lineHeight;
                    if (item.type === 'wind') {
                      const wind = item.data as WindPoint;
                      const color = 'rgba(120, 190, 255, 0.9)';
                      return (
                        <g key="atmo-wind" className="sentinel-metrics">
                          <g transform={`translate(${adjustedX + 14}, ${y - 4}) rotate(${wind.dir + 180})`}>
                            <line x1={0} y1={4} x2={0} y2={-4} stroke={color} strokeWidth={1.5} strokeLinecap="round" />
                            <path d="M -2 -2 L 0 -5 L 2 -2" fill={color} />
                          </g>
                          <text x={adjustedX + 26} y={y} fill={color} fontSize="11" className="metric-label">
                            Wind: {wind.speed.toFixed(0)} mph {degToCompass(wind.dir)}
                          </text>
                        </g>
                      );
                    } else {
                      const precip = item.data as PrecipPoint;
                      const color = 'rgba(0, 210, 255, 0.9)';
                      return (
                        <g key="atmo-precip" className="sentinel-metrics">
                          <path 
                            d="M 14 0 Q 14 3 12 5 Q 10 7 7 7 Q 4 7 2 5 Q 0 3 0 0 Q 0 -4 7 -8 Q 14 -4 14 0 Z" 
                            fill={color} 
                            transform={`translate(${adjustedX + 8}, ${y - 4}) scale(0.6)`}
                          />
                          <text x={adjustedX + 26} y={y} fill={color} fontSize="11">
                            Precip: {precip.value.toFixed(2)} in
                          </text>
                        </g>
                      );
                    }
                  })}
                  {commentTip && (
                    <>
                      <line x1={adjustedX + 6} x2={adjustedX + boxWidth - 6} y1={baseY + 30 + (rowsCount + extraRows) * lineHeight - 8} y2={baseY + 30 + (rowsCount + extraRows) * lineHeight - 8} stroke="var(--chart-grid)" />
                      <text x={adjustedX + 8} y={baseY + 30 + (rowsCount + extraRows) * lineHeight} fill="var(--chart-label-text)" fontSize="12">
                        Comments: {commentTip.total}
                      </text>
                      {commentTip.preview.map((c, j) => (
                        <text key={`ctip-${c.id}`} x={adjustedX + 8} y={baseY + 30 + (rowsCount + extraRows + 1 + j) * lineHeight} fill="var(--chart-axis-text)" fontSize="11">
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

        {/* VIEWING/Center Time Marker (Solid, always visible) */}
        {(() => {
          const x = margins.l + innerW * nowRatio;
          
          const obsRes = findNearestPoint(observedPoints, centerTime);
          const adjRes = findNearestPoint(adjustedPoints, centerTime);
          const predRes = findNearestPoint(predictedPoints, centerTime);

          // We'll show dots for Observed and the "main" forecast (Adjusted/Predicted)
          const obsY = (obsRes && obsRes.dtMin < 60) ? yOf(obsRes.point.v) : null;
          const forecastY = (adjRes && adjRes.dtMin < 60) ? yOf(adjRes.point.v) : 
                            (predRes && predRes.dtMin < 60) ? yOf(predRes.point.v) : null;
          
          return (
            <g key="viewing-time-marker">
              <line
                x1={x}
                x2={x}
                y1={margins.t}
                y2={margins.t + innerH}
                stroke="var(--ion-color-primary, #3880ff)"
                strokeWidth={2.5}
                opacity={0.9}
              />
              
              {/* Intersection dots */}
              {obsY !== null && (
                <circle 
                  cx={x} cy={obsY} r={4.5} 
                  fill="var(--chart-bg, #fff)" 
                  stroke="var(--line-observed, #2ecc71)" 
                  strokeWidth={2} 
                />
              )}
              {forecastY !== null && (
                <circle 
                  cx={x} cy={forecastY} r={4.5} 
                  fill="var(--chart-bg, #fff)" 
                  stroke={adjRes && adjRes.dtMin < 60 ? "var(--line-adjusted, #3498db)" : "var(--line-predicted, #95a5a6)"} 
                  strokeWidth={2} 
                />
              )}

              <text
                x={x + 6}
                y={margins.t + 18}
                fill="var(--ion-color-primary, #3880ff)"
                fontSize="11"
                fontWeight="900"
                style={{ 
                  paintOrder: 'stroke', 
                  stroke: 'var(--chart-bg, #ffffff)', 
                  strokeWidth: '4px'
                }}
              >
                {formatTooltipTime(centerTime, timezone)}
              </text>
            </g>
          );
        })()}

        {/* NOW Marker (Dotted, hidden if overlapping with VIEWING) */}
        {(() => {
          const x = xOf(now);
          const isVisible = x >= margins.l && x <= margins.l + innerW;
          
          const centerX = margins.l + innerW * nowRatio;
          const isOverlappingCenter = Math.abs(x - centerX) < 60;

          if (!isVisible || isOverlappingCenter) return null;
          
          return (
            <g key="now-marker">
              <line
                x1={x}
                x2={x}
                y1={margins.t}
                y2={margins.t + innerH}
                stroke="#95a5a6"
                strokeWidth={1.5}
                strokeDasharray="4 2"
                opacity={0.6}
              />
              <text
                x={x + 6}
                y={margins.t + innerH - 15}
                fill="#95a5a6"
                fontSize="11"
                fontWeight="900"
                style={{ 
                  paintOrder: 'stroke', 
                  stroke: 'var(--chart-bg, #ffffff)', 
                  strokeWidth: '4px'
                }}
              >
                NOW
              </text>
            </g>
          );
        })()}
      </svg>
      <div className="chart-comment-controls" role="group" aria-label="Comment overlay controls">
        <IonButtons>
          <IonButton onClick={onToggleComments} aria-label={showComments ? 'Hide pins (C)' : 'Show pins (C)'}>
            <IonIcon icon={showComments ? eye : eyeOff} />
            {typeof commentCount === 'number' && <IonBadge color="primary" style={{ marginLeft: 6 }}>{commentCount}</IonBadge>}
          </IonButton>
        </IonButtons>
      </div>

      {/* Bottom center "Add Comment" button (replacing legend) */}
      <div className="chart-bottom-controls">
        <IonButton 
          className="add-comment-fab" 
          onClick={() => onTimePointSelect?.(centerTime, centerLevel ?? undefined)}
          aria-label="Add comment at current time"
        >
          <IonIcon icon={addCircleOutline} slot="start" />
          <span className="btn-label">
            Comment {centerLevel !== null ? `(${centerLevel.toFixed(1)} ft)` : ''}
          </span>
        </IonButton>
      </div>
    </div>
  );
};

export default ChartViewer;

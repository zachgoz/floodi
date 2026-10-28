import { liveViewport } from 'src/utils/waterForecast';
import React, { useRef, useEffect, useState, useMemo, useCallback, useId } from 'react';
import type { Point, ChartConfig, WindPoint, PrecipPoint } from './types';
import { WeatherTimeline, WEATHER_TIMELINE_HEIGHT } from './WeatherTimeline';
import { HourlyWeatherDetails } from './HourlyWeatherDetails';
import { compassDirection } from 'src/utils/weatherTimeline';
import { useChartInteraction, formatTooltipTime, findNearestPoint } from './hooks/useChartInteraction';
import { isCommentTimeRange, type Comment, type CommentTimeRange } from 'src/types/comment';
import { findLastSimilarLevel } from 'src/lib/dataService';
import type { WaterLevelPeak, FloodEvent } from 'src/types/data';
import { getTimeRangeFromChartSelection } from 'src/utils/timeRangeHelpers';
import { findTideExtrema } from 'src/utils/tideExtrema';
import { IonButton, IonIcon, IonText } from '@ionic/react';
import { addCircleOutline, refreshOutline, syncOutline } from 'ionicons/icons';

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
  experimentalPoints?: Point[];
  experimentalLower?: Point[];
  experimentalUpper?: Point[];
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
  /** Fire when a user interaction commits the current visible domain */
  onViewportDomainCommit?: (start: Date, end: Date) => void;
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
  /** A viewport selected on the linked residual chart. */
  viewportRequest?: { start: Date; end: Date; id: number };
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
  /** Optional time offset in minutes for prediction alignment */
  timeOffsetMins?: number;
  /** Location ID for data queries */
  locationId: string;
  /** Callback to jump the chart to a specific time */
  onJumpToTime?: (time: Date) => void;
  /** Historical flood events to highlight on the timeline */
  floodEvents?: FloodEvent[];
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
  experimentalPoints = [],
  experimentalLower = [],
  experimentalUpper = [],
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
  onDomainChangeRequest,
  onViewportDomainCommit,
  onHoverTimeChange,
  onViewportChange,
  mode,
  onResetToLive,
  selectedTime,
  centerRequest,
  viewportRequest,
  resetKey,
  timeRange,
  viewMode = 'basic',
  timeOffsetMins,
  locationId,
  onJumpToTime,
  floodEvents = []
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const forecastClipId = `water-forecast-${useId().replace(/:/g, '')}`;
  const [size, setSize] = useState({ w: 900, h: 420 });
  const [hourlyWeather, setHourlyWeather] = useState(false);

  const { hoverT, setHoverT, calculateTooltipData, calculateCommentTooltipData } = useChartInteraction();
  const [lastSimilarPeak, setLastSimilarPeak] = useState<WaterLevelPeak | null>(null);

  const handleJumpToPeak = (peak: WaterLevelPeak) => {
    onJumpToTime?.(new Date(peak.t));
  };

  useEffect(() => {
    if (!hoverT) {
      setLastSimilarPeak(null);
      return;
    }

    // Only look for similar peaks if we are hovering on a prediction (future)
    if (hoverT.getTime() < now.getTime()) {
      setLastSimilarPeak(null);
      return;
    }

    // Find the level at hoverT
    const nearestPoint = findNearestPoint(adjustedPoints, hoverT) || findNearestPoint(predictedPoints, hoverT);
    if (!nearestPoint || nearestPoint.point.v < thresholds.minor - 1.0) { 
      setLastSimilarPeak(null);
      return;
    }

    const timer = setTimeout(async () => {
       try {
         const peak = await findLastSimilarLevel(locationId, nearestPoint.point.v, now);
         setLastSimilarPeak(peak);
       } catch (err) {
         console.warn('Failed to fetch similar peak:', err);
       }
    }, 200);

    return () => clearTimeout(timer);
  }, [hoverT, now, adjustedPoints, predictedPoints, locationId, thresholds.minor]);

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
  const lastViewportChangeRef = useRef<number>(0);
  const lastEmittedViewportRef = useRef<{ start: number; end: number; center: number } | null>(null);
  const viewportTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCenterRequestRef = useRef<{ id: number; time: number } | null>(null);
  const lastViewportRequestRef = useRef<{ id: number; start: number; end: number } | null>(null);

  const invalidateViewportNotification = useCallback(() => {
    // A linked chart can change the parent before our throttled notification
    // fires. Returning to an earlier range must acknowledge the new command.
    lastEmittedViewportRef.current = null;
    if (viewportTimeoutRef.current !== null) {
      clearTimeout(viewportTimeoutRef.current);
      viewportTimeoutRef.current = null;
    }
  }, []);

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
    if (!centerRequest) { lastCenterRequestRef.current = null; return; }
    const previous = lastCenterRequestRef.current;
    if (previous?.id === centerRequest.id && previous.time === +centerRequest.time) return;
    lastCenterRequestRef.current = { id: centerRequest.id, time: +centerRequest.time };
    invalidateViewportNotification();
    setViewDomain(previous => liveViewport(previous?.start || domainStart,
      previous?.end || domainEnd, centerRequest.time, nowRatio));
  }, [centerRequest, invalidateViewportNotification]);

  // Apply a viewport selected on the linked chart without resetting the y-axis.
  useEffect(() => {
    if (!viewportRequest) { lastViewportRequestRef.current = null; return; }
    const previous = lastViewportRequestRef.current;
    if (previous?.id === viewportRequest.id && previous.start === +viewportRequest.start && previous.end === +viewportRequest.end) return;
    lastViewportRequestRef.current = { id: viewportRequest.id, start: +viewportRequest.start, end: +viewportRequest.end };
    invalidateViewportNotification();
    setViewDomain({ start: viewportRequest.start, end: viewportRequest.end });
  }, [viewportRequest, invalidateViewportNotification]);

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
  }, [activeStart.getTime(), activeEnd.getTime(), nowRatio, now.getTime()]);

  // Find water level at the center point for the button label
  useEffect(() => {
    if (Math.abs(+centerTime - Date.now()) > 5 * 60_000) return;
    const timer = setInterval(() => setViewDomain(d => liveViewport(d?.start || domainStart, d?.end || domainEnd, new Date(), nowRatio)), 60_000);
    return () => clearInterval(timer);
  }, [centerTime, domainStart, domainEnd, nowRatio]);

  const centerLevel = useMemo(() => {
    const obsRes = findNearestPoint(observedPoints, centerTime);
    const adjRes = findNearestPoint(adjustedPoints, centerTime);
    const predRes = findNearestPoint(predictedPoints, centerTime);

    if (obsRes && obsRes.dtMin < 60) return obsRes.point.v;
    if (adjRes && adjRes.dtMin < 60) return adjRes.point.v;
    if (predRes && predRes.dtMin < 60) return predRes.point.v;
    return null;
  }, [centerTime, observedPoints, adjustedPoints, predictedPoints]);

  // Immediate notification of viewport changes to parent for simulation sync
  useEffect(() => {
    if (!onViewportChange) return;

    const s = activeStart.getTime();
    const e = activeEnd.getTime();
    const c = centerTime.getTime();

    // Avoid duplicate notifications while preserving even small linked-chart movements.
    const last = lastEmittedViewportRef.current;
    if (last && 
        last.start === s &&
        last.end === e &&
        last.center === c) {
      return;
    }

    const nowMs = Date.now();
    const timeSinceLast = nowMs - lastViewportChangeRef.current;
    
    const notify = () => {
      onViewportChange(activeStart, activeEnd, centerTime);
      lastViewportChangeRef.current = Date.now();
      lastEmittedViewportRef.current = { start: s, end: e, center: c };
      viewportTimeoutRef.current = null;
    };

    // Clear any pending notification so we always schedule the LATEST viewport state
    if (viewportTimeoutRef.current) {
      clearTimeout(viewportTimeoutRef.current);
    }

    if (timeSinceLast >= 50) {
      notify();
    } else {
      viewportTimeoutRef.current = setTimeout(notify, 50 - timeSinceLast);
    }

    return () => {
      if (viewportTimeoutRef.current) clearTimeout(viewportTimeoutRef.current);
    };
  }, [activeStart.getTime(), activeEnd.getTime(), centerTime.getTime(), onViewportChange]);

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

  const hasWeather = windPoints.length > 0 || precipPoints.length > 0;
  const weatherHeight = hasWeather ? WEATHER_TIMELINE_HEIGHT + 6 : 0;

  // Chart dimensions and scaling
  const chartConfig = useMemo((): ChartConfig => {
    const baseBottom = 42;
    return {
      size,
      margins: { l: 50, r: 20, t: 25, b: baseBottom + weatherHeight },
      thresholds,
      showDelta,
      timezone,
      ...config,
    };
  }, [size, thresholds, showDelta, timezone, config, weatherHeight]);

  const { margins } = chartConfig;
  const innerW = size.w - margins.l - margins.r;
  const innerH = size.h - margins.t - margins.b;

  // Y-axis scaling
  const yMinMax = useMemo(() => {
    const allValues = [
      ...observedPoints.map(p => p.v),
      ...adjustedPoints.map(p => p.v),
      ...experimentalPoints.map(p => p.v),
      ...experimentalLower.map(p => p.v),
      ...experimentalUpper.map(p => p.v),
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
  }, [observedPoints, adjustedPoints, experimentalPoints, experimentalLower, experimentalUpper, predictedPoints, deltaPoints, surgeForecastPoints, thresholds, showDelta]);

  // Scaling functions
  const t0 = activeStart.getTime();
  const t1 = activeEnd.getTime();
  const xOf = useCallback((date: Date) => margins.l + ((date.getTime() - t0) / (t1 - t0)) * innerW, [margins.l, t0, t1, innerW]);
  const yOf = useCallback((value: number) => margins.t + (1 - (value - yMinMax.min) / (yMinMax.max - yMinMax.min)) * innerH, [margins.t, yMinMax.min, yMinMax.max, innerH]);
  // Keep native preceding forecast samples for crossings and interpolation,
  // while drawing predictions only after the measured/estimated display ends.
  const displayHandoff = observedPoints.reduce((latest, point) => Number.isFinite(+point.t)
    ? Math.max(latest, +point.t) : latest, +activeStart);
  const forecastClipStart = Math.min(margins.l + innerW, Math.max(margins.l, xOf(new Date(displayHandoff))));

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
      const overWeather = (event.target as Element).closest?.('[data-testid="weather-timeline"]');
      const hoverTime = overWeather ? null : computeTimeAtPointer(event);
      if (hoverTime) {
        setHoverT(hoverTime);
        onHoverTimeChange?.(hoverTime);
      } else {
        setHoverT(null);
        onHoverTimeChange?.(null);
        onChartInteraction?.(null);
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

    onViewportDomainCommit?.(viewDomain.start, viewDomain.end);

    // Notify parent separately when the visible domain moved away from props.
    // The parent decides whether this should expand the fetched data range.
    if (Math.abs(v0 - d0) > 1000 || Math.abs(v1 - d1) > 1000) {
      onDomainChangeRequest?.(viewDomain.start, viewDomain.end);
    }
  }, [viewDomain, domainStart.getTime(), domainEnd.getTime(), onDomainChangeRequest, onViewportDomainCommit]);

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
    // Interactive markers and weather cells handle their own clicks. Capturing
    // the pointer on the SVG would redirect a weather cell's click away from it.
    const target = event.target as HTMLElement;
    if (target && target.closest && (target.closest('[data-comment-marker]') || target.closest('[data-testid="weather-timeline"] [role="button"]'))) {
      return;
    }

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
      // If tapping a comment marker, ignore here to let React/marker handlers work exclusively
      const target = e.target as HTMLElement;
      if (target && target.closest && target.closest('[data-comment-marker]')) {
        return;
      }

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
    return calculateTooltipData(hoverT, observedPoints, predictedPoints, adjustedPoints, deltaPoints, now, thresholds.minor, showDelta, viewMode, lastSimilarPeak);
  }, [hoverT, observedPoints, predictedPoints, adjustedPoints, deltaPoints, thresholds.minor, showDelta, viewMode, calculateTooltipData, lastSimilarPeak]);

  /** Handle reset of both local zoom and global absolute range */
  const handleReset = () => {
    setViewDomain(liveViewport(activeStart, activeEnd, new Date(), nowRatio));
    onResetToLive?.();
  };

  const handleContainerKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const shift = (+activeEnd - +activeStart) / 4 * (e.key === 'ArrowLeft' ? -1 : 1);
      const next = { start: new Date(+activeStart + shift), end: new Date(+activeEnd + shift) };
      setViewDomain(next);
      onViewportDomainCommit?.(next.start, next.end);
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'c') onToggleComments?.();
    if (k === 'n' && onTimePointSelect) {
      e.preventDefault();
      onTimePointSelect(centerTime, centerLevel ?? undefined);
    }
  };

  return (
    <div className="chart-viewer-layout">
    <div className="chart-viewer chart-plot" ref={containerRef} onKeyDown={handleContainerKeyDown} tabIndex={0} aria-keyshortcuts={onTimePointSelect ? 'ArrowLeft ArrowRight C N' : 'ArrowLeft ArrowRight C'} style={{ width: '100%', overflow: 'hidden', position: 'relative' }}>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${size.w} ${size.h}`}
        width={size.w}
        height={size.h}
        role="img"
        aria-label="Water level chart showing observed, predicted, and adjusted predictions over time"
        data-domain-start={activeStart.toISOString()}
        data-domain-end={activeEnd.toISOString()}
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

        {/* Threshold gradients for dynamic line coloring */}
        {thresholds && (
          <defs>
            <linearGradient id="obs-flood-gradient" gradientUnits="userSpaceOnUse" x1="0" y1={margins.t + innerH} x2="0" y2={margins.t}>
              {(() => {
                const getOff = (v: number) => {
                  const y = yOf(v);
                  return `${Math.max(0, Math.min(100, ((margins.t + innerH - y) / innerH) * 100))}%`;
                };
                return (
                  <>
                    <stop offset="0%" stopColor="var(--line-observed, #2ecc71)" />
                    <stop offset={getOff(thresholds.minor)} stopColor="var(--line-observed, #2ecc71)" />
                    <stop offset={getOff(thresholds.minor)} stopColor="#fbc02d" />
                    <stop offset={getOff(thresholds.moderate)} stopColor="#fbc02d" />
                    <stop offset={getOff(thresholds.moderate)} stopColor="#f57c00" />
                    <stop offset={getOff(thresholds.major)} stopColor="#f57c00" />
                    <stop offset={getOff(thresholds.major)} stopColor="#d32f2f" />
                    <stop offset={getOff(thresholds.extreme)} stopColor="#d32f2f" />
                    <stop offset="100%" stopColor="#7b1fa2" />
                  </>
                );
              })()}
            </linearGradient>

            <linearGradient id="adj-flood-gradient" gradientUnits="userSpaceOnUse" x1="0" y1={margins.t + innerH} x2="0" y2={margins.t}>
              {(() => {
                const getOff = (v: number) => {
                  const y = yOf(v);
                  return `${Math.max(0, Math.min(100, ((margins.t + innerH - y) / innerH) * 100))}%`;
                };
                return (
                  <>
                    <stop offset="0%" stopColor="var(--line-observed, #2ecc71)" />
                    <stop offset={getOff(thresholds.minor)} stopColor="var(--line-observed, #2ecc71)" />
                    <stop offset={getOff(thresholds.minor)} stopColor="#fbc02d" />
                    <stop offset={getOff(thresholds.moderate)} stopColor="#fbc02d" />
                    <stop offset={getOff(thresholds.moderate)} stopColor="#f57c00" />
                    <stop offset={getOff(thresholds.major)} stopColor="#f57c00" />
                    <stop offset={getOff(thresholds.major)} stopColor="#d32f2f" />
                    <stop offset={getOff(thresholds.extreme)} stopColor="#d32f2f" />
                    <stop offset="100%" stopColor="#7b1fa2" />
                  </>
                );
              })()}
            </linearGradient>
          </defs>
        )}

        {/* Plot area */}
        <rect
          x={margins.l}
          y={margins.t}
          width={innerW}
          height={innerH}
          fill="var(--chart-plot-bg)"
          stroke="var(--chart-plot-stroke)"
        />

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
              fill={`color-mix(in srgb, ${color} 40%, var(--chart-axis-text))`}
              fontSize="12"
              fontWeight="600"
              style={{ 
                paintOrder: 'stroke',
                stroke: 'var(--chart-bg, #ffffff)',
                strokeWidth: '4px',
                strokeLinecap: 'round',
                strokeLinejoin: 'round'
              }}
            >
              {label.replace(' Flooding', '')} {ft.toFixed(1)} ft
            </text>
          </g>
        ))}


        {/* Data series */}
        <defs><clipPath id={forecastClipId}>
          <rect data-testid="water-forecast-clip" x={forecastClipStart} y={margins.t}
            width={Math.max(0, margins.l + innerW - forecastClipStart)} height={innerH} />
        </clipPath></defs>

        {observedPoints.filter(p => !p.estimated).length > 1 && (
          <polyline role="img"
            key="obs-line"
            aria-label="Observed water level"
            fill="none"
            stroke={thresholds ? "url(#obs-flood-gradient)" : "var(--line-observed, #2ecc71)"}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={observedPoints.filter(p => !p.estimated).map(p => `${xOf(p.t)},${yOf(p.v)}`).join(' ')}
          />
        )}
        {observedPoints.some(p => p.estimated) && <polyline role="img"
          aria-label="Estimated localized water level"
          fill="none" stroke={thresholds ? 'url(#obs-flood-gradient)' : 'var(--line-observed, #2ecc71)'}
          strokeWidth="3" strokeDasharray="3 3" strokeLinecap="round" strokeLinejoin="round"
          points={observedPoints.slice(Math.max(0, observedPoints.findIndex(p => p.estimated) - 1)).map(p => `${xOf(p.t)},${yOf(p.v)}`).join(' ')}
        />}

        {/* Astronomical tide remains visible in every view. */}
        {predictedPoints.length > 1 && (
          <polyline role="img"
            fill="none"
            aria-label="Astronomical tide prediction"
            stroke="#95a5a6"
            strokeWidth="2"
            opacity={0.9}
            points={buildPolyline(predictedPoints, xOf, yOf)}
          />
        )}

        {/* Removed selection overlay, we only use point-in-time taps now */}



        {/* Adjusted predictions (using threshold gradient, dashed) */}
        {adjustedPoints.length > 1 && (
          <polyline role="img"
            key="adj-line"
            aria-label="Forecast total water level"
            clipPath={`url(#${forecastClipId})`}
            fill="none"
            stroke={thresholds ? "url(#adj-flood-gradient)" : "var(--line-observed, #2ecc71)"}
            strokeWidth="2.5"
            strokeDasharray="5 4"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={adjustedPoints.map(p => `${xOf(p.t)},${yOf(p.v)}`).join(' ')}
          />
        )}

        {experimentalPoints.length > 1 && <polyline role="img" aria-label="Comparison total water level" clipPath={`url(#${forecastClipId})`} fill="none" stroke="#8462bf" strokeWidth={3} strokeDasharray="7 5" points={buildPolyline(experimentalPoints, xOf, yOf)} />}
        {[experimentalLower, experimentalUpper].map((series,i) => series.length > 1 && <polyline role="img" key={`bound-${i}`} aria-label={i === 0 ? 'Forecast lower error bound' : 'Forecast upper error bound'} clipPath={`url(#${forecastClipId})`} fill="none" stroke={experimentalPoints.length ? '#8462bf' : '#637b86'} opacity={0.6} strokeWidth={1} strokeDasharray="3 5" points={buildPolyline(series, xOf, yOf)} />)}
        {/* Surge offset trend */}
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
            <polyline role="img"
              fill="none"
              stroke="#1976d2"
              strokeWidth="2"
              points={buildPolyline(deltaPoints, xOf, yOf)}
            />
            {surgeForecastPoints.length > 1 && (
              <polyline role="img"
                fill="none"
                stroke="#1976d2"
                strokeWidth="2"
                strokeDasharray="4 4"
                opacity={0.7}
                points={buildPolyline(surgeForecastPoints, xOf, yOf)}
              />
            )}
          </g>
        )}

        {/* X-axis ticks and labels at Tide Peaks */}
        {(() => {
          // Create combined actual + FloodCast prediction curve to ensure we find actual expected peaks (including surge)
          const combinedPoints = [
            ...observedPoints,
            ...adjustedPoints.slice(1)
          ];
          const extrema = findTideExtrema(combinedPoints.length > 0 ? combinedPoints : predictedPoints);
          const peaks = extrema.map(ext => ext.t);

          // Track last label X positions separately for high and low peaks to allow both to show even if horizontally close
          let lastHighLabelX = -1000;
          let lastLowLabelX = -1000;
          let lastDateLabelX = -100;

          return peaks.map((tick, i) => {
            const x = xOf(tick);
            // Relaxed boundary check to show peaks right on the edge
            if (x < margins.l - 5 || x > margins.l + innerW + 5) return null;
            
            const extremum = extrema[i];
            if (!extremum) return null;
            const isHigh = extremum.type === 'high';

            // Clutter control: minimum 70px between labels OF THE SAME TYPE
            const showPeakLabel = isHigh ? (x - lastHighLabelX) > 100 : (x - lastLowLabelX) > 100;
            if (showPeakLabel) {
              if (isHigh) lastHighLabelX = x;
              else lastLowLabelX = x;
            }
            
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
                  // Clearance: -18px for high peaks, +24px for low peaks
                  const compactLabel = size.w < 600;
                  let finalY = isHigh ? yOf(extremum.v) - (compactLabel ? 0 : 18) : yOf(extremum.v) + 24;

                  // Safety: keep labels within SVG bounds (plus some padding)
                  const minVisibleY = margins.t - 5;
                  const maxVisibleY = margins.t + innerH + 30;
                  if (finalY < minVisibleY) finalY = minVisibleY + 12;
                  if (finalY > maxVisibleY) finalY = maxVisibleY - 5;

                  return (
                    <g key={`plabel-${i}`}>
                      <text
                        x={x}
                        y={finalY - 12}
                        textAnchor="middle"
                        fill={isHigh ? "var(--ion-color-danger)" : "var(--ion-color-primary)"}
                        fontSize="12"
                        fontWeight="600"
                        style={{ paintOrder: 'stroke', stroke: 'var(--chart-bg, #ffffff)', strokeWidth: '3px' }}
                      >
                        {isHigh ? 'High' : 'Low'} {extremum.v.toFixed(2)} ft
                      </text>
                      {!compactLabel && <text
                        x={x}
                        y={finalY}
                        textAnchor="middle"
                        fill="var(--chart-axis-text)"
                        fontSize="12"
                        fontWeight="500"
                        style={{ paintOrder: 'stroke', stroke: 'var(--chart-bg, #ffffff)', strokeWidth: '3.1px' }}
                      >
                        {new Intl.DateTimeFormat(undefined, { 
                          hour: 'numeric', 
                          minute: '2-digit',
                          hour12: true,
                          timeZone: timezone === 'gmt' ? 'UTC' : 'America/New_York'
                        }).format(tick).replace(/\s?[AP]M$/, (m) => m.trim().toLowerCase())}
                      </text>}
                    </g>
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
                        timeZone: timezone === 'gmt' ? 'UTC' : 'America/New_York'
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
                fontSize="12"
                fontWeight="500"
              >
                {value.toFixed(1)} ft
              </text>
            </g>
          );
        })}

        {hasWeather && <WeatherTimeline
          windPoints={windPoints}
          precipPoints={precipPoints}
          start={activeStart}
          end={activeEnd}
          now={now}
          x={margins.l}
          y={margins.t + innerH + 42}
          width={innerW}
          timezone={timezone}
        />}

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
                ...(nearestWind && Math.abs(+nearestWind.t - hoverMs) < 3600000 && Number.isFinite(nearestWind.speed) ? [{ type: 'wind', data: nearestWind }] : []),
                ...(nearestPrecip && Math.abs(+nearestPrecip.t - hoverMs) < 3600000 && Number.isFinite(nearestPrecip.value) && nearestPrecip.value >= 0 ? [{ type: 'precip', data: nearestPrecip }] : []),
              ];
              const extraRows = atmoItems.length;

              const similarRow = lastSimilarPeak ? 1.4 : 0;
              const boxHeight = (rowsCount + 1 + commentRows + extraRows + similarRow) * lineHeight + 12;
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

                  {lastSimilarPeak && (
                    <g 
                      style={{ cursor: 'pointer' }}
                      onClick={() => handleJumpToPeak(lastSimilarPeak)}
                    >
                      <rect 
                        x={adjustedX + 4}
                        y={baseY + 16 + (rowsCount + 1 + extraRows) * lineHeight - 10}
                        width={boxWidth - 8}
                        height={lineHeight + 4}
                        fill="rgba(52, 152, 219, 0.1)"
                        rx={4}
                      />
                      <text
                        x={adjustedX + 8}
                        y={baseY + 16 + (rowsCount + 1 + extraRows) * lineHeight + 2}
                        fill="#3498db"
                        fontSize="10"
                        fontWeight="bold"
                      >
                        Jump to last similar: {lastSimilarPeak.v.toFixed(1)}ft ({new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: '2-digit' }).format(new Date(lastSimilarPeak.t))})
                      </text>
                    </g>
                  )}
                  {/* Atmospheric rows with icons */}
                  {atmoItems.map((item, i) => {
                    const y = baseY + 30 + (rowsCount + i) * lineHeight;
                    if (item.type === 'wind') {
                      const wind = item.data as WindPoint;
                      const color = 'var(--chart-label-text)';
                      return (
                        <g key="atmo-wind" className="sentinel-metrics">
                          {Number.isFinite(wind.dir) && <g transform={`translate(${adjustedX + 14}, ${y - 4}) rotate(${wind.dir + 180})`}>
                            <line x1={0} y1={4} x2={0} y2={-4} stroke={color} strokeWidth={1.5} strokeLinecap="round" />
                            <path d="M -2 -2 L 0 -5 L 2 -2" fill={color} />
                          </g>}
                          <text x={adjustedX + 26} y={y} fill={color} fontSize="11" className="metric-label">
                            Wind: {wind.speed.toFixed(0)} mph {compassDirection(wind.dir)}
                          </text>
                        </g>
                      );
                    } else {
                      const precip = item.data as PrecipPoint;
                      const color = 'var(--ion-color-primary, #0077b6)';
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

          const lastObsT = observedPoints.length > 0 
            ? Math.max(...observedPoints.map(p => p.t.getTime())) 
            : Date.now();
          const isAfterObs = centerTime.getTime() > lastObsT;

          // We'll show dots for Observed and the "main" forecast (Adjusted/Predicted)
          // We use a tighter 15-minute window for markers on the vertical center line
          // to ensure they accurately represent 'current' state without temporal drift.
          const obsY = (obsRes && obsRes.dtMin <= 15 && !isAfterObs) ? yOf(obsRes.point.v) : null;
          const adjY = (adjRes && adjRes.dtMin <= 15 && isAfterObs) ? yOf(adjRes.point.v) : null;
          const predY = (viewMode === 'advanced' && predRes && predRes.dtMin <= 15) ? yOf(predRes.point.v) : null;
          
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
              {adjY !== null && (
                <circle 
                   cx={x} cy={adjY} r={4.5} 
                   fill="var(--chart-bg, #fff)" 
                   stroke="var(--line-adjusted, #3498db)" 
                   strokeWidth={2} 
                />
              )}
              {predY !== null && (
                <circle 
                   cx={x} cy={predY} r={4} 
                   fill="var(--chart-bg, #fff)" 
                   stroke="var(--line-predicted, #95a5a6)" 
                   strokeWidth={1.5} 
                />
              )}

              <text
                x={x + 6}
                y={margins.t + 18}
                fill="var(--ion-color-primary, #3880ff)"
                fontSize="12"
                fontWeight="600"
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
                fontSize="12"
                fontWeight="600"
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
        {/* Comment markers (Final layer to ensure clickability) */}
        {showComments && comments.length > 0 && (
          <g aria-label="Comment markers" className="chart-comment-markers">
            {(() => {
              // Stable clustering by absolute time buckets (e.g. 30 mins)
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
                  displayTimeMs = bucket * bucketMs + bucketMs / 2;
                  color = '#7f8c8d';
                }

                const cx = xOf(new Date(displayTimeMs));
                if (cx < margins.l - 20 || cx > margins.l + innerW + 20) return;

                const cy = getNearestObservedY(displayTimeMs);

                if (!isCluster) {
                  const c = arr[0];
                  els.push(
                    <g 
                      key={`cm-${c.id}-${idx++}`} 
                      transform={`translate(${cx}, ${cy})`}
                      style={{ cursor: 'pointer', pointerEvents: 'auto' }}
                      data-comment-marker="true"
                      onPointerDown={(e) => e.stopPropagation()}
                      onPointerUp={(e) => e.stopPropagation()}
                      onTouchStart={(e) => e.stopPropagation()}
                      onTouchEnd={(e) => e.stopPropagation()}
                      onMouseEnter={() => onCommentHover?.(c)}
                      onMouseLeave={() => onCommentHover?.(null)}
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        onCommentClick?.([c]); 
                      }}
                    >
                      {/* Invisible hit target: 12px radius */}
                      <circle r={12} fill="transparent" style={{ pointerEvents: 'auto' }} data-comment-marker="true" />
                      <circle
                        className="comment-marker"
                        r={3}
                        fill={color}
                        stroke="#000"
                        strokeWidth={1}
                        role="button"
                        aria-label={`Comment ${c.authorDisplayName || 'unknown'}`}
                        tabIndex={0}
                      />
                    </g>
                  );
                } else {
                  els.push(
                    <g 
                      key={`cluster-${bucket}-${idx++}`} 
                      transform={`translate(${cx}, ${cy})`} 
                      style={{ cursor: 'pointer', pointerEvents: 'auto' }}
                      data-comment-marker="true"
                      role="button" 
                      tabIndex={0}
                      onPointerDown={(e) => e.stopPropagation()}
                      onPointerUp={(e) => e.stopPropagation()}
                      onTouchStart={(e) => e.stopPropagation()}
                      onTouchEnd={(e) => e.stopPropagation()}
                      onMouseEnter={() => {
                        // For clusters, we might want to hover the first one or just indicate multiple
                        if (arr.length > 0) onCommentHover?.(arr[0]);
                      }}
                      onMouseLeave={() => onCommentHover?.(null)}
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        onCommentClick?.(arr); 
                      }}
                    >
                      {/* Invisible hit target: 12px radius */}
                      <circle r={12} fill="transparent" style={{ pointerEvents: 'auto' }} data-comment-marker="true" />
                      <circle className="comment-marker" r={5} fill={color} stroke="#000" strokeWidth={1} />
                      <text 
                        x={0} 
                        y={0} 
                        dy=".35em"
                        fontSize="7" 
                        fontWeight="bold" 
                        fill="#fff" 
                        textAnchor="middle"
                        style={{ pointerEvents: 'none' }}
                      >
                        {arr.length}
                      </text>
                    </g>
                  );
                }
              });

              return els;
            })()}
          </g>
        )}
      </svg>
    </div>
    {(hasWeather || onTimePointSelect) && <div className="chart-actions-row">
      {hasWeather && <div className="chart-weather-options" role="group" aria-label="Weather detail">
        <span>Weather</span>
        <button type="button" aria-pressed={!hourlyWeather} onClick={() => setHourlyWeather(false)}>Auto</button>
        <button type="button" aria-pressed={hourlyWeather} aria-expanded={hourlyWeather} onClick={() => setHourlyWeather(true)}>Hourly</button>
      </div>}
      {onTimePointSelect && (
        <div className="chart-comment-add-action" role="toolbar" aria-label="Chart comments">
          <IonButton
            onClick={() => onTimePointSelect(centerTime, centerLevel ?? undefined)}
            aria-label="Add comment at current chart time"
            className="chart-comment-add"
            color="primary"
            fill="clear"
          >
            <IonIcon icon={addCircleOutline} slot="start" />
            Add Comment
          </IonButton>
        </div>
      )}
    </div>}
    {hasWeather && hourlyWeather && <HourlyWeatherDetails
      windPoints={windPoints}
      precipPoints={precipPoints}
      start={activeStart}
      end={activeEnd}
      now={now}
      timezone={timezone}
    />}
    </div>
  );
};

export default ChartViewer;

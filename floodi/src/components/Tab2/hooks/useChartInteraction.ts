import { useState, useCallback, useMemo } from 'react';
import type { Point, ChartInteraction } from '../types';

/**
 * Find the nearest point in a series to a given timestamp
 * 
 * @param points Array of data points
 * @param targetTime Target timestamp to find nearest point for
 * @returns Nearest point and time difference in minutes, or null if no points
 */
function findNearestPoint(points: Point[], targetTime: Date): { point: Point; dtMin: number } | null {
  if (points.length === 0) return null;
  
  let nearest = points[0];
  let minDiff = Math.abs(nearest.t.getTime() - targetTime.getTime());
  
  for (let i = 1; i < points.length; i++) {
    const diff = Math.abs(points[i].t.getTime() - targetTime.getTime());
    if (diff < minDiff) {
      nearest = points[i];
      minDiff = diff;
    }
  }
  
  return { point: nearest, dtMin: minDiff / 60000 }; // Convert ms to minutes
}

/**
 * Calculate tooltip position to keep it within chart bounds
 * 
 * @param mouseX X coordinate of mouse
 * @param chartWidth Width of chart area
 * @param tooltipWidth Width of tooltip box
 * @param margins Chart margins
 * @returns Adjusted X position for tooltip
 */
function calculateTooltipPosition(
  mouseX: number, 
  chartWidth: number, 
  tooltipWidth: number,
  margins: { l: number; r: number }
): number {
  const baseX = mouseX + 8; // Default offset from cursor
  const maxX = margins.l + chartWidth - tooltipWidth - 4;
  return Math.min(baseX, maxX);
}

/**
 * Format date/time for tooltip display
 * 
 * @param date Date to format
 * @param timezone Timezone setting ('local' or 'gmt')
 * @returns Formatted date string
 */
export function formatTooltipTime(date: Date, timezone: 'local' | 'gmt'): string {
  const options: Intl.DateTimeFormatOptions = { 
    month: 'short', 
    day: 'numeric', 
    hour: 'numeric', 
    minute: '2-digit', 
    hour12: true 
  };
  
  if (timezone === 'gmt') {
    (options as any).timeZone = 'UTC';
  }
  
  let formatted = new Intl.DateTimeFormat(undefined, options).format(date);
  // Clean up AM/PM formatting
  formatted = formatted.replace(/\s?([AP]M)$/, (match) => match.trim().toLowerCase());
  
  return formatted;
}

/**
 * Custom hook for managing chart interaction states and calculations
 * 
 * Provides hover tracking, tooltip data calculation, and position management
 * for the FloodCast chart component.
 * 
 * @returns Interaction state and handler functions
 */
export function useChartInteraction(): ChartInteraction & {
  calculateTooltipData: (
    hoverTime: Date,
    observedPoints: Point[],
    predictedPoints: Point[],
    adjustedPoints: Point[],
    deltaPoints: Point[],
    threshold: number,
    showDelta: boolean
  ) => TooltipData | null;
  calculateTooltipPosition: typeof calculateTooltipPosition;
  formatTooltipTime: typeof formatTooltipTime;
} {
  const [hoverT, setHoverT] = useState<Date | null>(null);

  /**
   * Calculate tooltip data for the current hover time
   */
  const calculateTooltipData = useCallback((
    hoverTime: Date,
    observedPoints: Point[],
    predictedPoints: Point[],
    adjustedPoints: Point[],
    deltaPoints: Point[],
    threshold: number,
    showDelta: boolean
  ): TooltipData | null => {
    if (!hoverTime) return null;

    const nearestObs = findNearestPoint(observedPoints, hoverTime);
    const nearestPred = findNearestPoint(predictedPoints, hoverTime);
    const nearestAdj = findNearestPoint(adjustedPoints, hoverTime);
    const nearestDelta = findNearestPoint(deltaPoints, hoverTime);

    const rows: TooltipRow[] = [];

    // Observed data (only show if within 9 minutes)
    if (nearestObs && nearestObs.dtMin <= 9) {
      const color = nearestObs.point.v >= threshold ? '#e74c3c' : '#2ecc71';
      rows.push({
        label: 'Observed',
        value: `${nearestObs.point.v.toFixed(2)} ft`,
        color,
        point: nearestObs.point,
      });
    } else {
      rows.push({
        label: 'Observed',
        value: '—',
        color: '#2ecc71',
      });
    }

    // Predicted data
    if (nearestPred) {
      rows.push({
        label: 'Prediction',
        value: `${nearestPred.point.v.toFixed(2)} ft`,
        color: '#95a5a6',
        point: nearestPred.point,
      });
    }

    // Adjusted prediction data
    if (nearestAdj) {
      const color = nearestAdj.point.v >= threshold ? '#e74c3c' : '#2ecc71';
      rows.push({
        label: 'Adjusted prediction',
        value: `${nearestAdj.point.v.toFixed(2)} ft`,
        color,
        point: nearestAdj.point,
        dashed: true,
      });
    }

    // Delta data (observed - predicted)
    if (showDelta && nearestDelta) {
      const deltaValue = nearestDelta.point.v;
      rows.push({
        label: 'Δ obs - pred',
        value: `${deltaValue >= 0 ? '+' : ''}${deltaValue.toFixed(2)} ft`,
        color: '#1976d2',
        point: nearestDelta.point,
      });
    }

    return {
      time: hoverTime,
      rows,
    };
  }, []);

  return {
    hoverT,
    setHoverT,
    calculateTooltipData,
    calculateTooltipPosition,
    formatTooltipTime,
  };
}

/**
 * Data structure for tooltip information
 */
export interface TooltipData {
  time: Date;
  rows: TooltipRow[];
}

/**
 * Individual row of tooltip data
 */
export interface TooltipRow {
  label: string;
  value: string;
  color: string;
  point?: Point;
  dashed?: boolean;
}
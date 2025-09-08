/**
 * Type definitions for Tab2 (FloodCast) components
 */

/** Data point for chart series */
export interface Point {
  t: Date;
  v: number;
}

/** Station information from NOAA API */
export interface Station {
  id: string;
  name: string;
  state?: string;
  lat?: number;
  lon?: number;
}

/** Chart data series */
export interface ChartData {
  observed: Record<string, number>;
  predicted: Record<string, number>;
  adjusted: Record<string, number>;
  offset: number | null;
  nPoints: number;
}

/** Chart configuration and dimensions */
export interface ChartConfig {
  size: { w: number; h: number };
  margins: { l: number; r: number; t: number; b: number };
  threshold: number;
  showDelta: boolean;
  timezone: 'local' | 'gmt';
}

/** Time range configuration */
export interface TimeRange {
  mode: 'relative' | 'absolute';
  lookbackH: number;
  lookaheadH: number;
  absStart: string;
  absEnd: string;
}

/** Offset configuration for surge adjustment */
export interface OffsetConfig {
  mode: 'auto' | 'manual';
  value: string;
}

/** Complete application configuration */
export interface AppConfiguration {
  station: {
    id: string;
    name: string;
    state?: string;
  };
  threshold: number;
  offset: OffsetConfig;
  timeRange: TimeRange;
  display: {
    timezone: 'local' | 'gmt';
    showDelta: boolean;
    theme?: 'auto' | 'light' | 'dark';
  };
}

/** Chart interaction state */
export interface ChartInteraction {
  hoverT: Date | null;
  setHoverT: (date: Date | null) => void;
}

/** Data loading and error state */
export interface DataState {
  loading: boolean;
  error: string | null;
  data: ChartData;
}

/** Station search state and operations */
export interface StationSearchState {
  allStations: Station[];
  searchResults: Station[];
  loading: boolean;
  error: string | null;
  searchQuery: string;
  selectedIndex: number;
  menuOpen: boolean;
}

/** Threshold crossing information */
export interface ThresholdCrossing {
  tCross: Date;
  leadMinutes: number;
}

/** Chart segment for rendering polylines */
export interface ChartSegment {
  points: Point[];
  above: boolean;
}

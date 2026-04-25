/**
 * Tab2 Component Library - Professional FloodCast Components
 * 
 * This module exports all the refactored Tab2 components and hooks.
 * These components replace the monolithic 1,037-line Tab2.tsx with
 * professional, maintainable, and reusable components.
 */

// Core Components
export { ChartViewer } from './ChartViewer';
export { SettingsModal } from './SettingsModal';
export { StationSelector } from './StationSelector';
export { FloodSettings } from './FloodSettings';
export { TimeSettings } from './TimeSettings';
export { DisplaySettings } from './DisplaySettings';

// Custom Hooks
export { useChartData } from './hooks/useChartData';
export { useSettingsStorage } from './hooks/useSettingsStorage';
export { useStationSearch } from './hooks/useStationSearch';
export { useChartInteraction } from './hooks/useChartInteraction';
export { useChartComments } from './hooks/useChartComments';
export { ChartCommentModal } from './ChartCommentModal';

// Type Definitions
export type {
  Point,
  Station,
  ChartData,
  ChartConfig,
  TimeRange,
  OffsetConfig,
  AppConfiguration,
  ChartInteraction,
  DataState,
  StationSearchState,
  ThresholdCrossing,
  ChartSegment,
} from './types';

// Component library exports - no main Tab2 export since it's being replaced
// The refactored components can be imported individually as needed

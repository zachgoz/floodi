/**
 * Firestore Data Models for FloodCast
 */

/**
 * Observed Water Level Data (Monthly Bucket)
 * Path: locations/{locationId}/observations/{YYYY-MM}
 */
export interface ObservationBucket {
  /** Map of ISO string timestamp to water level value for FiMAN */
  fiman?: Record<string, number>;
  /** Map of ISO string timestamp to water level value for NOAA */
  noaa?: Record<string, number>;
  /** Map of ISO string timestamp to webcam imagery metadata */
  imagery?: Record<string, Record<string, string>>;
  /** Last sync timestamp */
  lastUpdated: string;
}

/**
 * Predicted Water Level Data (Monthly Bucket)
 * Path: locations/{locationId}/predictions/{YYYY-MM}
 */
export interface PredictionBucket {
  /** Map of ISO string timestamp to predicted water level value */
  data: Record<string, number>;
  /** Last sync timestamp */
  lastUpdated: string;
}

/**
 * High Water Peak
 * Path: locations/{locationId}/peaks/{peakId}
 */
export interface WaterLevelPeak {
  /** Timestamp of the peak */
  t: string;
  /** Water level value */
  v: number;
  /** Data source used for this peak */
  source: 'fiman' | 'noaa';
  /** Whether this is a historical observation or a future prediction */
  type: 'observed' | 'predicted';
}

/**
 * Flood Event (Threshold breach)
 * Path: locations/{locationId}/flood_events/{eventId}
 */
export interface FloodEvent {
  /** Start time of the breach */
  startTime: string;
  /** End time of the breach (null if ongoing) */
  endTime: string | null;
  /** Time of the peak level during this event */
  peakTime: string;
  /** Maximum water level reached during this event */
  peakValue: number;
  /** The threshold that was breached */
  thresholdType: 'minor' | 'moderate' | 'major' | 'extreme';
  /** The threshold value in feet */
  thresholdValue: number;
  /** Primary data source for this event */
  source: 'fiman' | 'noaa';
  /** Images captured during the peak of this event */
  peakImages?: Record<string, string>;
}

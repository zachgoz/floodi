/**
 * Firestore Data Models for FloodCast
 * (Copied from app src to avoid common root issues in Firebase Functions)
 */

export interface ObservationBucket {
  fiman?: Record<string, number>;
  noaa?: Record<string, number>;
  imagery?: Record<string, Record<string, string>>;
  lastUpdated: string;
}

export interface PredictionBucket {
  data: Record<string, number>;
  lastUpdated: string;
}

export interface WaterLevelPeak {
  t: string;
  v: number;
  source: 'fiman' | 'noaa';
  type: 'observed' | 'predicted';
}

export interface FloodEvent {
  startTime: string;
  endTime: string | null;
  peakTime: string;
  peakValue: number;
  thresholdType: 'minor' | 'moderate' | 'major' | 'extreme';
  thresholdValue: number;
  source: 'fiman' | 'noaa';
  peakImages?: Record<string, string>;
}

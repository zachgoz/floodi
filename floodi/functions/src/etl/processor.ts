/**
 * Data processing logic for FloodCast ETL
 */

export interface TimeSeries {
  [time: string]: number;
}

export interface Peak {
  t: string;
  v: number;
}

/**
 * Detects local maxima (peaks) in a time series.
 * Useful for finding high tides and extreme events.
 */
export function detectPeaks(series: TimeSeries): Peak[] {
  const entries = Object.entries(series)
    .map(([t, v]) => ({ t, v }))
    .sort((a, b) => a.t.localeCompare(b.t));

  if (entries.length < 3) return [];

  const peaks: Peak[] = [];
  for (let i = 1; i < entries.length - 1; i++) {
    const prev = entries[i - 1].v;
    const curr = entries[i].v;
    const next = entries[i + 1].v;

    if (curr > prev && curr > next) {
      peaks.push({ t: entries[i].t, v: curr });
    }
  }

  return peaks;
}

export interface FloodEventData {
  startTime: string;
  endTime: string | null;
  peakTime: string;
  peakValue: number;
  thresholdType: 'minor' | 'moderate' | 'major' | 'extreme';
  thresholdValue: number;
}

/**
 * Detects flood events where water level exceeds thresholds.
 */
export function detectFloodEvents(
  series: TimeSeries, 
  thresholds: { minor: number; moderate: number; major: number; extreme: number }
): FloodEventData[] {
  const entries = Object.entries(series)
    .map(([t, v]) => ({ t, v }))
    .sort((a, b) => a.t.localeCompare(b.t));

  const events: FloodEventData[] = [];
  let currentEvent: FloodEventData | null = null;

  for (const point of entries) {
    const activeThreshold = getActiveThreshold(point.v, thresholds);

    if (activeThreshold && !currentEvent) {
      // Start new event
      currentEvent = {
        startTime: point.t,
        endTime: null,
        peakTime: point.t,
        peakValue: point.v,
        thresholdType: activeThreshold.type,
        thresholdValue: activeThreshold.value
      };
    } else if (currentEvent) {
      // Update peak
      if (point.v > currentEvent.peakValue) {
        currentEvent.peakValue = point.v;
        currentEvent.peakTime = point.t;
        
        // Upgrade threshold if reached higher level
        const higherThreshold = getActiveThreshold(point.v, thresholds);
        if (higherThreshold && isHigher(higherThreshold.type, currentEvent.thresholdType)) {
          currentEvent.thresholdType = higherThreshold.type;
          currentEvent.thresholdValue = higherThreshold.value;
        }
      }

      // Check if event ended
      if (point.v < thresholds.minor) {
        currentEvent.endTime = point.t;
        events.push(currentEvent);
        currentEvent = null;
      }
    }
  }

  if (currentEvent) {
    events.push(currentEvent);
  }

  return events;
}

function getActiveThreshold(v: number, thresholds: any) {
  if (v >= thresholds.extreme) return { type: 'extreme' as const, value: thresholds.extreme };
  if (v >= thresholds.major) return { type: 'major' as const, value: thresholds.major };
  if (v >= thresholds.moderate) return { type: 'moderate' as const, value: thresholds.moderate };
  if (v >= thresholds.minor) return { type: 'minor' as const, value: thresholds.minor };
  return null;
}

function isHigher(a: string, b: string): boolean {
  const rank: Record<string, number> = { minor: 1, moderate: 2, major: 3, extreme: 4 };
  return rank[a] > rank[b];
}

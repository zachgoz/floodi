export interface RoadSegment {
  id: string;
  name: string;
  elevationFtMLLW: number;
  stationId: string;
  sensorPlatform?: string;
}

export interface FloodForecastPoint {
  timestamp: string;
  predictedLevelFt: number;
  inundationDepthFt: number;
  isFlooded: boolean;
}

export interface FloodWindow {
  segmentId: string;
  start: string;
  end: string;
  maxDepthFt: number;
  durationMinutes: number;
}

export function calculateFloodForecast(predictions: { t: string; v: string }[], elevation: number): FloodForecastPoint[] {
  return predictions.map(p => {
    const predictedLevelFt = parseFloat(p.v);
    const inundationDepthFt = Math.max(0, predictedLevelFt - elevation);
    return {
      timestamp: new Date(p.t + 'Z').toISOString(),
      predictedLevelFt,
      inundationDepthFt,
      isFlooded: inundationDepthFt > 0
    } as FloodForecastPoint;
  });
}

export function summarizeFloodWindows(points: FloodForecastPoint[], segmentId: string): FloodWindow[] {
  const windows: FloodWindow[] = [];
  let current: FloodWindow | null = null;
  for (const pt of points) {
    if (pt.isFlooded) {
      if (!current) {
        current = { segmentId, start: pt.timestamp, end: pt.timestamp, maxDepthFt: pt.inundationDepthFt, durationMinutes: 0 };
      } else {
        current.end = pt.timestamp;
        current.maxDepthFt = Math.max(current.maxDepthFt, pt.inundationDepthFt);
      }
    } else if (current) {
      current.durationMinutes = (new Date(current.end).getTime() - new Date(current.start).getTime()) / 60000;
      windows.push(current);
      current = null;
    }
  }
  if (current) {
    current.durationMinutes = (new Date(current.end).getTime() - new Date(current.start).getTime()) / 60000;
    windows.push(current);
  }
  return windows;
}

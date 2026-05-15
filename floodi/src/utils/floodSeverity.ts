export type FloodSeverity = 'minor' | 'moderate' | 'major' | 'extreme';

export interface FloodThresholds {
  minor: number;
  moderate: number;
  major: number;
  extreme: number;
}

export const FLOOD_SEVERITY_COLORS: Record<FloodSeverity, string> = {
  minor: '#ffdc1e',
  moderate: '#ffa500',
  major: '#d22323',
  extreme: '#a020f0',
};

export function getFloodSeverityForLevel(level: number, thresholds: FloodThresholds): FloodSeverity | null {
  if (level >= thresholds.extreme) return 'extreme';
  if (level >= thresholds.major) return 'major';
  if (level >= thresholds.moderate) return 'moderate';
  if (level >= thresholds.minor) return 'minor';
  return null;
}

export function getFloodSeverityLabel(severity: FloodSeverity | null): string {
  if (!severity) return 'None';
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

export function getFloodSeverityColor(severity: FloodSeverity | null): string {
  return severity ? FLOOD_SEVERITY_COLORS[severity] : 'var(--line-observed, #2ecc71)';
}

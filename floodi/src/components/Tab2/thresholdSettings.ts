import type { AppConfiguration } from './types';

/** Personal chart thresholds must be finite, positive and strictly ordered. */
export function validThresholds(value: AppConfiguration['thresholds']): boolean {
  const levels = [value.minor, value.moderate, value.major, value.extreme];
  return levels.every((level, index) => Number.isFinite(level) && level > 0 && (index === 0 || level > levels[index - 1]));
}

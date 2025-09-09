import { useState, useEffect, useCallback } from 'react';
import type { AppConfiguration, TimeRange, OffsetConfig } from '../types';

/**
 * Local storage keys for configuration persistence
 */
const STORAGE_KEYS = {
  STATION: 'floodi.station',
  THRESHOLD: 'floodi.threshold',
  OFFSET_MODE: 'floodi.offset.mode',
  OFFSET_VALUE: 'floodi.offset.value',
  LOOKBACK_H: 'floodi.hist.lookbackH',
  LOOKAHEAD_H: 'floodi.hist.lookaheadH',
  RANGE_MODE: 'floodi.hist.rangeMode',
  ABS_START: 'floodi.hist.absStart',
  ABS_END: 'floodi.hist.absEnd',
  TIMEZONE: 'floodi.tz',
  SHOW_DELTA: 'floodi.delta.show',
  THEME: 'floodi.theme',
} as const;

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: AppConfiguration = {
  station: {
    id: '8658163',
    name: '',
    state: undefined,
  },
  threshold: 6.1, // MLLW feet
  offset: {
    mode: 'auto',
    value: '',
  },
  timeRange: {
    mode: 'relative',
    lookbackH: 36,
    lookaheadH: 48,
    absStart: new Date(Date.now() - 36 * 3600_000).toISOString(),
    absEnd: new Date(Date.now() + 48 * 3600_000).toISOString(),
  },
  display: {
    timezone: 'local',
    showDelta: false,
    theme: 'auto',
  },
};

/**
 * Safely read a value from localStorage with error handling
 * @param key Storage key
 * @param defaultValue Default value if key doesn't exist or error occurs
 * @returns Stored value or default
 */
function safeGetStorageItem(key: string, defaultValue: string): string {
  try {
    if (typeof window === 'undefined') return defaultValue;
    return window.localStorage.getItem(key) ?? defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * Safely write a value to localStorage with error handling
 * @param key Storage key
 * @param value Value to store
 */
function safeSetStorageItem(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // Silently fail - storage may be unavailable
  }
}

/**
 * Custom hook for managing application configuration with localStorage persistence
 * 
 * @returns Configuration state and update functions
 */
export function useSettingsStorage() {
  // Initialize configuration from localStorage or defaults
  const [config, setConfig] = useState<AppConfiguration>(() => {
    const storedThreshold = safeGetStorageItem(STORAGE_KEYS.THRESHOLD, String(DEFAULT_CONFIG.threshold));
    const threshold = parseFloat(storedThreshold);
    
    const storedLookback = safeGetStorageItem(STORAGE_KEYS.LOOKBACK_H, String(DEFAULT_CONFIG.timeRange.lookbackH));
    const lookbackH = parseInt(storedLookback, 10);
    
    const storedLookahead = safeGetStorageItem(STORAGE_KEYS.LOOKAHEAD_H, String(DEFAULT_CONFIG.timeRange.lookaheadH));
    const lookaheadH = parseInt(storedLookahead, 10);
    
    return {
      station: {
        id: safeGetStorageItem(STORAGE_KEYS.STATION, DEFAULT_CONFIG.station.id),
        name: DEFAULT_CONFIG.station.name,
        state: DEFAULT_CONFIG.station.state,
      },
      threshold: Number.isFinite(threshold) && threshold > 0 ? threshold : DEFAULT_CONFIG.threshold,
      offset: {
        mode: safeGetStorageItem(STORAGE_KEYS.OFFSET_MODE, DEFAULT_CONFIG.offset.mode) as 'auto' | 'manual',
        value: safeGetStorageItem(STORAGE_KEYS.OFFSET_VALUE, DEFAULT_CONFIG.offset.value),
      },
      timeRange: {
        mode: safeGetStorageItem(STORAGE_KEYS.RANGE_MODE, DEFAULT_CONFIG.timeRange.mode) as 'relative' | 'absolute',
        lookbackH: Number.isFinite(lookbackH) && lookbackH > 0 ? lookbackH : DEFAULT_CONFIG.timeRange.lookbackH,
        lookaheadH: Number.isFinite(lookaheadH) && lookaheadH > 0 ? lookaheadH : DEFAULT_CONFIG.timeRange.lookaheadH,
        absStart: safeGetStorageItem(STORAGE_KEYS.ABS_START, DEFAULT_CONFIG.timeRange.absStart),
        absEnd: safeGetStorageItem(STORAGE_KEYS.ABS_END, DEFAULT_CONFIG.timeRange.absEnd),
      },
      display: {
        timezone: safeGetStorageItem(STORAGE_KEYS.TIMEZONE, DEFAULT_CONFIG.display.timezone) as 'local' | 'gmt',
        showDelta: safeGetStorageItem(STORAGE_KEYS.SHOW_DELTA, '0') === '1',
        theme: (() => {
          const storedTheme = safeGetStorageItem(STORAGE_KEYS.THEME, DEFAULT_CONFIG.display.theme!);
          return (storedTheme === 'auto' || storedTheme === 'light' || storedTheme === 'dark') ? storedTheme : DEFAULT_CONFIG.display.theme;
        })(),
      },
    };
  });

  // Persist changes to localStorage when config updates
  useEffect(() => {
    safeSetStorageItem(STORAGE_KEYS.STATION, config.station.id);
  }, [config.station.id]);

  useEffect(() => {
    safeSetStorageItem(STORAGE_KEYS.THRESHOLD, String(config.threshold));
  }, [config.threshold]);

  useEffect(() => {
    safeSetStorageItem(STORAGE_KEYS.OFFSET_MODE, config.offset.mode);
  }, [config.offset.mode]);

  useEffect(() => {
    safeSetStorageItem(STORAGE_KEYS.OFFSET_VALUE, config.offset.value);
  }, [config.offset.value]);

  useEffect(() => {
    safeSetStorageItem(STORAGE_KEYS.LOOKBACK_H, String(config.timeRange.lookbackH));
  }, [config.timeRange.lookbackH]);

  useEffect(() => {
    safeSetStorageItem(STORAGE_KEYS.LOOKAHEAD_H, String(config.timeRange.lookaheadH));
  }, [config.timeRange.lookaheadH]);

  useEffect(() => {
    safeSetStorageItem(STORAGE_KEYS.RANGE_MODE, config.timeRange.mode);
  }, [config.timeRange.mode]);

  useEffect(() => {
    safeSetStorageItem(STORAGE_KEYS.ABS_START, config.timeRange.absStart);
  }, [config.timeRange.absStart]);

  useEffect(() => {
    safeSetStorageItem(STORAGE_KEYS.ABS_END, config.timeRange.absEnd);
  }, [config.timeRange.absEnd]);

  useEffect(() => {
    safeSetStorageItem(STORAGE_KEYS.TIMEZONE, config.display.timezone);
  }, [config.display.timezone]);

  useEffect(() => {
    safeSetStorageItem(STORAGE_KEYS.SHOW_DELTA, config.display.showDelta ? '1' : '0');
  }, [config.display.showDelta]);

  useEffect(() => {
    const theme = config.display.theme ?? 'auto';
    safeSetStorageItem(STORAGE_KEYS.THEME, theme);
    try {
      const root = document.documentElement;
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      const shouldDark = theme === 'dark' || (theme === 'auto' && prefersDark);
      root.classList.toggle('ion-palette-dark', shouldDark);
    } catch { void 0; }
  }, [config.display.theme]);

  // Update functions for different configuration sections
  const updateStation = useCallback((station: Partial<AppConfiguration['station']>) => {
    setConfig(prev => ({
      ...prev,
      station: { ...prev.station, ...station },
    }));
  }, []);

  const updateThreshold = useCallback((threshold: number) => {
    setConfig(prev => ({ ...prev, threshold }));
  }, []);

  const updateOffset = useCallback((offset: Partial<OffsetConfig>) => {
    setConfig(prev => ({
      ...prev,
      offset: { ...prev.offset, ...offset },
    }));
  }, []);

  const updateTimeRange = useCallback((timeRange: Partial<TimeRange>) => {
    setConfig(prev => ({
      ...prev,
      timeRange: { ...prev.timeRange, ...timeRange },
    }));
  }, []);

  const updateDisplay = useCallback((display: Partial<AppConfiguration['display']>) => {
    setConfig(prev => ({
      ...prev,
      display: { ...prev.display, ...display },
    }));
  }, []);

  return {
    config,
    updateStation,
    updateThreshold,
    updateOffset,
    updateTimeRange,
    updateDisplay,
  };
}

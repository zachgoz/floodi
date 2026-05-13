import { useState, useEffect, useCallback } from 'react';
import type { AppConfiguration, TimeRange, OffsetConfig } from '../types';
import { LOCATIONS } from 'src/constants/locations';

/**
 * Local storage keys for configuration persistence
 */
const STORAGE_KEYS = {
  LOCATION_ID: 'floodi.location_id',
  THRESHOLDS: 'floodi.thresholds',
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
  VIEW_MODE: 'floodi.view_mode',
  DATA_SOURCE: 'floodi.data_source',
} as const;

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: AppConfiguration = {
  locationId: 'carolina-beach',
  location: {
    id: 'carolina-beach',
    name: 'Carolina Beach',
    state: 'NC',
  },
  station: {
    id: '8658163',
    name: 'Carolina Beach',
  },
  thresholds: {
    minor: 5.6,
    moderate: 7.0,
    major: 7.7,
    extreme: 8.5,
  },
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
    viewMode: 'basic',
    dataSource: 'fiman',
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
    const locationId = safeGetStorageItem(STORAGE_KEYS.LOCATION_ID, DEFAULT_CONFIG.locationId);
    
    const storedThresholds = safeGetStorageItem(STORAGE_KEYS.THRESHOLDS, '');
    let thresholds = DEFAULT_CONFIG.thresholds;
    try {
      if (storedThresholds) {
        const parsed = JSON.parse(storedThresholds);
        if (parsed && typeof parsed.minor === 'number') {
          thresholds = { ...DEFAULT_CONFIG.thresholds, ...parsed };
          // Migration: if the stored value is an old default for Carolina Beach, update it
          if (locationId === 'carolina-beach') {
            const staleValues = [3.5, 4.0, 6.1]; // Known historical or incorrect values
            if (staleValues.includes(thresholds.minor)) {
              thresholds = { ...LOCATIONS['carolina-beach'].thresholds };
            }
          }
        }
      }
    } catch { /* ignore */ }
    
    const storedLookback = safeGetStorageItem(STORAGE_KEYS.LOOKBACK_H, String(DEFAULT_CONFIG.timeRange.lookbackH));
    const lookbackH = parseInt(storedLookback, 10);
    
    const storedLookahead = safeGetStorageItem(STORAGE_KEYS.LOOKAHEAD_H, String(DEFAULT_CONFIG.timeRange.lookaheadH));
    const lookaheadH = parseInt(storedLookahead, 10);
    
    return {
      locationId,
      location: DEFAULT_CONFIG.location, // In a multi-town scenario, we'd lookup by locationId
      station: {
        id: LOCATIONS[locationId]?.noaaStationId || DEFAULT_CONFIG.station.id,
        name: LOCATIONS[locationId]?.name || DEFAULT_CONFIG.station.name,
      },
      thresholds,
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
        viewMode: safeGetStorageItem(STORAGE_KEYS.VIEW_MODE, DEFAULT_CONFIG.display.viewMode!) as 'basic' | 'advanced',
        dataSource: safeGetStorageItem(STORAGE_KEYS.DATA_SOURCE, DEFAULT_CONFIG.display.dataSource) as 'fiman' | 'noaa',
      },
    };
  });

  // Persist changes to localStorage when config updates
  useEffect(() => {
    safeSetStorageItem(STORAGE_KEYS.LOCATION_ID, config.locationId);
    safeSetStorageItem(STORAGE_KEYS.THRESHOLDS, JSON.stringify(config.thresholds));
    safeSetStorageItem(STORAGE_KEYS.OFFSET_MODE, config.offset.mode);
    safeSetStorageItem(STORAGE_KEYS.OFFSET_VALUE, config.offset.value);
    safeSetStorageItem(STORAGE_KEYS.LOOKBACK_H, String(config.timeRange.lookbackH));
    safeSetStorageItem(STORAGE_KEYS.LOOKAHEAD_H, String(config.timeRange.lookaheadH));
    safeSetStorageItem(STORAGE_KEYS.RANGE_MODE, config.timeRange.mode);
    safeSetStorageItem(STORAGE_KEYS.ABS_START, config.timeRange.absStart);
    safeSetStorageItem(STORAGE_KEYS.ABS_END, config.timeRange.absEnd);
    safeSetStorageItem(STORAGE_KEYS.TIMEZONE, config.display.timezone);
    safeSetStorageItem(STORAGE_KEYS.SHOW_DELTA, config.display.showDelta ? '1' : '0');
    safeSetStorageItem(STORAGE_KEYS.VIEW_MODE, config.display.viewMode ?? 'basic');
    if (config.display.theme) {
      safeSetStorageItem(STORAGE_KEYS.THEME, config.display.theme);
    }
    safeSetStorageItem(STORAGE_KEYS.DATA_SOURCE, config.display.dataSource);
  }, [config]);

  useEffect(() => {
    const theme = config.display.theme ?? 'auto';
    try {
      const root = document.documentElement;
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      const shouldDark = theme === 'dark' || (theme === 'auto' && prefersDark);
      const forceLight = theme === 'light';
      root.classList.toggle('ion-palette-dark', shouldDark);
      root.classList.toggle('ion-palette-light', forceLight);
    } catch { void 0; }
  }, [config.display.theme]);

  // Update functions for different configuration sections
  const updateLocation = useCallback((locationId: string) => {
    const newLoc = LOCATIONS[locationId];
    if (!newLoc) return;

    setConfig(prev => ({
      ...prev,
      locationId,
      location: {
        id: newLoc.id,
        name: newLoc.name,
        state: newLoc.state,
      },
      station: {
        id: newLoc.noaaStationId,
        name: newLoc.name,
      },
      thresholds: {
        ...newLoc.thresholds
      }
    }));
  }, []);

  const updateThresholds = useCallback((thresholds: Partial<AppConfiguration['thresholds']>) => {
    setConfig(prev => ({ ...prev, thresholds: { ...prev.thresholds, ...thresholds } }));
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

  const resetToLive = useCallback(() => {
    setConfig(prev => ({
      ...prev,
      timeRange: {
        ...prev.timeRange,
        mode: 'relative'
      }
    }));
  }, []);

  const resetToDefaults = useCallback(() => {
    // Clear all storage keys handled by this hook
    Object.values(STORAGE_KEYS).forEach(key => {
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem(key);
        }
      } catch { /* ignore */ }
    });
    // Reset state to initial defaults
    setConfig(DEFAULT_CONFIG);
  }, []);

  return {
    config,
    updateLocation,
    updateThresholds,
    updateOffset,
    updateTimeRange,
    updateDisplay,
    resetToLive,
    resetToDefaults,
  };
}

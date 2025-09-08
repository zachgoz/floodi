import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Station, StationSearchState } from '../types';

/**
 * Cache key and expiration time for station data
 */
const STATIONS_CACHE_KEY = 'floodi.stations.cache.v1';
const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Safely access localStorage with error handling
 */
function safeGetStorageItem(key: string): string | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Safely write to localStorage with error handling
 */
function safeSetStorageItem(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // Silently fail if storage is unavailable
  }
}

/**
 * Load cached station data if available and not expired
 */
function loadCachedStations(): Station[] {
  const cached = safeGetStorageItem(STATIONS_CACHE_KEY);
  if (!cached) return [];

  try {
    const { ts, data } = JSON.parse(cached);
    if (Array.isArray(data) && Date.now() - (ts || 0) < CACHE_EXPIRY_MS) {
      return data;
    }
  } catch {
    // Invalid cache data
  }
  
  return [];
}

/**
 * Cache station data with timestamp
 */
function cacheStations(stations: Station[]): void {
  const cacheData = { ts: Date.now(), data: stations };
  safeSetStorageItem(STATIONS_CACHE_KEY, JSON.stringify(cacheData));
}

/**
 * Fetch all NOAA water level stations
 */
async function fetchAllStations(): Promise<Station[]> {
  const response = await fetch(
    'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=waterlevels'
  );
  
  if (!response.ok) {
    throw new Error(`Failed to fetch stations: HTTP ${response.status}`);
  }
  
  const data = await response.json();
  const stations = (data?.stations || []) as any[];
  
  return stations.map(station => ({
    id: String(station.id),
    name: String(station.name || ''),
    state: station.state,
    lat: station.lat,
    lon: station.lon,
  }));
}

/**
 * Filter stations based on search query
 * @param stations Array of all stations
 * @param query Search query string
 * @param limit Maximum number of results to return
 * @returns Filtered stations array
 */
function filterStations(stations: Station[], query: string, limit: number = 25): Station[] {
  const searchQuery = query.trim().toLowerCase();
  
  if (!searchQuery) {
    return stations.slice(0, limit);
  }
  
  return stations
    .filter(station => 
      station.id.includes(searchQuery) ||
      station.name.toLowerCase().includes(searchQuery) ||
      (station.state || '').toLowerCase().includes(searchQuery)
    )
    .slice(0, limit);
}

/**
 * Custom hook for managing station search functionality
 * 
 * Provides professional station search with caching, debouncing, and keyboard navigation
 * 
 * @param initialStationId Initial selected station ID
 * @returns Station search state and control functions
 */
export function useStationSearch(initialStationId: string) {
  const [searchState, setSearchState] = useState<StationSearchState>({
    allStations: loadCachedStations(),
    searchResults: [],
    loading: false,
    error: null,
    searchQuery: '',
    selectedIndex: -1,
    menuOpen: false,
  });

  /**
   * Load all stations on first use
   */
  const loadStations = useCallback(async () => {
    if (searchState.loading || searchState.allStations.length > 0) {
      return;
    }

    setSearchState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const stations = await fetchAllStations();
      cacheStations(stations);
      
      setSearchState(prev => ({
        ...prev,
        allStations: stations,
        loading: false,
      }));
    } catch (error: any) {
      setSearchState(prev => ({
        ...prev,
        loading: false,
        error: error?.message || 'Failed to load stations',
      }));
    }
  }, [searchState.loading, searchState.allStations.length]);

  /**
   * Update search query and filter results
   */
  const setSearchQuery = useCallback((query: string) => {
    setSearchState(prev => {
      const filtered = filterStations(prev.allStations, query);
      return {
        ...prev,
        searchQuery: query,
        searchResults: filtered,
        selectedIndex: filtered.length > 0 ? 0 : -1,
      };
    });
  }, []);

  /**
   * Open search menu
   */
  const openMenu = useCallback(() => {
    setSearchState(prev => ({ ...prev, menuOpen: true }));
    if (searchState.allStations.length === 0) {
      loadStations();
    }
  }, [searchState.allStations.length, loadStations]);

  /**
   * Close search menu
   */
  const closeMenu = useCallback(() => {
    setSearchState(prev => ({ 
      ...prev, 
      menuOpen: false, 
      selectedIndex: -1 
    }));
  }, []);

  /**
   * Navigate selection with keyboard
   */
  const navigateSelection = useCallback((direction: 'up' | 'down') => {
    setSearchState(prev => {
      const maxIndex = prev.searchResults.length - 1;
      let newIndex = prev.selectedIndex;
      
      if (direction === 'down') {
        newIndex = newIndex < maxIndex ? newIndex + 1 : 0;
      } else {
        newIndex = newIndex > 0 ? newIndex - 1 : maxIndex;
      }
      
      return { ...prev, selectedIndex: newIndex };
    });
  }, []);

  /**
   * Set selected index directly (for mouse hover)
   */
  const setSelectedIndex = useCallback((index: number) => {
    setSearchState(prev => ({ ...prev, selectedIndex: index }));
  }, []);

  /**
   * Get display name for a station
   */
  const getStationDisplayName = useCallback((stationId: string): string => {
    const station = searchState.allStations.find(s => s.id === stationId);
    if (!station) return stationId;
    
    return `${station.name} (${station.id})${station.state ? `, ${station.state}` : ''}`;
  }, [searchState.allStations]);

  /**
   * Get currently selected station
   */
  const selectedStation = useMemo((): Station | null => {
    const { searchResults, selectedIndex } = searchState;
    if (selectedIndex >= 0 && selectedIndex < searchResults.length) {
      return searchResults[selectedIndex];
    }
    return null;
  }, [searchState.searchResults, searchState.selectedIndex]);

  // Initialize search results when stations are loaded
  useEffect(() => {
    if (searchState.allStations.length > 0 && searchState.searchResults.length === 0 && !searchState.searchQuery) {
      const initial = filterStations(searchState.allStations, '');
      setSearchState(prev => ({ 
        ...prev, 
        searchResults: initial,
        selectedIndex: initial.length > 0 ? 0 : -1,
      }));
    }
  }, [searchState.allStations.length, searchState.searchResults.length, searchState.searchQuery]);

  return {
    ...searchState,
    selectedStation,
    setSearchQuery,
    openMenu,
    closeMenu,
    navigateSelection,
    setSelectedIndex,
    getStationDisplayName,
    loadStations,
  };
}
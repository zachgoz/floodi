import { logEvent } from 'firebase/analytics';
import { analytics } from 'src/lib/firebase';

/**
 * Log a generic event to Firebase Analytics if initialized.
 * @param eventName The name of the event (limit 40 chars, alphanumeric/underscores)
 * @param params Optional key-value pairs of event metadata
 */
export const trackEvent = (eventName: string, params?: Record<string, any>) => {
  if (analytics) {
    try {
      logEvent(analytics, eventName, params);
    } catch (err) {
      console.warn(`[Analytics] Failed to track event: ${eventName}`, err);
    }
  }
};

/**
 * Track a page/screen transition.
 * @param screenPath The URL path or component name representing the current view
 */
export const trackScreenView = (screenPath: string) => {
  trackEvent('screen_view', {
    screen_name: screenPath,
    page_path: screenPath,
  });
};

/**
 * Track user changing/selecting a webcam camera.
 * @param cameraId The ID of the selected camera
 * @param webcamName The readable name of the selected webcam
 */
export const trackWebcamChange = (cameraId: string, webcamName: string) => {
  trackEvent('webcam_select', {
    camera_id: cameraId,
    webcam_name: webcamName,
  });
};

/**
 * Track user navigating historical or live webcam times.
 * @param hours The time offset shift in hours (e.g., -1 for back, 1 for forward)
 * @param cameraId The ID of the active camera
 */
export const trackWebcamTimeShift = (hours: number, cameraId: string) => {
  trackEvent('webcam_time_shift', {
    hours_offset: hours,
    camera_id: cameraId,
  });
};

/**
 * Track simulation water level adjustments (throttle in UI if firing excessively).
 * @param stationId The NOAA/FIMAN station being simulated
 * @param levelFt The water level height in feet
 */
export const trackSimulationLevel = (stationId: string, levelFt: number) => {
  trackEvent('simulation_adjust', {
    station_id: stationId,
    water_level_ft: Number(levelFt.toFixed(2)),
  });
};

/**
 * Track comment submission events.
 * @param stationId The station details associated with the comment
 * @param locationId The location ID associated with the comment
 */
export const trackCommentSubmit = (stationId: string, locationId: string) => {
  trackEvent('comment_submit', {
    station_id: stationId,
    location_id: locationId,
  });
};

/**
 * Track application theme changes.
 * @param theme The selected theme mode
 */
export const trackThemeToggle = (theme: 'light' | 'dark' | 'auto') => {
  trackEvent('theme_toggle', {
    theme_mode: theme,
  });
};

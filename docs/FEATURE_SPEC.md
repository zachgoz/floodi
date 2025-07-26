# Flood Monitor Feature Specification

## Vision & Goals

Build a cross-platform Ionic React V8 application that visualizes real-time and historical coastal water levels. Blend street-level sensor data from the Sunny Day Flood API with NOAA predictions and observations, and clearly communicate if/when a road segment will flood and by how much (inundation depth). The app should provide proactive alerts, easy-to-read charts and a simple UX for non-technical end users.

## Primary Users & Use Cases

- **Residents & Commuters** need to know whether a driveway or route will be flooded in the next hours or days.
- **City/County Staff** want quick visualizations and thresholds with exportable reports for coordination.
- **Developers/Researchers** are interested in raw data access and algorithm transparency.

Sample scenarios include:

- "Will Canal Dr flood tomorrow morning?"
- "How high did the water get last week?"
- "Send a push notification when forecasted level exceeds 1.5 ft above MLLW."

## Data Sources

- **Sunny Day Flood API** for street sensor readings.
- **NOAA Water Levels API** for predicted and observed levels.
- **Road elevation/threshold data** stored locally or from a config service.

All levels are normalized to MLLW. APIs may require a proxy because of CORS or rate limits.

## Core Features

### Dashboard & Charting

Interactive time‑series charts overlay street sensor readings, NOAA predicted levels and NOAA observed levels. Shaded regions indicate threshold exceedance. Users can toggle past/future ranges and see tooltips for exact values and inundation depth.

### Flood Prediction & Inundation Calculation

For each time point the app compares predicted level with road elevation to determine flooding and compute inundation depth. Results are displayed as messages like "Likely flooded at 08:00, +0.42 ft above roadway". Thresholds for alerts can be configured.

### Alerts & Notifications

Local push notifications (FCM/APNs) trigger when user configured rules match. Background tasks periodically refresh predictions.

### Map & Location Context

An interactive map shows sensor locations, road segments and predicted inundation overlays.

### Offline & Caching

Fetched data is cached with IndexedDB and the UI falls back to the last known state when offline.

### Data Export & Sharing

Users can export chart snapshots and copy deep links with station and time range parameters.

## Prediction Engine

1. Fetch NOAA predictions for the desired range.
2. For each timestamp compare the prediction with road elevation.
3. Mark flooding if the prediction exceeds elevation and compute inundation depth.
4. Aggregate flooding intervals with start, end, maximum depth and duration.

Outputs include per-time-point data, summary windows and events for notifications.

## UX / UI Flow

1. Onboarding screens request notification permission.
2. Home dashboard shows current status, the chart and a button to view the map.
3. Alerts settings allow depth and time window configuration.
4. History screen displays historical charts with export options.
5. Settings screen provides datum info, unit toggles and API health indicators.

## Tech Stack

- **Framework**: Ionic React V8 with Capacitor 6
- **Charts**: Recharts or Chart.js
- **State**: React Query and optional Zustand/Redux Toolkit
- **Storage**: IndexedDB via localforage
- **Build**: Vite + Ionic CLI, deploy as PWA and native apps
- **Push/Background**: Capacitor Push Notifications and Background Tasks

API wrappers encapsulate calls to the Sunny Day Flood API and the NOAA endpoints, normalizing units and timestamps to a common datum.

## Testing Strategy

- Unit tests for utilities such as normalization and prediction logic.
- Integration tests using React Testing Library and MSW.
- End-to-end tests with Cypress or Playwright.
- Performance tests with Lighthouse to ensure PWA compliance.


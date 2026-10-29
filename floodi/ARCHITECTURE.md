# FloodCast Architecture Documentation

## Overview

FloodCast is a React mobile and web application that provides hyperlocal tide and flood insights from NOAA predictions and regional gauge measurements. It combines observed water levels with astronomical tides to estimate non-tidal residuals and potential flooding. Positive residuals are not automatically attributed to storms.

The production reliability path uses daily UTC observation buckets with legacy monthly compatibility, independent source updates, private job/freshness status, bounded provider caching, and privacy-safe frontend error collection. See [the October 14 implementation](docs/RELIABILITY-IMPLEMENTATION-2026-10-14.md), [storage compatibility](docs/DAILY-OBSERVATION-STORAGE.md), and [frontend diagnostics](docs/FRONTEND-ERROR-COLLECTION.md) for the current contracts and deployment verification.

## Technology Stack

### Core Framework
- **React 19**: Latest version with concurrent features and improved performance
- **TypeScript**: Static typing for better code quality and developer experience
- **Ionic React**: Cross-platform UI framework providing native-style components

### Mobile Platform
- **Capacitor**: Native mobile app runtime enabling iOS and Android deployment
- **Progressive Web App (PWA)**: Web-based app with offline capabilities

### Build & Development
- **Vite**: Fast build tool with hot module replacement for development
- **ESLint**: Code quality and style enforcement
- **Vitest**: Unit testing framework
- **Cypress**: End-to-end testing

### Backend Services
- **NOAA API**: Real-time tide and water level data
- **Firebase**: Authentication, hosting, and potential data storage

### Application Architecture

### High-Level Structure

```
floodi/
├── src/
│   ├── App.tsx                 # Root application component
│   ├── main.tsx               # Application entry point
│   ├── components/            # Shared UI components
│   │   ├── Tab2/              # Modularized dashboard components
│   │   │   ├── hooks/         # Logic-heavy custom hooks (useChartData, useAtmosphericState)
│   │   │   ├── types/         # Domain-specific TypeScript interfaces
│   │   │   └── ...            # Sub-components (SettingsModal, ChartViewer)
│   │   └── dashboard/         # Pure visualization components (InundationMap, HydrographChart)
│   ├── pages/                 # Main page components
│   ├── lib/                   # Business logic and API integrations (dataService, noaa)
│   └── theme/                 # Styling and theme configuration
├── functions/                 # Firebase Cloud Functions (ETL, Backfill, Proxy)
├── public/                    # Static assets
├── capacitor.config.ts        # Native app configuration
└── vite.config.ts            # Build system configuration
```

### Component Hierarchy (Tab2)

```
Tab2 (Page)
├── useSettingsStorage (Hook: Persistent config)
├── useChartData (Hook: Data fetching/processing)
├── useAtmosphericState (Hook: Real-time & simulation logic)
├── DashboardView (Layout container)
│   ├── AtmosphericOverlay (Pill indicators)
│   ├── HydrographChart (D3-powered time-series)
│   ├── InundationMap (Mapbox GL JS integration)
│   ├── InundationSimulator (Manual flood control)
│   └── WebcamFeedCard (Live visual validation)
├── FloodEventSidebar (Historical event navigation)
└── SettingsModal (Multi-tab configuration)
```

## Data Flow Architecture

### 1. Data Sources
- **NOAA Tides and Currents API**: Primary source for tidal predictions and coastal water levels.
- **FiMAN (Sunny Day Flooding)**: Local sensor network for high-precision, hyperlocal flooding data.
- **Firestore**: Persistent storage for synchronized observations, historical peaks, and user metadata.
- **Firebase Functions Proxy**: CORS-bypass and caching layer for external APIs (e.g., FiMAN).

### 2. Data Processing Pipeline (ETL)

FloodCast employs a robust ETL pipeline running in Firebase Functions to ensure data reliability and performance:

1.  **Sync Service**: Periodic functions poll NOAA and FiMAN for new observations.
2.  **Backfill Service**: Background jobs populate historical records in 30-day buckets.
3.  **Peak Detection**: Algorithms identify significant water level events and store them as `peaks` for quick historical comparison.
4.  **UI Transformation**: The `useChartData` hook merges multiple sources, aligns phases, and derives surge estimates in real-time.

## Core Modules

### 1. Data Service Layer (`/src/lib/dataService.ts`)

**Purpose**: Unified interface for Firestore and external data sources.

**Key Functions**:
- `fetchWaterLevels()`: Merges FiMAN and NOAA data based on availability and config.
- `findLastSimilarLevel()`: Queries historical peaks to find previous occurrences of a specific water level.
- `fetchFloodEvents()`: Retrieves identified flood events for the sidebar.

### 2. Atmospheric Logic Hook (`/src/components/Tab2/hooks/useAtmosphericState.ts`)

**Purpose**: Encapsulates the derivation of current atmospheric conditions (wind, precip, wl) and manages the interactive simulation state. This ensures that the map, chart, and overlay indicators always stay in sync regardless of whether the user is viewing live data, historical data, or a manual simulation.

## Deployment Architecture

### Backend (Firebase)
- **Functions (v2)**: High-performance HTTPS and Scheduled functions.
- **Firestore**: NoSQL database for time-series and metadata.
- **Storage**: Caching for webcam imagery and large GeoJSON assets.
- **Hosting**: Global CDN for the React application.

This architecture provides a scalable, modular foundation that separates complex data logic from UI presentation, enabling rapid iteration on both the data pipeline and the user interface.


This architecture provides a solid foundation for FloodCast's current functionality while supporting future enhancements and scaling requirements.

## Unified Multi-Regime Operational Forecasting (`basinPhysics` + TimesFM)

`functions/src/forecast/basinPhysics.ts` and `functions/src/forecast/challenger.ts` power a single unified physical water-level and surge forecast across the backend, public dashboard (`Tab2.tsx`, `FloodOutlook.tsx`, `SurgeChart.tsx`), and FloodCast Alerts 2.0 (`operationalAlerts.ts`):

1. **Five Lossless Physical Surge Drivers** (`oceanSurgeFt + windSetupFt + riverFlowFt + rainfallRunoffFt + estuarineHarmonicFt === residualFt`):
   - **Ocean Storm Surge**: 12-hour tidal-cycle smoothed NOAA MDL Extratropical Storm Surge (`ncwrit` Wrightsville Beach).
   - **Directional N/NE Wind Setup**: Quadratic directional wind-fetch stress ($\tau = W^2 \max(0, \cos(\theta - \theta_{\text{fetch}}))$) along Myrtle Grove Sound's `25°` NNE longitudinal axis and `70°` ENE onshore shelf Ekman setup, plus inverse-barometer pressure anomaly.
   - **Cape Fear River / Snow's Cut Hydraulic Head**: Upstream Wilmington River NOAA ETSS (`ncwilm` / `8658120`) and lagged USGS Cape Fear River Lock #1 discharge (`02105769`, cfs) entering the northern Carolina Beach basin through Snow's Cut.
   - **Rainfall Runoff**: Exponentially accumulated local basin precipitation.
   - **Estuarine Tide Harmonics**: Regularized 48-hour least-squares fit of $M_2$ (`12.4206h`), $S_1$ (`24.0000h`), and shallow-water overtide $M_4$ (`6.2103h`) residuals anchored smoothly at $t = 0$ to Carolina Beach Canal Gauge `30046` (ft MLLW).
   - **AI Residual Refinement**: Google TimesFM foundation model forecasts the de-harmonized subtidal residual error ($0\text{–}48\text{h}$), preventing univariate smoothing from flattening estuarine tidal harmonics.

2. **Three Seamless Forecast Horizon Regimes (0 to 21 Days)**:
   - **Regime A (`0–102h`)**: Full NOAA Ocean + River ETSS + Directional N/NE Wind + USGS River Flow + TimesFM AI + 48h Estuarine Harmonics.
   - **Regime B (`Days 5–16`)**: Extended NWS / Open-Meteo Wind-Stress + Inverse Barometer + River Flow Decay + Estuarine Harmonics.
   - **Regime C (`Days 17–21`)**: NOAA Astronomical Tide + damped Estuarine Harmonic Baseline with monotonically widening 80% uncertainty bounds.

3. **Out-of-Sample Empirical Validation & Multi-Region Scalability (`MULTI_REGION_BASIN_SPECS`)**:
   - Across a 60-day (`1,428` aligned hours) Carolina Beach out-of-sample backtest, the unified model reduced 24-hour MAE by **43.9%** versus raw Wrightsville Beach ETSS (`0.145 ft` vs `0.258 ft`), **47.9%** during N/NE wind events (`0.157 ft` vs `0.302 ft`), and **46.4%** during elevated Cape Fear River head events (`0.155 ft` vs `0.289 ft`).
   - Parameterized `BasinPhysicsSpec` configurations extend directly across both **Tidal Inlets / Lagoons** (**Carolina Beach, NC** `~95%` fit; **Beaufort, NC** `~94%` fit; **Garden City, SC** `~95%` fit) and **Wind Sounds & River Estuaries** (**New Bern, NC** `~88%` fit via Neuse/Pamlico directional fetch + Kinston USGS `02089500`; **Wilmington, NC** `~92%` fit via `8658120` + Lock #1 `02105769`; **Charleston, SC** `~93%` fit via `8665530` + Cooper River USGS `02172002`; **Savannah, GA** `~91%` fit via `8670870` + Clyo USGS `02198500`).
   - Legacy `forecast_models` ridge refitting (`refreshResidualHistory`) and hourly Gemini explanation generation are retired.

## FloodCast Alerts 2.0 & Resident UX

Canonical Carolina Beach flood thresholds are enforced across backend alerts, charts, maps, and resident guides: **`5.6 ft Minor / 7.0 ft Moderate / 7.7 ft Major / 8.5 ft Extreme` (ft MLLW)**.

- **Public In-App Advisories (`/alerts` & `GET /api/alerts?feed=1`)**: Unauthenticated visitors and residents can inspect active/upcoming 48-hour flood windows, live 48-hour server-rendered PNG hydrographs (`GET /api/alerts?chart=1`), physical surge driver chips, recent issued bulletins, and deep-links (`/tab2?t=<iso>`) without creating an account.
- **Anti-Spam Alert State Machine (`functions/src/citizenAlerts/operationalAlerts.ts`)**: Evaluates the unified 48-hour operational forecast with a right-edge `endClipped` horizon guard, `0.15 ft` downward hysteresis (`5.45 / 6.85 / 7.55 / 8.35 ft` clear thresholds), `6-hour` same-tier cooldown with immediate tier-escalation bypass, `<= 3.5h` imminent flood warnings, transient-outage freeze (eliminating `forecast_restored` spam), and multi-tide digest consolidation.
- **Configurable Subscriber Preferences & Rich Multipart Emails**: Verified subscribers configure severity tiers (`minor`, `moderate`, `major`, `extreme`) and lifecycle categories (`upcomingWatch`, `imminentWarning`, `forecastChange`, `allClear`) via `POST /api/alerts` (`action: 'update_preferences'`). Resend delivers multipart HTML + plain-text emails containing severity badges, peak MLLW, flood window/duration, street depth inches, peak wind speed/compass & rain, physical surge drivers, `"What Changed"` delta summaries, an embedded 48-hour hydrograph PNG, one-click RFC 8058 `List-Unsubscribe` headers, and `#token=` fragment unsubscribe links.

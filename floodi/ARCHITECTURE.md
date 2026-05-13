# FloodCast Architecture Documentation

## Overview

FloodCast is a modern React-based mobile and web application that provides hyperlocal tide and flood insights using real-time data from the NOAA Tides and Currents API. The application combines observed water level data with harmonic tide predictions to generate storm surge estimates and flood warnings.

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
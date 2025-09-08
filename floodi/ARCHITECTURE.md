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

## Application Architecture

### High-Level Structure

```
floodi/
├── src/
│   ├── App.tsx                 # Root application component
│   ├── main.tsx               # Application entry point
│   ├── components/            # Shared UI components
│   ├── pages/                 # Main page components
│   ├── lib/                   # Business logic and API integrations
│   └── theme/                 # Styling and theme configuration
├── public/                    # Static assets
├── capacitor.config.ts        # Native app configuration
└── vite.config.ts            # Build system configuration
```

### Component Hierarchy

```
App
├── IonReactRouter
│   ├── IonTabs
│   │   ├── IonRouterOutlet
│   │   │   ├── Intro (first-time users)
│   │   │   ├── Tab2 (main FloodCast functionality)
│   │   │   └── Tab3 (about page)
│   │   └── IonTabBar (persistent navigation)
└── React.StrictMode wrapper
```

## Data Flow Architecture

### 1. Data Sources
- **NOAA Tides and Currents API**: Primary data source for water levels and predictions
- **LocalStorage**: User preferences and intro completion status
- **Component State**: UI state management using React hooks

### 2. Data Processing Pipeline

```
NOAA API Data → Processing Layer → UI Components → User Interface
     ↓                    ↓              ↓            ↓
Observed Data    →  Surge Analysis  →  Chart Data  →  Visual Charts
Predictions      →  Threshold Check →  Alerts      →  Flood Warnings
```

### 3. Key Data Transformations

1. **Time Series Normalization**: Convert NOAA timestamps to ISO format
2. **Surge Calculation**: Compare observed vs predicted data to estimate storm surge
3. **Threshold Detection**: Analyze future projections for flood threshold crossings
4. **Chart Formatting**: Transform time series data for visualization libraries

## Core Modules

### 1. NOAA Integration (`/src/lib/noaa.ts`)

**Purpose**: Interfaces with NOAA Tides and Currents API

**Key Functions**:
- `fetchObservedWaterLevels()`: Retrieves actual measured water levels
- `fetchPredictions()`: Gets harmonic tide predictions
- `estimateSurgeOffset()`: Calculates storm surge by comparing observed vs predicted
- `findNextThresholdCrossing()`: Predicts when flood thresholds will be exceeded
- `buildAdjustedFuture()`: Creates surge-adjusted forecasts

**Data Structures**:
- `TimeSeries`: Maps ISO datetime strings to water level values

### 2. Main Application Pages

#### Tab2 (Primary Functionality)
- **Location**: `/src/pages/Tab2.tsx` and `/src/components/Tab2/`
- **Purpose**: Main flood forecasting interface
- **Components**:
  - `StationSelector`: Choose NOAA monitoring stations
  - `ChartViewer`: Visualize water level data and predictions
  - `SettingsModal`: Configure time ranges, units, and flood thresholds
  - `FloodSettings`: Set and manage flood warning levels

#### Intro Screen
- **Location**: `/src/pages/Intro.tsx`
- **Purpose**: First-time user onboarding
- **Features**: One-time display with localStorage persistence

#### About Page (Tab3)
- **Location**: `/src/pages/Tab3.tsx`
- **Purpose**: App information and branding

### 3. Shared Components

#### ExploreContainer
- **Location**: `/src/components/ExploreContainer.tsx`
- **Purpose**: Development placeholder with Ionic documentation links

## State Management

### Local State Strategy
FloodCast uses React's built-in state management with hooks rather than external state management libraries. This approach is suitable for the app's current scope and complexity.

**State Distribution**:
- **Component-level state**: UI interactions, form inputs, loading states
- **Custom hooks**: Reusable state logic (settings, chart data, station search)
- **LocalStorage**: Persistent user preferences and app state

### Key State Management Patterns

1. **Settings Persistence**: User preferences stored in localStorage with custom hooks
2. **API Data Caching**: Temporary caching of NOAA API responses to reduce requests
3. **Chart State**: Real-time chart interactions and zoom levels
4. **Station Management**: Currently selected monitoring station and its metadata

## Security & Performance

### Security Measures
- **CORS Configuration**: Proper handling of cross-origin API requests to NOAA
- **Input Validation**: Sanitization of user inputs and API responses
- **Error Boundaries**: Graceful handling of component failures
- **External Link Security**: `rel="noopener noreferrer"` for external links

### Performance Optimizations
- **Code Splitting**: Route-based code splitting for faster initial loads
- **API Request Optimization**: Efficient batching of NOAA API calls
- **Chart Performance**: Optimized data structures for large time series
- **Build Optimization**: Vite's tree shaking and minification

## Mobile-First Design

### Responsive Approach
- **Ionic Components**: Native-style UI that adapts to platform conventions
- **Touch-First UX**: Designed for finger navigation and gestures
- **Offline Capability**: PWA features for limited connectivity scenarios

### Native Integration
- **Capacitor Plugins**: 
  - Haptic feedback for alerts
  - Status bar theming
  - Keyboard behavior optimization
  - App lifecycle management

## Development Workflow

### Build Process
1. **Development**: `npm run dev` - Vite dev server with hot reload
2. **Testing**: `npm run test.unit` - Vitest unit tests
3. **Linting**: `npm run lint` - ESLint code quality checks
4. **Building**: `npm run build` - TypeScript compilation + Vite production build
5. **Mobile Sync**: `npx cap sync` - Update native app containers

### Testing Strategy
- **Unit Tests**: Component logic and utility functions
- **E2E Tests**: Complete user workflows with Cypress
- **API Integration Tests**: NOAA API response handling
- **Mobile Testing**: Device-specific testing through Capacitor

## Deployment Architecture

### Web Deployment
- **Firebase Hosting**: Static site hosting with global CDN
- **Progressive Web App**: Installable web app with service worker
- **Domain Configuration**: Custom domain setup for production

### Mobile Deployment
- **iOS**: Native app through Capacitor + Xcode
- **Android**: Native app through Capacitor + Android Studio
- **App Store Distribution**: Standard app store publishing process

## Error Handling & Monitoring

### Error Handling Strategy
- **API Failures**: Graceful degradation when NOAA API is unavailable
- **Network Issues**: Retry logic with exponential backoff
- **Data Validation**: Comprehensive input validation and sanitization
- **User Feedback**: Clear error messages and recovery suggestions

### Monitoring & Analytics
- **Error Tracking**: Component error boundaries with logging
- **API Monitoring**: Track NOAA API response times and failures
- **User Analytics**: Firebase Analytics for usage patterns (when implemented)
- **Performance Monitoring**: Core Web Vitals and load time tracking

## Future Architecture Considerations

### Scalability
- **Data Caching**: Implement Redis or similar for API response caching
- **User Management**: Firebase Authentication for personalized experiences
- **Real-time Updates**: WebSocket integration for live data updates
- **Offline Mode**: Enhanced PWA capabilities with background sync

### Feature Expansion
- **Multiple Stations**: Support for monitoring multiple locations simultaneously
- **Historical Analysis**: Long-term trend analysis and reporting
- **Alert System**: Push notifications for flood warnings
- **Data Export**: CSV/JSON export capabilities for power users

## Design Principles

1. **Mobile-First**: Every feature designed for touch interfaces first
2. **Offline-Capable**: Graceful degradation when connectivity is limited  
3. **Performance-Focused**: Fast loading and smooth interactions prioritized
4. **Accessibility**: Follows WCAG guidelines for inclusive design
5. **Data-Driven**: All decisions based on real NOAA data and scientific methods
6. **User-Centric**: Simple interface hiding complex flood science calculations

This architecture provides a solid foundation for FloodCast's current functionality while supporting future enhancements and scaling requirements.
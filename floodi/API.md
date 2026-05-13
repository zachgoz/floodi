# NOAA API Integration Documentation

## Overview

FloodCast integrates with the NOAA Tides and Currents API to provide real-time water level data, tide predictions, and flood forecasting capabilities. This document explains the API integration, data models, and usage patterns within the application.

## NOAA Tides and Currents API

### Base Information
- **API Base URL**: `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter`
- **Protocol**: HTTPS with CORS support
- **Authentication**: None required (public API)
- **Rate Limiting**: Reasonable use expected, no documented hard limits
- **Data Format**: JSON responses

### Official Documentation
- [NOAA API Documentation](https://api.tidesandcurrents.noaa.gov/api/prod/)
- [Web Services Info](https://tidesandcurrents.noaa.gov/web_services_info.html)
- [Station Listings](https://tidesandcurrents.noaa.gov/)

## Core API Endpoints

### 1. Water Level Observations

**Endpoint**: `GET /api/prod/datagetter`

**Purpose**: Retrieve actual measured water levels from NOAA tide gauges

**Parameters**:
```
product=water_level          # Data type
station={station_id}         # NOAA station identifier
begin_date={yyyymmdd HH:MM}  # Start time (GMT)
end_date={yyyymmdd HH:MM}    # End time (GMT)
datum={datum}                # Vertical reference (MLLW, MSL, etc.)
units={english|metric}       # Measurement units
time_zone=gmt                # Time zone (always GMT for consistency)
format=json                  # Response format
interval={minutes}           # Data sampling interval (typically 6)
application=canal-dr-flood   # Application identifier
```

**Example Request**:
```
https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?
product=water_level&
station=8518750&
begin_date=20240115%2012:00&
end_date=20240115%2018:00&
datum=MLLW&
units=english&
time_zone=gmt&
format=json&
interval=6&
application=canal-dr-flood
```

**Response Structure**:
```json
{
  "metadata": {
    "id": "8518750",
    "name": "New London, CT",
    "lat": "41.3583",
    "lon": "-72.0908"
  },
  "data": [
    {
      "t": "2024-01-15 12:00",  // Time (YYYY-MM-DD HH:MM)
      "v": "2.456",            // Water level value
      "s": "0.003",            // Standard deviation (if available)
      "f": "1,0,0,0",          // Quality flags
      "q": "v"                 // Quality assurance
    }
  ]
}
```

### 2. Harmonic Predictions

**Endpoint**: `GET /api/prod/datagetter`

**Purpose**: Retrieve tide predictions based on harmonic analysis

**Parameters**:
```
product=predictions          # Data type
station={station_id}        # NOAA station identifier
begin_date={yyyymmdd HH:MM}  # Start time (GMT)
end_date={yyyymmdd HH:MM}    # End time (GMT)
datum={datum}                # Vertical reference
units={english|metric}      # Measurement units
time_zone=gmt               # Time zone
format=json                 # Response format
interval={minutes}          # Prediction interval
application=canal-dr-flood  # Application identifier
```

**Response Structure**:
```json
{
  "predictions": [
    {
      "t": "2024-01-15 12:00",  // Time
      "v": "2.123"             // Predicted water level
    }
  ]
}
```

## Data Models and Types

### TimeSeries Type
```typescript
type TimeSeries = Record<string, number>;
// Maps ISO datetime strings to water level values
// Example: { "2024-01-15T12:00Z": 2.45, "2024-01-15T12:06Z": 2.52 }
```

### Station Information
```typescript
interface StationMetadata {
  id: string;        // NOAA station ID (e.g., "8518750")
  name: string;      // Station name (e.g., "New London, CT")
  lat: string;       // Latitude
  lon: string;       // Longitude
  state?: string;    // State abbreviation
  timezone?: string; // Local timezone
}
```

### API Response Types
```typescript
interface ObservationResponse {
  metadata: StationMetadata;
  data: Array<{
    t: string;       // Timestamp "YYYY-MM-DD HH:MM"
    v: string;       // Value as string
    s?: string;      // Standard deviation
    f?: string;      // Quality flags
    q?: string;      // Quality assurance
  }>;
}

interface PredictionResponse {
  predictions: Array<{
    t: string;       // Timestamp "YYYY-MM-DD HH:MM"
    v: string;       // Predicted value as string
  }>;
}
```

## FloodCast API Integration Layer

### Core Integration Functions

#### 1. fetchObservedWaterLevels()
```typescript
async function fetchObservedWaterLevels(opts: {
  station: string;
  start: Date;
  end: Date;
  interval?: number;
  datum?: string;
  units?: 'english' | 'metric';
}): Promise<TimeSeries>
```

**Purpose**: Fetches actual water level measurements
**Returns**: Normalized TimeSeries object with ISO timestamps
**Error Handling**: Throws descriptive errors for API failures

#### 2. fetchPredictions()
```typescript
async function fetchPredictions(opts: {
  station: string;
  start: Date;
  end: Date;
  interval?: number;
  datum?: string;
  units?: 'english' | 'metric';
}): Promise<TimeSeries>
```

**Purpose**: Fetches harmonic tide predictions
**Returns**: Normalized TimeSeries object
**Use Case**: Baseline for storm surge calculations

#### 3. estimateSurgeOffset()
```typescript
function estimateSurgeOffset(
  observed: TimeSeries, 
  predicted: TimeSeries
): { offset: number; n: number }
```

**Purpose**: Calculates storm surge by comparing observations vs predictions
**Algorithm**: Uses median difference to avoid outlier effects
**Returns**: Surge offset and number of data points used

#### 4. findNextThresholdCrossing()
```typescript
function findNextThresholdCrossing(
  series: TimeSeries, 
  threshold: number, 
  now: Date
): { tCross: Date; leadMinutes: number } | null
```

**Purpose**: Predicts when water levels will exceed flood thresholds
**Algorithm**: Linear interpolation between data points for accuracy
**Returns**: Crossing time and lead time in minutes

#### 5. buildAdjustedFuture()
```typescript
async function buildAdjustedFuture(opts: {
  station: string;
  now: Date;
  lookbackHours: number;
  lookaheadHours: number;
  interval?: number;
  datum?: string;
  units?: 'english' | 'metric';
}): Promise<{ adjusted: TimeSeries; offset: number; n: number }>
```

**Purpose**: Main forecasting function combining all components
**Process**: 
1. Fetch recent observations and predictions
2. Calculate current surge offset
3. Apply surge to future predictions
**Returns**: Surge-adjusted forecast with metadata

## Data Processing Pipeline

### 1. Data Normalization
```
NOAA Timestamp: "2024-01-15 12:30"
↓
FloodCast Format: "2024-01-15T12:30Z"
```

### 2. Value Processing
- Convert string values to numbers using `parseFloat()`
- Filter out invalid values (`!isFinite(value)`)
- Handle missing data gracefully

### 3. Surge Analysis
```
Storm Surge = Observed Water Level - Predicted Water Level
```

**Mathematical Approach**:
- Use median instead of mean to reduce outlier impact
- Require minimum number of data points for reliability
- Apply calculated offset to future predictions

## Error Handling

### API Error Types

#### 1. HTTP Errors
```typescript
// HTTP status errors (4xx, 5xx)
throw new Error(`NOAA request failed: ${res.status}`);
```

#### 2. NOAA API Errors
```typescript
// API-specific errors in response body
throw new Error(`NOAA API error: ${data.error?.message || 'unknown'}`);
```

#### 3. Data Validation Errors
- Invalid station IDs
- Date range restrictions
- Missing or corrupted data

### Error Recovery Strategies

1. **Retry Logic**: Exponential backoff for temporary failures
2. **Graceful Degradation**: Show cached data when API is unavailable
3. **User Feedback**: Clear error messages with suggested actions
4. **Fallback Data**: Use last known good data when appropriate
## Firebase Backend Services

FloodCast uses Firebase for authentication, data synchronization, and as a proxy layer for external services.

### 1. FiMAN Proxy (Firebase Functions)

**Endpoint**: `GET /fimanProxy`

**Purpose**: Bypasses CORS restrictions for the FiMAN API and provides a centralized caching layer.

**Query Parameters**:
- `stationID`: FiMAN station identifier (e.g., `8518750`)
- `action`: Data action (e.g., `getlatest`, `getdata`)
- `format`: Response format (defaults to `json`)
- *Additional parameters are forwarded to the upstream FiMAN API.*

**Upstream URL**: `https://data.sunnydayflooding.com/services/data.php`

**Caching**: 
- CDN level: 5 minutes (`s-maxage=300`)
- Browser level: 1 minute (`max-age=60`)

### 2. Firestore Data Models

Firestore stores synchronized data from NOAA and FiMAN, optimized for rapid retrieval and historical analysis.

#### `stations` Collection
Stores metadata for monitoring stations.
- `id` (string): NOAA/FiMAN station ID.
- `name` (string): Display name.
- `lat` (number): Latitude.
- `lng` (number): Longitude.
- `source` (string): `noaa` or `fiman`.
- `isActive` (boolean): Whether the station is currently monitored.

#### `observations` Collection
Sub-collection under each station document or a root collection partitioned by station.
- `t` (timestamp): Time of measurement.
- `v` (number): Water level value.
- `type` (string): `observed` or `predicted`.

#### `peaks` Collection
Identified historical high-water events.
- `stationId` (string): Reference to station.
- `t` (timestamp): Time of peak.
- `v` (number): Maximum water level.
- `threshold` (string): Which flood category was triggered (Minor, Moderate, Major).

### 3. Scheduled Functions (ETL)

- **`syncWaterLevels`**: Runs every 15 minutes to fetch the latest observations from NOAA and FiMAN.
- **`syncPredictions`**: Runs daily to refresh tide predictions for the next 30 days.
- **`runBackfillData`**: Manual or periodic function to ingest historical data for new stations.

## Common Usage Patterns

### 1. Hybrid Data Fetching (`dataService.ts`)

The application fetches data using a hybrid approach:
1.  **Direct NOAA Fetch**: For standard tidal predictions.
2.  **Firebase Proxy**: For hyperlocal FiMAN data.
3.  **Firestore Query**: For historical peaks and comparison.

```typescript
// Example of fetching unified data
const data = await dataService.fetchWaterLevels({
  stationId: '8518750',
  range: '48h'
});
```

## Performance and Reliability

- **Request Batching**: The backend ETL process batches Firestore writes to reduce latency.
- **CDN Caching**: API responses from Firebase Functions are cached globally.
- **Graceful Failover**: If FiMAN is unavailable, the system automatically falls back to the nearest NOAA station.

This API structure ensures that FloodCast remains fast and reliable even during severe weather events when external sensors might experience intermittent connectivity.
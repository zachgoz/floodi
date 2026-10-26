# FloodCast APIs and Integrations

## Application services

| Endpoint/service | Contract |
| --- | --- |
| `GET /api/outlook` | Read the shared, schema-validated numerical outlook. A dashboard read never trains a model or invokes Gemini. Unavailable/expired results return 503. |
| `POST /api/client-errors` | Strict allowlisted JSON diagnostics from production web/native builds. Returns 204 on acceptance; rejects invalid origin, content type, oversized/private fields and exhausted quotas. No general console or arbitrary error-message upload. See [frontend diagnostics](docs/FRONTEND-ERROR-COLLECTION.md). |
| `GET /api/fiman/**` | Existing bounded upstream proxy with cached public provider data. |
| `runBackfillData?days=1..60` | Private administrative POST to the function URL, requiring an authorized Google identity. Structured 200/207/503 recovery summary; never a browser endpoint. |
| `checkDataHealth` | Scheduled independent freshness inspection; no public HTTP endpoint. Private operational status and structured Cloud Logging events support alerts. |

Observations use bounded daily UTC documents and compatible legacy monthly reads. See [storage and migration](docs/DAILY-OBSERVATION-STORAGE.md) and [the reliability release verification](docs/RELIABILITY-IMPLEMENTATION-2026-10-14.md). Existing NOAA integration details follow.

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

## Cached flood outlook

See [forecast implementation](docs/FLOOD_FORECASTING.md) and [measured validation](docs/SURGE_ANALYSIS.md). `GET /api/outlook` serves cached `locations/carolina-beach/outlook/current`, returning503 for absent, expired or invalid data. Reads cannot trigger training or Gemini.

Large successful responses negotiate gzip and vary on `Accept-Encoding`. The schema and full numerical publication archives are preserved. Error responses use `no-store`.

Available results identify gauge30046, feet MLLW, `method` (`weather-response` or `residual-response`), `confidence: limited`, `validationStage: historical-hindcast`, separate observation/origin/generation times and per-lead errors. The approved near-term prefix covers up to24h with weather or6h with measured changes. Optional `tail` metadata covers the loaded NOAA endpoint: `method: historical-pattern`, exact junction/end timestamps, `weatherSupportedUntil`, a public tide-pattern summary, and chronological historical/weather validation. A separate historical skill flag records the failed14-day comparison; the historical fallback is explicitly a baseline. Raw weather weights remain private. Cached tail payloads are bounded at5,000points and32days; scheduled retrieval requests21future tide days and16weather calendar days. The client can append the same baseline to subsequently loaded tides using the shared projector without a fixed day cutoff. The older72h `extension` and legacy experimental documents remain readable for compatibility. Unknown metrics remain null.

The client validates schema, reference, freshness, historical gates, continuity and numerical reconstruction. It preserves physical totals and re-expresses only residuals against the chart tide at the same UTC. User threshold changes recompute hazards without changing forecast water levels. One selected forecast drives charts, events, future readouts and simulation. Historical upper bounds support a distinct possible-flood indicator, while threshold colors identify central forecast exceedances without background shading. Development can read a validated unexpired local artifact; production requires deployed scheduled jobs and runtime access.


## Citizen email pilot

`GET /api/alerts` returns public delivery readiness for guests and private subscription/history for an authenticated account. `POST /api/alerts` accepts `enroll`, `resume`, `pause`, `unsubscribe`, or `test`; enrollment/resume require `consentVersion: citizen-email-v1`. Use a Firebase ID token in `Authorization: Bearer ...`. The server checks revocation and current Admin Auth email/verification; browser profile fields never establish eligibility. Responses are private and `no-store`.

An email link's opaque unsubscribe capability is an alternative only for `POST { action: "unsubscribe", token }`. Opening the page or a GET never mutates consent. Tokens travel in fragments, are stripped before analytics, and are submitted only in the POST body with no referrer. Responses deliberately do not expose whether an account/token exists.

Delivery is disabled unless every server-side Resend setting is valid and the explicit operator switch is on. Early access is persisted while sending is off; billing is not implemented. An active subscription requires verified email and explicit enrollment. Test requests are limited to one per account per hour. History reports provider acceptance separately from actual inbox receipt. See [operator setup and operational limits](docs/CITIZEN-ALERTS-SETUP.md).

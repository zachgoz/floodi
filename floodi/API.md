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

## Common Usage Patterns

### 1. Real-time Monitoring
```typescript
// Get current conditions with 6-hour lookback
const forecast = await buildAdjustedFuture({
  station: '8518750',
  now: new Date(),
  lookbackHours: 6,
  lookaheadHours: 24
});

// Check for flood warnings
const crossing = findNextThresholdCrossing(
  forecast.adjusted, 
  4.5, // Flood threshold in feet
  new Date()
);
```

### 2. Historical Analysis
```typescript
// Compare storm impact over time
const start = new Date('2024-01-15T00:00Z');
const end = new Date('2024-01-16T00:00Z');

const [observed, predicted] = await Promise.all([
  fetchObservedWaterLevels({ station, start, end }),
  fetchPredictions({ station, start, end })
]);

const { offset } = estimateSurgeOffset(observed, predicted);
console.log(`Storm surge: ${offset.toFixed(2)} feet`);
```

## Station Selection

### Popular Monitoring Stations
- **8518750**: New London, CT
- **8461490**: New London Ledge Light, CT
- **8510560**: Montauk, NY
- **8531680**: Sandy Hook, NJ

### Station Selection Criteria
1. **Data Availability**: 6-minute interval water level data
2. **Geographic Coverage**: Strategic coastal locations
3. **Data Quality**: High-quality, well-maintained stations
4. **Relevance**: Proximity to flood-prone areas

## Performance Considerations

### 1. API Request Optimization
- Batch requests when possible
- Use appropriate time intervals (6 minutes is standard)
- Limit date ranges to necessary periods

### 2. Caching Strategy
- Cache API responses temporarily to reduce redundant requests
- Implement smart cache invalidation based on data age
- Consider offline storage for critical data

### 3. Rate Limiting
- Implement respectful request spacing
- Monitor API response times
- Implement exponential backoff for failures

## Data Quality and Limitations

### 1. Data Quality Flags
NOAA provides quality flags for each measurement:
- **f**: Quality flags (1,0,0,0 format)
- **q**: Quality assurance level
- **s**: Standard deviation when available

### 2. Known Limitations
- **Prediction Accuracy**: Harmonic predictions don't include weather effects
- **Real-time Delays**: Observed data may have 15-30 minute delays
- **Station Maintenance**: Periodic outages for equipment maintenance
- **Extreme Events**: Model accuracy decreases during severe weather

### 3. Data Validation
Always validate API responses:
```typescript
// Check for valid numeric values
if (!isFinite(v) || !t) continue;

// Verify reasonable value ranges
if (v < -10 || v > 20) {
  console.warn(`Unusual water level: ${v} feet`);
}
```

## Future Enhancements

### 1. Additional Data Products
- **Meteorological Data**: Wind speed, barometric pressure
- **Currents Data**: Water current speed and direction  
- **Air Gap Data**: Bridge clearance information
- **Datum Conversions**: Convert between different vertical references

### 2. Advanced Analysis
- **Frequency Analysis**: Return period calculations for extreme events
- **Trend Analysis**: Long-term sea level rise detection
- **Seasonal Adjustments**: Account for seasonal variations
- **Multi-station Analysis**: Regional flood risk assessment

### 3. Performance Improvements
- **WebSocket Integration**: Real-time data streaming
- **GraphQL Layer**: More efficient data fetching
- **Edge Caching**: CDN-based response caching
- **Background Sync**: PWA background data updates

This API integration provides FloodCast with reliable, real-time flood forecasting capabilities while maintaining high performance and user experience standards.
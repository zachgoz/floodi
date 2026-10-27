import { GoogleAuth } from 'google-auth-library';

export interface TimesFmPredictionRequest {
  /** Target series history: e.g. 168 half-hour residual points (84 hours) */
  targetHistory: number[];
  /** Corresponding UTC ISO timestamps for targetHistory (recommended for BigQuery AI.FORECAST) */
  timestamps?: string[];
  /** Forecast horizon: number of steps to predict (e.g. 48 for 24h, 144 for 72h) */
  horizon: number;
  /** Known future astronomical tide predictions (same length as horizon) */
  futureTide?: number[];
  /** NOAA ETSS / ESTOFS official meteorological storm surge predictions (same length as horizon) */
  futureNoaaSurge?: number[];
  /** Known future weather covariates (wind, pressure, rain) */
  futureWeather?: {
    windSpeed?: number[];
    windDirection?: number[];
    pressure?: number[];
    precipitation?: number[];
  };
  /** Quantile levels to estimate uncertainty (e.g. [0.1, 0.5, 0.9]) */
  quantiles?: number[];
}

export interface TimesFmPredictionResult {
  mean: number[];
  q10?: number[];
  q50?: number[];
  q90?: number[];
  engine: 'vertex-ai-timesfm' | 'bigquery-ai-forecast' | 'noaa-etss-hybrid';
}

/**
 * TimesFM Client
 * Connects Floodi Cloud Functions to Google Vertex AI Model Garden TimesFM Endpoint
 * or Google BigQuery serverless AI.FORECAST foundation engine.
 */
export class TimesFmVertexClient {
  private projectId: string;
  private location: string;
  private endpointId: string;
  private auth: GoogleAuth;

  constructor(options: { projectId?: string; location?: string; endpointId?: string; auth?: GoogleAuth } = {}) {
    this.projectId = options.projectId || process.env.VERTEX_AI_PROJECT || 'project-3d38501c-9460-4059-821';
    this.location = options.location || 'us-central1';
    this.endpointId = options.endpointId || process.env.TIMESFM_ENDPOINT_ID || 'timesfm-endpoint';
    this.auth = options.auth || new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/bigquery'],
    });
  }

  /**
   * Invokes TimesFM via Vertex AI Model Garden endpoint or BigQuery AI.FORECAST.
   */
  async forecast(request: TimesFmPredictionRequest): Promise<TimesFmPredictionResult> {
    const useVertex = process.env.USE_VERTEX_TIMESFM === 'true' && this.endpointId !== 'timesfm-endpoint';
    if (useVertex) {
      return this.forecastVertex(request);
    }
    return this.forecastBigQuery(request);
  }

  /**
   * Invokes TimesFM deployed on Vertex AI Model Garden.
   */
  async forecastVertex(request: TimesFmPredictionRequest): Promise<TimesFmPredictionResult> {
    const client = await this.auth.getClient();
    const endpointUrl = `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.location}/endpoints/${this.endpointId}:predict`;

    const payload = {
      instances: [
        {
          input: request.targetHistory,
          horizon: request.horizon,
          covariates: {
            tide: request.futureTide,
            noaa_surge: request.futureNoaaSurge,
            wind_speed: request.futureWeather?.windSpeed,
            pressure: request.futureWeather?.pressure,
          },
        },
      ],
      parameters: {
        quantiles: request.quantiles || [0.1, 0.5, 0.9],
      },
    };

    const response = await client.request<{
      predictions: Array<{
        mean: number[];
        quantiles?: { [key: string]: number[] };
      }>;
    }>({
      url: endpointUrl,
      method: 'POST',
      data: payload,
      timeout: 15_000,
    });

    const pred = response.data.predictions[0];
    return {
      mean: pred.mean,
      q10: pred.quantiles?.['0.1'],
      q50: pred.quantiles?.['0.5'] || pred.mean,
      q90: pred.quantiles?.['0.9'],
      engine: 'vertex-ai-timesfm',
    };
  }

  /**
   * Invokes BigQuery serverless AI.FORECAST foundation model.
   */
  async forecastBigQuery(request: TimesFmPredictionRequest): Promise<TimesFmPredictionResult> {
    const client = await this.auth.getClient();
    const structs = request.targetHistory
      .map((val, idx) => {
        let tStr = request.timestamps?.[idx];
        if (!tStr) {
          const pastMs = Date.now() - (request.targetHistory.length - idx) * 30 * 60_000;
          tStr = new Date(pastMs).toISOString();
        }
        return `STRUCT(TIMESTAMP('${tStr}') AS t, ${val.toFixed(3)} AS val)`;
      })
      .join(',\n');

    const query = `
      SELECT
        forecast_timestamp,
        forecast_value,
        prediction_interval_lower_bound,
        prediction_interval_upper_bound
      FROM AI.FORECAST(
        (
          SELECT t, val
          FROM UNNEST([
            ${structs}
          ])
        ),
        data_col => 'val',
        timestamp_col => 't',
        horizon => ${request.horizon}
      )
      ORDER BY forecast_timestamp ASC
    `;

    const response = await client.request<{
      rows?: Array<{
        f: Array<{ v: string }>;
      }>;
    }>({
      url: `https://bigquery.googleapis.com/bigquery/v2/projects/${this.projectId}/queries`,
      method: 'POST',
      data: {
        query,
        useLegacySql: false,
      },
      timeout: 25_000,
    });

    if (!response.data.rows || !response.data.rows.length) {
      throw new Error('BigQuery AI.FORECAST returned zero prediction rows');
    }

    const mean: number[] = [];
    const q10: number[] = [];
    const q90: number[] = [];

    for (const row of response.data.rows) {
      const forecastVal = parseFloat(row.f[1].v);
      const lower = parseFloat(row.f[2].v);
      const upper = parseFloat(row.f[3].v);
      mean.push(forecastVal);
      q10.push(lower);
      q90.push(upper);
    }

    return {
      mean,
      q10,
      q50: mean,
      q90,
      engine: 'bigquery-ai-forecast',
    };
  }
}

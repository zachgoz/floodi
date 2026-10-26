import { GoogleAuth } from 'google-auth-library';

export interface TimesFmPredictionRequest {
  /** Target series history: e.g. 168 half-hour residual points (84 hours) */
  targetHistory: number[];
  /** Forecast horizon: number of steps to predict (e.g. 48 for 24h, 144 for 72h) */
  horizon: number;
  /** Known future astronomical tide predictions (same length as horizon) */
  futureTide?: number[];
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
}

/**
 * TimesFM Vertex AI Client
 * Connects Floodi Cloud Functions to Google Vertex AI Model Garden TimesFM Endpoint.
 */
export class TimesFmVertexClient {
  private projectId: string;
  private location: string;
  private endpointId: string;
  private auth: GoogleAuth;

  constructor(options: { projectId?: string; location?: string; endpointId?: string } = {}) {
    this.projectId = options.projectId || process.env.VERTEX_AI_PROJECT || 'project-3d38501c-9460-4059-821';
    this.location = options.location || 'us-central1';
    this.endpointId = options.endpointId || process.env.TIMESFM_ENDPOINT_ID || 'timesfm-endpoint';
    this.auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  }

  /**
   * Invokes TimesFM on Vertex AI for zero-shot time-series forecasting.
   */
  async forecast(request: TimesFmPredictionRequest): Promise<TimesFmPredictionResult> {
    const client = await this.auth.getClient();
    const endpointUrl = `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.location}/endpoints/${this.endpointId}:predict`;

    // Format payload adhering to Vertex AI Model Garden TimesFM serving schema
    const payload = {
      instances: [
        {
          input: request.targetHistory,
          horizon: request.horizon,
          covariates: {
            tide: request.futureTide,
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
    };
  }
}

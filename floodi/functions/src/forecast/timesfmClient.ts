import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { AuthClient, GoogleAuth, Impersonated } from 'google-auth-library';

interface BigQueryForecastPage {
  rows?: Array<{ f: Array<{ v: string }> }>;
  jobComplete?: boolean;
  jobReference?: { projectId?: string; jobId?: string; location?: string };
  location?: string;
  pageToken?: string;
}

const BIGQUERY_DEADLINE_MS = 90_000;
const BIGQUERY_MAX_RESULT_REQUESTS = 8;

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

function findServiceAccountKey(): string | undefined {
  const envPath = process.env.SERVICE_ACCOUNT_KEY_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const candidates = [
    path.resolve(process.cwd(), '../service-account.json'),
    path.resolve(process.cwd(), 'service-account.json'),
    path.resolve(__dirname, '../../../../service-account.json'),
    path.resolve(__dirname, '../../../service-account.json'),
    path.resolve(__dirname, '../../service-account.json'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return undefined;
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
  private bigQueryProjectId?: string;
  private bigQueryLocation: string;
  private targetPrincipal?: string;
  private authenticatedClient?: Promise<AuthClient>;

  constructor(options: { projectId?: string; location?: string; endpointId?: string; auth?: GoogleAuth } = {}) {
    this.projectId = options.projectId || process.env.VERTEX_AI_PROJECT || 'project-3d38501c-9460-4059-821';
    this.location = options.location || 'us-central1';
    this.endpointId = options.endpointId || process.env.TIMESFM_ENDPOINT_ID || 'timesfm-endpoint';
    // Select BigQuery independently when configured, retaining the existing
    // Vertex project as a backwards-compatible default for this client.
    this.bigQueryProjectId = options.projectId || process.env.TIMESFM_BIGQUERY_PROJECT?.trim() ||
      process.env.VERTEX_AI_PROJECT?.trim();
    this.bigQueryLocation = options.location || process.env.TIMESFM_BIGQUERY_LOCATION?.trim() || 'us-central1';
    this.targetPrincipal = process.env.TIMESFM_SERVICE_ACCOUNT_EMAIL?.trim() || undefined;
    if (this.targetPrincipal && !/^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,61}[a-z0-9]\.iam\.gserviceaccount\.com$/.test(this.targetPrincipal)) {
      throw new Error('TIMESFM_SERVICE_ACCOUNT_EMAIL must name an existing service-account principal');
    }
    const saKey = findServiceAccountKey();
    this.auth = options.auth || new GoogleAuth({
      ...(saKey ? { keyFilename: saKey } : {}),
      scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/bigquery'],
    });
  }

  private async getAuthenticatedClient(): Promise<AuthClient> {
    if (!this.authenticatedClient) {
      this.authenticatedClient = (async () => {
        const sourceClient = await this.auth.getClient();
        if (!this.targetPrincipal) return sourceClient;
        // Local key-based development already authenticates as the selected
        // account. Avoid unsupported self-impersonation in that case.
        const credentials = await this.auth.getCredentials();
        if (credentials.client_email === this.targetPrincipal) return sourceClient;
        // Production retains its Firestore runtime identity. Only TimesFM's
        // Google API calls use short-lived credentials for the selected account.
        return new Impersonated({
          sourceClient,
          targetPrincipal: this.targetPrincipal,
          targetScopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/bigquery'],
          lifetime: 3600,
        });
      })().catch(error => {
        this.authenticatedClient = undefined;
        throw error;
      });
    }
    return this.authenticatedClient;
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
    const client = await this.getAuthenticatedClient();
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
    const client = await this.getAuthenticatedClient();
    const projectId = this.bigQueryProjectId || await this.auth.getProjectId();
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

    const deadline = Date.now() + BIGQUERY_DEADLINE_MS;
    const response = await client.request<BigQueryForecastPage>({
      url: `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`,
      method: 'POST',
      data: {
        query,
        useLegacySql: false,
        location: this.bigQueryLocation,
        timeoutMs: 10_000,
        jobTimeoutMs: String(BIGQUERY_DEADLINE_MS),
        // Limits query bytes billed, independently of any ML prediction charges.
        maximumBytesBilled: '10485760',
        requestId: randomUUID(),
        maxResults: 1000,
      },
      timeout: 15_000,
    });

    let page = response.data;
    let jobReference = page.jobReference;
    const rows: NonNullable<BigQueryForecastPage['rows']> = [];
    let resultRequests = 0;
    while (true) {
      if (page.jobComplete !== false) {
        rows.push(...(page.rows || []));
        if (!page.pageToken) break;
      }
      jobReference = page.jobReference || jobReference;
      if (!jobReference?.jobId || (jobReference.projectId && jobReference.projectId !== projectId)) {
        throw new Error('BigQuery AI.FORECAST returned incomplete results without a valid job reference');
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0 || resultRequests >= BIGQUERY_MAX_RESULT_REQUESTS) {
        throw new Error('BigQuery AI.FORECAST did not complete within its result retrieval budget');
      }
      resultRequests += 1;
      const result = await client.request<BigQueryForecastPage>({
        url: `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries/${encodeURIComponent(jobReference.jobId)}`,
        method: 'GET',
        params: {
          location: jobReference.location || page.location || this.bigQueryLocation,
          timeoutMs: Math.min(10_000, remainingMs),
          maxResults: 1000,
          ...(page.jobComplete !== false && page.pageToken ? { pageToken: page.pageToken } : {}),
        },
        timeout: Math.min(15_000, remainingMs),
      });
      page = result.data;
    }

    if (!rows.length) {
      throw new Error('BigQuery AI.FORECAST returned zero prediction rows');
    }

    const mean: number[] = [];
    const q10: number[] = [];
    const q90: number[] = [];

    for (const row of rows) {
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

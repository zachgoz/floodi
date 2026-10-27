const { test, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { GoogleAuth } = require('google-auth-library');
const { TimesFmVertexClient } = require('../lib/forecast/timesfmClient');

afterEach(() => {
  mock.restoreAll();
  delete process.env.USE_VERTEX_TIMESFM;
});

test('TimesFmVertexClient formats Vertex AI request payload and parses predictions correctly', async () => {
  process.env.USE_VERTEX_TIMESFM = 'true';
  const requests = [];
  mock.method(GoogleAuth.prototype, 'getClient', async () => ({
    request: async req => {
      requests.push(req);
      return {
        data: {
          predictions: [
            {
              mean: [0.12, 0.15, 0.18],
              quantiles: {
                '0.1': [0.05, 0.08, 0.10],
                '0.5': [0.12, 0.15, 0.18],
                '0.9': [0.20, 0.24, 0.28],
              },
            },
          ],
        },
      };
    },
  }));

  const client = new TimesFmVertexClient({
    projectId: 'test-project',
    location: 'us-central1',
    endpointId: 'ep-12345',
  });

  const res = await client.forecast({
    targetHistory: [0.1, 0.2, 0.15, 0.12],
    horizon: 3,
    futureTide: [3.4, 3.8, 4.2],
    futureNoaaSurge: [0.5, 0.6, 0.7],
    futureWeather: {
      windSpeed: [15, 18, 20],
      pressure: [1014, 1013, 1012],
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    'https://us-central1-aiplatform.googleapis.com/v1/projects/test-project/locations/us-central1/endpoints/ep-12345:predict'
  );
  assert.deepEqual(requests[0].data.instances[0].input, [0.1, 0.2, 0.15, 0.12]);
  assert.equal(requests[0].data.instances[0].horizon, 3);
  assert.deepEqual(requests[0].data.instances[0].covariates.tide, [3.4, 3.8, 4.2]);
  assert.deepEqual(requests[0].data.instances[0].covariates.noaa_surge, [0.5, 0.6, 0.7]);
  assert.deepEqual(res.mean, [0.12, 0.15, 0.18]);
  assert.deepEqual(res.q10, [0.05, 0.08, 0.10]);
  assert.deepEqual(res.q90, [0.20, 0.24, 0.28]);
  assert.equal(res.engine, 'vertex-ai-timesfm');
});

test('TimesFmVertexClient executes BigQuery AI.FORECAST and parses rows correctly', async () => {
  const requests = [];
  mock.method(GoogleAuth.prototype, 'getClient', async () => ({
    request: async req => {
      requests.push(req);
      return {
        data: {
          rows: [
            { f: [{ v: '1792974600' }, { v: '1.25' }, { v: '1.05' }, { v: '1.45' }] },
            { f: [{ v: '1792976400' }, { v: '1.30' }, { v: '1.10' }, { v: '1.50' }] },
          ],
        },
      };
    },
  }));

  const client = new TimesFmVertexClient({
    projectId: 'test-project',
  });

  const res = await client.forecast({
    targetHistory: [1.1, 1.2, 1.15],
    timestamps: [
      '2026-10-25T10:00:00.000Z',
      '2026-10-25T10:30:00.000Z',
      '2026-10-25T11:00:00.000Z',
    ],
    horizon: 2,
  });

  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    'https://bigquery.googleapis.com/bigquery/v2/projects/test-project/queries'
  );
  assert.equal(requests[0].data.query.includes('AI.FORECAST'), true);
  assert.equal(requests[0].data.query.includes('horizon => 2'), true);
  assert.deepEqual(res.mean, [1.25, 1.30]);
  assert.deepEqual(res.q10, [1.05, 1.10]);
  assert.deepEqual(res.q90, [1.45, 1.50]);
  assert.equal(res.engine, 'bigquery-ai-forecast');
});

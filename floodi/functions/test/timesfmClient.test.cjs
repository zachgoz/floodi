const { test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { GoogleAuth, Impersonated } = require('google-auth-library');
const { TimesFmVertexClient } = require('../lib/forecast/timesfmClient');

const envKeys = ['USE_VERTEX_TIMESFM', 'VERTEX_AI_PROJECT', 'TIMESFM_BIGQUERY_PROJECT',
  'TIMESFM_BIGQUERY_LOCATION', 'TIMESFM_SERVICE_ACCOUNT_EMAIL', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT'];
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));

beforeEach(() => {
  for (const key of envKeys) delete process.env[key];
});

afterEach(() => {
  mock.restoreAll();
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

const requestFixture = {
  targetHistory: [1.1, 1.2, 1.15],
  timestamps: ['2026-10-25T10:00:00.000Z', '2026-10-25T10:30:00.000Z', '2026-10-25T11:00:00.000Z'],
  horizon: 2,
};
const predictionRow = value => ({ f: [{ v: '1792974600' }, { v: String(value) }, { v: '1.05' }, { v: '1.45' }] });
function fakeAuth(responder, requests, projectId = 'adc-runtime-project', sourceEmail = 'runtime@runtime-project.iam.gserviceaccount.com') {
  return {
    getProjectId: async () => projectId,
    getCredentials: async () => ({ client_email: sourceEmail }),
    getClient: async () => ({ universeDomain: 'googleapis.com', request: async req => {
      requests.push(req);
      return { data: await responder(req, requests.length) };
    } }),
  };
}

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
  assert.equal(requests[0].data.location, 'us-central1');
  assert.equal(requests[0].data.timeoutMs, 10000);
  assert.equal(requests[0].data.jobTimeoutMs, '90000');
  assert.equal(requests[0].data.maximumBytesBilled, '10485760');
  assert.match(requests[0].data.requestId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(res.mean, [1.25, 1.30]);
  assert.deepEqual(res.q10, [1.05, 1.10]);
  assert.deepEqual(res.q90, [1.45, 1.50]);
  assert.equal(res.engine, 'bigquery-ai-forecast');
});

test('BigQuery can be configured independently of the shared Vertex project', async () => {
  process.env.VERTEX_AI_PROJECT = 'existing-gemini-project';
  process.env.GCLOUD_PROJECT = 'floodcast-runtime-project';
  process.env.TIMESFM_BIGQUERY_PROJECT = 'floodcast-runtime-project';
  const requests = [];
  const client = new TimesFmVertexClient({ auth: fakeAuth(() => ({ rows: [predictionRow(1.25)] }), requests) });
  await client.forecast(requestFixture);
  assert.equal(requests[0].url, 'https://bigquery.googleapis.com/bigquery/v2/projects/floodcast-runtime-project/queries');
  assert.equal(process.env.VERTEX_AI_PROJECT, 'existing-gemini-project');
});

test('BigQuery honors its explicit environment override and leaves Vertex invocation on its own project', async () => {
  process.env.VERTEX_AI_PROJECT = 'existing-gemini-project';
  process.env.GCLOUD_PROJECT = 'floodcast-runtime-project';
  process.env.TIMESFM_BIGQUERY_PROJECT = ' dedicated-query-project ';
  process.env.TIMESFM_BIGQUERY_LOCATION = 'us-east4';
  const requests = [];
  const client = new TimesFmVertexClient({ endpointId: 'existing-endpoint', auth: fakeAuth(req => req.url.includes('aiplatform')
    ? { predictions: [{ mean: [1.25], quantiles: { '0.1': [1.05], '0.9': [1.45] } }] }
    : { rows: [predictionRow(1.25)] }, requests) });
  await client.forecast(requestFixture);
  process.env.USE_VERTEX_TIMESFM = 'true';
  await client.forecast(requestFixture);
  assert.equal(requests[0].url, 'https://bigquery.googleapis.com/bigquery/v2/projects/dedicated-query-project/queries');
  assert.equal(requests[0].data.location, 'us-east4');
  assert.equal(requests[1].url, 'https://us-central1-aiplatform.googleapis.com/v1/projects/existing-gemini-project/locations/us-central1/endpoints/existing-endpoint:predict');
});

test('constructor project and location retain precedence over environment settings', async () => {
  process.env.TIMESFM_BIGQUERY_PROJECT = 'environment-project';
  process.env.TIMESFM_BIGQUERY_LOCATION = 'us-east4';
  const requests = [];
  await new TimesFmVertexClient({ projectId: 'caller-project', location: 'us-central1',
    auth: fakeAuth(() => ({ rows: [predictionRow(1.25)] }), requests) }).forecast(requestFixture);
  assert.equal(requests[0].url, 'https://bigquery.googleapis.com/bigquery/v2/projects/caller-project/queries');
  assert.equal(requests[0].data.location, 'us-central1');
});

test('BigQuery resolves the ADC project when no runtime or explicit query project is configured', async () => {
  const requests = [];
  await new TimesFmVertexClient({ auth: fakeAuth(() => ({ rows: [predictionRow(1.25)] }), requests) }).forecast(requestFixture);
  assert.equal(requests[0].url, 'https://bigquery.googleapis.com/bigquery/v2/projects/adc-runtime-project/queries');
});

test('BigQuery keeps the existing Vertex project default when no query-project override is set', async () => {
  process.env.VERTEX_AI_PROJECT = 'existing-inference-project';
  process.env.GCLOUD_PROJECT = 'floodcast-runtime-project';
  const requests = [];
  await new TimesFmVertexClient({ auth: fakeAuth(() => ({ rows: [predictionRow(1.25)] }), requests) }).forecast(requestFixture);
  assert.equal(requests[0].url, 'https://bigquery.googleapis.com/bigquery/v2/projects/existing-inference-project/queries');
});

test('configured TimesFM principal uses cached short-lived impersonation only for inference calls', async () => {
  const principal = 'localdev@project-3d38501c-9460-4059-821.iam.gserviceaccount.com';
  process.env.TIMESFM_SERVICE_ACCOUNT_EMAIL = principal;
  process.env.TIMESFM_BIGQUERY_PROJECT = 'project-3d38501c-9460-4059-821';
  process.env.GCLOUD_PROJECT = 'floodcast-runtime-project';
  const sourceRequests = [];
  const inferenceRequests = [];
  const clients = [];
  mock.method(Impersonated.prototype, 'request', async function(req) {
    assert.equal(this.getTargetPrincipal(), principal);
    clients.push(this);
    inferenceRequests.push(req);
    return { data: { rows: [predictionRow(1.25)] } };
  });
  const client = new TimesFmVertexClient({ auth: fakeAuth(() => { throw new Error('Source identity must not run inference'); }, sourceRequests) });
  await client.forecast(requestFixture);
  await client.forecast(requestFixture);
  assert.equal(sourceRequests.length, 0);
  assert.equal(inferenceRequests.length, 2);
  assert.equal(clients[0], clients[1]);
  assert.equal(inferenceRequests[0].url, 'https://bigquery.googleapis.com/bigquery/v2/projects/project-3d38501c-9460-4059-821/queries');
});

test('an existing local credential for the selected principal avoids self-impersonation', async () => {
  const principal = 'localdev@project-3d38501c-9460-4059-821.iam.gserviceaccount.com';
  process.env.TIMESFM_SERVICE_ACCOUNT_EMAIL = principal;
  const requests = [];
  mock.method(Impersonated.prototype, 'request', async () => { throw new Error('Unexpected self-impersonation'); });
  const client = new TimesFmVertexClient({ projectId: 'project-3d38501c-9460-4059-821',
    auth: fakeAuth(() => ({ rows: [predictionRow(1.25)] }), requests, 'unused-adc-project', principal) });
  const result = await client.forecast(requestFixture);
  assert.deepEqual(result.mean, [1.25]);
  assert.equal(requests.length, 1);
});

test('denied TimesFM impersonation never retries inference as the source runtime identity', async () => {
  process.env.TIMESFM_SERVICE_ACCOUNT_EMAIL = 'localdev@project-3d38501c-9460-4059-821.iam.gserviceaccount.com';
  const sourceRequests = [];
  mock.method(Impersonated.prototype, 'request', async () => { throw new Error('403 iam.serviceAccounts.getAccessToken denied'); });
  const client = new TimesFmVertexClient({ projectId: 'project-3d38501c-9460-4059-821',
    auth: fakeAuth(() => ({ rows: [predictionRow(1.25)] }), sourceRequests) });
  await assert.rejects(client.forecast(requestFixture), /getAccessToken denied/);
  assert.equal(sourceRequests.length, 0);
});

test('TimesFM principal configuration rejects non-service-account destinations before authentication', () => {
  for (const value of ['https://example.com', 'someone@gmail.com', 'localdev@project.iam.gserviceaccount.com/extra']) {
    process.env.TIMESFM_SERVICE_ACCOUNT_EMAIL = value;
    assert.throws(() => new TimesFmVertexClient(), /existing service-account principal/);
  }
});

test('pending BigQuery job is polled by its reference without resubmitting inference', async () => {
  const requests = [];
  const client = new TimesFmVertexClient({ projectId: 'runtime-project', auth: fakeAuth((req, call) => call === 1
    ? { jobComplete: false, jobReference: { projectId: 'runtime-project', jobId: 'forecast-job', location: 'us-central1' } }
    : call === 2 ? { jobComplete: false }
    : { jobComplete: true, rows: [predictionRow(1.25), predictionRow(1.3)] }, requests) });
  const result = await client.forecast(requestFixture);
  assert.deepEqual(result.mean, [1.25, 1.3]);
  assert.equal(requests.filter(req => req.method === 'POST').length, 1);
  assert.equal(requests.length, 3);
  for (const req of requests.slice(1)) {
    assert.equal(req.method, 'GET');
    assert.equal(req.url, 'https://bigquery.googleapis.com/bigquery/v2/projects/runtime-project/queries/forecast-job');
    assert.equal(req.params.location, 'us-central1');
    assert.ok(req.timeout <= 15000);
  }
});

test('completed BigQuery results retrieve subsequent pages before returning the forecast', async () => {
  const requests = [];
  const client = new TimesFmVertexClient({ projectId: 'runtime-project', auth: fakeAuth((req, call) => call === 1
    ? { jobComplete: true, rows: [predictionRow(1.25)], pageToken: 'second-page',
      jobReference: { projectId: 'runtime-project', jobId: 'forecast-job', location: 'us-central1' } }
    : { jobComplete: true, rows: [predictionRow(1.3)] }, requests) });
  const result = await client.forecast(requestFixture);
  assert.deepEqual(result.mean, [1.25, 1.3]);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].params.pageToken, 'second-page');
});

test('pending BigQuery responses without a usable job reference fail without creating another job', async () => {
  for (const jobReference of [undefined, { projectId: 'unexpected-project', jobId: 'forecast-job' }]) {
    const requests = [];
    const client = new TimesFmVertexClient({ projectId: 'runtime-project', auth: fakeAuth(() => ({ jobComplete: false, jobReference }), requests) });
    await assert.rejects(client.forecast(requestFixture), /without a valid job reference/);
    assert.equal(requests.length, 1);
  }
});

test('BigQuery result retrieval has a finite request budget without sleeps or duplicate query creation', async () => {
  const requests = [];
  const client = new TimesFmVertexClient({ projectId: 'runtime-project', auth: fakeAuth(() => ({
    jobComplete: false, jobReference: { projectId: 'runtime-project', jobId: 'pending-job' },
  }), requests) });
  await assert.rejects(client.forecast(requestFixture), /result retrieval budget/);
  assert.equal(requests.filter(req => req.method === 'POST').length, 1);
  assert.equal(requests.filter(req => req.method === 'GET').length, 8);
});

test('BigQuery result retrieval stops when the overall deadline is exhausted', async () => {
  const requests = [];
  let clockCalls = 0;
  mock.method(Date, 'now', () => clockCalls++ === 0 ? 1000000 : 1090001);
  const client = new TimesFmVertexClient({ projectId: 'runtime-project', auth: fakeAuth(() => ({
    jobComplete: false, jobReference: { projectId: 'runtime-project', jobId: 'pending-job' },
  }), requests) });
  await assert.rejects(client.forecast(requestFixture), /result retrieval budget/);
  assert.equal(requests.length, 1);
});

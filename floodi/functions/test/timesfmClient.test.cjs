const { test, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { GoogleAuth } = require('google-auth-library');
const { TimesFmVertexClient } = require('../lib/forecast/timesfmClient');

afterEach(() => {
  mock.restoreAll();
});

test('TimesFmVertexClient formats request payload and parses predictions correctly', async () => {
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
  assert.deepEqual(res.mean, [0.12, 0.15, 0.18]);
  assert.deepEqual(res.q10, [0.05, 0.08, 0.10]);
  assert.deepEqual(res.q90, [0.20, 0.24, 0.28]);
});

const { test, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { GoogleAuth } = require('google-auth-library');
const { explainWithGemini, sampleExplanationPoints } = require('../lib/forecast/gemini');
const { buildForecast } = require('../lib/forecast/pipeline');

const originalVertex = process.env.VERTEX_AI_PROJECT;
const document = buildForecast([], [], [], [], [], new Date('2026-10-10T12:00:00Z'));
afterEach(() => {
  mock.restoreAll();
  if (originalVertex === undefined) delete process.env.VERTEX_AI_PROJECT;
  else process.env.VERTEX_AI_PROJECT = originalVertex;
});

function mockRequest(text) {
  const requests = [];
  mock.method(GoogleAuth.prototype, 'getClient', async () => ({ request: async request => {
    requests.push(request);
    return { data: { candidates: [{ content: { parts: [{ text }] } }] } };
  } }));
  return requests;
}

test('routes Vertex to its configured project without using Firebase as the API consumer', async () => {
  process.env.VERTEX_AI_PROJECT = ' existing-vertex-project ';
  mock.method(GoogleAuth.prototype, 'getProjectId', async () => { throw new Error('Must not resolve Firebase project'); });
  const requests = mockRequest(JSON.stringify({ headline: 'No evaluated forecast', evidenceIds: ['availability'] }));
  const result = await explainWithGemini(document);
  assert.equal(result.headline, 'No evaluated forecast');
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /projects\/existing-vertex-project\/locations\/global\/.*gemini-3\.8-flash:generateContent$/);
  assert.equal(requests[0].data.generationConfig.responseMimeType, 'application/json');
});

test('retains the ADC project default when no Vertex project is configured', async () => {
  delete process.env.VERTEX_AI_PROJECT;
  mock.method(GoogleAuth.prototype, 'getProjectId', async () => 'adc-project');
  const requests = mockRequest(JSON.stringify({ headline: 'No evaluated forecast', evidenceIds: ['availability'] }));
  await explainWithGemini(document);
  assert.match(requests[0].url, /projects\/adc-project\//);
});

test('rejects invented explanations even when the provider request succeeds', async () => {
  process.env.VERTEX_AI_PROJECT = 'existing-vertex-project';
  mockRequest(JSON.stringify({ headline: 'No evaluated forecast', evidenceIds: ['invented-measurement'] }));
  await assert.rejects(explainWithGemini(document), /Unsupported Gemini explanation/);
});

test('rejects an unavailable headline when a calculated forecast is available', async () => {
  process.env.VERTEX_AI_PROJECT = 'existing-vertex-project';
  mockRequest(JSON.stringify({ headline: 'No evaluated forecast', evidenceIds: ['availability'] }));
  await assert.rejects(explainWithGemini({ ...document, status: 'available' }), /Unsupported Gemini explanation/);
});

test('supplies per-lead evidence and labeled long-range baseline to Gemini', async () => {
  process.env.VERTEX_AI_PROJECT = 'existing-vertex-project';
  const requests = mockRequest(JSON.stringify({ headline: 'No evaluated forecast', evidenceIds: ['availability'] }));
  const extension = {
    method: 'residual-reversion', startsAt: '2026-10-10T18:00:00Z', endsAt: '2026-10-13T12:00:00Z',
    leadValidation: [{ leadHours: 12, method: 'steady-residual', testPairs: 500, modelMaeFt: 0.2, persistenceMaeFt: 0.2, absoluteError90Ft: 0.5 }],
    peakWindows: 21, peakMaeFt: 0.3, persistencePeakMaeFt: 0.35,
  };
  const leadValidation = [{ leadHours: 6, testPairs: 600, modelMaeFt: 0.2, persistenceMaeFt: 0.3, absoluteError90Ft: 0.4 }];
  const tail = { method: 'historical-pattern', weatherSupportedUntil: null, summary: { historicalEligible: false, selectedFallback: 'historical-baseline' }, validation: { historicalEligible: false } };
  await explainWithGemini({ ...document, extension, leadValidation });
  const payload = JSON.parse(requests[0].data.contents[0].parts[0].text);
  assert.deepEqual(payload.extension, extension);
  assert.deepEqual(payload.leadValidation, leadValidation);
  await explainWithGemini({ ...document, leadValidation, tail });
  const tailPayload = JSON.parse(requests[1].data.contents[0].parts[0].text);
  assert.deepEqual(tailPayload.tail, tail);
});

test('bounds long-horizon explanation input while retaining measured forecast extrema and endpoints', () => {
  const points = Array.from({ length: 5000 }, (_, i) => ({
    t: new Date(Date.parse('2026-10-10T12:00:00Z') + i * 6 * 60000).toISOString(),
    tideFt: 3, residualFt: .5, totalFt: i === 17 ? 8 : i === 4913 ? -1 : 3.5, lowerFt: 2, upperFt: 9,
  }));
  const sampled = sampleExplanationPoints(points);
  assert.ok(sampled.length <= 80);
  assert.equal(sampled[0], points[0]);
  assert.equal(sampled.at(-1), points.at(-1));
  assert.ok(sampled.includes(points[17]));
  assert.ok(sampled.includes(points[4913]));
  assert.ok(sampled.every((p, i) => i === 0 || p.t > sampled[i - 1].t));
});

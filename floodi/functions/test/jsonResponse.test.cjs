const { test } = require('node:test');
const assert = require('node:assert/strict');
const { gunzipSync } = require('node:zlib');
const { acceptsGzip, encodeJsonResponse } = require('../lib/utils/jsonResponse');

test('compression negotiation respects refusals, wildcards and quality values', () => {
  for (const header of [undefined, '', 'br', 'gzip;q=0', '*;q=0', 'gzip;q=0, *;q=1', 'gzip;q=banana', 'gzip;q=1.1']) assert.equal(acceptsGzip(header), false, String(header));
  for (const header of ['gzip', 'br, gzip, deflate', 'GZip; q=0.5', '*;q=0.8', 'gzip;q=1, *;q=0']) assert.equal(acceptsGzip(header), true, header);
});

test('large forecast responses compress without losing any schema or precision', async () => {
  const value = { generatedAt: '2026-10-17T12:00:00Z', points: Array.from({ length: 2164 }, (_, i) => ({ t: `2026-10-${i}`, totalFt: 1.234567 + i, residualFt: -.25, factors: [{ key: 'wind', contributionFt: .125 }] })) };
  const result = await encodeJsonResponse(value, 'gzip, br');
  assert.equal(result.contentEncoding, 'gzip');
  assert.deepEqual(JSON.parse(gunzipSync(result.body).toString()), value);
  assert.ok(result.body.byteLength < Buffer.byteLength(JSON.stringify(value)) / 4);
});

test('small and non-negotiated responses stay ordinary JSON', async () => {
  assert.deepEqual(await encodeJsonResponse({ error: 'unavailable' }, 'gzip'), { body: '{"error":"unavailable"}' });
  const large = { points: Array(500).fill({ totalFt: 4.123456 }) };
  assert.deepEqual(await encodeJsonResponse(large, 'gzip;q=0'), { body: JSON.stringify(large) });
  assert.deepEqual(await encodeJsonResponse(large, '*;q=0'), { body: '', notAcceptable: true });
  const gzipRequired = await encodeJsonResponse({ a: 1 }, 'gzip, identity;q=0');
  assert.equal(gzipRequired.contentEncoding, 'gzip');
  assert.deepEqual(JSON.parse(gunzipSync(gzipRequired.body).toString()), { a: 1 });
});

function cachedHandler(read) {
  const Module = require('node:module');
  const path = require.resolve('../lib/forecast/jobs');
  delete require.cache[path];
  const original = Module._load;
  Module._load = function (request, parent, ...args) {
    if (parent?.filename === path) {
      if (request === 'firebase-admin') return { apps: [{}], firestore: () => ({ doc: () => ({ get: read }) }) };
      if (request === 'firebase-functions/logger') return { error: () => {} };
      if (request === 'firebase-functions/v2/https') return { onRequest: (_options, handler) => handler };
      if (request === 'firebase-functions/v2/scheduler') return { onSchedule: (_options, handler) => handler };
      if (request === './schema') return { validateForecast: value => value?.valid === true };
      if (request === './sources') return { SITE: { id: 'carolina-beach', sensor: '30046', phaseMinutes: 40, thresholdFt: 5.6 } };
    }
    return original.call(this, request, parent, ...args);
  };
  try { return require(path).floodOutlook; } finally { Module._load = original; delete require.cache[path]; }
}
function response() {
  return { headers: { Vary: 'Origin' }, code: 200, body: undefined,
    set(key, value) { this.headers[key] = value; return this; },
    vary(value) { this.headers.Vary = `${this.headers.Vary}, ${value}`; return this; },
    status(code) { this.code = code; return this; },
    removeHeader(key) { delete this.headers[key]; },
    type(type) { this.headers['Content-Type'] = type; return this; },
    send(body) { this.body = body; return this; }, json(body) { this.body = body; return this; },
  };
}

test('public handler compresses cached success, preserves CORS Vary and respects forecast expiry', async () => {
  const document = { valid: true, status: 'available', locationId: 'carolina-beach', sensor: '30046', phaseMinutes: 40, thresholdFt: 5.6, generatedAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 30_000).toISOString(), points: Array(1000).fill({ totalFt: 4.123456 }) };
  const handler = cachedHandler(async () => ({ exists: true, data: () => document }));
  const res = response();
  await handler({ method: 'GET', get: () => 'gzip' }, res);
  assert.equal(res.code, 200);
  assert.equal(res.headers['Content-Encoding'], 'gzip');
  assert.equal(res.headers.Vary, 'Origin, Accept-Encoding');
  assert.deepEqual(JSON.parse(gunzipSync(res.body).toString()), document);
  const maxAge = Number(res.headers['Cache-Control'].match(/max-age=(\d+)/)[1]);
  assert.ok(maxAge > 0 && maxAge <= 30);
  const refused = response();
  await handler({ method: 'GET', get: () => 'gzip;q=0, identity;q=0' }, refused);
  assert.equal(refused.code, 406);
  assert.equal(refused.headers['Cache-Control'], 'no-store');
});

test('public handler never caches invalid methods, missing/expired outlooks or read failures', async () => {
  let reads = 0;
  const unused = cachedHandler(async () => { reads++; throw new Error('Should not be called'); });
  const post = response();
  await unused({ method: 'POST', get: () => 'gzip' }, post);
  assert.equal(reads, 0);
  assert.equal(post.code, 405);
  assert.equal(post.headers.Allow, 'GET');
  assert.equal(post.headers['Cache-Control'], 'no-store');
  for (const read of [async () => ({ exists: false, data: () => undefined }), async () => ({ exists: true, data: () => ({ valid: false }) }), async () => { throw new Error('storage unavailable'); }]) {
    const res = response();
    await cachedHandler(read)({ method: 'GET', get: () => 'gzip' }, res);
    assert.equal(res.code, 503);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(res.headers['Content-Encoding'], undefined);
  }
});

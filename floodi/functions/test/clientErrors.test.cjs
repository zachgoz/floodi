const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createClientErrorHandler, createClientErrorQuota, clientErrorAllowedOrigins, CLIENT_ERROR_QUOTA_PATH } = require('../lib/clientErrors');
const { validateClientErrorReport } = require('../lib/telemetry/schema');
const origin = 'https://floodcastwebapp.web.app';
const report = () => ({ version: 1, code: 'runtime_error', route: '/tab2', buildId: 'abc1234', provider: 'app', errorType: 'TypeError', frames: [{ asset: '/assets/index-abc123.js', line: 2, column: 38 }] });
function request(patch = {}) {
  const headers = { Origin: origin, 'Content-Type': 'application/json' };
  return { method: 'POST', body: report(), ip: '192.0.2.1', get: name => headers[name], ...patch };
}
function response() {
  return { headers: {}, code: null, body: null, set(name, value) { this.headers[name] = value; return this; }, status(code) { this.code = code; return this; }, send(value) { this.body = value; } };
}
function setup(patch = {}) {
  const logs = [];
  const consumeCalls = [];
  const handler = createClientErrorHandler({ allowedOrigins: new Set([origin]), consume: async now => { consumeCalls.push(now); return true; }, log: value => logs.push(value), now: () => 60_000, ...patch });
  return { handler, logs, consumeCalls };
}

test('accepts one schema-validated report without retaining request headers or identity', async () => {
  const { handler, logs, consumeCalls } = setup();
  const res = response();
  await handler(request({ headers: { Cookie: 'private=secret' } }), res);
  assert.equal(res.code, 204);
  assert.deepEqual(logs, [report()]);
  assert.equal(consumeCalls.length, 1);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(res.headers['Access-Control-Allow-Origin'], origin);
  assert.doesNotMatch(JSON.stringify(logs), /192\.0\.2|private|secret|Cookie/);
});

test('rejects unknown/private fields, arbitrary messages, routes, asset URLs and query strings', async () => {
  for (const body of [
    { ...report(), message: 'private comment' }, { ...report(), uid: 'private-user' },
    { ...report(), route: '/profile/private-user?email=resident@example.com' },
    { ...report(), buildId: 'resident@example.com' },
    { ...report(), errorType: 'private-string' }, { ...report(), firebaseCode: 'token=secret' },
    { ...report(), frames: [{ asset: 'https://evil.test/assets/index.js', line: 1, column: 1 }] },
    { ...report(), frames: [{ asset: '/assets/index.js?token=secret', line: 1, column: 1 }] },
    { ...report(), frames: [{ asset: '/assets/../../private.js', line: 1, column: 1 }] },
    { ...report(), frames: [{ asset: '/assets/index.js', line: 1, column: 1, function: 'private content' }] },
  ]) {
    assert.equal(validateClientErrorReport(body), false);
    const { handler, logs, consumeCalls } = setup();
    const res = response();
    await handler(request({ body }), res);
    assert.equal(res.code, 400);
    assert.equal(logs.length, 0);
    assert.equal(consumeCalls.length, 0);
  }
});

test('rejects untrusted origins, unsupported methods, content types and oversized bodies before storage', async () => {
  for (const [patch, expected] of [
    [{ get: () => undefined }, 403],
    [{ get: name => name === 'Origin' ? 'https://evil.test' : 'application/json' }, 403],
    [{ method: 'GET' }, 405],
    [{ get: name => name === 'Origin' ? origin : 'text/plain' }, 415],
    [{ rawBody: Buffer.alloc(8193) }, 413],
    [{ body: { ...report(), message: 'x'.repeat(9000) } }, 413],
  ]) {
    const { handler, logs, consumeCalls } = setup();
    const res = response();
    await handler(request(patch), res);
    assert.equal(res.code, expected);
    assert.equal(logs.length, 0);
    assert.equal(consumeCalls.length, 0);
  }
});

test('allows strict native origin preflight without a database operation', async () => {
  const native = 'capacitor://localhost';
  const { handler, consumeCalls } = setup({ allowedOrigins: clientErrorAllowedOrigins('floodcastwebapp') });
  const res = response();
  await handler(request({ method: 'OPTIONS', get: name => name === 'Origin' ? native : undefined }), res);
  assert.equal(res.code, 204);
  assert.equal(res.headers['Access-Control-Allow-Origin'], native);
  assert.equal(consumeCalls.length, 0);
});

test('enforces a bounded per-source limiter before durable quota operations', async () => {
  const { handler, consumeCalls, logs } = setup();
  for (let i = 0; i < 12; i++) {
    const res = response();
    await handler(request(), res);
    assert.equal(res.code, i < 10 ? 204 : 429);
  }
  assert.equal(consumeCalls.length, 10);
  assert.equal(logs.length, 10);
});

test('fails closed during quota failure and does not log the exception or payload', async () => {
  const { handler, logs } = setup({ consume: async () => { throw new Error('private credentials'); } });
  const res = response();
  await handler(request(), res);
  assert.equal(res.code, 503);
  assert.equal(logs.length, 0);
  assert.equal(res.body, undefined);
});

test('durable global limiter caps accepted reports across instances using one fixed document and no rejected writes', async () => {
  let value;
  let writes = 0;
  let reads = 0;
  const paths = [];
  const db = {
    doc: path => { paths.push(path); return { path }; },
    runTransaction: async operation => operation({ get: async () => { reads++; return { data: () => value }; }, set: (_ref, data) => { writes++; value = data; } }),
  };
  const a = createClientErrorQuota(db);
  const b = createClientErrorQuota(db);
  for (let i = 0; i < 50; i++) assert.equal(await (i % 2 ? a : b)(60_000), true);
  assert.equal(await a(60_000), false);
  assert.equal(await b(60_000), false);
  for (let i = 0; i < 20; i++) assert.equal(await a(60_000), false);
  assert.equal(writes, 50);
  assert.equal(reads, 52);
  assert.deepEqual(new Set(paths), new Set([CLIENT_ERROR_QUOTA_PATH]));
  assert.equal(await a(120_000), true);
  assert.deepEqual(value, { minute: 2, count: 1 });
});

test('validates project/configured origins exactly without wildcard or path expansion', () => {
  const allowed = clientErrorAllowedOrigins('floodcastwebapp', 'https://custom.example,https://evil.test/path,http://evil.test,https://user:pass@evil.test');
  assert.equal(allowed.has(origin), true);
  assert.equal(allowed.has('https://custom.example'), true);
  assert.equal(allowed.has('https://floodcastwebapp.web.app.evil.test'), false);
  assert.equal(allowed.has('https://evil.test'), false);
});

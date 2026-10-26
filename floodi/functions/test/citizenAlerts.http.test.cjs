const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCitizenHttpHandler, isCitizenAuthenticationFailure } = require('../lib/citizenAlerts/http');
const { citizenDeliveryConfiguration } = require('../lib/citizenAlerts/config');
const { guestCitizenStatus, CitizenRequestError } = require('../lib/citizenAlerts/service');

const configuration = citizenDeliveryConfiguration({});
const account = { uid: 'verified-by-server', email: 'server-contact@example.com', emailVerified: true, disabled: false };
function setup(overrides = {}) {
  const calls = { authenticate: [], action: [], unsubscribe: [], log: 0, status: 0 };
  const handler = createCitizenHttpHandler({
    configuration: () => configuration, allowedOrigins: () => new Set(['https://example.com']), now: () => 1_000,
    authenticate: async token => { calls.authenticate.push(token); return account; },
    status: async current => { calls.status++; return { ...guestCitizenStatus(configuration), email: current.email, emailVerified: current.emailVerified }; },
    action: async (...values) => { calls.action.push(values); },
    unsubscribe: async token => { calls.unsubscribe.push(token); }, logFailure: () => { calls.log++; }, ...overrides,
  });
  const request = async (method = 'GET', body = undefined, headers = {}) => {
    const response = { code: 200, headers: {}, body: undefined,
      set(name, value) { this.headers[name] = value; return this; },
      status(code) { this.code = code; return this; },
      json(value) { this.body = value; return this; }, send() { return this; },
    };
    const values = { 'Content-Type': 'application/json', ...headers };
    await handler({ method, body, get: name => values[name], rawBody: Buffer.from(body === undefined ? '' : JSON.stringify(body)) }, response);
    return response;
  };
  return { calls, request };
}

test('guest GET exposes readiness without account lookup, delivery activation or unsubscribe mutation', async () => {
  const { calls, request } = setup();
  const response = await request('GET', { action: 'unsubscribe', token: 'a'.repeat(64) });
  assert.equal(response.code, 200);
  assert.equal(response.body.deliveryReady, false);
  assert.equal(response.body.subscription, null);
  assert.deepEqual(calls.authenticate, []);
  assert.deepEqual(calls.unsubscribe, []);
  assert.equal(response.headers['Cache-Control'], 'no-store');
});

test('only explicit capability POST unsubscribes, without requiring or exposing an account', async () => {
  const { calls, request } = setup();
  assert.equal((await request('POST', { action: 'unsubscribe', token: 'bad' })).code, 400);
  assert.equal((await request('POST', { action: 'unsubscribe', token: 'a'.repeat(64), uid: 'victim' })).code, 400);
  const response = await request('POST', { action: 'unsubscribe', token: 'a'.repeat(64) });
  assert.equal(response.code, 200);
  assert.deepEqual(response.body, { unsubscribed: true });
  assert.deepEqual(calls.unsubscribe, ['a'.repeat(64)]);
  assert.deepEqual(calls.authenticate, []);
});

test('enrollment requires authenticated token plus consent and rejects client email/verification/entitlement', async () => {
  const { calls, request } = setup();
  assert.equal((await request('POST', { action: 'enroll', consentVersion: 'citizen-email-v1' })).code, 401);
  assert.equal((await request('POST', { action: 'enroll' }, { Authorization: 'Bearer valid-token' })).code, 400);
  assert.equal((await request('POST', { action: 'enroll', consentVersion: 'citizen-email-v1', emailVerified: true, email: 'victim@example.com', paid: true }, { Authorization: 'Bearer valid-token' })).code, 400);
  const response = await request('POST', { action: 'enroll', consentVersion: 'citizen-email-v1' }, { Authorization: 'Bearer valid-token' });
  assert.equal(response.code, 200);
  assert.equal(response.body.email, account.email);
  assert.equal(calls.action.length, 1);
  assert.deepEqual(calls.action[0], [account, configuration, { action: 'enroll', consentVersion: 'citizen-email-v1' }]);
});

test('revoked tokens and disabled accounts receive a generic auth failure with no PII logging', async () => {
  for (const authenticate of [async () => { throw new Error('private revoked token/account details'); }, async () => ({ ...account, disabled: true })]) {
    const { calls, request } = setup({ authenticate });
    const response = await request('GET', undefined, { Authorization: 'Bearer private-token' });
    assert.equal(response.code, 401);
    assert.deepEqual(response.body, { error: 'sign-in-required' });
    assert.equal(calls.log, 0);
    assert.equal(calls.status, 0);
  }
});

test('temporary Auth service failures remain an outage instead of asking a valid resident to sign in again', async () => {
  assert.equal(isCitizenAuthenticationFailure({ code: 'auth/id-token-revoked' }), true);
  assert.equal(isCitizenAuthenticationFailure({ code: 'auth/network-request-failed' }), false);
  assert.equal(isCitizenAuthenticationFailure({ code: 'auth/insufficient-permission' }), false);
  const { calls, request } = setup({ authenticate: async () => { throw new CitizenRequestError(503, 'alerts-unavailable'); } });
  const response = await request('GET', undefined, { Authorization: 'Bearer valid-token' });
  assert.equal(response.code, 503);
  assert.deepEqual(response.body, { error: 'alerts-unavailable' });
  assert.equal(calls.log, 1);
});

test('HTTP boundary rejects unexpected origins, methods, body sizes and content types', async () => {
  const { calls, request } = setup();
  assert.equal((await request('GET', undefined, { Origin: 'https://attacker.example' })).code, 403);
  assert.equal((await request('DELETE')).code, 405);
  assert.equal((await request('POST', { action: 'pause' }, { 'Content-Type': 'text/plain' })).code, 415);
  assert.equal((await request('POST', { action: 'pause' }, { 'Content-Length': '100000' })).code, 413);
  assert.equal((await request('POST', { content: 'a'.repeat(5000) })).code, 413);
  const preflight = await request('OPTIONS', undefined, { Origin: 'https://example.com' });
  assert.equal(preflight.code, 204);
  assert.equal(preflight.headers['Access-Control-Allow-Headers'], 'Authorization, Content-Type');
  assert.deepEqual(calls.action, []);
});

test('unexpected backend failures return only a safe error and a payload-free log signal', async () => {
  const { calls, request } = setup({ status: async () => { throw new Error('private email, token and datastore details'); } });
  const response = await request('GET', undefined, { Authorization: 'Bearer valid-token' });
  assert.equal(response.code, 503);
  assert.deepEqual(response.body, { error: 'alerts-unavailable' });
  assert.equal(calls.log, 1);
});

test('instance request budget bounds metadata and capability lookup abuse', async () => {
  const { request } = setup();
  for (let i = 0; i < 300; i++) assert.equal((await request()).code, 200);
  assert.equal((await request()).code, 429);
});

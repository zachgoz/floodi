const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { citizenDeliveryConfiguration } = require('../lib/citizenAlerts/config');
const { parseCitizenAction, enrolledStatus, isDeliveryEligible, publicSubscription, guestCitizenStatus } = require('../lib/citizenAlerts/service');
const { createResendProvider, EmailProviderError } = require('../lib/citizenAlerts/provider');
const { nextCitizenAttempt, citizenFloodMessage } = require('../lib/citizenAlerts/delivery');
const { citizenAllowedOrigins } = require('../lib/citizenAlerts/jobs');

const env = { CITIZEN_ALERT_DELIVERY_ENABLED: 'true', CITIZEN_ALERT_PROVIDER: 'resend', CITIZEN_ALERT_FROM_EMAIL: 'alerts@example.com', CITIZEN_ALERT_PUBLIC_URL: 'https://example.com', CITIZEN_ALERT_RESEND_API_KEY: 'synthetic-private-test-key' };
const enabled = citizenDeliveryConfiguration(env);
const disabled = citizenDeliveryConfiguration({});
const account = { uid: 'resident', email: 'resident@example.com', emailVerified: true, disabled: false };
const subscription = { uid: account.uid, email: account.email, status: 'active', consentVersion: 'citizen-email-v1', coverage: 'carolina-beach-gauge', generation: 2, channel: 'email', createdAt: '2026-10-17T10:00:00Z', updatedAt: '2026-10-17T10:00:00Z' };

test('delivery defaults disabled and requires every operator/provider configuration field', () => {
  assert.equal(disabled.enabled, false);
  assert.equal(enabled.enabled, true);
  for (const key of Object.keys(env)) assert.equal(citizenDeliveryConfiguration({ ...env, [key]: '' }).enabled, false, key);
  for (const url of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?secret=x', 'https://example.com/#token']) {
    assert.equal(citizenDeliveryConfiguration({ ...env, CITIZEN_ALERT_PUBLIC_URL: url }).enabled, false);
  }
});

test('disabled function descriptors require no secret, while explicit activation binds all consumer runtimes', () => {
  const source = `const jobs = require('./lib/citizenAlerts/jobs'); process.stdout.write(JSON.stringify(Object.fromEntries(['citizenAlerts','queueCitizenFloodAlerts','queueCitizenAlertEnrollment','deliverCitizenFloodAlerts'].map(name => [name, jobs[name].__endpoint.secretEnvironmentVariables ?? []]))));`;
  for (const enabled of ['false', 'true']) {
    const descriptors = JSON.parse(execFileSync(process.execPath, ['-e', source], {
      cwd: path.join(__dirname, '..'), env: { ...process.env, CITIZEN_ALERT_DELIVERY_ENABLED: enabled }, encoding: 'utf8',
    }));
    for (const values of Object.values(descriptors)) {
      assert.equal(values.length, enabled === 'true' ? 1 : 0);
      if (enabled === 'true') assert.equal(values[0].key, 'CITIZEN_ALERT_RESEND_API_KEY');
    }
  }
});

test('schema requires explicit versioned consent and rejects client contact, entitlement and delivery claims', () => {
  assert.deepEqual(parseCitizenAction({ action: 'enroll', consentVersion: 'citizen-email-v1' }), { action: 'enroll', consentVersion: 'citizen-email-v1' });
  for (const body of [null, [], {}, { action: { toString: null } }, { action: 'enroll' }, { action: 'resume' }, { action: 'enroll', consentVersion: 'old' }, { action: 'test', email: 'victim@example.com' }, { action: 'enroll', consentVersion: 'citizen-email-v1', paid: true }, { action: 'enroll', consentVersion: 'citizen-email-v1', status: 'active' }]) assert.equal(parseCitizenAction(body), null);
  assert.deepEqual(parseCitizenAction({ action: 'pause' }), { action: 'pause' });
  assert.deepEqual(parseCitizenAction({ action: 'unsubscribe' }), { action: 'unsubscribe' });
});

test('unverified accounts and disabled delivery cannot become active', () => {
  assert.equal(enrolledStatus(account, disabled), 'early-access');
  assert.equal(enrolledStatus({ ...account, emailVerified: false }, enabled), 'verification-required');
  assert.equal(enrolledStatus(account, enabled), 'active');
});

test('fresh delivery eligibility requires verified current contact, consent, status and enrollment generation', () => {
  assert.equal(isDeliveryEligible(subscription, account, enabled, 2), true);
  assert.equal(isDeliveryEligible(subscription, account, disabled, 2), false);
  for (const change of [{ emailVerified: false }, { disabled: true }, { email: 'changed@example.com' }, { uid: 'other' }]) assert.equal(isDeliveryEligible(subscription, { ...account, ...change }, enabled, 2), false);
  for (const change of [{ status: 'paused' }, { status: 'unsubscribed' }, { status: 'early-access' }, { consentVersion: 'old' }, { coverage: 'some-street' }, { generation: 3 }]) assert.equal(isDeliveryEligible({ ...subscription, ...change }, account, enabled, 2), false);
});

test('status never automatically activates early-access or verification-pending enrollments', () => {
  assert.equal(publicSubscription({ ...subscription, status: 'early-access' }, account, enabled).status, 'early-access');
  assert.equal(publicSubscription({ ...subscription, status: 'verification-required' }, account, enabled).status, 'verification-required');
  assert.equal(publicSubscription(subscription, account, disabled).status, 'early-access');
  const value = publicSubscription(subscription, account, enabled);
  assert.equal(value.status, 'active');
  assert.equal('generation' in value, false);
  assert.equal('uid' in value, false);
  assert.equal('unsubscribeHash' in value, false);
  assert.equal(guestCitizenStatus(disabled).billingEnabled, false);
  assert.equal(guestCitizenStatus(disabled).deliveryReady, false);
});

test('allowed CORS origins derive from project/configuration and local browser dev is emulator-only', () => {
  const origins = citizenAllowedOrigins({ GCLOUD_PROJECT: 'floodcastwebapp' });
  assert.equal(origins.has('https://floodcastwebapp.web.app'), true);
  assert.equal(origins.has('https://attacker.example'), false);
  assert.equal(origins.has('http://localhost:5173'), false);
  assert.equal(citizenAllowedOrigins({ FUNCTIONS_EMULATOR: 'true' }).has('http://localhost:5173'), true);
});

test('provider uses fixed HTTPS endpoint, stable idempotency, fragment unsubscribe and no unsubscribe GET mutation', async () => {
  let call;
  const provider = createResendProvider(enabled, async (...args) => { call = args; return new Response(JSON.stringify({ id: 'provider-id' }), { status: 200 }); });
  const message = { id: 'delivery-stable-id', to: account.email, subject: 'Test alert', text: 'Synthetic test; no real forecast', unsubscribeToken: 'a'.repeat(64) };
  assert.equal(await provider.send(message), 'provider-id');
  assert.equal(call[0], 'https://api.resend.com/emails');
  assert.equal(call[1].headers['Idempotency-Key'], 'floodcast-delivery-stable-id');
  const body = JSON.parse(call[1].body);
  assert.match(body.text, /https:\/\/example.com\/alerts\/unsubscribe#token=a{64}/);
  assert.doesNotMatch(body.text, /\?token=/);
  assert.deepEqual(body.to, [account.email]);
  assert.equal(call[1].redirect, 'error');
});

test('provider is never called when disabled and sanitizes provider errors instead of exposing response PII', async () => {
  let calls = 0;
  const message = { id: 'x', to: account.email, subject: 'x', text: 'x', unsubscribeToken: 'a'.repeat(64) };
  await assert.rejects(createResendProvider(disabled, async () => { calls++; }).send(message), error => error instanceof EmailProviderError && !error.retryable);
  assert.equal(calls, 0);
  for (const [status, retryable] of [[400, false], [401, false], [408, true], [409, true], [422, false], [425, true], [429, true], [500, true]]) {
    await assert.rejects(createResendProvider(enabled, async () => new Response('private recipient and key', { status })).send(message), error => error.retryable === retryable && error.status === status && !error.message.includes('private'));
  }
  await assert.rejects(createResendProvider(enabled, async () => new Response(JSON.stringify({ name: 'invalid_idempotent_request', message: 'private recipient' }), { status: 409 })).send(message), error => !error.retryable && error.status === 409 && !error.message.includes('private'));
  await assert.rejects(createResendProvider(enabled, async () => new Response(JSON.stringify({ name: 'concurrent_idempotent_requests' }), { status: 409 })).send(message), error => error.retryable && error.status === 409);
  await assert.rejects(createResendProvider(enabled, async () => { throw new Error('private connection details'); }).send(message), error => error.retryable && !error.message.includes('private'));
});

test('retry backoff is bounded within the queue lifetime', () => {
  const now = new Date('2026-10-17T10:00:00Z');
  assert.equal(nextCitizenAttempt(1, now), '2026-10-17T10:01:00.000Z');
  assert.equal(nextCitizenAttempt(5, now), '2026-10-17T10:10:00.000Z');
});

test('flood messages use actual episode crossing/peak data, timezone and calibrated gauge language', () => {
  const revision = { kind: 'first_forecast', issueId: '2026-11-01T04:00:00.000Z', thresholdFt: 5.6,
    window: { startAt: '2026-11-01T04:30:00.000Z', endAt: '2026-11-01T08:00:00.000Z', peakAt: '2026-11-01T06:00:00.000Z', peakFt: 6.12, startClipped: false } };
  const message = citizenFloodMessage(revision);
  assert.match(message.text, /12:30 AM EDT/);
  assert.match(message.text, /3:00 AM EST/);
  assert.match(message.text, /6.12 ft MLLW/);
  assert.match(message.text, /5.60 ft MLLW/);
  assert.match(message.text, /Street depth and road status are not established/);
  const lower = citizenFloodMessage({ ...revision, kind: 'forecast_revised_lower' });
  assert.match(lower.text, /does not confirm that streets are dry/);
  assert.doesNotMatch(lower.text, /Predicted peak/);
});

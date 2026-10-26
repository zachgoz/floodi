const { after, before, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { applyCitizenAction, getCitizenStatus, unsubscribeWithToken } = require('../lib/citizenAlerts/service');
const { citizenDeliveryConfiguration } = require('../lib/citizenAlerts/config');
const { processCitizenDelivery, queueCitizenIntent, queueCitizenEnrollment, listDueCitizenDeliveries, citizenSourceStillCurrent, citizenSourceStatus } = require('../lib/citizenAlerts/delivery');
const { EmailProviderError } = require('../lib/citizenAlerts/provider');
const { CAROLINA_BEACH_SHADOW_POLICY } = require('../lib/alerts/jobs');
const { processShadowPublication } = require('../lib/alerts/store');
const { publishNumericalForecast } = require('../lib/forecast/publication');

describe('citizen alert enrollment and durable delivery on real Firestore', {
  skip: process.env.FIRESTORE_EMULATOR_HOST ? false : 'Requires isolated demo Firestore emulator; never runs against production',
}, () => {
  let app;
  let db;
  const initial = new Date('2026-10-17T12:00:00.000Z');
  const account = { uid: 'citizen-test-resident', email: 'resident@example.com', emailVerified: true, disabled: false };
  const configuration = citizenDeliveryConfiguration({ CITIZEN_ALERT_DELIVERY_ENABLED: 'true', CITIZEN_ALERT_PROVIDER: 'resend', CITIZEN_ALERT_FROM_EMAIL: 'alerts@example.com', CITIZEN_ALERT_PUBLIC_URL: 'https://example.com', CITIZEN_ALERT_RESEND_API_KEY: 'synthetic-test-key' });
  const disabled = citizenDeliveryConfiguration({});
  const at = minutes => new Date(+initial + minutes * 60_000);
  const status = config => getCitizenStatus(db, account, config ?? configuration);
  const action = (action, time = initial, config = configuration, current = account) => applyCitizenAction(db, current, config, { action, ...(['enroll', 'resume'].includes(action) ? { consentVersion: 'citizen-email-v1' } : {}) }, time);
  const testDelivery = async () => { await action('enroll'); await action('test', at(1)); return (await db.collection('citizen_alert_outbox').get()).docs[0]; };
  const dependencies = (provider, time = at(2), current = account) => ({ configuration, account: async () => current, provider, now: () => time });
  before(() => {
    app = initializeApp({ projectId: 'demo-floodcast-rules' }, 'citizen-alerts-emulator-tests');
    db = getFirestore(app);
  });
  beforeEach(async () => {
    for (const collection of ['citizen_alert_subscriptions', 'citizen_alert_outbox', 'citizen_alert_unsubscribe', 'citizen_alert_fanout', '_citizenAlertLimits']) await db.recursiveDelete(db.collection(collection));
    await db.doc(`shadow_alert_states/${CAROLINA_BEACH_SHADOW_POLICY.id}`).delete();
  });
  after(async () => { if (app) await deleteApp(app); });

  it('persists honest early access with private history and no queued delivery', async () => {
    await action('enroll', initial, disabled);
    const value = await status(disabled);
    assert.equal(value.subscription.status, 'early-access');
    assert.equal(value.deliveryReady, false);
    assert.equal(value.billingEnabled, false);
    assert.equal(value.history[0].kind, 'enrollment');
    assert.equal((await db.collection('citizen_alert_outbox').get()).size, 0);
    await assert.rejects(action('test', at(1), disabled), error => error.status === 409 && error.code === 'delivery-not-enabled');
  });

  it('requires fresh verified Auth contact and explicit confirmation before activating', async () => {
    await action('enroll', initial, configuration, { ...account, emailVerified: false });
    assert.equal((await status()).subscription.status, 'verification-required');
    await assert.rejects(action('test', at(1)), error => error.status === 409);
    await action('resume', at(2));
    assert.equal((await status()).subscription.status, 'active');
    await assert.rejects(action('enroll', at(3), configuration, { ...account, email: null }), error => error.code === 'email-account-required');
  });

  it('rate-limits duplicate/concurrent test requests and revokes pending delivery on pause', async () => {
    await action('enroll');
    const requests = await Promise.allSettled([action('test', at(1)), action('test', at(1))]);
    assert.equal(requests.filter(value => value.status === 'fulfilled').length, 1);
    assert.equal(requests.find(value => value.status === 'rejected').reason.status, 429);
    const queue = (await db.collection('citizen_alert_outbox').get()).docs[0];
    await action('pause', at(2));
    let sends = 0;
    assert.equal(await processCitizenDelivery(db, queue.id, dependencies({ send: async () => { sends++; return 'id'; } }, at(3))), 'cancelled');
    assert.equal(sends, 0);
    assert.equal((await queue.ref.get()).data().state, 'cancelled');
    assert.equal((await status()).subscription.status, 'paused');
    // Opt-out is always allowed, even immediately after pause.
    await action('unsubscribe', at(2));
    assert.equal((await status()).subscription.status, 'unsubscribed');
    assert.equal((await db.doc(`citizen_alert_subscriptions/${account.uid}`).get()).data().catchupPending, false);
  });

  it('supports one-click capability opt-out, without allowing old links to revoke later enrollment', async () => {
    const delivery = await testDelivery();
    const token = delivery.data().unsubscribeToken;
    await assert.rejects(unsubscribeWithToken(db, 'not-a-token', at(2)), error => error.status === 400);
    await unsubscribeWithToken(db, token, at(2));
    assert.equal((await status()).subscription.status, 'unsubscribed');
    await action('resume', at(3));
    await unsubscribeWithToken(db, token, at(4));
    assert.equal((await status()).subscription.status, 'active');
    assert.equal((await db.doc(`citizen_alert_unsubscribe/${createHash('sha256').update(token).digest('hex')}`).get()).exists, false);
  });

  it('bounds repeated enrollment writes while keeping pause and unsubscribe available', async () => {
    for (let minute = 0; minute < 12; minute++) await action('enroll', at(minute));
    await assert.rejects(action('resume', at(12)), error => error.status === 429 && error.code === 'enrollment-rate-limited');
    await action('pause', at(12));
    await action('unsubscribe', at(12));
    assert.equal((await status()).subscription.status, 'unsubscribed');
  });

  it('permits only one lease/provider call during concurrent delivery and records sent history', async () => {
    const delivery = await testDelivery();
    let sends = 0;
    const provider = { send: async () => { sends++; await new Promise(resolve => setTimeout(resolve, 30)); return 'synthetic-message-id'; } };
    const results = await Promise.all([processCitizenDelivery(db, delivery.id, dependencies(provider)), processCitizenDelivery(db, delivery.id, dependencies(provider))]);
    assert.equal(sends, 1);
    assert.ok(results.includes('sent'));
    assert.equal((await delivery.ref.get()).data().providerMessageId, 'synthetic-message-id');
    assert.equal((await status()).history.find(event => event.id === delivery.id).state, 'sent');
  });

  it('retries transient provider failures with the same stable delivery identity', async () => {
    const delivery = await testDelivery();
    const ids = [];
    assert.equal(await processCitizenDelivery(db, delivery.id, dependencies({ send: async message => { ids.push(message.id); throw new EmailProviderError(true, 503); } })), 'retry');
    assert.equal((await delivery.ref.get()).data().nextAttemptAt, at(3).toISOString());
    assert.equal(await processCitizenDelivery(db, delivery.id, dependencies({ send: async message => { ids.push(message.id); return 'retry-accepted'; } }, at(3))), 'sent');
    assert.deepEqual(ids, [delivery.id, delivery.id]);
    assert.equal((await delivery.ref.get()).data().attempts, 2);
  });

  it('never retries permanent provider rejection or sends expired messages', async () => {
    const delivery = await testDelivery();
    assert.equal(await processCitizenDelivery(db, delivery.id, dependencies({ send: async () => { throw new EmailProviderError(false, 422); } })), 'failed');
    assert.equal(await processCitizenDelivery(db, delivery.id, dependencies({ send: async () => { throw new Error('must not run'); } }, at(3))), 'not-claimed');
    await delivery.ref.update({ state: 'queued', attempts: 0, nextAttemptAt: at(2).toISOString() });
    assert.equal(await processCitizenDelivery(db, delivery.id, dependencies({ send: async () => { throw new Error('must not run'); } }, at(30))), 'expired');
    assert.equal((await delivery.ref.get()).data().state, 'expired');
  });

  it('rechecks account verification/contact after claiming, before the provider call', async () => {
    const delivery = await testDelivery();
    let accountReads = 0;
    let sends = 0;
    const value = { ...dependencies({ send: async () => { sends++; return 'bad'; } }), account: async () => ++accountReads === 1 ? account : { ...account, email: 'changed@example.com' } };
    assert.equal(await processCitizenDelivery(db, delivery.id, value), 'cancelled');
    assert.equal(accountReads, 2);
    assert.equal(sends, 0);
  });

  it('recovers an expired lease and uses provider idempotency after an ambiguous earlier send', async () => {
    const delivery = await testDelivery();
    await delivery.ref.update({ state: 'leased', attempts: 1, leaseId: 'crashed-worker', leaseUntil: at(1.5).toISOString() });
    const accepted = new Map([[delivery.id, 'earlier-accepted-message']]);
    let accepts = 1;
    const provider = { send: async message => {
      if (!accepted.has(message.id)) { accepts++; accepted.set(message.id, 'new-message'); }
      return accepted.get(message.id);
    } };
    assert.equal(await processCitizenDelivery(db, delivery.id, dependencies(provider)), 'sent');
    assert.equal(accepts, 1);
    assert.equal((await delivery.ref.get()).data().providerMessageId, 'earlier-accepted-message');
  });

  it('selects due work without letting future retries or live leases starve ready alerts', async () => {
    const batch = db.batch();
    for (let i = 0; i < 25; i++) batch.set(db.doc(`citizen_alert_outbox/future-${i}`), { state: 'retry', nextAttemptAt: at(60).toISOString() });
    for (let i = 0; i < 20; i++) batch.set(db.doc(`citizen_alert_outbox/ready-${i}`), { state: 'queued', nextAttemptAt: at(1).toISOString() });
    for (let i = 0; i < 10; i++) batch.set(db.doc(`citizen_alert_outbox/leased-future-${i}`), { state: 'leased', leaseUntil: at(60).toISOString() });
    for (let i = 0; i < 8; i++) batch.set(db.doc(`citizen_alert_outbox/leased-due-${i}`), { state: 'leased', leaseUntil: at(1).toISOString() });
    await batch.commit();
    const due = await listDueCitizenDeliveries(db, at(2));
    assert.equal(due.length, 20);
    assert.equal(due.filter(value => value.id.startsWith('ready-')).length, 15);
    assert.equal(due.filter(value => value.id.startsWith('leased-due-')).length, 5);
  });

  it('fans out a real engine revision idempotently without changing shadow delivery or recipients', async () => {
    await action('enroll');
    const generated = new Date(Date.now() - 30_000);
    const id = generated.toISOString();
    const metric = { samples: 0, maeFt: null, peakMaeFt: null, onsetMaeMinutes: null, durationMaeMinutes: null, hits: null, misses: null, falseAlarms: null, matchedEvents: null };
    const forecast = {
      version: 1, status: 'available', method: 'residual-response', confidence: 'limited', validationStage: 'historical-hindcast', generatedAt: id,
      expiresAt: new Date(+generated + 30 * 60_000).toISOString(), locationId: 'carolina-beach', sensor: '30046', tideStation: '8658163', datum: 'MLLW', units: 'ft', phaseMinutes: 60, thresholdFt: 5.6,
      currentResidualFt: .2, observationAt: id, forecastOriginAt: id, trend: 'Stable',
      points: Array.from({ length: 21 }, (_, i) => { const tideFt = 5 + 1.5 * Math.max(0, 1 - Math.abs(i - 10) / 5); return { t: new Date(+generated + i * 6 * 60_000).toISOString(), tideFt, residualFt: .2, totalFt: tideFt + .2, lowerFt: tideFt, upperFt: tideFt + .4 }; }),
      validation: { kind: 'chronological-weather-response-hindcast', trainEnd: '2026-09-01T00:00:00Z', testStart: '2026-09-02T00:00:00Z', testEnd: '2026-09-03T00:00:00Z', trainingSamples: 0, limitation: 'Synthetic fixture, no forecast skill claim', error90Ft: null, model: metric, tideOnly: metric, persistence: metric },
      evidence: [{ id: 'availability', text: 'Synthetic fixture' }], explanation: { headline: 'Flood outlook', evidenceIds: ['availability'] }, explanationSource: 'fallback', sources: [], limitations: ['Synthetic fixture'],
    };
    const inputPath = `forecast_input_archive/carolina-beach/issues/${id}`;
    await db.doc('locations/carolina-beach/outlook/current').delete();
    await db.doc(inputPath).create({ version: 1, issuedAt: id });
    assert.equal(await publishNumericalForecast(db, forecast, { inputPath, modelPath: 'forecast_model_archive/carolina-beach/models/integration-fixture' }), true);
    await processShadowPublication(db, CAROLINA_BEACH_SHADOW_POLICY, id, new Date());
    const stateRef = db.doc(`shadow_alert_states/${CAROLINA_BEACH_SHADOW_POLICY.id}`);
    const state = (await stateRef.get()).data();
    const intentId = state.pendingIntents[0].id;
    const intentRef = db.doc(`shadow_alert_outbox/${intentId}`);
    const original = (await intentRef.get()).data();
    assert.deepEqual(await queueCitizenIntent(db, intentId, disabled), { queued: 0, complete: true });
    assert.equal((await db.collection('citizen_alert_outbox').get()).size, 0);
    assert.deepEqual(await queueCitizenIntent(db, intentId, configuration), { queued: 1, complete: true });
    assert.deepEqual(await queueCitizenIntent(db, intentId, configuration), { queued: 0, complete: true });
    assert.deepEqual((await intentRef.get()).data(), original);
    assert.equal(original.delivery, 'not-attempted');
    assert.equal(original.recipientCount, 0);
    const queued = (await db.collection('citizen_alert_outbox').get()).docs[0];
    assert.equal(await citizenSourceStillCurrent(db, queued.data(), new Date()), true);
    // A current publication must be processed before any older message is sent.
    await db.doc('locations/carolina-beach/outlook/current').update({ generatedAt: new Date(+generated + 60_000).toISOString() });
    assert.equal(await citizenSourceStatus(db, queued.data(), new Date()), 'waiting');
    await db.doc('locations/carolina-beach/outlook/current').update({ generatedAt: id });
    // Completed global fan-out and an expired original intent must not prevent
    // a new resident receiving a still-current, unchanged future episode.
    await intentRef.update({ state: 'expired', expiresAt: new Date(+generated - 60_000).toISOString() });
    await db.doc(`citizen_alert_fanout/${intentId}`).update({ complete: false });
    assert.deepEqual(await queueCitizenIntent(db, intentId, configuration), { queued: 0, complete: true });
    assert.equal((await db.doc(`citizen_alert_fanout/${intentId}`).get()).data().complete, true);
    const newcomer = { ...account, uid: 'new-resident', email: 'new-resident@example.com' };
    await applyCitizenAction(db, newcomer, configuration, { action: 'enroll', consentVersion: 'citizen-email-v1' }, new Date());
    // Enrollment during temporarily unavailable evidence remains durable until
    // the next usable issue, even if it creates no new meaningful revision.
    await stateRef.update({ 'state.evidenceStatus': 'unresolved' });
    assert.equal(await queueCitizenEnrollment(db, newcomer.uid, configuration), 0);
    assert.equal((await db.doc(`citizen_alert_subscriptions/${newcomer.uid}`).get()).data().catchupPending, true);
    await stateRef.update({ 'state.evidenceStatus': 'usable' });
    assert.equal(await queueCitizenEnrollment(db, newcomer.uid, configuration), 1);
    assert.equal((await db.doc(`citizen_alert_subscriptions/${newcomer.uid}`).get()).data().catchupPending, false);
    assert.equal(await queueCitizenEnrollment(db, newcomer.uid, configuration), 0);
    const newQueue = (await db.collection('citizen_alert_outbox').where('uid', '==', newcomer.uid).get()).docs[0];
    assert.equal(newQueue.data().sourceIntentId, null);
    assert.equal(await citizenSourceStillCurrent(db, newQueue.data(), new Date()), true);
    // A usable dry issue completes pending enrollment without inventing a flood.
    const dryResident = { ...account, uid: 'dry-resident', email: 'dry-resident@example.com' };
    await applyCitizenAction(db, dryResident, configuration, { action: 'enroll', consentVersion: 'citizen-email-v1' }, new Date());
    await stateRef.update({ 'state.episodes': [] });
    assert.equal(await queueCitizenEnrollment(db, dryResident.uid, configuration), 0);
    assert.equal((await db.doc(`citizen_alert_subscriptions/${dryResident.uid}`).get()).data().catchupPending, false);
    await stateRef.update({ 'state.evidenceStatus': 'unresolved' });
    let sends = 0;
    assert.equal(await processCitizenDelivery(db, queued.id, dependencies({ send: async () => { sends++; return 'bad'; } }, new Date())), 'cancelled');
    assert.equal(sends, 0);
  });
});

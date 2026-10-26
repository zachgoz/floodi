const { after, before, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { publishNumericalForecast, publishForecastExplanation } = require('../lib/forecast/publication');
const { validateForecast } = require('../lib/forecast/schema');
const { processShadowPublication } = require('../lib/alerts/store');
const { CAROLINA_BEACH_SHADOW_POLICY } = require('../lib/alerts/jobs');

describe('real Firestore numerical publication transactions', {
  skip: process.env.FIRESTORE_EMULATOR_HOST ? false : 'Requires isolated Firestore emulator; never runs against production',
}, () => {
  let app;
  let db;
  const issueAt = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  const issueId = issueAt.toISOString();
  const currentPath = 'locations/carolina-beach/outlook/current';
  const archivePath = `forecast_archive/carolina-beach/issues/${issueId}`;
  const markerPath = `forecast_publications/carolina-beach/issues/${issueId}`;
  const inputPath = `forecast_input_archive/carolina-beach/issues/${issueId}`;
  const metrics = { samples: 0, maeFt: null, peakMaeFt: null, onsetMaeMinutes: null, durationMaeMinutes: null, hits: null, misses: null, falseAlarms: null, matchedEvents: null };
  const forecast = () => ({
    version: 1, status: 'available', method: 'residual-response', confidence: 'limited', validationStage: 'historical-hindcast',
    generatedAt: issueId, expiresAt: new Date(+issueAt + 30 * 60_000).toISOString(),
    locationId: 'carolina-beach', sensor: '30046', tideStation: '8658163', datum: 'MLLW', units: 'ft', phaseMinutes: 60, thresholdFt: 5.6,
    currentResidualFt: .2, observationAt: issueId, forecastOriginAt: issueId, trend: 'Stable',
    points: [0, 6].map(minutes => ({ t: new Date(+issueAt + minutes * 60_000).toISOString(), tideFt: 5, residualFt: .2, totalFt: 5.2, lowerFt: 5, upperFt: 5.4 })),
    validation: { kind: 'chronological-weather-response-hindcast', trainEnd: '2026-09-01T00:00:00Z', testStart: '2026-09-02T00:00:00Z', testEnd: '2026-09-03T00:00:00Z', trainingSamples: 0, limitation: 'Synthetic transaction fixture; no skill claim', error90Ft: null, model: metrics, tideOnly: metrics, persistence: metrics },
    evidence: [{ id: 'availability', text: 'Synthetic fixture' }], explanation: { headline: 'Flood outlook', evidenceIds: ['availability'] }, explanationSource: 'fallback', sources: [], limitations: ['Synthetic fixture'],
  });
  before(async () => {
    // The demo project and named app are intentionally independent of ADC.
    app = initializeApp({ projectId: 'demo-floodcast-rules' }, 'publication-emulator-tests');
    db = getFirestore(app);
    await db.recursiveDelete(db.collection('forecast_archive'));
    await db.recursiveDelete(db.collection('forecast_publications'));
    await db.doc(currentPath).delete();
  });
  after(async () => { if (app) await deleteApp(app); });

  it('commits readiness/current/archive together with a real server publication timestamp', async () => {
    const document = forecast();
    assert.equal(validateForecast(document), true);
    await db.doc(inputPath).create({ version: 1, issuedAt: issueId });
    const beforeCommit = Date.now();
    assert.equal(await publishNumericalForecast(db, document, { inputPath, modelPath: null }), true);
    const [marker, current, archive] = await db.getAll(db.doc(markerPath), db.doc(currentPath), db.doc(archivePath));
    assert.ok(marker.exists && current.exists && archive.exists);
    assert.ok(marker.data().publishedAt instanceof Timestamp);
    assert.ok(marker.data().publishedAt.toMillis() >= beforeCommit - 1000);
    // Server REQUEST_TIME is processing time, rather than a promise of exact
    // createTime equality. Consumers conservatively include createTime too.
    assert.ok(marker.data().publishedAt.toMillis() <= Date.now());
    assert.deepEqual(current.data(), document);
    assert.deepEqual(archive.data(), document);
    const createdAt = marker.createTime;
    assert.equal(await publishNumericalForecast(db, document, { inputPath, modelPath: null }), false);
    assert.equal((await db.doc(markerPath).get()).createTime.isEqual(createdAt), true);
  });

  it('keeps numerical values immutable while enriching the matching public issue', async () => {
    const document = { ...forecast(), explanationSource: 'gemini-3.8-flash' };
    await publishForecastExplanation(db, document);
    assert.equal((await db.doc(currentPath).get()).data().explanationSource, 'gemini-3.8-flash');
    assert.equal((await db.doc(archivePath).get()).data().explanationSource, 'fallback');
  });

  it('rolls back current and marker if an immutable archive already exists', async () => {
    const later = new Date(+issueAt + 60_000).toISOString();
    const document = { ...forecast(), generatedAt: later };
    const laterArchive = `forecast_archive/carolina-beach/issues/${later}`;
    await db.doc(laterArchive).create({ existing: true });
    const previous = (await db.doc(currentPath).get()).data();
    await assert.rejects(publishNumericalForecast(db, document, { inputPath, modelPath: null }));
    assert.deepEqual((await db.doc(currentPath).get()).data(), previous);
    assert.equal((await db.doc(`forecast_publications/carolina-beach/issues/${later}`).get()).exists, false);
    assert.deepEqual((await db.doc(laterArchive).get()).data(), { existing: true });
  });

  it('processes a committed flood forecast into private shadow decisions and intents on real Firestore', async () => {
    await db.doc(currentPath).delete();
    const generated = new Date(Date.now() - 30_000);
    const id = generated.toISOString();
    const document = { ...forecast(), generatedAt: id, expiresAt: new Date(+generated + 30 * 60_000).toISOString(), observationAt: id, forecastOriginAt: id,
      points: Array.from({ length: 21 }, (_, i) => {
        const tideFt = 5 + 1.5 * Math.max(0, 1 - Math.abs(i - 10) / 5);
        return { t: new Date(+generated + i * 6 * 60_000).toISOString(), tideFt, residualFt: .2, totalFt: tideFt + .2, lowerFt: tideFt, upperFt: tideFt + .4 };
      }),
    };
    const inputs = `forecast_input_archive/carolina-beach/issues/${id}`;
    await db.doc(inputs).create({ version: 1, issuedAt: id });
    assert.equal(await publishNumericalForecast(db, document, { inputPath: inputs, modelPath: 'forecast_model_archive/carolina-beach/models/integration-fixture' }), true);
    const policy = { ...CAROLINA_BEACH_SHADOW_POLICY, id: 'carolina-beach-integration-shadow-v1' };
    const result = await processShadowPublication(db, policy, id, new Date());
    assert.equal(result.result, 'applied');
    assert.equal(result.intents, 1);
    const state = await db.doc(`shadow_alert_states/${policy.id}`).get();
    assert.equal(state.data().state.evidenceStatus, 'usable');
    assert.equal(state.data().state.episodes.length, 1);
    const intentId = state.data().pendingIntents[0].id;
    const intent = (await db.doc(`shadow_alert_outbox/${intentId}`).get()).data();
    assert.equal(intent.mode, 'shadow');
    assert.equal(intent.decision, 'would-notify');
    assert.equal(intent.delivery, 'not-attempted');
    assert.equal(intent.recipientCount, 0);
    assert.equal((await processShadowPublication(db, policy, id, new Date())).result, 'duplicate');
  });
});

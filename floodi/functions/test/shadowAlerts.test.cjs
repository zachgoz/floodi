const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateShadowPublication, assessShadowEvidence, matchShadowEpisodes } = require('../lib/alerts/engine');
const { processShadowPublication, normalizeShadowPublication } = require('../lib/alerts/store');
const { validateForecast } = require('../lib/forecast/schema');

const MINUTE = 60_000;
const initial = new Date('2026-10-17T12:00:00.000Z');
const iso = m => new Date(+initial + m * MINUTE).toISOString();
const policy = {
  id: 'carolina-beach-gauge-shadow-v1', version: 'gauge-shadow-v1', mode: 'shadow', scope: 'shared-gauge',
  locationId: 'carolina-beach', referenceVersion: 'test-reference-v1', sensor: '30046', tideStation: '8658163',
  datum: 'MLLW', units: 'ft', offsetFt: 2.75, phaseMinutes: 60, thresholdFt: 5.6,
  maximumIssueAgeMinutes: 30, maximumObservationAgeMinutes: 60, maximumPointGapMinutes: 15,
  previewHorizonHours: 24, meaningfulTimeChangeMinutes: 15, meaningfulPeakChangeFt: .1,
  identityPeakToleranceMinutes: 60,
};
const metric = { samples: 20, maeFt: .2, peakMaeFt: .2, onsetMaeMinutes: 10, durationMaeMinutes: 10, hits: 2, misses: 1, falseAlarms: 1, matchedEvents: 2 };
function fixture(issuedMinute = 0, level = m => 5 + 1.2 * Math.max(0, 1 - Math.abs(m - 90) / 30)) {
  const generatedAt = iso(issuedMinute);
  const forecast = {
    version: 1, status: 'available', method: 'weather-response', confidence: 'limited', validationStage: 'historical-hindcast',
    generatedAt, expiresAt: iso(issuedMinute + 120), locationId: policy.locationId,
    sensor: policy.sensor, tideStation: policy.tideStation, datum: 'MLLW', units: 'ft', phaseMinutes: 60,
    thresholdFt: policy.thresholdFt, currentResidualFt: .2, observationAt: iso(issuedMinute - 6), forecastOriginAt: iso(issuedMinute - 6), trend: 'Stable',
    points: Array.from({ length: 41 }, (_, i) => { const totalFt = level(i * 6); return { t: iso(i * 6), tideFt: 4.5, residualFt: totalFt - 4.5, totalFt, lowerFt: totalFt - .3, upperFt: totalFt + .3 }; }),
    validation: { kind: 'chronological-perfect-weather-hindcast', trainEnd: '2026-09-01T00:00:00Z', testStart: '2026-09-02T00:00:00Z', testEnd: '2026-10-10T00:00:00Z', trainingSamples: 100, limitation: 'Synthetic behavior fixture, not measured forecast skill', error90Ft: .3, model: metric, tideOnly: metric, persistence: metric },
    evidence: [{ id: 'availability', text: 'Synthetic forecast fixture.' }],
    explanation: { headline: 'Flood outlook', evidenceIds: ['availability'] }, explanationSource: 'fallback', sources: ['synthetic'], limitations: ['synthetic'],
  };
  const publication = {
    version: 1, locationId: policy.locationId, issueId: generatedAt, generatedAt, publishedAt: generatedAt,
    archivePath: `forecast_archive/${policy.locationId}/issues/${generatedAt}`,
    inputPath: `forecast_input_archive/${policy.locationId}/issues/${generatedAt}`,
    modelPath: `forecast_model_archive/${policy.locationId}/models/2026-10-16T00:00:00.000Z`,
    referenceVersion: policy.referenceVersion, sensor: policy.sensor, tideStation: policy.tideStation,
    datum: 'MLLW', units: 'ft', offsetFt: 2.75, phaseMinutes: 60, thresholdFt: policy.thresholdFt, status: 'available',
  };
  assert.equal(validateForecast(forecast), true);
  return { publication, forecast };
}
const evaluate = (data, previous = null, at = data.publication.generatedAt) => evaluateShadowPublication(data.publication, data.forecast, previous, policy, new Date(at));

test('shadow episodes use strict gauge exceedance, interpolated crossings and native-sample peak', () => {
  const result = evaluate(fixture());
  assert.equal(result.result, 'applied');
  assert.equal(result.state.episodes.length, 1);
  const episode = result.state.episodes[0];
  assert.equal(episode.window.startAt, iso(75));
  assert.equal(episode.window.endAt, iso(105));
  assert.equal(episode.window.peakAt, iso(90));
  assert.equal(episode.window.peakFt, 6.2);
  assert.equal(result.intents[0].decision, 'would-notify');
  assert.equal(result.intents[0].state, 'simulated');
  assert.equal(result.intents[0].delivery, 'not-attempted');
  assert.match(result.intents[0].message, /street depth and road status are not established/);
  assert.equal(evaluate(fixture(0, () => 5.6)).state.episodes.length, 0);
});

test('production-style issue timestamp and delayed evaluation keep a bracketed six-minute forecast usable', () => {
  const data = fixture();
  const issued = new Date(+initial + 67_743).toISOString();
  data.forecast.generatedAt = issued;
  data.forecast.expiresAt = new Date(Date.parse(issued) + 30 * MINUTE).toISOString();
  data.forecast.observationAt = iso(-24);
  data.forecast.forecastOriginAt = iso(-24);
  // Production includes the exact issue-time point before the next NOAA tick.
  data.forecast.points[0].t = issued;
  data.publication = { ...data.publication, issueId: issued, generatedAt: issued,
    publishedAt: new Date(Date.parse(issued) + 2000).toISOString(),
    archivePath: `forecast_archive/carolina-beach/issues/${issued}`,
    inputPath: `forecast_input_archive/carolina-beach/issues/${issued}`,
  };
  for (const delay of [10_000, 120_000, 20 * MINUTE]) {
    const result = evaluate(data, null, new Date(Date.parse(issued) + delay).toISOString());
    assert.equal(result.state.evidenceStatus, 'usable');
    assert.equal(result.reason, null);
    assert.equal(result.state.episodes.length, 1);
    assert.equal(result.intents[0].decision, 'would-notify');
  }
});

test('shifting forecast windows retain identity and cumulative changes produce a revision', () => {
  const first = evaluate(fixture());
  const second = evaluate(fixture(10, m => 5 + 1.26 * Math.max(0, 1 - Math.abs(m - 90) / 30)), first.state);
  assert.equal(second.state.episodes[0].id, first.state.episodes[0].id);
  assert.equal(second.revisions.length, 0);
  const third = evaluate(fixture(20, m => 5 + 1.32 * Math.max(0, 1 - Math.abs(m - 90) / 30)), second.state);
  assert.equal(third.state.episodes[0].id, first.state.episodes[0].id);
  assert.equal(third.revisions[0].kind, 'forecast_changed');
  assert.equal(third.state.episodes[0].revision, 2);
  const shifted = evaluate(fixture(30, m => 5 + 1.32 * Math.max(0, 1 - Math.abs(m - 108) / 30)), third.state);
  assert.equal(shifted.state.episodes[0].id, first.state.episodes[0].id);
  assert.equal(shifted.revisions[0].kind, 'forecast_changed');
});

test('unchanged absolute forecast retains its onset and elapsed predicted peak as time advances', () => {
  let previous = null;
  let originalId;
  for (const minute of [0, 70, 80, 90, 100, 104]) {
    const result = evaluate(fixture(minute), previous);
    const episode = result.state.episodes[0];
    originalId ??= episode.id;
    assert.equal(episode.id, originalId);
    assert.equal(episode.window.startAt, iso(75));
    assert.equal(episode.window.startClipped, false);
    assert.equal(episode.window.endAt, iso(105));
    assert.equal(episode.window.peakAt, iso(90));
    assert.equal(episode.window.peakFt, 6.2);
    assert.equal(episode.revision, 1);
    if (minute) {
      assert.equal(result.revisions.length, 0);
      assert.equal(result.intents.length, 0);
    }
    previous = result.state;
  }
  assert.equal(previous.episodes[0].window.predictedStartIssueId, iso(70));
  assert.equal(previous.episodes[0].window.predictedPeakIssueId, iso(80));
  const revised = evaluate(fixture(105, m => Math.max(
    5 + 1.2 * Math.max(0, 1 - Math.abs(m - 90) / 30),
    5 + 1.4 * Math.max(0, 1 - Math.abs(m - 114) / 24),
  )), previous);
  assert.equal(revised.state.episodes[0].id, originalId);
  assert.equal(revised.state.episodes[0].window.peakAt, iso(114));
  assert.equal(revised.state.episodes[0].window.peakFt, 6.4);
  assert.equal(revised.revisions[0].kind, 'forecast_changed');
  const elapsed = evaluate(fixture(106), previous);
  assert.equal(elapsed.state.episodes[0].status, 'elapsed_unverified');
  assert.equal(elapsed.intents[0].decision, 'record-only');
  assert.match(elapsed.intents[0].message, /has not been verified/);
});

test('duplicate and out-of-order publications cannot replay or overwrite latest state', () => {
  const first = evaluate(fixture());
  assert.equal(evaluate(fixture(), first.state).result, 'duplicate');
  const newer = evaluate(fixture(10), first.state);
  const late = evaluate(fixture(), newer.state, iso(12));
  assert.equal(late.result, 'out-of-order');
  assert.equal(late.state.lastGeneratedAt, iso(10));
  assert.deepEqual(late.revisions, []);
});

test('stale, missing, incompatible and gap-filled evidence cannot automatically clear an episode', () => {
  const first = evaluate(fixture());
  for (const change of [
    data => { data.forecast = null; },
    data => { data.forecast.datum = 'NAVD88'; },
    data => { data.publication.referenceVersion = 'another-reference'; },
    data => { data.forecast.observationAt = iso(-120); data.forecast.forecastOriginAt = iso(-120); },
    data => { data.forecast.points.splice(10, 4); },
    data => { data.forecast.status = 'experimental'; },
    data => { data.publication.inputPath = null; },
  ]) {
    const data = fixture(10); change(data);
    const result = evaluate(data, first.state);
    assert.equal(result.state.evidenceStatus, 'unresolved');
    assert.equal(result.state.episodes[0].status, 'unresolved');
    assert.equal(result.revisions[0].kind, 'evidence_unavailable');
    assert.equal(result.intents[0].decision, 'record-only');
  }
  const stale = evaluate(fixture(), first.state, iso(31));
  assert.equal(stale.state.episodes[0].status, 'unresolved');
  assert.equal(evaluate(fixture(), stale.state, iso(90)).result, 'duplicate');
  assert.throws(() => evaluate(fixture(10), first.state, iso(5)), /future/);
});

test('fresh complete dry forecast revises a future event lower without claiming observed street recovery', () => {
  const first = evaluate(fixture());
  const revised = evaluate(fixture(10, () => 5), first.state);
  assert.equal(revised.state.episodes[0].status, 'revised_lower');
  assert.equal(revised.revisions[0].kind, 'forecast_revised_lower');
  assert.match(revised.intents[0].message, /does not confirm that streets are dry/);
  const restored = evaluate(fixture(20), revised.state);
  assert.equal(restored.state.episodes[0].id, first.state.episodes[0].id);
  assert.equal(restored.revisions[0].kind, 'forecast_restored');
});

test('forecast splits and merges are one-to-one and retain explicit identity lineage', () => {
  const broad = m => m >= 60 && m <= 180 ? 6 : 5;
  const first = evaluate(fixture(0, broad));
  const split = evaluate(fixture(10, m => m >= 108 && m <= 120 ? 5 : broad(m)), first.state);
  const active = split.state.episodes.filter(e => e.status === 'predicted');
  assert.equal(active.length, 2);
  assert.equal(active.filter(e => e.id === first.state.episodes[0].id).length, 1);
  assert.equal(active.find(e => e.id !== first.state.episodes[0].id).splitFrom, first.state.episodes[0].id);
  const merged = evaluate(fixture(20, broad), split.state);
  assert.equal(merged.state.episodes.filter(e => e.status === 'predicted').length, 1);
  const superseded = merged.state.episodes.find(e => e.status === 'superseded');
  assert.ok(superseded);
  assert.equal(superseded.mergedInto, merged.state.episodes.find(e => e.status === 'predicted').id);
  const matches = matchShadowEpisodes(active, merged.state.episodes.filter(e => e.status === 'predicted').map(e => e.window), policy);
  assert.equal(matches.length, 1);
});

test('evaluation clips at now and model-supported horizon, and does not clear an uncovered old event', () => {
  const first = evaluate(fixture());
  const limited = fixture(10, () => 5);
  limited.forecast.points = limited.forecast.points.filter(p => Date.parse(p.t) <= +initial + 60 * MINUTE);
  const result = evaluate(limited, first.state);
  assert.equal(result.state.episodes[0].status, 'unresolved');
  assert.equal(result.intents[0].decision, 'record-only');
  const assessment = assessShadowEvidence(fixture().publication, fixture().forecast, policy, initial);
  assert.equal(assessment.endAt, iso(240));
});

/** In-memory transaction runner checks create preconditions before applying any
 * writes, enforces reads-before-writes, and can rerun one callback to model an
 * optimistic concurrency retry. It cannot stand in for emulator access tests. */
function database() {
  const records = new Map();
  let retry = false;
  let abort = false;
  const ref = path => ({ path, collection: name => ({ doc: id => ref(`${path}/${name}/${id}`) }) });
  const db = {
    records, doc: ref,
    retryNext() { retry = true; },
    abortNext() { abort = true; },
    async runTransaction(work) {
      const run = async commit => {
        const operations = [];
        const result = await work({
          async get(reference) { assert.equal(operations.length, 0, 'transaction read after write'); return { exists: records.has(reference.path), data: () => structuredClone(records.get(reference.path)), ref: reference }; },
          create(reference, value) { operations.push({ kind: 'create', reference, value }); },
          set(reference, value) { operations.push({ kind: 'set', reference, value }); },
          update(reference, value) { operations.push({ kind: 'update', reference, value }); },
        });
        if (commit) {
          for (const operation of operations) {
            if (operation.kind === 'create' && records.has(operation.reference.path)) throw new Error('create precondition failed');
            if (operation.kind === 'update' && !records.has(operation.reference.path)) throw new Error('update precondition failed');
          }
          if (abort) { abort = false; throw new Error('simulated commit failure'); }
          for (const { kind, reference, value } of operations) records.set(reference.path, structuredClone(kind === 'update' ? { ...records.get(reference.path), ...value } : value));
        }
        return result;
      };
      if (retry) { retry = false; await run(false); }
      return run(true);
    },
  };
  return db;
}
function publish(db, data) {
  db.records.set(`forecast_publications/${policy.locationId}/issues/${data.publication.issueId}`, structuredClone(data.publication));
  db.records.set(data.publication.archivePath, structuredClone(data.forecast));
}

test('transaction retry and duplicate trigger produce one atomic decision, revision and simulated intent', async () => {
  const db = database(), data = fixture(); publish(db, data); db.retryNext();
  const result = await processShadowPublication(db, policy, data.publication.issueId, initial);
  assert.equal(result.result, 'applied');
  const count = filter => [...db.records.keys()].filter(filter).length;
  assert.equal(count(path => path.includes('/decisions/')), 1);
  assert.equal(count(path => path.includes('/revisions/')), 1);
  assert.equal(count(path => path.startsWith('shadow_alert_outbox/')), 1);
  const duplicate = await processShadowPublication(db, policy, data.publication.issueId, initial);
  assert.equal(duplicate.result, 'duplicate');
  assert.equal(count(path => path.includes('/decisions/')), 1);
  const intent = [...db.records.entries()].find(([path]) => path.startsWith('shadow_alert_outbox/'))[1];
  assert.deepEqual([intent.mode, intent.delivery, intent.recipientCount], ['shadow', 'not-attempted', 0]);
  assert.equal([...db.records.keys()].some(path => path.startsWith('locations/')), false);
});

test('failed commit leaves no partial episodes or intents and retry recovers', async () => {
  const db = database(), data = fixture(); publish(db, data); db.abortNext();
  await assert.rejects(processShadowPublication(db, policy, data.publication.issueId, initial), /simulated commit failure/);
  assert.equal([...db.records.keys()].some(path => path.startsWith('shadow_alert_')), false);
  await processShadowPublication(db, policy, data.publication.issueId, initial);
  assert.equal([...db.records.keys()].filter(path => path.startsWith('shadow_alert_outbox/')).length, 1);
});

test('unchanged issues preserve an intent; material changes supersede it and stale reconciliation never clears', async () => {
  const db = database(), first = fixture(); publish(db, first);
  await processShadowPublication(db, policy, first.publication.issueId, initial);
  const next = fixture(10); publish(db, next);
  await processShadowPublication(db, policy, next.publication.issueId, new Date(iso(10)));
  const initialIntent = [...db.records.entries()].find(([path]) => path.startsWith('shadow_alert_outbox/'))[1];
  assert.equal(initialIntent.state, 'simulated');
  assert.equal(initialIntent.delivery, 'not-attempted');
  const material = fixture(20, m => 5 + 1.4 * Math.max(0, 1 - Math.abs(m - 90) / 30)); publish(db, material);
  await processShadowPublication(db, policy, material.publication.issueId, new Date(iso(20)));
  const superseded = [...db.records.entries()].find(([path]) => path.startsWith('shadow_alert_outbox/'))[1];
  assert.equal(superseded.state, 'superseded');
  await processShadowPublication(db, policy, material.publication.issueId, new Date(iso(51)));
  const state = db.records.get(`shadow_alert_states/${policy.id}`).state;
  assert.equal(state.evidenceStatus, 'unresolved');
  assert.equal(state.episodes[0].status, 'unresolved');
  const late = await processShadowPublication(db, policy, first.publication.issueId, new Date(iso(52)));
  assert.equal(late.result, 'out-of-order');
  assert.equal(db.records.get(`shadow_alert_states/${policy.id}`).state.lastIssueId, material.publication.issueId);
});

test('publication normalization accepts committed Timestamp and rejects invalid/path-directed metadata', async () => {
  const data = fixture();
  const normalized = normalizeShadowPublication({ ...data.publication, publishedAt: { toDate: () => initial } }, policy.locationId, data.publication.issueId);
  assert.equal(normalized.publishedAt, initial.toISOString());
  assert.equal(normalizeShadowPublication({ ...data.publication, generatedAt: 'bad' }, policy.locationId, data.publication.issueId), null);
  const db = database(); data.publication.archivePath = 'users/private'; publish(db, data);
  db.records.set(`forecast_archive/${policy.locationId}/issues/${data.publication.issueId}`, data.forecast);
  await processShadowPublication(db, policy, data.publication.issueId, initial);
  assert.equal(db.records.get(`shadow_alert_states/${policy.id}`).state.evidenceReason, 'incompatible-publication');
});

test('job handlers skip unconfigured locations and reconcile the latest committed marker after a missed invocation', async () => {
  const Module = require('node:module');
  const path = require.resolve('../lib/alerts/jobs');
  const originalLoad = Module._load;
  const OriginalDate = Date;
  const db = database(), messages = [];
  db.collection = prefix => ({ orderBy: () => ({ limit: () => ({ get: async () => {
    const docs = [...db.records.entries()].filter(([key]) => key.startsWith(`${prefix}/`) && key.split('/').length === 4)
      .sort(([, a], [, b]) => b.generatedAt.localeCompare(a.generatedAt)).slice(0, 1)
      .map(([key, value]) => ({ id: key.split('/').at(-1), data: () => value }));
    return { empty: docs.length === 0, docs };
  } }) }) });
  Module._load = function(request, parent, ...args) {
    if (parent?.filename === path) {
      if (request === 'firebase-admin') return { apps: [{}], firestore: () => db };
      if (request === 'firebase-functions/logger') return Object.fromEntries(['info', 'error'].map(level => [level, (message, details) => messages.push({ level, message, details })]));
      if (request === 'firebase-functions/v2/firestore') return { onDocumentCreated: (_options, handler) => handler };
      if (request === 'firebase-functions/v2/scheduler') return { onSchedule: (_options, handler) => handler };
      if (request === '../forecast/publication') return { FORECAST_REFERENCE_VERSION: policy.referenceVersion };
      if (request === '../forecast/sources') return { SITE: { ...policy, id: policy.locationId } };
    }
    return originalLoad.call(this, request, parent, ...args);
  };
  delete require.cache[path];
  let jobs;
  try { jobs = require(path); } finally { Module._load = originalLoad; }
  // The job samples the clock at invocation. Keep this test deterministic without
  // changing any production function parameters or relying on wall-clock time.
  global.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [iso(10)])); }
    static now() { return +initial + 10 * MINUTE; }
  };
  try {
    await jobs.evaluateShadowFloodAlerts({ params: { locationId: 'not-configured', issueId: iso(10) } });
    assert.equal(db.records.size, 0);
    await jobs.reconcileShadowFloodAlerts();
    assert.equal(messages.at(-1).details.event, 'shadow_alert_no_publication');
    const first = fixture(), second = fixture(10); publish(db, first); publish(db, second);
    await jobs.reconcileShadowFloodAlerts();
    assert.equal(db.records.get(`shadow_alert_states/${policy.id}`).state.lastIssueId, iso(10));
    assert.equal(messages.at(-1).details.result, 'applied');
    await jobs.evaluateShadowFloodAlerts({ params: { locationId: policy.locationId, issueId: iso(0) } });
    assert.equal(messages.at(-1).details.result, 'out-of-order');
    await jobs.reconcileShadowFloodAlerts();
    assert.equal(messages.at(-1).details.result, 'duplicate');
  } finally { global.Date = OriginalDate; delete require.cache[path]; }
});

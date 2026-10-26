const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scoreVerificationDay, selectPublishedIssue, matchIntervalEvents, completeObservationWindow, hourlyOrigins } = require('../lib/verification/scorer');
const { OBSERVATION_MAX_GAP_MS } = require('../lib/verification/types');
const { loadVerificationDay, recentMaturedVerificationDays, verificationDayPath, VERIFICATION_REFERENCE } = require('../lib/verification/repository');

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const day = '2026-10-10';
const origin = Date.parse(`${day}T00:00:00.000Z`);
const iso = hours => new Date(origin + hours * HOUR).toISOString();
const reference = { version: 'test-reference-v1', locationId: 'carolina-beach', sensor: '30046', tideStation: '8658163', datum: 'MLLW', units: 'ft', offsetFt: 2.75, phaseMinutes: 60, thresholdFt: 5.6 };

function makePoints(stepHours, startHours, endHours, value = () => 4) {
  const points = [];
  for (let index = 0; index <= Math.round((endHours - startHours) / stepHours); index++) {
    const hours = startHours + index * stepHours;
    points.push({ t: new Date(origin + Math.round(hours * HOUR)), v: value(hours) });
  }
  return points;
}
function makeIssue(options = {}) {
  const generatedAt = options.generatedAt || iso(-1 / 6);
  const levels = options.levels || (() => 5);
  const tide = options.tide || (() => 4);
  const issue = {
    issueId: generatedAt, generatedAt, publishedAt: options.publishedAt || iso(-1 / 12),
    publicationBasis: options.legacy ? 'legacy-create-time' : 'atomic-publication',
    archivePath: `forecast_archive/carolina-beach/issues/${generatedAt}`,
    inputPath: `forecast_input_archive/carolina-beach/issues/${generatedAt}`, modelPath: 'forecast_model_archive/carolina-beach/models/test',
    referenceVersion: reference.version, codeVersion: 'test-revision', publicationReference: { ...reference },
    forecast: {
      version: 1, status: options.status || 'available', generatedAt, expiresAt: options.expiresAt || iso(.5),
      locationId: reference.locationId, sensor: reference.sensor, tideStation: reference.tideStation, datum: reference.datum, units: reference.units,
      phaseMinutes: reference.phaseMinutes, thresholdFt: reference.thresholdFt,
      observationAt: iso(-.5), currentResidualFt: 1,
      points: makePoints(.1, 0, options.horizon || 96, levels).map(point => ({ t: point.t.toISOString(), totalFt: point.v, tideFt: tide((+point.t - origin) / HOUR), residualFt: point.v - tide((+point.t - origin) / HOUR), lowerFt: point.v - .2, upperFt: point.v + .2 })),
    },
    input: { version: 1, issuedAt: generatedAt, reference: { ...reference, station: reference.sensor },
      recentResidual: [{ t: iso(-.5), v: 1 }], tide: makePoints(.1, 0, 96, tide).map(point => ({ t: point.t.toISOString(), v: point.v })) },
  };
  if (issue.forecast.status === 'unavailable') issue.forecast.points = [];
  return issue;
}
function run(options = {}) {
  return scoreVerificationDay({ day, asOf: new Date(iso(120)), reference,
    issues: [makeIssue()], observations: makePoints(.5, -24, 96, () => 5), ...options });
}
const first = (result, method = 'served', leadHours = 1) => result.targetScores.find(row => row.originAt === iso(0) && row.method === method && row.leadHours === leadHours);
const firstWindow = (result, method = 'served') => result.eventWindows.find(row => row.originAt === iso(0) && row.method === method);
const pulse = center => hours => 4 + Math.max(0, 3 * (1 - Math.abs(hours - center) / .5));

test('hourly UTC cohorts survive DST dates without missing or duplicated origins', () => {
  const origins = hourlyOrigins('2026-11-01');
  assert.equal(origins.length, 24);
  assert.equal(+origins[23] - +origins[0], 23 * HOUR);
  assert.throws(() => hourlyOrigins('2026-02-30'), /Invalid/);
});

test('stored verification cohorts cannot overwrite another calibration reference', () => {
  const current = verificationDayPath(VERIFICATION_REFERENCE, day);
  const changed = verificationDayPath({ ...VERIFICATION_REFERENCE, version: 'cb-reference-v2-example' }, day);
  assert.notEqual(current, changed);
  assert.ok(current.includes(`/references/${VERIFICATION_REFERENCE.version}/days/${day}`));
  assert.throws(() => verificationDayPath({ ...VERIFICATION_REFERENCE, version: '../other' }, day), /Invalid/);
});

test('input provenance includes a changing maturity cutoff but stays stable after every target matures', () => {
  const observations = [];
  const early = run({ observations, asOf: new Date(iso(1)) });
  const later = run({ observations, asOf: new Date(iso(2)) });
  assert.notEqual(early.inputHash, later.inputHash);
  const mature = run({ observations, asOf: new Date(iso(120)) });
  const matureLater = run({ observations, asOf: new Date(iso(144)) });
  assert.equal(mature.inputHash, matureLater.inputHash);
});

test('selection follows actual publication, not generation or hindsight', () => {
  const old = makeIssue();
  const delayed = makeIssue({ generatedAt: iso(-.05), publishedAt: iso(.05) });
  assert.equal(selectPublishedIssue([delayed, old], new Date(iso(0))).issueId, old.issueId);
  assert.equal(selectPublishedIssue([delayed, old], new Date(iso(1))).issueId, delayed.issueId);
  const result = run({ issues: [delayed, old] });
  assert.equal(first(result).issueId, old.issueId);
  assert.equal(first(result).publicationToTargetHours, 1 + 1 / 12);
});

test('frozen outputs are scored against native observations with issued-only baselines', () => {
  const result = run();
  assert.equal(first(result).errorFt, 0);
  assert.equal(first(result, 'tide-only').errorFt, -1);
  assert.equal(first(result, 'persistence').errorFt, 0);
  assert.equal(first(result, 'served', 72).status, 'scored');
  assert.equal(result.targetScores.length, 24 * 7 * 3);
  const common = result.pairedLeadComparisons.find(row => row.leadHours === 1 && row.baseline === 'tide-only');
  assert.equal(common.commonSamples, 1);
  assert.equal(common.servedMaeFt, 0);
  assert.equal(common.baselineMaeFt, 1);
  assert.equal(result.readiness, 'not-assessed');
});

test('an expired publication is unavailable, without falling back to a previous forecast', () => {
  const old = makeIssue({ generatedAt: iso(-1), publishedAt: iso(-.9), expiresAt: iso(24) });
  const latest = makeIssue({ expiresAt: iso(-.01) });
  assert.equal(first(run({ issues: [old, latest] })).exclusion, 'issue-expired');
  const unavailable = makeIssue({ status: 'unavailable' });
  assert.equal(first(run({ issues: [old, unavailable] })).exclusion, 'issue-unavailable');
});

test('reference and publication contracts reject datum, phase, threshold and future-generation mismatches', () => {
  for (const field of ['datum', 'phaseMinutes', 'thresholdFt', 'sensor']) {
    const issue = makeIssue();
    issue.forecast[field] = field === 'datum' ? 'NAVD88' : field === 'sensor' ? 'wrong-station' : 999;
    assert.equal(first(run({ issues: [issue] })).exclusion, 'incompatible-reference', field);
  }
  const marker = makeIssue();
  marker.referenceVersion = 'other-reference';
  assert.equal(first(run({ issues: [marker] })).exclusion, 'incompatible-reference');
  const future = makeIssue({ generatedAt: iso(.1), publishedAt: iso(-.1) });
  assert.equal(first(run({ issues: [future] })).exclusion, 'invalid-publication');
});

test('legacy creation-time availability remains explicitly labelled', () => {
  const result = run({ issues: [makeIssue({ legacy: true })] });
  assert.equal(first(result).publicationBasis, 'legacy-create-time');
  assert.equal(first(result).status, 'scored');
  assert.match(result.limitations.join(' '), /conservative availability/);
});

test('missing issued inputs do not erase served scores or manufacture baselines', () => {
  const issue = makeIssue();
  delete issue.input;
  const result = run({ issues: [issue] });
  assert.equal(first(result).status, 'scored');
  assert.equal(first(result, 'tide-only').exclusion, 'input-unavailable');
  assert.equal(first(result, 'persistence').exclusion, 'input-unavailable');
  assert.equal(result.pairedLeadComparisons[0].commonSamples, 0);
});

test('future residual anchors and incompatible archived inputs are never used', () => {
  const issue = makeIssue();
  issue.input.recentResidual.push({ t: iso(1), v: 7 });
  assert.equal(first(run({ issues: [issue] }), 'persistence').exclusion, 'incompatible-input');
  const mismatch = makeIssue();
  mismatch.input.reference.offsetFt = 3;
  assert.equal(first(run({ issues: [mismatch] }), 'tide-only').exclusion, 'incompatible-input');
  const stale = makeIssue();
  stale.input.recentResidual = [{ t: iso(-2), v: 1 }];
  assert.equal(first(run({ issues: [stale] }), 'persistence').exclusion, 'residual-anchor-unavailable');
  assert.equal(first(run({ issues: [stale] }), 'tide-only').status, 'scored');
});

test('native 30-minute cadence works, but a missing observation is unknown rather than dry', () => {
  const observations = makePoints(.5, -24, 96, () => 5).filter(point => +point.t !== origin + HOUR);
  const result = run({ observations });
  assert.equal(first(result).exclusion, 'observation-unsupported');
  assert.equal(first(result).observedFt, null);
  assert.equal(firstWindow(result).exclusion, 'observation-unsupported');
  assert.equal(firstWindow(result).correctDryWindow, null);
  assert.equal(result.dayStartEventCohort[0].status, 'excluded');
  assert.equal(completeObservationWindow(makePoints(.5, 0, 2), new Date(iso(0)), new Date(iso(2))), true);
  assert.equal(completeObservationWindow([{ t: new Date(iso(0)), v: 4 }, { t: new Date(origin + OBSERVATION_MAX_GAP_MS + 1), v: 4 }], new Date(iso(0)), new Date(origin + OBSERVATION_MAX_GAP_MS + 1)), false);
});

test('future targets, missing forecast horizons and truncation have explicit exclusions', () => {
  assert.equal(first(run({ asOf: new Date(iso(.5)) })).exclusion, 'target-not-matured');
  assert.equal(first(run({ issues: [makeIssue({ horizon: 6 })] }), 'served', 72).exclusion, 'forecast-unsupported');
  const result = run({ archiveReadTruncated: true });
  assert.equal(first(result).exclusion, 'archive-read-truncated');
  assert.equal(result.leadMetrics.every(metric => metric.samples === 0 && metric.maeFt === null), true);
});

test('event matching rejects nearby peaks belonging to non-overlapping floods', () => {
  const result = run({ observations: makePoints(.5, -24, 96, pulse(6)), issues: [makeIssue({ levels: pulse(5) })] });
  const window = firstWindow(result);
  assert.equal(window.status, 'scored');
  assert.equal(window.observedNewOnsets, 1);
  assert.equal(window.matchedNewOnsets, 0);
  assert.equal(window.missedNewOnsets, 1);
  assert.equal(window.unmatchedPredictedEvents, 1);
  assert.equal(result.dayStartEventCohort[0].missedEventIds.length, 1);
  assert.equal(result.eventLedger.length, 1);
  assert.equal(result.eventLedger[0].onsetBracket.beforeAt, iso(5.5));
  assert.equal(result.eventLedger[0].onsetBracket.afterAt, iso(6));
  assert.equal(result.eventLedger[0].endBracket.beforeAt, iso(6));
  assert.equal(result.eventLedger[0].endBracket.afterAt, iso(6.5));
});

test('matched native events retain peak and crossing errors with independent unique-day cohort', () => {
  const issue = makeIssue({ levels: pulse(6), tide: pulse(6), expiresAt: iso(24) });
  issue.input.recentResidual[0].v = 0;
  const result = run({ observations: makePoints(.5, -24, 96, pulse(6)), issues: [issue] });
  const window = firstWindow(result);
  assert.equal(window.matchedNewOnsets, 1);
  assert.ok(Math.abs(window.matches[0].onsetErrorMinutes) < .0001);
  assert.equal(window.matches[0].peakErrorFt, 0);
  assert.ok(Math.abs(window.matches[0].durationErrorMinutes) < .0001);
  assert.equal(result.eventLedger.length, 1);
  assert.equal(result.dayStartEventCohort[0].hitEventIds.length, 1);
  assert.ok(result.eventMetrics[0].newOnsetHits > 1, 'hourly diagnostics repeat the event');
  assert.equal(result.eventMetrics[0].unit, 'overlapping-origin-event-pairs');
  assert.ok(result.pairedEventComparisons[0].commonCompleteOriginEventPairs > 0);
  assert.equal(result.pairedEventComparisons[0].served.peakMaeFt, 0);
});

test('a flood already underway is not counted as advance-warning success', () => {
  const levels = hours => hours <= 0 ? 7 : Math.max(4, 7 - hours * 2);
  const result = run({ observations: makePoints(.5, -24, 96, levels), issues: [makeIssue({ levels })] });
  const window = firstWindow(result);
  assert.equal(window.cohort, 'already-flooding');
  assert.equal(window.matchedUnderway, 1);
  assert.equal(window.matchedNewOnsets, 0);
  assert.equal(window.matches[0].forecastAvailableBeforeOnsetMinutes, null);
  assert.equal(window.matches[0].onsetErrorMinutes, null);
  assert.equal(window.matches[0].durationErrorMinutes, null);
  assert.equal(result.dayStartEventCohort[0].hitEventIds.length, 0);
});

test('unknown event boundaries retain clipping and never receive invented end times', () => {
  const observations = makePoints(.5, 0, 24, () => 7);
  const result = run({ observations, issues: [makeIssue({ levels: () => 7 })] });
  assert.equal(result.eventLedger[0].complete, false);
  assert.equal(result.eventLedger[0].startClipped, true);
  assert.equal(result.eventLedger[0].endAt, null);
  assert.equal(result.eventLedger[0].onsetBracket, null);
  assert.equal(result.eventLedger[0].endBracket, null);
  assert.equal(firstWindow(result).matches[0].durationErrorMinutes, null);
});

test('matching maximizes one-to-one interval support with deterministic tie handling', () => {
  const event = (start, end) => ({ id: iso(start), startAt: iso(start), endAt: iso(end) });
  const actual = [event(1, 2), event(3, 4)];
  const predicted = [event(.5, 2.5), event(3.5, 4.5)];
  assert.deepEqual(matchIntervalEvents(actual, predicted, iso(24)), [
    { observedIndex: 0, predictedIndex: 0, overlapMinutes: 60 },
    { observedIndex: 1, predictedIndex: 1, overlapMinutes: 30 },
  ]);
  assert.deepEqual(matchIntervalEvents([event(1, 2)], [event(2, 3)], iso(24)), []);
});

test('unchanged inputs have a stable revision hash; corrected observations change it', () => {
  const a = run(), b = run();
  assert.equal(a.inputHash, b.inputHash);
  const observations = makePoints(.5, -24, 96, () => 5);
  observations.find(point => +point.t === origin + HOUR).v = 5.1;
  assert.notEqual(a.inputHash, run({ observations }).inputHash);
  assert.equal(JSON.stringify(a).includes('NaN'), false);
  assert.ok(Buffer.byteLength(JSON.stringify(a)) < 700_000);
});

test('matured scheduler days keep the last 72h target at least six hours in the past', () => {
  const asOf = new Date('2026-10-17T06:40:00.000Z');
  const days = recentMaturedVerificationDays(asOf);
  assert.equal(days.length, 2);
  for (const value of days) assert.ok(Date.parse(`${value}T00:00:00.000Z`) + DAY + 72 * HOUR + 6 * HOUR <= +asOf);
});

test('repository dry run reads only selected frozen issues and daily native maps without writes', async () => {
  const issue = makeIssue({ legacy: true });
  // Real repository reference matches current ingestion, rather than the synthetic reference above.
  issue.forecast.phaseMinutes = VERIFICATION_REFERENCE.phaseMinutes;
  issue.input.reference.phaseMinutes = VERIFICATION_REFERENCE.phaseMinutes;
  const store = new Map();
  const snapshot = (id, data, exists = true) => ({ id, exists, data: () => data, createTime: { toDate: () => new Date(issue.publishedAt) } });
  store.set(issue.archivePath, snapshot(issue.issueId, issue.forecast));
  store.set(issue.inputPath, snapshot(issue.issueId, issue.input));
  for (const point of makePoints(.5, -24, 96, () => 5)) {
    const key = `locations/carolina-beach/observations/${point.t.toISOString().slice(0, 10)}`;
    if (!store.has(key)) store.set(key, snapshot(key, { fiman: {} }));
    store.get(key).data().fiman[point.t.toISOString()] = point.v;
  }
  const reads = [];
  const db = {
    doc: path => ({ path }),
    collection: path => {
      const query = { where: () => query, orderBy: () => query, limit: () => query, select: () => query,
        get: async () => path.startsWith('forecast_archive/') ? { size: 1, docs: [snapshot(issue.issueId, { generatedAt: issue.generatedAt })] } : { size: 0, docs: [] } };
      return query;
    },
    getAll: async (...refs) => refs.filter(ref => ref.path).map(ref => { reads.push(ref.path); return store.get(ref.path) || snapshot(ref.path, undefined, false); }),
  };
  const result = await loadVerificationDay(db, day, new Date(iso(120)));
  assert.equal(first(result).status, 'scored');
  assert.equal(result.coverage.source.selectedIssues, 1);
  assert.equal(reads.filter(path => path.startsWith('forecast_archive/')).length, 1);
  assert.equal(reads.some(path => /observations\/\d{4}-\d{2}$/.test(path)), false, 'does not load legacy month maps');
});

test('repository waits for marker commit even when REQUEST_TIME precedes the decision origin', async () => {
  const issue = makeIssue({ expiresAt: iso(2) });
  issue.forecast.phaseMinutes = VERIFICATION_REFERENCE.phaseMinutes;
  issue.input.reference.phaseMinutes = VERIFICATION_REFERENCE.phaseMinutes;
  const native = Object.fromEntries(makePoints(.5, -24, 96, () => 5).map(point => [point.t.toISOString(), point.v]));
  const marker = { version: 1, ...VERIFICATION_REFERENCE, referenceVersion: VERIFICATION_REFERENCE.version,
    issueId: issue.issueId, generatedAt: issue.generatedAt, publishedAt: { toDate: () => new Date(iso(-.1)) },
    archivePath: issue.archivePath, inputPath: issue.inputPath, modelPath: issue.modelPath, codeVersion: 'test-revision' };
  marker.version = 1;
  const archiveSnap = { id: issue.issueId, exists: true, data: () => ({ generatedAt: issue.generatedAt }), createTime: { toDate: () => new Date(iso(.05)) } };
  const markerSnap = { id: issue.issueId, exists: true, data: () => marker, createTime: { toDate: () => new Date(iso(.05)) } };
  const reads = [];
  const db = {
    doc: path => ({ path }),
    collection: path => {
      const query = { where: () => query, orderBy: () => query, limit: () => query, select: () => query,
        get: async () => ({ size: 1, docs: [path.startsWith('forecast_archive/') ? archiveSnap : markerSnap] }) };
      return query;
    },
    getAll: async (...refs) => refs.filter(ref => ref.path).map(ref => {
      reads.push(ref.path);
      return { exists: true, data: () => ref.path === issue.archivePath ? issue.forecast : ref.path === issue.inputPath ? issue.input : { fiman: native } };
    }),
  };
  const result = await loadVerificationDay(db, day, new Date(iso(120)));
  assert.equal(first(result).exclusion, 'no-published-issue');
  const next = result.targetScores.find(row => row.originAt === iso(1) && row.method === 'served' && row.leadHours === 1);
  assert.equal(next.status, 'scored');
  assert.equal(next.publishedAt, iso(.05));
  assert.equal(next.publicationBasis, 'atomic-publication');
  marker.archivePath = 'users/private-document';
  const invalid = await loadVerificationDay(db, day, new Date(iso(120)));
  assert.equal(invalid.targetScores.find(row => row.originAt === iso(1) && row.method === 'served').exclusion, 'incompatible-reference');
  assert.equal(reads.includes('users/private-document'), false);
});

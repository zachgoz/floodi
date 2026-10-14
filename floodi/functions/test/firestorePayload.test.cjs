const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FieldValue, Timestamp } = require('@google-cloud/firestore');
const { validateDocumentData } = require('@google-cloud/firestore/build/src/write-batch');
const { sanitizeFirestorePayload } = require('../lib/utils/firestorePayload');

test('reproduces the production serializer error and permits the repaired weather bucket', () => {
  const payload = { fiman: { '2026-10-14T11:36:04.000Z': 4.92 }, weather: {
    '2026-10-14T11:00:00Z': { windSpeed: 12, temp: undefined, pressure: undefined, precip: 0 },
  } };
  assert.throws(() => validateDocumentData('data', payload, false, false), /Cannot use "undefined".*weather/);
  const repaired = sanitizeFirestorePayload(payload);
  assert.doesNotThrow(() => validateDocumentData('data', repaired, false, false));
  assert.deepEqual(repaired.fiman, payload.fiman);
  assert.deepEqual(repaired.weather['2026-10-14T11:00:00Z'], { windSpeed: 12, precip: 0 });
  assert.equal(payload.weather['2026-10-14T11:00:00Z'].temp, undefined);
  assert.ok(Object.hasOwn(payload.weather['2026-10-14T11:00:00Z'], 'temp'));
});

test('omits nonfinite measurements and absent nested fields while retaining real zero and null', () => {
  assert.deepEqual(sanitizeFirestorePayload({ speed: NaN, gust: Infinity, pressure: -Infinity, rain: 0, missing: null,
    records: { sample: { wind: undefined, speed: 0 }, absent: undefined },
  }), { rain: 0, missing: null, records: { sample: { speed: 0 } } });
});

test('retains array positions as unavailable rather than shifting timestamp/value correspondence', () => {
  assert.deepEqual(sanitizeFirestorePayload({ values: [1, undefined, NaN, null, 0, { pressure: undefined, rain: 0 }] }), {
    values: [1, null, null, null, 0, { rain: 0 }],
  });
});

test('preserves Firestore timestamps, delete and serverTimestamp sentinels, and Date values', () => {
  const payload = { timestamp: Timestamp.fromMillis(1000), updatedAt: FieldValue.serverTimestamp(), removed: FieldValue.delete(), date: new Date(1000) };
  const repaired = sanitizeFirestorePayload(payload);
  for (const key of Object.keys(payload)) assert.equal(repaired[key], payload[key]);
  assert.doesNotThrow(() => validateDocumentData('data', repaired, true, false));
});

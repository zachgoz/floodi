const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  aggregateVerificationDays,
  AUDITED_BASELINE_SUMMARY,
  verificationSummaryDocPath,
} = require('../lib/verification/summary');

test('verification summary path uses supported 2-part document path', () => {
  const p = verificationSummaryDocPath('carolina-beach');
  assert.equal(p, 'locations/carolina-beach/verification/summary');
  const segments = p.split('/');
  assert.equal(segments.length % 2, 0, 'Document path must have an even number of segments');
});

test('aggregateVerificationDays falls back to audited baseline when days array is empty', () => {
  const now = new Date('2026-11-03T12:00:00Z');
  const summary = aggregateVerificationDays([], 'carolina-beach', now);
  assert.equal(summary.locationId, 'carolina-beach');
  assert.equal(summary.isAuditedBaseline, true);
  assert.equal(summary.mae24hInches, 2.4);
  assert.equal(summary.mae24hFt, 0.199);
  assert.equal(summary.mae1hInches, 1.4);
  assert.equal(summary.errorReductionPct, 77);
  assert.equal(summary.leads.length, 7);
});

test('aggregateVerificationDays correctly aggregates scored targets and computes rolling MAE', () => {
  const now = new Date('2026-11-03T12:00:00Z');

  // Create mock scored days
  const mockDay = {
    version: 'prospective-v1',
    day: '2026-11-02',
    evaluatedAt: '2026-11-03T06:40:00Z',
    reference: {
      version: 'v1',
      locationId: 'carolina-beach',
      thresholdFt: 5.6,
    },
    targetScores: [
      // 24h lead served
      { status: 'scored', leadHours: 24, method: 'served', errorFt: 0.18 },
      { status: 'scored', leadHours: 24, method: 'served', errorFt: -0.22 },
      // 24h lead baselines
      { status: 'scored', leadHours: 24, method: 'tide-only', errorFt: 0.60 },
      { status: 'scored', leadHours: 24, method: 'tide-only', errorFt: -0.80 },
      { status: 'scored', leadHours: 24, method: 'persistence', errorFt: 0.90 },
      // 1h lead served
      { status: 'scored', leadHours: 1, method: 'served', errorFt: 0.10 },
      { status: 'scored', leadHours: 1, method: 'served', errorFt: -0.12 },
    ],
    eventMetrics: [
      {
        method: 'served',
        completeMatchedEvents: 2,
        onsetMaeMinutes: 24.0,
      },
    ],
  };

  const summary = aggregateVerificationDays([mockDay], 'carolina-beach', now);
  assert.equal(summary.isAuditedBaseline, false);
  assert.equal(summary.periodDays, 1);
  assert.equal(summary.sampleCount, 2);
  // 24h MAE: (|0.18| + |-0.22|) / 2 = 0.200 ft -> 2.4 in
  assert.equal(summary.mae24hFt, 0.200);
  assert.equal(summary.mae24hInches, 2.4);
  // 1h MAE: (|0.10| + |-0.12|) / 2 = 0.110 ft -> 1.3 in
  assert.equal(summary.mae1hFt, 0.110);
  assert.equal(summary.mae1hInches, 1.3);
  assert.equal(summary.crestTimingMinutes, 24.0);
  // Tide-only MAE: (|0.60| + |-0.80|) / 2 = 0.700 ft. Error reduction: 1 - 0.200 / 0.700 = 71%
  assert.equal(summary.errorReductionPct, 71);
});


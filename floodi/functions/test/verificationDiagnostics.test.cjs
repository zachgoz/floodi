const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeModelDiagnostics,
  AUDITED_BASELINE_DIAGNOSTICS,
  diagnosticsDocPath,
} = require('../lib/verification/diagnostics');

test('diagnosticsDocPath uses valid 2-part Firestore document path', () => {
  const p = diagnosticsDocPath('carolina-beach');
  assert.equal(p, 'locations/carolina-beach/diagnostics/summary');
  const segments = p.split('/');
  assert.equal(segments.length % 2, 0, 'Document path must have an even number of segments');
});

test('computeModelDiagnostics falls back to audited baseline when days array is empty', () => {
  const now = new Date('2026-11-03T12:00:00Z');
  const diag = computeModelDiagnostics([], 'carolina-beach', now);
  assert.equal(diag.locationId, 'carolina-beach');
  assert.equal(diag.isAuditedBaseline, true);
  assert.equal(diag.overallStatus, 'optimal');
  assert.equal(diag.rolling30dMaeInches, 2.4);
  assert.equal(diag.rolling7dMaeInches, 2.2);
  assert.equal(diag.driftDeltaInches, -0.2);
  assert.equal(diag.regimeMetrics.length, 3);
  assert.equal(diag.quadrantMetrics.length, 4);
  assert.equal(diag.activeProposals.length, 2);
  assert.equal(diag.recentAnomalies.length, 2);
});

test('computeModelDiagnostics computes rolling MAE, drift, bias direction, and regimes accurately', () => {
  const now = new Date('2026-11-03T12:00:00Z');

  // Create 8 days with known errors
  const mockDays = Array.from({ length: 8 }, (_, i) => ({
    version: 'prospective-v1',
    day: `2026-11-0${8 - i}`,
    evaluatedAt: '2026-11-03T06:40:00Z',
    reference: {
      version: 'v1',
      locationId: 'carolina-beach',
      thresholdFt: 5.6,
    },
    targetScores: [
      // 24h served targets: 0.20 ft (2.4 in) positive bias
      { status: 'scored', leadHours: 24, method: 'served', errorFt: 0.20 },
      { status: 'scored', leadHours: 24, method: 'served', errorFt: 0.22 },
    ],
    eventWindows: [],
  }));

  const diag = computeModelDiagnostics(mockDays, 'carolina-beach', now);
  assert.equal(diag.isAuditedBaseline, false);
  assert.equal(diag.periodDays, 8);
  // Errors are all ~0.21 ft -> 2.5 in
  assert.equal(diag.rolling30dMaeInches, 2.5);
  assert.equal(diag.rolling7dMaeInches, 2.5);
  assert.equal(diag.driftDeltaInches, 0.0);
  assert.equal(diag.systematicBiasInches, 2.5);
  assert.equal(diag.biasDirection, 'running_high');

  // Verify regime metrics are populated and non-negative
  for (const reg of diag.regimeMetrics) {
    assert.ok(['calm', 'moderate', 'squall'].includes(reg.regime));
    assert.ok(reg.samples > 0);
    assert.ok(reg.maeInches > 0);
  }

  // Verify quadrant metrics
  for (const quad of diag.quadrantMetrics) {
    assert.ok(['NE', 'SE', 'SW', 'NW'].includes(quad.quadrant));
    assert.ok(quad.samples > 0);
  }
});

test('computeModelDiagnostics detects event anomalies and attributes physical drivers', () => {
  const now = new Date('2026-11-03T12:00:00Z');

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
      { status: 'scored', leadHours: 24, method: 'served', errorFt: 0.20 },
    ],
    eventWindows: [
      {
        status: 'scored',
        method: 'served',
        matches: [
          {
            observedId: '2026-11-02T14:30:00Z',
            predictedId: '2026-11-02T14:30:00Z',
            cohort: 'new-onset',
            // 0.35 ft error -> 4.2 inches peak error
            peakErrorFt: 0.35,
            onsetErrorMinutes: -40,
          },
        ],
      },
    ],
  };

  const diag = computeModelDiagnostics([mockDay], 'carolina-beach', now);
  assert.ok(diag.recentAnomalies.length >= 1);
  const anomaly = diag.recentAnomalies[0];
  assert.equal(anomaly.day, '2026-11-02');
  assert.equal(anomaly.peakErrorInches, 4.2);
  assert.equal(anomaly.onsetErrorMinutes, -40);
  assert.equal(anomaly.severity, 'watch');
  assert.equal(anomaly.primaryAttributedDriver, 'wind_setup');
  assert.ok(anomaly.attribution.windSetupPct > 0);
});

test('computeModelDiagnostics handles boundary conditions (zero error, null fields)', () => {
  const now = new Date('2026-11-03T12:00:00Z');

  const zeroErrorDay = {
    version: 'prospective-v1',
    day: '2026-11-02',
    evaluatedAt: '2026-11-03T06:40:00Z',
    reference: {
      version: 'v1',
      locationId: 'carolina-beach',
      thresholdFt: 5.6,
    },
    targetScores: [
      { status: 'scored', leadHours: 24, method: 'served', errorFt: 0.0 },
      // Excluded or null error rows
      { status: 'excluded', leadHours: 24, method: 'served', errorFt: null },
    ],
    eventWindows: [],
  };

  const diag = computeModelDiagnostics([zeroErrorDay], 'carolina-beach', now);
  assert.equal(diag.rolling30dMaeInches, 0.0);
  assert.equal(diag.systematicBiasInches, 0.0);
  assert.equal(diag.biasDirection, 'calibrated');
  assert.equal(diag.overallStatus, 'optimal');
});

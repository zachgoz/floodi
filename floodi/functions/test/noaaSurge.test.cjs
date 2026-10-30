const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseNoaaSurgeTable } = require('../lib/forecast/noaaSurge');

test('parseNoaaSurgeTable correctly parses NOAA ETSurge text lines', () => {
  const sampleTable = `
#Wrightsville Beach, NC : 10/27/2026 11:22:39 GMT (units in feet MLLW)
#Date(GMT), Surge,   Tide,    Obs,   Fcst,   Anom, Comment
#------------------------------------------------------------
10/25 12Z,   1.20,   4.87,   6.42,  99.90,   0.35,  0.56 ft above HAT  (max)
10/25 13Z,   1.10,   4.03,   5.60,  99.90,   0.37,
10/30 15Z,   0.60,   5.14,  99.90,   6.13,   0.39,  0.27 ft above HAT  (max)
`;

  const points = parseNoaaSurgeTable(sampleTable, 2026);
  assert.equal(points.length, 3);

  // Line 1: 10/25 12Z
  assert.equal(points[0].t, '2026-10-25T12:00:00.000Z');
  assert.equal(points[0].surgeFt, 1.20);
  assert.equal(points[0].tideFt, 4.87);
  // Obs is 99.90, so totalFt should be tide + surge = 4.87 + 1.20 = 6.07
  assert.equal(points[0].totalFt, 6.07);
  assert.equal(points[0].anomalyFt, 0.35);

  // Line 2: 10/25 13Z
  assert.equal(points[1].t, '2026-10-25T13:00:00.000Z');
  assert.equal(points[1].surgeFt, 1.10);
  assert.equal(points[1].tideFt, 4.03);

  // Line 3: 10/30 15Z (explicit Fcst = 6.13)
  assert.equal(points[2].t, '2026-10-30T15:00:00.000Z');
  assert.equal(points[2].surgeFt, 0.60);
  assert.equal(points[2].tideFt, 5.14);
  assert.equal(points[2].totalFt, 6.13);
  assert.equal(points[2].anomalyFt, 0.39);
});

test('parseNoaaSurgeTable ignores invalid or comment lines cleanly', () => {
  const malformed = `
# Random header
Some invalid text without commas
10/25, missing, fields
10/25 12Z, not_a_number, 4.87, 6.42, 99.90, 0.35
`;

  const points = parseNoaaSurgeTable(malformed, 2026);
  assert.equal(points.length, 0);
});

test('parseNoaaSurgeTable rejects 99.90 missing value sentinel and out-of-range surge rows', () => {
  const sentinelTable = `
#Date(GMT), Surge,   Tide,    Obs,   Fcst,   Anom, Comment
11/02 23Z,   0.90,   1.38,  99.90,   2.53,   0.25,
11/03 00Z,   0.90,   0.70,  99.90,   1.85,   0.25,
11/03 01Z,  99.90,   0.39,  99.90,  99.90,   0.25,
11/03 02Z,  99.90,   0.59,  99.90,  99.90,   0.25,
11/03 03Z,   0.85,  99.90,  99.90,  99.90,   0.25,
11/03 04Z,   0.80,   2.24,  99.90,   3.04,   0.25,
`;

  const points = parseNoaaSurgeTable(sentinelTable, 2026);
  assert.equal(points.length, 3);
  assert.equal(points[0].surgeFt, 0.90);
  assert.equal(points[1].surgeFt, 0.90);
  assert.equal(points[2].surgeFt, 0.80);
  // Ensure none of the points contain 99.90 in surgeFt, tideFt, or totalFt
  for (const pt of points) {
    assert.ok(pt.surgeFt < 50, `Surge ${pt.surgeFt} should be < 50`);
    assert.ok(pt.tideFt < 50, `Tide ${pt.tideFt} should be < 50`);
    assert.ok(pt.totalFt < 50, `Total ${pt.totalFt} should be < 50`);
  }
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseVerificationArgs } = require('../lib/scripts/verify_forecasts');

test('verification CLI is read-only and requires an explicit existing project and valid UTC day', () => {
  assert.deepEqual(parseVerificationArgs(['--project', 'demo-floodcast', '--day', '2026-10-12'], {}), { projectId: 'demo-floodcast', day: '2026-10-12', outputPath: null });
  assert.equal(parseVerificationArgs(['--day', '2026-10-12', '--out', 'evaluation/report.json'], { GOOGLE_CLOUD_PROJECT: 'demo-floodcast' }).outputPath, 'evaluation/report.json');
  for (const args of [[], ['--day', '2026-10-12'], ['--project', 'demo-floodcast', '--day', '2026-10-12', '--apply'], ['--project', 'demo-floodcast', '--day', '2026-02-30'], ['--project', 'demo-floodcast', '--day', '2026-10-12', '--day', '2026-10-13']]) {
    assert.throws(() => parseVerificationArgs(args, {}));
  }
});

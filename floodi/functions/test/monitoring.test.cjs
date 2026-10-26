const { test } = require('node:test');
const assert = require('node:assert/strict');
const { configureMonitoring, monitoringDefinitions } = require('../lib/scripts/configure_monitoring');
test('dry-run monitoring never mutates cloud resources or invents recipients', async () => {
  const calls = [];
  const result = await configureMonitoring(async (url, method='GET') => { calls.push({url,method}); return {}; }, 'existing-project');
  assert.equal(result.applied, false);
  assert.equal(result.actions.length, 6);
  assert.ok(calls.every(call => call.method === 'GET'));
  assert.ok(monitoringDefinitions('existing-project').policies.every(policy => policy.notificationChannels.length === 0));
});
test('monitoring rerun updates matching policies and preserves their notification destinations', async () => {
  const policyName = 'projects/existing-project/alertPolicies/123';
  const existing = { alertPolicies: [{ name: policyName, displayName: 'FloodCast — frontend crash', notificationChannels: ['projects/existing-project/notificationChannels/1'] }] };
  const calls=[];
  await configureMonitoring(async (url,method='GET',body) => { calls.push({url,method,body}); return url.endsWith('/alertPolicies') && method==='GET' ? existing : {}; }, 'existing-project', true);
  const update=calls.find(call=>call.method==='PATCH' && call.url.includes('/alertPolicies/'));
  assert.ok(update);
  assert.deepEqual(update.body.notificationChannels, existing.alertPolicies[0].notificationChannels);
  assert.equal(calls.filter(call=>call.method==='POST' && call.url.endsWith('/alertPolicies')).length,4);
  assert.ok(calls.some(call=>call.method==='PATCH' && call.url.includes('provider_cache/fields/deleteAfter')));
});
test('invalid project/channel resources are rejected before planning unintended policies', () => {
  assert.throws(()=>monitoringDefinitions(''), /project/);
  assert.throws(()=>monitoringDefinitions('existing-project',['projects/other-project/notificationChannels/1']), /existing project/);
});

test('existing scheduled-job incident policy includes shadow evaluation and reconciliation failures', () => {
  const policy = monitoringDefinitions('existing-project').policies.find(value => value.displayName === 'FloodCast — data or scheduled job failure');
  const filter = policy.conditions[0].conditionMatchedLog.filter;
  assert.ok(filter.includes('jsonPayload.event="shadow_alert_failed"'));
  for (const event of ['citizen_alert_request_failed', 'citizen_alert_delivery_failed', 'citizen_alert_delivery_rejected', 'citizen_alert_fanout_failed']) assert.ok(filter.includes(`jsonPayload.event="${event}"`));
  assert.ok(filter.includes('jsonPayload.event="shadow_alert_reconcile_failed"'));
});

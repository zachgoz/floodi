/** Idempotent monitoring setup. Defaults to a read-only plan. Runtime/deployment
 * credentials remain server-side; this script never grants IAM or creates email
 * recipients. Pass existing channel resource names explicitly to attach them. */
import { GoogleAuth } from 'google-auth-library';

type CloudApi = (url: string, method?: string, body?: unknown) => Promise<any>;
const LOG_FILTER = 'resource.type="cloud_run_revision" labels."goog-managed-by"="cloudfunctions"';
export function monitoringDefinitions(project: string, notificationChannels: string[] = []) {
  const common = {
    enabled: true, combiner: 'OR', notificationChannels,
    userLabels: { app: 'floodcast', managed_by: 'floodcast' },
  };
  const logPolicy = (displayName: string, filter: string, text: string) => ({
    ...common, displayName,
    documentation: { mimeType: 'text/markdown', content: text },
    alertStrategy: { notificationRateLimit: { period: '3600s' }, autoClose: '3600s' },
    conditions: [{ displayName, conditionMatchedLog: { filter: `${LOG_FILTER} ${filter}` } }],
  });
  const metric = {
    name: 'floodcast_health_heartbeat',
    description: 'Independent data freshness inspection completed, regardless of health outcome.',
    filter: `${LOG_FILTER} jsonPayload.event="data_health"`,
    metricDescriptor: { metricKind: 'DELTA', valueType: 'INT64', unit: '1' },
  };
  const policies = [
    logPolicy('FloodCast — data or scheduled job failure', 'severity>=ERROR (jsonPayload.event="data_health" OR jsonPayload.event="data_health_check_failed" OR jsonPayload.event="job_outcome" OR jsonPayload.event="health_write_failed" OR jsonPayload.event="forecast_generation_failed")', 'Inspect staleSources, source counts and operationalHealth documents. Gauge/NOAA should update within 60 minutes, outlook within 30 minutes, model/prediction jobs within 36 hours. Preserve partial data; never disable freshness gates to silence an alert.'),
    logPolicy('FloodCast — frontend crash', 'severity>=ERROR jsonPayload.event="frontend_error"', 'A sanitized frontend runtime, promise or React render failure was collected. Match client.buildId and asset/line/column with the private source-map archive. No comments or account details are collected in application error payloads.'),
    logPolicy('FloodCast — Gemini explanation fallback', 'jsonPayload.event="gemini_explanation_failed"', 'Numerical forecasting continues separately. Inspect the safe HTTP/API code and runtime Vertex project/identity. Do not assume invalid credentials from a generic fallback, or upload service-account keys.'),
    logPolicy('FloodCast — upstream or partial update', '(jsonPayload.event="provider_request_failed" OR jsonPayload.event="fiman_proxy_failed" OR (jsonPayload.event="job_outcome" AND jsonPayload.status="partial"))', 'Inspect provider/status and per-source freshness. Cache and honor rate-limit cooldowns; independent gauge writes must continue when weather is unavailable.'),
    {
      ...common, displayName: 'FloodCast — health monitor missing',
      documentation: { mimeType: 'text/markdown', content: 'The independent freshness-check heartbeat has been absent for 30 minutes. Verify checkDataHealth Cloud Scheduler is enabled and its authenticated invocation succeeds. Metric absence requires an established time series and can take several minutes to evaluate.' },
      alertStrategy: { autoClose: '3600s' },
      conditions: [{ displayName: 'No freshness heartbeat for 30 minutes', conditionAbsent: {
        filter: `resource.type="cloud_run_revision" metric.type="logging.googleapis.com/user/${metric.name}" resource.labels.service_name="checkdatahealth"`,
        duration: '1800s', trigger: { count: 1 },
        aggregations: [{ alignmentPeriod: '600s', perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_SUM' }],
      } }, { displayName: 'Zero freshness checks over 30 minutes', conditionThreshold: {
        filter: `resource.type="cloud_run_revision" metric.type="logging.googleapis.com/user/${metric.name}" resource.labels.service_name="checkdatahealth"`,
        comparison: 'COMPARISON_LT', thresholdValue: 1, duration: '60s', trigger: { count: 1 },
        aggregations: [{ alignmentPeriod: '1800s', perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_SUM' }],
      } }],
    },
  ];
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project)) throw new Error('Explicit existing project ID required');
  if (notificationChannels.some(name => !name.startsWith(`projects/${project}/notificationChannels/`))) throw new Error('Only explicit channels from the existing project are accepted');
  return { metric, policies };
}

export async function configureMonitoring(api: CloudApi, project: string, apply = false, notificationChannels?: string[]) {
  const existing = await api(`https://monitoring.googleapis.com/v3/projects/${project}/alertPolicies`);
  const channels = await api(`https://monitoring.googleapis.com/v3/projects/${project}/notificationChannels`);
  const metrics = await api(`https://logging.googleapis.com/v2/projects/${project}/metrics`);
  const definitions = monitoringDefinitions(project, notificationChannels);
  const actions: { resource: string; action: string }[] = [];
  const savedMetric = (metrics.metrics || []).find((item: any) => item.name === definitions.metric.name);
  actions.push({ resource: definitions.metric.name, action: savedMetric ? 'update' : 'create' });
  if (apply) await api(`https://logging.googleapis.com/v2/projects/${project}/metrics${savedMetric ? `/${definitions.metric.name}` : ''}`, savedMetric ? 'PUT' : 'POST', definitions.metric);
  for (const policy of definitions.policies) {
    const saved = (existing.alertPolicies || []).find((item: any) => item.displayName === policy.displayName);
    // Preserve notification preferences on rerun unless explicitly overridden.
    const body = { ...policy, notificationChannels: notificationChannels ?? saved?.notificationChannels ?? [], ...(saved ? { name: saved.name } : {}) };
    actions.push({ resource: policy.displayName, action: saved ? 'update' : 'create' });
    if (apply) await api(saved
      ? `https://monitoring.googleapis.com/v3/${saved.name}?updateMask=displayName,documentation,conditions,combiner,enabled,notificationChannels,alertStrategy,userLabels`
      : `https://monitoring.googleapis.com/v3/projects/${project}/alertPolicies`, saved ? 'PATCH' : 'POST', body);
  }
  // Cache expiry is an actual Firestore timestamp. TTL prevents unique provider
  // request ranges from accumulating private cache documents indefinitely.
  const ttlUrl = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/collectionGroups/provider_cache/fields/deleteAfter`;
  if (apply) await api(`${ttlUrl}?updateMask=ttlConfig`, 'PATCH', { name: `projects/${project}/databases/(default)/collectionGroups/provider_cache/fields/deleteAfter`, ttlConfig: {} });
  return { project, applied: apply, actions, providerCacheTtl: apply ? 'requested' : 'planned', notificationChannels: notificationChannels ?? 'preserve existing; none added', availableChannels: (channels.notificationChannels || []).map((item: any) => ({ name: item.name, type: item.type, displayName: item.displayName, enabled: item.enabled })) };
}

if (require.main === module) {
  const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  if (!project) throw new Error('Set the existing GCLOUD_PROJECT explicitly');
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const api: CloudApi = async (url, method = 'GET', body) => {
    const client = await auth.getClient();
    return (await client.request({ url, method: method as 'GET' | 'POST' | 'PATCH' | 'PUT', data: body, timeout: 45000 })).data;
  };
  configureMonitoring(api, project, process.argv.includes('--apply')).then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(`Monitoring setup failed: ${error?.response?.status || error?.code || 'request error'}`); process.exitCode = 1; });
}

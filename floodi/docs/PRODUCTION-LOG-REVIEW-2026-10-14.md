# Production log and monitoring review — October 14, 2026

Read-only production review, completed at approximately 9:00 AM EDT. Application and cloud configuration were not changed. This report is the only repository addition from the review.

## Scope and evidence

- Read actual Google Cloud Logging records for all eight deployed Functions in `floodcastwebapp` from September 14, 00:00 UTC through October 14, approximately 13:00 UTC. Paginated both date ranges to completion: 853 matching records before October 7 and 667 afterward, or 1,520 total matching records.
- Searched warning/error severities, error/failure/timeout/fallback text and HTTP statuses >=400. Application `console.error` and `console.warn` entries are often severity `DEFAULT`, so severity-only searches would miss them.
- Independently inspected raw Cloud Run HTTP failure records, Cloud Scheduler failure records, deployed function metadata, live Scheduler state, Monitoring alert policies, logging metrics, current observation buckets and the current outlook document.
- Reviewed frontend/backend source for monitoring coverage and failure handling. Read the existing production dashboard's captured browser errors/warnings without reloading or submitting anything: none were present in that session.
- Counts below are log entries, not unique outages, users or failed invocations. One invocation can produce multiple entries. These logs cannot reveal failures whose exceptions are swallowed without logging.

## Confirmed production failures

| Category | Records in reviewed period | Latest occurrence, EDT | Assessment |
| --- | ---: | --- | --- |
| Observation document exceeds 1,048,576-byte limit | 575 | Oct 1, 7:53 PM | September bucket caused repeated rejected writes. Monthly storage still has the same capacity ceiling. |
| Undefined weather values rejected by Firestore | 662, including 2 backfill records | Oct 14, 8:14 AM | Today's deployed sanitizer/ETL repair addresses this. No recurrence in the post-deployment review. |
| Expired Firestore transactions | 18 | Oct 11, 7:44 PM | Today's sync/backfill write path removes those transactions. |
| Open-Meteo HTTP 429 / Too Many Requests | 180 | Oct 11, 7:54 PM | Need shared request caching, retry/backoff and source-level health reporting; source isolation now protects independent water-level writes. |
| Open-Meteo Service Unavailable | 14 | Oct 13, 7:54 AM | Provider outages; same resilience improvements apply. |
| NWS observation Internal Server Error | 13 | Oct 13, 12:54 AM | Provider outages. Source isolation now allows NOAA/FiMAN writes to continue. |
| NOAA Gateway Timeout | 4 | Oct 10, 2:34 AM | Provider outages. Bound retries and source health are appropriate. |
| Open-Meteo fetch / invalid JSON response | 5 | Sep 30, 2:42 PM | Historical provider transport/response failures. |
| Gemini unavailable; calculated explanation fallback | 33 | Oct 14, 8:11 AM | Ongoing explanation issue. Catch block drops the underlying cause, so these records do not establish whether this is permission, model availability, response validation or another error. |
| Unauthenticated requests to private scheduled functions | 12 | Oct 11, 9:19 PM | Four each for syncWaterLevels, syncImagery and syncPredictions, clustered in the deployment window. Later authenticated scheduled invocations succeed; no evidence of an ongoing scheduler authentication failure. Keep these functions private. |
| HTTP 404 requests | 4 | Oct 11, 9:20 PM | Two each for FiMAN proxy and backfill, clustered in the same deployment window. No post-repair recurrence seen. |

## Current production state

- No matching application warning/error or HTTP >=400 records after the repaired Functions became active around 8:22 AM through the approximately 9:00 AM review cutoff. This is a short observation window, not a guarantee against future outages.
- Five normal observed-sync completions were inspected after deployment, including the manual recovery verification. The latest completed at 8:54 AM.
- All five Scheduler jobs are enabled. Latest attempt statuses returned no errors. There were no matching Scheduler failure records in the seven-day Scheduler query. This does not establish ingestion health because some handlers catch failures and return successfully.
- Numerical outlook is `available`, generated at 8:51 AM with the 8:36 AM gauge observation. `explanationSource` is `fallback`, so the displayed explanation is calculated text rather than Gemini output.
- Monitoring API returned **zero alert policies** and Logging API returned **zero user-defined log-based metrics** in this project. This does not assert the absence of every possible external/manual notification system.

### Document capacity

Measured the current documents with the published [Firestore size calculation](https://firebase.google.com/docs/firestore/storage-size), using field names/values and document overhead rather than REST JSON byte length:

| Observation bucket | Calculated bytes | Percentage of 1 MiB ceiling | Last document update |
| --- | ---: | ---: | --- |
| September | 727,157 | 69.3% | Oct 11, 9:20 PM EDT |
| October | 551,022 | 52.5% | Oct 14, 8:54 AM EDT |

The September document is below its limit now; historical rejected writes attempted larger payloads. The review did not reconstruct which earlier rewrite reduced its size. October continues accumulating weather, measurements and imagery in one document. Atomic merges do not eliminate the document limit. Move to bounded daily/source partitions with backward-compatible reads and a preservation-first migration, rather than trimming measurement history.

October's observations bucket also retains weather timestamps through October 18, beyond the review time. The current ETL excludes new future observations, but old records remain. Audit their provenance and migrate/quarantine future-dated model fields before treating that bucket as a pure historical observation dataset. The current forecast model's training path fetches separate Open-Meteo history, so this review does not establish training leakage from that bucket.

## Remaining code-confirmed risks

These are verified code paths, not additional incidents proven by the reviewed logs.

1. **Imagery can block measurement ingestion.** `functions/src/syncData.ts:56-94` downloads camera images before saving gauge/NOAA buckets. `functions/src/utils/storage.ts:20` has no fetch timeout. Persist measurements first, then process bounded imagery work independently. The public proxy also has an unbounded upstream fetch at `functions/src/index.ts:39`.
2. **Failure can look like scheduled success.** `syncData.ts:123-125` and `172-174` catch fatal write failures and return normally. All sources failing can still reach the completion message. `backfill.ts:126-135` also reports HTTP success after chunk failures. Preserve partial writes, but record per-source counts/outcomes and fail/report failure honestly when no useful update succeeds.
3. **Explanation errors lose their cause.** `forecast/jobs.ts:151-159` discards Gemini and scheduling exceptions. Weather acquisition at line 95 and numerical construction at line 159 also suppress the original cause. Use structured severity and safe stage/provider/status/error-code fields, without credentials or full request payloads. A generic Gemini warning does not prove a Vertex 403.
4. **Concurrent imagery changes can be lost.** `syncImagery.ts:35-66` reads then replaces a whole monthly imagery map. Merge only changed leaves. Recurring sync also replaces peak/event documents at `syncData.ts:101,115`, potentially discarding attached metadata; align with backfill's preservation behavior.
5. **Malformed imagery can reject good gauge measurements.** `etl/fiman.ts:47-56` assumes camera arrays/strings and calls `toISOString()` without timestamp validation. Skip invalid camera records without rejecting successfully parsed water levels.

## Frontend logging coverage

We have browser-local diagnostics and usage analytics, **not centralized frontend error history**.

| Facility | Current behavior |
| --- | --- |
| Console logging | Data/auth/comment failures are generally logged locally; not forwarded to a server. |
| Performance diagnostics | Opt-in `perfLogger.ts` console/sessionStorage events, capped at 300; accessible through `window.floodiPerf.dump()` when enabled. No remote transport. |
| Firebase Analytics | Usage events such as screens, camera changes, simulation and comments. No configured exception reporting. See `src/lib/firebase.ts:84-95` and `src/lib/analytics.ts`. |
| React crash recovery | No root error boundary or root error callbacks at `src/main.tsx:45-56`. |
| Global JavaScript failures | No configured global error/unhandled-rejection collector. No Sentry/Crashlytics or equivalent dependency/integration found. |
| Handled data degradation | `src/components/dashboard/useFloodOutlook.ts:35-51` silently falls back on failed HTTP/Firestore reads. Other data services mainly log locally and return empty/null fallbacks. |

The current production tab had no captured errors/warnings at inspection. That establishes only the inspected session's captured state. Backend request logs can show failed API requests; they cannot reconstruct historical render errors or exceptions that only occurred in residents' browsers.

Before central collection, remove/redact `src/lib/commentService.ts:98`, which logs full comment payload and auth context locally. Do not implement blanket console upload. Collect an allowlist of build version, route without sensitive query values, error category/stack, provider/status, freshness and safe data-quality metadata. Exclude comments, user identifiers, credentials and complete forecast/input payloads. Add deduplication, rate limits and private source maps.

## Recommended order

1. Add source-level freshness/outcome reporting and structured logging; preserve diagnostic causes for Gemini and numerical updates. Establish alerts for overdue gauge/forecast/model updates.
2. Partition monthly observation storage before the size-limit failure recurs, preserving archived readings and compatible reads.
3. Decouple imagery from gauge writes, validate camera records, bound fetches and replace whole-map/document rewrites with preservation-safe merges.
4. Add centralized frontend exception and handled-degradation reporting plus a React error boundary, with redaction and collection limits.
5. Add shared provider caching and bounded backoff for transient weather/NOAA errors; investigate the actual Gemini cause once it is retained.

No implementation, deployment, data mutation or test run was performed as part of this review.

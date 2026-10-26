# Accuracy scoring and shadow alert foundation

Implemented October 17, 2026. This is the backend foundation for steps 2 and 3 of the [commercialization plan](ALERTING-AND-COMMERCIALIZATION-PLAN-2026-10-17.md). It is not an active citizen notification service. Deployment, real archive scoring and recipient delivery are separate verification steps.

## Numerical publication

`forecast/publication.ts` atomically creates the immutable numerical archive and private publication marker while updating the public current forecast. The marker records the reference version, actual model/input paths, runtime revision and a server-assigned publication timestamp. Consumers conservatively use the later of that timestamp and marker creation metadata as availability. `generatedAt` alone does not establish when a forecast was available.

Optional Gemini explanation runs after numerical publication. An explanation is stored against its issue and can patch only the explanation fields of the matching current issue. It cannot rewrite archived numbers, refresh expiry or replace a newer forecast. An upstream failure preserves an existing valid forecast until its original expiry; the transaction rechecks that protection against concurrent updates.

## Prospective scoring

`verification/scorer.ts` evaluates frozen as-issued outputs; it never retrains or fetches later weather to regenerate an old forecast. `verification/repository.ts` offers a bounded read-only loader, and `verifyPublishedForecasts` evaluates two recently matured UTC days daily at 06:40 UTC. The full 72-hour cohort matures with six additional hours for observation ingestion. Recent day records can be recomputed after late data corrections without accumulating duplicate counts.

- Twenty-four hourly UTC origins select the last actually published issue, including unavailable/expired issues as service failures rather than silently falling back to an older issue.
- Targets are origin plus 1, 3, 6, 12, 24, 48 and 72 hours; each row also retains its exact publication-to-target lead and observation age. Unsupported targets stay excluded with explicit reasons.
- Comparisons use the served total, archived astronomical tide, and persistence of the residual known at issue time. Baseline comparison errors use common supported samples. No new tide/weather fetch supplies historical predictors.
- Observations require finite native gauge samples, compatible configured references and interpolation brackets no more than 30 minutes plus ten seconds apart. No extrapolation or bridging a missing observation. Truth reflects the configured ingestion reference; the stored gauge maps do not independently prove every historic datum conversion.
- A native observed-event ledger retains onset/end sample brackets and clipped boundaries. Crossing times are interpolated estimates at native sampling resolution, not observed minute-level certainty.
- Maximum-cardinality interval-overlap matching prevents nearby but disjoint tide peaks being counted as a detected event. Ongoing flooding is separated from a new onset. Incomplete events receive no invented onset/duration error.
- Hourly event windows are dependent diagnostics. The fixed midnight day-start cohort and unique ledger IDs are reported separately; one flood in many forecasts is not many independent floods. This day-start cohort is a fixed-lead forecast test, not an actual alert-delivery score.
- Outputs include peak/onset/duration errors, misses, unmatched predicted events, dry windows, exclusions, paired baseline metrics and data coverage. They deliberately make no readiness claim, probability calibration claim or customer accuracy percentage.

New atomic publications carry a version derived from gauge, datum, conversion offset, tide station, phase and threshold. Older archives use their creation time as a conservatively labelled availability bound. Calibration/model changes must remain visible in reports; old archives must not be regenerated with current inputs.

Private daily records: `forecast_verification/{locationId}/versions/prospective-v1/references/{referenceVersion}/days/{YYYY-MM-DD}`. Each report includes input provenance/hash and evaluation policy. Physical-reference cohorts have separate paths, so a changed datum/offset/phase/threshold cannot overwrite earlier calibration evidence. These are recomputable reports, not immutable regulatory audit records; a later correction updates the day.

## Shared alert engine in shadow mode

`evaluateShadowFloodAlerts` consumes committed publication markers. `reconcileShadowFloodAlerts` runs every ten minutes to repair a missed latest trigger and check freshness even when forecast generation stops. The pure engine and transaction adapter record stable episodes, meaningful revisions, split/merge lineage and simulated notification intents atomically.

The initial policy is **Carolina Beach gauge threshold only**. No street-depth calibration, municipal authority or subscriber entitlement is implied. It reuses the existing 5.6 ft MLLW threshold and freshness contracts. Preview settings of 15-minute timing change, 0.1 ft peak change and 60-minute identity tolerance are versioned rehearsal settings, not established paid-alert release criteria.

The rehearsal evaluates at most the model's near-term prefix: six hours from the observation origin for residual response and 24 hours for weather response. The dashboard's full forecast horizon is unchanged. Longer-range notifications require separately agreed policies and accuracy evidence; recording a forecast does not automatically authorize operational alerts at every lead.

Duplicate and older issues cannot create duplicate decisions or roll state backward. Small changes accumulate against the last meaningful revision. Merely passing an unchanged forecast peak does not generate another forecast-change notice. Original predicted onset and elapsed predicted peak retain issue provenance; neither becomes an observed impact claim.

Unavailable, incompatible, stale or gapped evidence remains unresolved. A revised-lower forecast and an elapsed predicted window cannot establish that streets are dry or a road has reopened. Original simulated intents expire; unchanged valid issues preserve intent identity, and meaningful replacements supersede it.

Private paths:

- `forecast_publications/{locationId}/issues/{issueId}`
- `forecast_explanations/{locationId}/issues/{issueId}`
- `shadow_alert_states/{policyId}` and its `episodes`, `revisions`, `decisions` subcollections
- `shadow_alert_outbox/{intentId}`

Outbox records explicitly retain `mode: shadow`, zero recipients, `delivery: not-attempted`, and simulated/expired/superseded status. **There is no email, push, SMS, provider adapter or Cloud Tasks delivery worker in this release.** No PII or alert state is written below public `locations/*`. Existing rules deny client access, including clients whose profile role is administrator; emulator tests cover read/query/create/update/delete boundaries.

## Run and inspect

From `floodi/functions/`:

```sh
npm test
npm run test:integration
npm run verify:forecasts -- --project EXISTING_PROJECT --day 2026-10-12 --out evaluation/verification-2026-10-12.json
```

The last command is read-only and uses ADC. It only reads the requested location's bounded archive/observation range and optionally saves a local JSON report. No apply/send switch exists. Keep credentials outside version control; set `GOOGLE_APPLICATION_CREDENTIALS` locally only when that account has the required project access. Runtime workload identity remains preferable. Never grant permissions merely to make a local audit pass without reviewing the identity and intended access.

Integration uses an isolated `demo-floodcast-rules` Firestore emulator, never production. It requires Java 21+ available on PATH. The test covers atomic rollback, real server timestamp resolution, immutable numerical history, and private collection access. Standard Node tests skip emulator-only suites when no emulator is running.

Logs use `shadow_alert_evaluated`, `shadow_alert_reconciled`, `shadow_alert_failed`, `shadow_alert_reconcile_failed`, and the existing `job_outcome` event for `verifyPublishedForecasts`. Check actual completed day/target counts and exclusions, not just a successful invocation. The scorer reports partial health if matured days have no served samples or reads were truncated. The existing scheduled-job failure incident definition also includes shadow evaluation and reconciliation errors; apply the updated monitoring definition alongside the backend rollout.

## Remaining before a paid pilot

Continue accumulating prospective forecast and shadow-decision evidence; select/review watched-place impact thresholds; agree acceptable misses, false alerts, lead times and update frequency; add verified channel consent and billing/municipal entitlements; then implement private queued delivery with expiry, retries, reconciliation and authenticated provider receipts. Shadow intent time is not delivery time and must not be sold as delivered advance notice. Test real delivery only to explicitly consenting recipients.

## Verification on October 17, 2026

- Backend: 163 Node tests passed. The dedicated prospective-scoring fixtures, shadow engine, handler wiring and transaction retry/rollback tests are included.
- App: 659 tests across 60 files passed with isolated Vitest workers. The single-process/no-thread mode produced shared-DOM cleanup failures; isolated workers passed without product changes.
- Real local Firestore emulator: 17 integration/security tests passed, including anonymous/resident/client-admin denial across the private collections.
- App and Functions production builds passed. ESLint reported zero errors and 201 warnings across the existing project. The app build still reports large JavaScript chunks; this backend work does not resolve that separate performance item.
- Before rollout, the local service account and ADC each received Firestore `PERMISSION_DENIED`. After the user explicitly authorized the Firebase CLI credential source, a read-only archive audit succeeded; the approved production rollout is recorded below. See the [initial real-data accuracy report](FORECAST-ACCURACY-AUDIT-2026-10-17.md) for paired errors, exclusions, false predictions and limitations.

Neither synthetic fixtures nor successful pipeline execution demonstrate forecasting skill. The small real-data audit is initial evidence; it does not establish event reliability or readiness for paid alerts.

## Deployment review and rollout

The predeployment review verified real forecast issue-time anchoring and rehearsed the live public forecast at issue+10 seconds, +2 minutes and +20 minutes: all had usable, bracketed forecast coverage. A regression test covers an exact millisecond issue point followed by NOAA six-minute ticks. An additional real-emulator integration processes a committed numerical forecast through episode/decision/outbox persistence, verifies zero recipients and no attempted delivery, and confirms duplicate replay is a no-op.

Read-only platform checks found Eventarc, Pub/Sub, Firestore and Cloud Scheduler APIs enabled. The existing production runtime identity is distinct from the local JSON key and already has project access. Event delivery and new scheduled-job output must still be confirmed after deployment; enabled APIs alone do not prove a trigger ran.

The approved rollout was backend only: `generateFloodOutlook`, `evaluateShadowFloodAlerts`, `reconcileShadowFloodAlerts`, and `verifyPublishedForecasts`, with only the existing scheduled-job failure monitoring policy updated while preserving its notification channel. No Hosting, schema migration, client permission or public alert-delivery change is required. The checked-in Codemagic web workflow deploys Hosting only and therefore does not release these backend functions.

After rollout, verify the first new publication has current/archive/marker agreement, an actual trigger invocation creates private shadow state, the reconciler executes, and the daily scorer writes the correct reference cohort with nonzero/explicitly excluded evidence. Check that the public outlook remains available and numerical archive values remain unchanged when Gemini finishes. Keep the existing forecast version as the rollback source; never delete historical input/archive collections.

The October 12 observation spikes, conversion-equality artifact and small event-validation sample remain paid-alert release concerns. They do not prevent private scoring and shadow decisions from accumulating honest evidence. No operational release thresholds, gauge calibration or numerical forecast formula were changed in this review.

## Production rollout verified October 17, 2026

All four functions are active in `floodcastwebapp`, with the existing runtime identity and Vertex project configuration preserved:

- `generateFloodOutlook`: `generatefloodoutlook-00006-bij`.
- `evaluateShadowFloodAlerts`: `evaluateshadowfloodalerts-00001-nub`.
- `reconcileShadowFloodAlerts`: `reconcileshadowfloodalerts-00001-sin`.
- `verifyPublishedForecasts`: `verifypublishedforecasts-00001-vir`.

The first Eventarc creation attempt failed during Google's initial service-agent permission propagation. The correct managed-service-agent binding was already present; retrying only the trigger succeeded. No extra IAM grant was made manually. All three Scheduler jobs are enabled and use OIDC service-account invocation. None of the four services has a public-access IAM binding.

The normal production publisher generated issue `2026-10-17T20:35:17.014Z`. Its reference, archived input/model pointers and numerical archive matched the current forecast. The real Firestore event handler logged `shadow_alert_evaluated` with result `applied`, writing usable private shadow state for that issue. A subsequent Scheduler invocation logged `shadow_alert_reconciled` with result `duplicate`, proving replay did not create another decision. There were zero flood episodes within the shadow horizon and zero outbox documents; no production flood or notification was fabricated for testing.

A fresh public `/api/outlook` request returned HTTP 200, available, and the same issue. The normal URL briefly retained its previous still-valid issue under the existing five-minute CDN cache. The numerical archive hash and update time remained unchanged across verification reads. The issue reused an existing valid Gemini evidence selection under the hourly cadence; a new Gemini request and late explanation patch were not observed during this rollout. Their transaction behavior is covered by the emulator tests.

The scorer completed UTC origin days October 12 and 13, with no truncated reads. October 13 produced **154 served forecast-to-observation target comparisons**, plus matched tide-only and persistence rows (462 scored method-target rows in total). October 12 produced zero served pairs because its selected historical issues were unavailable or absent. The job therefore correctly reported `partial`; this is historical coverage evidence, not an execution failure. Repeated targets, noisy observed-event ledgers and the known October 12 sensor artifacts do not establish independent validated flood events.

The post-rollout log check included all severities for these four services and completed without pagination. Publisher execution was `ok`, trigger processing and reconciliation succeeded, and no runtime errors or failed HTTP requests were observed. The scorer's historical-coverage warning was retained. The existing scheduled-job failure policy now includes both shadow failure events; its original email notification channel and unrelated policy settings were preserved.

Local, ignored release evidence is in `functions/evaluation/release-2026-10-17/`, including function revisions, invocation security, monitoring before/after, publication/archive checks and job outcomes. This release collects private accuracy and shadow-alert evidence. Citizen delivery, subscription billing, calibrated street impacts and operational alert acceptance criteria remain future work.

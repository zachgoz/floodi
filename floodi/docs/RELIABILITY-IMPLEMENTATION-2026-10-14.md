# Reliability implementation — October 14, 2026

Implements the findings in [the production log review](PRODUCTION-LOG-REVIEW-2026-10-14.md). The numerical forecasting methods, datums, thresholds and chart behavior are preserved.

## Changes

- **Bounded storage:** daily UTC observation documents with compatible legacy monthly reads; atomic leaf merges; verified, idempotent missing-leaf migration; original monthly documents retained. Raw forecast-contaminated legacy weather is preserved but excluded from observation merges. Archived image references have a separate overlay that cannot be replaced by refreshed source URLs. See [daily storage](DAILY-OBSERVATION-STORAGE.md).
- **Ingestion isolation:** gauge/NOAA observations commit before camera work. Camera downloads/storage operations have deadlines and response limits, and malformed imagery is skipped independently. Image work has count/time budgets; derived event/image updates preserve metadata. Source failures preserve other useful data, while empty/failed ingestion produces honest scheduled failures and per-source health.
- **Provider resilience:** shared server-only caching, bounded transient retries and rate-limit cooldowns that preserve the longest provider limit across concurrent responses. NOAA astronomical requests share an aligned date envelope. Cache documents expire through the `provider_cache.deleteAfter` TTL policy.
- **Monitoring:** structured logs record safe provider/status/failure-stage information. Private `operationalHealth` documents track outcomes and each source's last successful fetch. Independent `checkDataHealth` inspects actual gauge/NOAA samples, current outlook, model age and NOAA prediction-job freshness. It does not rely on successful Scheduler status.
- **Frontend diagnostics:** global JavaScript/promise errors, a React error boundary and handled forecast/water/comment degradation feed a strict same-origin/native endpoint. Allowlisted fields, bounded safe stack locations, session deduplication, server quotas and no arbitrary error messages/user content. See [collection/privacy details](FRONTEND-ERROR-COLLECTION.md).
- **Build diagnostics:** deterministic build ID includes app and shared backend source inputs. Hidden source maps are moved to ignored `.private-source-maps/<buildId>/` outside Hosting's public directory.
- **Administrative recovery:** backfill is private, POST-only and limited to one concurrent invocation. Its response distinguishes successful, partial and failed recovery.

## Gemini findings and repair

The existing local service account successfully invokes `gemini-3.8-flash` in the configured Vertex project. A real request exposed truncated JSON with the former 400-token output limit; a tested `LOW` thinking level and 2,048-token bound returned valid schema-constrained evidence IDs. The API rejected `MINIMAL` for this configured model, so that setting is not used. Truncation/validation failures now retain safe diagnostic reasons and token counts, without logging model response text.

The existing Firebase runtime identity had no direct role in the configured Vertex project. A custom project role, `floodcastGeminiPredictor`, was created with **only `aiplatform.endpoints.predict`** and bound to that existing runtime. The grant was read back and verified. No private-key file is deployed, and production continues using ADC. Scheduled production invocation through runtime ADC was verified after release: the October 14, 19:41 UTC issue returned a valid `gemini-3.8-flash` explanation. Subsequent scheduled issues continued successfully. Numerical inference remains independent of explanation generation.

## Monitoring setup

Five enabled Cloud Monitoring policies cover data/job failure, frontend crashes, Gemini fallback, provider/partial updates, and a missing/zero freshness-check heartbeat. They route to the explicitly authorized operational email channel. The log-based counter is `floodcast_health_heartbeat`. Setup is idempotent and preserves existing channels unless an explicit override is supplied.

`functions/src/scripts/configure_monitoring.ts` exports `configureMonitoring(api, project, apply, notificationChannels)` for authenticated operators. Its CLI uses server ADC and the explicit existing `GCLOUD_PROJECT`; it defaults to a read-only plan. An apply never grants IAM and does not invent notification recipients. Provider cache TTL creation is included. All five enabled policies and the heartbeat were read back after deployment. Their notification channel is `floodcastapp@gmail.com`, as explicitly authorized. Email inbox delivery has not been independently verified.

Useful Cloud Logging filters (select the existing Firebase project):

```text
jsonPayload.event="frontend_error"
jsonPayload.event="data_health"
jsonPayload.event="job_outcome"
jsonPayload.event="gemini_explanation_failed"
```

## Verification before release

- 618 app tests passed, including shared chart behavior and new diagnostics/data readers.
- 95 Node backend tests passed, including real handler mocks, daily/legacy merges, migration idempotency, image preservation, provider cooldown/retry, quotas, structured errors and independent health.
- 12 isolated Firestore emulator security-rule tests passed. A temporary official Temurin 21 runtime under `/tmp` supplied Java; no system Java installation was changed.
- App and Functions production builds passed. ESLint: zero errors, 203 warnings. Diff whitespace checks passed.
- Built assets contained zero private-key payloads and zero public source maps. Private maps are available under the matching build ID; the final deployed build identifier is `ac6fc8e97a9b081c` (`/assets/index-a34D-Voj.js`).
- Real local Vertex schema verification passed after correcting generation settings.
- Production migration dry-run: 17 monthly documents, June 2025–October 2026; 485 days to copy; 189 rejected future/invalid/provenance-incompatible records retained in original archives; zero writes.

## Production release verification

The user explicitly approved Functions, Hosting, Firestore rules/indexes and the non-destructive archive copy. Deployment to the existing `floodcastwebapp` project succeeded. Ten Functions are deployed, including `collectClientErrors` and `checkDataHealth`. Existing remote indexes outside this change were retained.

- **Archive copy:** all 485 days across 17 monthly archives (June 2025–October 2026) were copied and verified. Original monthly documents were retained and checked. The repeat dry-run examined 485 days and found **zero remaining missing leaves**. The 189 rejected future/invalid/provenance-incompatible records remain in the untouched monthly originals.
- **Ingestion:** normal observation and prediction jobs completed successfully. Daily records and per-source success stamps advance. The 19:44 UTC prediction issue wrote 3,600 NOAA samples and 156 weather records. The 01:11 UTC observation issue on October 15 (9:11 PM EDT October 14) wrote 314 water measurements, with gauge, NOAA and weather sources successful.
- **Independent health:** checks continued on schedule; the 01:21:57 UTC October 15 post-deployment check reported all five sources fresh, with no stale sources. No backend ERROR entries were found in the post-fix review from 19:42 UTC through the 01:22 UTC follow-up review.
- **Provider cache:** the first production verification found Firestore cannot encode nested GeoJSON arrays directly. Provider payloads now use validated opaque JSON strings, with legacy cache reads retained. Functions were redeployed and the subsequent prediction run succeeded without further cache-serialization warnings. Open-Meteo returned temporary HTTP 429 responses later that evening; independent NWS observations continued and weather retrieval subsequently recovered. Rate limits remain a provider availability constraint, rather than a reason to relabel cached data as fresh.
- **Daily model refresh:** the normal scheduled run completed successfully at 01:22 UTC October 15 using 7,368 historical residual samples and a new valid model cache. This confirms operation of the existing training pipeline; it is not a new scientific accuracy evaluation.
- **Vertex:** a scheduled production explanation succeeded through workload ADC and the minimal existing-project invocation role. No service-account private key was deployed.
- **Collector:** an allowlisted `monitoring_probe` returned 204 and produced a structured INFO record. Invalid origin/payload requests were rejected. Actual browser degradation reports were also observed, confirming frontend hooks reach production logs. The final build `ac6fc8e97a9b081c` produced its matching INFO probe in Cloud Logging after rollout. Anonymous backfill invocation and private quota-document reads returned 403.
- **Frontend follow-up:** private source maps identified a blocked optional Firebase Analytics configuration request. The app now passes the existing public measurement ID when configured and skips unsupported/offline/unconfigured Analytics. An installed-SDK test verifies blocked-fetch fallback without an unhandled rejection. Firestore's existing transport auto-detection is preserved.
- **Browser checks:** the production dashboard rendered at the in-app browser's actual 466 px width without horizontal overflow, and both chart domains remained identical after shared zoom/time-window actions. This browser ignored requested 390 px and 1,280 px viewport overrides, so those exact responsive widths were not independently reverified during this release. Browser sessions showed transient Firestore WebChannel transport warnings; the final reload recovered and rendered current surge/outlook data. Direct public daily-document reads also succeeded, and the final build produced no Analytics unhandled-rejection report during that check. No persistent transport regression was established.

The final Functions/Hosting follow-up deployment also succeeded. The follow-up adds 11 Analytics initialization tests, including blocked-request behavior in the installed SDK, plus the concurrent cooldown regression. Final totals are **618 app tests, 95 backend tests and 12 Firestore rules tests**, all passing. Configuration does not by itself prove alert-email delivery, and the collector intentionally samples/deduplicates errors rather than collecting every console message.

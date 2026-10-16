# Dashboard startup and selected forecast explanations

Deployed to the existing `floodcastwebapp` Functions and Hosting project on October 16, 2026. No credentials, IAM, minimum-instance settings, flood thresholds or numerical model selection gates changed.

## Delivered behavior

- Returning visitors reach the public dashboard without waiting for account/profile operations. Protected routes keep their guards.
- The requested chart viewport and residual-alignment context load first. The existing ±14-day pan buffer and historical comparison events warm afterward; request revisions prevent stale work overwriting refreshes/settings. Actual loaded coverage drives subsequent pan fetches.
- The map and Google Maps provider are separate lazy chunks. Map visibility gates both those libraries and the road dataset. Its URL is stable per build instead of using a new timestamp on every visit.
- Production startup telemetry samples 25% of navigations with a three-report/tab/day cap. It uses a separate strict allowlisted timing schema in the existing bounded collector; INFO performance events cannot trigger crash alerts. See [diagnostics](FRONTEND-ERROR-COLLECTION.md).
- The surge value and marker follow the shared chart focus, including panned forecasts. Source labels distinguish measured samples, visual interpolation, estimated bridge, forecasts and unavailable coverage.
- A compact preview and expandable list explain the selected forecast with all supported model contributions. The exact decomposition includes measured anomaly, trend, recent pattern, tide-linked response, wind, pressure, rainfall and baseline. A separate tide-reference adjustment reconciles the displayed anomaly to server residuals. See [factor contract](FORECAST-FACTORS.md).
- Adaptive provider cooldowns persist across function instances: missing Retry-After uses 15/30/60-minute backoff; actual recovery resets the streak without clearing a newer concurrent limit. Historical water-only training retrieval skips irrelevant imagery parsing; live archival remains enabled.

## Verification

- 653 frontend tests across 60 files passed; 126 backend tests passed. Typecheck, production build and diff whitespace checks passed. Focused new frontend files lint without warnings; the repository-wide lint has existing warnings and no errors.
- Additive attribution tests prove all timestamps, astronomical tide, residual, total water and uncertainty values are identical with factor metadata enabled/disabled. A 32-day stress forecast stays below 900 KB JSON and 1,000,000 bytes using the installed Firestore serializer and protobuf document encoding.
- Production Hosting asset `/assets/index-CKh9CHsm.js` maps to private build `4411a36ea235a023`; public maps/private collection reads remain unavailable. Collector valid-schema verification returned 204, invalid origin 403, invalid payload 400, native preflight 204, and anonymous backfill 403.
- The current public outlook at verification had 2,165 valid points through November 6, all with drivers. Maximum factor sum error was 1.11e-16 ft. Actual size was 628,256 JSON bytes / 636,100 Firestore protobuf bytes. All historical-only points had zero weather contributions; hourly context stayed within supported coverage.
- Production desktop (1280px) and phone (390×844) checks confirmed linked panning, changing readout and factor chips, expandable details, and no horizontal page overflow. A [phone screenshot](screenshots/surge-factors-mobile-2026-10-16.jpg) captures the selected forecast and factor preview.
- Main JavaScript decreased from 2,555,272 to 1,874,332 decoded bytes (26.6%); the map is now deferred. The road dataset was not requested before map visibility in the verified load.
- A genuine automatically sampled cached visit sent `page_load` with shell 238ms, chart 996ms, outlook 1423ms, document TTFB 163ms and FCP 296ms; collector returned 204. These are one visit's measured timings, not population percentiles or a claim about uncached day-return latency.
- Fully paginated logs from 08:05–14:01 EDT showed zero backend ERROR/default-text failures, provider-limit/Gemini/camera warnings or Scheduler failures, and 120 successful job/health records. Ten frontend fallback warnings used the previous app build; reporting budgets mean absence of further reports cannot prove all old clients recovered. Three HTTP rejections were deliberate verification probes. Adaptive escalation did not encounter a real production 429 in that interval and remains test-verified.

## Interpretation limits

Contributions are centered regression associations, not independently proven causes. Correlated weather factors can share explanatory weight; a small rainfall term can exist relative to reference conditions even with zero rain. At far leads the historical baseline remains a baseline with increasing uncertainty. This release explains the existing curve; it does not claim a new accuracy improvement or new event validation.

Startup readiness uses committed data plus animation-frame milestones. It is not a Core Web Vitals or Lighthouse score. Thirty-second/hidden-page reports may be partial, and the cache flag refers to the main JavaScript asset. Field samples are needed to assess repeated day-return loading behavior.

# Surge-pattern improvement — October 26, 2026

## What was wrong

The retained observations confirm a changing tide-linked residual cycle. The native gauge recorded repeated threshold episodes over October 21–26, including peaks of 6.37 ft MLLW on October 24 and 6.42 ft on October 25. These are gauge levels under the existing local conversion, not surveyed street depths.

The short-range model predicted residual controls at 1, 3, 6, 12 and 24 hours, then interpolated the entire residual linearly. In particular, the 12–24-hour segment could erase a complete intervening tide-linked peak/valley. Its endpoint-only lead errors did not expose all of that shape loss. The daily model was refreshing successfully, but its training history intentionally ended seven days earlier for historical-data availability; a fresh pointer did not imply it had learned the last few days' local pattern.

A repeating residual is not automatically meteorological storm surge. Tide amplitude/phase mismatch and tide–weather interactions can contribute. No datum offset, NOAA tide shift, stage threshold or sensor identity has been changed by this improvement.

## Implementation

- Preserve existing learned residual controls and their weather inputs. Interpolate the non-tide remainder while following the supplied astronomical curve between controls.
- Bound every contributing lead model's tide feature to its existing min/max plus three standard deviations. No unrestricted intermediate feature extrapolation.
- Use a fixed recent 60-hour measured-history fit with intercept, historical drift, tide level and tide slope. Require at least 40 bracketed hourly samples spanning 48 hours, with the documented 30-minute-plus-10-second observation jitter allowance. The recent tide-level coefficient must agree in sign with the old model; the interpolation correction is limited by both magnitudes. Missing/unsupported recent history retains the prior interpolation. Historical drift is never extrapolated.
- Apply the exact same correction to the existing Tide-linked pattern driver. Numeric predictions do not depend on whether explanatory drivers are requested.
- Preserve real observation timestamps, gap rules, units/reference checks, long-range joins and the full NOAA horizon. The existing 24–72-hour tail is numerically unchanged apart from interpolation rounding.
- Bump the private numerical cache to `gauge-weather-response-v7`. Reject old peak-screen caches and regenerate chronological peak validation before production inference.
- Add a reusable local-only issued-curve evaluator and meaningful deterministic tests. No new API/provider, credentials, Gemini numerical output or client-facing explanatory paragraphs.

## Actual-data evaluation

Exported 96 three-hour decision origins from October 14–25 UTC, their actually available archived forecasts and frozen inputs/coefficients, and native gauge observations through the evaluation cutoff of October 26 at 7:23 AM EDT. All 96 issues passed replay compatibility checks; no observation was added to an old issue and no historical weather was regenerated.

The first unconditional interpolation candidate improved recent shapes but introduced an October 22 marginal flood miss (native peak 5.67 ft). That proposal was rejected and retained as evidence. The final bounded, recent-supported method preserved that event. Because refinement followed inspection of the initial results, this is explicitly a **retrospective counterfactual replay**, not an untouched prospective validation or a guarantee of future accuracy. The artifact's chronological cohort labels remain development October 14–20, selection October 21–22 and later evaluation October 23–25 UTC.

For the later October 23–25 issue cohort, common supported 30-minute targets:

| Lead band | Targets | Archived MAE | Updated MAE |
| --- | ---: | ---: | ---: |
| 0–3h | 144 | 0.1672 ft | 0.1631 ft |
| 3–6h | 144 | 0.2458 ft | 0.2364 ft |
| 6–12h | 288 | 0.2527 ft | 0.2208 ft |
| 12–24h | 528 | 0.3395 ft | 0.2964 ft |
| 24–48h | 768 | 0.2773 ft | 0.2773 ft |
| 48–72h | 384 | 0.2226 ft | 0.2226 ft |

For 20 common complete overlapping 24-hour windows, maximum-water-level MAE improved **0.2728 → 0.2007 ft**, approximately **26.4%** (3.27 → 2.41 inches). These are 20 overlapping windows across six unique observed new-onset episodes, not 20 independent storms. Matched-event peak MAE improved 0.3405 → 0.2730 ft; onset MAE 30.70 → 26.84 minutes and duration MAE 51.74 → 44.86 minutes. Timing estimates interpolate approximately half-hour native observations and must not imply minute-resolution observed truth.

In the recent 6/12/24-hour replay windows, missed event-pairs stayed zero and unmatched predicted event-pairs stayed one per horizon. For October 21–22 fixed daily origins, all three observed new-onset events remained matched with no false predictions, preserving the October 22 marginal event that caused rejection of the first candidate.

Results are not universally better. Development-period 6–12-hour curve MAE worsened slightly (0.1787 → 0.1841 ft); its fixed daily false predictions improved three → two, while the previously documented October 18 miss remained. October 21–22 curve results were effectively unchanged. Fixed midnight cohorts and overlapping-window errors have different denominators; neither provides a reliable general flood sensitivity percentage from this small sample.

## Regenerated model validation and checks

Using the immutable 90-day history behind the current model (July 21–October 19), the updated curve passed existing purged chronological point and native-peak screening: 23 complete weather-model peak windows, peak MAE 0.2727 ft versus persistence 0.3482 ft. The separately screened six-hour fallback also passed. This reanalysis-weather hindcast omits issued-weather error; it is a separate screen from the frozen-issued replay above. The v7 cache passed the production validator.

- App: **758 tests across 73 files passed**.
- Functions: **198 tests passed**, including seven issued-replay contract tests.
- App and Functions TypeScript/build passed; ESLint had zero errors and 201 existing warnings. Whitespace check passed.
- Independent numerical/schema review found no blocking defect. The recent fit runs twice when drivers are requested, a bounded minor optimization opportunity. Existing caller duplicate-timestamp normalization predates this change; direct helper conflict tests do not establish a new end-to-end ingestion policy.

## Production release

Deployed the two existing scheduled functions on October 26: `refreshresidualhistory-00006-fah` and `generatefloodoutlook-00007-zar`. Both are ACTIVE. Generation was briefly paused while preserving the still-valid cached forecast; after the new daily model passed validation, generation resumed and both schedules were verified ENABLED.

The production training run completed successfully at **7:50 AM EDT**, creating `gauge-weather-response-v7` at `2026-10-26T11:50:00.846Z`. Its regenerated 23-window peak MAE was **0.2721 ft** versus **0.3482 ft** for persistence. The real generation run completed successfully at 7:51 AM. Its frozen input archive confirms v7, with a fresh available forecast issued `2026-10-26T11:51:51.325Z` and **2164 points through November 16**. No forecast horizon was shortened and no numerical value was supplied by Gemini.

Post-deployment logs included application outcomes and DEFAULT-severity errors: both jobs reported `ok` and no new failures were found. The existing public CDN can retain a prior valid issue for up to five minutes; an independent cache-bypassed public read verifies current origin data while ordinary cached clients refresh normally. Hosting/UI code was not redeployed because the existing client already accepts this unchanged forecast schema.

## GenAI and remaining limits

Gemini remains the structured explanation layer. Replacing the numerical curve with unconstrained generated values would not address the measured interpolation defect or prove forecast skill. A dedicated time-series foundation model can be evaluated later as a shadow challenger with the same frozen-input and chronological tests; no such model has been adopted or benchmarked here. Google describes [TimesFM-3's time-series targets, past covariates and known future covariates](https://www.research.google/blog/timesfm-3-a-zero-shot-foundation-model-for-multivariate-forecasting/). NOAA's [coastal residual forecasting research](https://www.psl.noaa.gov/news/2025/coastalfloodrisk.html) likewise evaluates numerical models against measured outcomes and persistence.

This patch improves the supported short-range shape; it does not resolve all baseline bias, guarantee every peak, validate street depths, or demonstrate improved multiweek forecasting. Existing limited-confidence language and uncertainty limitations remain. Automatic as-issued scoring continues; new production outcomes are needed to test the improvement prospectively. No email enrollment or manual test notification was performed for this work.

Detailed private replay, original rejected proposal, source snapshots and validation artifacts are in ignored `functions/evaluation/pattern-review-2026-10-26/`. No credentials are stored in this document.

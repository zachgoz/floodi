# Carolina Beach forecast validation — October 10, 2026

The weather-response forecast now replaces the steady projection when its historical screening, reference, freshness and input checks pass. Confidence remains limited. A separately evaluated six-hour model of measured residual changes and tidal phase is used when weather inputs are missing or outside their learned range. Neither model claims reliable flood detection in every event.

## Proof using recorded data

The app's public July–October observation buckets contain **7,604 FIMAN readings**. All **7,048** timestamps overlapping independently retrieved gauge **30046** records match exactly, with no conflicting values. An additional 556 readings inherit the monthly bucket reference but were not independently checked by those archives. Recorded NOAA predictions also match the verified localized tide at all **23,190** overlapping timestamps.

Legacy weather maps mix pressure in pascals and hectopascals, missing rainfall and future forecast rows. They cannot safely be fed directly into training. A coherent whole-hour gridded ETL cohort was identified: every wind value matches the existing km/h-to-mph conversion and every rainfall value matches the mm-to-inches conversion. The separate recorded-data test uses **2,444 weather hours**, **7,591 tide-aligned measured residuals**, and 24,661 tide points. It excludes **145 future weather rows**; 13 early measurements without tide coverage do not become invented residuals.

The recorded cohort has **surface pressure**, while the live weather model uses **mean sea-level pressure**. Its per-point provider/QC metadata and original forecast issue versions are unavailable. It is a recorded gridded-weather snapshot hindcast, not a measured rain-gauge analysis or a replay of original issued weather forecasts.

With unchanged standardized ridge regression, fixed penalty 20, first 70% chronological training, last 30% testing and training targets purged at the holdout boundary:

| Ahead | Held-out pairs | Recorded-weather MAE | Steady-residual MAE |
| --- | ---: | ---: | ---: |
| 1h | 642 | 0.121 ft | 0.142 ft |
| 3h | 638 | 0.201 ft | 0.263 ft |
| 6h | 632 | 0.222 ft | 0.321 ft |
| 12h | 620 | 0.144 ft | 0.189 ft |
| 24h | 596 | 0.162 ft | 0.260 ft |

On 24 complete daily windows, peak error improves **0.249 → 0.211 ft**. The test runs September 10–October 10. Adding weather also improves the tide/recent-change-only ablation on identical pairs at every lead. This supports the forecasting concept with the application's actual saved water and weather data.

## What raises the residual?

The saved weather independently reproduces the northerly-wind association: north-component correlation rises from **0.411** for the current hour to **0.462 / 0.506 / 0.557** for sustained 6 / 12 / 24-hour conditions. East winds have a weaker association (12h: 0.265). These are meteorological winds **from** the stated direction. They support sustained exposure as a predictor, not a fixed rise per compass direction or proof of causation. Adjacent hours are dependent, and this record does not establish a reliable positive rainfall or drainage response.

The forecast learns future residual changes from the current measured residual, its previous three-hour change, sustained north/east winds, expected wind changes, pressure changes, rain totals and astronomical tide change. No additional moon-phase adjustment double-counts the lunar tide. A repeated visible wave by itself did not consistently beat persistence, so a fitted cycle is not automatically used.

## Corrected gap handling

The earlier strict 30-minute cutoff incorrectly treated nominal half-hour reports a few seconds apart as outages. Forecast validation now declares **10 seconds of timestamp tolerance**, preserves every original timestamp and leaves longer outages missing. This restores full-day evaluation; the earlier claim that no complete daily windows existed is superseded. Actual peaks are measured water totals at native observation times. Intermediate scoring uses bounded linear interpolation of those totals, never a curved tide plus an invented residual peak. Non-evaluated provider spikes remain unchanged.

## Frozen forecasts and flooding events

Coefficients are frozen before **September 6, 14:34 UTC**; outcomes extend through October 9. Unsupported windows use steady-residual fallback and remain in the denominator. Weather uses future reanalysis, so this replay excludes issued-weather error. Timing compares exactly the same observed events matched by both methods.

| 31 nonoverlapping 24h windows | Weather model | Steady residual |
| --- | ---: | ---: |
| Peak MAE | 0.230 ft | 0.260 ft |
| Onset MAE, same 11 matched events | 20.7 min | 29.5 min |
| Duration MAE, same 11 matched events | 42.1 min | 57.0 min |
| Hits / misses / false alarms | 13 / 2 / 2 | 14 / 1 / 2 |

On 130 nonoverlapping six-hour windows, weather peak error improves **0.239 → 0.197 ft** and false alarms decrease **12 → 4**, but misses increase **3 → 6**. Better mean error is not uniformly better flood detection.

The six-hour fallback uses only the measured residual, its recent change and astronomical tide change. It passes independent per-lead and native-peak screening. On the same 130 windows, peak MAE is **0.210 versus 0.239 ft**, point MAE **0.198 versus 0.231 ft**, onset **12.81 versus 12.87 min**, duration **36.21 versus 37.15 min**, and hits/misses/false alarms **19/7/6 versus 23/3/12**. The small timing gain and higher miss rate remain explicit. Its centerline cannot establish that flooding is impossible.

An additional October 3–9 week is outside both original near-term fitting and original near-term screening. On 27 six-hour windows, weather peak error is **0.208 versus 0.265 ft**; the short-range model is **0.223 ft**. Only four flooded windows occur, so this is limited independent evidence for those near-term models, not an all-storm validation. The subsequent three-day candidate development inspected this week; it is not an untouched holdout for the new extension.

The dashboard displays historical error bounds and a compact **Flooding possible** state when the upper bound crosses flood stage without a central forecast crossing. The bounds are not calibrated probabilities; weather error and measurement quality may add uncertainty. Expected event cards and chart shading still use the exact central forecast crossings.

## Full NOAA range — October 11

The latest implementation preserves the previously screened 6h measured-response or 24h weather-response prefix, then spans the available NOAA tides. It fits a conditional historical residual baseline from tide height and its one-hour slope. The current departure fades toward that pattern over 48h. A separate regression uses sustained north/east wind over 6h/24h, MSL pressure and its change, and accumulated rain over 6h/24h. Weather enters smoothly over 12h and fades during its last 24h of coverage; the rest uses the explicitly labeled historical baseline. This does not add lunar effects already represented in NOAA tides.

The new chronological screen freezes coefficients before September 6 and tests through October 2. All constants are declared before scoring. The following are residual mean absolute errors; astronomical tide is identical for each method, so total-water point errors are the same:

| Ahead | Held-out pairs | Historical baseline | Weather candidate | Steady residual |
| --- | ---: | ---: | ---: | ---: |
| 1 day | 586 | 0.255 ft | 0.209 ft | 0.250 ft |
| 3 days | 538 | 0.397 ft | 0.293 ft | 0.497 ft |
| 5 days | 490 | 0.435 ft | 0.307 ft | 0.609 ft |
| 7 days | 453 | 0.463 ft | 0.320 ft | 0.604 ft |
| 14 days | 285 | 0.610 ft | 0.369 ft | 0.580 ft |

The historical baseline is worse at 14 days and **fails its fixed improvement screen**. Its metadata retains `historicalEligible: false` and `selectedFallback: historical-baseline`; adequate observations permit a contextual outlook without claiming that it uniformly improves persistence. The weather candidate passes its separate same-pair historical comparison, but these evaluations use realized reanalysis. They do **not** prove accuracy with issued 14-day weather forecasts. Hourly issue targets overlap and are not independent storm events. The serving coefficients subsequently refit through October 2; the reported screen uses the earlier frozen fit.

Historical coverage is July–October, not a full annual record. A separate January 1–8 gauge query returned no observations; that single probe does not establish all winter availability or the provider's retention limit. Annual seasonal calibration remains unavailable. Beyond the measured 336h validation range, growing uncertainty is a conservative extrapolation, not a calibrated probability interval. Storms outside the learned weather range use the historical fallback and may be missed.

The October 11 public-source issue produced **2,057 points** through **November 1, 14:00 EST**, approximately 21 days after generation. Forecast weather support ends October 26, 19:00 EDT. Near-term six-minute samples remain unchanged; the far tail uses intervals no longer than 15 minutes. The actual client selector preserved all server physical totals exactly, reconstructed total = tide + residual at every point, retained continuous crossing coverage and never narrowed the uncertainty envelope. The payload was approximately 356 KB. The 12 calculated exceedance windows in that issue are predictions, not validation events. Panning can extend the same shared baseline through subsequently loaded NOAA timestamps without a fixed browser day limit.

The compact [full-range report](full-horizon-validation-2026-10-11.json) preserves all lead errors, failed/pass flags, provenance and actual client proof. A dedicated frozen joined-prefix replay also scores native observed peaks and exactly matched event timing:

| Complete overlapping windows | Weather 24h prefix + tail: peak MAE | Short 6h prefix + tail: peak MAE | Steady peak MAE |
| --- | ---: | ---: | ---: |
| 5 days, 16 windows | 0.285 ft | 0.284 ft | 0.389 ft |
| 7 days, 14 windows | 0.286 ft | 0.295 ft | 0.412 ft |
| 14 days, 7 windows | 0.410 ft | 0.431 ft | 0.467 ft |

At 7 days the weather-prefix composition detects/misses/false-alarms **12/1/0** flood windows versus steady **9/4/1**. The short-prefix composition is **7/6/0**, missing more floods despite lower peak error. At 14 days weather and steady both detect all seven flooded windows; the short-prefix composition misses one. On the same 11 matched observed event occurrences at 7 days, weather-prefix onset/duration MAE is **30.9/63.7 minutes**, versus steady **45.8/95.2 minutes**. The complete report retains counts and common-event metrics for each horizon; repeated occurrences across overlapping windows are not independent events.

These tests use reanalysis and reuse development-period data; they are transparent hindcasts, not independent prospective validation. The current local issue uses the short prefix, whose higher miss rate remains material. An error-bound crossing can indicate possible flooding even when its centerline is lower. The near-term prefix regression was additionally rebuilt from the exact captured real inputs: all 58 native points and bounds were bit-for-bit unchanged. Earlier three-day event results below remain relevant limitations.

## Earlier three-day extension — October 11

The approved 6h measured-response or 24h weather-response prefix remains unchanged. The tail uses fixed-penalty standardized ridge with eight features: current residual, its preceding 3h/24h changes, preceding 12h/24h means, and issue/target astronomical tide with target tide slope. Every target evaluates its own astronomical tide; a linear interpolation between daily residual points does not define the learned curve. Future observed residuals and future weather are excluded from the tail. This forecasts historical residual/tide behavior, not a demonstrated storm response.

The original purged chronological screen freezes fitting before September 6, 14:34 UTC and tests through October 2:

| Ahead | Held-out pairs | Selected residual MAE | Steady MAE | Selected component |
| --- | ---: | ---: | ---: | --- |
| 12h | 574 | 0.184 ft | 0.184 ft | Explicit steady baseline |
| 24h | 562 | 0.232 ft | 0.232 ft | Explicit steady baseline |
| 48h | 538 | 0.325 ft | 0.361 ft | Learned residual/tide response |
| 72h | 514 | 0.394 ft | 0.467 ft | Learned residual/tide response |

The 12/24h learned candidates gained only 1.4%/3.3%, failing the unchanged 5% screen, and are not used in the tail. Their replacements carry actual persistence error percentiles, not the rejected candidates' errors. The learned 48/72h controls improve 10.0%/15.6%. Native observed daily peak errors pass for both exact compositions: **0.327 vs 0.346 ft** with the short prefix and **0.313 vs 0.346 ft** with the weather prefix. Each uses 63 complete day windows, 21 per lead day; these overlap across daily origins and are not 63 independent storms. The selected prefix must pass its own gate.

The later October 3–9 frozen replay is **out of training with development-period overlap**, not pristine independent validation. Its 48/72h point MAE improves **0.508 → 0.410 ft** and **0.590 → 0.457 ft**, respectively. Over 13 overlapping daily windows, short-prefix peak error worsens **0.526 → 0.544 ft**, while weather-prefix peak error improves **0.526 → 0.510 ft**. At 5.6 ft MLLW:

| Later daily flood windows | Short prefix + tail | Weather prefix + tail | Steady residual |
| --- | ---: | ---: | ---: |
| Detected / missed / false alarms | 3 / 7 / 1 | 4 / 6 / 1 | 5 / 5 / 1 |

Only one complete nonoverlapping 72h window is available. The short composition misses its flood, while weather and persistence detect it. No common matched observed event supports comparable onset/duration errors, so those comparisons remain null. Better mean point error has **not** established better event detection. No subsequent numerical tuning was performed on these replay results. The dashboard therefore uses **3-day outlook · Limited confidence**, retains the possible-flood uncertainty state and exposes the baseline comparison and limitations in details. It cannot establish that flooding is impossible when the centerline stays below threshold.

The actual serving model refits approved coefficients on the complete archive through October 2. A separate replay freezes that exact operational refit before October 3: 48/72h point MAE is **0.400/0.431 ft**, versus steady **0.508/0.590 ft**, on 119/96 pairs. Daily short-prefix peak error is **0.555 vs 0.526 ft**, while weather-prefix error is **0.505 vs 0.526 ft**. Detection counts and null same-event timing comparisons are unchanged. Refitting does not resolve the weaker event detection. These results retain the same development-period-overlap limitation and are saved separately from the original screen.

The per-lead absolute-error envelope expands to approximately ±0.99 ft by 72h in the original screen. It excludes issued-weather error and is not a calibrated probability interval. The final local run retrieved real public sources and generated 718 points through October 14, 08:36 ET. The actual dashboard selection retained the full range without changing physical totals. Production has not been redeployed. The [compact three-day report](three-day-validation-2026-10-11.json) preserves source chronology, both compositions and these limitations.

## Remaining calibration

The reference is FIMAN gauge 30046, NOAA 8658163 astronomical tide shifted by the existing 60 minutes, and the existing **+2.75 ft NAVD88-to-MLLW conversion**. Offset and phase require independent local calibration. The client preserves physical forecast totals and expresses residuals relative to its localized tide at identical UTC timestamps. The separate raw SUNNYD_CB_03 physical sensor is not substituted for gauge 30046. NOAA display estimates do not enter training or measured trends.

More seasons, reviewed storm events, immutable issued-weather versions and prospective errors are required. New scheduled jobs preserve exact private issue inputs for that next test. Street elevations remain uncalibrated; Max Street Flooding* is a clearly disclosed threshold-exceedance proxy rather than measured street depth.

## Reproduce

From `floodi/functions` after `npm run build`:

```sh
node lib/scripts/export_recorded_data.js 2026-07 2026-10
python3 scripts/audit_recorded_data.py evaluation/recorded-data --regional-archives evaluation/regional-gauge-history-2026-10-03-90d.json evaluation/regional-gauge-history-2026-10-10-90d.json --emit-hindcast evaluation/recorded-data/recorded-weather-input.json
node lib/scripts/evaluate_weather_response.js evaluation/recorded-data/recorded-weather-input.json evaluation/recorded-data/recorded-weather-validation.json
python3 scripts/audit_recorded_data.py evaluation/recorded-data --regional-archives evaluation/regional-gauge-history-2026-10-03-90d.json evaluation/regional-gauge-history-2026-10-10-90d.json --validation-report evaluation/recorded-data/recorded-weather-validation.json
node lib/scripts/evaluate_events.js evaluation/regional-gauge-history-2026-10-03-90d.json evaluation/regional-gauge-history-2026-10-10-90d.json
node lib/scripts/evaluate_events.js evaluation/regional-gauge-history-2026-10-03-90d.json evaluation/regional-gauge-history-2026-10-10-90d.json --short-range
node lib/scripts/evaluate_long_range.js evaluation/regional-gauge-history-2026-10-03-90d.json evaluation/long-range-validation.json evaluation/regional-gauge-history-2026-10-10-90d.json
```

The evaluator's optional fourth argument accepts an already frozen model for the separate operational-refit replay; it does not refit while replaying or change the original screening results.

Archive collection uses public providers; numerical evaluation reads local data and does not call Gemini or write production. Detailed inputs/results remain in ignored `functions/evaluation/`. The saved compact [validation summary](forecast-validation-2026-10-10.json) preserves measured results and limitations. Recorded-weather metadata overrides the evaluator's generic reanalysis label without altering numerical results.

Sources: [FIMAN gauge 30046](https://fiman.nc.gov/?id=30046), [Sunny Day Flooding public data service](https://data.sunnydayflooding.com/services/data.php), [NOAA 8658163](https://tidesandcurrents.noaa.gov/stationhome.html?id=8658163), [Open-Meteo weather forecasts](https://open-meteo.com/en/docs) and [historical reanalysis](https://open-meteo.com/en/docs/historical-weather-api).

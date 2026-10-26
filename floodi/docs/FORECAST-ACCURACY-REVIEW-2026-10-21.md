# Forecast accuracy review — October 21, 2026

Read-only production review, evaluated at 7:15 AM America/New_York. No model, alert policy, threshold, calibration, deployment or production records changed. Credentials stayed in memory using the previously authorized Firebase CLI session.

## Monitoring verified

The private `verifyPublishedForecasts` job is ACTIVE, scheduled daily at 06:40 UTC (2:40 AM EDT). Its October 18–21 executions completed successfully; today's run finished at 06:40:37 UTC with status `ok`, two completed origin days, no truncated reads and no days without scorable numerical forecasts. Its 1,008 scored rows include all three methods and seven leads, not 1,008 independent forecasts or floods. Today's scheduled reports cover October 16–17; the approximately four-day lag allows all 72-hour outcomes and ingestion allowance to mature.

A separate read-only replay refreshed UTC origin days October 12–20 using actual archived publication availability and frozen issued outputs/inputs. Of 216 hourly origins, 190 had a scorable numerical forecast at 1h, 24 selected unavailable issues and two had no previous archive. October 12 contributed no numerical-error pairs. Those unavailable checkpoint outcomes are not proof of dashboard outages: historical client fallbacks were not reconstructed. Future or unbracketed observations are excluded. All archive queries were complete and untruncated.

## Paired water-level error

Mean absolute error in feet; lower is better. All three methods use identical supported targets in each row. NOAA tide-only means the archived astronomical tide under FloodCast's existing local reference adjustment. Persistence holds the last issued measured residual constant and adds the same tide curve.

| Lead | Common targets | Forecast MAE | Tide-only MAE | Persistence MAE | Forecast bias | 90th percentile absolute error |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1h | 190 | 0.116 | 0.853 | 0.103 | +0.009 | 0.231 |
| 3h | 190 | 0.183 | 0.864 | 0.185 | +0.013 | 0.342 |
| 6h | 190 | 0.187 | 0.876 | 0.219 | +0.017 | 0.371 |
| 12h | 189 | 0.181 | 0.896 | 0.251 | +0.000 | 0.385 |
| 24h | 177 | 0.199 | 0.896 | 0.302 | -0.006 | 0.378 |
| 48h | 153 | 0.221 | 0.953 | 0.425 | -0.106 | 0.467 |
| 72h | 129 | 0.263 | 1.055 | 0.600 | -0.154 | 0.550 |

These are promising point-level results: the numerical forecast improves markedly on tide-only. Persistence is better at 1h, effectively tied at 3h, and worse at 6–72h in this sample. Average errors are not maximum errors: the largest supported 24h error was 0.871 ft (about 10.5 inches).

For the October 17–20 origin subset, forecast MAE at 1/6/24/48/72h was 0.118/0.205/0.232/0.281/0.337 ft, with 96/96/83/59/35 common targets. Corresponding 48/72h biases were −0.278/−0.317 ft. This merits investigation; it does not justify adding a uniform offset because other issues overpredicted. Longer leads have fewer matured targets. Earlier October 17 audit figures also had fewer matured outcomes, so their lower long-lead errors should not be mistaken for an apples-to-apples historical benchmark.

## Flood-event findings

October 18 had one native threshold episode: approximately **2:02–3:42 PM EDT**, native peak **5.73 ft MLLW** around **3:06 PM**, against the configured **5.6 ft** stage. This was only about 1.6 inches above stage. All 24 scored pre-onset hourly forecast windows containing that episode missed its onset (five October 17 origins and 19 October 18 origins). The hourly 19:00 UTC checkpoint matched the event only after it was underway. Intervening issues were not all sampled; this does not establish that every issue missed it or reconstruct each dashboard curve. This event preceded the October 20 email-pilot deployment and is not a claim about delivered notifications.

The final pre-onset 18:00 UTC checkpoint used the issue published at 17:55 UTC. Its predicted next-hour level was approximately 5.576 ft versus observed interpolated 5.726 ft. The central forecast being slightly below stage illustrates why small water-level errors can still cause a missed flood warning.

Fixed 00:00 UTC daily decision cohorts, which avoid counting repeated hourly forecasts as independent floods:

| UTC origin day | Result for numerical forecast |
| --- | --- |
| 2026-10-12 | Excluded: no-published-issue |
| 2026-10-13 | Excluded: issue-unavailable |
| 2026-10-14 | 0 matched new events; 0 missed new events; 1 unmatched predicted events |
| 2026-10-15 | Correct dry window |
| 2026-10-16 | Correct dry window |
| 2026-10-17 | Correct dry window |
| 2026-10-18 | 0 matched new events; 1 missed new events; 0 unmatched predicted events |
| 2026-10-19 | 0 matched new events; 0 missed new events; 1 unmatched predicted events |
| 2026-10-20 | 0 matched new events; 0 missed new events; 1 unmatched predicted events |

October 13 remains another usable native episode; its fixed midnight issue was unavailable, although later repeated hourly forecasts matched it. October 12 raw spikes and conversion-equality fragments remain unresolved QC findings and must not be counted as confirmed physical floods or silently cleaned to improve the score. There are too few independent floods and weather regimes for a reliable event-detection percentage or onset/duration guarantee. False predicted episodes above are gauge-based forecast outcomes, not evidence of false emails actually sent.

## Recommended adjustments

1. Investigate the October 18 miss using its frozen weather inputs, measured residuals and tide-phase alignment. Replay a candidate that gives the most recent measured anomaly more weight over 1–3 hours; adopt it only if chronological held-out comparisons improve both errors and event outcomes.
2. Evaluate a distinct near-threshold watch when empirically supported forecast error bounds reach stage even though the central forecast remains below it. Keep the 5.6 ft stage and distinguish possible from expected flooding. Measure false watches and useful lead time before enabling new notifications. Current bounds are not calibrated probabilities.
3. Add prospective 5/7/14/21-day scoring; existing scheduled scoring stops at 72h although the outlook extends about 21 days. Retain lower-confidence long-range context without implying verified long-range accuracy.
4. Add interval coverage, errors by weather/tide regime, and accuracy-regression monitoring. Current job health monitoring confirms execution, not an automated accuracy promotion/degradation gate.

## Limits and reproducibility

Hourly targets overlap and are correlated; sample counts are not independent storms. Native observations are approximately 30 minutes apart; crossings are interpolated and between-sample peaks can be missed. The gauge/datum/phase reference is checked consistently (sensor 30046, NOAA 8658163, feet MLLW, existing 2.75 ft conversion, 60-minute tide shift), but historical daily observation maps do not independently retain calibration provenance. These scores concern local gauge water levels, not street-depth or road-safety accuracy. Gemini explains numerical forecasts and is not the numerical estimator.

Detailed reports, sanitized job logs and paired summary are in ignored `functions/evaluation/review-2026-10-21/`. The read-only scorer uses the same `prospective-v1` implementation as production, with no regenerated past weather or newly fitted forecast substituted for an issued value. No source-code changes were needed, so application tests were not rerun for this review.

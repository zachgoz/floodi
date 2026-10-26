# Initial as-issued forecast accuracy audit

October 17, 2026. Read-only production audit; no deployment, messages or production writes. The user authorized the existing Firebase CLI credential source. Credentials remained in memory and are absent from these reports.

## Evidence and scope

The first saved numerical issue is October 11 at 9:29 PM EDT (`2026-10-12T01:29:00.892Z`). October 10–11 UTC have observations but no numerical archives, so they cannot establish numerical forecast skill. The audit loaded October 12–16 UTC origin cohorts; their latest origin is October 16 at 7 PM EDT. Reports were evaluated October 17 around 9:12–9:14 AM EDT.

Of 120 hourly decision origins, 94 selected a scorable numerical issue, 24 selected an issue marked unavailable, and two had no preceding archive. These are checkpoint outcomes, not 24 confirmed dashboard outages: the client can choose a different fallback. Unsupported forecasts are retained in coverage reporting and do not enter numerical-error averages.

Values below compare the same supported forecast/observation pairs at each lead. No later weather, model coefficients or tide values regenerated an old forecast. Missing issued inputs would exclude their baselines rather than manufacture them. All sampled issues use the conservative legacy archive-creation availability bound because the new atomic publication code has not been deployed.

## Paired total-water-level errors

Mean absolute error in feet; lower is better. Nominal lead is measured from a fixed hourly decision origin. Raw rows retain exact publication-to-target lead.

| Lead | Paired targets | Archived numerical forecast | Tide only | Residual persistence |
| --- | ---: | ---: | ---: | ---: |
| 1h | 94 | 0.113 ft | 0.586 ft | 0.106 ft |
| 3h | 94 | 0.186 ft | 0.594 ft | 0.191 ft |
| 6h | 94 | 0.169 ft | 0.601 ft | 0.224 ft |
| 12h | 94 | 0.146 ft | 0.586 ft | 0.203 ft |
| 24h | 83 | 0.154 ft | 0.539 ft | 0.226 ft |
| 48h | 59 | 0.149 ft | 0.541 ft | 0.277 ft |
| 72h | 35 | 0.142 ft | 0.634 ft | 0.246 ft |

Across these common samples, the archived numerical forecast has lower error than persistence at 3–72 hours, while persistence is slightly better at one hour. Results vary by day: October 15 forecast errors were higher than persistence at 1, 3 and 6 hours. This is useful early evidence, not grounds to tune the model to this short audit or claim statistical superiority. Daily model refits and changing forecast methods are part of the archived numerical system being evaluated; this is not an evaluation of one permanently fixed coefficient vector.

## Flood events and false predictions

- October 13 has one usable native observed threshold episode. Twelve new-onset matches in hourly diagnostics refer to repeated forecasts of that same episode, not twelve independent floods. The approximate average errors across those repeated complete matches were 0.077 ft for peak, 6.0 minutes for onset and 15.6 minutes for duration. Native observations remain about 30 minutes apart, so interpolated timing is not observed minute-level precision.
- The fixed midnight UTC forecast for October 14 predicted one threshold-exceeding episode, while that day had none in the compatible native gauge record. Persistence also predicted an unmatched episode; tide-only did not. This is a false forecast event in that fixed-origin test, not a sent false alert.
- The midnight cohorts for October 15–16 correctly forecast no threshold events. The October 12–13 midnight cohorts were excluded for absent/unavailable numerical issues. There is therefore no adequate fixed-cohort flood sensitivity estimate, and no delivered-alert performance measurement.
- October 12 contains sharp short spikes/oscillations and ten raw threshold fragments, including one with peak only about 0.00000009 ft above threshold from conversion precision. Preserve the raw records; do not describe these fragments as ten confirmed physical floods. Investigate sensor/source identity, QC and equality handling before using that day for impact-event truth. The day contributed no paired numerical errors because its selected issues were unavailable.

## Interpretation and next checks

Keep the alert engine in shadow mode while the archives accumulate more independent flood episodes, dry periods and weather conditions. Set operational error/false-alert expectations with pilot users before choosing a release gate. Do not apply new event-duration filters or severity thresholds selected just to improve these scores.

Before paid alerts, review source/QC for suspicious native samples, preserve historical calibration provenance, and handle tiny conversion equality consistently with the shared strict-exceedance contract. Gauge detection does not prove street depth or road status. Exact historical dashboard selection and real notification delivery need their own instrumentation.

The local service-account/ADC identities lacked Firestore access; the explicitly authorized Firebase CLI session succeeded. Only one service-account JSON was found in this checkout. No IAM grants or credential files were changed.

## Reproducibility

- [Machine-readable summary](FORECAST-ACCURACY-AUDIT-2026-10-17.json) retains unrounded paired metrics, cohort outcomes, reference/version and per-day evaluation times.
- Detailed local reports are in `functions/evaluation/verification-2026-10-10.json` through `verification-2026-10-16.json`; this directory is excluded from version control and deployment.
- The production read used the existing `loadVerificationDay` read-only repository/scorer through the compatible Google Auth dependency used by the Firestore server client. No credentials were embedded in repository code.
- Functions TypeScript build and all 20 prospective-verification tests passed after adding an explicit archived-backend-versus-dashboard interpretation note. No forecasting calculations changed in this audit.

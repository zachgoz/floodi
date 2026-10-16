# Point-specific forecast factors

Numerical forecast generation adds optional `ForecastPoint.drivers` metadata. The forecast values, near-term selection gates, uncertainty, thresholds and cached-model version are unchanged. Old forecast documents without drivers remain valid.

`ForecastDocument.driverInfo` identifies version 1, `centered-ridge-groups`, the factor order, and the interpretation. `FORECAST_FACTOR_KEYS`, `FORECAST_FACTOR_INFO` and `FORECAST_DRIVER_METHODS` are exported by `functions/src/forecast/schema.ts` for the UI.

Each point has compact fields:

- `m`: `w` weather response, `r` recent water pattern, `l` residual reversion, `h` historical tide pattern, `hw` historical pattern with supported weather.
- `c`: eight additive contributions in feet, in the order below. Their sum equals the point's **server residual**, within floating-point precision.
- `w` (optional, at whole-hour points): hourly weather context `{at, wind6Mph, wind6FromDeg, rain24In, pressureHpa}`. Wind is the preceding six hours' average vector, direction is meteorological wind-from degrees, rain is a complete preceding 24-hour accumulation, and pressure is mean-sea-level hPa. Missing rain is never zero-filled. Context is descriptive and does not assign the whole factor to that single reading. Clients may use the nearest preceding context with age under one hour, without extrapolating beyond supported weather.

| Index | Factor | Meaning |
| --- | --- | --- |
| 0 | Measured water anomaly | Genuine local gauge residual anchoring the issue; decays in the historical tail. |
| 1 | Recent trend | The model term for preceding measured residual change. |
| 2 | Recent water pattern | Learned recent-residual response, persistence/mean reversion, or the decaying exact near-term junction. |
| 3 | Tide-linked pattern | Learned relationship between **residuals** and tide level/change/phase; this is not a second lunar tide addition. |
| 4 | Wind | Centered regression terms for sustained north/east wind components and changes. |
| 5 | Air pressure | Centered regression terms for pressure/pressure changes. |
| 6 | Rainfall | Centered regression terms for measured/forecast accumulation. |
| 7 | Learned baseline | Model intercept and reference centering; not a separately measured physical effect. |

These are **model associations, not causal proof**. Correlated wind, pressure and rain can share explanatory weight; a contribution is relative to model training-mean reference conditions and must not be described as a scientifically isolated physical effect. Zero attribution does not establish that a factor has no physical influence. No unmeasured factors, storm classification, annual seasonality, or Gemini-generated numbers are introduced.

The weather and recent-pattern models decompose every validated lead prediction and interpolate the components with the same weights as the residual curve. The reversion model similarly decomposes adjacent lead models and the exact prefix. The historical tail decomposes the local tide pattern, the decaying gauge/prefix difference, and each weather correction's existing transition/fade/interpolation. Beyond available weather controls the correction is zero and only the historical baseline remains. Missing or out-of-domain weather returns toward that baseline using the numerical model's existing interpolation.

Components use six decimal places with only rounding error reconciled in the baseline term. The unrounded decomposition is checked first; invalid factor algebra omits metadata and preserves the numerical forecast. Public validation rejects non-finite, wrong-length, inconsistent-sum and malformed context fields. Private regression coefficients and input history are excluded.

Weather context is emitted hourly while all forecast points retain their contribution vectors. A 32-day stress forecast stays below 900 KB JSON and 1,000,000 bytes using the installed Firestore SDK field serializer plus real protobuf document encoding, leaving room under Firestore's document limit. The size test runs entirely in memory without writing a fake production forecast. Number arrays are Firestore-compatible; there are no nested arrays. Test fixtures prove that enabling metadata leaves every tide, residual, total, uncertainty bound and timestamp identical.

The chart can use a slightly different localized astronomical tide reference from the server. In that case its displayed anomaly is `server total - displayed tide`; the UI must show that difference as a separate **chart tide reference adjustment**, rather than silently assigning it to weather. Interpolation between two factor vectors must use the same timestamps and fraction as the displayed curve, without extrapolation across unsupported gaps.

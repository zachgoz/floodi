import {
  features,
  predict,
  trainAndValidate,
  WeatherPoint,
  windAssociations,
  historicalRelationships,
  analogousConditions,
} from "./model";
import { floodWindows, interpolate, surgeTrend, WaterPoint } from "./water";
import { ForecastDocument } from "./schema";
import { SITE } from "./sources";
import { buildGaugeForecast } from './gaugePipeline';
export function buildForecast(
  history: WaterPoint[],
  historicalTide: WaterPoint[],
  historyWeather: WeatherPoint[],
  futureTide: WaterPoint[],
  futureWeather: WeatherPoint[],
  now = new Date(),
): ForecastDocument {
  if (SITE.sensor === '30046') return buildGaugeForecast(history, historicalTide, historyWeather, futureTide, futureWeather, now);
  const trained = trainAndValidate(
    history,
    historicalTide,
    historyWeather,
    SITE.thresholdFt,
  );
  const anchor = history.at(-1);
  const recent = surgeTrend(history, now);
  const limitations = [
    "Experimental; never replaces the primary forecast.",
    "Local NAVD88 conversion and one-hour phase assumption need independent calibration.",
    "Reanalysis hindcast excludes weather forecast errors and is not operational validation.",
    "Unreviewed raw local sensor records are used for model fitting; flagged bad/suspect data are excluded.",
    "Residuals include non-tidal effects and sensor errors; they are not necessarily storm surge.",
    "Rainfall is gridded weather model data, not a measured local drainage response.",
    "Street elevation is not calibrated; flood threshold exceedance is not street depth.",
  ];
  const document: ForecastDocument = {
    version: 1,
    status: "unavailable",
    generatedAt: now.toISOString(),
    expiresAt: new Date(+now + 2 * 3600_000).toISOString(),
    locationId: SITE.id,
    sensor: SITE.sensor,
    tideStation: SITE.tideStation,
    datum: "MLLW",
    units: "ft",
    phaseMinutes: SITE.phaseMinutes,
    thresholdFt: SITE.thresholdFt,
    currentResidualFt: recent.value,
    trend: recent.trend,
    points: [],
    validation: trained?.validation || null,
    evidence: [],
    explanation: {
      headline: "No evaluated forecast",
      evidenceIds: ["availability"],
    },
    explanationSource: "fallback",
    sources: [
      "Sunny Day Flooding local sensor SUNNYD_CB_03; NAVD88 converted with existing app offset",
      "NOAA CO-OPS 8658163; localized astronomical tides MLLW ft",
      "Open-Meteo historical reanalysis and current weather model forecast",
    ],
    limitations,
  };
  if (
    !trained ||
    !anchor ||
    recent.value === null ||
    trained.validation.model.samples < 7 * 24 ||
    trained.validation.error90Ft === null
  ) {
    document.evidence = [
      {
        id: "availability",
        text: "An evaluated local residual forecast is unavailable. Recent sensor data and at least thirty days of aligned history are required.",
      },
    ];
    return document;
  }
  const weather = [
    ...new Map(
      [...historyWeather, ...futureWeather].map((w) => [+w.t, w]),
    ).values(),
  ].sort((a, b) => +a.t - +b.t);
  const hourlyResidual: WaterPoint[] = [{ t: now, v: anchor.v }];
  for (let lead = 1; lead <= 24; lead++) {
    const at = new Date(+now + lead * 3600_000);
    const r = predict(
      trained.model,
      features(at, anchor, history, weather, futureTide),
    );
    if (r === null || !Number.isFinite(r)) break;
    hourlyResidual.push({ t: at, v: r });
  }
  const error = trained.validation.error90Ft;
  document.points = futureTide
    .filter((p) => +p.t >= +now && +p.t <= +now + 24 * 3600_000)
    .flatMap((p) => {
      const r = interpolate(hourlyResidual, p.t, 65 * 60_000);
      if (r === null) return [];
      const total = p.v + r;
      return [
        {
          t: p.t.toISOString(),
          tideFt: p.v,
          residualFt: r,
          totalFt: total,
          lowerFt: total - error,
          upperFt: total + error,
        },
      ];
    });
  if (document.points.length < 10) {
    document.points = [];
    document.evidence = [
      {
        id: "availability",
        text: "Weather or tide coverage is incomplete. No residual forecast is available.",
      },
    ];
    return document;
  }
  document.status = "experimental";
  const events = floodWindows(
    document.points.map((p) => ({ t: new Date(p.t), v: p.totalFt })),
    SITE.thresholdFt,
  );
  const associations = windAssociations(history, historyWeather)
    .filter((a) => a.meanResidualFt !== null)
    .sort((a, b) => b.meanResidualFt! - a.meanResidualFt!);
  document.evidence = [
    {
      id: "availability",
      text: `This experimental outlook uses a chronological weather hindcast. Confidence for operational use has not been established. In held-out events the model detected ${trained.validation.model.hits} and missed ${trained.validation.model.misses}; do not rely on it for flood warnings.`,
    },
    {
      id: "anomaly",
      text: `The latest measured residual is ${anchor.v >= 0 ? "+" : ""}${anchor.v.toFixed(2)} ft relative to localized astronomical tides. Its recent trend is ${recent.trend.toLowerCase()}.`,
    },
    {
      id: "risk",
      text: events.length
        ? "The experimental total water level exceeds the configured flood threshold during the available forecast. Compare it with the primary projection; timing and severity remain uncertain."
        : "The experimental total water level stays below the configured threshold over the available forecast. This does not rule out flooding.",
    },
    {
      id: "validation",
      text: `Held-out water level error averaged ${trained.validation.model.maeFt!.toFixed(2)} ft, compared with ${trained.validation.tideOnly.maeFt!.toFixed(2)} ft for tides alone and ${trained.validation.persistence.maeFt!.toFixed(2)} ft for residual persistence. Weather forecast error is excluded.`,
    },
    {
      id: "uncertainty",
      text: `The displayed error envelope uses the held-out absolute error percentile (${error.toFixed(2)} ft). It is not a calibrated probability interval.`,
    },
  ];
  if (associations.length)
    document.evidence.push({
      id: "wind",
      text: `In the available history, ${associations[0].direction} winds have the largest mean residual (${associations[0].meanResidualFt!.toFixed(2)} ft across ${associations[0].hours} hourly pairs). This is descriptive evidence, not proof of causation or statistical significance.`,
    });
  const relationships = historicalRelationships(history, historyWeather)
    .filter((r) => r.correlation !== null)
    .sort((a, b) => Math.abs(b.correlation!) - Math.abs(a.correlation!));
  if (relationships.length) {
    const r = relationships[0];
    document.evidence.push({
      id: "relationships",
      text: `The strongest exploratory weather association was ${r.factor} at a ${r.lagHours}-hour lag (Pearson r ${r.correlation!.toFixed(2)}, ${r.pairs} hourly pairs). Serial dependence and seasonal confounding prevent treating this as statistically significant or a causal response delay.`,
    });
  }
  const nextPeak = document.points.reduce(
    (best, p) => (p.tideFt > best.tideFt ? p : best),
    document.points[0],
  );
  const analogs = analogousConditions(
    trained.model,
    features(new Date(nextPeak.t), anchor, history, weather, futureTide),
    history,
    historicalTide,
    historyWeather,
    new Date(trained.validation.trainEnd),
  );
  if (analogs.length)
    document.evidence.push({
      id: "analogs",
      text: `Closest historical weather/tide conditions in the training period: ${analogs.map((a) => `${a.time.slice(0, 10)} (observed residual ${a.residualFt.toFixed(2)} ft)`).join("; ")}. These are comparable condition snapshots, not verified analogous flood events.`,
    });
  document.explanation = {
    headline: events.length
      ? "Elevated flood risk"
      : "Experimental flood outlook",
    evidenceIds: ["anomaly", "risk", "availability"],
  };
  return document;
}

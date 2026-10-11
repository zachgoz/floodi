import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import { buildGaugeForecast, explanationIsDue, GAUGE_FORECAST_MODEL_VERSION, restoreGaugeModel, serializeGaugeModel } from "./gaugePipeline";
import { collectHistory, FORECAST_TIDE_DAYS, points, SITE, weatherForecast } from "./sources";
import { explainWithGemini } from "./gemini";
import { ForecastDocument, validateForecast } from "./schema";
import { fetchFimanData } from "../etl/fiman";
import { fetchNoaaPredictions } from "../etl/noaa";
import { residuals } from "./water";
import { trainWeatherResponse } from "./weatherResponse";
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const plainJson = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const isCurrentOutlook = (value: unknown, now: Date): value is ForecastDocument =>
  validateForecast(value) && value.locationId === SITE.id && value.sensor === SITE.sensor &&
  value.phaseMinutes === SITE.phaseMinutes && value.thresholdFt === SITE.thresholdFt &&
  Date.parse(value.generatedAt) <= +now && Date.parse(value.expiresAt) > +now;
export const refreshResidualHistory = onSchedule(
  {
    schedule: "every 24 hours",
    timeoutSeconds: 540,
    memory: "1GiB",
    maxInstances: 1,
    concurrency: 1,
  },
  async () => {
    const end = new Date(Date.now() - 7 * 24 * 3600_000);
    const start = new Date(+end - 90 * 24 * 3600_000);
    const result = await collectHistory(start, end);
    const serialized = {
      ...result,
      history: result.history.map((p) => ({ t: p.t.toISOString(), v: p.v })),
      tide: result.tide.map((p) => ({ t: p.t.toISOString(), v: p.v })),
      weather: result.weather.map((w) => ({ ...w, t: w.t.toISOString() })),
      updatedAt: new Date().toISOString(),
    };
    const path = `forecast-training/${SITE.id}/${serialized.updatedAt}/history.json`;
    await admin
      .storage()
      .bucket()
      .file(path)
      .save(JSON.stringify(serialized), { contentType: "application/json", preconditionOpts: { ifGenerationMatch: 0 } });
    await db.doc(`forecast_training/${SITE.id}`).set({
      path,
      updatedAt: serialized.updatedAt,
      metadata: result.metadata,
      failures: result.failures,
    });
    const reference = { station: SITE.sensor, datum: SITE.datum, units: SITE.units };
    const model = trainWeatherResponse(result.history, result.tide, result.weather, reference, reference);
    const modelCache = serializeGaugeModel(model, new Date(), path);
    if (!restoreGaugeModel(modelCache, new Date())) throw new Error("Daily history cannot support a valid model; retaining the previous model pointer");
    const modelPath = `forecast_model_archive/${SITE.id}/models/${modelCache.createdAt}`;
    // Existing rules expose only locations/*; model coefficients and input
    // snapshots live outside that public namespace and are server-only.
    await db.doc(modelPath).create(plainJson({ ...modelCache, trainingMetadata: result.metadata }));
    await db.doc(`forecast_models/${SITE.id}`).set(plainJson({ ...modelCache, archivePath: modelPath }));
  },
);
export const generateFloodOutlook = onSchedule(
  {
    schedule: "every 10 minutes",
    timeoutSeconds: 300,
    memory: "1GiB",
    maxInstances: 1,
    concurrency: 1,
  },
  async () => {
    const now = new Date();
    const ref = db.doc(`locations/${SITE.id}/outlook/current`);
    const cached = await ref.get();
    const cachedDocument = cached.data();
    if (
      cached.exists &&
      isCurrentOutlook(cachedDocument, now) &&
      Date.parse(cachedDocument.generatedAt) > +now - 8 * 60_000
    )
      return;
    let document: ForecastDocument;
    try {
      const modelSnapshot = await db.doc(`forecast_models/${SITE.id}`).get();
      const modelCache = modelSnapshot.data();
      const model = restoreGaugeModel(modelCache, now);
      if (!modelSnapshot.exists || !model) throw new Error("Daily model cache missing, stale or incompatible");
      const start = new Date(+now - 3 * 24 * 3600_000);
      const end = new Date(+now + FORECAST_TIDE_DAYS * 24 * 3600_000);
      const [sensor, rawTide, forecastWeather] = await Promise.all([
        fetchFimanData(SITE.retrievalPlatform, start, now, SITE.offsetFt),
        fetchNoaaPredictions(
          SITE.tideStation,
          new Date(+start - 2 * 3600_000),
          end,
        ),
        weatherForecast().catch(() => []),
      ]);
      const issuedAt = new Date();
      const tide = points(rawTide).map((p) => ({
        ...p,
        t: new Date(+p.t + SITE.phaseMinutes * 60_000),
      }));
      const reference = {
        station: SITE.sensor,
        datum: SITE.datum,
        units: SITE.units,
      };
      const recent = residuals(
        points(sensor.waterLevels),
        tide,
        reference,
        reference,
      );
      document = buildGaugeForecast(
        recent,
        [],
        forecastWeather.filter(w => w.t <= issuedAt),
        tide,
        forecastWeather,
        issuedAt,
        { model },
      );
      if (!forecastWeather.length) document.limitations.push('Issued weather is unavailable; only measured residual and astronomical-tide methods are used.');
      // Preserve the exact inputs AS ISSUED before publishing the forecast.
      // Firestore create is immutable; no later reanalysis overwrites weather.
      // The bounded three-day gauge and full-horizon tide/weather inputs
      // are checked below against a 512KB private archive limit.
      const snapshot = plainJson({
        version: 1, issuedAt: issuedAt.toISOString(), modelVersion: GAUGE_FORECAST_MODEL_VERSION,
        modelPath: modelCache!.archivePath, modelCreatedAt: modelCache!.createdAt,
        model: modelCache!.model, trainingPath: modelCache!.trainingPath,
        reference: { ...reference, tideStation: SITE.tideStation, phaseMinutes: SITE.phaseMinutes, offsetFt: SITE.offsetFt, thresholdFt: SITE.thresholdFt },
        sources: { gauge: SITE.sensor, retrievalPlatform: SITE.retrievalPlatform, tide: 'NOAA CO-OPS', weather: 'Open-Meteo issued forecast and past-days weather-model fields', weatherRetrievedAt: forecastWeather.length ? issuedAt.toISOString() : null, weatherAvailable: forecastWeather.length > 0 },
        measuredWater: sensor.waterLevels,
        recentResidual: recent.map(p => ({ t: p.t.toISOString(), v: p.v })),
        tide: tide.map(p => ({ t: p.t.toISOString(), v: p.v })),
        weather: forecastWeather.map(w => ({ ...w, t: w.t.toISOString() })),
      });
      if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > 512_000) throw new Error("Forecast input snapshot exceeds the private archive size limit");
      await db.doc(`forecast_input_archive/${SITE.id}/issues/${issuedAt.toISOString()}`).create(snapshot);
      if (document.status === "available") try {
        const stateRef = db.doc(`forecast_explanation_state/${SITE.id}`);
        const reserved = await db.runTransaction(async transaction => {
          const state = await transaction.get(stateRef);
          if (!explanationIsDue(state.data()?.lastAttemptAt, issuedAt)) return false;
          transaction.set(stateRef, { lastAttemptAt: issuedAt.toISOString(), forecastIssue: document.generatedAt });
          return true;
        });
        if (reserved) try {
          document.explanation = await explainWithGemini(document);
          document.explanationSource = "gemini-3.8-flash";
        } catch {
          console.warn(
            "Gemini unavailable; using calculated evidence fallback",
          );
        }
      } catch {
        console.warn("Explanation scheduling unavailable; using calculated evidence fallback");
      }
    } catch {
      document = buildGaugeForecast([], [], [], [], [], now, { model: null });
      document.limitations.push(
        "One or more required backend data sources is unavailable.",
      );
    }
    if (!validateForecast(document))
      throw new Error("Forecast schema rejected generated result");
    // A temporary upstream outage must not erase a usable calculated issue or
    // manufacture a new freshness timestamp for it. Its original expiry stands.
    if (document.status === "unavailable" && isCurrentOutlook(cachedDocument, new Date()) && cachedDocument.status === "available") {
      console.warn("Numerical update unavailable; retaining the previous forecast until its original expiry");
      return;
    }
    await ref.set(plainJson(document));
    await db
      .doc(`forecast_archive/${SITE.id}/issues/${document.generatedAt}`)
      .create(plainJson(document));
  },
);
/** Public cached read; visitors cannot trigger training or Gemini spending. */
export const floodOutlook = onRequest(
  { cors: true, maxInstances: 5 },
  async (req, res) => {
    if (req.method !== "GET") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    res.set("Cache-Control", "no-store");
    try {
      const snap = await db.doc(`locations/${SITE.id}/outlook/current`).get();
      const data = snap.data();
      if (
        !snap.exists ||
        !isCurrentOutlook(data, new Date())
      ) {
        res
          .status(503)
          .json({ error: "Current evaluated outlook unavailable" });
        return;
      }
      const remaining = Math.floor((Date.parse(data.expiresAt) - Date.now()) / 1000);
      if (remaining > 0) res.set("Cache-Control", `public, max-age=${Math.min(60, remaining)}, s-maxage=${Math.min(300, remaining)}`);
      res.json(data);
    } catch {
      res.status(503).json({ error: "Outlook unavailable" });
    }
  },
);

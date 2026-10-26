import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { recordJobOutcome, safeError } from "../utils/observability";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import { buildGaugeForecast, explanationIsDue, GAUGE_FORECAST_MODEL_VERSION, restoreGaugeModel, serializeGaugeModel } from "./gaugePipeline";
import { collectHistory, FORECAST_TIDE_DAYS, points, SITE, weatherForecast } from "./sources";
import { explainWithGemini } from "./gemini";
import { ForecastDocument, validateForecast, validateExplanation } from "./schema";
import { fetchFimanData } from "../etl/fiman";
import { fetchNoaaPredictions } from "../etl/noaa";
import { residuals } from "./water";
import { trainWeatherResponse } from "./weatherResponse";
import { publishForecastExplanation, publishNumericalForecast } from './publication';
import { encodeJsonResponse } from '../utils/jsonResponse';
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
    const attemptedAt = new Date().toISOString();
    let stage = 'history';
    try {
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
    stage = 'training';
    const model = trainWeatherResponse(result.history, result.tide, result.weather, reference, reference);
    const modelCache = serializeGaugeModel(model, new Date(), path);
    if (!restoreGaugeModel(modelCache, new Date())) throw new Error("Daily history cannot support a valid model; retaining the previous model pointer");
    const modelPath = `forecast_model_archive/${SITE.id}/models/${modelCache.createdAt}`;
    // Existing rules expose only locations/*; model coefficients and input
    // snapshots live outside that public namespace and are server-only.
    await db.doc(modelPath).create(plainJson({ ...modelCache, trainingMetadata: result.metadata }));
    await db.doc(`forecast_models/${SITE.id}`).set(plainJson({ ...modelCache, archivePath: modelPath }));
    await recordJobOutcome(db, 'refreshResidualHistory', SITE.id, { attemptedAt, status: result.failures.length ? 'partial' : 'ok', modelCreatedAt: modelCache.createdAt, historyCount: result.history.length, missingIntervals: result.failures.length });
    } catch (error) {
      await recordJobOutcome(db, 'refreshResidualHistory', SITE.id, { attemptedAt, status: 'failed', stage, error: safeError(error) });
      throw error;
    }
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
    let stage = 'model';
    let numericalError: unknown;
    let degraded = false;
    let inputPath: string | null = null;
    let modelPath: string | null = null;
    try {
      const modelSnapshot = await db.doc(`forecast_models/${SITE.id}`).get();
      const modelCache = modelSnapshot.data();
      const model = restoreGaugeModel(modelCache, now);
      if (!modelSnapshot.exists || !model) throw new Error("Daily model cache missing, stale or incompatible");
      const start = new Date(+now - 3 * 24 * 3600_000);
      const end = new Date(+now + FORECAST_TIDE_DAYS * 24 * 3600_000);
      stage = 'sources';
      const [sensor, rawTide, forecastWeather] = await Promise.all([
        fetchFimanData(SITE.retrievalPlatform, start, now, SITE.offsetFt),
        fetchNoaaPredictions(
          SITE.tideStation,
          new Date(+start - 2 * 3600_000),
          end,
        ),
        weatherForecast().catch(error => {
          degraded = true;
          logger.warn('Issued weather unavailable; numerical fallback remains independent', { event: 'forecast_weather_failed', provider: 'open_meteo', error: safeError(error) });
          return [];
        }),
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
      stage = 'numerical';
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
      stage = 'archive';
      inputPath = `forecast_input_archive/${SITE.id}/issues/${issuedAt.toISOString()}`;
      modelPath = typeof modelCache?.archivePath === 'string' ? modelCache.archivePath : null;
      await db.doc(inputPath).create(snapshot);
      if (document.status === "available" && isCurrentOutlook(cachedDocument, issuedAt) &&
          cachedDocument.explanationSource === 'gemini-3.8-flash' &&
          Date.parse(cachedDocument.generatedAt) >= +issuedAt - 65 * 60_000 &&
          cachedDocument.explanation.headline === document.explanation.headline &&
          validateExplanation(cachedDocument.explanation, document.evidence) &&
          cachedDocument.explanation.evidenceIds.includes('availability')) {
        // Gemini selects evidence IDs, not prose or numbers. Reusing a valid
        // selection binds it to this issue's freshly calculated evidence text.
        document.explanation = cachedDocument.explanation;
        document.explanationSource = 'gemini-3.8-flash';
      }
    } catch (error) {
      numericalError = error;
      logger.error('Numerical forecast update failed', { event: 'forecast_generation_failed', stage, error: safeError(error) });
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
      await recordJobOutcome(db, 'generateFloodOutlook', SITE.id, { attemptedAt: now.toISOString(), status: 'failed', stage, retainedGeneratedAt: cachedDocument.generatedAt, ...(numericalError ? { error: safeError(numericalError) } : { error: { message: 'Required observations unavailable or stale' } }) });
      throw new Error('Numerical update failed; existing outlook retained until its original expiry');
    }
    try {
      const published = await publishNumericalForecast(db, document, { inputPath: document.status === 'unavailable' ? null : inputPath, modelPath: document.status === 'unavailable' ? null : modelPath });
      if (!published) {
        // A newer concurrent issue or an idempotent retry already won. Never
        // renew its expiry or emit a second readiness marker.
        await recordJobOutcome(db, 'generateFloodOutlook', SITE.id, { attemptedAt: now.toISOString(), status: 'partial', stage: 'publish', skippedIssue: document.generatedAt, reason: 'Current publication retained' });
        return;
      }
    } catch (error) {
      await recordJobOutcome(db, 'generateFloodOutlook', SITE.id, { attemptedAt: now.toISOString(), status: 'failed', stage: 'publish', error: safeError(error) });
      throw error;
    }
    // Numeric availability is now committed independently of optional AI work.
    // The immutable archive/marker cannot be changed by a slow or failed reply.
    if (document.status === 'available') try {
      const issuedAt = new Date(document.generatedAt);
      const stateRef = db.doc(`forecast_explanation_state/${SITE.id}`);
      const reserved = await db.runTransaction(async transaction => {
        const state = await transaction.get(stateRef);
        if (!explanationIsDue(state.data()?.lastAttemptAt, issuedAt)) return false;
        transaction.set(stateRef, { lastAttemptAt: issuedAt.toISOString(), forecastIssue: document.generatedAt });
        return true;
      });
      if (reserved) try {
        const explained: ForecastDocument = { ...document, explanation: await explainWithGemini(document), explanationSource: 'gemini-3.8-flash' };
        await publishForecastExplanation(db, explained);
        document = explained;
      } catch (error) {
        degraded = true;
        logger.warn('Gemini explanation unavailable; calculated forecast remains intact', { event: 'gemini_explanation_failed', provider: 'vertex', model: 'gemini-3.8-flash', error: safeError(error) });
      }
    } catch (error) {
      degraded = true;
      logger.warn('Explanation scheduling unavailable', { event: 'gemini_schedule_failed', error: safeError(error) });
    }
    await recordJobOutcome(db, 'generateFloodOutlook', SITE.id, { attemptedAt: now.toISOString(), status: document.status === 'unavailable' ? 'failed' : degraded ? 'partial' : 'ok', stage, numericalGeneratedAt: document.generatedAt, observationAt: document.observationAt, explanationSource: document.explanationSource, ...(numericalError ? { error: safeError(numericalError) } : {}) });
    if (document.status === 'unavailable') throw new Error('No current numerical outlook could be generated');
  },
);
/** Public cached read; visitors cannot trigger training or Gemini spending. */
export const floodOutlook = onRequest(
  { cors: true, maxInstances: 5 },
  async (req, res) => {
    // Error responses must never inherit a cached success policy. Vary also
    // keeps CDN/browser caches from serving compressed bytes to other clients.
    res.set("Cache-Control", "no-store");
    res.vary('Accept-Encoding');
    if (req.method !== "GET") {
      res.set('Allow', 'GET');
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
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
      const encoded = await encodeJsonResponse(data, req.get('Accept-Encoding'));
      if (encoded.notAcceptable) { res.status(406).send(); return; }
      const remaining = Math.floor((Date.parse(data.expiresAt) - Date.now()) / 1000);
      if (remaining > 0) res.set("Cache-Control", `public, max-age=${Math.min(60, remaining)}, s-maxage=${Math.min(300, remaining)}`);
      if (encoded.contentEncoding) res.set('Content-Encoding', encoded.contentEncoding);
      res.type('application/json').send(encoded.body);
    } catch (error) {
      res.set('Cache-Control', 'no-store');
      res.removeHeader('Content-Encoding');
      logger.error('Cached outlook read failed', { event: 'forecast_read_failed', error: safeError(error) });
      res.status(503).json({ error: "Outlook unavailable" });
    }
  },
);

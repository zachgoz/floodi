/** Generate a real local forecast artifact without changing production Firestore. */
import { readFileSync } from "fs";
import { resolve } from "path";
import { FORECAST_TIDE_DAYS, points, SITE, weatherForecast } from "../forecast/sources";
import { fetchFimanData } from "../etl/fiman";
import { fetchNoaaPredictions } from "../etl/noaa";
import { buildGaugeForecast, restoreGaugeModel } from "../forecast/gaugePipeline";
import { archiveFingerprint, createLocalModelCache, LocalModelCache, LocalPreviewState, parseLocalHistory, restoreLocalModelCache, writeAtomicJson } from "../forecast/localPreview";
import { trainWeatherResponse } from "../forecast/weatherResponse";
import { validateForecast } from "../forecast/schema";
import { residuals } from "../forecast/water";
async function run() {
  const args = process.argv.slice(2);
  const path = args.find(arg => !arg.startsWith('--'));
  if (!path || args.some(arg => arg.startsWith('--') && arg !== '--reuse-model')) throw new Error("Provide the evaluation history JSON path and optional --reuse-model");
  const reuseModel = args.includes('--reuse-model');
  const historyPath = resolve(path);
  const bytes = readFileSync(historyPath, "utf8");
  const historical = JSON.parse(bytes);
  const fingerprint = archiveFingerprint(bytes);
  const now = new Date();
  const { history, tide: historicalTide, weather: historicalWeather } = parseLocalHistory(historical, now);
  let modelCache: LocalModelCache | null = null;
  if (reuseModel) {
    try { modelCache = JSON.parse(readFileSync('evaluation/preview-model.json', 'utf8')); }
    catch { /* A missing or partial private cache requires a real fit. */ }
  }
  let model = restoreLocalModelCache(modelCache, now, historyPath, fingerprint);
  const modelReused = !!model;
  const ref = { station: SITE.sensor, datum: SITE.datum, units: SITE.units };
  if (!model) {
    // Fit only the historical archive, never the current inference observations.
    model = trainWeatherResponse(history, historicalTide, historicalWeather, ref, ref);
    if (!model) throw new Error('Historical observations cannot support a local forecast model');
    modelCache = createLocalModelCache(model, now, historyPath, fingerprint);
    if (!restoreGaugeModel(modelCache.cache, now)) throw new Error('Local model validation failed; refresh the historical archive if its latest observations are over 14 days old');
    writeAtomicJson('evaluation/preview-model.json', modelCache);
  }
  const [sensor, raw, weather] = await Promise.all([
    fetchFimanData(
      SITE.retrievalPlatform,
      new Date(+now - 3 * 24 * 3600_000),
      now,
      SITE.offsetFt,
      false,
    ),
    fetchNoaaPredictions(
      SITE.tideStation,
      new Date(+now - 3 * 24 * 3600_000 - 2 * 3600_000),
      new Date(+now + FORECAST_TIDE_DAYS * 24 * 3600_000),
    ),
    weatherForecast().catch(() => []),
  ]);
  const tide = points(raw).map((p) => ({
    ...p,
    t: new Date(+p.t + SITE.phaseMinutes * 60_000),
  }));
  const forecast = buildGaugeForecast(
    [...history, ...residuals(points(sensor.waterLevels), tide, ref, ref)],
    historicalTide,
    historicalWeather,
    tide,
    weather,
    now,
    { model },
  );
  if (!validateForecast(forecast)) throw new Error("Invalid forecast schema");
  if (forecast.status === 'unavailable') throw new Error('Current gauge or weather inputs cannot support a forecast; retaining the prior artifact with its original expiry');
  writeAtomicJson('evaluation/preview-inputs.json', { historical, sensor, tide, weather, now, reference: ref });
  writeAtomicJson("evaluation/outlook.json", forecast, !reuseModel);
  const state: LocalPreviewState = {
    version: 1, historyPath, historyFingerprint: fingerprint,
    generatedAt: forecast.generatedAt, modelCreatedAt: modelCache!.cache.createdAt,
    modelReused, forecastMethod: forecast.method ?? 'unknown', forecastEndsAt: forecast.points.at(-1)!.t,
  };
  writeAtomicJson('evaluation/preview-state.json', state);
  if (reuseModel) {
    console.log(JSON.stringify({ status: forecast.status, method: forecast.method, generatedAt: forecast.generatedAt, points: forecast.points.length, endsAt: state.forecastEndsAt, modelReused }));
    return;
  }
  console.log(
    JSON.stringify(
      {
        status: forecast.status,
        method: forecast.method,
        extension: forecast.extension,
        tail: forecast.tail,
        generatedAt: forecast.generatedAt,
        points: forecast.points.length,
        currentResidual: forecast.currentResidualFt,
        trend: forecast.trend,
        explanation: forecast.evidence,
      },
      null,
      2,
    ),
  );
}
run().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});

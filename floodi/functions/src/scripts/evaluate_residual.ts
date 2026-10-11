/** Read-only evaluation. No Firestore writes, credentials or Gemini required. */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { collectHistory, SITE } from "../forecast/sources";
import { trainAndValidate, windAssociations, historicalRelationships } from "../forecast/model";
async function run() {
  const end = new Date(process.argv[2] || "2026-10-03T00:00:00Z");
  const start = new Date(+end - 90 * 24 * 3600_000);
  const dir = "evaluation";
  mkdirSync(dir, { recursive: true });
  const cache = `${dir}/gauge-${SITE.sensor}-history-${end.toISOString().slice(0, 10)}.json`;
  const raw = existsSync(cache)
    ? JSON.parse(readFileSync(cache, "utf8"))
    : await collectHistory(start, end);
  if (!existsSync(cache)) writeFileSync(cache, JSON.stringify(raw));
  const history = raw.history.map((p: { t: string; v: number }) => ({
    ...p,
    t: new Date(p.t),
  }));
  const tide = raw.tide.map((p: { t: string; v: number }) => ({
    ...p,
    t: new Date(p.t),
  }));
  const weather = raw.weather.map((p: { t: string }) => ({
    ...p,
    t: new Date(p.t),
  }));
  const trained = trainAndValidate(history, tide, weather, 5.6);
  const report = {
    evaluatedAt: new Date().toISOString(),
    metadata: raw.metadata,
    coverage: {
      residualPoints: history.length,
      tidePoints: tide.length,
      weatherHours: weather.length,
    },
    failures: raw.failures,
    validation: trained?.validation || null,
    windAssociations: windAssociations(history, weather),
    historicalRelationships: historicalRelationships(history, weather),
    features: trained?.model.columns || [],
    limitations: [
      "Reanalysis weather hindcast, excludes issued weather forecast error.",
      "Local phase/datum assumptions require calibration; no operational promotion.",
      "Directional means are descriptive, not independent statistical significance tests.",
    ],
  };
  writeFileSync(`${dir}/validation.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
run().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});

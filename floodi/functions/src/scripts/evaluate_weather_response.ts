/** Reproduce regional weather-response hindcast and same-pair ablation.
 * Local archive input/output only: no credentials, Gemini, network or cloud writes.
 * Usage: node lib/scripts/evaluate_weather_response.js <regional-archive.json> [report.json]
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { FEATURE_NAMES, fitRidge, predict, WeatherPoint } from '../forecast/model';
import {
  ResidualObservation, trainWeatherResponse, weatherResponseFeatures,
  WEATHER_RESPONSE_FEATURES, WEATHER_RESPONSE_LEADS,
  WEATHER_OBSERVATION_MAX_GAP_MS,
} from '../forecast/weatherResponse';
import { interpolate, Reference, WaterPoint } from '../forecast/water';

const HOUR = 3600_000;
const MAX_GAP = WEATHER_OBSERVATION_MAX_GAP_MS;
interface Archive {
  history: (Omit<ResidualObservation, 't'> & { t: string })[];
  tide: { t: string; v: number }[];
  weather: (Omit<WeatherPoint, 't'> & { t: string })[];
  metadata: {
    sensor: string; units: string; datum: string; end: string;
    sources?: { gauge?: string; parameter?: string; units?: string; datum?: string }[];
    [key: string]: unknown;
  };
  failures?: string[];
}
function water(points: Archive['history']): ResidualObservation[] {
  return [...new Map(points.filter(p => !p.estimated && Number.isFinite(Date.parse(p.t)) && Number.isFinite(p.v)).map(p => [p.t, { ...p, t: new Date(p.t) }])).values()].sort((a, b) => +a.t - +b.t);
}
function ablation(history: WaterPoint[], tide: WaterPoint[], weather: WeatherPoint[], cutoff: Date) {
  const results = [];
  const tideColumn = WEATHER_RESPONSE_FEATURES.indexOf('astronomicalTideChange');
  for (const leadHours of WEATHER_RESPONSE_LEADS) {
    const rows: { issue: number; target: number; x: number[]; y: number }[] = [];
    let anchorIndex = 0;
    for (let ms = Math.ceil((+history[0].t + 24 * HOUR) / HOUR) * HOUR; ms + leadHours * HOUR <= +history.at(-1)!.t; ms += HOUR) {
      while (anchorIndex + 1 < history.length && +history[anchorIndex + 1].t <= ms) anchorIndex++;
      const anchor = history[anchorIndex], target = new Date(ms + leadHours * HOUR);
      if (+anchor.t > ms || ms - +anchor.t > MAX_GAP) continue;
      const actual = interpolate(history, target, MAX_GAP);
      if (actual === null) continue;
      // Same complete inputs as the full model; subsets only avoid repeatedly
      // sorting the entire archive in this public feature-validation entry point.
      const x = weatherResponseFeatures(
        new Date(ms), target, anchor,
        history.filter(p => +p.t >= ms - 4 * HOUR && +p.t <= ms),
        tide.filter(p => +p.t >= ms - 15 * 60_000 && +p.t <= +target + 15 * 60_000),
        weather.filter(w => +w.t >= ms - 24 * HOUR && +w.t <= ms),
        weather.filter(w => +w.t > ms && +w.t <= +target), MAX_GAP,
      );
      if (x) rows.push({ issue: ms, target: +target, x: [x[0], x[1], x[tideColumn], ...Array(FEATURE_NAMES.length - 3).fill(0)], y: actual - anchor.v });
    }
    const training = rows.filter(r => r.target < +cutoff), test = rows.filter(r => r.issue >= +cutoff);
    const fitted = fitRidge(training);
    results.push({
      leadHours, trainingPairs: training.length, testPairs: test.length,
      anchorTrendAndTideChangeOnlyMaeFt: fitted && test.length ? test.reduce((s, row) => s + Math.abs(predict(fitted, row.x)! - row.y), 0) / test.length : null,
    });
  }
  return results;
}
function run() {
  const input = process.argv[2];
  if (!input) throw new Error('Provide the provenance-bearing regional gauge archive JSON path');
  const archive = JSON.parse(readFileSync(input, 'utf8')) as Archive;
  if (archive.metadata?.sensor !== '30046' || archive.metadata.units !== 'ft' || archive.metadata.datum !== 'MLLW' || !archive.metadata.sources?.length || archive.metadata.sources.some(s => s.gauge !== '30046' || !/^FIMAN \(observed\)$/i.test(s.parameter || '') || !['ft', 'm'].includes(s.units || '') || !/NAVD88/i.test(s.datum || ''))) {
    throw new Error('Verified gauge 30046 identity, original units/datum and normalized ft MLLW archive metadata required');
  }
  const history = water(archive.history), tide = water(archive.tide);
  const weather = [...new Map(archive.weather.filter(w => Number.isFinite(Date.parse(w.t))).map(w => [w.t, { ...w, t: new Date(w.t) }])).values()].sort((a, b) => +a.t - +b.t);
  const ref: Reference = { station: '30046', datum: 'MLLW', units: 'ft' };
  const model = trainWeatherResponse(history, tide, weather, ref, ref, { maxObservationGapMs: MAX_GAP });
  if (!model) throw new Error('Insufficient compatible measured history for a weather-response evaluation');
  const baseline = ablation(history, tide, weather, model.holdoutStarts);
  const comparison = model.validation.leads.map(lead => {
    const tideBaseline = baseline.find(b => b.leadHours === lead.leadHours)!;
    if (tideBaseline.trainingPairs !== lead.trainingPairs || tideBaseline.testPairs !== lead.testPairs) throw new Error(`Ablation pair coverage differs at ${lead.leadHours}h`);
    const improvementVsTideTrend = lead.modelMaeFt !== null && tideBaseline.anchorTrendAndTideChangeOnlyMaeFt !== null && tideBaseline.anchorTrendAndTideChangeOnlyMaeFt > 0 ? 1 - lead.modelMaeFt / tideBaseline.anchorTrendAndTideChangeOnlyMaeFt : null;
    return { ...lead, anchorTrendAndTideChangeOnlyMaeFt: tideBaseline.anchorTrendAndTideChangeOnlyMaeFt, improvementVsTideTrend };
  });
  const report = {
    evaluatedAt: new Date().toISOString(), inputArchive: input, metadata: archive.metadata,
    coverage: { measuredResiduals: history.length, tidePoints: tide.length, weatherHours: weather.length, maxObservationGapMinutes: MAX_GAP / 60_000 },
    training: { method: 'Lead-specific standardized ridge residual-change regression; fixed penalty 20', split: 'Chronological first 70% training / last 30% testing; training targets purged at holdout boundary', testStart: model.testStart, testEnd: model.testEnd, features: WEATHER_RESPONSE_FEATURES },
    validation: { ...model.validation, leads: comparison },
    shortRangeValidation: model.shortRange ? { ...model.shortRange, regressions: undefined } : null,
    failures: archive.failures || [],
    limitations: [...model.limitations, 'The tide/trend ablation uses precisely the same valid training and test pairs as the full weather model.', 'Weather improvements are associative predictive evidence, not causal or significance claims.', 'The 90th percentile absolute error is a hindcast error summary, not a calibrated forecast probability interval.', 'Limited-confidence adoption does not claim validated issued-weather or event-detection accuracy.'],
  };
  const output = process.argv[3] || join(dirname(input), `weather-response-analysis-${String(archive.metadata.end).slice(0, 10)}.json`);
  writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, coverage: report.coverage, testStart: model.testStart, testEnd: model.testEnd, validation: report.validation }, null, 2));
}
try { run(); } catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; }

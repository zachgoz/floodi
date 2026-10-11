/** Public-data, read-only collection for the dashboard's actual regional gauge.
 * Does not call Gemini, access credentials, or write Firebase data.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import fetch from 'node-fetch';
import { fetchNoaaPredictions } from '../etl/noaa';
import { regionalGaugeLevels, SensorParameter } from '../forecast/sensor';
import { points, SITE, weatherHistory } from '../forecast/sources';
import { residuals } from '../forecast/water';

const DAY = 24 * 3600_000;
const endpoint = 'https://data.sunnydayflooding.com/services/data.php';

async function regionalWeek(start: Date, end: Date) {
  const params = new URLSearchParams({
    format: 'json', pretty: 'true',
    time: `${start.toISOString().split('.')[0]}Z/${end.toISOString().split('.')[0]}Z`,
    platform: SITE.retrievalPlatform, datum: SITE.datum, allStations: 'true',
    standard: 'false', qcFilter: 'false', dataView: 'less', health: 'summary', www: 'true',
  });
  const response = await fetch(`${endpoint}?${params}`, { timeout: 40_000 });
  if (!response.ok) throw new Error(`Sunny Day Flooding HTTP ${response.status}`);
  const body = await response.json() as { features?: { properties?: { platform_id?: string; parameters?: SensorParameter[] } }[] };
  const feature = body.features?.find(f => f.properties?.platform_id?.toUpperCase() === SITE.retrievalPlatform);
  const parameters = feature?.properties?.parameters || [];
  const source = parameters.find(p => /^FIMAN \(observed\)$/i.test(p.id));
  if (!source || !/id=30046\b/.test(source.www?.description || '')) throw new Error('Regional gauge 30046 source identity unavailable');
  return {
    waterLevels: regionalGaugeLevels([source], SITE.offsetFt),
    source: { platform: SITE.retrievalPlatform, gauge: '30046', parameter: source.id, units: source.units, datum: source.www?.uom_ts_suffix, description: source.www?.description, rawCount: source.observations?.times.length },
  };
}

async function run() {
  const end = new Date(process.argv[2] || '2026-10-03T00:00:00Z');
  const days = Number(process.argv[3] || 90);
  if (!Number.isFinite(+end) || !Number.isFinite(days) || days < 1 || days > 366) throw new Error('Valid end UTC date and 1–366 day history required');
  const start = new Date(+end - days * DAY);
  const dir = 'evaluation';
  mkdirSync(`${dir}/regional-source-cache`, { recursive: true });
  const observed: Record<string, number> = {};
  const predicted: Record<string, number> = {};
  const failures: string[] = [];
  const sources: unknown[] = [];
  for (let ms = +start; ms < +end; ms += 7 * DAY) {
    const a = new Date(ms);
    const b = new Date(Math.min(ms + 7 * DAY, +end));
    const cache = `${dir}/regional-source-cache/${a.toISOString().slice(0, 10)}-${b.toISOString().slice(0, 10)}.json`;
    try {
      const week = existsSync(cache) ? JSON.parse(readFileSync(cache, 'utf8')) : await (async () => {
        const [regional, tide] = await Promise.all([regionalWeek(a, b), fetchNoaaPredictions(SITE.tideStation, new Date(+a - 2 * 3600_000), b)]);
        return { ...regional, tide, retrievedAt: new Date().toISOString() };
      })();
      if (!existsSync(cache)) writeFileSync(cache, JSON.stringify(week));
      Object.assign(observed, week.waterLevels);
      Object.assign(predicted, week.tide);
      sources.push({ start: a.toISOString(), end: b.toISOString(), ...week.source, retrievedAt: week.retrievedAt });
      console.log(`${a.toISOString().slice(0, 10)}: ${Object.keys(week.waterLevels).length} regional observations`);
    } catch (e) {
      failures.push(`${a.toISOString().slice(0, 10)}: ${e instanceof Error ? e.message : 'unavailable'}`);
    }
  }
  const tide = points(predicted).map(p => ({ ...p, t: new Date(+p.t + SITE.phaseMinutes * 60_000) }));
  const reference = { station: '30046', datum: SITE.datum, units: SITE.units };
  const history = residuals(points(observed), tide, reference, reference);
  const matchingWeatherCache = `${dir}/local-raw-history-${end.toISOString().slice(0, 10)}.json`;
  let weather: unknown[] = [];
  try {
    const existing = existsSync(matchingWeatherCache) ? JSON.parse(readFileSync(matchingWeatherCache, 'utf8')) : null;
    weather = existing?.metadata?.start === start.toISOString() && existing?.metadata?.end === end.toISOString() ? existing.weather : await weatherHistory(start, end);
  } catch (e) { failures.push(`Weather: ${e instanceof Error ? e.message : 'unavailable'}`); }
  const archive = {
    observed: points(observed), history, tide, weather, failures,
    metadata: {
      sensor: '30046', name: 'FIMAN Myrtle Grove Sound at Canal Drive / Sandpiper Lane',
      retrievalPlatform: SITE.retrievalPlatform, observationSeries: 'FIMAN (observed)',
      observationSource: endpoint, observationInfo: 'https://fiman.nc.gov/?id=30046',
      tideStation: SITE.tideStation, tideSource: 'NOAA six-minute astronomical predictions',
      datum: SITE.datum, units: SITE.units, originalDatum: 'NAVD88',
      navd88ToMllwFt: SITE.offsetFt, phaseMinutes: SITE.phaseMinutes,
      calibration: 'Existing app conversion and one-hour tide phase; neither independently validated for regional gauge.',
      quality: 'Bad, suspect and missing quality flags excluded. Provider non-evaluated records may remain.',
      weather: 'Open-Meteo reanalysis, UTC, mph, inches, MSL pressure hPa',
      start: start.toISOString(), end: end.toISOString(), retrievedAt: new Date().toISOString(), sources,
    },
  };
  const output = `${dir}/regional-gauge-history-${end.toISOString().slice(0, 10)}-${days}d.json`;
  writeFileSync(output, JSON.stringify(archive));
  console.log(JSON.stringify({ output, observations: archive.observed.length, residuals: history.length, tide: tide.length, weather: weather.length, failures }, null, 2));
}

run().catch(e => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });

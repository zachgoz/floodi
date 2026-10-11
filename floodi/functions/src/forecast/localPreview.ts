/** Private local model reuse. This module is never served to the browser. */
import { createHash, randomBytes } from 'crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { GaugeModelCache, restoreGaugeModel, serializeGaugeModel } from './gaugePipeline';
import { WeatherPoint } from './model';
import { SITE } from './sources';
import { WaterPoint } from './water';
import { ResidualObservation, WeatherResponseModel } from './weatherResponse';

const HOUR = 3600_000;
export const LOCAL_MODEL_REFRESH_MS = 24 * HOUR;
export interface LocalModelCache {
  version: 1;
  historyPath: string;
  historyFingerprint: string;
  cache: GaugeModelCache;
}
export interface LocalPreviewState {
  version: 1;
  historyPath: string;
  historyFingerprint: string;
  generatedAt: string;
  modelCreatedAt: string;
  modelReused: boolean;
  forecastMethod: string;
  forecastEndsAt: string;
}
export interface LocalHistory {
  history: ResidualObservation[];
  tide: WaterPoint[];
  weather: WeatherPoint[];
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const iso = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*Z$/.test(value) && Number.isFinite(Date.parse(value));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export const archiveFingerprint = (bytes: string): string => createHash('sha256').update(bytes).digest('hex');

/** Enforce the same physical reference before either fitting or cache reuse.
 * An archive with future observations must not become a training shortcut.
 */
export function parseLocalHistory(value: unknown, now: Date): LocalHistory {
  if (!Number.isFinite(+now) || !record(value) || !record(value.metadata)) throw new Error('Invalid local history archive');
  const meta = value.metadata;
  if (meta.sensor !== SITE.sensor || meta.tideStation !== SITE.tideStation || meta.datum !== SITE.datum || meta.units !== SITE.units || meta.phaseMinutes !== SITE.phaseMinutes || meta.navd88ToMllwFt !== SITE.offsetFt) throw new Error('Archive reference differs from the configured dashboard gauge');
  const water = (rows: unknown, observations: boolean): ResidualObservation[] => {
    if (!Array.isArray(rows) || !rows.length || !rows.every(p => record(p) && iso(p.t) && finite(p.v) && (!observations || Date.parse(p.t) <= +now) && (p.estimated === undefined || typeof p.estimated === 'boolean'))) throw new Error('Archive has invalid or future water observations');
    return rows.map(p => ({ t: new Date(p.t), v: p.v, ...(p.estimated !== undefined ? { estimated: p.estimated } : {}) }));
  };
  if (!Array.isArray(value.weather) || !value.weather.every(w => record(w) && iso(w.t) && Date.parse(w.t) <= +now && ['windSpeed', 'windDirection', 'gust', 'precip', 'pressure'].every(key => w[key] === undefined || finite(w[key])))) throw new Error('Archive has invalid or future weather observations');
  return { history: water(value.history, true), tide: water(value.tide, false), weather: value.weather.map(w => ({ ...w, t: new Date(w.t) })) };
}

export function createLocalModelCache(model: WeatherResponseModel, now: Date, historyPath: string, fingerprint: string): LocalModelCache {
  return {
    version: 1, historyPath: resolve(historyPath), historyFingerprint: fingerprint,
    cache: serializeGaugeModel(model, now, `forecast-training/${SITE.id}/local/${fingerprint}/history.json`),
  };
}

/** The production validator also rejects old fits, wrong datums and fake gates.
 * Daily local reuse adds archive identity and a tighter 24-hour age bound.
 */
export function restoreLocalModelCache(value: unknown, now: Date, historyPath: string, fingerprint: string): WeatherResponseModel | null {
  if (!Number.isFinite(+now) || !record(value) || value.version !== 1 || value.historyPath !== resolve(historyPath) || value.historyFingerprint !== fingerprint || !/^[a-f0-9]{64}$/.test(fingerprint) || !record(value.cache) || !iso(value.cache.createdAt) || +now - Date.parse(value.cache.createdAt) >= LOCAL_MODEL_REFRESH_MS || value.cache.trainingPath !== `forecast-training/${SITE.id}/local/${fingerprint}/history.json`) return null;
  return restoreGaugeModel(value.cache, now);
}

/** Rename in the same directory so readers always see a complete JSON file. */
export function writeAtomicJson(path: string, value: unknown, pretty = false): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(value, null, pretty ? 2 : undefined), { mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

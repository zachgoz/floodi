import { historicalOutlookFixture } from '../fixtures/historicalOutlook';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { floodOutlook, generateFloodOutlook, refreshResidualHistory } from '../../../functions/src/forecast/jobs';
import { serializeGaugeModel } from '../../../functions/src/forecast/gaugePipeline';
import { collectHistory, FORECAST_TIDE_DAYS, SITE, weatherForecast } from '../../../functions/src/forecast/sources';
import { explainWithGemini } from '../../../functions/src/forecast/gemini';
import { fetchFimanData } from '../../../functions/src/etl/fiman';
import { fetchNoaaPredictions } from '../../../functions/src/etl/noaa';
import { trainWeatherResponse, LONG_RANGE_FEATURES, LONG_RANGE_LEADS, WEATHER_RESPONSE_FEATURES, WEATHER_RESPONSE_LEADS, WeatherResponseModel } from '../../../functions/src/forecast/weatherResponse';
import { publishNumericalForecast } from '../../../functions/src/forecast/publication';
import type { Explanation, ForecastDocument } from '../../../functions/src/forecast/schema';

const backend = vi.hoisted(() => {
  const records = new Map<string, unknown>();
  const logs: { level: string; details: Record<string, unknown> }[] = [];
  const schedules: { schedule: string }[] = [];
  const save = vi.fn(async (_data: unknown, _options: unknown) => undefined);
  const file = vi.fn(() => ({ save }));
  const doc = vi.fn((path: string) => ({
    path,
    get: vi.fn(async () => ({ exists: records.has(path), data: () => records.get(path) })),
    set: vi.fn(async (value: unknown) => { records.set(path, value); }),
    create: vi.fn(async (value: unknown) => {
      if (records.has(path)) throw new Error('Immutable document already exists');
      records.set(path, value);
    }),
  }));
  type Ref = ReturnType<typeof doc>;
  type Operation = { ref: Ref; value: Record<string, unknown>; create?: boolean; merge?: boolean };
  const runTransaction = vi.fn(async (work: (transaction: {
    get: (ref: Ref) => ReturnType<Ref['get']>;
    set: (ref: Ref, value: Record<string, unknown>, options?: { merge?: boolean }) => void;
    create: (ref: Ref, value: Record<string, unknown>) => void;
  }) => unknown) => {
    const pending: Operation[] = [];
    const result = await work({
      get: ref => ref.get(),
      set: (ref, value, options) => { pending.push({ ref, value, merge: options?.merge }); },
      create: (ref, value) => { pending.push({ ref, value, create: true }); },
    });
    // Validate every precondition before applying ANY write, like Firestore.
    for (const entry of pending) if (entry.create && records.has(entry.ref.path)) throw new Error('Immutable document already exists');
    const committedAt = Date.now();
    for (const entry of pending) {
      const value = Object.fromEntries(Object.entries(entry.value).map(([key, value]) => [key,
        value && typeof value === 'object' && 'methodName' in value && value.methodName === 'FieldValue.serverTimestamp' ? { toDate: () => new Date(committedAt), toMillis: () => committedAt } : value,
      ]));
      records.set(entry.ref.path, entry.merge ? { ...records.get(entry.ref.path) as object, ...value } : value);
    }
    return result;
  });
  return { records, schedules, save, file, doc, runTransaction, logs };
});
vi.mock('../../../functions/node_modules/firebase-functions/lib/logger/index.js', () => Object.fromEntries(['info', 'warn', 'error'].map(level => [level, (_message: string, details: Record<string, unknown>) => backend.logs.push({ level, details })])));
vi.mock('../../../functions/node_modules/firebase-admin/lib/index.js', () => ({
  apps: [{}], initializeApp: vi.fn(), firestore: () => ({ doc: backend.doc, runTransaction: backend.runTransaction }),
  storage: () => ({ bucket: () => ({ file: backend.file }) }),
}));
vi.mock('../../../functions/node_modules/firebase-functions/lib/v2/providers/scheduler.js', () => ({ onSchedule: (options: { schedule: string }, handler: unknown) => { backend.schedules.push(options); return handler; } }));
vi.mock('../../../functions/node_modules/firebase-functions/lib/v2/providers/https.js', () => ({ onRequest: (_options: unknown, handler: unknown) => handler }));
vi.mock('../../../functions/src/forecast/sources', async () => ({ ...(await vi.importActual<typeof import('../../../functions/src/forecast/sources')>('../../../functions/src/forecast/sources')), collectHistory: vi.fn(), weatherForecast: vi.fn() }));
vi.mock('../../../functions/src/forecast/weatherResponse', async () => ({ ...(await vi.importActual<typeof import('../../../functions/src/forecast/weatherResponse')>('../../../functions/src/forecast/weatherResponse')), trainWeatherResponse: vi.fn() }));
vi.mock('../../../functions/src/forecast/gemini', () => ({ explainWithGemini: vi.fn() }));
vi.mock('../../../functions/src/etl/fiman', () => ({ fetchFimanData: vi.fn() }));
vi.mock('../../../functions/src/etl/noaa', () => ({ fetchNoaaPredictions: vi.fn() }));
vi.mock('../../../functions/src/forecast/challenger', () => ({ runTimesFmChallenger: vi.fn().mockResolvedValue(null) }));

const HOUR = 3600_000;
const initialNow = new Date('2026-10-10T12:00:00Z');
const runForecast = generateFloodOutlook as unknown as () => Promise<void>;
const runHistory = refreshResidualHistory as unknown as () => Promise<void>;
const liveDoc = 'locations/carolina-beach/outlook/current';
const reference = { station: '30046', datum: 'MLLW', units: 'ft' };
function model(): WeatherResponseModel {
  return {
    reference, tideReference: reference, maxObservationGapMs: 30 * 60_000 + 10_000,
    trainedUntil: new Date(+initialNow - 7 * 24 * HOUR), holdoutStarts: new Date(+initialNow - 30 * 24 * HOUR),
    testStart: new Date(+initialNow - 30 * 24 * HOUR), testEnd: new Date(+initialNow - 7 * 24 * HOUR),
    regressions: WEATHER_RESPONSE_LEADS.map(leadHours => ({ leadHours, model: {
      means: WEATHER_RESPONSE_FEATURES.map(() => 0), scales: WEATHER_RESPONSE_FEATURES.map(() => 1), coefficients: WEATHER_RESPONSE_FEATURES.map(() => 0), intercept: .2,
      minimums: WEATHER_RESPONSE_FEATURES.map(() => -2000), maximums: WEATHER_RESPONSE_FEATURES.map(() => 2000),
    } })),
    validation: {
      leads: WEATHER_RESPONSE_LEADS.map(leadHours => ({ leadHours, trainingPairs: 300, testPairs: 120, modelMaeFt: .15, persistenceMaeFt: .25, improvement: .4, absoluteError90Ft: .4, passes: true })),
      peakWindows: 8, peakMaeFt: .15, persistencePeakMaeFt: .2, eligible: true, pointEligible: true, weatherInput: 'reanalysis hindcast',
    }, limitations: ['Synthetic fixture tests scheduling and provenance, not forecasting skill.'],
  };
}
function multiDayModel(): WeatherResponseModel {
  const candidate = model();
  candidate.longRange = {
      peakByDay: [],
      regressions: LONG_RANGE_LEADS.map(leadHours => ({ leadHours, model: {
        means: LONG_RANGE_FEATURES.map(() => 0), scales: LONG_RANGE_FEATURES.map(() => 1), coefficients: LONG_RANGE_FEATURES.map(() => 0), intercept: .2,
        minimums: LONG_RANGE_FEATURES.map(() => -2000), maximums: LONG_RANGE_FEATURES.map(() => 2000),
      } })),
      leads: LONG_RANGE_LEADS.map(leadHours => ({ leadHours, trainingPairs: 300, testPairs: 120, modelMaeFt: .15, persistenceMaeFt: .25, improvement: .4, absoluteError90Ft: .6, passes: true })),
      eligible: true, peakWindows: 12, peakMaeFt: .14, persistencePeakMaeFt: .22,
    };
  candidate.shortRange = {
    regressions: candidate.regressions.slice(0, 3), leads: candidate.validation.leads.slice(0, 3),
    eligible: true, peakWindows: 12, peakMaeFt: .14, persistencePeakMaeFt: .22,
  };
  return candidate;
}
function recentDayRecord() {
  return Object.fromEntries(Array.from({ length: 281 }, (_, i) => [new Date(Date.now() - 41 * 60_000 - 28 * HOUR + i * 6 * 60_000).toISOString(), 4.8 + i * .001]));
}

function waterRecord() {
  return Object.fromEntries(Array.from({ length: (3 + FORECAST_TIDE_DAYS) * 24 * 10 + 1 }, (_, i) => [new Date(Date.now() - 3 * 24 * HOUR + i * 6 * 60_000).toISOString(), 4 + .3 * Math.sin(i / 20)]));
}
function measuredRecord() {
  return Object.fromEntries(Array.from({ length: 31 }, (_, i) => [new Date(Date.now() - 41 * 60_000 - 3 * HOUR + i * 6 * 60_000).toISOString(), 4.8 + i * .005]));
}
function issuedWeather() {
  const hour = Math.floor(Date.now() / HOUR) * HOUR;
  return Array.from({ length: (3 + 16) * 24 + 1 }, (_, i) => ({ t: new Date(hour - 72 * HOUR + i * HOUR), windSpeed: 12, windDirection: 45, pressure: 1015, precip: 0 }));
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(initialNow);
  vi.clearAllMocks();
  backend.records.clear();
  backend.logs.length = 0;
  const cache = serializeGaugeModel(model(), initialNow, 'forecast-training/carolina-beach/2026-10-10/history.json');
  backend.records.set('forecast_models/carolina-beach', { ...cache, archivePath: 'forecast_model_archive/carolina-beach/models/2026-10-10' });
  vi.mocked(fetchFimanData).mockImplementation(async () => ({ waterLevels: measuredRecord(), imagery: {} }));
  vi.mocked(fetchNoaaPredictions).mockImplementation(async () => waterRecord());
  vi.mocked(weatherForecast).mockImplementation(async () => issuedWeather());
  vi.mocked(trainWeatherResponse).mockReturnValue(model());
  vi.mocked(explainWithGemini).mockResolvedValue({ headline: 'Flood outlook', evidenceIds: ['availability'] });
  vi.mocked(collectHistory).mockResolvedValue({ history: [], tide: [], weather: [], failures: [], metadata: { start: '2026-07-05T00:00:00Z', end: '2026-10-03T00:00:00Z', sensor: SITE.sensor, retrievalPlatform: SITE.retrievalPlatform, sensorSeries: 'FIMAN (observed), gauge 30046', tideStation: SITE.tideStation, datum: SITE.datum, units: SITE.units, phaseMinutes: SITE.phaseMinutes, navd88ToMllwFt: SITE.offsetFt, calibration: 'Fixture reference', weather: 'gridded reanalysis' } });
});
afterEach(() => { vi.useRealTimers(); });

describe('scheduled numerical forecast and private issued-input archive', () => {
  it('schedules daily fitting and ten-minute numerical updates separately', () => {
    expect(backend.schedules.map(options => options.schedule)).toEqual(['every 24 hours', 'every 10 minutes']);
  });
  it('fits once in the daily job and projects the cached model without retraining', async () => {
    await runHistory();
    expect(trainWeatherResponse).toHaveBeenCalledTimes(1);
    expect(backend.save.mock.calls[0][1]).toMatchObject({ preconditionOpts: { ifGenerationMatch: 0 } });
    const pointer = backend.records.get('forecast_models/carolina-beach') as { archivePath: string };
    expect(backend.records.has(pointer.archivePath)).toBe(true);
    await runForecast();
    expect(trainWeatherResponse).toHaveBeenCalledTimes(1);
    const document = backend.records.get(liveDoc) as { status: string; confidence: string };
    expect(document.status).toBe('available');
    expect(document.confidence).toBe('limited');
  });
  it('retains the daily working model when insufficient history cannot produce a valid replacement', async () => {
    const previous = backend.records.get('forecast_models/carolina-beach');
    vi.mocked(trainWeatherResponse).mockReturnValueOnce(null);
    await expect(runHistory()).rejects.toThrow('retaining the previous model pointer');
    expect(backend.records.get('forecast_models/carolina-beach')).toBe(previous);
    expect([...backend.records.keys()].filter(path => path.startsWith('forecast_model_archive/'))).toHaveLength(0);
  });
  it.each(['source-error', 'missing-observations', 'invalid-model'] as const)('retains a still-valid calculated issue with its original expiry during %s', async failure => {
    await runForecast();
    const previous = backend.records.get(liveDoc);
    vi.setSystemTime(new Date(+initialNow + 10 * 60_000));
    if (failure === 'source-error') vi.mocked(fetchFimanData).mockRejectedValueOnce(new Error('Provider unavailable'));
    if (failure === 'missing-observations') vi.mocked(fetchFimanData).mockResolvedValueOnce({ waterLevels: {}, imagery: {} });
    if (failure === 'invalid-model') backend.records.set('forecast_models/carolina-beach', { version: 'old' });
    await expect(runForecast()).rejects.toThrow('existing outlook retained');
    expect(backend.records.get(liveDoc)).toBe(previous);
    expect([...backend.records.keys()].filter(path => path.startsWith('forecast_archive/'))).toHaveLength(1);
    expect(explainWithGemini).toHaveBeenCalledTimes(1);
  });
  it('stops retaining the previous issue at its actual expiry when providers remain unavailable', async () => {
    await runForecast();
    const previous = backend.records.get(liveDoc) as { expiresAt: string };
    vi.setSystemTime(new Date(previous.expiresAt));
    vi.mocked(fetchFimanData).mockRejectedValueOnce(new Error('Provider unavailable'));
    await expect(runForecast()).rejects.toThrow('No current numerical outlook');
    expect(backend.records.get(liveDoc)).toMatchObject({ status: 'unavailable', points: [] });
    expect(backend.records.get(liveDoc)).not.toBe(previous);
  });
  it('preserves exact weather, actual water, references and model vectors in an immutable private issue', async () => {
    await runForecast();
    const path = `forecast_input_archive/carolina-beach/issues/${initialNow.toISOString()}`;
    const snapshot = backend.records.get(path) as { issuedAt: string; weather: unknown[]; measuredWater: unknown; model: unknown; reference: unknown };
    expect(snapshot.issuedAt).toBe(initialNow.toISOString());
    expect(snapshot.weather).toEqual(issuedWeather().map(point => ({ ...point, t: point.t.toISOString() })));
    expect(snapshot.measuredWater).toEqual(measuredRecord());
    expect(snapshot.model).toMatchObject({ reference, regressions: model().regressions });
    expect(snapshot.reference).toMatchObject({ ...reference, tideStation: SITE.tideStation, phaseMinutes: SITE.phaseMinutes, offsetFt: SITE.offsetFt });
    expect(JSON.stringify(snapshot).length).toBeLessThan(512_000);
    expect(path.startsWith('locations/')).toBe(false);
    await expect(backend.doc(path).create({ replacement: true })).rejects.toThrow('Immutable document');
    expect(backend.records.get(path)).toBe(snapshot);
  });
  it('fetches the full future tide horizon and safely archives a complete three-day learned outlook', async () => {
    const candidate = multiDayModel();
    const cache = serializeGaugeModel(candidate, initialNow, 'forecast-training/carolina-beach/2026-10-10/history.json');
    backend.records.set('forecast_models/carolina-beach', { ...cache, archivePath: 'forecast_model_archive/carolina-beach/models/2026-10-10' });
    vi.mocked(fetchFimanData).mockResolvedValueOnce({ waterLevels: recentDayRecord(), imagery: {} });
    await runForecast();
    expect(vi.mocked(fetchNoaaPredictions).mock.calls[0][2]).toEqual(new Date(+initialNow + FORECAST_TIDE_DAYS * 24 * HOUR));
    const document = backend.records.get(liveDoc) as { points: { t: string }[]; forecastOriginAt: string; extension: { method: string } };
    expect(document.extension.method).toBe('residual-reversion');
    expect(Date.parse(document.points.at(-1)!.t)).toBeGreaterThan(Date.parse(document.forecastOriginAt) + 71 * HOUR);
    const snapshot = backend.records.get(`forecast_input_archive/carolina-beach/issues/${initialNow.toISOString()}`);
    expect(Buffer.byteLength(JSON.stringify(snapshot), 'utf8')).toBeLessThan(512_000);
    expect(trainWeatherResponse).not.toHaveBeenCalled();
  });
  it('retains the three-day measured-residual outlook when the weather provider is unavailable', async () => {
    const cache = serializeGaugeModel(multiDayModel(), initialNow, 'forecast-training/carolina-beach/2026-10-10/history.json');
    backend.records.set('forecast_models/carolina-beach', { ...cache, archivePath: 'forecast_model_archive/carolina-beach/models/2026-10-10' });
    vi.mocked(fetchFimanData).mockResolvedValueOnce({ waterLevels: recentDayRecord(), imagery: {} });
    vi.mocked(weatherForecast).mockRejectedValueOnce(new Error('Weather unavailable'));
    await runForecast();
    const document = backend.records.get(liveDoc) as { status: string; method: string; extension: { method: string }; limitations: string[] };
    expect(document.status).toBe('available');
    expect(document.method).toBe('residual-response');
    expect(document.extension.method).toBe('residual-reversion');
    expect(document.limitations).toContain('Issued weather is unavailable; only measured residual and astronomical-tide methods are used.');
    const snapshot = backend.records.get(`forecast_input_archive/carolina-beach/issues/${initialNow.toISOString()}`) as { sources: { weatherAvailable: boolean; weatherRetrievedAt: string | null }; weather: unknown[] };
    expect(snapshot.sources.weatherAvailable).toBe(false);
    expect(snapshot.sources.weatherRetrievedAt).toBeNull();
    expect(snapshot.weather).toEqual([]);
  });
  it('publishes the entire NOAA endpoint with supported weather and compact historical context while staying inside archive limits', async () => {
    const candidate = multiDayModel(); candidate.historicalOutlook = historicalOutlookFixture(true);
    const cache = serializeGaugeModel(candidate, initialNow, 'forecast-training/carolina-beach/2026-10-10/history.json');
    backend.records.set('forecast_models/carolina-beach', { ...cache, archivePath: 'forecast_model_archive/carolina-beach/models/2026-10-10' });
    await runForecast();
    const document = backend.records.get(liveDoc) as { status: string; tail: { endsAt: string; weatherSupportedUntil: string; summary: { historicalEligible: boolean } }; points: unknown[] };
    expect(document.status).toBe('available');
    expect(Date.parse(document.tail.endsAt)).toBeGreaterThan(+initialNow + 21 * 24 * HOUR);
    expect(document.tail.weatherSupportedUntil).toBe(issuedWeather().at(-1)!.t.toISOString());
    expect(document.tail.summary.historicalEligible).toBe(false);
    expect(document.points.length).toBeGreaterThan(2000);
    expect(Buffer.byteLength(JSON.stringify(document), 'utf8')).toBeLessThan(1_000_000);
    const snapshot = backend.records.get(`forecast_input_archive/carolina-beach/issues/${initialNow.toISOString()}`);
    expect(Buffer.byteLength(JSON.stringify(snapshot), 'utf8')).toBeLessThan(512_000);
    expect(trainWeatherResponse).not.toHaveBeenCalled();
  });
  it('caps Gemini attempts at one per hour, including provider failures, while numerical updates continue', async () => {
    vi.mocked(explainWithGemini).mockRejectedValue(new Error('Provider unavailable'));
    await runForecast();
    vi.setSystemTime(new Date(+initialNow + 10 * 60_000));
    await runForecast();
    expect(explainWithGemini).toHaveBeenCalledTimes(1);
    expect((backend.records.get(liveDoc) as { status: string; explanationSource: string }).status).toBe('available');
    expect((backend.records.get(liveDoc) as { explanationSource: string }).explanationSource).toBe('fallback');
    vi.setSystemTime(new Date(+initialNow + HOUR));
    await runForecast();
    expect(explainWithGemini).toHaveBeenCalledTimes(2);
    expect([...backend.records.keys()].filter(path => path.startsWith('forecast_input_archive/'))).toHaveLength(3);
    expect(trainWeatherResponse).not.toHaveBeenCalled();
  });
  it('preserves safe Vertex failure diagnostics and exposes partial health without losing numerical output', async () => {
    const error = Object.assign(new Error('Generic transport failure'), { response: { status: 403, data: { error: { status: 'PERMISSION_DENIED', message: 'Vertex model access denied' } } }, config: { headers: { Authorization: 'Bearer private-test-credential' }, data: 'complete forecast payload' } });
    vi.mocked(explainWithGemini).mockRejectedValueOnce(error);
    await runForecast();
    expect(backend.records.get(liveDoc)).toMatchObject({ status: 'available', explanationSource: 'fallback' });
    expect(backend.logs).toContainEqual(expect.objectContaining({ level: 'warn', details: expect.objectContaining({ event: 'gemini_explanation_failed', error: expect.objectContaining({ httpStatus: 403, apiStatus: 'PERMISSION_DENIED', message: 'Vertex model access denied' }) }) }));
    expect(backend.records.get('operationalHealth/generateFloodOutlook_carolina-beach')).toMatchObject({ status: 'partial', explanationSource: 'fallback', numericalGeneratedAt: initialNow.toISOString() });
    expect(JSON.stringify(backend.logs)).not.toContain('private-test-credential');
    expect(JSON.stringify(backend.logs)).not.toContain('complete forecast payload');
  });
  it('reuses a schema-valid Gemini evidence selection between hourly calls with current calculated text', async () => {
    vi.mocked(explainWithGemini).mockResolvedValueOnce({ headline: 'Elevated flood risk', evidenceIds: ['availability'] });
    await runForecast();
    vi.setSystemTime(new Date(+initialNow + 10 * 60_000));
    await runForecast();
    expect(explainWithGemini).toHaveBeenCalledTimes(1);
    expect(backend.records.get(liveDoc)).toMatchObject({ status: 'available', explanationSource: 'gemini-3.8-flash', generatedAt: new Date(+initialNow + 10 * 60_000).toISOString() });
  });
  it('records numerical failure with the failing stage and keeps the original provider cause', async () => {
    vi.mocked(fetchFimanData).mockRejectedValueOnce(Object.assign(new Error('FiMAN transport timed out'), { code: 'ETIMEDOUT' }));
    await expect(runForecast()).rejects.toThrow('No current numerical outlook');
    expect(backend.records.get('operationalHealth/generateFloodOutlook_carolina-beach')).toMatchObject({ status: 'failed', stage: 'sources', error: expect.objectContaining({ message: 'FiMAN transport timed out', code: 'ETIMEDOUT' }) });
  });
  it('keeps calculated forecasts available when explanation reservation storage is unavailable', async () => {
    const transaction = backend.runTransaction.getMockImplementation()!;
    backend.runTransaction.mockImplementationOnce(transaction).mockRejectedValueOnce(new Error('State unavailable'));
    await runForecast();
    expect((backend.records.get(liveDoc) as { status: string }).status).toBe('available');
    expect(explainWithGemini).not.toHaveBeenCalled();
  });
  it('withholds a numerical forecast for a malformed cache without fitting or calling providers', async () => {
    backend.records.set('forecast_models/carolina-beach', { version: 'old', model: {} });
    await expect(runForecast()).rejects.toThrow('No current numerical outlook');
    const document = backend.records.get(liveDoc) as { status: string; points: unknown[] };
    expect(document.status).toBe('unavailable');
    expect(document.points).toEqual([]);
    expect(fetchFimanData).not.toHaveBeenCalled();
    expect(trainWeatherResponse).not.toHaveBeenCalled();
    expect(explainWithGemini).not.toHaveBeenCalled();
  });
});

describe('atomic numerical publication independent of optional explanations', () => {
  const publicationPath = `forecast_publications/carolina-beach/issues/${initialNow.toISOString()}`;
  const archivePath = `forecast_archive/carolina-beach/issues/${initialNow.toISOString()}`;
  const inputPath = `forecast_input_archive/carolina-beach/issues/${initialNow.toISOString()}`;

  it('makes numerical evidence available while Gemini is pending and cannot roll back a newer issue', async () => {
    let release!: (value: { headline: 'Flood outlook'; evidenceIds: string[] }) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    vi.mocked(explainWithGemini).mockImplementationOnce(() => {
      entered();
      return new Promise<Explanation>(resolve => { release = resolve; });
    });
    const first = runForecast();
    await started;
    const archive = backend.records.get(archivePath) as ForecastDocument;
    expect(archive.explanationSource).toBe('fallback');
    expect(backend.records.get(liveDoc)).toEqual(archive);
    const marker = backend.records.get(publicationPath) as { publishedAt: { toDate: () => Date }; archivePath: string; inputPath: string };
    expect(marker.publishedAt.toDate()).toEqual(initialNow);
    expect(marker.archivePath).toBe(archivePath);
    expect(marker.inputPath).toBe(inputPath);

    vi.setSystemTime(new Date(+initialNow + 10 * 60_000));
    await runForecast();
    expect(marker.publishedAt.toDate()).toEqual(initialNow);
    const newer = backend.records.get(liveDoc);
    release({ headline: 'Flood outlook', evidenceIds: ['availability'] });
    await first;
    expect(backend.records.get(liveDoc)).toBe(newer);
    expect(backend.records.get(archivePath)).toBe(archive);
    expect(backend.records.get(`forecast_explanations/carolina-beach/issues/${initialNow.toISOString()}`)).toMatchObject({ explanationSource: 'gemini-3.8-flash' });
  });

  it('updates only public explanation fields and leaves the numerical archive unchanged', async () => {
    await runForecast();
    const archive = backend.records.get(archivePath) as ForecastDocument;
    const current = backend.records.get(liveDoc) as ForecastDocument;
    expect(archive.explanationSource).toBe('fallback');
    expect(current.explanationSource).toBe('gemini-3.8-flash');
    expect({ ...current, explanation: archive.explanation, explanationSource: archive.explanationSource }).toEqual(archive);
  });

  it('reports fallback health if Gemini succeeds but explanation storage fails', async () => {
    const transaction = backend.runTransaction.getMockImplementation()!;
    backend.runTransaction.mockImplementationOnce(transaction).mockImplementationOnce(transaction).mockRejectedValueOnce(new Error('Explanation storage unavailable'));
    await runForecast();
    expect(backend.records.get(liveDoc)).toMatchObject({ status: 'available', explanationSource: 'fallback' });
    expect(backend.records.get('operationalHealth/generateFloodOutlook_carolina-beach')).toMatchObject({ status: 'partial', explanationSource: 'fallback' });
  });

  it('leaves current and readiness absent when immutable archive creation conflicts', async () => {
    backend.records.set(archivePath, { existing: true });
    await expect(runForecast()).rejects.toThrow('Immutable document');
    expect(backend.records.has(liveDoc)).toBe(false);
    expect(backend.records.has(publicationPath)).toBe(false);
    expect(backend.records.get(archivePath)).toEqual({ existing: true });
    expect(explainWithGemini).not.toHaveBeenCalled();
  });

  it('treats repeated publication and late older issues as no-ops', async () => {
    await runForecast();
    const archive = backend.records.get(archivePath) as ForecastDocument;
    const db = { doc: backend.doc, runTransaction: backend.runTransaction } as unknown as FirebaseFirestore.Firestore;
    const marker = backend.records.get(publicationPath);
    expect(await publishNumericalForecast(db, archive, { inputPath, modelPath: null })).toBe(false);
    expect(backend.records.get(publicationPath)).toBe(marker);
    vi.setSystemTime(new Date(+initialNow + 10 * 60_000));
    await runForecast();
    const newer = backend.records.get(liveDoc);
    backend.records.delete(publicationPath);
    expect(await publishNumericalForecast(db, archive, { inputPath, modelPath: null })).toBe(false);
    expect(backend.records.get(liveDoc)).toBe(newer);
    expect(backend.records.has(publicationPath)).toBe(false);
  });

  it('checks current inside publication before a failing concurrent issue could replace it', async () => {
    await runForecast();
    const current = backend.records.get(liveDoc) as ForecastDocument;
    vi.setSystemTime(new Date(+initialNow + 10 * 60_000));
    const unavailable: ForecastDocument = { ...current, generatedAt: new Date().toISOString(), status: 'unavailable', points: [], extension: undefined, tail: undefined };
    const db = { doc: backend.doc, runTransaction: backend.runTransaction } as unknown as FirebaseFirestore.Firestore;
    expect(await publishNumericalForecast(db, unavailable, { inputPath: null, modelPath: null })).toBe(false);
    expect(backend.records.get(liveDoc)).toBe(current);
    expect(backend.records.has(`forecast_publications/carolina-beach/issues/${unavailable.generatedAt}`)).toBe(false);
  });
});

describe('public cached outlook reads', () => {
  const readOutlook = floodOutlook as unknown as (request: { method: string; get: (header: string) => string | undefined }, response: ReturnType<typeof mockResponse>) => Promise<void>;
  function mockResponse() {
    const res = { set: vi.fn(), status: vi.fn(), json: vi.fn(), send: vi.fn(), vary: vi.fn(), type: vi.fn(), removeHeader: vi.fn() };
    res.set.mockReturnValue(res); res.status.mockReturnValue(res); res.type.mockReturnValue(res);
    return res;
  }
  it('returns a current cached issue without invoking inference or exceeding its expiry in HTTP caching', async () => {
    await runForecast();
    const document = backend.records.get(liveDoc) as { expiresAt: string };
    vi.clearAllMocks();
    vi.setSystemTime(new Date(Date.parse(document.expiresAt) - 30_000));
    const res = mockResponse();
    await readOutlook({ method: 'GET', get: () => undefined }, res);
    expect(JSON.parse(res.send.mock.calls[0][0])).toEqual(document);
    expect(res.vary).toHaveBeenCalledWith('Accept-Encoding');
    expect(res.type).toHaveBeenCalledWith('application/json');
    expect(res.set).toHaveBeenLastCalledWith('Cache-Control', 'public, max-age=30, s-maxage=30');
    expect(fetchFimanData).not.toHaveBeenCalled();
    expect(explainWithGemini).not.toHaveBeenCalled();
  });
  it.each(['expired', 'future', 'wrong-sensor', 'wrong-phase', 'wrong-threshold'] as const)('rejects %s cached issues without caching an error response', async failure => {
    await runForecast();
    const document = backend.records.get(liveDoc) as { generatedAt: string; expiresAt: string; sensor: string; phaseMinutes: number; thresholdFt: number };
    if (failure === 'expired') vi.setSystemTime(new Date(document.expiresAt));
    if (failure === 'future') document.generatedAt = new Date(+initialNow + 60_000).toISOString();
    if (failure === 'wrong-sensor') document.sensor = 'SUNNYD_CB_03';
    if (failure === 'wrong-phase') document.phaseMinutes = 0;
    if (failure === 'wrong-threshold') document.thresholdFt = 7;
    const res = mockResponse();
    await readOutlook({ method: 'GET', get: () => undefined }, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.set).toHaveBeenLastCalledWith('Cache-Control', 'no-store');
    expect(res.json).toHaveBeenCalledWith({ error: 'Current evaluated outlook unavailable' });
  });
});

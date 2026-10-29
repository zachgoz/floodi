import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  floodChallenger,
  floodOutlook,
  generateFloodOutlook,
  refreshResidualHistory,
} from '../../../functions/src/forecast/jobs';
import { FORECAST_TIDE_DAYS, SITE, weatherForecast } from '../../../functions/src/forecast/sources';
import { fetchFimanData } from '../../../functions/src/etl/fiman';
import { fetchNoaaPredictions } from '../../../functions/src/etl/noaa';
import { runTimesFmChallenger, ChallengerOutlookDocument } from '../../../functions/src/forecast/challenger';
import { runOperationalAlertsForForecast } from '../../../functions/src/citizenAlerts/operationalAlerts';

const backend = vi.hoisted(() => {
  const records = new Map<string, unknown>();
  const logs: { level: string; details: Record<string, unknown> }[] = [];
  const schedules: { schedule: string }[] = [];
  const doc = vi.fn((path: string) => ({
    path,
    get: vi.fn(async () => ({ exists: records.has(path), data: () => records.get(path) })),
    set: vi.fn(async (value: unknown) => {
      records.set(path, value);
    }),
    create: vi.fn(async (value: unknown) => {
      if (records.has(path)) throw new Error('Immutable document already exists');
      records.set(path, value);
    }),
  }));
  return { records, schedules, doc, logs };
});

vi.mock('../../../functions/node_modules/firebase-functions/lib/logger/index.js', () =>
  Object.fromEntries(
    ['info', 'warn', 'error'].map(level => [
      level,
      (_message: string, details: Record<string, unknown>) => backend.logs.push({ level, details }),
    ])
  )
);
vi.mock('../../../functions/node_modules/firebase-admin/lib/index.js', () => ({
  apps: [{}],
  initializeApp: vi.fn(),
  firestore: () => ({ doc: backend.doc }),
}));
vi.mock('../../../functions/node_modules/firebase-functions/lib/v2/providers/scheduler.js', () => ({
  onSchedule: (options: { schedule: string }, handler: unknown) => {
    backend.schedules.push(options);
    return handler;
  },
}));
vi.mock('../../../functions/node_modules/firebase-functions/lib/v2/providers/https.js', () => ({
  onRequest: (_options: unknown, handler: unknown) => handler,
}));
vi.mock('../../../functions/src/forecast/sources', async () => ({
  ...(await vi.importActual<typeof import('../../../functions/src/forecast/sources')>(
    '../../../functions/src/forecast/sources'
  )),
  weatherForecast: vi.fn(),
}));
vi.mock('../../../functions/src/etl/fiman', () => ({ fetchFimanData: vi.fn() }));
vi.mock('../../../functions/src/etl/noaa', () => ({ fetchNoaaPredictions: vi.fn() }));
vi.mock('../../../functions/src/forecast/challenger', () => ({ runTimesFmChallenger: vi.fn() }));
vi.mock('../../../functions/src/citizenAlerts/operationalAlerts', () => ({
  runOperationalAlertsForForecast: vi.fn().mockResolvedValue({ activeCount: 1, notificationsEmitted: 0 }),
}));

const HOUR = 3600_000;
const initialNow = new Date('2026-10-29T12:00:00Z');
const runForecast = generateFloodOutlook as unknown as () => Promise<void>;
const runRetiredHistory = refreshResidualHistory as unknown as () => Promise<void>;
const liveOperationalDoc = 'locations/carolina-beach/forecast_challengers/timesfm-3/outlook/current';

function buildOperationalFixture(issuedAt = initialNow, pointCount = 240): ChallengerOutlookDocument {
  return {
    challengerId: 'timesfm-3',
    locationId: SITE.id,
    regime: 'back-barrier-lagoon',
    generatedAt: issuedAt.toISOString(),
    observationAt: new Date(+issuedAt - 6 * 60_000).toISOString(),
    currentResidualFt: 0.86,
    expiresAt: new Date(+issuedAt + 45 * 60_000).toISOString(),
    status: 'available',
    engine: 'noaa-etss-hybrid',
    horizonSteps: pointCount,
    thresholdFt: SITE.thresholdFt,
    points: Array.from({ length: pointCount }, (_, idx) => ({
      t: new Date(+issuedAt + (idx + 1) * 30 * 60_000).toISOString(),
      tideFt: 3.4,
      residualFt: 0.86,
      totalFt: 4.26,
      lowerFt: 4.0,
      upperFt: 4.52,
      drivers: {
        oceanSurgeFt: 0.62,
        windSetupFt: 0.1,
        riverFlowFt: 0.08,
        rainfallRunoffFt: 0,
        estuarineHarmonicFt: 0.06,
      },
    })),
    peak: {
      t: new Date(+issuedAt + 12 * HOUR).toISOString(),
      totalFt: 6.12,
      tideFt: 5.26,
      residualFt: 0.86,
      exceedsThreshold: true,
    },
    covariatesUsed: ['astronomical_tide', 'noaa_etss_surge', 'cape_fear_river_etss_head'],
    metadata: {
      historyPointsCount: 97,
      noaaSurgeAvailable: true,
      riverSurgeAvailable: true,
      usgsDischargeCfs: 3400,
      weatherAvailable: true,
      retrievedAt: issuedAt.toISOString(),
    },
  };
}

function waterRecord() {
  return Object.fromEntries(
    Array.from({ length: (3 + FORECAST_TIDE_DAYS) * 24 + 1 }, (_, i) => [
      new Date(Date.now() - 3 * 24 * HOUR + i * HOUR).toISOString(),
      4 + 0.4 * Math.sin(i / 4),
    ])
  );
}

function measuredRecord() {
  return Object.fromEntries(
    Array.from({ length: 73 }, (_, i) => [
      new Date(Date.now() - 72 * HOUR + i * HOUR).toISOString(),
      4.8 + 0.1 * Math.sin(i / 4),
    ])
  );
}

function issuedWeather() {
  const hour = Math.floor(Date.now() / HOUR) * HOUR;
  return Array.from({ length: (3 + 16) * 24 + 1 }, (_, i) => ({
    t: new Date(hour - 72 * HOUR + i * HOUR),
    windSpeed: 18,
    windDirection: 25,
    pressure: 1009,
    precip: 0.05,
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(initialNow);
  vi.clearAllMocks();
  backend.records.clear();
  backend.logs.length = 0;

  vi.mocked(fetchFimanData).mockImplementation(async () => ({ waterLevels: measuredRecord(), imagery: {} }));
  vi.mocked(fetchNoaaPredictions).mockImplementation(async () => waterRecord());
  vi.mocked(weatherForecast).mockImplementation(async () => issuedWeather());
  vi.mocked(runTimesFmChallenger).mockImplementation(async opts => {
    const doc = buildOperationalFixture(opts.issuedAt);
    backend.records.set(liveOperationalDoc, doc);
    return doc;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('standalone Operational Forecast & Alerts 2.0 jobs (decoupled from legacy ridge & Gemini)', () => {
  it('retires daily ridge training cleanly without touching legacy forecast_models or Storage', async () => {
    expect(backend.schedules.map(s => s.schedule)).toEqual(['every 24 hours', 'every 10 minutes']);
    await runRetiredHistory();
    expect(backend.records.get('operationalHealth/refreshResidualHistory_carolina-beach')).toMatchObject({
      status: 'ok',
      retired: true,
      activeEngine: 'timesfm-3-basin-physics',
    });
    expect(backend.records.has('forecast_models/carolina-beach')).toBe(false);
  });

  it('generates full-horizon operational forecast and evaluates Alerts 2.0 without requiring forecast_models', async () => {
    await runForecast();

    expect(runTimesFmChallenger).toHaveBeenCalledTimes(1);
    const callArg = vi.mocked(runTimesFmChallenger).mock.calls[0][0];
    expect(callArg.siteId).toBe('carolina-beach');
    expect(callArg.thresholdFt).toBe(5.6);
    expect(callArg.extendFullTideHorizon).toBe(true);
    expect(callArg.forecastWeather?.length).toBeGreaterThan(100);

    expect(runOperationalAlertsForForecast).toHaveBeenCalledTimes(1);
    expect(backend.records.get('operationalHealth/generateFloodOutlook_carolina-beach')).toMatchObject({
      status: 'ok',
      engine: 'noaa-etss-hybrid',
      activeAdvisories: 1,
    });
  });

  it('continues generating operational forecasts with partial health when Open-Meteo weather is temporarily down', async () => {
    vi.mocked(weatherForecast).mockRejectedValueOnce(new Error('Open-Meteo timeout'));
    await runForecast();
    expect(runTimesFmChallenger).toHaveBeenCalledTimes(1);
    expect(backend.records.get('operationalHealth/generateFloodOutlook_carolina-beach')).toMatchObject({
      status: 'partial',
    });
  });

  it('retains an unexpired operational forecast when upstream gauge/NOAA sources fail temporarily', async () => {
    await runForecast();
    const cached = backend.records.get(liveOperationalDoc);
    vi.setSystemTime(new Date(+initialNow + 10 * 60_000));
    vi.mocked(fetchFimanData).mockRejectedValueOnce(new Error('FiMAN outage'));

    await expect(runForecast()).rejects.toThrow('existing forecast retained');
    expect(backend.records.get(liveOperationalDoc)).toBe(cached);
    expect(backend.records.get('operationalHealth/generateFloodOutlook_carolina-beach')).toMatchObject({
      status: 'failed',
      retainedGeneratedAt: initialNow.toISOString(),
    });
  });

  it('serves cached operational outlook from both /api/challenger and /api/outlook with expiry-bounded Cache-Control', async () => {
    await runForecast();
    const doc = backend.records.get(liveOperationalDoc) as ChallengerOutlookDocument;
    vi.clearAllMocks();
    vi.setSystemTime(new Date(Date.parse(doc.expiresAt) - 25_000));

    const makeRes = () => {
      const res = {
        set: vi.fn(),
        status: vi.fn(),
        json: vi.fn(),
        send: vi.fn(),
        vary: vi.fn(),
        type: vi.fn(),
        removeHeader: vi.fn(),
      };
      res.set.mockReturnValue(res);
      res.status.mockReturnValue(res);
      res.type.mockReturnValue(res);
      return res;
    };

    const resChallenger = makeRes();
    await (floodChallenger as unknown as (req: unknown, res: unknown) => Promise<void>)(
      { method: 'GET', query: {}, get: () => undefined },
      resChallenger
    );
    expect(JSON.parse(resChallenger.send.mock.calls[0][0])).toEqual(doc);
    expect(resChallenger.set).toHaveBeenLastCalledWith('Cache-Control', 'public, max-age=25, s-maxage=25');
    expect(fetchFimanData).not.toHaveBeenCalled();

    const resOutlook = makeRes();
    await (floodOutlook as unknown as (req: unknown, res: unknown) => Promise<void>)(
      { method: 'GET', query: {}, get: () => undefined },
      resOutlook
    );
    expect(JSON.parse(resOutlook.send.mock.calls[0][0])).toEqual(doc);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDoc } from 'firebase/firestore';
import { fetchObservedWaterLevels } from 'src/lib/noaa';
import { clearDataServiceCache, extractWeatherData, fetchObservations, fetchPredictions, fetchUnifiedObservations } from 'src/lib/dataService';
import { reportClientError } from 'src/lib/errorReporting';

vi.mock('src/lib/firebase', () => ({ db: {}, storage: {} }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, path: string) => path),
  getDoc: vi.fn(), collection: vi.fn(), query: vi.fn(), where: vi.fn(),
  orderBy: vi.fn(), getDocs: vi.fn(), limit: vi.fn(), Timestamp: {},
}));
vi.mock('firebase/storage', () => ({ ref: vi.fn(), getDownloadURL: vi.fn() }));
vi.mock('src/lib/noaa', () => ({ fetchObservedWaterLevels: vi.fn(), fetchPredictions: vi.fn() }));
vi.mock('src/lib/errorReporting', () => ({ reportClientError: vi.fn() }));
vi.mock('src/constants/locations', () => ({
  LOCATIONS: {
    'carolina-beach': { noaaStationId: '8658163', webcamIds: ['SUNNYD_CB_03'] },
    'noaa-only': { noaaStationId: '1234567', webcamIds: [] },
  },
}));

const now = new Date('2026-10-14T12:00:00Z');
const MINUTE = 60_000;
const at = (minutes: number) => new Date(+now + minutes * MINUTE).toISOString();
const start = new Date('2026-10-01T00:00:00Z');
const end = new Date('2026-10-16T00:00:00Z');
type Bucket = {
  noaa?: Record<string, number>;
  fiman?: Record<string, number>;
  imagery?: Record<string, Record<string, string>>;
  weather?: Record<string, unknown>;
  lastUpdated?: string;
};
function archived(bucket: Bucket | null) {
  vi.mocked(getDoc).mockImplementation(async reference => ({
    exists: () => String(reference).endsWith('/2026-10') && bucket !== null,
    data: () => bucket ? { lastUpdated: now.toISOString(), ...bucket } : bucket,
  }) as Awaited<ReturnType<typeof getDoc>>);
}

describe('fetchUnifiedObservations source freshness and recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.clearAllMocks();
    clearDataServiceCache();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(fetchObservedWaterLevels).mockResolvedValue({ source: 'noaa', data: {} });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('recovers the local gauge even when NOAA is fresh and retains all archived sources', async () => {
    const history = { fiman: { [at(-2 * 24 * 60)]: 4.4 }, noaa: { [at(-6)]: 3.3 }, weather: { [at(-12)]: { pressure: 1013 } } };
    archived(history);
    vi.mocked(fetchObservedWaterLevels).mockResolvedValue({ source: 'fiman', data: { [at(-24)]: 4.8 } });

    const result = await fetchUnifiedObservations('carolina-beach', start, end);

    expect(fetchObservedWaterLevels).toHaveBeenCalledOnce();
    expect(fetchObservedWaterLevels).toHaveBeenCalledWith({
      station: '8658163', start: new Date(at(-2 * 24 * 60 - 1)), end: now,
      interval: 6, datum: 'MLLW', units: 'english', provider: 'fiman',
    });
    expect(result.fiman).toEqual({ ...history.fiman, [at(-24)]: 4.8 });
    expect(result.noaa).toEqual(history.noaa);
    expect(result.weather).toEqual(history.weather);
    expect(history.fiman).toEqual({ [at(-2 * 24 * 60)]: 4.4 });
  });

  it('recovers both stale sources in one request starting at the earlier gap', async () => {
    archived({ noaa: { [at(-180)]: 3.1 }, fiman: { [at(-90)]: 4.2 } });
    vi.mocked(fetchObservedWaterLevels).mockResolvedValue({
      source: 'fiman', data: { [at(-18)]: 4.7 }, alternate: { [at(-6)]: 3.5 },
    });

    const result = await fetchUnifiedObservations('carolina-beach', start, end);

    expect(fetchObservedWaterLevels).toHaveBeenCalledWith(expect.objectContaining({ provider: 'both', start: new Date(at(-181)) }));
    expect(result.fiman).toEqual({ [at(-90)]: 4.2, [at(-18)]: 4.7 });
    expect(result.noaa).toEqual({ [at(-180)]: 3.1, [at(-6)]: 3.5 });
  });

  it('refreshes NOAA separately when the local gauge is fresh', async () => {
    archived({ fiman: { [at(-12)]: 4.5 }, noaa: { [at(-90)]: 3.1 } });
    vi.mocked(fetchObservedWaterLevels).mockResolvedValue({ source: 'noaa', data: { [at(-6)]: 3.6 } });
    const result = await fetchUnifiedObservations('carolina-beach', start, end);
    expect(fetchObservedWaterLevels).toHaveBeenCalledWith(expect.objectContaining({ provider: 'noaa', start: new Date(at(-91)) }));
    expect(result.noaa[at(-6)]).toBe(3.6);
    expect(result.fiman).toEqual({ [at(-12)]: 4.5 });
  });

  it('uses live same-source readings when the archive is missing', async () => {
    archived(null);
    vi.mocked(fetchObservedWaterLevels).mockResolvedValue({ source: 'fiman', data: { [at(-12)]: 4.5 }, alternate: { [at(-6)]: 3.6 } });
    const result = await fetchUnifiedObservations('carolina-beach', start, end);
    expect(fetchObservedWaterLevels).toHaveBeenCalledWith(expect.objectContaining({ provider: 'both', start }));
    expect(result.fiman).toEqual({ [at(-12)]: 4.5 });
    expect(result.noaa).toEqual({ [at(-6)]: 3.6 });
  });

  it('recovers live readings when Firestore fails', async () => {
    vi.mocked(getDoc).mockRejectedValue(new Error('Firestore unavailable'));
    vi.mocked(fetchObservedWaterLevels).mockResolvedValue({ source: 'fiman', data: { [at(-12)]: 4.5 } });
    const result = await fetchUnifiedObservations('carolina-beach', start, end);
    expect(result.fiman).toEqual({ [at(-12)]: 4.5 });
    expect(fetchObservedWaterLevels).toHaveBeenCalledWith(expect.objectContaining({ provider: 'both' }));
  });

  it('does not query a local gauge for a location configured for NOAA only', async () => {
    archived({ noaa: { [at(-90)]: 3.1 } });
    vi.mocked(fetchObservedWaterLevels).mockResolvedValue({ source: 'noaa', data: { [at(-6)]: 3.6 } });
    const result = await fetchUnifiedObservations('noaa-only', start, end);
    expect(fetchObservedWaterLevels).toHaveBeenCalledWith(expect.objectContaining({ station: '1234567', provider: 'noaa' }));
    expect(result.fiman).toEqual({});
    expect(result.noaa[at(-6)]).toBe(3.6);
  });

  it('skips all live requests when both archived sources are fresh', async () => {
    archived({ fiman: { [at(-30)]: 4.5 }, noaa: { [at(-6)]: 3.6 } });
    await fetchUnifiedObservations('carolina-beach', start, end);
    expect(fetchObservedWaterLevels).not.toHaveBeenCalled();
  });

  it.each([
    ['historical', new Date('2026-10-10T00:00:00Z'), new Date('2026-10-12T00:00:00Z')],
    ['future-only', new Date('2026-10-15T00:00:00Z'), new Date('2026-10-16T00:00:00Z')],
  ])('does not treat a %s range as the current window', async (_name, from, to) => {
    archived({ fiman: { [at(-90)]: 4.2 }, noaa: { [at(-180)]: 3.1 } });
    await fetchUnifiedObservations('carolina-beach', from, to);
    expect(fetchObservedWaterLevels).not.toHaveBeenCalled();
  });

  it('keeps a FiMAN request fallback in the NOAA series without manufacturing local observations', async () => {
    archived({ fiman: { [at(-90)]: 4.2 }, noaa: { [at(-6)]: 3.5 } });
    vi.mocked(fetchObservedWaterLevels).mockResolvedValue({ source: 'noaa', data: { [at(-3)]: 3.6 } });
    const result = await fetchUnifiedObservations('carolina-beach', start, end);
    expect(fetchObservedWaterLevels).toHaveBeenCalledWith(expect.objectContaining({ provider: 'fiman' }));
    expect(result.fiman).toEqual({ [at(-90)]: 4.2 });
    expect(result.noaa).toEqual({ [at(-6)]: 3.5, [at(-3)]: 3.6 });
  });

  it('ignores invalid timestamps, nonfinite levels and future records when checking freshness', async () => {
    archived({ fiman: { [at(-90)]: 4.2, [at(6)]: 10, [at(-3)]: NaN, invalid: 5 }, noaa: { [at(-6)]: 3.5 } });
    vi.mocked(fetchObservedWaterLevels).mockResolvedValue({ source: 'fiman', data: { [at(-12)]: 4.6 } });
    const result = await fetchUnifiedObservations('carolina-beach', start, end);
    expect(fetchObservedWaterLevels).toHaveBeenCalledWith(expect.objectContaining({ provider: 'fiman', start: new Date(at(-91)) }));
    expect(result.fiman[at(-12)]).toBe(4.6);
  });

  it('does not merge malformed, future or out-of-window live measurements', async () => {
    archived({ fiman: { [at(-90)]: 4.2 }, noaa: { [at(-6)]: 3.5 } });
    vi.mocked(fetchObservedWaterLevels).mockResolvedValue({
      source: 'fiman', data: { invalid: 5, [at(6)]: 10, [at(-3)]: Infinity, [at(-120)]: 7, [at(-12)]: 4.6 },
    });
    const result = await fetchUnifiedObservations('carolina-beach', start, end);
    expect(result.fiman).toEqual({ [at(-90)]: 4.2, [at(-12)]: 4.6 });
  });

  it('merges live imagery into each camera without replacing archived images or other cameras', async () => {
    const oldImage = { [at(-90)]: 'https://example.com/old.jpg' };
    archived({ fiman: { [at(-90)]: 4.2 }, noaa: { [at(-6)]: 3.5 }, imagery: { SUNNYD_CB_03: oldImage, SUNNYD_CB_02: oldImage } });
    vi.mocked(fetchObservedWaterLevels).mockResolvedValue({
      source: 'fiman', data: { [at(-12)]: 4.6 }, imagery: { SUNNYD_CB_03: { [at(-12)]: 'https://example.com/new.jpg' } },
    });
    const result = await fetchUnifiedObservations('carolina-beach', start, end);
    expect(result.imagery).toEqual({
      SUNNYD_CB_03: { ...oldImage, [at(-12)]: 'https://example.com/new.jpg' }, SUNNYD_CB_02: oldImage,
    });
    expect(oldImage).toEqual({ [at(-90)]: 'https://example.com/old.jpg' });
  });

  it('retains camera history from earlier monthly buckets when recovering new imagery', async () => {
    const older = '2026-09-30T23:30:00.000Z';
    vi.mocked(getDoc).mockImplementation(async reference => {
      const path = String(reference);
      const bucket = path.endsWith('/2026-09')
        ? { imagery: { SUNNYD_CB_03: { [older]: 'https://example.com/september.jpg' } } }
        : path.endsWith('/2026-10')
          ? { fiman: { [at(-90)]: 4.2 }, noaa: { [at(-6)]: 3.5 }, imagery: { SUNNYD_CB_03: { [at(-90)]: 'https://example.com/october.jpg' } } }
          : null;
      return { exists: () => bucket !== null, data: () => bucket } as Awaited<ReturnType<typeof getDoc>>;
    });
    vi.mocked(fetchObservedWaterLevels).mockResolvedValue({
      source: 'fiman', data: { [at(-12)]: 4.6 }, imagery: { SUNNYD_CB_03: { [at(-12)]: 'https://example.com/current.jpg' } },
    });
    const result = await fetchUnifiedObservations('carolina-beach', new Date('2026-09-01T00:00:00Z'), end);
    expect(result.imagery.SUNNYD_CB_03).toEqual({
      [older]: 'https://example.com/september.jpg',
      [at(-90)]: 'https://example.com/october.jpg',
      [at(-12)]: 'https://example.com/current.jpg',
    });
  });

  it('returns cached history when the source refresh fails', async () => {
    const history = { fiman: { [at(-90)]: 4.2 }, noaa: { [at(-6)]: 3.5 } };
    archived(history);
    vi.mocked(fetchObservedWaterLevels).mockRejectedValue(new Error('Provider unavailable'));
    const result = await fetchUnifiedObservations('carolina-beach', start, end);
    expect(result.fiman).toEqual(history.fiman);
    expect(result.noaa).toEqual(history.noaa);
  });

  it('can recover on the next read after a failed refresh without clearing archived history', async () => {
    archived({ fiman: { [at(-90)]: 4.2 }, noaa: { [at(-6)]: 3.5 } });
    vi.mocked(fetchObservedWaterLevels).mockRejectedValueOnce(new Error('Provider unavailable'))
      .mockResolvedValueOnce({ source: 'fiman', data: { [at(-12)]: 4.6 } });
    const failed = await fetchUnifiedObservations('carolina-beach', start, end);
    const recovered = await fetchUnifiedObservations('carolina-beach', start, end);
    expect(failed.fiman).toEqual({ [at(-90)]: 4.2 });
    expect(recovered.fiman).toEqual({ [at(-90)]: 4.2, [at(-12)]: 4.6 });
    expect(fetchObservedWaterLevels).toHaveBeenCalledTimes(2);
  });

  it('merges legacy months and daily corrections without losing partial weather or camera history', async () => {
    const legacy = { fiman: { '2026-10-14T07:48:00-04:00': 4.2 }, noaa: { [at(-6)]: 3.6 }, weather: { [at(-12)]: { windSpeed: 3, precip: .2 } }, imagery: { SUNNYD_CB_03: { [at(-90)]: 'old.jpg' } }, lastUpdated: now.toISOString() };
    const daily = { fiman: { [at(-12)]: 4.6 }, weather: { [at(-12)]: { windSpeed: 0 } }, imagery: { [at(-12)]: { SUNNYD_CB_03: 'new.jpg', SUNNYD_CB_02: 'other.jpg' } }, lastUpdated: now.toISOString() };
    vi.mocked(getDoc).mockImplementation(async reference => {
      const bucket = String(reference).endsWith('/2026-10') ? legacy : String(reference).endsWith('/2026-10-14') ? daily : null;
      return { exists: () => bucket !== null, data: () => bucket } as Awaited<ReturnType<typeof getDoc>>;
    });
    const result = await fetchObservations('carolina-beach', new Date('2026-10-14T00:00:00Z'), now);
    expect(result.fiman).toEqual({ [at(-12)]: 4.6 });
    expect(result.noaa).toEqual(legacy.noaa);
    expect(result.weather[at(-12)]).toEqual({ precip: .2, windSpeed: 0 });
    expect(result.imagery).toEqual({ SUNNYD_CB_03: { [at(-90)]: 'old.jpg', [at(-12)]: 'new.jpg' }, SUNNYD_CB_02: { [at(-12)]: 'other.jpg' } });
    expect(legacy.fiman['2026-10-14T07:48:00-04:00']).toBe(4.2);
  });

  it('quarantines monthly weather that was in the future when last written, even after that time passes', async () => {
    const archivedAt = at(-120);
    archived({ fiman: { [at(-12)]: 4.5 }, weather: { [at(-180)]: { precip: .2 }, [at(-60)]: { precip: 99 }, [at(60)]: { precip: 100 } }, lastUpdated: archivedAt });
    const result = await fetchObservations('carolina-beach', start, end);
    expect(result.weather).toEqual({ [at(-180)]: { precip: .2 } });
  });

  it('reads every UTC day around a midnight/DST boundary and never fetches future observation days', async () => {
    vi.setSystemTime(new Date('2026-11-02T01:00:00Z'));
    archived(null);
    await fetchObservations('carolina-beach', new Date('2026-10-31T23:59:00Z'), new Date('2026-11-04T00:00:00Z'));
    const observationDays = vi.mocked(getDoc).mock.calls.map(([path]) => String(path)).filter(path => /\/\d{4}-\d\d-\d\d$/.test(path));
    expect(observationDays).toEqual([
      'locations/carolina-beach/observations/2026-10-31',
      'locations/carolina-beach/observations/2026-11-01',
      'locations/carolina-beach/observations/2026-11-02',
    ]);
  });

  it('retains legacy observations if a daily read fails, reports the handled failure, and retries next time', async () => {
    let failDaily = true;
    vi.mocked(getDoc).mockImplementation(async reference => {
      if (String(reference).endsWith('/2026-10-14') && failDaily) throw new Error('daily unavailable');
      const bucket = String(reference).endsWith('/2026-10') ? { fiman: { [at(-12)]: 4.5 } }
        : String(reference).endsWith('/2026-10-14') ? { fiman: { [at(-12)]: 4.6 } } : null;
      return { exists: () => bucket !== null, data: () => bucket } as Awaited<ReturnType<typeof getDoc>>;
    });
    expect((await fetchObservations('carolina-beach', start, end)).fiman[at(-12)]).toBe(4.5);
    expect(reportClientError).toHaveBeenCalledWith('water_data_unavailable', expect.any(Error), { provider: 'firestore' });
    failDaily = false;
    expect((await fetchObservations('carolina-beach', start, end)).fiman[at(-12)]).toBe(4.6);
  });

  it('keeps archived image URLs when daily buckets and provider gap filling refresh raw camera links', async () => {
    vi.mocked(getDoc).mockImplementation(async reference => {
      const bucket = String(reference).endsWith('/2026-10') ? { fiman: { [at(-90)]: 4.3 }, noaa: { [at(-6)]: 3.5 }, imagery: { [at(-90)]: { Camera: 'storage://archived.jpg' } } }
        : String(reference).endsWith('/2026-10-14') ? { imagery: { [at(-90)]: { Camera: 'https://camera/latest.jpg' } }, persistedImagery: { [at(-90)]: { Other: 'storage://other.jpg' } } } : null;
      return { exists: () => bucket !== null, data: () => bucket } as Awaited<ReturnType<typeof getDoc>>;
    });
    vi.mocked(fetchObservedWaterLevels).mockResolvedValue({ source: 'fiman', data: { [at(-12)]: 4.5 }, imagery: { Camera: { [at(-90)]: 'https://camera/replaced.jpg' } } });
    const result = await fetchUnifiedObservations('carolina-beach', start, end);
    expect(result.imagery.Camera[at(-90)]).toBe('storage://archived.jpg');
    expect(result.imagery.Other[at(-90)]).toBe('storage://other.jpg');
  });

  it('preserves calm wind and zero rainfall while excluding missing/nonfinite weather from chart series', () => {
    expect(extractWeatherData({ weather: {
      [at(-12)]: { windSpeed: 0, windDirection: 0, precip: 0 },
      [at(-6)]: { windSpeed: null, windDirection: 90, precip: NaN },
      [at(-3)]: { windSpeed: 12, windDirection: Infinity, precip: null },
    } })).toEqual({ wind: { [at(-12)]: { speed: 0, dir: 0 } }, precip: { [at(-12)]: 0 } });
  });
  it('never waits for adjacent-month archives outside the requested observations', async () => {
    vi.mocked(getDoc).mockImplementation(reference => {
      const path = String(reference);
      if (path.endsWith('/2026-09') || path.endsWith('/2026-11')) return new Promise(() => {});
      return Promise.resolve({ exists: () => path.endsWith('/2026-10'), data: () => ({ fiman: { [at(-12)]: 4.5 } }) }) as ReturnType<typeof getDoc>;
    });
    const result = await fetchObservations('carolina-beach', new Date(at(-60)), now);
    expect(result.fiman[at(-12)]).toBe(4.5);
    expect(vi.mocked(getDoc).mock.calls.map(([path]) => String(path))).not.toContain('locations/carolina-beach/observations/2026-09');
    expect(vi.mocked(getDoc).mock.calls.map(([path]) => String(path))).not.toContain('locations/carolina-beach/observations/2026-11');
  });

  it('returns requested predictions without waiting for an unrelated future month', async () => {
    vi.mocked(getDoc).mockImplementation(reference => {
      const path = String(reference);
      if (path.endsWith('/2026-11')) return new Promise(() => {});
      return Promise.resolve({ exists: () => true, data: () => ({ data: { [at(60)]: 4.2 } }) }) as ReturnType<typeof getDoc>;
    });
    const result = await fetchPredictions('carolina-beach', now, new Date(at(120)));
    expect(result.data[at(60)]).toBe(4.2);
    expect(getDoc).toHaveBeenCalledTimes(1);
  });

});

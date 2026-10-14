import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDoc } from 'firebase/firestore';
import { fetchObservedWaterLevels } from 'src/lib/noaa';
import { clearDataServiceCache, fetchUnifiedObservations } from 'src/lib/dataService';

vi.mock('src/lib/firebase', () => ({ db: {}, storage: {} }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, path: string) => path),
  getDoc: vi.fn(), collection: vi.fn(), query: vi.fn(), where: vi.fn(),
  orderBy: vi.fn(), getDocs: vi.fn(), limit: vi.fn(), Timestamp: {},
}));
vi.mock('firebase/storage', () => ({ ref: vi.fn(), getDownloadURL: vi.fn() }));
vi.mock('src/lib/noaa', () => ({ fetchObservedWaterLevels: vi.fn(), fetchPredictions: vi.fn() }));
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
};
function archived(bucket: Bucket | null) {
  vi.mocked(getDoc).mockImplementation(async reference => ({
    exists: () => String(reference).endsWith('/2026-10') && bucket !== null,
    data: () => bucket,
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
    const older = '2026-09-30T23:30:00Z';
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
});

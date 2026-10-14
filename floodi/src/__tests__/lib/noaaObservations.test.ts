import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const start = new Date('2026-10-11T00:00:00Z');
const end = new Date('2026-10-14T12:00:00Z');
const now = '2026-10-14T11:36:04';
const gauge = (times = [now], values = [2.17], description = 'https://fiman.nc.gov/?id=30046') => ({
  id: 'FIMAN (observed)', units: 'ft', www: { description, uom_ts_suffix: ' NAVD88' },
  observations: { times, values, quality_levels: times.map(() => '0') },
});
const camera = (times: string[], values: (string | undefined)[]) => ({ id: 'Camera', observations: { times, values } });
function source(handler: (platform: string) => unknown[]) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => {
    const platform = new URL(url, 'https://floodcastwebapp.web.app').searchParams.get('platform')!;
    return { features: handler(platform) };
  } })));
}
const feature = (platform: string, parameters: unknown[]) => ({ properties: { platform_id: platform.toUpperCase(), parameters } });
async function load() {
  const { fetchObservedWaterLevels } = await import('src/lib/noaa');
  return fetchObservedWaterLevels({ station: '8658163', start, end, provider: 'fiman' });
}
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(end);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('live FiMAN observations', () => {
  it('matches the requested platform instead of reading a different first feature', async () => {
    source(platform => [feature('UNRELATED', [gauge([now], [99])]), feature(platform, [gauge()])]);
    const result = await load();
    expect(result.source).toBe('fiman');
    expect(result.data['2026-10-14T11:36:04.000Z']).toBeCloseTo(4.92);
    expect(Object.keys(result.data)).toHaveLength(1);
  });

  it('keeps the real gauge when camera times already have UTC or timezone qualifiers', async () => {
    source(platform => [feature(platform, [gauge(), camera(['2026-10-14T11:36:04Z', '2026-10-14T07:00:00-04:00'], ['https://images.example/CB_03.jpg', 'https://images.example/CB_03.jpg'])])]);
    const result = await load();
    expect(result.source).toBe('fiman');
    expect(result.data['2026-10-14T11:36:04.000Z']).toBeCloseTo(4.92);
    expect(result.imagery?.SUNNYD_CB_03).toEqual({
      '2026-10-14T11:36:04.000Z': 'https://images.example/CB_03.jpg',
      '2026-10-14T11:00:00.000Z': 'https://images.example/CB_03.jpg',
    });
  });

  it('ignores malformed camera records without discarding usable water readings', async () => {
    source(platform => [feature(platform, [gauge(), camera(['not a date', now, now], ['https://images.example/CB_03.jpg', undefined, ''])])]);
    const result = await load();
    expect(result.source).toBe('fiman');
    expect(result.data['2026-10-14T11:36:04.000Z']).toBeCloseTo(4.92);
    expect(result.imagery).toEqual({});
  });

  it('merges same-gauge readings so a stale first platform cannot hide the live tail', async () => {
    source(platform => [feature(platform, [platform === 'sunnyd_cb_03' ? gauge() : gauge(['2026-10-12T00:57:05'], [3.1])])]);
    const result = await load();
    expect(result.data['2026-10-12T00:57:05.000Z']).toBeCloseTo(5.85);
    expect(result.data['2026-10-14T11:36:04.000Z']).toBeCloseTo(4.92);
  });

  it('does not relabel a different sensor or unknown datum as gauge 30046', async () => {
    source(platform => [feature(platform, [{ ...gauge(), www: { description: 'https://fiman.nc.gov/?id=30047', uom_ts_suffix: ' NAVD88' } },
      { ...gauge(), www: { description: 'https://fiman.nc.gov/?id=30046', uom_ts_suffix: ' unknown' } }])]);
    const result = await load();
    expect(result.source).toBe('noaa');
    expect(result.data).toEqual({});
  });
});

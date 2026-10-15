import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchFimanData } from '../../../functions/src/etl/fiman';
import { fetchNoaaObserved, fetchNoaaPredictions } from '../../../functions/src/etl/noaa';

const upstream = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('../../../functions/node_modules/node-fetch/lib/index.js', () => ({ default: upstream.fetch }));
const start = new Date('2026-10-10T12:00:00Z');
const end = new Date('2026-10-10T13:00:00Z');
const response = (value: unknown) => ({ ok: true, json: async () => value });
beforeEach(() => { upstream.fetch.mockReset(); });

describe('bounded NOAA and regional-gauge source requests', () => {
  it.each([fetchNoaaObserved, fetchNoaaPredictions])('bounds a NOAA request and rejects an HTTP-success provider error', async request => {
    upstream.fetch.mockResolvedValueOnce(response({ error: { message: 'No data was found' } }));
    await expect(request('8658163', start, end)).rejects.toThrow('No data was found');
    expect(upstream.fetch).toHaveBeenCalledWith(expect.stringContaining('station=8658163'), expect.objectContaining({ timeout: 30_000, size: 4_000_000 }));
  });
  it('bounds gauge retrieval and preserves its verified physical reference', async () => {
    upstream.fetch.mockResolvedValueOnce(response({ features: [{ properties: {
      platform_id: 'SUNNYD_CB_03', parameters: [{
        id: 'FIMAN (observed)', units: 'ft',
        www: { description: 'https://fiman.nc.gov/?id=30046', uom_ts_suffix: 'NAVD88' },
        observations: { times: [start.toISOString()], values: ['1.25'], quality_levels: ['0'] },
      }],
    } }] }));
    const data = await fetchFimanData('SUNNYD_CB_03', start, end, 2.75);
    expect(data.waterLevels).toEqual({ [start.toISOString()]: 4 });
    expect(upstream.fetch).toHaveBeenCalledWith(expect.stringContaining('platform=SUNNYD_CB_03'), { timeout: 30_000 });
  });
  it('propagates timed-out sources rather than manufacturing zero water', async () => {
    upstream.fetch.mockRejectedValueOnce(new Error('network timeout'));
    await expect(fetchFimanData('SUNNYD_CB_03', start, end, 2.75)).rejects.toThrow('network timeout');
  });
});

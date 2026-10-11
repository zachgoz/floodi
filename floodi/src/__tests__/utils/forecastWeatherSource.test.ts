import { describe, expect, it } from 'vitest';
import { parseWeather } from '../../../functions/src/forecast/sources';

const fixture = () => ({
  utc_offset_seconds: 0,
  hourly_units: { time: 'iso8601', wind_speed_10m: 'mp/h', wind_direction_10m: '°', precipitation: 'inch', pressure_msl: 'hPa' },
  hourly: { time: ['2026-10-10T12:00', '2026-10-10T13:00Z'], wind_speed_10m: [10, 12], wind_direction_10m: [45, 60], precipitation: [.1, null], pressure_msl: [1015, 1014] },
});
describe('weather input reference checks', () => {
  it('preserves explicit mph, inches, MSL hPa and UTC with unknown rain remaining missing', () => {
    const values = parseWeather(fixture());
    expect(values[0]).toMatchObject({ t: new Date('2026-10-10T12:00:00Z'), windSpeed: 10, precip: .1, pressure: 1015 });
    expect(values[1].t.toISOString()).toBe('2026-10-10T13:00:00.000Z');
    expect(values[1].precip).toBeUndefined();
  });
  it.each(['wind_speed_10m', 'precipitation', 'pressure_msl'] as const)('rejects incompatible %s units', key => {
    const input = fixture(); input.hourly_units[key] = 'incompatible';
    expect(() => parseWeather(input)).toThrow('incompatible units');
  });
  it('rejects unknown timezone and invalid timestamps', () => {
    expect(() => parseWeather({ ...fixture(), utc_offset_seconds: -14400 })).toThrow('timezone');
    const input = fixture(); input.hourly.time[0] = 'invalid';
    expect(() => parseWeather(input)).toThrow('invalid UTC');
    expect(parseWeather({})).toEqual([]);
  });
});

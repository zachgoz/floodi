const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function loadWeather(fetch) {
  const path = require.resolve('../lib/etl/weather');
  const originalLoad = Module._load;
  delete require.cache[path];
  Module._load = function (request, ...args) {
    if (request === 'node-fetch') return fetch;
    return originalLoad.call(this, request, ...args);
  };
  try { return require(path); } finally { Module._load = originalLoad; }
}

const response = data => ({ ok: true, json: async () => data });
function observationApi(properties, hourly = {}) {
  const requests = [];
  const fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.includes('/points/')) return response({ properties: { observationStations: 'https://api.weather.gov/stations' } });
    if (url === 'https://api.weather.gov/stations') return response({ features: [{ id: 'https://api.weather.gov/stations/KILM' }] });
    if (url.includes('/observations')) return response({ features: properties.map(properties => ({ properties })) });
    if (url.includes('api.open-meteo.com')) return response({ hourly });
    throw new Error(`Unexpected request ${url}`);
  };
  return { ...loadWeather(fetch), requests };
}
const time = '2026-10-14T11:15:00+00:00';
const start = new Date('2026-10-14T10:00:00Z');
const end = new Date('2026-10-14T12:00:00Z');

test('omits null and missing NWS fields that previously rejected the entire Firestore write', async () => {
  const api = observationApi([{ timestamp: time, temperature: { value: 20 }, windSpeed: { value: null }, windDirection: { value: null }, barometricPressure: null, precipitationLastHour: { value: null }, textDescription: 'Clear', icon: null }]);
  const result = await api.fetchNwsObservations(34, -78, start, end);
  assert.deepEqual(result, { [time]: { temp: 68, description: 'Clear' } });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  assert.ok(api.requests.every(request => request.options.timeout === 30000));
});

test('retains measured zero rainfall, north direction, calm wind and Celsius zero', async () => {
  const api = observationApi([{ timestamp: time, temperature: { value: 0 }, windSpeed: { value: 0 }, windDirection: { value: 0 }, barometricPressure: { value: 101325 }, precipitationLastHour: { value: 0 } }]);
  assert.deepEqual(await api.fetchNwsObservations(34, -78, start, end), {
    [time]: { temp: 32, windSpeed: 0, windDirection: 0, pressure: 1013.25, precip: 0 },
  });
});

test('discards invalid numeric observations and timestamps rather than fabricating measurements', async () => {
  const api = observationApi([
    { timestamp: 'bad-date', temperature: { value: 21 } },
    { timestamp: time, temperature: { value: Infinity }, windSpeed: { value: -1 }, windDirection: { value: 361 }, barometricPressure: { value: 0 }, precipitationLastHour: { value: NaN }, icon: null },
    { timestamp: '2026-10-14T11:30:00Z', windSpeed: { value: '20' }, precipitationLastHour: { value: -1 }, windDirection: { value: -20 } },
  ]);
  assert.deepEqual(await api.fetchNwsObservations(34, -78, start, end), {});
});

test('Open-Meteo augmentation omits missing arrays and null measurements and keeps valid zeros', async () => {
  const api = observationApi([], {
    time: ['2026-10-14T09:00', '2026-10-14T11:00', '2026-10-14T12:00', '2026-10-14T13:00', 'invalid'],
    wind_speed_10m: [10, 0, null, 20], wind_direction_10m: [45, 0, null, 50], precipitation: [1, 0, null, 3],
  });
  assert.deepEqual(await api.fetchNwsObservations(34, -78, start, end), {
    '2026-10-14T11:00:00+00:00': { windSpeed: 0, windDirection: 0, precip: 0 },
  });
});

test('invalid Open-Meteo values do not overwrite valid NWS measurements', async () => {
  const aligned = '2026-10-14T11:00:00+00:00';
  const api = observationApi([{ timestamp: aligned, temperature: { value: 10 }, windSpeed: { value: 20 }, windDirection: { value: 90 }, precipitationLastHour: { value: 2 } }], {
    time: ['2026-10-14T11:00'], temperature_2m: [NaN], wind_speed_10m: [-3], wind_direction_10m: [Infinity], precipitation: [null], surface_pressure: [null],
  });
  assert.deepEqual(await api.fetchNwsObservations(34, -78, start, end), {
    [aligned]: { temp: 50, windSpeed: 20 * .621371, windDirection: 90, precip: 2 * .0393701 },
  });
});

test('preserves the declared temperature, wind, rainfall and pressure conversions', async () => {
  const api = observationApi([], {
    time: ['2026-10-14T11:00'], temperature_2m: [20], wind_speed_10m: [32], wind_direction_10m: [337.5], precipitation: [25.4], surface_pressure: [1011],
  });
  assert.deepEqual(await api.fetchNwsObservations(34, -78, start, end), {
    '2026-10-14T11:00:00+00:00': { temp: 68, windSpeed: 32 * .621371, windDirection: 337.5, precip: 25.4 * .0393701, pressure: 1011 },
  });
});

test('missing forecast wind and unknown direction remain absent, and valid zero remains zero', async () => {
  const requests = [];
  const api = loadWeather(async (url, options) => {
    requests.push({ url, options });
    if (url.includes('/points/')) return response({ properties: { forecastHourly: 'https://api.weather.gov/hourly' } });
    return response({ properties: { periods: [
      { startTime: time, temperature: 70, windSpeed: null, windDirection: 'VRB', shortForecast: 'Cloudy' },
      { startTime: '2026-10-14T12:00:00Z', temperature: 0, temperatureUnit: 'C', windSpeed: '0 mph', windDirection: 'N' },
      { startTime: '2026-10-14T13:00:00Z', temperature: NaN, windSpeed: 'Unknown', windDirection: Infinity },
      { startTime: 'invalid', temperature: 70, windSpeed: '10 mph' },
    ] } });
  });
  assert.deepEqual(await api.fetchNwsForecast(34, -78), {
    [time]: { temp: 70, description: 'Cloudy' },
    '2026-10-14T12:00:00Z': { temp: 32, windSpeed: 0, windDirection: 0 },
  });
  assert.ok(requests.every(request => request.options.timeout === 30000));
});

test('forecast compass directions retain supported degree values', async () => {
  const api = loadWeather(async url => {
    if (url.includes('/points/')) return response({ properties: { forecastHourly: 'https://api.weather.gov/hourly' } });
    return response({ properties: { periods: [{ startTime: time, windSpeed: '15 mph', windDirection: ' nne ' }] } });
  });
  assert.deepEqual(await api.fetchNwsForecast(34, -78), { [time]: { windSpeed: 15, windDirection: 22.5 } });
});

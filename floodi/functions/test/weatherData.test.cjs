const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function loadWeather(fetch) {
  const path = require.resolve('../lib/etl/weather');
  const originalLoad = Module._load;
  delete require.cache[path];
  delete require.cache[require.resolve('../lib/utils/providerRequest')];
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

test('forecast merges Open-Meteo precipitation onto timezone-offset NWS keys without duplicating timestamps', async () => {
  const nwsKey = '2026-11-25T14:00:00-05:00'; // equals 2026-11-25T19:00:00Z
  const extendedKey = '2026-12-03T19:00:00+00:00';
  const api = loadWeather(async url => {
    if (url.includes('/points/')) return response({ properties: { forecastHourly: 'https://api.weather.gov/hourly' } });
    if (url.includes('api.weather.gov/hourly')) {
      return response({ properties: { periods: [
        { startTime: nwsKey, temperature: 62, windSpeed: '18 mph', windDirection: 'NE', shortForecast: 'Rain', icon: 'https://api.weather.gov/icon' },
      ] } });
    }
    if (url.includes('api.open-meteo.com')) {
      return response({
        hourly_units: { temperature_2m: '°C', wind_speed_10m: 'km/h', precipitation: 'mm', surface_pressure: 'hPa' },
        hourly: {
          time: ['2026-11-25T19:00', '2026-12-03T19:00'],
          temperature_2m: [15, 10],
          wind_speed_10m: [25, 16],
          wind_direction_10m: [60, 180],
          precipitation: [19.812, 0], // 0.78 in and valid zero
          surface_pressure: [1004.5, 1018.2],
        },
      });
    }
    throw new Error(`Unexpected request ${url}`);
  });

  const result = await api.fetchNwsForecast(34.04, -77.89);
  assert.deepEqual(Object.keys(result).sort(), [nwsKey, extendedKey]);
  assert.equal(result[nwsKey].temp, 62); // preserves NWS temp
  assert.equal(result[nwsKey].windSpeed, 18); // preserves NWS windSpeed
  assert.equal(result[nwsKey].windDirection, 45); // preserves NWS NE
  assert.equal(result[nwsKey].pressure, 1004.5);
  assert.ok(Math.abs(result[nwsKey].precip - 19.812 * 0.0393701) < 1e-6);
  // Extended range beyond NWS populates full Open-Meteo record including zero precip
  assert.deepEqual(result[extendedKey], {
    temp: 50,
    windSpeed: 16 * 0.621371,
    windDirection: 180,
    precip: 0,
    pressure: 1018.2,
  });
});

test('forecast rejects negative, NaN, and null Open-Meteo precipitation while honoring inch units', async () => {
  const api = loadWeather(async url => {
    if (url.includes('/points/')) return response({ properties: { forecastHourly: 'https://api.weather.gov/hourly' } });
    if (url.includes('api.weather.gov/hourly')) return response({ properties: { periods: [] } });
    if (url.includes('api.open-meteo.com')) {
      return response({
        hourly_units: { temperature_2m: '°F', wind_speed_10m: 'mph', precipitation: 'inch' },
        hourly: {
          time: ['2026-11-25T19:00', '2026-11-25T20:00', '2026-11-25T21:00', 'bad-date'],
          temperature_2m: [64, 63, NaN, 60],
          wind_speed_10m: [12, -5, null, 10],
          wind_direction_10m: [90, 400, -10, 45],
          precipitation: [0.42, -0.1, null, 1.0],
          surface_pressure: [1010, 0, null, 1012],
        },
      });
    }
    throw new Error(`Unexpected request ${url}`);
  });

  const result = await api.fetchNwsForecast(34.04, -77.89);
  assert.deepEqual(result, {
    '2026-11-25T19:00:00+00:00': { temp: 64, windSpeed: 12, windDirection: 90, precip: 0.42, pressure: 1010 },
    '2026-11-25T20:00:00+00:00': { temp: 63 },
  });
});

test('forecast degrades gracefully when NWS fails (Open-Meteo fallback) or Open-Meteo fails (NWS fallback), and throws if both fail', async () => {
  const omOnly = loadWeather(async url => {
    if (url.includes('api.weather.gov')) throw new Error('NWS 503');
    if (url.includes('api.open-meteo.com')) {
      return response({
        hourly: { time: ['2026-11-25T19:00'], precipitation: [25.4], wind_speed_10m: [10], wind_direction_10m: [90] },
      });
    }
    throw new Error(`Unexpected request ${url}`);
  });
  const omResult = await omOnly.fetchNwsForecast(34.04, -77.89);
  assert.ok(Math.abs(omResult['2026-11-25T19:00:00+00:00'].precip - 25.4 * 0.0393701) < 1e-6);

  const nwsOnly = loadWeather(async url => {
    if (url.includes('/points/')) return response({ properties: { forecastHourly: 'https://api.weather.gov/hourly' } });
    if (url.includes('api.weather.gov/hourly')) {
      return response({ properties: { periods: [{ startTime: time, temperature: 68, windSpeed: '10 mph', windDirection: 'E' }] } });
    }
    if (url.includes('api.open-meteo.com')) throw new Error('Open-Meteo timeout');
    throw new Error(`Unexpected request ${url}`);
  });
  assert.deepEqual(await nwsOnly.fetchNwsForecast(34.04, -77.89), {
    [time]: { temp: 68, windSpeed: 10, windDirection: 90 },
  });

  const bothFailed = loadWeather(async () => { throw new Error('Upstream down'); });
  await assert.rejects(bothFailed.fetchNwsForecast(34.04, -77.89), /Upstream down/);
});

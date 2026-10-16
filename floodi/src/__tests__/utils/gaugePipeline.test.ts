import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildGaugeForecast } from '../../../functions/src/forecast/gaugePipeline';
import { validateForecast } from '../../../functions/src/forecast/schema';
import { projectLongRangeResidual, projectShortRangeResidual, projectWeatherResidual, trainWeatherResponse, WeatherResponseModel } from '../../../functions/src/forecast/weatherResponse';
import { historicalOutlookFixture } from '../fixtures/historicalOutlook';
import { WaterPoint } from '../../../functions/src/forecast/water';

vi.mock('../../../functions/src/forecast/weatherResponse', () => ({
  trainWeatherResponse: vi.fn(), projectWeatherResidual: vi.fn(), projectShortRangeResidual: vi.fn(), projectLongRangeResidual: vi.fn(), LONG_RANGE_LEADS: [12, 24, 48, 72], LONG_RANGE_FEATURES: Array(8).fill('fixture'),
}));

const HOUR = 3600_000;
const MINUTE = 60_000;
const now = new Date('2026-10-10T12:00:00Z');
const measuredAt = new Date(+now - 41 * MINUTE);
const ref = { station: '30046', datum: 'MLLW', units: 'ft' };
const history = Array.from({ length: 31 }, (_, i) => ({
  t: new Date(+measuredAt - 3 * HOUR + i * 6 * MINUTE), v: .5 + i * .005,
}));
const tide = Array.from({ length: 291 }, (_, i) => ({ t: new Date(+now - 5 * HOUR + i * 6 * MINUTE), v: 4 + .5 * Math.sin(i / 20) }));
const futureTide = tide.filter(p => p.t >= now);
const weather = Array.from({ length: 73 }, (_, i) => ({
  t: new Date(+now - 48 * HOUR + i * HOUR), windSpeed: 12, windDirection: 45, pressure: 1015, precip: 0,
}));
const trainMock = vi.mocked(trainWeatherResponse);
const projectMock = vi.mocked(projectWeatherResidual);
const shortProjectMock = vi.mocked(projectShortRangeResidual);
const longProjectMock = vi.mocked(projectLongRangeResidual);
const candidate = (): WeatherResponseModel => ({
  reference: ref, tideReference: ref, maxObservationGapMs: 30 * MINUTE,
  trainedUntil: measuredAt, holdoutStarts: new Date('2026-09-06T00:00:00Z'),
  testStart: new Date('2026-09-06T00:00:00Z'), testEnd: new Date('2026-10-03T00:00:00Z'),
  regressions: [],
  validation: {
    leads: [1, 3, 6, 12, 24].map(leadHours => ({ leadHours, trainingPairs: 300, testPairs: 120, modelMaeFt: .15, persistenceMaeFt: .25, improvement: .4, absoluteError90Ft: .4, passes: true })),
    peakWindows: 0, peakMaeFt: null, persistencePeakMaeFt: null, eligible: false, pointEligible: true, weatherInput: 'reanalysis hindcast',
  }, limitations: ['Synthetic numerical model fixture; inference and schema integration only'],
});
const shortCandidate = (): WeatherResponseModel => ({
  ...candidate(),
  shortRange: {
    regressions: [], eligible: true, peakWindows: 12, peakMaeFt: .21, persistencePeakMaeFt: .239,
    leads: [1, 3, 6].map((leadHours, i) => ({ leadHours, trainingPairs: 300, testPairs: 120 * (i + 1), modelMaeFt: .11 + i * .05, persistenceMaeFt: .26 + i * .04, improvement: .3, absoluteError90Ft: [.25, .36, .51][i], passes: true })),
  },
});
beforeEach(() => {
  vi.clearAllMocks();
  trainMock.mockReturnValue(candidate());
  projectMock.mockImplementation((_model, measuredHistory, _tides, _pastWeather, _futureWeather, times, issue) => {
    const anchor = measuredHistory.at(-1)!;
    return [...new Set(times.map(t => +t))].sort((a, b) => a - b).map(t => ({ t: new Date(t), v: anchor.v + .002 * (t - +issue) / MINUTE }));
  });
  shortProjectMock.mockImplementation((_model, measuredHistory, _tides, times, issue) => {
    const anchor = measuredHistory.at(-1)!;
    return [...new Set(times.filter(t => t >= now && +t <= +issue + 6 * HOUR).map(t => +t))].sort((a, b) => a - b).map(t => ({ t: new Date(t), v: anchor.v - .0015 * (t - +issue) / MINUTE }));
  });
  longProjectMock.mockImplementation((_model, _history, _tide, times, issue, _reference, _tideReference, options) => {
    const prefix = options?.prefix ?? [];
    const junction = prefix.at(-1)!;
    return times.filter(time => +time > +junction.t && +time <= +issue + 72 * HOUR).map(time => ({ t: time, v: junction.v + (+time - +junction.t) / HOUR * .003 }));
  });
});
const forecast = (observations: WaterPoint[] = history, at: Date = now) =>
  buildGaugeForecast(observations, tide, weather.filter(w => w.t <= at), futureTide, weather, at);

describe('regional gauge forecast pipeline', () => {
  it('issues from the actual delayed observation and nowcasts the reporting delay', () => {
    const document = forecast();
    expect(document.status).toBe('available');
    expect(document.method).toBe('weather-response');
    expect(document.confidence).toBe('limited');
    expect(document.validationStage).toBe('historical-hindcast');
    expect(document.generatedAt).toBe(now.toISOString());
    expect(document.observationAt).toBe(measuredAt.toISOString());
    expect(document.forecastOriginAt).toBe(measuredAt.toISOString());
    expect(document.currentResidualFt).toBeCloseTo(history.at(-1)!.v);
    const call = projectMock.mock.calls[0];
    expect(call[6]).toEqual(measuredAt);
    expect(call[5][0]).toEqual(now);
    expect(call[9]).toEqual({ allowPointValidatedExperimental: true, includeDrivers: true });
    expect(document.points[0].residualFt).toBeCloseTo(history.at(-1)!.v + .002 * 41);
    expect(document.evidence.find(e => e.id === 'observation')?.text).toContain('41 minutes');
    expect(validateForecast(document)).toBe(true);
  });
  it('keeps unavailable peak and event validation null rather than inventing perfect accuracy', () => {
    const document = forecast();
    expect(document.validation?.kind).toBe('chronological-weather-response-hindcast');
    for (const metrics of [document.validation!.model, document.validation!.persistence, document.validation!.tideOnly]) {
      expect(metrics.peakMaeFt).toBeNull();
      expect(metrics.onsetMaeMinutes).toBeNull();
      expect(metrics.durationMaeMinutes).toBeNull();
      expect(metrics.hits).toBeNull();
      expect(metrics.misses).toBeNull();
      expect(metrics.falseAlarms).toBeNull();
      expect(metrics.matchedEvents).toBeNull();
    }
    expect(document.validation?.model.maeFt).toBeCloseTo(.15);
    expect(document.validation?.persistence.maeFt).toBeCloseTo(.25);
    expect(document.validation?.tideOnly.maeFt).toBeNull();
    expect(document.leadValidation).toHaveLength(5);
  });
  it('combines matching timestamps and retains a finite historical error envelope', () => {
    const document = forecast();
    expect(document.points.length).toBeGreaterThanOrEqual(10);
    for (let i = 0; i < document.points.length; i++) {
      const point = document.points[i];
      expect(point.totalFt).toBeCloseTo(point.tideFt + point.residualFt);
      expect(point.lowerFt).toBeCloseTo(point.totalFt - .4);
      expect(point.upperFt).toBeCloseTo(point.totalFt + .4);
      expect(Date.parse(point.t)).toBeGreaterThanOrEqual(+now);
      expect(Date.parse(point.t)).toBeLessThanOrEqual(+measuredAt + 24 * HOUR);
      if (i) expect(Date.parse(point.t)).toBeGreaterThan(Date.parse(document.points[i - 1].t));
    }
    expect(document.explanationSource).toBe('fallback');
    expect(validateForecast(document)).toBe(true);
  });
  it('uses a daily cached model without fitting again on each numerical refresh', () => {
    const model = candidate();
    const document = buildGaugeForecast(history, tide, weather, futureTide, weather, now, { model });
    expect(trainMock).not.toHaveBeenCalled();
    expect(projectMock.mock.calls[0][0]).toBe(model);
    expect(document.status).toBe('available');
    expect(validateForecast(document)).toBe(true);
  });
  it('withholds a numerical forecast instead of retraining when a cached model is missing', () => {
    const document = buildGaugeForecast(history, tide, weather, futureTide, weather, now, { model: null });
    expect(trainMock).not.toHaveBeenCalled();
    expect(projectMock).not.toHaveBeenCalled();
    expect(document.status).toBe('unavailable');
    expect(validateForecast(document)).toBe(true);
  });
  it('excludes future observations and estimated display bridges before training or selecting an anchor', () => {
    const bridge = { t: new Date(+now - MINUTE), v: 99, estimated: true };
    const future = { t: new Date(+now + MINUTE), v: 999 };
    const document = forecast([...history, bridge, future].reverse());
    expect(trainMock.mock.calls[0][0]).toEqual(history);
    expect(projectMock.mock.calls[0][1]).toEqual(history);
    expect(projectMock.mock.calls[0][6]).toEqual(measuredAt);
    expect(document.observationAt).toBe(measuredAt.toISOString());
    expect(document.currentResidualFt).toBeCloseTo(history.at(-1)!.v);
    expect(validateForecast(document)).toBe(true);
  });
  it('withholds curves for observations over one hour old even when the historical gate passes', () => {
    const stale = history.map(p => ({ ...p, t: new Date(+p.t - 20 * MINUTE) }));
    const document = forecast(stale);
    expect(document.status).toBe('unavailable');
    expect(document.currentResidualFt).toBeNull();
    expect(document.points).toEqual([]);
    expect(projectMock).not.toHaveBeenCalled();
    expect(validateForecast(document)).toBe(true);
  });
  it('withholds curves for failed model screening, missing history or incomplete projected coverage', () => {
    const failed = candidate();
    failed.validation.pointEligible = false;
    trainMock.mockReturnValueOnce(failed);
    expect(forecast().status).toBe('unavailable');
    expect(projectMock).not.toHaveBeenCalled();
    trainMock.mockReturnValueOnce(null);
    const empty = forecast([]);
    expect(empty.points).toEqual([]);
    expect(empty.validation).toBeNull();
    expect(validateForecast(empty)).toBe(true);
    projectMock.mockReturnValueOnce([]);
    const incomplete = forecast();
    expect(incomplete.status).toBe('unavailable');
    expect(incomplete.points).toEqual([]);
    expect(validateForecast(incomplete)).toBe(true);
  });
  it('keeps the weather response when both evaluated models can produce a curve', () => {
    trainMock.mockReturnValueOnce(shortCandidate());
    const document = forecast();
    expect(document.method).toBe('weather-response');
    expect(document.leadValidation).toHaveLength(5);
    expect(shortProjectMock).not.toHaveBeenCalled();
  });
  it('dispatches to the separately evaluated residual response when issued weather cannot support a curve', () => {
    const model = shortCandidate();
    trainMock.mockReturnValueOnce(model);
    projectMock.mockReturnValueOnce([]);
    const document = forecast();
    expect(document.status).toBe('available');
    expect(document.method).toBe('residual-response');
    expect(document.confidence).toBe('limited');
    expect(document.validationStage).toBe('historical-hindcast');
    expect(document.generatedAt).toBe(now.toISOString());
    expect(document.observationAt).toBe(measuredAt.toISOString());
    expect(document.forecastOriginAt).toBe(measuredAt.toISOString());
    expect(shortProjectMock).toHaveBeenCalledTimes(1);
    expect(shortProjectMock.mock.calls[0][0]).toBe(model);
    expect(shortProjectMock.mock.calls[0][1]).toEqual(history);
    expect(shortProjectMock.mock.calls[0][4]).toEqual(measuredAt);
    expect(shortProjectMock.mock.calls[0][5]).toEqual(ref);
    expect(shortProjectMock.mock.calls[0][6]).toEqual(ref);
    expect(document.evidence.find(e => e.id === 'availability')?.text).toContain('six-hour');
    expect(document.evidence.find(e => e.id === 'weather')?.text).toContain('Recent measured changes and tidal phase');
    expect(validateForecast(document)).toBe(true);
  });
  it('uses independent short-range screening even when the longer model is ineligible', () => {
    const model = shortCandidate();
    model.validation.pointEligible = false;
    model.validation.eligible = false;
    trainMock.mockReturnValueOnce(model);
    projectMock.mockReturnValueOnce([]);
    const document = forecast();
    expect(document.status).toBe('available');
    expect(document.method).toBe('residual-response');
    expect(document.leadValidation?.map(lead => lead.leadHours)).toEqual([1, 3, 6]);
    expect(validateForecast(document)).toBe(true);
  });
  it('replaces the weather error envelope and metrics with the selected residual-response validation', () => {
    const model = shortCandidate();
    trainMock.mockReturnValueOnce(model);
    projectMock.mockReturnValueOnce([]);
    const document = forecast();
    const leads = model.shortRange!.leads;
    const samples = leads.reduce((sum, lead) => sum + lead.testPairs, 0);
    const expectedMae = leads.reduce((sum, lead) => sum + lead.testPairs * lead.modelMaeFt!, 0) / samples;
    const expectedSteadyMae = leads.reduce((sum, lead) => sum + lead.testPairs * lead.persistenceMaeFt!, 0) / samples;
    expect(document.validation!.trainingSamples).toBe(900);
    expect(document.validation!.model.samples).toBe(720);
    expect(document.validation!.model.maeFt).toBeCloseTo(expectedMae);
    expect(document.validation!.persistence.maeFt).toBeCloseTo(expectedSteadyMae);
    expect(document.validation!.model.peakMaeFt).toBe(.21);
    expect(document.validation!.persistence.peakMaeFt).toBe(.239);
    expect(document.validation!.error90Ft).toBe(.51);
    expect(document.validation!.model.onsetMaeMinutes).toBeNull();
    expect(document.validation!.model.misses).toBeNull();
    for (const point of document.points) {
      expect(point.totalFt).toBeCloseTo(point.tideFt + point.residualFt);
      expect(point.lowerFt).toBeCloseTo(point.totalFt - .51);
      expect(point.upperFt).toBeCloseTo(point.totalFt + .51);
    }
  });
  it('stops the selected fallback at its measured six-hour horizon without a weather or steady tail', () => {
    trainMock.mockReturnValueOnce(shortCandidate());
    projectMock.mockReturnValueOnce([]);
    const document = forecast();
    expect(futureTide.at(-1)!.t.getTime()).toBeGreaterThan(+measuredAt + 6 * HOUR);
    expect(document.points.length).toBeGreaterThanOrEqual(10);
    expect(Date.parse(document.points.at(-1)!.t)).toBeGreaterThan(+now + 5 * HOUR);
    for (const point of document.points) {
      expect(Date.parse(point.t)).toBeGreaterThanOrEqual(+now);
      expect(Date.parse(point.t)).toBeLessThanOrEqual(+measuredAt + 6 * HOUR);
    }
  });
  it.each(['failed-screen', 'missing-short', 'no-supported-points', 'too-little-coverage'] as const)('withholds the fallback for %s', failure => {
    const model = shortCandidate();
    model.validation.pointEligible = false;
    if (failure === 'failed-screen') model.shortRange!.eligible = false;
    if (failure === 'missing-short') model.shortRange = undefined;
    if (failure === 'no-supported-points') shortProjectMock.mockReturnValueOnce([]);
    if (failure === 'too-little-coverage') shortProjectMock.mockReturnValueOnce(futureTide.slice(0, 9).map(point => ({ t: point.t, v: .6 })));
    trainMock.mockReturnValueOnce(model);
    projectMock.mockReturnValueOnce([]);
    const document = forecast();
    expect(document.status).toBe('unavailable');
    expect(document.points).toEqual([]);
    expect(validateForecast(document)).toBe(true);
    if (failure === 'failed-screen' || failure === 'missing-short') expect(shortProjectMock).not.toHaveBeenCalled();
  });
});

const threeDayTide = Array.from({ length: 811 }, (_, i) => ({ t: new Date(+now - 5 * HOUR + i * 6 * MINUTE), v: 4 + .5 * Math.sin(i / 20) }));
function longCandidate(): WeatherResponseModel {
  return { ...shortCandidate(), longRange: {
    regressions: [], peakByDay: [], eligible: true, peakWindows: 25, peakMaeFt: .22, persistencePeakMaeFt: .3,
    leads: [12, 24, 48, 72].map((leadHours, i) => ({ leadHours, trainingPairs: 300, testPairs: 150, modelMaeFt: .15 + i * .04, persistenceMaeFt: .3 + i * .04, improvement: .25, absoluteError90Ft: .55 + i * .1, passes: true })),
  } };
}
const threeDayForecast = (model: WeatherResponseModel) => buildGaugeForecast(history, threeDayTide, weather, threeDayTide.filter(point => point.t >= now), weather, now, { model });

describe('three-day learned residual extension', () => {
  it.each(['weather', 'residual'] as const)('preserves the entire approved %s prefix and adds a continuous 72-hour outlook', method => {
    const baselineModel = shortCandidate();
    if (method === 'residual') projectMock.mockReturnValueOnce([]);
    const baseline = threeDayForecast(baselineModel);
    if (method === 'residual') projectMock.mockReturnValueOnce([]);
    const extended = threeDayForecast(longCandidate());
    expect(extended.method).toBe(baseline.method);
    expect(extended.points.slice(0, baseline.points.length)).toEqual(baseline.points);
    expect(extended.extension).toMatchObject({ method: 'residual-reversion', startsAt: baseline.points.at(-1)!.t, endsAt: extended.points.at(-1)!.t, peakWindows: 25 });
    expect(Date.parse(extended.points.at(-1)!.t)).toBeGreaterThan(+measuredAt + 71 * HOUR);
    expect(Date.parse(extended.points.at(-1)!.t)).toBeLessThanOrEqual(+measuredAt + 72 * HOUR);
    const junction = baseline.points.at(-1)!;
    const firstTail = extended.points[baseline.points.length];
    expect(firstTail.residualFt - junction.residualFt).toBeLessThan(.001);
    expect(extended.extension!.leadValidation.map(lead => lead.leadHours)).toEqual([12, 24, 48, 72]);
    for (const point of extended.points) expect(point.totalFt).toBeCloseTo(point.tideFt + point.residualFt);
    const widths = extended.points.map(point => point.upperFt - point.totalFt);
    for (let i = baseline.points.length; i < widths.length; i++) expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1] - 1e-9);
    expect(widths.at(-1)).toBeGreaterThan(widths[0]);
    expect(validateForecast(extended)).toBe(true);
  });
  it.each(['point-skill', 'peak-skill', 'pairs', 'no-tail', 'partial-tail', 'gap'] as const)('keeps only the approved prefix when long-range support fails: %s', failure => {
    const model = longCandidate();
    if (failure === 'point-skill') model.longRange!.leads[3].modelMaeFt = .6;
    if (failure === 'peak-skill') model.longRange!.peakMaeFt = .6;
    if (failure === 'pairs') model.longRange!.leads[0].testPairs = 99;
    if (failure === 'no-tail') longProjectMock.mockReturnValueOnce([]);
    if (failure === 'partial-tail') longProjectMock.mockReturnValueOnce([{ t: new Date(+now + 25 * HOUR), v: .6 }]);
    if (failure === 'gap') longProjectMock.mockReturnValueOnce([{ t: new Date(+measuredAt + 30 * HOUR), v: .6 }, { t: new Date(+measuredAt + 72 * HOUR), v: .7 }]);
    const baseline = threeDayForecast(shortCandidate());
    // Failures which consume a one-shot projector belong to the extended issue.
    if (['no-tail', 'partial-tail', 'gap'].includes(failure)) expect(longProjectMock).not.toHaveBeenCalled();
    const extended = threeDayForecast(model);
    expect(extended.status).toBe('available');
    expect(extended.points).toEqual(baseline.points);
    expect(extended.extension).toBeUndefined();
    expect(validateForecast(extended)).toBe(true);
  });
  it('describes the residual fallback and three-day extension without calling the full net change a six-hour forecast', () => {
    projectMock.mockReturnValueOnce([]);
    const document = threeDayForecast(longCandidate());
    expect(document.method).toBe('residual-response');
    expect(document.evidence.find(item => item.id === 'availability')?.text).toContain('three-day');
    expect(document.evidence.find(item => item.id === 'weather')?.text).toContain('three-day');
    expect(document.evidence.find(item => item.id === 'weather')?.text).not.toContain('next available six hours');
  });
  it.each(['horizon', 'missing-junction', 'end-mismatch', 'bad-lead-order', 'negative-error', 'missing-origin'] as const)('rejects an extension with malformed physical or chronology metadata: %s', failure => {
    const document = threeDayForecast(longCandidate());
    if (failure === 'horizon') { const last = document.points.at(-1)!; last.t = new Date(+measuredAt + 72 * HOUR + MINUTE).toISOString(); document.extension!.endsAt = last.t; }
    if (failure === 'missing-junction') document.extension!.startsAt = new Date(Date.parse(document.extension!.startsAt) + 1).toISOString();
    if (failure === 'end-mismatch') document.extension!.endsAt = document.points.at(-2)!.t;
    if (failure === 'bad-lead-order') document.extension!.leadValidation.reverse();
    if (failure === 'negative-error') document.extension!.leadValidation[0].absoluteError90Ft = -1;
    if (failure === 'missing-origin') document.forecastOriginAt = undefined;
    expect(validateForecast(document)).toBe(false);
  });
  it('leaves skill screening to selection so a structurally sound prefix can survive a rejected extension', () => {
    const document = threeDayForecast(longCandidate());
    document.extension!.leadValidation[3].modelMaeFt = .8;
    expect(validateForecast(document)).toBe(true);
  });
});

function bridgeCandidate(): WeatherResponseModel {
  const candidate = longCandidate();
  candidate.longRange!.leads = candidate.longRange!.leads.map(lead => lead.leadHours <= 24 ? { ...lead, method: 'steady-residual', modelMaeFt: lead.persistenceMaeFt, improvement: 0, passes: false } : { ...lead, method: 'residual-reversion' });
  candidate.longRange!.prefixValidation = {
    'residual-response': { peakWindows: 36, peakMaeFt: .245, persistencePeakMaeFt: .28, eligible: true },
    'weather-response': { peakWindows: 38, peakMaeFt: .23, persistencePeakMaeFt: .28, eligible: true },
  };
  return candidate;
}
describe('explicit baseline bridge and exact prefix screening', () => {
  it.each(['weather-response', 'residual-response'] as const)('publishes %s composite peak metrics, with baseline and learned leads labeled accurately', method => {
    const model = bridgeCandidate();
    if (method === 'residual-response') projectMock.mockReturnValueOnce([]);
    const document = threeDayForecast(model);
    expect(document.method).toBe(method);
    expect(document.extension!.leadValidation.map(lead => lead.method)).toEqual(['steady-residual', 'steady-residual', 'residual-reversion', 'residual-reversion']);
    expect(document.extension!.leadValidation[0].modelMaeFt).toBe(document.extension!.leadValidation[0].persistenceMaeFt);
    expect(document.extension!.peakMaeFt).toBe(model.longRange!.prefixValidation![method].peakMaeFt);
    expect(document.extension!.peakWindows).toBe(model.longRange!.prefixValidation![method].peakWindows);
    expect(document.limitations.some(item => item.includes('12/24-hour bridge holds'))).toBe(true);
    expect(validateForecast(document)).toBe(true);
  });
  it.each(['weather-response', 'residual-response'] as const)('keeps the prefix when its exact %s composite has not passed, even if another prefix is eligible', method => {
    const model = bridgeCandidate(); model.longRange!.prefixValidation![method].eligible = false;
    if (method === 'residual-response') projectMock.mockReturnValueOnce([]);
    const document = threeDayForecast(model);
    expect(document.method).toBe(method);
    expect(document.extension).toBeUndefined();
    expect(longProjectMock).not.toHaveBeenCalled();
    expect(validateForecast(document)).toBe(true);
  });
  it.each(['bridge-mae', 'bridge-pass', 'bridge-improvement', 'baseline-at-48h', 'no-prefix', 'failed-learned-48h', 'failed-learned-72h'] as const)('withholds an unsupported extension while keeping its near-term prefix: %s', failure => {
    const model = bridgeCandidate(); const long = model.longRange!;
    if (failure === 'bridge-mae') long.leads[0].modelMaeFt = .2;
    if (failure === 'bridge-pass') long.leads[0].passes = true;
    if (failure === 'bridge-improvement') long.leads[0].improvement = .1;
    if (failure === 'baseline-at-48h') long.leads[2].method = 'steady-residual';
    if (failure === 'no-prefix') long.prefixValidation = undefined;
    if (failure === 'failed-learned-48h') long.leads[2].passes = false;
    if (failure === 'failed-learned-72h') long.leads[3].modelMaeFt = .6;
    const document = threeDayForecast(model);
    expect(document.status).toBe('available');
    expect(document.extension).toBeUndefined();
    expect(validateForecast(document)).toBe(true);
  });
  it('rejects a baseline metadata claim of skill and a baseline method at an unsupported lead', () => {
    const document = threeDayForecast(bridgeCandidate());
    document.extension!.leadValidation[0].modelMaeFt = .2;
    expect(validateForecast(document)).toBe(false);
    document.extension!.leadValidation[0].modelMaeFt = document.extension!.leadValidation[0].persistenceMaeFt;
    document.extension!.leadValidation[3].method = 'steady-residual';
    expect(validateForecast(document)).toBe(false);
  });
});

const fullTide = Array.from({ length: (5 + 21 * 24) * 10 + 1 }, (_, i) => ({ t: new Date(+now - 5 * HOUR + i * 6 * MINUTE), v: 4 + .5 * Math.sin(i / 20) }));
const fullWeather = Array.from({ length: 48 + 16 * 24 + 1 }, (_, i) => ({ t: new Date(+now - 48 * HOUR + i * HOUR), windSpeed: 12, windDirection: 45, pressure: 1015, precip: 0 }));
const fullForecast = (model: WeatherResponseModel, weatherInput = fullWeather) => buildGaugeForecast(history, fullTide, weatherInput.filter(point => point.t <= now), fullTide.filter(point => point.t >= now), weatherInput, now, { model });
describe('full NOAA horizon outlook', () => {
  it.each(['weather-response', 'residual-response'] as const)('preserves the exact %s prefix and uses a compact, continuous historical outlook to the actual NOAA endpoint', method => {
    if (method === 'residual-response') projectMock.mockReturnValueOnce([]);
    const baseline = fullForecast(shortCandidate());
    const model = bridgeCandidate(); model.historicalOutlook = historicalOutlookFixture();
    if (method === 'residual-response') projectMock.mockReturnValueOnce([]);
    const document = fullForecast(model);
    expect(document.points.slice(0, baseline.points.length)).toEqual(baseline.points);
    expect(document.method).toBe(method);
    expect(document.extension).toBeUndefined();
    expect(document.tail!.startsAt).toBe(baseline.points.at(-1)!.t);
    expect(document.tail!.endsAt).toBe(fullTide.at(-1)!.t.toISOString());
    expect(Date.parse(document.tail!.endsAt) - +now).toBe(21 * 24 * HOUR);
    expect(document.tail!.summary.historicalEligible).toBe(false);
    expect(document.tail!.summary.selectedFallback).toBe('historical-baseline');
    expect(document.tail!.weatherSupportedUntil).toBeNull();
    expect(document.points.length).toBeGreaterThan(2000);
    expect(document.points.length).toBeLessThan(5000);
    for (let i = 1; i < document.points.length; i++) expect(Date.parse(document.points[i].t) - Date.parse(document.points[i - 1].t)).toBeLessThanOrEqual(15 * MINUTE);
    for (const point of document.points) expect(point.totalFt).toBeCloseTo(point.tideFt + point.residualFt);
    expect(document.points.at(-1)!.upperFt - document.points.at(-1)!.totalFt).toBeGreaterThan(baseline.points.at(-1)!.upperFt - baseline.points.at(-1)!.totalFt);
    expect(validateForecast(document)).toBe(true);
    expect(document.evidence.find(item => item.id === 'availability')?.text).toContain('Weather inputs cannot support');
    expect(document.limitations.some(item => item.includes('did not improve all'))).toBe(true);
    expect(document.limitations.some(item => item.includes('12/24-hour bridge') || item.includes('three-day centerline'))).toBe(false);
  });
  it('uses actual supported weather for its own window, followed by an explicit historical baseline through the remaining NOAA range', () => {
    const model = bridgeCandidate(); model.historicalOutlook = historicalOutlookFixture(true);
    const document = fullForecast(model);
    expect(document.tail!.weatherSupportedUntil).toBe(fullWeather.at(-1)!.t.toISOString());
    expect(Date.parse(document.tail!.weatherSupportedUntil!)).toBeLessThan(Date.parse(document.tail!.endsAt));
    expect(document.tail!.summary.weatherEligible).toBe(true);
    expect(document.evidence.find(item => item.id === 'weather')?.text).toContain('Weather contributes while supported');
    expect(validateForecast(document)).toBe(true);
  });
  it('keeps the independently approved three-day fallback when the new historical model is structurally unsupported', () => {
    const original = fullForecast(bridgeCandidate());
    const model = bridgeCandidate(); model.historicalOutlook = historicalOutlookFixture(); model.historicalOutlook.historical.scales[0] = 0;
    const document = fullForecast(model);
    expect(document.tail).toBeUndefined();
    expect(document.extension).toEqual(original.extension);
    expect(document.points).toEqual(original.points);
    expect(validateForecast(document)).toBe(true);
  });
  it.each(['wrong-station', 'future-fit', 'reversed-window', 'forged-skill', 'weather-without-passed-screen', 'missing-junction', 'wrong-end', 'wrong-bounds', 'wide-gap'] as const)('rejects malformed full-horizon metadata or physical data: %s', failure => {
    const model = bridgeCandidate(); model.historicalOutlook = historicalOutlookFixture();
    const document = fullForecast(model);
    if (failure === 'wrong-station') document.tail!.summary.reference = { ...document.tail!.summary.reference, station: 'SUNNYD_CB_03' };
    if (failure === 'future-fit') document.tail!.summary.trainedUntil = new Date(+now + HOUR).toISOString();
    if (failure === 'reversed-window') document.tail!.summary.trainingStart = '2026-10-04T00:00:00Z';
    if (failure === 'forged-skill') document.tail!.summary.historicalEligible = true;
    if (failure === 'weather-without-passed-screen') document.tail!.weatherSupportedUntil = new Date(+now + HOUR).toISOString();
    if (failure === 'missing-junction') document.tail!.startsAt = new Date(Date.parse(document.tail!.startsAt) + 1).toISOString();
    if (failure === 'wrong-end') document.tail!.endsAt = document.points.at(-2)!.t;
    if (failure === 'wrong-bounds') document.points.at(-1)!.upperFt = -1;
    if (failure === 'wide-gap') document.points.splice(document.points.length - 5, 2);
    expect(validateForecast(document)).toBe(false);
  });
});

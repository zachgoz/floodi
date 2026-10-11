import { describe, expect, it } from 'vitest';
import type { ForecastDocument } from '../../../functions/src/forecast/schema';
import type { HistoricalPatternSummary } from '../../../functions/src/forecast/historicalOutlook';
import { projectHistoricalResidual } from '../../../functions/src/forecast/historicalOutlook';
import { selectWaterForecast } from 'src/utils/selectWaterForecast';
import type { WaterForecastSelectionInput } from 'src/utils/selectWaterForecast';
import { interpolate } from 'src/utils/waterForecast';

const now = new Date('2026-10-10T12:00:00Z');
const at = (minutes: number) => new Date(+now + minutes * 60_000);
const metric = { samples: 150, maeFt: .2, peakMaeFt: null, onsetMaeMinutes: null, durationMaeMinutes: null, hits: null, misses: null, falseAlarms: null, matchedEvents: null };
function fixture(): WaterForecastSelectionInput {
  const points = [0, 6, 12, 18].map((minutes, i) => ({ t: at(minutes).toISOString(), tideFt: 4 + i * .1, residualFt: .7 - i * .05, totalFt: 4.7 + i * .05, lowerFt: 4.3 + i * .05, upperFt: 5.1 + i * .05 }));
  const outlook: ForecastDocument = {
    version: 1, status: 'available', method: 'weather-response', confidence: 'limited', validationStage: 'historical-hindcast', generatedAt: now.toISOString(), expiresAt: at(120).toISOString(),
    locationId: 'carolina-beach', sensor: '30046', tideStation: '8658163', datum: 'MLLW', units: 'ft', phaseMinutes: 60, thresholdFt: 5.6,
    currentResidualFt: .7, observationAt: at(-30).toISOString(), forecastOriginAt: at(-30).toISOString(), trend: 'Increasing', points,
    validation: { kind: 'chronological-weather-response-hindcast', trainEnd: '2026-09-05T00:00:00Z', testStart: '2026-09-06T00:00:00Z', testEnd: '2026-10-02T00:00:00Z', trainingSamples: 500, model: metric, persistence: { ...metric, maeFt: .3 }, tideOnly: metric, error90Ft: .4, limitation: 'Issued weather and event errors unavailable.' },
    leadValidation: [1, 3, 6, 12, 24].map(leadHours => ({ leadHours, testPairs: 150, modelMaeFt: .2, persistenceMaeFt: .3, absoluteError90Ft: .4 })),
    evidence: [{ id: 'availability', text: 'Point-level validation is available.' }], explanation: { headline: 'Elevated flood risk', evidenceIds: ['availability'] }, explanationSource: 'fallback', sources: ['Observed gauge'], limitations: ['Weather reanalysis hindcast'],
  };
  return {
    outlook, weatherCompatible: true, now,
    weatherTotalPoints: points.map(point => ({ t: new Date(point.t), v: point.totalFt })),
    // The chart can use a different localized astronomical tide, so the plotted
    // residual is re-expressed without modifying the server physical total.
    weatherResidualPoints: points.map(point => ({ t: new Date(point.t), v: point.residualFt - .2 })),
    tidePoints: points.map(point => ({ t: new Date(point.t), v: point.tideFt + .2 })),
    steadyTotalPoints: points.map(point => ({ t: new Date(point.t), v: point.tideFt + 1 })),
  };
}

function multiDayFixture(): WaterForecastSelectionInput {
  const input = fixture();
  const points = Array.from({ length: 721 }, (_, i) => {
    const hour = i / 10;
    const tideFt = 3 + 2 * Math.sin(hour / 12.42 * 2 * Math.PI);
    const residualFt = .7 * Math.exp(-hour / 24);
    const totalFt = tideFt + residualFt;
    return { t: at(i * 6).toISOString(), tideFt, residualFt, totalFt, lowerFt: totalFt - .4, upperFt: totalFt + .4 };
  });
  input.outlook!.method = 'residual-response';
  input.outlook!.observationAt = now.toISOString();
  input.outlook!.forecastOriginAt = now.toISOString();
  input.outlook!.leadValidation = input.outlook!.leadValidation!.slice(0, 3);
  input.outlook!.points = points;
  input.outlook!.extension = {
    method: 'residual-reversion', startsAt: at(360).toISOString(), endsAt: at(4320).toISOString(),
    leadValidation: [12, 24, 48, 72].map(leadHours => ({ leadHours, testPairs: 150, modelMaeFt: .2, persistenceMaeFt: .3, absoluteError90Ft: .4 })),
    peakMaeFt: .2, persistencePeakMaeFt: .3, peakWindows: 14,
  };
  input.weatherTotalPoints = points.map(point => ({ t: new Date(point.t), v: point.totalFt }));
  input.weatherResidualPoints = points.map(point => ({ t: new Date(point.t), v: point.residualFt - .2 }));
  input.tidePoints = points.map(point => ({ t: new Date(point.t), v: point.tideFt + .2 }));
  input.steadyTotalPoints = points.map(point => ({ t: new Date(point.t), v: point.tideFt + 1 }));
  return input;
}

function baselineBridgeFixture(): WaterForecastSelectionInput {
  const input = multiDayFixture();
  input.outlook!.extension!.leadValidation.slice(0, 2).forEach(lead => {
    lead.method = 'steady-residual';
    lead.modelMaeFt = lead.persistenceMaeFt;
  });
  const points = input.outlook!.points;
  const anchor = points[0].residualFt, prefixEnd = points[60].residualFt;
  const at48 = points[480].residualFt;
  for (let i = 61; i <= 480; i++) {
    const hour = i / 10;
    const residualFt = hour < 12 ? prefixEnd + (anchor - prefixEnd) * (hour - 6) / 6 :
      hour <= 24 ? anchor : anchor + (at48 - anchor) * (hour - 24) / 24;
    points[i] = { ...points[i], residualFt, totalFt: points[i].tideFt + residualFt,
      lowerFt: points[i].tideFt + residualFt - .4, upperFt: points[i].tideFt + residualFt + .4 };
  }
  input.weatherTotalPoints = points.map(point => ({ t: new Date(point.t), v: point.totalFt }));
  input.weatherResidualPoints = points.map(point => ({ t: new Date(point.t), v: point.residualFt - .2 }));
  return input;
}

function historicalFixture(serverDays = 21, tideDays = serverDays): WaterForecastSelectionInput {
  const input = fixture();
  const tideValue = (minutes: number) => 3 + 2 * Math.sin(minutes / (12.42 * 60) * 2 * Math.PI);
  const times = [...Array.from({ length: 61 }, (_, i) => i * 6),
    ...Array.from({ length: (serverDays * 1440 - 360) / 15 }, (_, i) => 360 + (i + 1) * 15)];
  const points = times.map(minutes => {
    const tideFt = tideValue(minutes), residualFt = .7 * Math.exp(-minutes / 1440);
    const totalFt = tideFt + residualFt;
    return { t: at(minutes).toISOString(), tideFt, residualFt, totalFt, lowerFt: totalFt - .5, upperFt: totalFt + .6 };
  });
  const leads = [1, 3, 6, 24, 72, 120, 168, 336].map(leadHours => ({
    leadHours, testPairs: 150, historicalMaeFt: .4, persistenceMaeFt: .3,
    historicalError90Ft: .6 + leadHours / 336, weatherPairs: 0,
    weatherMaeFt: null, weatherHistoricalMaeFt: null, weatherError90Ft: null,
  }));
  const summary: HistoricalPatternSummary = {
    version: 'historical-tide-v1', reference: { station: '30046', datum: 'MLLW', units: 'ft' },
    tideReference: { station: '30046', datum: 'MLLW', units: 'ft' },
    trainingStart: '2026-06-01T00:00:00Z', trainedUntil: '2026-10-02T00:00:00Z',
    testStart: '2026-09-06T00:00:00Z', testEnd: '2026-10-02T00:00:00Z', trainingPairs: 2000,
    validationHours: 336, coverage: 'training-season-only',
    pattern: { interceptFt: .3, tideLevelCoefficient: -.06, tideSlopeCoefficientHours: .1 },
    anomalyDecayHours: 48, transitionHours: 12,
    errorByLead: leads.map(lead => ({ leadHours: lead.leadHours, absoluteError90Ft: lead.historicalError90Ft })),
    maxHistoricalErrorFt: 1.6, validationLeads: leads,
    historicalEligible: false, weatherEligible: false, selectedFallback: 'historical-baseline',
  };
  input.outlook!.method = 'residual-response';
  input.outlook!.observationAt = now.toISOString();
  input.outlook!.forecastOriginAt = now.toISOString();
  input.outlook!.leadValidation = input.outlook!.leadValidation!.slice(0, 3);
  input.outlook!.points = points;
  input.outlook!.tail = {
    method: 'historical-pattern', startsAt: at(360).toISOString(), endsAt: at(serverDays * 1440).toISOString(),
    weatherSupportedUntil: null, summary,
    validation: { eligible: true, historicalEligible: false, weatherEligible: false, leads,
      evaluation: 'chronological issue-anchored reanalysis hindcast', limitations: ['Seasonal historical baseline; no issued-weather accuracy claim.'] },
  };
  input.weatherTotalPoints = points.map(point => ({ t: new Date(point.t), v: point.totalFt }));
  // Local tide differs by .2ft; physical source totals must remain unchanged.
  input.tidePoints = Array.from({ length: tideDays * 240 + 11 }, (_, i) => {
    const minutes = (i - 10) * 6;
    return { t: at(minutes), v: tideValue(minutes) + .2 };
  });
  input.weatherResidualPoints = points.filter(point => Date.parse(point.t) <= +at(tideDays * 1440))
    .map(point => ({ t: new Date(point.t), v: point.totalFt - interpolate(input.tidePoints, new Date(point.t))! }));
  input.steadyTotalPoints = input.tidePoints.filter(point => +point.t >= +now).map(point => ({ ...point, v: point.v + .7 }));
  return input;
}

describe('full NOAA horizon outlook selection', () => {
  it.each([16, 21, 31])('preserves native physical totals and uncertainty for a %i-day supplied tail', days => {
    const input = historicalFixture(days), result = selectWaterForecast(input);
    expect(result.method).toBe('learned');
    expect(result.tailMethod).toBe('historical-pattern');
    expect(result.extensionMethod).toBeUndefined();
    expect(result.confidence).toBe('limited');
    expect(result.horizonEnd).toEqual(at(days * 1440));
    expect(result.totalPoints).toEqual(input.weatherTotalPoints);
    expect(result.weatherSupportedUntil).toBeNull();
    expect(result.reason).toContain('historical baseline');
    expect(result.reason).toContain('not improved at every lead');
    result.totalPoints.forEach((point, i) => {
      expect(point.v).toBe(input.outlook!.points[i].totalFt);
      expect(result.lowerPoints![i].v).toBe(input.outlook!.points[i].lowerFt);
      expect(result.upperPoints![i].v).toBe(input.outlook!.points[i].upperFt);
      expect(point.v).toBeCloseTo(interpolate(input.tidePoints, point.t)! + result.residualPoints[i].v, 10);
    });
  });
  it('extends the available server tail through actual NOAA times using the shared historical projector', () => {
    const input = historicalFixture(16, 31), result = selectWaterForecast(input);
    const prefixLength = input.weatherTotalPoints.length;
    expect(result.horizonEnd).toEqual(at(31 * 1440));
    expect(result.totalPoints.slice(0, prefixLength)).toEqual(input.weatherTotalPoints);
    const expected = projectHistoricalResidual(input.outlook!.tail!.summary, input.tidePoints,
      input.tidePoints.filter(point => +point.t > +at(16 * 1440)).map(point => point.t),
      input.weatherResidualPoints);
    expect(result.residualPoints.slice(prefixLength)).toEqual(expected.points);
    result.totalPoints.forEach((point, i) => {
      expect(point.v).toBeCloseTo(interpolate(input.tidePoints, point.t)! + result.residualPoints[i].v, 10);
      expect(+result.lowerPoints![i].t).toBe(+point.t);
      expect(+result.upperPoints![i].t).toBe(+point.t);
      expect(result.lowerPoints![i].v).toBeLessThanOrEqual(point.v);
      expect(result.upperPoints![i].v).toBeGreaterThanOrEqual(point.v);
    });
    const width = (i: number) => result.upperPoints![i].v - result.totalPoints[i].v;
    expect(width(result.totalPoints.length - 1)).toBeGreaterThan(width(prefixLength));
    expect(width(prefixLength)).toBeGreaterThanOrEqual(width(prefixLength - 1));
  });
  it('clips to the loaded NOAA endpoint between native server samples without changing the server curve', () => {
    const input = historicalFixture(21, 16);
    input.tidePoints = input.tidePoints.slice(0, -1);
    input.weatherResidualPoints = input.weatherResidualPoints.filter(point => +point.t <= +input.tidePoints.at(-1)!.t);
    const result = selectWaterForecast(input), endpoint = input.tidePoints.at(-1)!.t;
    expect(result.method).toBe('learned');
    expect(result.horizonEnd).toEqual(endpoint);
    expect(result.totalPoints.at(-1)!.v).toBe(interpolate(input.weatherTotalPoints, endpoint));
    expect(result.totalPoints.at(-1)!.v).toBeCloseTo(input.tidePoints.at(-1)!.v + result.residualPoints.at(-1)!.v, 10);
    expect(result.lowerPoints).toHaveLength(result.totalPoints.length);
    expect(result.upperPoints).toHaveLength(result.totalPoints.length);
  });
  it('keeps extended uncertainty tied to the original issue as live time advances', () => {
    const input = historicalFixture(16, 31), first = selectWaterForecast(input);
    input.now = at(45);
    const later = selectWaterForecast(input);
    expect(later.totalPoints[0].t).toEqual(at(42));
    expect(later.horizonEnd).toEqual(first.horizonEnd);
    expect(later.totalPoints.at(-1)).toEqual(first.totalPoints.at(-1));
    expect(later.lowerPoints!.at(-1)).toEqual(first.lowerPoints!.at(-1));
    expect(later.upperPoints!.at(-1)).toEqual(first.upperPoints!.at(-1));
  });
  it('retains the actual weather-supported endpoint without extending weather claims into the historical tail', () => {
    const input = historicalFixture(16, 31), tail = input.outlook!.tail!;
    tail.summary.validationLeads.forEach(lead => {
      lead.weatherPairs = 150; lead.weatherMaeFt = .2; lead.weatherHistoricalMaeFt = .4; lead.weatherError90Ft = .5;
    });
    tail.summary.weatherEligible = true; tail.validation.weatherEligible = true;
    tail.weatherSupportedUntil = at(10 * 1440).toISOString();
    const result = selectWaterForecast(input);
    expect(result.tailMethod).toBe('historical-pattern');
    expect(result.weatherSupportedUntil).toEqual(at(10 * 1440));
    expect(result.horizonEnd).toEqual(at(31 * 1440));
  });
  it('ends an appended historical outlook at a true NOAA data gap', () => {
    const input = historicalFixture(16, 31);
    input.tidePoints = input.tidePoints.filter(point => +point.t <= +at(17 * 1440) || +point.t >= +at(18 * 1440));
    const result = selectWaterForecast(input);
    expect(result.method).toBe('learned');
    expect(result.horizonEnd).toEqual(at(17 * 1440));
    expect(result.totalPoints.every((point, i, points) => !i || +point.t - +points[i - 1].t <= 30 * 60_000)).toBe(true);
  });
  it.each(['forged-historical-skill', 'forged-weather-skill', 'missing-coverage', 'wrong-datum', 'future-training', 'invalid-coefficient', 'understated-errors'] as const)('rejects unsafe historical summary metadata for %s', failure => {
    const input = historicalFixture(16, 31), tail = input.outlook!.tail!;
    if (failure === 'forged-historical-skill') { tail.summary.historicalEligible = true; tail.validation.historicalEligible = true; }
    if (failure === 'forged-weather-skill') { tail.summary.weatherEligible = true; tail.validation.weatherEligible = true; }
    if (failure === 'missing-coverage') tail.summary.validationLeads.at(-1)!.testPairs = 99;
    if (failure === 'wrong-datum') { tail.summary.reference.datum = 'NAVD88'; tail.summary.tideReference.datum = 'NAVD88'; }
    if (failure === 'future-training') { tail.summary.trainedUntil = at(6).toISOString(); tail.summary.testEnd = at(6).toISOString(); }
    if (failure === 'invalid-coefficient') tail.summary.pattern.tideLevelCoefficient = NaN;
    if (failure === 'understated-errors') tail.summary.errorByLead.at(-1)!.absoluteError90Ft = .01;
    const result = selectWaterForecast(input);
    expect(result.tailMethod).toBeUndefined();
    expect(result.method).toBe('steady');
  });
  it('uses a covered historical baseline when future weather is absent without making a weather skill claim', () => {
    const input = historicalFixture(16, 31);
    expect(input.outlook!.tail!.summary.historicalEligible).toBe(false);
    expect(input.outlook!.tail!.summary.weatherEligible).toBe(false);
    const result = selectWaterForecast(input);
    expect(result.tailMethod).toBe('historical-pattern');
    expect(result.weatherSupportedUntil).toBeNull();
    expect(result.horizonEnd).toEqual(at(31 * 1440));
    expect(result.reason).not.toContain('point and peak errors passed');
  });
});

describe('primary water forecast selection', () => {
  it('selects the historical point-validated weather forecast by default with limited confidence', () => {
    const input = fixture();
    const result = selectWaterForecast(input);
    expect(result.method).toBe('weather');
    expect(result.confidence).toBe('limited');
    expect(result.totalPoints).toEqual(input.weatherTotalPoints);
    expect(result.horizonEnd).toEqual(at(18));
  });
  it('accepts a newly issued forecast between chart live ticks using the validation clock', () => {
    const input = fixture();
    input.now = at(-4);
    expect(selectWaterForecast(input).method).toBe('steady');

    input.validationNow = at(1);
    const result = selectWaterForecast(input);
    expect(result.method).toBe('weather');
    expect(result.totalPoints).toEqual(input.weatherTotalPoints);
    expect(result.residualPoints).toEqual(input.weatherResidualPoints);
  });
  it.each(['expiry', 'old-generation', 'future-generation', 'invalid-clock'] as const)('still rejects %s according to the validation clock', failure => {
    const input = fixture();
    input.validationNow = at(1);
    if (failure === 'expiry') input.validationNow = at(120);
    if (failure === 'old-generation') {
      input.outlook!.generatedAt = at(-120).toISOString();
      input.outlook!.observationAt = at(-130).toISOString();
      input.outlook!.forecastOriginAt = at(-130).toISOString();
    }
    if (failure === 'future-generation') input.outlook!.generatedAt = at(2).toISOString();
    if (failure === 'invalid-clock') input.validationNow = new Date('invalid');
    const result = selectWaterForecast(input);
    expect(result.method).toBe('steady');
    expect(result.reason).toContain('expired or its issue time is invalid');
  });
  it('retains physical totals and expresses the residual against the chart tide exactly once', () => {
    const input = fixture();
    const result = selectWaterForecast(input);
    result.totalPoints.forEach((point, i) => expect(point.v).toBeCloseTo(result.residualPoints[i].v + input.tidePoints[i].v));
    expect(result.totalPoints[0].v).toBeCloseTo(4.7);
    expect(result.residualPoints[0].v).toBeCloseTo(.5);
  });
  it('retains the preceding native forecast sample between updates so ongoing events cover now', () => {
    const input = fixture();
    input.now = at(9);
    const result = selectWaterForecast(input);
    expect(result.method).toBe('weather');
    expect(result.totalPoints).toEqual(input.weatherTotalPoints.slice(1));
    expect(result.totalPoints[0].t).toEqual(at(6));
    expect(result.totalPoints[0].v).toBe(input.outlook!.points[1].totalFt);
    expect(result.residualPoints[0]).toEqual(input.weatherResidualPoints[1]);
  });
  it('uses the chart clock for coverage without shifting physical forecast samples', () => {
    const input = fixture();
    input.now = at(9);
    input.validationNow = at(12);
    const result = selectWaterForecast(input);
    expect(result.method).toBe('weather');
    expect(result.totalPoints).toEqual(input.weatherTotalPoints.slice(1));
    expect(result.residualPoints).toEqual(input.weatherResidualPoints.slice(1));
  });
  it('does not use a stale preceding sample to bridge an unsupported forecast gap', () => {
    const input = fixture();
    input.now = at(3);
    input.weatherTotalPoints[0].t = at(-40);
    const result = selectWaterForecast(input);
    expect(result.totalPoints.map(point => +point.t)).not.toContain(+at(-40));
  });
  it('accepts older screened cached issues without exposing their legacy label', () => {
    const input = fixture();
    input.outlook!.status = 'experimental';
    expect(selectWaterForecast(input).method).toBe('weather');
  });
  it('requires explicit method and limited-confidence metadata for new available issues', () => {
    const input = fixture();
    input.outlook!.confidence = undefined;
    expect(selectWaterForecast(input).method).toBe('steady');
  });
  it('keeps a six-hour ceiling for a screened legacy short-range cached curve', () => {
    const input = fixture();
    input.outlook!.status = 'experimental';
    input.outlook!.method = 'residual-response';
    input.outlook!.leadValidation = input.outlook!.leadValidation!.slice(0, 3);
    input.outlook!.forecastOriginAt = at(-350).toISOString();
    input.outlook!.observationAt = at(-350).toISOString();
    const selection = selectWaterForecast(input);
    expect(selection.method).toBe('learned');
    expect(selection.horizonEnd).toEqual(at(6));
    input.outlook!.leadValidation![2].modelMaeFt = .4;
    expect(selectWaterForecast(input).method).toBe('steady');
  });
  it.each(['expiry', 'old-generation', 'future-generation', 'reference', 'manual'] as const)('uses the existing projection for %s', failure => {
    const input = fixture();
    if (failure === 'expiry') input.now = at(120);
    if (failure === 'old-generation') { input.outlook!.generatedAt = at(-121).toISOString(); input.outlook!.observationAt = at(-130).toISOString(); input.outlook!.forecastOriginAt = at(-130).toISOString(); }
    if (failure === 'future-generation') input.outlook!.generatedAt = at(1).toISOString();
    if (failure === 'reference') input.weatherCompatible = false;
    if (failure === 'manual') input.manualOverride = true;
    // Retain a future steady forecast even when testing an expired cached issue.
    input.steadyTotalPoints.push({ t: at(180), v: 4.5 });
    const result = selectWaterForecast(input);
    expect(result.method).toBe('steady');
    expect(result.totalPoints).toEqual(input.steadyTotalPoints);
  });
  it('limits legacy weather cached curves to 24 hours from the actual forecast origin', () => {
    const input = fixture();
    input.outlook!.status = 'experimental';
    input.outlook!.forecastOriginAt = at(-1430).toISOString();
    input.outlook!.observationAt = at(-1430).toISOString();
    const result = selectWaterForecast(input);
    expect(result.method).toBe('weather');
    expect(result.totalPoints.map(point => +point.t)).toEqual([+at(0), +at(6)]);
    expect(result.horizonEnd).toEqual(at(6));
  });
  it('withholds a new available issue that supplies an unsupported numerical tail', () => {
    const input = fixture();
    input.outlook!.forecastOriginAt = at(-1430).toISOString();
    input.outlook!.observationAt = at(-1430).toISOString();
    expect(selectWaterForecast(input).method).toBe('steady');
  });
  it('never appends a steady residual beyond the last supported weather point', () => {
    const input = fixture();
    input.steadyTotalPoints.push({ t: at(180), v: 6 });
    input.tidePoints.push({ t: at(180), v: 5 });
    const result = selectWaterForecast(input);
    expect(result.totalPoints.at(-1)!.t).toEqual(at(18));
    expect(result.residualPoints.at(-1)!.t).toEqual(at(18));
  });
  it('adopts an independently screened three-day extension and preserves every physical total', () => {
    const input = multiDayFixture();
    const result = selectWaterForecast(input);
    expect(result.method).toBe('learned');
    expect(result.extensionMethod).toBe('residual-reversion');
    expect(result.confidence).toBe('limited');
    expect(result.horizonEnd).toEqual(at(4320));
    expect(result.totalPoints).toEqual(input.weatherTotalPoints);
    result.totalPoints.forEach((point, i) => {
      expect(point.v).toBe(input.outlook!.points[i].totalFt);
      expect(point.v).toBeCloseTo(input.tidePoints[i].v + result.residualPoints[i].v, 10);
    });
    expect(result.residualPoints.at(-1)!.v).not.toBe(result.residualPoints[60].v);
  });
  it('accepts an explicitly evaluated baseline bridge without claiming improvement at its intermediate leads', () => {
    const input = baselineBridgeFixture();
    const result = selectWaterForecast(input);
    expect(result.method).toBe('learned');
    expect(result.extensionMethod).toBe('residual-reversion');
    expect(result.horizonEnd).toEqual(at(4320));
    expect(result.totalPoints).toEqual(input.weatherTotalPoints);
    expect(result.reason).toContain('explicit steady-residual bridge');
    expect(result.reason).not.toContain('Longer-range point and peak errors passed');
    expect(result.residualPoints[120].v).toBeCloseTo(input.outlook!.currentResidualFt! - .2);
    expect(result.residualPoints[240].v).toBeCloseTo(input.outlook!.currentResidualFt! - .2);
    expect(result.residualPoints[480].v).not.toBe(result.residualPoints[240].v);
    result.totalPoints.forEach((point, i) => expect(point.v).toBeCloseTo(input.tidePoints[i].v + result.residualPoints[i].v, 10));
  });
  it('accepts zero-error baseline evidence while still requiring skill at 48 and 72 hours', () => {
    const input = baselineBridgeFixture();
    input.outlook!.extension!.leadValidation.slice(0, 2).forEach(lead => {
      lead.modelMaeFt = 0;
      lead.persistenceMaeFt = 0;
      lead.absoluteError90Ft = 0;
    });
    expect(selectWaterForecast(input).extensionMethod).toBe('residual-reversion');
  });
  it.each(['missing-baseline-label', 'pretended-learned-bridge', 'insufficient-baseline-pairs', 'worse-48-hour-error', 'worse-72-hour-error', 'missing-long-error-bound'] as const)('retains the approved prefix for %s', failure => {
    const input = baselineBridgeFixture();
    const leads = input.outlook!.extension!.leadValidation;
    if (failure === 'missing-baseline-label') delete leads[0].method;
    if (failure === 'pretended-learned-bridge') leads[0].method = 'residual-reversion';
    if (failure === 'insufficient-baseline-pairs') leads[1].testPairs = 99;
    if (failure === 'worse-48-hour-error') leads[2].modelMaeFt = .29;
    if (failure === 'worse-72-hour-error') leads[3].modelMaeFt = .29;
    if (failure === 'missing-long-error-bound') leads[3].absoluteError90Ft = null;
    const result = selectWaterForecast(input);
    expect(result.method).toBe('learned');
    expect(result.extensionMethod).toBeUndefined();
    expect(result.horizonEnd).toEqual(at(360));
    expect(result.totalPoints).toEqual(input.weatherTotalPoints.slice(0, 61));
  });
  it.each(['unequal-baseline-error', 'worse-baseline-error', '48-hour-baseline', '72-hour-baseline'] as const)('withholds a mislabeled or unsupported baseline contract for %s', failure => {
    const input = baselineBridgeFixture();
    const leads = input.outlook!.extension!.leadValidation;
    if (failure === 'unequal-baseline-error') leads[0].modelMaeFt = .2;
    if (failure === 'worse-baseline-error') leads[0].modelMaeFt = .4;
    if (failure === '48-hour-baseline') { leads[2].method = 'steady-residual'; leads[2].modelMaeFt = leads[2].persistenceMaeFt; }
    if (failure === '72-hour-baseline') { leads[3].method = 'steady-residual'; leads[3].modelMaeFt = leads[3].persistenceMaeFt; }
    const result = selectWaterForecast(input);
    expect(result.method).toBe('steady');
    expect(result.extensionMethod).toBeUndefined();
  });
  it.each(['insufficient-pairs', 'worse-long-lead', 'worse-peak', 'insufficient-peaks'] as const)('retains the supported prefix when the extension has %s', failure => {
    const input = multiDayFixture();
    const extension = input.outlook!.extension!;
    if (failure === 'insufficient-pairs') extension.leadValidation[3].testPairs = 99;
    if (failure === 'worse-long-lead') extension.leadValidation[2].modelMaeFt = .29;
    if (failure === 'worse-peak') extension.peakMaeFt = .31;
    if (failure === 'insufficient-peaks') extension.peakWindows = 6;
    const result = selectWaterForecast(input);
    expect(result.method).toBe('learned');
    expect(result.extensionMethod).toBeUndefined();
    expect(result.horizonEnd).toEqual(at(360));
    expect(result.totalPoints).toEqual(input.weatherTotalPoints.slice(0, 61));
    expect(result.reason).toContain('longer predictions are withheld');
  });
  it('does not extend a cached issue beyond its supplied native endpoint', () => {
    const input = multiDayFixture();
    input.outlook!.points = input.outlook!.points.slice(0, 481);
    input.outlook!.extension!.endsAt = at(2880).toISOString();
    input.weatherTotalPoints = input.weatherTotalPoints.slice(0, 481);
    input.weatherResidualPoints = input.weatherResidualPoints.slice(0, 481);
    const result = selectWaterForecast(input);
    expect(result.horizonEnd).toEqual(at(2880));
    expect(result.totalPoints).toHaveLength(481);
  });
  it.each(['junction-after-prefix', 'missing-junction-sample', 'past-72-hours'] as const)('rejects malformed extension coverage for %s', failure => {
    const input = multiDayFixture();
    if (failure === 'junction-after-prefix') input.outlook!.extension!.startsAt = at(366).toISOString();
    if (failure === 'missing-junction-sample') input.outlook!.extension!.startsAt = at(359).toISOString();
    if (failure === 'past-72-hours') input.outlook!.extension!.endsAt = at(4326).toISOString();
    expect(selectWaterForecast(input).method).toBe('steady');
  });
  it('withholds a multi-day curve when its late physical totals do not align with the server', () => {
    const input = multiDayFixture();
    input.weatherTotalPoints[600].v += .1;
    expect(selectWaterForecast(input).method).toBe('steady');
  });
  it('does not bridge missing forecast hours in an otherwise screened extension', () => {
    const input = multiDayFixture();
    input.weatherTotalPoints = input.weatherTotalPoints.filter((_, i) => i < 400 || i > 410);
    expect(selectWaterForecast(input).method).toBe('steady');
  });
  it('still requires the short-range model screen before adopting any longer extension', () => {
    const input = multiDayFixture();
    input.outlook!.leadValidation![0].modelMaeFt = .4;
    expect(selectWaterForecast(input).method).toBe('steady');
  });
  it('uses astronomical tide when neither a weather forecast nor a steady projection is available', () => {
    const input = fixture();
    input.outlook = null;
    input.steadyTotalPoints = [];
    const result = selectWaterForecast(input);
    expect(result.method).toBe('tide');
    expect(result.confidence).toBe('unavailable');
    expect(result.totalPoints).toEqual(input.tidePoints);
    expect(result.residualPoints).toEqual([]);
  });
  it.each(['no-validation', 'worse-point-error', 'worse-peak-error', 'malformed-total', 'missing-residual', 'shifted-total', 'late-start', 'large-gap', 'single-point'] as const)('withholds the weather curve for %s', failure => {
    const input = fixture();
    if (failure === 'no-validation') input.outlook!.leadValidation = undefined;
    if (failure === 'worse-point-error') input.outlook!.leadValidation![2].modelMaeFt = .4;
    if (failure === 'worse-peak-error') { input.outlook!.validation!.model = { ...metric, peakMaeFt: .5 }; input.outlook!.validation!.persistence = { ...metric, peakMaeFt: .2 }; }
    if (failure === 'malformed-total') input.outlook!.points[1].totalFt = NaN;
    if (failure === 'missing-residual') input.weatherResidualPoints = [];
    if (failure === 'shifted-total') input.weatherTotalPoints[1].v += .5;
    if (failure === 'late-start') { input.weatherTotalPoints = input.weatherTotalPoints.slice(3); input.outlook!.points.push({ ...input.outlook!.points[3], t: at(24).toISOString() }); input.weatherTotalPoints.push({ t: at(24), v: 4.85 }); }
    if (failure === 'large-gap') {
      const last = input.outlook!.points.at(-1)!;
      input.outlook!.points.push({ ...last, t: at(60).toISOString() });
      input.weatherTotalPoints = [input.weatherTotalPoints[0], { t: at(60), v: last.totalFt }];
      input.weatherResidualPoints.push({ t: at(60), v: last.residualFt - .2 });
      input.tidePoints.push({ t: at(60), v: last.tideFt + .2 });
    }
    if (failure === 'single-point') input.weatherTotalPoints = input.weatherTotalPoints.slice(0, 1);
    expect(selectWaterForecast(input).method).toBe('steady');
  });
  it('does not generate water levels with an invalid current timestamp', () => {
    const result = selectWaterForecast({ ...fixture(), now: new Date('invalid') });
    expect(result.totalPoints).toEqual([]);
    expect(result.confidence).toBe('unavailable');
  });
});

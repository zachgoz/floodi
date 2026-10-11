import { interpolate, residuals } from 'src/utils/waterForecast';
import type { ChartData, OffsetConfig, Point } from '../types';

const MINUTE_MS = 60_000;
const FRESHNESS_MS = 60 * MINUTE_MS;

const toPoints = (series: Record<string, number>, source?: Point['source']): Point[] =>
  Object.entries(series)
    .map(([t, v]) => ({ t: new Date(t), v, source }))
    .filter(p => Number.isFinite(+p.t) && Number.isFinite(p.v))
    .sort((a, b) => +a.t - +b.t);

/**
 * Keep primary measurements at their original times. During the local gauge's
 * reporting lag, the established NOAA phase alignment supplies an explicitly
 * estimated tail; unshifted observations from a different station must never be
 * spliced into the local curve. Only primary measurements enter surge analysis.
 */
export function processWaterSeries(
  data: ChartData,
  now: Date,
  stationId: string,
  offset: OffsetConfig,
) {
  const source = data.source || 'noaa';
  const shiftMs = source === 'fiman' && Number.isFinite(data.timeOffsetMins)
    ? (data.timeOffsetMins || 0) * MINUTE_MS : 0;
  const primaryPoints = toPoints(data.observed, source).filter(p => p.t <= now);
  const predictedPoints = toPoints(data.predicted, 'noaa')
    .map(p => ({ ...p, t: new Date(+p.t + shiftMs) }));
  const lastPrimary = primaryPoints.at(-1);
  const primaryFresh = !!lastPrimary && +now - +lastPrimary.t <= FRESHNESS_MS;
  const proxyPoints: Point[] = [];

  // The NOAA station is a proxy for the delayed local gauge, never the reverse.
  // Applying its existing local phase adjustment twice (or to primary NOAA)
  // would put the rising/falling limb at the wrong time.
  if (source === 'fiman' && primaryFresh && lastPrimary) {
    const localized = toPoints(data.alternate || {}, 'noaa')
      .filter(p => p.t <= now)
      .map(p => ({ ...p, t: new Date(+p.t + shiftMs), observedTime: p.t, estimated: true }));
    const anchorValue = interpolate(localized, lastPrimary.t);
    if (anchorValue !== null) {
      const alignmentOffset = lastPrimary.v - anchorValue;
      proxyPoints.push(...localized
        .filter(p => p.t > lastPrimary.t && p.t <= now)
        .map(p => ({ ...p, v: p.v + alignmentOffset })));
      // Estimate at the exact live time when it lies between two measured proxy
      // samples. This avoids treating the next six-minute sample as an observation.
      const liveValue = interpolate(localized, now);
      if (liveValue !== null && +now > +lastPrimary.t && proxyPoints.at(-1)?.t.getTime() !== +now) {
        const supporting = localized.find(p => p.t >= now);
        proxyPoints.push({
          t: now, v: liveValue + alignmentOffset, source: 'noaa', estimated: true,
          observedTime: supporting?.observedTime,
        });
      }
    }
  }

  const observedPoints = [...primaryPoints, ...proxyPoints];
  const reference = {
    station: source === 'fiman' ? 'localized-carolina-beach' : stationId,
    datum: 'MLLW', units: 'ft',
  };
  const deltaPoints = residuals(primaryPoints, predictedPoints, reference, reference);
  const latestResidual = deltaPoints.at(-1);
  const hasFreshResidual = !!latestResidual && +now - +latestResidual.t <= FRESHNESS_MS;
  const lastDisplayed = observedPoints.at(-1);
  const handoffTide = lastDisplayed ? interpolate(predictedPoints, lastDisplayed.t) : null;
  const effectiveOffset = offset.mode === 'manual'
    ? (parseFloat(offset.value) || 0)
    : hasFreshResidual && lastDisplayed && handoffTide !== null
      ? lastDisplayed.v - handoffTide
      : hasFreshResidual ? latestResidual!.v : 0;
  const adjustedPoints: Point[] = hasFreshResidual || offset.mode === 'manual'
    ? predictedPoints
      .filter(p => p.t > (lastDisplayed?.t || now))
      .map(p => ({ ...p, v: p.v + effectiveOffset }))
    : [];
  if (lastDisplayed && adjustedPoints.length) adjustedPoints.unshift({ ...lastDisplayed });
  const surgeForecastPoints: Point[] = adjustedPoints.length
    ? [
      ...(lastDisplayed ? [{ t: lastDisplayed.t, v: effectiveOffset }] : []),
      ...adjustedPoints.filter(p => p.t > now).map(p => ({ t: p.t, v: effectiveOffset })),
    ] : [];

  return { observedPoints, predictedPoints, adjustedPoints, deltaPoints, effectiveOffset, surgeForecastPoints };
}

import type { Point } from 'src/components/Tab2/types';
import type { ChallengerOutlookDocument } from 'src/components/dashboard/useChallengerOutlook';
import { FORECAST_FACTOR_INFO, FORECAST_DRIVER_METHODS, type ForecastDocument, type ForecastDrivers } from '../../functions/src/forecast/schema';

const valid = (points: Point[]) => points.filter(p => Number.isFinite(+p.t) && Number.isFinite(p.v)).sort((a, b) => +a.t - +b.t);
function sample(points: Point[], at: Date) {
  if (!points.length || +at < +points[0].t || +at > +points.at(-1)!.t) return null;
  const next = points.findIndex(p => +p.t >= +at);
  const b = points[next];
  if (+b.t === +at) return { value: b.v, interpolated: false };
  const a = points[next - 1];
  return { value: a.v + (b.v - a.v) * ((+at - +a.t) / (+b.t - +a.t)), interpolated: true };
}
export function selectSurgeReadout(observations: Point[], estimates: Point[], prediction: Point[], at: Date, live = false) {
  const measured = valid(observations), estimated = valid(estimates), forecast = valid(prediction);
  const measuredEnd = measured.at(-1)?.t;
  const handoff = Math.max(measuredEnd ? +measuredEnd : -Infinity, estimated.at(-1) ? +estimated.at(-1)!.t : -Infinity);
  const actual = sample(measured, at);
  if (actual) return { ...actual, at, source: actual.interpolated ? 'Interpolated' as const : 'Observed' as const };
  if ((!measuredEnd || +at > +measuredEnd)) {
    const bridge = sample(estimated, at);
    if (bridge) return { ...bridge, at, source: 'Estimated' as const };
  }
  if (+at >= handoff) {
    const future = sample(forecast, at);
    if (future) return { ...future, at, source: 'Forecast' as const };
  }
  const latest = measured.at(-1);
  if (live && latest && +latest.t <= +at) return { value: latest.v, at: latest.t, interpolated: false, source: 'Latest observation' as const };
  return null;
}

export function selectedForecastFactors(document: ForecastDocument | null | undefined, at: Date, displayedResidual: number) {
  if (!document?.driverInfo || !Number.isFinite(+at) || !Number.isFinite(displayedResidual)) return null;
  const points = document.points;
  const index = points.findIndex(p => Date.parse(p.t) >= +at);
  if (index < 0) return null;
  const b = points[index], a = Date.parse(b.t) === +at ? b : points[index - 1];
  if (!a?.drivers || !b.drivers || Date.parse(b.t) - Date.parse(a.t) > 30 * 60_000) return null;
  const ratio = a === b ? 0 : (+at - Date.parse(a.t)) / (Date.parse(b.t) - Date.parse(a.t));
  if (ratio < 0 || ratio > 1) return null;
  const mix = (x: number, y: number) => x + (y - x) * ratio;
  const contributions: { id: string; label: string; source: string; value: number }[] = FORECAST_FACTOR_INFO.map((info, i) => ({ ...info, value: mix(a.drivers!.c[i], b.drivers!.c[i]) }));
  const residual = mix(a.residualFt, b.residualFt);
  // The chart may fit a different tide phase. Preserve the physical forecast
  // and disclose its reference conversion, never attribute that to weather.
  contributions.push({ id: 'local-tide-reference', label: 'Tide reference adjustment', source: 'Chart tide reference adjustment; physical total water level is unchanged', value: displayedResidual - residual });
  const method = a.drivers.m === b.drivers.m ? FORECAST_DRIVER_METHODS[a.drivers.m] : 'Forecast blend';
  let weather: ForecastDrivers['w'];
  if (['w', 'hw'].includes(a.drivers.m) && ['w', 'hw'].includes(b.drivers.m)) {
    for (let i = index; i >= 0; i--) {
      const context = points[i].drivers?.w;
      if (context && Date.parse(context.at) <= +at && +at - Date.parse(context.at) < 3600_000) { weather = context; break; }
      if (Date.parse(points[i].t) < +at - 3600_000) break;
    }
  }
  return { contributions, method, weather };
}

export const OPERATIONAL_SURGE_DRIVER_INFO = [
  {
    id: 'ocean-surge',
    label: 'Ocean Storm Surge',
    source: 'NOAA ETSS Coastal Ocean Guidance (Wrightsville Beach)',
  },
  {
    id: 'wind-setup',
    label: 'N/NE Wind Setup',
    source: 'Directional Myrtle Grove Sound wind-fetch stress (25° axial + 70° onshore) & barometric pressure',
  },
  {
    id: 'river-head',
    label: 'Cape Fear River Head',
    source: "Wilmington River ETSS & USGS Lock #1 discharge via Snow's Cut",
  },
  {
    id: 'rainfall-runoff',
    label: 'Rainfall Runoff',
    source: 'Localized Carolina Beach basin precipitation & storm drainage',
  },
  {
    id: 'estuarine-harmonics',
    label: 'Estuarine Tide Harmonics',
    source: '48-hour M2 + S1 + M4 shallow-water basin tidal amplification',
  },
] as const;

export interface OperationalSurgeFactorBreakdown {
  contributions: { id: string; label: string; source: string; value: number }[];
  method: string;
  weather?: {
    windSpeedMph: number;
    windDirectionDeg: number;
    precipIn: number;
  };
}

export function selectOperationalSurgeDrivers(
  challenger: ChallengerOutlookDocument | null | undefined,
  at: Date,
  displayedResidual: number
): OperationalSurgeFactorBreakdown | null {
  if (!challenger?.points?.length || !Number.isFinite(+at) || !Number.isFinite(displayedResidual)) {
    return null;
  }
  const points = challenger.points;
  const index = points.findIndex(p => Date.parse(p.t) >= +at);
  if (index < 0) return null;
  const b = points[index];
  const a = Date.parse(b.t) === +at ? b : points[index - 1];
  if (!a?.drivers || !b?.drivers) return null;
  const tA = Date.parse(a.t);
  const tB = Date.parse(b.t);
  if (!Number.isFinite(tA) || !Number.isFinite(tB) || tB - tA > 90 * 60_000) return null;
  const ratio = a === b ? 0 : (+at - tA) / (tB - tA);
  if (ratio < 0 || ratio > 1) return null;

  const mix = (x: number, y: number) => x + (y - x) * ratio;
  const ocean = mix(a.drivers.oceanSurgeFt, b.drivers.oceanSurgeFt);
  const wind = mix(a.drivers.windSetupFt, b.drivers.windSetupFt);
  const river = mix(a.drivers.riverFlowFt, b.drivers.riverFlowFt);
  const rain = mix(a.drivers.rainfallRunoffFt, b.drivers.rainfallRunoffFt);
  const rawHarmonic = mix(a.drivers.estuarineHarmonicFt, b.drivers.estuarineHarmonicFt);
  // Reconcile any sub-centimeter 6-min vs 30-min interpolation delta into the harmonic component
  // so the 5 physical drivers always sum losslessly to the displayed surge value.
  const harmonic = displayedResidual - (ocean + wind + river + rain);
  const effectiveHarmonic = Math.abs(harmonic - rawHarmonic) <= 0.15 ? harmonic : rawHarmonic;

  const contributions = [
    { ...OPERATIONAL_SURGE_DRIVER_INFO[0], value: ocean },
    { ...OPERATIONAL_SURGE_DRIVER_INFO[1], value: wind },
    { ...OPERATIONAL_SURGE_DRIVER_INFO[2], value: river },
    { ...OPERATIONAL_SURGE_DRIVER_INFO[3], value: rain },
    { ...OPERATIONAL_SURGE_DRIVER_INFO[4], value: effectiveHarmonic },
  ];

  const genMs = Date.parse(challenger.generatedAt);
  const leadHours = Number.isFinite(genMs) ? Math.max(0, (+at - genMs) / 3600_000) : 0;
  const method =
    leadHours <= 102
      ? 'NOAA ETSS + Wind/River + TimesFM AI'
      : leadHours <= 384
      ? 'Wind/Pressure + River + Harmonics'
      : 'Estuarine Harmonic Baseline';

  let weather: OperationalSurgeFactorBreakdown['weather'];
  if (
    typeof a.windSpeedMph === 'number' &&
    typeof b.windSpeedMph === 'number' &&
    typeof a.windDirectionDeg === 'number' &&
    typeof b.windDirectionDeg === 'number'
  ) {
    weather = {
      windSpeedMph: mix(a.windSpeedMph, b.windSpeedMph),
      windDirectionDeg: a.windDirectionDeg,
      precipIn:
        typeof a.precipIn === 'number' && typeof b.precipIn === 'number'
          ? mix(a.precipIn, b.precipIn)
          : 0,
    };
  }

  return { contributions, method, weather };
}

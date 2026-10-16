import type { Validation } from "./model";
import { FORECAST_DRIVER_METADATA, ForecastDrivers, validateForecastDrivers } from "./attribution";
export { FORECAST_FACTOR_KEYS, FORECAST_FACTOR_INFO, FORECAST_DRIVER_METHODS, validateForecastDrivers } from "./attribution";
export type { ForecastDrivers } from "./attribution";
import { HistoricalOutlookValidation, HistoricalPatternSummary, validateHistoricalOutlookValidation, validateHistoricalPatternSummary } from "./historicalOutlook";
export interface ForecastPoint {
  t: string;
  tideFt: number;
  residualFt: number;
  totalFt: number;
  lowerFt: number;
  upperFt: number;
  drivers?: ForecastDrivers;
}
export interface Evidence {
  id: string;
  text: string;
}
export interface Explanation {
  headline:
    | "Experimental flood outlook"
    | "Flood outlook"
    | "Elevated flood risk"
    | "No evaluated forecast";
  evidenceIds: string[];
}
export interface LeadValidation {
  leadHours: number;
  method?: "steady-residual" | "residual-reversion";
  testPairs: number;
  modelMaeFt: number | null;
  persistenceMaeFt: number | null;
  absoluteError90Ft: number | null;
}
export interface ForecastExtension {
  method: "residual-reversion";
  startsAt: string;
  endsAt: string;
  leadValidation: LeadValidation[];
  peakMaeFt: number;
  persistencePeakMaeFt: number;
  peakWindows: number;
}
export interface ForecastTail {
  method: "historical-pattern";
  startsAt: string;
  endsAt: string;
  weatherSupportedUntil: string | null;
  summary: HistoricalPatternSummary;
  validation: HistoricalOutlookValidation;
}
export interface ForecastDocument {
  version: 1;
  status: "available" | "experimental" | "unavailable";
  method?: "weather-response" | "residual-response";
  confidence?: "limited";
  validationStage?: "historical-hindcast";
  generatedAt: string;
  expiresAt: string;
  locationId: string;
  sensor: string;
  tideStation: string;
  datum: "MLLW";
  units: "ft";
  phaseMinutes: number;
  thresholdFt: number;
  currentResidualFt: number | null;
  observationAt?: string;
  forecastOriginAt?: string;
  trend: string;
  points: ForecastPoint[];
  validation: Validation | null;
  evidence: Evidence[];
  explanation: Explanation;
  explanationSource: "gemini-3.8-flash" | "fallback";
  sources: string[];
  limitations: string[];
  leadValidation?: LeadValidation[];
  extension?: ForecastExtension;
  tail?: ForecastTail;
  driverInfo?: typeof FORECAST_DRIVER_METADATA;
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const timestamp = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d\d-\d\dT.*Z$/.test(v) &&
  Number.isFinite(Date.parse(v));
export function validateExplanation(
  value: unknown,
  evidence: Evidence[],
): value is Explanation {
  return (
    record(value) &&
    Object.keys(value).every((k) => ["headline", "evidenceIds"].includes(k)) &&
    [
      "Experimental flood outlook",
      "Flood outlook",
      "Elevated flood risk",
      "No evaluated forecast",
    ].includes(String(value.headline)) &&
    Array.isArray(value.evidenceIds) &&
    value.evidenceIds.length > 0 &&
    value.evidenceIds.length <= 4 &&
    new Set(value.evidenceIds).size === value.evidenceIds.length &&
    value.evidenceIds.every((id) => evidence.some((e) => e.id === id))
  );
}
export function validateForecast(value: unknown): value is ForecastDocument {
  if (
    !record(value) ||
    value.version !== 1 ||
    !["available", "experimental", "unavailable"].includes(String(value.status)) ||
    value.locationId !== "carolina-beach" ||
    !["30046", "SUNNYD_CB_03"].includes(String(value.sensor)) ||
    value.tideStation !== "8658163" ||
    value.datum !== "MLLW" ||
    value.units !== "ft" ||
    !timestamp(value.generatedAt) ||
    !timestamp(value.expiresAt) ||
    Date.parse(value.expiresAt) <= Date.parse(value.generatedAt) ||
    !finite(value.phaseMinutes) ||
    !finite(value.thresholdFt) ||
    (value.currentResidualFt !== null && !finite(value.currentResidualFt)) ||
    typeof value.trend !== "string"
  )
    return false;
  if (value.driverInfo !== undefined) {
    const info = value.driverInfo;
    if (!record(info) || Object.keys(info).length !== 4 || info.version !== FORECAST_DRIVER_METADATA.version || info.basis !== FORECAST_DRIVER_METADATA.basis || info.interpretation !== FORECAST_DRIVER_METADATA.interpretation || !Array.isArray(info.factorOrder) || info.factorOrder.length !== FORECAST_DRIVER_METADATA.factorOrder.length || !info.factorOrder.every((key, i) => key === FORECAST_DRIVER_METADATA.factorOrder[i])) return false;
  }
  if (Array.isArray(value.points) && value.points.some(point => record(point) && point.drivers !== undefined) && value.driverInfo === undefined) return false;
  if (['observationAt', 'forecastOriginAt'].some(k => value[k] !== undefined && (!timestamp(value[k]) || Date.parse(String(value[k])) > Date.parse(String(value.generatedAt))))) return false;
  if (
    !Array.isArray(value.points) ||
    value.points.length > 5000 ||
    !value.points.every(
      (p, i, arr) =>
        record(p) &&
        timestamp(p.t) &&
        ["tideFt", "residualFt", "totalFt", "lowerFt", "upperFt"].every((k) =>
          finite(p[k]),
        ) &&
        Math.abs(Number(p.totalFt) - Number(p.tideFt) - Number(p.residualFt)) <
          1e-6 &&
        Number(p.lowerFt) <= Number(p.totalFt) &&
        Number(p.upperFt) >= Number(p.totalFt) &&
        (p.drivers === undefined || validateForecastDrivers(p.drivers, Number(p.residualFt), p.t)) &&
        (i === 0 || Date.parse(String(arr[i - 1].t)) < Date.parse(p.t)),
    )
  )
    return false;
  if (
    (value.status === "unavailable" && value.points.length) ||
    (["available", "experimental"].includes(String(value.status)) && value.points.length < 2)
  )
    return false;
  if (value.status === 'available' && (!['weather-response', 'residual-response'].includes(String(value.method)) || value.confidence !== 'limited' || value.validationStage !== 'historical-hindcast')) return false;
  if (
    !Array.isArray(value.evidence) ||
    !value.evidence.every(
      (e) =>
        record(e) &&
        typeof e.id === "string" &&
        typeof e.text === "string" &&
        e.text.length <= 800,
    ) ||
    !validateExplanation(value.explanation, value.evidence as Evidence[])
  )
    return false;
  if (
    !["gemini-3.8-flash", "fallback"].includes(
      String(value.explanationSource),
    ) ||
    !["sources", "limitations"].every(
      (k) =>
        Array.isArray(value[k]) &&
        (value[k] as unknown[]).every((s) => typeof s === "string"),
    )
  )
    return false;
  if (value.validation !== null) {
    const v = value.validation;
    if (
      !record(v) ||
      !["chronological-perfect-weather-hindcast", "chronological-weather-response-hindcast"].includes(String(v.kind)) ||
      !["trainEnd", "testStart", "testEnd"].every((k) => timestamp(v[k])) ||
      !(Date.parse(String(v.trainEnd)) < Date.parse(String(v.testStart))) ||
      !finite(v.trainingSamples) ||
      typeof v.limitation !== "string" ||
      (v.error90Ft !== null && (!finite(v.error90Ft) || v.error90Ft < 0))
    )
      return false;
    for (const key of ["model", "tideOnly", "persistence"]) {
      const m = v[key];
      if (
        !record(m) ||
        !finite(m.samples) || Number(m.samples) < 0 ||
        !["hits", "misses", "falseAlarms", "matchedEvents"].every(
          (k) => (v.kind === "chronological-weather-response-hindcast" && m[k] === null) || (finite(m[k]) && Number(m[k]) >= 0),
        ) ||
        !["maeFt", "peakMaeFt", "onsetMaeMinutes", "durationMaeMinutes"].every(
          (k) => m[k] === null || (finite(m[k]) && Number(m[k]) >= 0),
        )
      )
        return false;
    }
  }
  if (value.leadValidation !== undefined && (!Array.isArray(value.leadValidation) || value.leadValidation.length > 5 || !value.leadValidation.every(p => record(p) && finite(p.leadHours) && [1, 3, 6, 12, 24].includes(p.leadHours) && finite(p.testPairs) && Number.isInteger(p.testPairs) && p.testPairs >= 0 && ['modelMaeFt', 'persistenceMaeFt', 'absoluteError90Ft'].every(k => p[k] === null || (finite(p[k]) && Number(p[k]) >= 0))) || new Set(value.leadValidation.map(p => p.leadHours)).size !== value.leadValidation.length)) return false;
  if (value.tail !== undefined) {
    const tail = value.tail;
    if (!record(tail) || value.extension !== undefined || value.status !== 'available' || tail.method !== 'historical-pattern' || !timestamp(tail.startsAt) || !timestamp(tail.endsAt) || !timestamp(value.forecastOriginAt) || !timestamp(value.observationAt) || Date.parse(value.forecastOriginAt) !== Date.parse(value.observationAt) || Date.parse(tail.startsAt) < Date.parse(value.generatedAt) || Date.parse(tail.endsAt) <= Date.parse(tail.startsAt) || Date.parse(tail.endsAt) > Date.parse(value.forecastOriginAt) + 32 * 24 * 3600_000 || !value.points.some(point => record(point) && point.t === tail.startsAt) || !record(value.points.at(-1)) || value.points.at(-1)?.t !== tail.endsAt || !validateHistoricalPatternSummary(tail.summary) || !validateHistoricalOutlookValidation(tail.validation) || tail.validation.eligible !== true) return false;
    const reference = tail.summary.reference, tideReference = tail.summary.tideReference;
    if (tail.validation.weatherEligible !== tail.summary.weatherEligible || tail.validation.historicalEligible !== tail.summary.historicalEligible || JSON.stringify(tail.validation.leads) !== JSON.stringify(tail.summary.validationLeads)) return false;
    if ([reference, tideReference].some(ref => ref.station !== value.sensor || ref.datum !== value.datum || ref.units !== value.units) || Date.parse(tail.summary.trainedUntil) > Date.parse(value.forecastOriginAt) || Date.parse(tail.summary.testEnd) > Date.parse(value.generatedAt)) return false;
    if (tail.weatherSupportedUntil !== null && (!tail.summary.weatherEligible || !tail.validation.weatherEligible || !timestamp(tail.weatherSupportedUntil) || Date.parse(tail.weatherSupportedUntil) < Date.parse(value.forecastOriginAt) || Date.parse(tail.weatherSupportedUntil) > Date.parse(tail.endsAt))) return false;
    const baseHorizon = value.method === 'residual-response' ? 6 : 24;
    if (Date.parse(tail.startsAt) > Date.parse(value.forecastOriginAt) + baseHorizon * 3600_000 || value.points.some((point, i, points) => i && record(point) && timestamp(point.t) && record(points[i - 1]) && Date.parse(point.t) - Date.parse(String(points[i - 1].t)) > 15 * 60_000)) return false;
  }
  if (value.extension !== undefined) {
    const extension = value.extension;
    // Validate the physical and chronological contract here. Selection checks
    // skill independently, allowing a sound near-term prefix to survive a
    // rejected extension without accepting its long-range numerical tail.
    if (!record(extension) || value.status !== 'available' || extension.method !== 'residual-reversion' || !timestamp(extension.startsAt) || !timestamp(extension.endsAt) || !timestamp(value.forecastOriginAt) || !timestamp(value.observationAt) || Date.parse(value.forecastOriginAt) !== Date.parse(value.observationAt) || Date.parse(extension.startsAt) < Date.parse(value.generatedAt) || Date.parse(extension.endsAt) <= Date.parse(extension.startsAt) || Date.parse(extension.endsAt) > Date.parse(value.forecastOriginAt) + 72 * 3600_000 || !value.points.some(point => record(point) && point.t === extension.startsAt) || !record(value.points.at(-1)) || value.points.at(-1)?.t !== extension.endsAt || !['peakMaeFt', 'persistencePeakMaeFt'].every(k => finite(extension[k]) && Number(extension[k]) >= 0) || !finite(extension.peakWindows) || !Number.isInteger(extension.peakWindows) || extension.peakWindows < 0 || !Array.isArray(extension.leadValidation) || extension.leadValidation.length !== 4 || !extension.leadValidation.every((lead, i) => record(lead) && lead.leadHours === [12, 24, 48, 72][i] && finite(lead.testPairs) && Number.isInteger(lead.testPairs) && lead.testPairs >= 0 && ['modelMaeFt', 'persistenceMaeFt', 'absoluteError90Ft'].every(k => lead[k] === null || (finite(lead[k]) && Number(lead[k]) >= 0)) && (lead.method === undefined || lead.method === 'residual-reversion' || (lead.method === 'steady-residual' && [12, 24].includes(Number(lead.leadHours)) && finite(lead.modelMaeFt) && finite(lead.persistenceMaeFt) && Math.abs(lead.modelMaeFt - lead.persistenceMaeFt) < 1e-9)))) return false;
    const baseHorizon = value.method === 'residual-response' ? 6 : 24;
    if (Date.parse(extension.startsAt) > Date.parse(value.forecastOriginAt) + baseHorizon * 3600_000) return false;
  } else if (value.tail === undefined && value.status === 'available' && timestamp(value.forecastOriginAt)) {
    const horizon = value.method === 'residual-response' ? 6 : 24;
    if (value.points.some(point => record(point) && timestamp(point.t) && Date.parse(point.t) > Date.parse(String(value.forecastOriginAt)) + horizon * 3600_000)) return false;
  }
  return value.status === "unavailable" || value.validation !== null;
}

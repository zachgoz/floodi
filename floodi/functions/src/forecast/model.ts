import { floodWindows, interpolate, WaterPoint } from "./water";

export interface WeatherPoint {
  t: Date;
  windSpeed?: number;
  windDirection?: number;
  gust?: number;
  precip?: number;
  pressure?: number;
}
export const FEATURE_NAMES = [
  "previousResidual",
  "residualChange3h",
  ...[6, 12, 24, 48].flatMap((h) => [
    `northWind${h}h`,
    `eastWind${h}h`,
    `rain${h}h`,
  ]),
  "pressure",
  "pressureChange6h",
  "tide",
  "tideRange24h",
  "rainTideInteraction",
];
const HOUR = 3600_000;
const mean = (a: number[]) =>
  a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const valid = (v: number | undefined): v is number =>
  v !== undefined && Number.isFinite(v);
export function features(
  at: Date,
  anchor: WaterPoint,
  history: WaterPoint[],
  weather: WeatherPoint[],
  tide: WaterPoint[],
): number[] {
  const older = interpolate(
    history,
    new Date(+anchor.t - 3 * HOUR),
    90 * 60_000,
  );
  const out = [anchor.v, older === null ? NaN : (anchor.v - older) / 3];
  for (const hours of [6, 12, 24, 48]) {
    const rows = weather.filter(
      (w) => +w.t > +at - hours * HOUR && +w.t <= +at,
    );
    const winds = rows.filter(
      (w) => valid(w.windSpeed) && valid(w.windDirection),
    );
    const rain = rows.filter((w) => valid(w.precip));
    out.push(
      winds.length >= hours * 0.8
        ? mean(
            winds.map(
              (w) =>
                w.windSpeed! * Math.cos((w.windDirection! * Math.PI) / 180),
            ),
          )
        : NaN,
    );
    out.push(
      winds.length >= hours * 0.8
        ? mean(
            winds.map(
              (w) =>
                w.windSpeed! * Math.sin((w.windDirection! * Math.PI) / 180),
            ),
          )
        : NaN,
    );
    out.push(
      rain.length >= hours * 0.8
        ? rain.reduce((s, w) => s + w.precip!, 0)
        : NaN,
    );
  }
  const nearest = (ms: number) =>
    weather.find((w) => Math.abs(+w.t - ms) <= 30 * 60_000);
  const w = nearest(+at);
  const oldW = nearest(+at - 6 * HOUR);
  const tideValue = interpolate(tide, at);
  const dayTides = tide.filter((p) => +p.t >= +at - 24 * HOUR && +p.t <= +at);
  out.push(
    w?.pressure ?? NaN,
    valid(w?.pressure) && valid(oldW?.pressure)
      ? w!.pressure! - oldW!.pressure!
      : NaN,
    tideValue ?? NaN,
    dayTides.length >= 192
      ? Math.max(...dayTides.map((p) => p.v)) -
          Math.min(...dayTides.map((p) => p.v))
      : NaN,
    out[4] * (tideValue ?? NaN),
  );
  return out;
}
interface Row {
  t: Date;
  x: number[];
  y: number;
  tide: number;
  observed: number;
  anchor: WaterPoint;
}
export interface Ridge {
  columns: number[];
  means: number[];
  scales: number[];
  coefficients: number[];
  intercept: number;
}
export function fitRidge(rows: { x: number[]; y: number }[]): Ridge | null {
  if (rows.length < 120) return null;
  const columns = FEATURE_NAMES.map((_, i) => i).filter(
    (i) => rows.filter((r) => valid(r.x[i])).length / rows.length >= 0.9,
  );
  if (!columns.includes(0)) return null;
  const complete = rows.filter((r) => columns.every((i) => valid(r.x[i])));
  if (complete.length < 120) return null;
  const means = columns.map((i) => mean(complete.map((r) => r.x[i])));
  const scales = columns.map(
    (i, j) =>
      Math.sqrt(mean(complete.map((r) => (r.x[i] - means[j]) ** 2))) || 1,
  );
  const intercept = mean(complete.map((r) => r.y));
  const p = columns.length;
  const matrix = Array.from(
    { length: p },
    () => Array(p + 1).fill(0) as number[],
  );
  for (const row of complete) {
    const x = columns.map((i, j) => (row.x[i] - means[j]) / scales[j]);
    for (let i = 0; i < p; i++) {
      for (let j = 0; j < p; j++) matrix[i][j] += x[i] * x[j];
      matrix[i][p] += x[i] * (row.y - intercept);
    }
  }
  for (let i = 0; i < p; i++) matrix[i][i] += 20;
  for (let i = 0; i < p; i++) {
    let pivot = i;
    for (let j = i + 1; j < p; j++)
      if (Math.abs(matrix[j][i]) > Math.abs(matrix[pivot][i])) pivot = j;
    [matrix[i], matrix[pivot]] = [matrix[pivot], matrix[i]];
    const d = matrix[i][i];
    if (Math.abs(d) < 1e-9) return null;
    for (let j = i; j <= p; j++) matrix[i][j] /= d;
    for (let k = 0; k < p; k++)
      if (k !== i) {
        const f = matrix[k][i];
        for (let j = i; j <= p; j++) matrix[k][j] -= f * matrix[i][j];
      }
  }
  return {
    columns,
    means,
    scales,
    coefficients: matrix.map((r) => r[p]),
    intercept,
  };
}
export function predict(model: Ridge, x: number[]) {
  if (!model.columns.every((i) => valid(x[i]))) return null;
  return (
    model.intercept +
    model.columns.reduce(
      (s, i, j) =>
        s + (model.coefficients[j] * (x[i] - model.means[j])) / model.scales[j],
      0,
    )
  );
}
function hourly(points: WaterPoint[]) {
  if (!points.length) return [];
  const out: WaterPoint[] = [];
  for (
    let t = Math.ceil(+points[0].t / HOUR) * HOUR;
    t <= +points.at(-1)!.t;
    t += HOUR
  ) {
    const v = interpolate(points, new Date(t));
    if (v !== null) out.push({ t: new Date(t), v });
  }
  return out;
}
export interface Metrics {
  samples: number;
  maeFt: number | null;
  peakMaeFt: number | null;
  onsetMaeMinutes: number | null;
  durationMaeMinutes: number | null;
  hits: number | null;
  misses: number | null;
  falseAlarms: number | null;
  matchedEvents: number | null;
}
export interface Validation {
  kind: "chronological-perfect-weather-hindcast" | "chronological-weather-response-hindcast";
  trainEnd: string;
  testStart: string;
  testEnd: string;
  trainingSamples: number;
  model: Metrics;
  tideOnly: Metrics;
  persistence: Metrics;
  error90Ft: number | null;
  limitation: string;
}
function evaluate(rows: Row[], values: number[], threshold: number): Metrics {
  const errors = values.map((v, i) => Math.abs(v - rows[i].observed));
  const onset: number[] = [];
  const duration: number[] = [];
  const peak: number[] = [];
  let hits = 0,
    misses = 0,
    falseAlarms = 0,
    matchedEvents = 0;
  const issues = new Map<number, { row: Row; value: number }[]>();
  rows.forEach((row, i) => {
    const key = +row.anchor.t;
    if (!issues.has(key)) issues.set(key, []);
    issues.get(key)!.push({ row, value: values[i] });
  });
  for (const issue of issues.values()) {
    const block = issue.map((p) => p.row);
    const pred = issue.map((p) => p.value);
    if (block.length !== 24 || +block.at(-1)!.t - +block[0].t !== 23 * HOUR)
      continue;
    peak.push(
      Math.abs(Math.max(...pred) - Math.max(...block.map((r) => r.observed))),
    );
    const actual = floodWindows(
      block.map((r) => ({ t: r.t, v: r.observed })),
      threshold,
      90 * 60_000,
    );
    const estimated = floodWindows(
      block.map((r, j) => ({ t: r.t, v: pred[j] })),
      threshold,
      90 * 60_000,
    );
    const used = new Set<number>();
    for (const event of actual) {
      const j = estimated.findIndex(
        (e, k) =>
          !used.has(k) &&
          +(e.endTime || block.at(-1)!.t) >= +event.startTime &&
          +(event.endTime || block.at(-1)!.t) >= +e.startTime,
      );
      if (j < 0) {
        misses++;
        continue;
      }
      hits++;
      used.add(j);
      const e = estimated[j];
      if (
        event.endTime &&
        e.endTime &&
        !event.startClipped &&
        !e.startClipped
      ) {
        matchedEvents++;
        onset.push(Math.abs(+event.startTime - +e.startTime) / 60_000);
        duration.push(
          Math.abs(
            +event.endTime - +event.startTime - (+e.endTime - +e.startTime),
          ) / 60_000,
        );
      }
    }
    falseAlarms += estimated.length - used.size;
  }
  return {
    samples: rows.length,
    maeFt: errors.length ? mean(errors) : null,
    peakMaeFt: peak.length ? mean(peak) : null,
    onsetMaeMinutes: onset.length ? mean(onset) : null,
    durationMaeMinutes: duration.length ? mean(duration) : null,
    hits,
    misses,
    falseAlarms,
    matchedEvents,
  };
}
export function trainAndValidate(
  history: WaterPoint[],
  tide: WaterPoint[],
  weather: WeatherPoint[],
  threshold: number,
) {
  const h = hourly(history);
  const rows: Row[] = [];
  // Daily issue times, fixed 24-hour forecast: no observed residual from the forecast period is a feature.
  for (const anchor of h.filter((p) => p.t.getUTCHours() === 0)) {
    for (let lead = 1; lead <= 24; lead++) {
      const t = new Date(+anchor.t + lead * HOUR);
      const y = interpolate(h, t, 90 * 60_000);
      const tv = interpolate(tide, t);
      if (y === null || tv === null) continue;
      rows.push({
        t,
        x: features(t, anchor, h, weather, tide),
        y,
        tide: tv,
        observed: y + tv,
        anchor,
      });
    }
  }
  if (rows.length < 30 * 24) return null;
  const split = Math.floor((rows.length * 0.7) / 24) * 24;
  const train = rows.slice(0, split);
  const test = rows.slice(split);
  const model = fitRidge(train);
  if (!model) return null;
  const pairs = test.flatMap((r) => {
    const v = predict(model, r.x);
    return v === null ? [] : [{ r, v: r.tide + v }];
  });
  const held = pairs.map((p) => p.r);
  const values = pairs.map((p) => p.v);
  const errors = values
    .map((v, i) => Math.abs(v - held[i].observed))
    .sort((a, b) => a - b);
  const validation: Validation = {
    kind: "chronological-perfect-weather-hindcast",
    trainEnd: train.at(-1)!.t.toISOString(),
    testStart: test[0].t.toISOString(),
    testEnd: test.at(-1)!.t.toISOString(),
    trainingSamples: train.length,
    model: evaluate(held, values, threshold),
    tideOnly: evaluate(
      held,
      held.map((r) => r.tide),
      threshold,
    ),
    persistence: evaluate(
      held,
      held.map((r) => r.tide + r.anchor.v),
      threshold,
    ),
    error90Ft: errors.length
      ? errors[Math.floor((errors.length - 1) * 0.9)]
      : null,
    limitation:
      "Realized weather used in holdout; weather forecast error is excluded. Hourly events are approximate; midnight-clipped events excluded from timing metrics. Prospective issued-weather validation and local datum/phase calibration required.",
  };
  return { model: fitRidge(rows) || model, validation, historyHourly: h };
}
export function windAssociations(
  history: WaterPoint[],
  weather: WeatherPoint[],
) {
  const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return names.map((direction, index) => {
    const pairs = weather
      .filter(
        (w) =>
          valid(w.windDirection) &&
          Math.round(w.windDirection! / 45) % 8 === index,
      )
      .flatMap((w) => {
        const v = interpolate(history, w.t);
        return v === null ? [] : [v];
      });
    return {
      direction,
      hours: pairs.length,
      meanResidualFt: pairs.length >= 24 ? mean(pairs) : null,
      support:
        "Descriptive association only; serial correlation, season and tide can confound it.",
    };
  });
}

/** Exploratory associations, never a causal or significance claim. */
export function historicalRelationships(
  history: WaterPoint[],
  weather: WeatherPoint[],
) {
  const result: {
    factor: string;
    lagHours: number;
    pairs: number;
    correlation: number | null;
  }[] = [];
  const pearson = (pairs: number[][]) => {
    if (pairs.length < 72) return null;
    const mx = mean(pairs.map((p) => p[0]));
    const my = mean(pairs.map((p) => p[1]));
    const denom = Math.sqrt(
      pairs.reduce((s, p) => s + (p[0] - mx) ** 2, 0) *
        pairs.reduce((s, p) => s + (p[1] - my) ** 2, 0),
    );
    return denom > 0
      ? pairs.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / denom
      : null;
  };
  for (const lagHours of [0, 6, 12, 24, 48]) {
    for (const factor of ["northWind", "eastWind", "rain", "pressure"]) {
      const pairs = weather.flatMap((w) => {
        const residual = interpolate(history, new Date(+w.t + lagHours * HOUR));
        let value: number | undefined;
        if (factor === "rain") value = w.precip;
        else if (factor === "pressure") value = w.pressure;
        else if (valid(w.windSpeed) && valid(w.windDirection))
          value =
            w.windSpeed! *
            (factor === "northWind"
              ? Math.cos((w.windDirection! * Math.PI) / 180)
              : Math.sin((w.windDirection! * Math.PI) / 180));
        return residual !== null && valid(value) ? [[value, residual]] : [];
      });
      result.push({
        factor,
        lagHours,
        pairs: pairs.length,
        correlation: pearson(pairs),
      });
    }
  }
  return result;
}
/** Comparable historical conditions, restricted to training-period weather and tide features. */
export function analogousConditions(
  model: Ridge,
  target: number[],
  history: WaterPoint[],
  tide: WaterPoint[],
  weather: WeatherPoint[],
  before: Date,
) {
  const columns = model.columns.filter((i) => i >= 2 && valid(target[i]));
  if (columns.length < 4) return [];
  const candidates = weather
    .filter((w) => w.t < before && w.t.getUTCHours() === 12)
    .flatMap((w) => {
      const r = interpolate(history, w.t);
      if (r === null) return [];
      const x = features(w.t, { t: w.t, v: r }, history, weather, tide);
      if (!columns.every((i) => valid(x[i]))) return [];
      const distance = Math.sqrt(
        columns.reduce(
          (sum, i) =>
            sum +
            ((x[i] - target[i]) / model.scales[model.columns.indexOf(i)]) ** 2,
          0,
        ) / columns.length,
      );
      const tv = interpolate(tide, w.t);
      return tv === null
        ? []
        : [
            {
              time: w.t.toISOString(),
              distance,
              residualFt: r,
              totalFt: tv + r,
            },
          ];
    });
  return candidates.sort((a, b) => a.distance - b.distance).slice(0, 3);
}

import { describe, it, expect } from "vitest";
import {
  fitRidge,
  predict,
  trainAndValidate,
  features,
  WeatherPoint,
} from "../../../functions/src/forecast/model";
import {
  validateForecast,
  validateExplanation,
} from "../../../functions/src/forecast/schema";
import { buildForecast } from "../../../functions/src/forecast/pipeline";
const now = new Date("2026-10-10T00:00:00Z");
describe("interpretable forecast and schema", () => {
  it("learns an interpretable relationship without requiring incomplete features", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({
      x: [i / 20, NaN],
      y: 1 + i / 10,
    }));
    const model = fitRidge(rows)!;
    expect(model.columns).toEqual([0]);
    expect(predict(model, [5, NaN])).toBeCloseTo(11, 0);
    expect(predict(model, [NaN])).toBeNull();
  });
  it("refuses insufficient historical training data", () =>
    expect(fitRidge([{ x: [1], y: 2 }])).toBeNull());
  it("produces honest unavailable results and rejects incompatible or malformed forecasts", () => {
    const d = buildForecast([], [], [], [], [], now);
    expect(d.status).toBe("unavailable");
    expect(d.points).toEqual([]);
    expect(validateForecast(d)).toBe(true);
    expect(validateForecast({ ...d, datum: "NAVD88" })).toBe(false);
    expect(validateForecast({ ...d, generatedAt: "not-a-date" })).toBe(false);
    expect(validateForecast({ ...d, status: "experimental" })).toBe(false);
    expect(validateForecast({ ...d, currentResidualFt: NaN })).toBe(false);
    expect(
      validateForecast({
        ...d,
        explanation: {
          headline: "No evaluated forecast",
          evidenceIds: ["invented"],
        },
      }),
    ).toBe(false);
  });
  it("rejects invented Gemini claims and measurements outside the allowed schema", () => {
    const evidence = [{ id: "known", text: "Measured source evidence" }];
    expect(
      validateExplanation(
        { headline: "Experimental flood outlook", evidenceIds: ["known"] },
        evidence,
      ),
    ).toBe(true);
    expect(
      validateExplanation(
        { headline: "Experimental flood outlook", evidenceIds: ["invented"] },
        evidence,
      ),
    ).toBe(false);
    expect(
      validateExplanation(
        {
          headline: "Experimental flood outlook",
          evidenceIds: ["known"],
          peak: 9,
        },
        evidence,
      ),
    ).toBe(false);
  });
  it("backtests chronological unseen periods and reports all requested metrics", () => {
    const history = [];
    const tide = [];
    const weather: WeatherPoint[] = [];
    for (let i = 0; i <= 50 * 240; i++) {
      const t = new Date(+now - 50 * 24 * 3600_000 + i * 6 * 60_000);
      const phase = (i * 6) / 60;
      const tv = 3 + 3 * Math.sin((phase * Math.PI) / 6.2);
      tide.push({ t, v: tv });
      history.push({ t, v: 0.5 + 0.2 * Math.sin(phase / 100) });
      if (i % 10 === 0)
        weather.push({
          t,
          windSpeed: 10 + Math.sin(phase / 10),
          windDirection: 45,
          precip: 0,
          pressure: 1012 + Math.cos(phase / 30),
        });
    }
    const result = trainAndValidate(history, tide, weather, 5.6)!;
    expect(result).not.toBeNull();
    expect(Date.parse(result.validation.trainEnd)).toBeLessThan(
      Date.parse(result.validation.testStart),
    );
    expect(result.validation.model.samples).toBeGreaterThan(200);
    expect(result.validation.model.peakMaeFt).not.toBeNull();
    expect(result.validation.tideOnly.maeFt).toBeGreaterThan(
      result.validation.model.maeFt!,
    );
    expect(result.validation.model.onsetMaeMinutes).not.toBeNull();
    expect(result.validation.kind).toContain("perfect-weather");
    const f = features(
      new Date(+now + 24 * 3600_000),
      history.at(-1)!,
      history,
      [],
      tide,
    );
    expect(f.some(Number.isNaN)).toBe(true);
  }, 20000);
});

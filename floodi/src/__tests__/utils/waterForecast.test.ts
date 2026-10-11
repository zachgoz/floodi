import { describe, it, expect } from "vitest";
import {
  residuals,
  interpolate,
  floodWindows,
  hasUpcomingFlooding,
  inundation,
  liveViewport,
  surgeTrend,
  eventDate,
  eventWindow,
} from "src/utils/waterForecast";
import { localSensorLevels, regionalGaugeLevels } from "../../../functions/src/forecast/sensor";
const base = Date.parse("2026-10-10T10:00:00Z");
const point = (minutes: number, v: number) => ({
  t: new Date(base + minutes * 60_000),
  v,
});
const ref = { station: "local", datum: "MLLW", units: "ft" };
describe("aligned water forecasts", () => {
  it('clears flood risk when the crossing ended between the previous forecast sample and now', () => {
    const points = [point(0, 6), point(6, 4), point(12, 3)];
    expect(hasUpcomingFlooding(points, 5, point(2, 0).t)).toBe(true);
    expect(hasUpcomingFlooding(points, 5, point(3, 0).t)).toBe(false);
    expect(hasUpcomingFlooding(points, 5, point(4, 0).t)).toBe(false);
  });
  it('retains risk for a later distinct flood window and handles absent bounds', () => {
    expect(hasUpcomingFlooding([point(0, 6), point(6, 4), point(12, 6)], 5, point(8, 0).t)).toBe(true);
    expect(hasUpcomingFlooding([], 5, point(8, 0).t)).toBe(false);
  });
  const regional = { id: 'FIMAN (observed)', units: 'ft', www: { description: '<a href="https://fiman.nc.gov/?id=30046">Gauge</a>', uom_ts_suffix: 'NAVD88' }, observations: { times: ['2026-10-10T10:00:00Z'], values: ['1.25'], quality_levels: ['0'] } };
  it('uses verified gauge 30046 provenance and the configured datum conversion', () => {
    expect(regionalGaugeLevels([regional], 2.75)).toEqual({ '2026-10-10T10:00:00.000Z': 4 });
  });
  it('rejects another embedded FIMAN gauge even when its series has the same name', () => {
    expect(regionalGaugeLevels([{ ...regional, www: { ...regional.www, description: 'https://fiman.nc.gov/?id=30047' } }], 2.75)).toEqual({});
  });
  it('withholds regional readings when physical gauge provenance is missing', () => {
    expect(regionalGaugeLevels([{ ...regional, www: { uom_ts_suffix: 'NAVD88' } }], 2.75)).toEqual({});
  });
  it("interpolates residuals with their positive and negative signs", () =>
    expect(
      residuals(
        [point(3, 2), point(9, 0)],
        [point(0, 0), point(6, 2), point(12, 2)],
        ref,
        ref,
      ).map((p) => p.v),
    ).toEqual([1, -2]));
  it("preserves original observation timestamps", () =>
    expect(
      residuals([point(3, 2)], [point(0, 0), point(6, 2)], ref, ref)[0].t,
    ).toEqual(point(3, 0).t));
  it.each(["station", "datum", "units"] as const)(
    "rejects mismatched %s",
    (key) =>
      expect(
        residuals([point(0, 2)], [point(0, 1)], ref, {
          ...ref,
          [key]: "other",
        }),
      ).toEqual([]),
  );
  it("does not extrapolate or bridge missing predictions", () => {
    expect(interpolate([point(0, 1), point(60, 2)], point(30, 0).t)).toBeNull();
    expect(interpolate([point(0, 1)], point(6, 0).t)).toBeNull();
  });
  it("finds exact start/end crossings and sampled peak", () => {
    const [e] = floodWindows(
      [point(0, 4), point(6, 6), point(12, 7), point(18, 4)],
      5,
    );
    expect(e.startTime).toEqual(point(3, 0).t);
    expect(e.endTime).toEqual(point(16, 0).t);
    expect(e.peakValue).toBe(7);
    expect(e.peakTime).toEqual(point(12, 0).t);
  });
  it("supports separate events and excludes equality-only periods", () => {
    expect(floodWindows([point(0, 5), point(6, 5)], 5)).toEqual([]);
    expect(
      floodWindows(
        [point(0, 4), point(6, 6), point(12, 4), point(18, 6), point(24, 4)],
        5,
      ),
    ).toHaveLength(2);
  });
  it("marks unknown endings and data gaps without inventing durations", () => {
    const e = floodWindows([point(0, 6), point(6, 7), point(90, 4)], 5);
    expect(e[0].endTime).toBeNull();
    expect(e[0].lastSampleTime).toEqual(point(6, 0).t);
    expect(e[0].startClipped).toBe(true);
  });
  it("sorts and deduplicates timestamps", () =>
    expect(
      floodWindows([point(12, 4), point(6, 7), point(0, 4), point(6, 7)], 5),
    ).toHaveLength(1));
  it("does not claim threshold exceedance is street inundation", () => {
    const depth = inundation(6, 5.6, "MLLW");
    expect(depth.label).toBe("Water Above Flood Threshold");
    expect(depth.inches).toBeCloseTo(4.8);
  });
  it("uses only validated street elevations in the same datum", () => {
    const c = {
      elevationFt: 5,
      datum: "MLLW",
      validated: true,
      street: "Oystershell Lane",
      source: "survey",
    };
    expect(inundation(6, 5.6, "MLLW", c)).toEqual({
      label: "Max Street Inundation",
      inches: 12,
    });
    expect(inundation(6, 5.6, "NAVD88", c).label).toBe(
      "Water Above Flood Threshold",
    );
    expect(inundation(4, 5.6, "MLLW", c).inches).toBe(0);
  });
  it("recenters live without changing a six-hour viewport", () => {
    const d = liveViewport(point(-120, 0).t, point(240, 0).t, point(500, 0).t);
    expect(+d.end - +d.start).toBe(6 * 3600_000);
    expect(+d.start).toBe(+point(380, 0).t);
  });
  it("detects trends and suppresses stale current residuals", () => {
    expect(
      surgeTrend(
        [point(0, 0), point(60, 0.2), point(120, 0.4)],
        point(120, 0).t,
      ).trend,
    ).toBe("Increasing");
    expect(
      surgeTrend(
        [point(0, 0.4), point(60, 0.2), point(120, 0)],
        point(120, 0).t,
      ).trend,
    ).toBe("Decreasing");
    expect(
      surgeTrend(
        [point(0, 0.4), point(60, 0.4), point(120, 0.4)],
        point(120, 0).t,
      ).trend,
    ).toBe("Stable");
    expect(surgeTrend([point(0, 1)], point(121, 0).t).value).toBeNull();
  });
  it("formats weekdays, midnight crossing and daylight saving time in New York", () => {
    expect(eventDate(new Date("2026-10-10T12:00Z"))).toBe("Saturday, Oct 10");
    expect(
      eventWindow(new Date("2026-10-11T03:30Z"), new Date("2026-10-11T05:30Z")),
    ).toContain("Sunday, Oct 11");
    expect(
      eventWindow(new Date("2026-11-01T05:30Z"), new Date("2026-11-01T07:30Z")),
    ).toBe("1:30 AM – 2:30 AM");
    expect(eventWindow(point(0, 0).t, null)).toContain("End unavailable");
  });
  it("selects local sensor metadata, excludes embedded NOAA/FIMAN references and converts metres", () => {
    const rows = [
      {
        id: "FIMAN (observed)",
        units: "ft",
        www: { use_timestamp: false, uom_ts_suffix: " NAVD88" },
        observations: { times: ["2026-10-10T10:00:00"], values: ["99"] },
      },
      {
        id: "Water level",
        units: "m",
        www: {
          use_timestamp: true,
          uom_ts_suffix: " NAVD88",
          stacked_master: null,
        },
        observations: {
          times: ["2026-10-10T10:00:00Z", "2026-10-10T10:06:00"],
          values: ["1", "1"],
          quality_levels: ["0", "1"],
        },
      },
    ];
    const out = localSensorLevels(rows, 2.75);
    expect(Object.keys(out)).toHaveLength(1);
    expect(out["2026-10-10T10:00:00.000Z"]).toBeCloseTo(6.03084);
  });
  it("fails closed for unknown datum or missing source metadata", () =>
    expect(
      localSensorLevels(
        [
          {
            id: "Water level",
            units: "m",
            observations: { times: ["2026-10-10T10:00Z"], values: ["1"] },
          },
        ],
        2.75,
      ),
    ).toEqual({}));
});

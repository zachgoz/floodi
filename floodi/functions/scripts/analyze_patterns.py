#!/usr/bin/env python3
"""Read-only, standard-library diagnostics for a provenance-bearing surge archive.

These are descriptive associations, not a calibrated weather forecast. Tide
decomposition is deliberately separate from the visible observed residual.
No observation is removed, repaired, or silently replaced.
"""
import argparse
import bisect
import datetime
import json
import math
from pathlib import Path
import statistics


def epoch_hours(timestamp):
    return datetime.datetime.fromisoformat(timestamp.replace("Z", "+00:00")).timestamp() / 3600


def iso_time(hours):
    return datetime.datetime.fromtimestamp(hours * 3600, datetime.timezone.utc).isoformat()


def series(rows):
    pairs = sorted((epoch_hours(p["t"]), p["v"]) for p in rows)
    return [p[0] for p in pairs], [p[1] for p in pairs]


def interpolate(points, hours, max_gap_hours=0.25):
    times, values = points
    index = bisect.bisect_left(times, hours)
    if index < len(times) and times[index] == hours:
        return values[index]
    if index == 0 or index == len(times) or times[index] - times[index - 1] > max_gap_hours:
        return None
    left, right = times[index - 1:index + 1]
    return values[index - 1] + (values[index] - values[index - 1]) * (hours - left) / (right - left)


def correlation(xs, ys):
    if len(xs) < 3:
        return None
    mean_x, mean_y = statistics.mean(xs), statistics.mean(ys)
    var_x = sum((x - mean_x) ** 2 for x in xs)
    var_y = sum((y - mean_y) ** 2 for y in ys)
    if not var_x or not var_y:
        return None
    return sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys)) / math.sqrt(var_x * var_y)


def fit_linear(rows, values):
    columns = len(rows[0])
    matrix = [[sum(row[i] * row[j] for row in rows) for j in range(columns)] +
              [sum(row[i] * value for row, value in zip(rows, values))] for i in range(columns)]
    for i in range(columns):
        pivot = max(range(i, columns), key=lambda j: abs(matrix[j][i]))
        matrix[i], matrix[pivot] = matrix[pivot], matrix[i]
        divisor = matrix[i][i]
        if abs(divisor) < 1e-12:
            return None
        matrix[i] = [value / divisor for value in matrix[i]]
        for j in range(columns):
            if j != i:
                factor = matrix[j][i]
                matrix[j] = [value - factor * other for value, other in zip(matrix[j], matrix[i])]
    return [row[-1] for row in matrix]


def predict(coefficients, row):
    return sum(coefficient * value for coefficient, value in zip(coefficients, row))


def describe(values):
    ordered = sorted(values)
    return {"samples": len(values), "mean": statistics.mean(values), "standardDeviation": statistics.pstdev(values),
            "minimum": ordered[0], "p05": ordered[int(len(values) * 0.05)], "median": statistics.median(values),
            "p95": ordered[int(len(values) * 0.95)], "maximum": ordered[-1]}


def spike_diagnostics(observed):
    """Flag reversals >0.5ft from neighboring interpolation; retain every value."""
    candidates = []
    for index in range(1, len(observed[0]) - 1):
        left, at, right = observed[0][index - 1:index + 2]
        if right - left > 0.5:
            continue
        a, value, b = observed[1][index - 1:index + 2]
        expected = a + (b - a) * (at - left) / (right - left)
        if abs(value - expected) > 0.5 and (value - a) * (b - value) < 0:
            candidates.append({"time": iso_time(at), "observedFt": value, "leftTime": iso_time(left), "leftFt": a,
                               "rightTime": iso_time(right), "rightFt": b, "deviationFromNeighborInterpolationFt": value - expected})
    return {"criterion": "Reversal exceeding 0.5 ft from adjacent interpolation with neighbors within 30 minutes. Diagnostic only; values retained.",
            "candidateCount": len(candidates), "largestCandidates": sorted(candidates, key=lambda p: abs(p["deviationFromNeighborInterpolationFt"]), reverse=True)[:20]}


def analyze_archive(data):
    history, tide = series(data["history"]), series(data["tide"])
    if len(history[0]) < 120:
        raise ValueError("At least 120 residual samples are required for these diagnostics")
    rows = []
    for at, residual in zip(*history):
        values = [interpolate(tide, at + delta) for delta in (0, -0.1, 0.1)]
        if None not in values:
            tide_ft, before, after = values
            rows.append((at, residual, tide_ft, (after - before) / 0.2, residual + tide_ft))
    if len(rows) < 120:
        raise ValueError("Insufficient aligned tide/residual samples")
    features = [[1, p[2], p[3]] for p in rows]
    residual_values = [p[1] for p in rows]
    coefficients = fit_linear(features, residual_values)
    if coefficients is None:
        raise ValueError("Singular tide decomposition")
    remainder = [p[1] - predict(coefficients, row) for p, row in zip(rows, features)]
    split_at = rows[0][0] + (rows[-1][0] - rows[0][0]) * 0.7
    train, test = [p for p in rows if p[0] < split_at], [p for p in rows if p[0] >= split_at]
    train_coefficients = fit_linear([[1, p[2], p[3]] for p in train], [p[1] for p in train])
    lag_relationships = []
    for lag in (0.5, 1, 3, 6, 6.2, 12, 12.4, 12.5, 24, 24.8, 25, 48):
        pairs = [(value, interpolate(history, at - lag, 0.5)) for at, value in zip(history[0][::5], history[1][::5])]
        pairs = [(a, b) for a, b in pairs if b is not None]
        lag_relationships.append({"lagHours": lag, "pairs": len(pairs), "correlation": correlation([p[0] for p in pairs], [p[1] for p in pairs])})
    spectral = []
    sampled = rows[::5]
    for tenths in range(80, 321):
        period = tenths / 10
        phase_features = [[1, math.sin(2 * math.pi * (p[0] - sampled[0][0]) / period),
                           math.cos(2 * math.pi * (p[0] - sampled[0][0]) / period)] for p in sampled]
        fitted = fit_linear(phase_features, [p[1] for p in sampled])
        if fitted is None:
            continue
        errors = [p[1] - predict(fitted, row) for p, row in zip(sampled, phase_features)]
        spectral.append({"periodHours": period, "amplitudeFt": math.hypot(*fitted[1:]),
                         "explainedVariance": 1 - statistics.pvariance(errors) / statistics.pvariance([p[1] for p in sampled])})
    return {"metadata": data.get("metadata", {}), "sampleStart": iso_time(rows[0][0]), "sampleEnd": iso_time(rows[-1][0]),
            "residualFt": describe(residual_values), "tideFt": describe([p[2] for p in rows]), "reconstructedObservedFt": describe([p[4] for p in rows]),
            "residualTideCorrelation": correlation(residual_values, [p[2] for p in rows]),
            "residualTideSlopeCorrelation": correlation(residual_values, [p[3] for p in rows]),
            "allHistoryTideDecomposition": {"coefficientsInterceptTideSlope": coefficients, "explainedVariance": 1 - statistics.pvariance(remainder) / statistics.pvariance(residual_values), "remainderFt": describe(remainder),
                                           "use": "All-history descriptive decomposition; no operational calibration and no out-of-sample claim."},
            "chronologicalTideOnlyDiagnostic": {"trainEnd": iso_time(train[-1][0]), "testStart": iso_time(test[0][0]), "trainSamples": len(train), "testSamples": len(test), "coefficients": train_coefficients,
                                                "heldOutResidualRemainderMaeFt": statistics.mean(abs(p[1] - predict(train_coefficients, [1, p[2], p[3]])) for p in test),
                                                "heldOutUnadjustedResidualMaeFt": statistics.mean(abs(p[1]) for p in test)},
            "autocorrelation": lag_relationships, "dominantPeriods": sorted(spectral, key=lambda p: p["explainedVariance"], reverse=True)[:5],
            "isolatedSpikeDiagnostics": spike_diagnostics(series(data["observed"])) if data.get("observed") else {"available": False, "reason": "Archive does not contain original observed values."}}


def weather_relationships(data, diagnostics):
    history, tide = series(data["history"]), series(data["tide"])
    required = ("windSpeed", "windDirection", "pressure", "precip")
    weather = {epoch_hours(w["t"]): w for w in data["weather"]
               if all(isinstance(w.get(key), (int, float)) and math.isfinite(w[key]) for key in required)}
    coefficients = diagnostics["allHistoryTideDecomposition"]["coefficientsInterceptTideSlope"]
    residuals, remainder = {}, {}
    for at in weather:
        values = [interpolate(history, at, 0.5), interpolate(tide, at), interpolate(tide, at - 0.1), interpolate(tide, at + 0.1)]
        if None not in values:
            residual, tide_ft, before, after = values
            residuals[at] = residual
            remainder[at] = residual - predict(coefficients, [1, tide_ft, (after - before) / 0.2])
    if len(remainder) < 120:
        return {"hourlyPairs": len(remainder), "maximumResidualInterpolationGapMinutes": 30,
                "available": False, "reason": "Fewer than 120 complete aligned weather/residual hours; no associations invented."}
    factors = {"northWind": lambda w: w["windSpeed"] * math.cos(math.radians(w["windDirection"])),
               "eastWind": lambda w: w["windSpeed"] * math.sin(math.radians(w["windDirection"])),
               "northWindStressProxy": lambda w: w["windSpeed"] ** 2 * math.cos(math.radians(w["windDirection"])),
               "eastWindStressProxy": lambda w: w["windSpeed"] ** 2 * math.sin(math.radians(w["windDirection"])),
               "pressure": lambda w: w["pressure"], "rain": lambda w: w["precip"]}
    associations = []
    for name, factor in factors.items():
        for hours in (1, 6, 12, 24, 48):
            for lag in (0, 3, 6, 12, 24, 48):
                pairs = []
                for at, value in remainder.items():
                    recent = [weather[t] for t in (at - lag - j for j in range(hours)) if t in weather]
                    if len(recent) == hours and all(all(w.get(key) is not None for key in ("windSpeed", "windDirection", "pressure", "precip")) for w in recent):
                        pairs.append((value, statistics.mean(factor(w) for w in recent)))
                associations.append({"factor": name, "windowHours": hours, "lagHours": lag, "pairs": len(pairs), "correlation": correlation([p[0] for p in pairs], [p[1] for p in pairs])})
    detrended = []
    for name, factor in factors.items():
        pairs = [(at, value, factor(weather[at])) for at, value in remainder.items()]
        features = [[1, p[0] - pairs[0][0]] for p in pairs]
        residual_fit, factor_fit = fit_linear(features, [p[1] for p in pairs]), fit_linear(features, [p[2] for p in pairs])
        changes = [(value - remainder[at - 24], factor(weather[at]) - factor(weather[at - 24])) for at, value in remainder.items() if at - 24 in remainder and at - 24 in weather]
        detrended.append({"factor": name, "timeDetrendedCorrelation": correlation([p[1] - predict(residual_fit, row) for p, row in zip(pairs, features)], [p[2] - predict(factor_fit, row) for p, row in zip(pairs, features)]),
                          "change24hCorrelation": correlation([p[0] for p in changes], [p[1] for p in changes]), "change24hPairs": len(changes)})
    directions, bins = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"], {}
    for at, value in remainder.items():
        wind = weather[at]
        # Half-open, centered 45 degree bins, matching the TypeScript model.
        direction = directions[int((wind["windDirection"] + 22.5) // 45) % 8]
        bins.setdefault(direction, []).append((residuals[at], value, wind["windSpeed"]))
    means = [{"direction": direction, "hours": len(values), "rawMeanResidualFt": statistics.mean(p[0] for p in values), "tideCorrectedMeanFt": statistics.mean(p[1] for p in values), "windMeanMph": statistics.mean(p[2] for p in values)} for direction, values in bins.items()]
    return {"hourlyPairs": len(remainder), "maximumResidualInterpolationGapMinutes": 30, "associations": associations,
            "strongestExploratoryAssociations": sorted((p for p in associations if p["correlation"] is not None), key=lambda p: abs(p["correlation"]), reverse=True)[:15],
            "timeAndChangeDiagnostics": detrended, "windDirectionMeans": means}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--comparison-archive", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    data = json.loads(args.archive.read_text())
    diagnostics = analyze_archive(data)
    report = {"version": 1, "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "archive": args.archive.name,
              "diagnostics": diagnostics, "weather": weather_relationships(data, diagnostics),
              "limitations": ["All weather relationships are descriptive. Serially dependent samples are not independent significance tests.",
                              "Searching many windows and lags can overfit. Highest correlation is not a causal response delay.",
                              "The archive covers one summer/early-autumn period; seasonal baseline and offshore processes can confound associations.",
                              "Weather is gridded reanalysis, excluding issued weather forecast error and local rain-gauge uncertainty.",
                              "Tide phase and vertical conversion remain the archive's assumptions; this script does not modify them.",
                              "All-history tide correction is diagnostic only. It is not a calibrated station tide prediction.",
                              "Potential isolated spikes are retained and listed; their measurement quality requires provider review."]}
    if args.comparison_archive:
        comparison = json.loads(args.comparison_archive.read_text())
        report["comparisonArchive"] = args.comparison_archive.name
        report["comparisonDiagnostics"] = analyze_archive(comparison)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"output": str(args.output), "sensor": data.get("metadata", {}).get("sensor"),
                      "samples": diagnostics["residualFt"]["samples"], "weatherPairs": report["weather"]["hourlyPairs"],
                      "spikeCandidates": diagnostics["isolatedSpikeDiagnostics"].get("candidateCount")}, indent=2))


if __name__ == "__main__":
    main()

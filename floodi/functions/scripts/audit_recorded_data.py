#!/usr/bin/env python3
"""Audit local public Firestore exports against verified gauge archives.

No network, credentials, cloud writes, silent unit conversions or gap filling.
Usage: python3 functions/scripts/audit_recorded_data.py <recorded-directory>
       --regional-archives <archive.json> [<archive.json> ...] [--output report.json]
"""
import argparse
import bisect
import collections
import datetime as dt
import json
import math
from pathlib import Path
import statistics


def epoch(value):
    try:
        parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.timestamp() if parsed.tzinfo else None
    except (ValueError, TypeError, AttributeError):
        return None


def iso(value):
    return dt.datetime.fromtimestamp(value, dt.timezone.utc).isoformat().replace('+00:00', 'Z')


def numeric(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def quantile(values, probability):
    if not values:
        return None
    values = sorted(values)
    location = (len(values) - 1) * probability
    lower = math.floor(location)
    return values[lower] + (values[math.ceil(location)] - values[lower]) * (location - lower)


def number_summary(values):
    valid = [value for value in values if numeric(value)]
    return {'numeric': len(valid), 'missingOrInvalid': len(values) - len(valid),
            'min': min(valid) if valid else None, 'median': statistics.median(valid) if valid else None,
            'max': max(valid) if valid else None, 'p05': quantile(valid, .05), 'p95': quantile(valid, .95)}


def time_summary(times):
    return {'count': len(times), 'first': iso(min(times)) if times else None,
            'last': iso(max(times)) if times else None}


def gap_summary(times):
    gaps = [(after - before) / 60 for before, after in zip(sorted(times), sorted(times)[1:])]
    return {**number_summary(gaps), 'units': 'minutes',
            'over30Minutes': sum(gap > 30 for gap in gaps),
            'over30Minutes10Seconds': sum(gap > 30 + 1 / 6 for gap in gaps),
            'over30Minutes15Seconds': sum(gap > 30.25 for gap in gaps),
            'over31Minutes': sum(gap > 31 for gap in gaps),
            'nominal30MinuteJitterIntervals': sum(30 < gap <= 30.25 for gap in gaps),
            'mostCommonRoundedMinutes': [dict(minutes=minutes, count=count) for minutes, count in collections.Counter(round(gap, 1) for gap in gaps).most_common(12)]}


def interpolation(series, times, at, max_gap):
    index = bisect.bisect_left(times, at)
    if index < len(times) and times[index] == at:
        return series[at]
    if index == 0 or index == len(times):
        return None
    before, after = times[index - 1], times[index]
    if after - before > max_gap:
        return None
    return series[before] + (series[after] - series[before]) * (at - before) / (after - before)


def correlation(pairs):
    if len(pairs) < 3:
        return {'pairs': len(pairs), 'pearsonR': None}
    average_x, average_y = statistics.mean(x for x, _ in pairs), statistics.mean(y for _, y in pairs)
    numerator = sum((x - average_x) * (y - average_y) for x, y in pairs)
    denominator = math.sqrt(sum((x - average_x) ** 2 for x, _ in pairs) * sum((y - average_y) ** 2 for _, y in pairs))
    return {'pairs': len(pairs), 'pearsonR': numerator / denominator if denominator else None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('recorded_directory', type=Path)
    parser.add_argument('--regional-archives', type=Path, nargs='+', required=True)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--emit-hindcast', type=Path, help='Write a separate, honestly labelled recorded hourly-ETL snapshot hindcast input')
    parser.add_argument('--validation-report', type=Path, help='Attach numerical results with recorded-snapshot provenance, correcting the generic evaluator weather label')
    args = parser.parse_args()
    maps = {'fiman': {}, 'noaa': {}, 'tide': {}, 'observationWeather': {}, 'predictionWeather': {}}
    invalid = collections.Counter()
    conflicts = []
    months = []
    metadata = []
    measured_retrieval = {}

    for collection in ['observations', 'predictions']:
        for path in sorted((args.recorded_directory / collection).glob('*.json')):
            document = json.loads(path.read_text())
            if not document.get('exists'):
                months.append({'collection': collection, 'month': path.stem, 'exists': False})
                continue
            if document.get('project') != 'floodcastwebapp' or document.get('location') != 'carolina-beach':
                raise ValueError('Recorded export refers to a different project or location')
            fields = document.get('fields', {})
            retrieved = epoch(document.get('retrievedAt'))
            updated = epoch(fields.get('lastUpdated'))
            rows = [('fiman', 'fiman'), ('noaa', 'noaa'), ('weather', 'observationWeather')] if collection == 'observations' else [('data', 'tide'), ('weather', 'predictionWeather')]
            summary = {'collection': collection, 'month': path.stem, 'exists': True, 'lastUpdated': fields.get('lastUpdated'), 'retrievedAt': document.get('retrievedAt'), 'maps': {}}
            for source, destination in rows:
                entries = fields.get(source, {})
                times = []
                for key, value in entries.items():
                    time = epoch(key)
                    if time is None or (destination not in ['observationWeather', 'predictionWeather'] and not numeric(value)):
                        invalid[destination] += 1
                        continue
                    if time in maps[destination] and maps[destination][time] != value:
                        conflicts.append({'series': destination, 'time': iso(time), 'month': path.stem})
                    maps[destination][time] = value
                    times.append(time)
                    if destination == 'fiman':
                        measured_retrieval[time] = retrieved
                    if destination == 'observationWeather':
                        metadata.append({'t': time, 'month': path.stem, 'retrieved': retrieved, 'updated': updated, 'weather': value})
                summary['maps'][source] = {**time_summary(times), 'records': len(entries),
                                          'duplicateUtcTimes': len(times) - len(set(times)),
                                          'afterBucketLastUpdated': sum(updated is not None and time > updated for time in times),
                                          'afterRetrievalTime': sum(retrieved is not None and time > retrieved for time in times)}
            months.append(summary)

    verified = {}
    verified_sources = []
    verified_tide = {}
    for path in args.regional_archives:
        archive = json.loads(path.read_text())
        reference = archive.get('metadata', {})
        if reference.get('sensor') != '30046' or reference.get('datum') != 'MLLW' or reference.get('units') != 'ft':
            raise ValueError('Reference archive must identify physical gauge 30046, feet MLLW')
        points = archive.get('observed', [])
        if not points:
            raise ValueError('Reference archive must contain measured observed levels, not residuals alone')
        for point in points:
            time = epoch(point.get('t'))
            value = point.get('v')
            if time is None or not numeric(value):
                continue
            if time in verified and abs(verified[time] - value) > 1e-8:
                raise ValueError('Verified source archives conflict at a shared timestamp')
            verified[time] = value
        for point in archive.get('tide', []):
            time, value = epoch(point.get('t')), point.get('v')
            if time is not None and numeric(value):
                if time in verified_tide and abs(verified_tide[time] - value) > 1e-8:
                    raise ValueError('Verified source tide archives conflict at a shared timestamp')
                verified_tide[time] = value
        verified_sources.append({'path': str(path), 'sensor': reference['sensor'], 'observed': len(points), 'retrievedAt': reference.get('retrievedAt')})
    measured = maps['fiman']
    overlap = sorted(set(measured) & set(verified))
    differences = [abs(measured[time] - verified[time]) for time in overlap]
    new_times = sorted(set(measured) - set(verified))
    same = sum(difference <= 1e-8 for difference in differences)
    identity = {**time_summary(measured), 'units': 'ft MLLW inferred from exact agreement with verified source archives',
                'referenceSources': verified_sources, 'verifiedReferenceCount': len(verified),
                'overlappingTimestamps': len(overlap), 'exactValueMatches': same,
                'exactMatchPercentOfOverlap': 100 * same / len(overlap) if overlap else None,
                'maximumAbsoluteDifferenceFt': max(differences) if differences else None,
                'additionalRecordedPoints': time_summary(new_times),
                'verifiedPointsAbsentFromRecordedBuckets': len(set(verified) - set(measured)),
                'gapDistribution': gap_summary(measured)}

    weather = maps['observationWeather']
    cohorts = {}
    for name, rows in [('stationStyle', [row for row in metadata if 'icon' in row['weather'] or 'description' in row['weather']]),
                       ('hourlyUnannotated', [row for row in metadata if 'icon' not in row['weather'] and 'description' not in row['weather']])]:
        values = [row['weather'] for row in rows]
        cohorts[name] = {**time_summary([row['t'] for row in rows]),
                         'fields': dict(collections.Counter(key for value in values for key in value)),
                         'wholeUtcHourRows': sum(row['t'] % 3600 == 0 for row in rows),
                         'afterRetrievalTime': sum(row['retrieved'] is not None and row['t'] > row['retrieved'] for row in rows),
                         'pressureGreaterThan2000': sum(numeric(value.get('pressure')) and value['pressure'] > 2000 for value in values),
                         'metrics': {key: number_summary([value.get(key) for value in values]) for key in ['windSpeed', 'windDirection', 'pressure', 'precip', 'temp']}}

    # A diagnostic subset, not an approved normalization: whole-hour rows lacking
    # NWS descriptors resemble the existing Open-Meteo ETL output. Preserve their
    # recorded numbers; exclude future rows and unknown/mixed pressure cohorts.
    hourly = {row['t']: row['weather'] for row in metadata
              if 'icon' not in row['weather'] and 'description' not in row['weather']
              and row['t'] % 3600 == 0 and row['retrieved'] is not None and row['t'] <= row['retrieved']
              and all(numeric(row['weather'].get(key)) for key in ['windSpeed', 'windDirection', 'pressure', 'precip'])
              and 0 <= row['weather']['windSpeed'] <= 200 and 0 <= row['weather']['windDirection'] <= 360
              and 800 <= row['weather']['pressure'] <= 1200 and row['weather']['precip'] >= 0}
    unit_fingerprint = {key: {
        'cohortRows': len(hourly),
        'matchingExistingEtlQuantization': sum(abs(value[key] / factor * 10 - round(value[key] / factor * 10)) < 1e-6 for value in hourly.values()),
        'existingEtlConversion': f'Recorded value = source one-decimal value multiplied by {factor}',
        'interpretedUnit': unit,
    } for key, factor, unit in [('windSpeed', .621371, 'mph from km/h'), ('precip', .0393701, 'inches from mm')]}
    tide = maps['tide']
    measured_times, tide_times = sorted(measured), sorted(tide)
    residual = {}
    for time in hourly:
        observed = interpolation(measured, measured_times, time, 31 * 60)
        astronomical = interpolation(tide, tide_times, time - 3600, 12 * 60)
        if observed is not None and astronomical is not None:
            residual[time] = observed - astronomical
    associations = []
    for axis, component in [('northFrom', math.cos), ('eastFrom', math.sin)]:
        for hours in [1, 6, 12, 24, 48]:
            pairs = []
            for time, anomaly in residual.items():
                rows = [hourly.get(time - hour * 3600) for hour in range(hours)]
                if not all(rows):
                    continue
                wind = statistics.mean(row['windSpeed'] * component(math.radians(row['windDirection'])) for row in rows)
                pairs.append((wind, anomaly))
            associations.append({'windComponent': axis, 'precedingHours': hours, **correlation(pairs)})
    direction_pairs = collections.defaultdict(list)
    for time, anomaly in residual.items():
        label = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][int((hourly[time]['windDirection'] + 22.5) % 360 / 45)]
        direction_pairs[label].append(anomaly)
    directions = [{'directionFrom': key, 'pairs': len(value), 'meanResidualFt': statistics.mean(value), 'medianResidualFt': statistics.median(value)} for key, value in direction_pairs.items()]

    report = {
        'version': 1, 'generatedAt': dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00', 'Z'),
        'project': 'floodcastwebapp', 'location': 'carolina-beach', 'monthlyBuckets': months,
        'invalidEntries': dict(invalid), 'canonicalUtcConflicts': conflicts,
        'recordedGaugeIdentity': identity,
        'recordedWeather': {**time_summary(weather), 'cohorts': cohorts,
                            'minuteHistogram': dict(sorted(collections.Counter(dt.datetime.fromtimestamp(time, dt.timezone.utc).minute for time in weather).items())),
                            'gapDistribution': gap_summary(weather),
                            'futureObservationWeatherRows': sum(row['retrieved'] is not None and row['t'] > row['retrieved'] for row in metadata)},
        'recordedHourlyWeatherUnitFingerprint': unit_fingerprint,
        'diagnosticRecordedWeatherAssociations': {
            'cohort': 'Whole-UTC-hour rows without icon/description; resembles existing gridded ETL, not independently source-verified',
            'eligibleWeatherRows': len(hourly), 'gaugeResidualPairs': len(residual),
            'reference': 'Recorded FIMAN observed minus recorded NOAA 8658163 tide shifted forward 60 minutes; preserves existing 2.75 ft datum conversion verified through archive agreement',
            'maximumGaugeInterpolationGapMinutes': 31, 'maximumTideInterpolationGapMinutes': 12,
            'windAssociations': associations, 'windDirectionMeans': directions,
            'limitation': 'Exploratory snapshot relationships; serial dependence, seasonality, mixed forecast/reanalysis provenance, local tide calibration and sensor spikes prevent causal or significance claims. No pressure/rain unit conversion is performed.'},
        'limitations': [
            'Exact overlap identifies the recorded FIMAN curve as gauge 30046; additional nonoverlapping points inherit bucket provenance but cannot be independently verified by these archives.',
            f"{identity['gapDistribution']['nominal30MinuteJitterIntervals']} nominal half-hour intervals exceed 30:00 by no more than 15 seconds. A strict 30-minute interpolation ceiling discards normal timestamp jitter; 31 minutes accepts these and still rejects real gaps.",
            'Legacy recorded weather lacks per-field source and units. Station-style pressure includes apparent Pa values and hourly-unannotated pressure resembles hPa; no automatic conversion is justified by magnitude alone.',
            'Station-style rainfall is mostly null and numeric values lack documented preserved units. Missing rain must remain missing, never zero.',
            'Future valid times in observations must be excluded. Dates later than bucket lastUpdated demonstrate that bucket timestamps cannot prove measured-weather provenance or issue availability.',
            'Monthly predicted weather stores a final target-time snapshot, without original issuedAt or immutable forecast versions. This archive cannot prove historical issued-weather skill.',
            'A separate recorded-weather snapshot hindcast is feasible using an explicitly documented coherent hourly cohort, but should not be represented as locally measured meteorology or issue-time replay.',
            'Future numerical inputs must persist issue-weather snapshots, data availability timestamps, reference metadata and model version before prospective forecast evaluation.',
        ],
    }
    if args.emit_hindcast:
        if len(overlap) < 1000 or same != len(overlap):
            raise ValueError('Recorded gauge identity must be supported by at least 1000 exact verified matches before emitting an evaluation input')
        if any(item['cohortRows'] != item['matchingExistingEtlQuantization'] for item in unit_fingerprint.values()):
            raise ValueError('Recorded hourly weather conversion fingerprint does not match the existing ETL; no units are silently guessed')
        observed = {time: value for time, value in measured.items() if measured_retrieval.get(time) is not None and time <= measured_retrieval[time]}
        localized_recorded = {time + 3600: value for time, value in tide.items()}
        tide_overlap = sorted(set(localized_recorded) & set(verified_tide))
        tide_differences = [abs(localized_recorded[time] - verified_tide[time]) for time in tide_overlap]
        if len(tide_overlap) < 1000 or any(difference > 1e-8 for difference in tide_differences):
            raise ValueError('Recorded NOAA tide reference differs from verified localized predictions')
        localized = {**verified_tide, **localized_recorded}
        start, end = min(observed), max(observed)
        localized = {time: value for time, value in localized.items() if start - 2 * 3600 <= time <= end + 25 * 3600}
        localized_times = sorted(localized)
        history = []
        for time, value in sorted(observed.items()):
            astronomical = interpolation(localized, localized_times, time, 12 * 60)
            if astronomical is not None:
                history.append({'t': iso(time), 'v': value - astronomical})
        recorded_weather = [{'t': iso(time), **{key: value[key] for key in ['windSpeed', 'windDirection', 'pressure', 'precip']}}
                            for time, value in sorted(hourly.items()) if start <= time <= end]
        archive = {
            'observed': [{'t': iso(time), 'v': value} for time, value in sorted(observed.items())],
            'history': history,
            'tide': [{'t': iso(time), 'v': value} for time, value in sorted(localized.items())],
            'weather': recorded_weather,
            'failures': [],
            'metadata': {
                'inputKind': 'recorded-etl-snapshot-hindcast', 'project': 'floodcastwebapp',
                'sensor': '30046', 'name': 'FIMAN Myrtle Grove Sound at Canal Drive / Sandpiper Lane',
                'observationSource': 'Recorded Firestore locations/carolina-beach/observations monthly fiman fields',
                'observationIdentity': f'{same} of {len(overlap)} shared timestamp/value pairs match verified gauge 30046 archives exactly; nonoverlapping points inherit bucket provenance',
                'datum': 'MLLW', 'units': 'ft', 'originalDatum': 'NAVD88', 'navd88ToMllwFt': 2.75,
                'tideStation': '8658163', 'phaseMinutes': 60,
                'tideSource': 'Recorded NOAA predictions shifted 60 minutes, supplemented by previously verified NOAA localized tide archive',
                'verifiedTideOverlap': len(tide_overlap), 'maximumVerifiedTideDifferenceFt': max(tide_differences),
                'calibration': 'Existing 2.75 ft datum conversion and one-hour localized NOAA reference; neither independently calibrated by this audit',
                'weather': 'Recorded whole-hour ETL cohort lacking station descriptors; exact code fingerprints identify mph and inches; pressure is surface hPa rather than MSL',
                'weatherUnits': {'windSpeed': 'mph', 'windDirection': 'degrees from', 'precip': 'inch', 'pressure': 'surface hPa'},
                'weatherCoordinates': {'lat': 34.0352, 'lon': -77.8931, 'provenance': 'Existing ETL location configuration; not per-point surveyed station metadata'},
                'weatherProvenance': 'Coherent gridded ETL-shaped cohort supported by exact conversion fingerprints; legacy buckets retain no per-point source or original issuedAt',
                'quality': 'Recorded observed values unchanged; legacy buckets do not preserve provider QC; no spike filtering or water proxy filling',
                'start': iso(start), 'end': iso(end), 'retrievedAt': report['generatedAt'],
                'sources': [{'gauge': '30046', 'parameter': 'FIMAN (observed)', 'units': 'ft', 'datum': 'NAVD88', 'provenance': 'Original source metadata verified via exact overlapping archive values; recorded buckets themselves do not preserve per-point source metadata'}],
                'limitations': report['limitations'] + ['Recorded pressure uses surface hPa consistently within this evaluation, while live model input uses MSL hPa; this separate hindcast is not a direct calibration of that input difference.'],
            },
        }
        args.emit_hindcast.parent.mkdir(parents=True, exist_ok=True)
        args.emit_hindcast.write_text(json.dumps(archive) + '\n')
        report['emittedHindcast'] = {'path': str(args.emit_hindcast), 'observed': len(archive['observed']), 'residuals': len(history), 'tidePoints': len(localized), 'weatherHours': len(recorded_weather), 'futureGaugeRowsRemoved': len(measured) - len(observed), 'futureWeatherRowsRemoved': report['recordedWeather']['futureObservationWeatherRows'], 'verifiedTideOverlap': len(tide_overlap), 'maximumVerifiedTideDifferenceFt': max(tide_differences)}
    if args.validation_report:
        numerical = json.loads(args.validation_report.read_text())
        if numerical.get('metadata', {}).get('inputKind') != 'recorded-etl-snapshot-hindcast' or numerical['metadata'].get('sensor') != '30046':
            raise ValueError('The numerical report does not identify the emitted recorded-gauge weather snapshot input')
        validation = {**numerical['validation'], 'weatherInput': 'recorded gridded-ETL snapshot hindcast'}
        report['recordedWeatherValidation'] = {
            'sourceReport': str(args.validation_report), 'evaluatedAt': numerical.get('evaluatedAt'),
            'inputArchive': numerical.get('inputArchive'), 'coverage': numerical['coverage'],
            'training': numerical['training'], 'validation': validation,
            'pressureReference': 'Surface hPa, consistently used within this separate recorded-cohort evaluation',
            'weatherUnitsEvidence': unit_fingerprint,
            'limitations': [
                'Numerical results are unchanged from the existing evaluator; its generic reanalysis label is replaced here with the actual recorded ETL snapshot provenance.',
                'This proves descriptive held-out skill using saved target-time meteorology; original issue timestamps and forecast vintages are unavailable.',
                'Monthly recorded weather may blend forecast and retrospective gridded fields; it is not certified locally measured weather.',
                'Gauge values, including spikes, are unchanged; true long gaps are unavailable and nominal half-hour timestamp jitter is tolerated.',
                'Pressure differs from the live model MSL reference; this independent replication cannot establish the impact of that difference.',
                'Overlapping hourly outcomes are dependent. Complete daily peak windows are also from one season, with no independent storm-season validation.',
            ],
        }
    output = args.output or args.recorded_directory / 'audit.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'output': str(output), 'recordedGaugePoints': len(measured), 'overlap': len(overlap), 'exactMatches': same,
                      'additionalPoints': len(new_times), 'gaugeGapCounts': {key: identity['gapDistribution'][key] for key in ['over30Minutes', 'over30Minutes15Seconds', 'over31Minutes', 'nominal30MinuteJitterIntervals']},
                      'weatherRows': len(weather), 'futureWeatherRows': report['recordedWeather']['futureObservationWeatherRows'],
                      'eligibleHourlyWeatherRows': len(hourly), 'gaugeWeatherPairs': len(residual), 'windAssociations': associations}, indent=2))


if __name__ == '__main__':
    main()

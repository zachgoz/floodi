/** Reproduce the conservative tidal-pattern residual benchmark from a local archive.
 * No credentials, Gemini, network requests or cloud writes are used.
 * Usage: node lib/scripts/evaluate_patterns.js <regional-archive.json> [report.json]
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { backtestResidualPattern, PatternPoint, projectResidualPattern } from '../forecast/pattern';
import { Reference } from '../forecast/water';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
interface Archive {
  history: (Omit<PatternPoint, 't'> & { t: string })[];
  metadata: {
    sensor: string;
    units: string;
    datum: string;
    end?: string;
    calibration?: string;
    sources?: { gauge?: string; parameter?: string; units?: string; datum?: string }[];
    [key: string]: unknown;
  };
  failures?: string[];
}

function run() {
  const input = process.argv[2];
  if (!input) throw new Error('Provide the provenance-bearing regional gauge archive JSON path');
  const archive = JSON.parse(readFileSync(input, 'utf8')) as Archive;
  if (archive.metadata?.sensor !== '30046' || archive.metadata.units !== 'ft' || archive.metadata.datum !== 'MLLW' || !archive.metadata.sources?.length || archive.metadata.sources.some(source => source.gauge !== '30046' || !/^FIMAN \(observed\)$/i.test(source.parameter || '') || !['ft', 'm'].includes(source.units || '') || !/NAVD88/i.test(source.datum || ''))) {
    throw new Error('Gauge 30046 identity, observed-source original units/datum and normalized ft MLLW archive provenance are required');
  }
  if (!Array.isArray(archive.history)) throw new Error('Archive history must be an array of measured residual records');
  const measured = archive.history.filter(point => !point.estimated && typeof point.t === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(point.t) && Number.isFinite(Date.parse(point.t)) && Number.isFinite(point.v));
  const history = [...new Map(measured.map(point => [+new Date(point.t), { ...point, t: new Date(point.t) }])).values()].sort((a, b) => +a.t - +b.t);
  if (history.length < 2) throw new Error('At least two valid, timezone-qualified actual residual readings are required');
  const end = history.at(-1)!.t;
  // Match the initial exploratory report: time-based 70% boundary rounded up to
  // midnight UTC, followed by daily issues and rolling seven-day fits. This is
  // a chronological benchmark, not a model-selection or operational promotion.
  const start = new Date(Math.ceil((+history[0].t + .7 * (+end - +history[0].t)) / DAY) * DAY);
  if (start >= end) throw new Error('Archive span is too short for a chronological held-out interval');
  const reference: Reference = { station: '30046', datum: 'MLLW', units: 'ft' };
  const times = Array.from({ length: 25 }, (_, i) => new Date(+end + i * HOUR));
  const recent = projectResidualPattern(history.filter(point => +point.t >= +end - 14 * DAY), times, end, reference, reference, { horizonHours: 6, trainingHours: 168 });
  const benchmark = backtestResidualPattern(history, start, end, reference, reference, { trainingHours: 168, stepHours: 24 });
  if (!benchmark || recent.analysis.status === 'reference-mismatch') throw new Error('Archive has incompatible per-record references or insufficient benchmark history');
  const coverage = {
    inputRecords: archive.history.length,
    actualResiduals: history.length,
    excludedEstimated: archive.history.filter(point => point.estimated).length,
    excludedInvalid: archive.history.filter(point => !point.estimated).length - measured.length,
    duplicateActualTimestamps: measured.length - history.length,
    maxInterpolationGapMinutes: 30,
  };
  const report = {
    createdAt: new Date().toISOString(), source: input,
    start: start.toISOString(), end: end.toISOString(),
    calibration: archive.metadata.calibration || 'Archive datum/phase calibration is not independently verified by this evaluation.',
    metadata: archive.metadata, coverage,
    settings: { trainingHours: 168, recentHistoryDays: 14, displayedHorizonHours: 6, benchmarkStepHours: 24, split: 'Time-based 70% boundary rounded up to midnight UTC', baselineLeadsHours: [1, 3, 6, 12, 24] },
    analysis: recent.analysis, benchmark,
    failures: archive.failures || [],
    limitations: [
      'Rolling fits use only observations known at each issue, including interpolation provenance; actual-reading anchors and observation gaps are preserved.',
      'At 1/3/6 hours, all three candidate metrics use identical target pairs. The existing damped trend is not defined at 12/24 hours.',
      'Variance explained is in-sample fit R-squared including linear detrending; it is not forecast confidence.',
      'Fixed candidate settings were not tuned to force this benchmark to pass. These exploratory archive results do not establish independent prospective or storm-event reliability.',
      'Missing complete 24-hour outcomes yield null peak metrics rather than invented peak accuracy.',
      'Archive datum/phase calibration limitations remain applicable. No operational forecast is promoted or cloud data changed by this script.',
    ],
  };
  const suffix = String(archive.metadata.end || end.toISOString()).slice(0, 10);
  const output = process.argv[3] || join(dirname(input), `residual-pattern-analysis-${suffix}.json`);
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, coverage, start: report.start, end: report.end, analysis: { status: recent.analysis.status, reason: recent.analysis.reason, harmonicAmplitudesFt: recent.analysis.harmonicAmplitudesFt, varianceExplained: recent.analysis.varianceExplained, accepted: recent.analysis.validation?.accepted ?? false }, benchmark }, null, 2));
}

try { run(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }

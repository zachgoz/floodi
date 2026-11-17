import type { firestore } from 'firebase-admin';
import { FORECAST_REFERENCE_VERSION } from '../forecast/publication';
import { SITE } from '../forecast/sources';
import type { ForecastDocument } from '../forecast/schema';
import type { ChallengerOutlookDocument, ChallengerPoint } from '../forecast/challenger';
import { utcDaysInRange } from '../utils/observationBuckets';
import { hourlyOrigins, scoreVerificationDay, selectPublishedIssue, verificationDayStart } from './scorer';
import { VERIFICATION_VERSION, type PublishedIssue, type VerificationDay, type VerificationReference } from './types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Normal cadence yields 288 candidates across the 48-hour selection range. */
export const MAX_ARCHIVE_CANDIDATES = 360;
/** Operational 10-min challenger cadence yields ~288 candidates across 48h, with headroom for on-demand refreshes. */
export const MAX_CHALLENGER_CANDIDATES = 500;

if (SITE.datum !== 'MLLW' || SITE.units !== 'ft') throw new Error('Verification requires a supported feet MLLW reference');
export const VERIFICATION_REFERENCE: VerificationReference = {
  version: FORECAST_REFERENCE_VERSION, locationId: SITE.id, sensor: SITE.sensor,
  tideStation: SITE.tideStation, datum: SITE.datum, units: SITE.units,
  offsetFt: SITE.offsetFt, phaseMinutes: SITE.phaseMinutes, thresholdFt: SITE.thresholdFt,
};

/** A changed physical calibration starts a separate stored evidence cohort;
 * replaying a day must not overwrite a report using the previous reference. */
export function verificationDayPath(reference: VerificationReference, day: string): string {
  verificationDayStart(day);
  if (![reference.locationId, reference.version].every(value => /^[a-z0-9-]{1,100}$/.test(value))) throw new Error('Invalid verification reference path');
  return `forecast_verification/${reference.locationId}/versions/${VERIFICATION_VERSION}/references/${reference.version}/days/${day}`;
}

const timestampIso = (value: unknown): string | null => {
  if (!value || typeof value !== 'object' || !('toDate' in value) || typeof value.toDate !== 'function') return null;
  const date: unknown = value.toDate();
  return date instanceof Date && Number.isFinite(+date) ? date.toISOString() : null;
};

function isValidChallengerPoint(pt: unknown): pt is ChallengerPoint {
  if (!pt || typeof pt !== 'object') return false;
  const p = pt as Partial<ChallengerPoint>;
  return (
    typeof p.t === 'string' &&
    typeof p.totalFt === 'number' && Number.isFinite(p.totalFt) &&
    typeof p.tideFt === 'number' && Number.isFinite(p.tideFt) &&
    typeof p.residualFt === 'number' && Number.isFinite(p.residualFt)
  );
}

function normalizeChallengerIssue(raw: unknown): { forecast: ForecastDocument; input: unknown } | null {
  if (!raw || typeof raw !== 'object') return null;
  const doc = raw as Partial<ChallengerOutlookDocument>;
  if (doc.challengerId !== 'timesfm-3' || !Array.isArray(doc.points)) return null;

  const rawPoints = [...doc.points];
  if (
    isValidChallengerPoint(doc.originPoint) &&
    rawPoints.length > 0 &&
    isValidChallengerPoint(rawPoints[0]) &&
    Date.parse(doc.originPoint.t) < Date.parse(rawPoints[0].t)
  ) {
    rawPoints.unshift(doc.originPoint);
  }

  const forecastPoints = rawPoints.map(pt => ({
    t: pt.t,
    totalFt: pt.totalFt,
    tideFt: pt.tideFt,
    residualFt: pt.residualFt,
    lowerFt: typeof pt.lowerFt === 'number' && Number.isFinite(pt.lowerFt) ? pt.lowerFt : pt.totalFt,
    upperFt: typeof pt.upperFt === 'number' && Number.isFinite(pt.upperFt) ? pt.upperFt : pt.totalFt,
  }));

  const forecast: ForecastDocument = {
    version: 1,
    status: doc.status === 'available' || doc.status === 'unavailable' ? doc.status : 'unavailable',
    generatedAt: typeof doc.generatedAt === 'string' ? doc.generatedAt : '',
    expiresAt: typeof doc.expiresAt === 'string' ? doc.expiresAt : '',
    locationId: typeof doc.locationId === 'string' ? doc.locationId : '',
    sensor: VERIFICATION_REFERENCE.sensor,
    tideStation: VERIFICATION_REFERENCE.tideStation,
    datum: VERIFICATION_REFERENCE.datum,
    units: VERIFICATION_REFERENCE.units,
    phaseMinutes: VERIFICATION_REFERENCE.phaseMinutes,
    thresholdFt: typeof doc.thresholdFt === 'number' ? doc.thresholdFt : NaN,
    ...(typeof doc.observationAt === 'string' ? { observationAt: doc.observationAt } : {}),
    currentResidualFt: typeof doc.currentResidualFt === 'number' && Number.isFinite(doc.currentResidualFt)
      ? doc.currentResidualFt
      : null,
    trend: 'operational-challenger',
    points: forecastPoints,
    validation: null,
    evidence: [],
    explanation: { headline: 'Flood outlook', evidenceIds: [] },
    explanationSource: 'fallback',
    sources: Array.isArray(doc.covariatesUsed) ? doc.covariatesUsed : [],
    limitations: [],
  };

  const validGridForInput = forecastPoints.every(pt => typeof pt.t === 'string' && typeof pt.tideFt === 'number' && Number.isFinite(pt.tideFt));
  const input = {
    version: 1,
    issuedAt: forecast.generatedAt,
    reference: { ...VERIFICATION_REFERENCE, station: VERIFICATION_REFERENCE.sensor },
    recentResidual:
      typeof doc.currentResidualFt === 'number' && Number.isFinite(doc.currentResidualFt)
        ? [{ t: forecast.generatedAt, v: doc.currentResidualFt }]
        : [],
    tide: validGridForInput ? forecastPoints.map(pt => ({ t: pt.t, v: pt.tideFt })) : [],
  };

  return { forecast, input };
}

/** Read-only repository entrypoint for the scheduler and a local ADC dry run.
 * Query small metadata first; only the <=24 chosen payloads and inputs are read.
 * No NOAA/weather fetch, model execution, trigger initialization or writes. */
export async function loadVerificationDay(db: firestore.Firestore, day: string, asOf = new Date()): Promise<VerificationDay> {
  const start = verificationDayStart(day), end = new Date(+start + DAY);
  const from = new Date(+start - DAY).toISOString();
  const upper = end.toISOString();
  const archiveCollection = `forecast_archive/${SITE.id}/issues`;
  const publicationCollection = `forecast_publications/${SITE.id}/issues`;
  const [archives, publications] = await Promise.all([
    db.collection(archiveCollection).where('generatedAt', '>=', from).where('generatedAt', '<', upper)
      .orderBy('generatedAt').limit(MAX_ARCHIVE_CANDIDATES + 1).select('generatedAt').get(),
    db.collection(publicationCollection).where('generatedAt', '>=', from).where('generatedAt', '<', upper)
      .orderBy('generatedAt').limit(MAX_ARCHIVE_CANDIDATES + 1).get(),
  ]);

  let archiveCandidates = archives.size;
  let publicationMarkers = publications.size;
  let truncated = archives.size > MAX_ARCHIVE_CANDIDATES || publications.size > MAX_ARCHIVE_CANDIDATES;
  let isChallengerCohort = false;
  let issues: PublishedIssue[];

  if (archives.size > 0) {
    const markers = new Map(publications.docs.map(snapshot => [snapshot.id, snapshot]));
    issues = archives.docs.slice(0, MAX_ARCHIVE_CANDIDATES).flatMap(snapshot => {
      const generatedAt = snapshot.data().generatedAt;
      if (typeof generatedAt !== 'string') return [];
      const markerSnapshot = markers.get(snapshot.id);
      const marker = markerSnapshot?.data();
      const expectedArchive = `${archiveCollection}/${snapshot.id}`;
      const expectedInput = `forecast_input_archive/${SITE.id}/issues/${snapshot.id}`;
      const atomic = !!marker;
      // An existing malformed marker cannot silently fall back to legacy timing.
      const requestAt = atomic ? timestampIso(marker.publishedAt) : null;
      const commitAt = timestampIso(markerSnapshot?.createTime) || timestampIso(snapshot.createTime);
      // REQUEST_TIME may precede the successful commit. Never make a forecast
      // available to a replay before the ready marker could actually be read.
      const markerPublishedAt = requestAt && commitAt ? new Date(Math.max(Date.parse(requestAt), Date.parse(commitAt))).toISOString() : null;
      const publishedAt = markerPublishedAt || timestampIso(snapshot.createTime);
      if (!publishedAt) return [];
      const markerValid = !atomic || (!!markerPublishedAt && marker.version === 1 && marker.locationId === SITE.id && marker.issueId === snapshot.id &&
        marker.generatedAt === generatedAt && marker.archivePath === expectedArchive &&
        (marker.inputPath === null || marker.inputPath === expectedInput));
      return [{
        issueId: snapshot.id, generatedAt, publishedAt, publicationBasis: atomic ? 'atomic-publication' : 'legacy-create-time',
        archivePath: expectedArchive, inputPath: atomic ? (marker.inputPath === expectedInput ? expectedInput : null) : expectedInput,
        modelPath: typeof marker?.modelPath === 'string' ? marker.modelPath : null,
        referenceVersion: markerValid && typeof marker?.referenceVersion === 'string' ? marker.referenceVersion : null,
        codeVersion: typeof marker?.codeVersion === 'string' ? marker.codeVersion : null,
        ...(atomic && markerValid ? { publicationReference: {
          locationId: marker.locationId, sensor: marker.sensor, tideStation: marker.tideStation,
          datum: marker.datum, units: marker.units, offsetFt: marker.offsetFt, phaseMinutes: marker.phaseMinutes, thresholdFt: marker.thresholdFt,
        } } : {}),
      } as PublishedIssue];
    });
  } else {
    // Legacy forecast_archive stopped emitting after migration to the operational TimesFM-3 + Basin Physics generator.
    // Query the live operational challenger archive and its publication markers.
    const challengerIssueCollection = `locations/${SITE.id}/forecast_challengers/timesfm-3/issues`;
    const challengerPubCollection = `forecast_challenger_publications/timesfm-3/locations/${SITE.id}/issues`;
    const [challengerIssues, challengerPubs] = await Promise.all([
      db.collection(challengerIssueCollection).where('generatedAt', '>=', from).where('generatedAt', '<', upper)
        .orderBy('generatedAt').limit(MAX_CHALLENGER_CANDIDATES + 1).select('generatedAt').get(),
      db.collection(challengerPubCollection).where('issueId', '>=', from).where('issueId', '<', upper)
        .orderBy('issueId').limit(MAX_CHALLENGER_CANDIDATES + 1).get(),
    ]);
    isChallengerCohort = challengerIssues.size > 0;
    archiveCandidates = challengerIssues.size;
    publicationMarkers = challengerPubs.size;
    truncated = challengerIssues.size > MAX_CHALLENGER_CANDIDATES || challengerPubs.size > MAX_CHALLENGER_CANDIDATES;

    const markers = new Map(challengerPubs.docs.map(snapshot => [snapshot.id, snapshot]));
    issues = challengerIssues.docs.slice(0, MAX_CHALLENGER_CANDIDATES).flatMap(snapshot => {
      const generatedAt = snapshot.data().generatedAt;
      if (typeof generatedAt !== 'string') return [];
      const markerSnapshot = markers.get(snapshot.id);
      const marker = markerSnapshot?.data();
      const expectedArchive = `${challengerIssueCollection}/${snapshot.id}`;
      const atomic = !!marker;
      const requestAt = atomic ? timestampIso(marker.publishedAt) : null;
      const commitAt = timestampIso(markerSnapshot?.createTime) || timestampIso(snapshot.createTime);
      const markerPublishedAt = requestAt && commitAt ? new Date(Math.max(Date.parse(requestAt), Date.parse(commitAt))).toISOString() : null;
      const publishedAt = markerPublishedAt || timestampIso(snapshot.createTime);
      if (!publishedAt) return [];
      const markerValid = !atomic || (
        !!markerPublishedAt &&
        marker.challengerId === 'timesfm-3' &&
        marker.locationId === SITE.id &&
        marker.issueId === snapshot.id &&
        (marker.generatedAt === undefined || marker.generatedAt === generatedAt)
      );
      const hasExplicitRef = marker && typeof marker.sensor === 'string';
      return [{
        issueId: snapshot.id,
        generatedAt,
        publishedAt,
        publicationBasis: atomic ? 'atomic-publication' : 'legacy-create-time',
        archivePath: expectedArchive,
        inputPath: null,
        modelPath: typeof marker?.engine === 'string' ? marker.engine : 'timesfm-3',
        referenceVersion: markerValid
          ? (typeof marker?.referenceVersion === 'string' ? marker.referenceVersion : VERIFICATION_REFERENCE.version)
          : null,
        codeVersion: typeof marker?.engine === 'string' ? marker.engine : null,
        ...(atomic && markerValid ? {
          publicationReference: hasExplicitRef ? {
            locationId: marker.locationId,
            sensor: marker.sensor,
            tideStation: marker.tideStation,
            datum: marker.datum,
            units: marker.units,
            offsetFt: marker.offsetFt,
            phaseMinutes: marker.phaseMinutes,
            thresholdFt: marker.thresholdFt,
          } : {
            locationId: marker.locationId,
            sensor: VERIFICATION_REFERENCE.sensor,
            tideStation: VERIFICATION_REFERENCE.tideStation,
            datum: VERIFICATION_REFERENCE.datum,
            units: VERIFICATION_REFERENCE.units,
            offsetFt: VERIFICATION_REFERENCE.offsetFt,
            phaseMinutes: VERIFICATION_REFERENCE.phaseMinutes,
            thresholdFt: VERIFICATION_REFERENCE.thresholdFt,
          },
        } : {}),
      } as PublishedIssue];
    });
  }

  const selected = [...new Map(hourlyOrigins(day).flatMap(origin => {
    const issue = selectPublishedIssue(issues, origin);
    return issue ? [[issue.issueId, issue] as const] : [];
  })).values()];
  if (selected.length) {
    const snapshots = await db.getAll(...selected.map(issue => db.doc(issue.archivePath)));
    snapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) return;
      if (isChallengerCohort) {
        const adapted = normalizeChallengerIssue(snapshot.data());
        if (adapted) {
          selected[index].forecast = adapted.forecast;
          selected[index].input = adapted.input;
        }
      } else {
        selected[index].forecast = snapshot.data() as ForecastDocument;
      }
    });
    const withInputs = selected.filter(issue => issue.inputPath !== null);
    if (withInputs.length) {
      const inputs = await db.getAll(...withInputs.map(issue => db.doc(issue.inputPath!)));
      inputs.forEach((snapshot, index) => { if (snapshot.exists) withInputs[index].input = snapshot.data(); });
    }
  }
  // One antecedent day provides crossing brackets. Last target is day+95h;
  // a following observation bracket is required instead of extrapolating it.
  const observationDays = utcDaysInRange(new Date(+start - DAY), new Date(+end + 72 * HOUR));
  const observationSnapshots = await db.getAll(
    ...observationDays.map(id => db.doc(`locations/${SITE.id}/observations/${id}`)),
    { fieldMask: ['fiman', 'lastUpdated'] },
  );
  let invalidObservationRows = 0;
  const observations = observationSnapshots.flatMap(snapshot => {
    const values = snapshot.data()?.fiman;
    if (!values || typeof values !== 'object' || Array.isArray(values)) return [];
    return Object.entries(values).flatMap(([t, v]) => {
      if (!/(Z|[+-]\d\d:\d\d)$/.test(t) || !Number.isFinite(Date.parse(t)) || typeof v !== 'number' || !Number.isFinite(v)) {
        invalidObservationRows++;
        return [];
      }
      return [{ t: new Date(t), v }];
    });
  });
  return scoreVerificationDay({ day, asOf, issues, observations, reference: VERIFICATION_REFERENCE, archiveReadTruncated: truncated,
    sourceCoverage: { archiveCandidates, publicationMarkers, selectedIssues: selected.length,
      observationDaysRead: observationDays.length, missingObservationDays: observationDays.filter((_, index) => !observationSnapshots[index].exists), invalidObservationRows } });
}

/** Revisit two days after every lead has matured plus six hours for late ETL.
 * This bounds cost and repairs recent late observations without rewriting history. */
export function recentMaturedVerificationDays(asOf = new Date()): string[] {
  const latest = Math.floor((+asOf - (24 + 72 + 6) * HOUR) / DAY) * DAY;
  return [latest - DAY, latest].map(ms => new Date(ms).toISOString().slice(0, 10));
}

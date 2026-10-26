import type { firestore } from 'firebase-admin';
import { FORECAST_REFERENCE_VERSION } from '../forecast/publication';
import { SITE } from '../forecast/sources';
import type { ForecastDocument } from '../forecast/schema';
import { utcDaysInRange } from '../utils/observationBuckets';
import { hourlyOrigins, scoreVerificationDay, selectPublishedIssue, verificationDayStart } from './scorer';
import { VERIFICATION_VERSION, type PublishedIssue, type VerificationDay, type VerificationReference } from './types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Normal cadence yields 288 candidates across the 48-hour selection range. */
export const MAX_ARCHIVE_CANDIDATES = 360;

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
  const truncated = archives.size > MAX_ARCHIVE_CANDIDATES || publications.size > MAX_ARCHIVE_CANDIDATES;
  const markers = new Map(publications.docs.map(snapshot => [snapshot.id, snapshot]));
  const issues: PublishedIssue[] = archives.docs.slice(0, MAX_ARCHIVE_CANDIDATES).flatMap(snapshot => {
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
  const selected = [...new Map(hourlyOrigins(day).flatMap(origin => {
    const issue = selectPublishedIssue(issues, origin);
    return issue ? [[issue.issueId, issue] as const] : [];
  })).values()];
  if (selected.length) {
    const snapshots = await db.getAll(...selected.map(issue => db.doc(issue.archivePath)));
    snapshots.forEach((snapshot, index) => { if (snapshot.exists) selected[index].forecast = snapshot.data() as ForecastDocument; });
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
    sourceCoverage: { archiveCandidates: archives.size, publicationMarkers: publications.size, selectedIssues: selected.length,
      observationDaysRead: observationDays.length, missingObservationDays: observationDays.filter((_, index) => !observationSnapshots[index].exists), invalidObservationRows } });
}

/** Revisit two days after every lead has matured plus six hours for late ETL.
 * This bounds cost and repairs recent late observations without rewriting history. */
export function recentMaturedVerificationDays(asOf = new Date()): string[] {
  const latest = Math.floor((+asOf - (24 + 72 + 6) * HOUR) / DAY) * DAY;
  return [latest - DAY, latest].map(ms => new Date(ms).toISOString().slice(0, 10));
}

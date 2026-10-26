import { createHash } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { ForecastDocument, validateExplanation, validateForecast } from './schema';
import { SITE } from './sources';

/** Changes to the physical reference start a separate verification cohort. */
export const FORECAST_REFERENCE_VERSION = 'cb-reference-v1-' + createHash('sha256').update(JSON.stringify({
  sensor: SITE.sensor, tideStation: SITE.tideStation, datum: SITE.datum,
  units: SITE.units, offsetFt: SITE.offsetFt, phaseMinutes: SITE.phaseMinutes,
  thresholdFt: SITE.thresholdFt,
})).digest('hex').slice(0, 12);

export interface PublicationRecord {
  version: 1;
  locationId: string;
  issueId: string;
  generatedAt: string;
  publishedAt: Timestamp;
  archivePath: string;
  inputPath: string | null;
  modelPath: string | null;
  codeVersion: string;
  referenceVersion: string;
  sensor: string;
  tideStation: string;
  datum: string;
  units: string;
  offsetFt: number;
  phaseMinutes: number;
  thresholdFt: number;
  status: ForecastDocument['status'];
}

const plainJson = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** A ready marker can never refer to a half-published issue. No provider work
 * belongs in the transaction: Firestore may repeat it after contention. */
export async function publishNumericalForecast(
  db: FirebaseFirestore.Firestore,
  document: ForecastDocument,
  provenance: { inputPath: string | null; modelPath: string | null },
): Promise<boolean> {
  if (!validateForecast(document) || document.sensor !== SITE.sensor || document.phaseMinutes !== SITE.phaseMinutes || document.thresholdFt !== SITE.thresholdFt) {
    throw new Error('Cannot publish an invalid or incompatible numerical forecast');
  }
  if (document.status !== 'unavailable' && !provenance.inputPath) throw new Error('Numerical publication requires its as-issued inputs');
  const issueId = document.generatedAt;
  const archivePath = `forecast_archive/${document.locationId}/issues/${issueId}`;
  const currentRef = db.doc(`locations/${document.locationId}/outlook/current`);
  const markerRef = db.doc(`forecast_publications/${document.locationId}/issues/${issueId}`);
  return db.runTransaction(async transaction => {
    const [current, marker] = await Promise.all([transaction.get(currentRef), transaction.get(markerRef)]);
    if (marker.exists) return false;
    const previous = current.data();
    if (document.status === 'unavailable' && validateForecast(previous) && previous.status === 'available' &&
      previous.sensor === SITE.sensor && previous.phaseMinutes === SITE.phaseMinutes && previous.thresholdFt === SITE.thresholdFt &&
      Date.parse(previous.generatedAt) <= Date.now() && Date.parse(previous.expiresAt) > Date.now()) return false;
    // An old retry may not roll the dashboard or alert evidence backwards.
    if (previous && Number.isFinite(Date.parse(previous.generatedAt)) && Date.parse(previous.generatedAt) >= Date.parse(issueId)) return false;
    transaction.create(db.doc(archivePath), plainJson(document));
    transaction.create(markerRef, {
      version: 1, locationId: document.locationId, issueId, generatedAt: issueId,
      publishedAt: FieldValue.serverTimestamp(), archivePath, ...provenance,
      codeVersion: process.env.K_REVISION || 'local-unversioned', referenceVersion: FORECAST_REFERENCE_VERSION,
      sensor: document.sensor, tideStation: document.tideStation, datum: document.datum,
      units: document.units, offsetFt: SITE.offsetFt, phaseMinutes: document.phaseMinutes,
      thresholdFt: document.thresholdFt, status: document.status,
    });
    transaction.set(currentRef, plainJson(document));
    return true;
  });
}

/** Explanations enrich the public cache, never the immutable numerical archive.
 * A slow reply for an older issue cannot replace a more recent forecast. */
export async function publishForecastExplanation(db: FirebaseFirestore.Firestore, document: ForecastDocument): Promise<void> {
  if (!validateExplanation(document.explanation, document.evidence) || document.explanationSource !== 'gemini-3.8-flash') throw new Error('Invalid forecast explanation');
  const currentRef = db.doc(`locations/${document.locationId}/outlook/current`);
  const explanationRef = db.doc(`forecast_explanations/${document.locationId}/issues/${document.generatedAt}`);
  await db.runTransaction(async transaction => {
    const current = await transaction.get(currentRef);
    transaction.set(explanationRef, {
      issueId: document.generatedAt, explanation: plainJson(document.explanation),
      explanationSource: document.explanationSource, completedAt: FieldValue.serverTimestamp(),
    });
    const data = current.data();
    if (data?.generatedAt === document.generatedAt) {
      transaction.set(currentRef, { explanation: plainJson(document.explanation), explanationSource: document.explanationSource }, { merge: true });
    }
  });
}

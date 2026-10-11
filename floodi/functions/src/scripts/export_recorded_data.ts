/** Read-only public Firestore export of the dashboard's recorded monthly buckets.
 * Usage: node lib/scripts/export_recorded_data.js <YYYY-MM> <YYYY-MM> [project]
 * No credentials are read; failed public reads are reported rather than bypassed.
 */
import fetch from 'node-fetch';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type FirestoreValue = {
  nullValue?: unknown;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number | string;
  timestampValue?: string;
  stringValue?: string;
  bytesValue?: string;
  referenceValue?: string;
  geoPointValue?: { latitude: number; longitude: number };
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
};
type FirestoreDocument = {
  name?: string;
  fields?: Record<string, FirestoreValue>;
  createTime?: string;
  updateTime?: string;
};
type CollectionName = 'observations' | 'predictions';

// This is the existing Firebase project verified for this repository, not a new
// project selection. A configured override must also match any positional value.
const configuredProject = process.env.FC_RECORDED_PROJECT || 'floodcastwebapp';
const location = 'carolina-beach';
const collections: CollectionName[] = ['observations', 'predictions'];

function decode(value: FirestoreValue): unknown {
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) {
    const number = Number(value.integerValue);
    return Number.isSafeInteger(number) ? number : value.integerValue;
  }
  if ('doubleValue' in value) {
    const number = Number(value.doubleValue);
    return Number.isFinite(number) ? number : String(value.doubleValue);
  }
  if ('timestampValue' in value) return value.timestampValue;
  if ('stringValue' in value) return value.stringValue;
  if ('bytesValue' in value) return value.bytesValue;
  if ('referenceValue' in value) return value.referenceValue;
  if ('geoPointValue' in value) return value.geoPointValue;
  if ('arrayValue' in value) return (value.arrayValue?.values || []).map(decode);
  if ('mapValue' in value) return decodeFields(value.mapValue?.fields || {});
  throw new Error('Unrecognized Firestore field type; no partial document exported');
}

function decodeFields(fields: Record<string, FirestoreValue>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decode(value)]));
}

function monthNumber(text: string | undefined): number {
  if (!text || !/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) throw new Error('Dates must use YYYY-MM');
  const [year, month] = text.split('-').map(Number);
  if (year < 2000 || year > 2100) throw new Error('Requested years must be between 2000 and 2100');
  return year * 12 + month - 1;
}

function monthText(number: number): string {
  return `${Math.floor(number / 12)}-${String(number % 12 + 1).padStart(2, '0')}`;
}

function summarize(fields: Record<string, unknown>) {
  const maps = ['fiman', 'noaa', 'data', 'weather'];
  return Object.fromEntries(maps.filter(key => key in fields).map(key => {
    const value = fields[key];
    const entries = value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : [];
    const times = entries.map(([time]) => Date.parse(time)).filter(Number.isFinite).sort((a, b) => a - b);
    return [key, {
      records: entries.length,
      first: times.length ? new Date(times[0]).toISOString() : null,
      last: times.length ? new Date(times[times.length - 1]).toISOString() : null,
      invalidTimes: entries.length - times.length,
      duplicateUtcTimes: times.length - new Set(times).size,
    }];
  }));
}

async function get(url: string) {
  return fetch(url, { timeout: 30_000, headers: { 'User-Agent': 'Floodi-Recorded-Data-Audit/1.0' } });
}

async function run() {
  const start = monthNumber(process.argv[2]);
  const end = monthNumber(process.argv[3]);
  if (end < start || end - start >= 24) throw new Error('Request an ascending range of at most 24 months');
  if (process.argv.length > 5) throw new Error('Usage: export_recorded_data.js <YYYY-MM> <YYYY-MM> [project]');
  const project = process.argv[4] || configuredProject;
  if (project !== configuredProject || !/^[a-z][a-z0-9-]{4,62}$/.test(project))
    throw new Error('Project must match the configured FC_RECORDED_PROJECT (default: existing floodcastwebapp)');
  const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/locations/${location}`;
  const outputRoot = join(process.cwd(), 'evaluation', 'recorded-data');
  mkdirSync(outputRoot, { recursive: true });
  const months = Array.from({ length: end - start + 1 }, (_, index) => monthText(start + index));
  const results: unknown[] = [];
  const failures: { collection: string; month?: string; httpStatus?: number; reason: string }[] = [];
  const metadata: unknown[] = [];

  for (const collection of collections) {
    // One bounded list request reads only lastUpdated, never unrelated content.
    // A list restriction does not prevent trying separately permitted get reads.
    const params = new URLSearchParams({ pageSize: '24', 'mask.fieldPaths': 'lastUpdated' });
    try {
      const response = await get(`${base}/${collection}?${params}`);
      if (response.ok) {
        const body = await response.json() as { documents?: FirestoreDocument[]; nextPageToken?: string };
        const requested = (body.documents || []).filter(document => months.includes(document.name?.split('/').pop() || ''));
        metadata.push({ collection, listed: (body.documents || []).length, moreDocuments: !!body.nextPageToken, requested: requested.map(document => ({ month: document.name?.split('/').pop(), updateTime: document.updateTime, ...decodeFields(document.fields || {}) })) });
      } else failures.push({ collection, httpStatus: response.status, reason: 'Metadata list unavailable; individual requested reads attempted' });
    } catch (error) {
      failures.push({ collection, reason: error instanceof Error ? error.message : 'Metadata list failed' });
    }

    mkdirSync(join(outputRoot, collection), { recursive: true });
    for (const month of months) {
      try {
        const response = await get(`${base}/${collection}/${month}`);
        if (response.status === 404) {
          results.push({ collection, month, exists: false });
          writeFileSync(join(outputRoot, collection, `${month}.json`), JSON.stringify({ version: 1, project, location, collection, month, exists: false, retrievedAt: new Date().toISOString() }, null, 2));
          continue;
        }
        if (!response.ok) {
          failures.push({ collection, month, httpStatus: response.status, reason: 'Public monthly document read denied or unavailable' });
          continue;
        }
        const document = await response.json() as FirestoreDocument;
        const expectedName = `projects/${project}/databases/(default)/documents/locations/${location}/${collection}/${month}`;
        if (document.name !== expectedName) throw new Error('Unexpected document reference; refusing export');
        const fields = decodeFields(document.fields || {});
        const exported = { version: 1, project, location, collection, month, exists: true, retrievedAt: new Date().toISOString(), documentName: document.name, createTime: document.createTime, updateTime: document.updateTime, fields };
        writeFileSync(join(outputRoot, collection, `${month}.json`), JSON.stringify(exported, null, 2));
        results.push({ collection, month, exists: true, lastUpdated: fields.lastUpdated, ...summarize(fields) });
      } catch (error) {
        failures.push({ collection, month, reason: error instanceof Error ? error.message : 'Monthly export failed' });
      }
    }
  }

  const report = {
    version: 1, project, location, retrievedAt: new Date().toISOString(), requestedMonths: months, metadata, results, failures,
    limitations: [
      'Read-only public Firestore snapshot; no credentials were read and no cloud data was changed.',
      'Original timestamp keys and fields are preserved; equivalent UTC keys and conflicts require normalization during evaluation.',
      'Legacy buckets have no guaranteed per-point source, quality, vertical datum, units, issuedAt or availableAt provenance.',
      'Monthly prediction weather retains the final stored value per target time; it is not an immutable archive of issued forecast vintages.',
      'The current snapshot cannot establish which revised observations or weather values were available at a historical issue time.',
    ],
  };
  const reportPath = join(outputRoot, 'report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ reportPath, project, requestedMonths: months, results, failures }, null, 2));
  if (failures.some(failure => failure.month)) process.exitCode = 1;
}

run().catch(error => {
  console.error(error instanceof Error ? error.message : 'Recorded-data export failed');
  process.exitCode = 1;
});

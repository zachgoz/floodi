# Daily observation storage

Production monthly observation documents reached Firestore's 1 MiB document limit. New ingestion and historical recovery now write UTC day documents at `locations/{locationId}/observations/YYYY-MM-DD`. Legacy `YYYY-MM` documents remain untouched and readable.

Each day uses atomic nested `merge: true` writes. A successful source does not erase a failed/missing source, older timestamps, partial weather fields, or unrelated metadata. Missing/nonfinite values and ambiguous timestamps without a timezone are not stored. Future observations are excluded. A conservative 700,000-byte JSON patch guard rejects unexpectedly oversized upstream days before Firestore; it is a patch safeguard rather than a claim that JSON bytes equal Firestore's encoded document size. Normal daily source volumes are much smaller than a month. All write errors remain visible to job monitoring.

Archived camera links are stored separately in `persistedImagery` and overlay refreshable links in `imagery`. Repeated camera refreshes cannot replace saved `storage://` references. Both historical imagery layouts are read: timestamp → camera → URL and camera → timestamp → URL. Public client reads expose the existing camera → timestamp → URL shape. The new map has the same Firestore indexing exemption as the other observation maps.

The application reads requested daily documents first, and downloads a legacy month only when a requested day lacks the explicit verified-coverage marker described below. An existing daily document alone does not prove its sources/history complete. Daily values override matching legacy instants after timezone normalization. Partial weather updates merge individual fields. UTC date iteration handles daylight saving changes and requests that cross midnight. Legacy weather after that archive's `lastUpdated` cutoff is excluded from observed weather, even when the timestamp has since passed. If the cutoff is absent or invalid, legacy weather is excluded rather than assigned observation provenance. The raw legacy archive is preserved for investigation. This cannot retrospectively establish provenance for every older weather row; forecasting training still needs its own source-quality checks. Backend historical range readers retain their conservative monthly-plus-daily merge.

## Migration

Use existing server-side Application Default Credentials; no credentials belong in source code or the client. The command requires an explicit existing project, location, and bounded month range. The default mode is read-only:

```sh
cd floodi/functions
npm run migrate:observations -- --project EXISTING_PROJECT --location carolina-beach --from 2026-05 --to 2026-10
```

Review the JSON plan (`monthsRead`, `daysExamined`, `daysToCopy`, `rejectedRecords`) before applying the same scope:

```sh
npm run migrate:observations -- --project EXISTING_PROJECT --location carolina-beach --from 2026-05 --to 2026-10 --apply
```

The copy uses short per-day transactions only to add missing leaves without overwriting current daily readings or metadata. It also upgrades pre-existing daily saved image links into the archived overlay. Each copied day is read back and verified, and the untouched monthly source is checked once per month. A second apply should report zero `daysWritten`. Forecast-contaminated or unidentifiable legacy weather stays in the untouched monthly archive and is counted as rejected; it is not relabeled as measured data. No legacy document is deleted, and this migration does not attempt to reconstruct observations that were never persisted.

Deploy the compatible reader and Firestore indexes/rules before relying exclusively on daily writes. Upgrade existing daily saved-image references with the migration before switching any older daily writer to raw camera refreshes. In the October 14 preflight there were no existing daily documents; the new writer creates the archived-image overlay from the outset, so compatible Functions/Hosting can release together and the non-destructive legacy copy can follow. The daily reader also works without a complete migration because it still includes monthly history. Reverting to monthly-only writers would reintroduce the document-size failure and must not be used as a rollback plan.

## Recovery endpoint

`runBackfillData?days=1..60` is a private administrative function with a single instance and one concurrent request. Invoke it with an authenticated server-side POST using a Google identity granted Cloud Run Invoker on that function; it is not a browser API. Other HTTP methods receive 405 before any provider fetch or database write. No frontend component calls it.

It returns a structured summary with requested/completed/partial/failed chunks, per-source failure and record counts, successfully written day patches, accepted/upserted timestamp records, and rejected records. HTTP 200 indicates all chunks completed; 207 indicates partial source/chunk recovery; 503 indicates no valid records were persisted. A provider failure does not discard other providers. Peak/event upserts preserve saved images and metadata. Counts describe applied records, not a claim that every timestamp was newly created.

## Validation

Unit tests exercise day boundaries, timezone normalization, zero/missing/future values, legacy/daily precedence, partial weather merges, archived image protection, oversized-patch errors with partial progress, dry-run behavior, idempotent migration and untouched-source verification. Emulator rules tests cover public reads of both document shapes and denied writes for ordinary users and client administrators. No production migration is performed by these tests.

## Verified daily coverage for fast dashboard reads

After the normal copy migration has completed, its optional metadata-only mode can certify each UTC day's coverage of the frozen legacy source:

```sh
npm run migrate:observations -- --project EXISTING_PROJECT --location carolina-beach --from YYYY-MM --to YYYY-MM --coverage-only
```

Review this dry-run before adding `--apply`. This mode does not copy missing observations or change any water, weather or image values. It fails if a valid legacy leaf is not represented in daily data, a gauge/image row has future provenance, or the legacy snapshot changes during verification. Run the normal copy first if coverage is incomplete. Valid newer daily corrections are retained, and archived camera URLs can satisfy older raw-image entries.

In one transaction per month, the verifier rechecks the source's exact Firestore `updateTime`, reads all UTC days, verifies every eligible source leaf, and writes only a `legacyCoverage` map containing version, source month/update time, verification time and `archiveFrozen: true`. Empty-day markers express genuine absence in that archive; they do not create sensor readings, close historical gaps or imply continuous sensor uptime. Monthly forecast-contaminated weather remains excluded by its recorded cutoff. Applying again against the same source version writes no additional markers. Ongoing daily leaf merges preserve the marker.

This is an explicit archive immutability contract: supported ingestion jobs write daily documents only. Future maintenance that changes a legacy month must invalidate its daily `legacyCoverage` markers atomically with that source change, copy/verify the updated archive, then recertify. Never edit a certified monthly source silently. The browser cannot independently check a month version without downloading that month; it trusts this server-owned proof. Missing, invalid, wrong-month, future-dated or unreadable markers fall back to the original month. No archive is deleted.

Certification has not been applied merely by adding this code. Until operators run the reviewed metadata-only verification, the fallback remains active and month-transfer savings must not be claimed as measured production improvement.

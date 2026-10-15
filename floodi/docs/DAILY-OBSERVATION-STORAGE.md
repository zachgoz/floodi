# Daily observation storage

Production monthly observation documents reached Firestore's 1 MiB document limit. New ingestion and historical recovery now write UTC day documents at `locations/{locationId}/observations/YYYY-MM-DD`. Legacy `YYYY-MM` documents remain untouched and readable.

Each day uses atomic nested `merge: true` writes. A successful source does not erase a failed/missing source, older timestamps, partial weather fields, or unrelated metadata. Missing/nonfinite values and ambiguous timestamps without a timezone are not stored. Future observations are excluded. A conservative 700,000-byte JSON patch guard rejects unexpectedly oversized upstream days before Firestore; it is a patch safeguard rather than a claim that JSON bytes equal Firestore's encoded document size. Normal daily source volumes are much smaller than a month. All write errors remain visible to job monitoring.

Archived camera links are stored separately in `persistedImagery` and overlay refreshable links in `imagery`. Repeated camera refreshes cannot replace saved `storage://` references. Both historical imagery layouts are read: timestamp → camera → URL and camera → timestamp → URL. Public client reads expose the existing camera → timestamp → URL shape. The new map has the same Firestore indexing exemption as the other observation maps.

The application and backend range reader load requested daily documents together with the corresponding legacy months. Daily values override matching legacy instants after timezone normalization. Partial weather updates merge individual fields. UTC date iteration handles daylight saving changes and requests that cross midnight. Legacy weather after that archive's `lastUpdated` cutoff is excluded from observed weather, even when the timestamp has since passed. If the cutoff is absent or invalid, legacy weather is excluded rather than assigned observation provenance. The raw legacy archive is preserved for investigation. This cannot retrospectively establish provenance for every older weather row; forecasting training still needs its own source-quality checks.

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

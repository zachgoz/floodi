# Camera archival repair — October 15, 2026

## Cause and change

The scheduled `syncImagery` job enumerated Firestore `locations` parent documents. Production has observation subcollections under `locations/carolina-beach`, but no parent location document. Consequently, the schedule could return successfully without inspecting images or emitting per-location outcomes. This behavior existed before the October 14 reliability release.

The camera job now uses the same checked-in operational location configuration as observation/prediction ingestion. Location IDs, gauge settings and the established 5.6 ft minor-flood threshold are unchanged. A missing parent document no longer prevents processing. Empty configuration fails explicitly. Outcomes include image-reference and water-sample counts, alongside actual attempted/succeeded/failed/deferred archival counts.

The 48-hour lookback, maximum 24 images per invocation, 90-second admission budget, finite image fetch/storage deadlines and separate archived-image overlay are retained. Successful camera references merge into daily documents without replacing water levels, weather, other cameras or metadata. Partial camera failures retain successful archives; complete failure remains visible to Scheduler.

## Camera and water-level alignment

The production preflight found 145 camera timestamps and 148 gauge samples in the preceding 48 hours. None matched exactly; all cameras had a gauge sample within 15 minutes, and only 29 matched within one minute. All 31 existing durable references were hourly captures. Exact timestamp lookup could therefore miss flood-image captures outside the hourly window.

Flood-image selection now reuses the existing interpolation calculation between finite observed gauge samples bracketing the camera time, with a maximum 30-minute gap. It does not extrapolate across missing readings. The first-ten-minutes-of-hour capture rule continues independently. This alignment controls which images are archived; it does not alter gauge data, tide/forecast calculations, flood events or thresholds.

## Verification

- Strict Functions TypeScript build passed.
- All 111 backend tests passed, including 10 camera-job regressions and 9 image-storage/selection tests. The new cases cover absent parent documents, configured thresholds, preserved data, bounded work, partial/complete failures, empty configuration, camera/gauge clock offsets and unsupported gaps.
- ESLint passed on all four changed TypeScript files with zero errors or warnings. Diff whitespace checks passed.
- A production durable-reference check resolved an existing archived JPEG in the runtime bucket: 22,236 bytes, with valid object metadata. This confirms that the saved reference names a real object rather than just a database entry.

The targeted deployment of `syncImagery` and `syncWaterLevels` to the existing `floodcastwebapp` project succeeded. Both use the repaired image-selection helper. Hosting, Firestore rules/indexes and credentials were unchanged.

An authenticated Scheduler invocation of the repaired camera job completed at **07:59:30 EDT** (11:59:30 UTC). Its new structured outcome recorded:

- Location: `carolina-beach`, without a parent Firestore location document.
- 145 image references and 148 water-level samples inspected.
- Status `ok`, zero failures, no deferred work.
- Zero additional eligible images pending archival in that window; the 31 hourly references were already archived. This run verifies discovery/scanning and honest no-work reporting, rather than claiming to have created new objects.

The private operational-health record and existing durable image object were read back separately after deployment. No parent location document is created as a workaround, and no archive or measurement is deleted.

# Frontend reliability diagnostics

Production web and Capacitor builds report uncaught JavaScript errors, unhandled
promise rejections, React render failures, and explicitly instrumented data or
comment failures to `POST /api/client-errors`. Development builds do not report.
There is no blanket console capture or interception of general network traffic.

## Data and privacy

The payload is a strict shared schema in `functions/src/telemetry/schema.ts`:
fixed error code, general allowlisted route, build identifier, provider, safe
error type/Firebase code, HTTP status where available, and at most five script
locations. Stack locations contain only same-origin `/assets/*.js` paths and
line/column numbers. Function names, arbitrary exception/rejection text, page
URLs, query strings, request contents, comment text, credentials, account IDs,
email addresses, user-agent strings and persistent visitor/session identifiers
are excluded. Unsupported fields cause server rejection.

Requests omit cookies/credentials and referrers. The client saves only a numeric
counter in session storage, sends at most ten reports per tab session, and
suppresses identical reports for five minutes. It does not store payloads for
later upload, retry failed reports or send while offline. A telemetry failure is
silently absorbed and cannot recursively report itself. Collection is best-effort;
it is not a complete record of every failure or an availability metric.

The application log record excludes IP addresses. Google Cloud's standard HTTP
request/security logs can still include infrastructure metadata such as source
IP, as disclosed on the Privacy Policy page. Cloud Logging's configured retention
applies to error records.

## Backend controls and costs

`collectClientErrors` accepts only POST JSON (maximum 8 KiB), plus strict-origin
CORS preflight. Allowed origins are the configured Firebase project's exact
`.web.app` / `.firebaseapp.com` domains and the app's local Capacitor origins.
Additional HTTPS origins can be specified as a comma-separated
`CLIENT_ERROR_ALLOWED_ORIGINS` server environment value. Wildcards, paths and
credential-bearing origin values are rejected. An Origin check reduces browser
cross-site abuse but is not authentication; non-browser callers can forge it.

A durable transactional quota in the **single fixed, server-only document**
`_telemetryLimits/clientErrors` allows at most 50 reports globally per minute,
including across instances. Rejections do not write. Each instance caches a
saturated global window, bounds attempted quota checks to 100/minute and limits
one ephemeral source digest to ten/minute. Source digests are held only in a
bounded memory map and reset each minute, never saved to Firestore or logs.
The function has at most two instances, a 15-second timeout, and no per-error or
per-visitor database documents. Quota/storage errors fail closed with 503.
These limits bound application writes/logged reports, not the cloud provider's
standard public HTTP request logging or invocation costs. A caller can exhaust
the shared quota and cause diagnostic drops; telemetry never gates app use.

## Investigation

Cloud Logging query:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="collectclienterrors"
jsonPayload.event="frontend_error"
```

Runtime/render failures use ERROR; handled degradation uses WARNING. Deliberate
`monitoring_probe` verification reports use INFO and a fixed verification message.
The record is `jsonPayload.client`, with `code`, `buildId`, `route`, `provider`,
`errorType`, optional safe status/code and `frames`. Filter by buildId to determine
whether a regression started with a release. The backend itself supplies the
human-readable message from an enum; it never logs rejected payloads or arbitrary
client strings.

Vite's deterministic build identifier links assets to a private hidden source-map
archive. Source maps must remain outside Hosting's `dist` output. Current reports
retain the exact minified asset location, enabling local source-map lookup for
the same build; they do not upload source code or automatically symbolicate it.

## Configuration and verification

- Hosting rewrite: `/api/client-errors` -> `collectClientErrors`.
- Root Functions entry exports `collectClientErrors` from `./clientErrors`.
- Keep `_telemetryLimits/**` denied in browser Firestore rules.
- Existing `VITE_FIREBASE_PROJECT_ID` chooses the HTTPS backend for native builds;
  there is no new browser API key or credential.
- Set the build's `import.meta.env.VITE_APP_BUILD_ID` to the deterministic private
  source-map/archive identifier; unrecognized values become `unknown`.
- Verify a fixed-schema `monitoring_probe` produces HTTP 204 and one INFO log;
  verify an extra `message` field is rejected with 400 and produces no error log.
- Frontend tests cover privacy, quota/dedup/offline behavior, native routing,
  global errors/rejections, React recovery and handled forecast/comment failures.
- Backend tests cover strict validation, origin/type/size rejection, native CORS,
  per-source limits, durable cross-instance quota and fail-closed errors.

## Optional Analytics network failures

Firebase Analytics is separate from reliability diagnostics. Set the optional
`VITE_FIREBASE_MEASUREMENT_ID` to the existing Firebase web app's measurement ID.
Providing that public property ID enables the installed Analytics SDK's local
fallback when a browser blocks its dynamic configuration request. Without a
valid property ID, while offline, or when browser storage/cookies are unsupported,
optional Analytics does not initialize; flood monitoring and error collection
continue independently. No global errors are suppressed to hide Analytics failures.

The installed Firestore SDK already auto-detects long-polling when needed. A
transient WebChannel error alone does not justify forcing a different transport
for every user. No REST proxy or transport override was added.

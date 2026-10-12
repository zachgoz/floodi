# Deployment security preparation — October 11, 2026

This pass fixes the account-role creation defect identified in the October 11 review and applies compatible Firebase Functions dependency updates. These checks ran locally against a demo-project emulator; they do not establish that production rules have been deployed or that pre-existing privileged accounts were legitimately assigned.

## Account roles and private forecasting data

- Owners can create only `anonymous` or `user` profiles. Supplying `admin` or `moderator` during profile creation is denied.
- Owner edits preserve the role, including replacement writes. The one allowed owner role transition is `anonymous` to `user` after Firebase Authentication reports a non-anonymous provider, supporting the existing linked-registration flow.
- Existing trusted administrators can still promote accounts through the administrator workflow. Initial administrators must be provisioned through a trusted server/Admin SDK; the browser bootstrap utility cannot grant privileges.
- Public forecast reads remain available. Client writes to public forecasts and client reads/writes of private model/input collections remain denied, including for application administrators.

**11 actual Firestore emulator tests passed**, using Firebase rules-testing 5.0.2 and Firestore emulator 1.22.0. The cases cover owner/anonymous creation, privilege escalation during create/update/replacement, unauthorized edits/deletion, linked registration, trusted administrator promotion, moderator restrictions, public forecast reads and private forecast access. Expected denied requests produce permission-denied emulator logs.

Run from `functions/` with Java 21 or later and the Firebase CLI available:

```sh
npm ci
npm run test:rules
```

The command uses the isolated `demo-floodcast-rules` project and `firebase.rules-test.json`, with no production writes. Running the test file directly without an emulator explicitly skips this suite; the `test:rules` command starts the required engine and does not skip it. The Java runtime used for this verification was downloaded into `/private/tmp` without changing machine configuration.

## Functions dependencies

`npm audit fix --omit=dev` applied fixes within the existing manifest ranges, without `--force`, SDK major upgrades or app dependency changes. The lockfile now includes Firebase Admin 13.10.0, Express 4.22.3, gRPC 1.14.6, protobufjs 7.6.6, proxy-addr 2.0.8 and websocket-driver 0.7.5, along with compatible JWS, multipart and HTTP parser fixes. Development dependencies were restored before compilation and testing. The official rules-testing package is a development dependency.

The final production-only Functions audit reported **9 moderate findings, zero high and zero critical**, compared with 22 findings including 8 high and 3 critical before this pass. The remaining findings are dependency-chain reports stemming from UUID versions below 11.1.1 in the existing Google Cloud SDK dependencies. The underlying advisory concerns buffer bounds in UUID v3/v5/v6. Inspection of the installed Google gax, gaxios and teeny-request consumers found calls to `uuid.v4()`; those calls do not demonstrate the vulnerable buffer API path. This inspection limits the known exposure but does not certify the dependency tree as vulnerability-free. Removing the remaining audit findings requires a separate verified SDK major upgrade or tested UUID override.

The Functions TypeScript build and all **11 existing backend Node tests** passed after the dependency changes. The app TypeScript/production build also passed once the Functions development types were restored. App dependencies and their pre-existing audit findings were outside this dependency patch; the static hosting build does not publish its development dependency tree.

## Production follow-up

Deploy and verify the rules alongside the application and Functions. Verify runtime API/IAM access with production workload identity. Separately audit existing administrator/moderator assignments: tightening creation rules prevents new self-promotion but does not revoke roles already stored in Firestore. Do not silently remove legitimate administrators.

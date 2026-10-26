# Launch implementation validation — October 19, 2026

This is a local implementation and validation record. It does not establish production rollout, real email delivery, improved forecast skill, or measured field performance. The October 17 production audit remains the pre-change baseline.

## Implemented

- Next Flooding Events stays first, followed by a compact alert invitation, then separate synchronized water/surge plots in one card. Navigation is Forecast / Alerts / Help. Current gauge condition and sample freshness appear in the header.
- Resident enrollment, explicit consent, verification/recheck, early-access/active/paused/unsubscribed state, recent activity, test queueing and opt-out use a private backend. API reads/mutations and verification notices remain owned by the account that initiated them; timeouts include stalled token refresh. Auth form switches retain the Alerts destination.
- Longer-range events say Planning outlook using actual method boundaries; Max Street Flooding retains the requested label with visible Estimated context. No new calibration or street-depth claim was introduced.
- Flood Outlook leads with an actual threshold-crossing window or covered horizon; provider, technical evidence and validation remain expandable. Existing numerical forecasts and hazard thresholds are preserved.
- Weather distinguishes unavailable from calm/dry and bounds event lookup; webcam labels use capture age and Eastern time. Similar historical events are grouped into episodes. Scientific settings are explicit custom analysis, with ordered thresholds and a persistent custom-view state. Dead role-upgrade/bootstrap actions were removed from resident flows.
- Browser zoom, named form inputs, keyboard chart pan, touch controls, time-pill contrast, modal names and optional tour focus/Escape behavior were corrected. Event loading placeholders reserve the expected two-row structure; this is not a claim that all layout shifts are eliminated.
- Forecast gzip, coverage-aware daily reads, lazy secondary routes, conditional numeric-slot advertising, and sampled scalar Web Vitals are implemented. Daily coverage certification has not been applied to production.

## Automated validation

- App: **732 tests passed in 70 files**. A subsequent targeted run covers the final event skeleton and equivalent redirect hardening; no forecast calculation changed.
- Functions: **191 tests passed**, zero failures, plus **29 real Firestore emulator integration/security tests** (12 citizen and 17 existing). Provider calls are mocked; emulator writes use an isolated demo project.
- App and Functions TypeScript/build checks passed. Full ESLint has zero errors with 201 existing warnings; focused alert/performance/tour checks have no errors. Whitespace and source/private-build credential checks passed. No private keys, service accounts or source maps were found in public build output. The large primary/map chunk warning remains.
- Coverage includes consent/auth/verification, account switching, opt-out generations, duplicate/reordered delivery, leases, stale/latest publication gates, enrollment catch-up, provider retries/idempotency conflicts, missing weather, schema/privacy boundaries, linked-chart zoom/pan/live behavior and gzip/coverage fallback.

## Browser validation

Local Vite app checked at 320px and 390px touch viewports, 1440px desktop, and light/dark schemes. No horizontal document overflow observed. Actual public production forecast data were used in the validated local preview cache. Guest Alerts layout was also checked with a simulated default-off readiness response because Vite alone does not host Firebase Functions. Actual backend HTTP behavior and persistence are tested separately. No real resident account, provider submission, DNS change or production write was used.

Verified lazy Ionic navigation from Forecast to Alerts to registration/sign-in, preserved return destination, named registration inputs, synchronized 12-hour charts after pan/live, and unsubscribe confirmation with the token removed from URL/globals before analytics.

Local Lighthouse snapshot checks: dashboard and registration **100 accessibility / 100 best practices / 100 SEO**. These are narrow snapshot checks, not assistive-technology certification. The optional llms.txt recommendation remains unrelated to resident launch readiness. No new comparable cold-load performance trace or real-device VoiceOver/TalkBack session was completed.

## Remaining rollout gates

Deploy the guarded release, indexes and monitored event configuration; then verify actual hosted routes and logs. Review the metadata-only daily coverage dry-run before applying certification. Offline forecast payload comparison measured 625,926 bytes to 159,958 bytes gzip (74.4% reduction); live transfer/load savings are not yet measured.

Before enabling emails, configure a verified Resend sending domain/address and server Secret Manager key, explicitly enable/redeploy all four consumers, then verify a consenting tester's inbox and pause/unsubscribe behavior. Delivery remains off and no billing is enabled. See [setup](../CITIZEN-ALERTS-SETUP.md). Capacity, automated bounce/complaint processing, retention cleanup, paid entitlement/billing and reviewed street calibration remain further commercialization work.


## October 20 sender follow-up

The owner chose 895forsale.com for temporary testing. `alerts@895forsale.com` is configured server-side, and Resend's API confirmed verified/enabled domain status. One explicitly authorized owner connection email was accepted and reported delivered by Resend. Inbox placement is not independently confirmed. The key remains in Secret Manager; no secret was written to a repository or browser file. Citizen delivery is still false and no release or subscriber activation occurred. The 19 targeted citizen configuration/API tests passed. Production enrollment, worker delivery and opt-out remain separate rollout checks.

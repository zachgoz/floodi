# FloodCast prelaunch UX and subscription review

October 17, 2026 · Production browser review and current source audit · Recommendations only

## Launch decision

The public forecasting dashboard has a useful core. The next commercial step is a focused citizen alert pilot. People cannot subscribe today: the last release deployed private accuracy scoring and shadow alert decisions. It did not add citizen enrollment, verified delivery channels, payment, or notification delivery.

Alerts should be a primary product action. The immediate prelaunch action should say **Join alert early access**, and must lead to a real opt-in form before it is published. After delivery is operational, use **Get flood alerts**. Do not present account creation as alert activation or charge a subscriber while delivery is unavailable.

The largest improvements are completing that journey, making current versus future risk unambiguous, correcting overconfident impact claims, and reducing cold loading time. A broad visual redesign is unnecessary.

## What was reviewed

- Live production dashboard, event detail, shared tide/surge controls and readouts, weather controls, webcam/map area, settings, About, first-use tour, guest profile, registration, login, password reset and privacy pages.
- Desktop presentation and mobile emulation at 390 and 320 CSS pixels. No horizontal overflow was observed at those mobile widths.
- Authenticated profile/admin behavior, backend alert implementation, scoring, rules, calibration and data-loading paths were reviewed in source. No existing user's account was accessed and no new account was created.
- One cold mobile performance trace in a fresh isolated browser context: 390×844, touch, DevTools Slow 4G, 4× CPU slowdown. Lighthouse accessibility/SEO snapshot checks ran separately on dashboard and registration.
- No app source, deployment, subscription or provider configuration was changed. Normal app telemetry may record the review visits. No manual notification/test email, payment or signup was submitted.

Measured results and filtered accessibility evidence are in [audit-metrics.json](qa/launch-2026-10-17/audit-metrics.json). This is a product/source/browser review, not a security penetration test, legal assessment, full assistive-technology test or demonstration of forecast reliability.

## Alert discovery and setup

### Placement

Keep **Next Flooding Events** as the first dashboard card. Add the location and concise current-condition status to the header, with a compact alert action. Place one small benefit card immediately after the events, before the combined chart card. Avoid a large banner that pushes useful hazard information away.

Proposed early-access copy, not current functionality:

> Flood alerts for Carolina Beach  
> Get updates about upcoming flood conditions.  
> **Join early access** · Alerts are not active yet.

When operational, replace the action with **Get flood alerts** and show the actual enabled channel and terms. After enrollment, replace acquisition copy with a compact **Alerts on / setup incomplete / paused** state linked to preferences. Never keep advertising enrollment to an active subscriber.

Give Alerts a permanent navigation destination for launch. A dedicated Map tab is optional follow-on work; a useful eventual arrangement is **Forecast · Map · Alerts**, with account access in the header and About/methodology under Help. Keep the existing map available within the forecast while a dedicated map view is introduced. Carry the selected location/time across those views.

### Minimum complete citizen journey

| Step | Resident sees | Required behavior |
| --- | --- | --- |
| Discover | Get flood alerts / early access | The next screen accurately states availability, supported location and benefit. |
| Choose coverage | Carolina Beach advisory; reviewed places when supported | Start with the shared gauge advisory. Named-road alerts require reviewed local impact thresholds. No background GPS is necessary. |
| Verify channel | Email entry, verification pending, resend/change | Consent is explicit; channel verification is server-owned. Account creation alone does not enable messages. |
| Confirm service | Included alerts, terms, actual price and renewal if paid | Clear expected updates and supported lead times. Payment success URLs do not grant entitlement by themselves. |
| Activate | Alerts active plus watched coverage and verified channel | Activation is shown only when recipient delivery can work. A user-authorized test demonstrates the real provider path. |
| Manage | Recent alerts, test, pause, unsubscribe, support and billing | Separate pausing messages from cancelling renewal. Expired/failed setup cannot silently remain active. |

Begin with one tested channel and location rather than building municipal operations, push and SMS all at once. Continue shadow scoring while the pilot collects event and delivery evidence. The shared evaluator is already separate from optional Gemini explanations; preserve that boundary.

## Findings that matter before a paid alert launch

| Priority | Verified finding | Improvement |
| --- | --- | --- |
| Blocker | There is no Alerts route, subscriber channel, entitlement or delivery worker. Shadow intents explicitly have zero recipients and delivery not attempted. | Implement enrollment and private queued delivery, verified channel state, opt-out, retries/expiry and delivery outcomes. Keep early access truthful until those work. |
| High | The first visible event was October 24 while the review was October 17. Its exact minute window and displayed street-flooding estimate have the same visual treatment as a near-term forecast. The general “Elevated flood risk” headline does not state its time horizon. | Add a compact event lead/horizon indication such as “Planning outlook” for the supported longer-range method. Make risk summaries say which period they describe. Use calculated uncertainty where available; do not invent confidence percentages or timing ranges. |
| High | Street calibration is absent for the configured location. Event cards derive the displayed Max Street Flooding value from threshold exceedance and disclose the limitation only behind an information control. The map uses elevation heuristics and stronger road-impact labels. | Retain the requested **Max Street Flooding** label, add visible **Estimated** beside the value, and make its spatial scope clear. Review watched-place impact relationships before selling street-specific depth/road claims. Gauge advisories can be scoped honestly without claiming surveyed street depths. |
| High | About promises knowing “exactly” when water arrives and when it is “safe to travel.” Its methodology still describes the superseded median-offset approach and its build date is hardcoded to May. | Remove exactness/travel-safety guarantees, describe the actual trend/weather/historical forecast briefly, and derive version/build metadata from the release. |
| High | Registration's four input controls have no accessible names; mobile page zoom is explicitly disabled. Lighthouse accessibility was 85 for registration and 88 for the dashboard. | Associate labels, enable browser zoom while retaining deliberate chart gestures, fix contrast and accessible control names before directing customers into setup. |

Evidence: [routes](../src/App.tsx), [shadow engine](../functions/src/alerts/engine.ts), [shadow persistence](../functions/src/alerts/store.ts), [launch foundation](ALERTING-FOUNDATION.md), [event cards](../src/components/dashboard/NextFloodingEventsCard.tsx), [location calibration](../src/constants/locations.ts), [map](../src/components/dashboard/InundationMap.tsx), [About](../src/pages/Tab3.tsx), [registration](../src/pages/auth/Register.tsx), [viewport configuration](../index.html).

## Dashboard and full-app improvements

| Surface | Finding | Proposed change |
| --- | --- | --- |
| Header/current status | Location is inside settings. The primary current readout says Live/Estimated but the first screen does not plainly summarize current flood status or latest actual sensor age. | Show location, a concise supported gauge/condition state and observation freshness. Distinguish viewing live time from having a fresh measurement. Preserve unavailable states. |
| Next events | Compact cards and clear units are a good foundation. Informational caveats and extended-horizon context are less visible than precise numbers. | Keep the two-event default and expandable list. Add one short horizon/estimate badge, reduce surrounding whitespace where practical, and add a contextual alert action. Do not add paragraphs to each card. |
| Typography | Section headings are now consistently 18px in the main chart areas. Remaining readability issues include small gray text, wrapped metric labels and bright green time pills. | Retain the existing type family and use a small, consistent scale for headings, supporting text and key values. Improve contrast and spacing before changing font sizes broadly. |
| Shared chart controls | Chart synchronization and one control group are valuable. At 320px the sticky toolbar is 106px tall; the time-settings button is only 18px tall. | Keep synchronization. Compact lower-frequency controls into a menu if needed, enlarge touch areas without enlarging visible text, and avoid obscuring the selected-time readout. |
| Forecast explanations | “Net increase in residual” and the model/provider name dominate a paragraph that does not immediately answer the resident's next-event question. | Lead with affected period and expected change to local conditions. Keep top computed factors adjacent to the selected surge value; put model/provider and technical detail behind the information disclosure. Factor contributions remain statistical associations, not proven individual causes. |
| Weather | Missing wind/rain is coerced to zero in the dashboard and zero values are hidden. Event detail uses an unbounded nearest weather point. | Preserve null versus calm/dry. Show a compact unavailable state and cap nearest-point lookup to supported timestamps so later events do not inherit old weather. |
| Webcam | LIVE is based on selected-time mode rather than image age. Fallback can select frames many hours old. Current successful images do not prove stale fallback labeling is safe. | Derive freshness from capture time. Use “Latest image” with age; mark stale/unavailable explicitly. Use Eastern time consistently with the charts. |
| Map/simulator | Road-level numbers and “roads flooded” look definitive. The manual simulator shares a large dashboard area with actual forecast conditions. | Clearly distinguish estimated impacts, selected forecast time and manual simulation. Keep “Back to forecast” obvious; use reviewed calibration provenance for watched roads. |
| Settings | Basic mode still exposes scientific source, offset and editable flood thresholds. Those personal values can differ from the backend alert policy. “Show offset trend” is obsolete in the split-chart design. | Move scientific overrides into an explicit analysis/custom-view area, validate threshold order, retain reset, and show a persistent custom-view state. Alert criteria remain separately versioned and clearly described. Remove ineffective controls. |
| Account | Profile emphasizes permission roles, avatar URLs and account metadata. “Request Role Upgrade” only displays a success toast; it does not save/send a request. | Lead with alert coverage/status and channel/preferences. Remove the fake success action and hide technical role information from routine resident flows. |
| Administration | An old authenticated bootstrap page describes self-promotion to admin, while rules correctly deny unauthorized elevation. | Remove the obsolete consumer-facing route. This review did not find a verified privilege-escalation vulnerability. |
| First visit | A seven-step automatic tour appears over the dashboard. | Make the tour optional and lead with location, current conditions, next event and alert availability. Preserve accessible focus/keyboard dismissal. |
| Event details | Icon-only header close button has no accessible name. Similar-event list repeated several samples from one October 11 period. | Name the close button and group historical samples into distinct episodes. Add a compact “Alert me about events like this” entry once setup exists. |
| Recovery/help | Some errors blame NOAA generically; missing map data exposes a terminal command. Contact/support is not actionable on the privacy page. | Provide accurate stale/unavailable/retry states and a visible support route. Keep diagnostic commands in developer tools. |
| Privacy/subscription management | Current policy describes existing account/comment/diagnostic behavior, not a future recipient/billing lifecycle. | Add truthful channel/provider disclosures when implemented, consent records, support and account/data request controls. Review subscription terms before paid activation. |
| Marketing/search | There is no meta description. Production /robots.txt returns application HTML with HTTP 200. | Publish an actual robots.txt and focused page/share metadata. Use a concise alert landing page for acquisition, leaving the dashboard useful to returning residents. Account/private routes need appropriate indexing boundaries. |

Additional source pointers: [atmospheric state](../src/components/Tab2/hooks/useAtmosphericState.ts), [metric rendering](../src/components/dashboard/MetricPills.tsx), [selected factors](../src/components/dashboard/ForecastFactors.tsx), [webcam](../src/components/dashboard/WebcamFeedCard.tsx), [settings](../src/components/Tab2/SettingsModal.tsx), [profile](../src/pages/auth/Profile.tsx), [tour](../src/components/onboarding/IntroTourOverlay.tsx), [privacy](../src/pages/PrivacyPolicy.tsx).

## Performance: reproduced cold-start delay

One measured lab run, not a real-user percentile or a forecast-accuracy test:

| Metric | Observed | Assessment |
| --- | ---: | --- |
| TTFB | 223 ms | Initial document response was quick; this does not measure later API latency. |
| First contentful paint | 5.52 s | Visible startup delay. |
| Largest contentful paint | 5.52 s | Above Google's 2.5-second good threshold. |
| Chart ready from navigation | 10.74 s | Important app-specific measure; a painted shell alone is insufficient. |
| Layout shift | 0.1032 | Slightly above Google's 0.1 good threshold; hydrograph movement identified. |
| INP | Not measured | Navigation-only testing cannot establish real interaction latency. |

Threshold/measurement context: [Google's Web Vitals guidance](https://web.dev/articles/vitals). Field behavior should be assessed separately at the 75th percentile and segmented appropriately; this single trace is diagnostic evidence.

The deployed entry script transferred 360,405 bytes and decoded to 1,874,332 bytes. The public forecast transferred about 626 KB with no Content-Encoding header; 2,164 point objects accounted for approximately 612 KB of the JSON. That forecast request took 6.86 seconds under the selected throttling. Initial chart-data work took approximately 5.08 seconds after the app started. A roughly 5.7 MB Firebase transfer total was reported across the trace window, including deferred buffer work; it is not all a single initial document. Long-lived Firestore Listen requests are not equivalent to a blocking critical chain.

Prioritized performance work:

1. Measure and add HTTP response compression for the public forecast, then consider a compact versioned public representation and on-demand detailed factors. Preserve full immutable numeric/input archives and schema compatibility.
2. Use coverage-aware daily observation reads with legacy fallback instead of always fetching a month plus days. Current code merges full month records even for a short initial viewport. Preserve older history and explicit missing coverage.
3. Lazy-load secondary auth/About/privacy/admin routes. Keep the map's existing deferred chunk and viewport loading behavior. Measure bundle savings after the change.
4. Gate/defer advertising work until the useful dashboard is ready or the ad area is needed. The ad script is loaded globally; the trace recorded roughly 226.5 KB of ad transfers. A separate automatic ad element was present even with no app-defined wrapper rendered. Do not treat it as confirmed unused code or promise an unmeasured speedup.
5. Reserve the final event/forecast dimensions so late data does not move the chart. Verify the layout-shift cause before attributing it only to skeleton animation.
6. Extend existing privacy-safe timing collection with LCP/CLS/INP and alert-discovery/setup/verification/activation conversion. Existing startup timing already samples 25% of visits and records shell/chart/outlook, FCP, TTFB and cache state. A trace is not a substitute for field data.

## Accessibility checks

Snapshot Lighthouse findings are concrete but incomplete: dashboard accessibility 88, registration 85. Neither score certifies accessibility.

- Enable browser zoom; index.html currently sets maximum-scale=1 and user-scalable=no.
- Give all registration/reset controls real associated labels and appropriate autocomplete. The registration snapshot confirmed four unnamed inputs.
- Increase contrast on the green viewing-time pill (reported 1.78:1) and gray captions/legend (approximately 3.7:1).
- Give the event-modal header close icon a name and ensure visible control text is included in accessible names.
- Correct SVG polyline ARIA usage; provide useful chart summaries and keyboard-equivalent time navigation. Shared zoom alone does not replace keyboard panning.
- Recheck custom-tour focus behavior, dark mode, larger system text, touch targets and real VoiceOver/TalkBack behavior during implementation. Real devices and authenticated assisted flows were not exercised in this review.

## Recommended implementation order

1. **Launch clarity and reliability pass:** concise location/status/header, accurate About and horizon/estimate language, frame freshness, missing-weather states, accessible signup/zoom/contrast, remove dead actions, improve cold startup and metadata. Preserve the established card order, separate synchronized charts, and current forecasting calculations.
2. **Working citizen pilot:** private early access/enrollment, verified email delivery, explicit channel consent, alert status/history/test/pause/unsubscribe and operational monitoring. Use the existing shadow evaluator; begin with honest Carolina Beach gauge advisories and reviewed local impact scope.
3. **Paid activation:** hosted checkout plus server-owned entitlement/webhook reconciliation, management/cancellation/support, real delivery evidence, and agreed forecast/false-alert/lead-time criteria. Only then promote paid alerts broadly. Expand municipal workflows and additional sensors after the first pilot proves usefulness.

Acceptance should include real enrollment and verification, one user-authorized test through the actual provider, inactive/denied/unverified states, unsubscribe and expiry, duplicate/out-of-order handling, real delivery outcomes, mobile cold-load regression checks and current independent forecast scoring. No forecast accuracy percentage or guaranteed flood prevention is established by this UX audit.

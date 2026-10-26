# Earlier interface captures

These October 10 captures document intermediate desktop and mobile checks. They predate the final chart consolidation, forecast adoption, compact labels and full-range controls. They are historical QA evidence, not screenshots of the current interface.

Current behavior is covered by the automated chart interaction tests. New browser visual verification was blocked by the browser tool's localhost URL policy during the October 11 continuation; that remaining check is recorded in `../FLOOD_FORECASTING.md`.

## October 17 production launch review

The current production interface was reviewed on desktop and at 320px/390px mobile widths. See [the launch review](../PRELAUNCH-UX-REVIEW-2026-10-17.md) and [measured browser evidence](launch-2026-10-17/audit-metrics.json). This review covers the deployed public interface and source-confirmed account/alert gaps; it did not implement or deploy the proposed UX changes.


## October 19 implementation checks

The approved launch UX and default-off citizen email pilot were implemented locally. See [validation and remaining rollout gates](LAUNCH-IMPLEMENTATION-2026-10-19.md). This record distinguishes emulator/mocked delivery checks from a real provider/inbox test and production deployment.


## October 20 production release

The release is now live with the opt-in email pilot enabled. See [verified deployment, performance and remaining limits](RELEASE-2026-10-20.md).

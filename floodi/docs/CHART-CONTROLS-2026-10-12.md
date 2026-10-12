# Chart controls and hourly weather

Removed flood-period background rectangles from the water-level chart. Existing threshold line colors, flood crossings, event cards and numerical forecasts are preserved.

Weather stays compact by default. **Hourly** opens a horizontally scrollable strip of actual hourly wind speed, compass direction and rain totals within the shared chart range. Missing records remain unavailable. Dates use America/New_York or the selected UTC display, including repeated daylight-saving hours. Long ranges render only visible cells. Touch scrolling, paging and keyboard navigation retain the user's inspected hour during live updates and overlapping range changes; disjoint ranges clamp to the nearest edge.

**Add Comment** now sits in the toolbar below the plot, outside the wind and rain rows. The action retains the current chart time and water-level selection. Controls wrap at narrow widths and use 44px touch targets. Weather taps do not capture the chart pointer, and swipes or canceled gestures do not accidentally open weather details.

Verification: **556 app tests across 49 files passed**, the TypeScript/production build passed, and ESLint reported zero errors with 216 existing warnings. Tests cover hourly values and missing data, DST, long-range virtualization, live scroll preservation, synchronized chart ranges, comment selection and keyboard behavior, and absence of flood shading while retaining line colors and forecast calculations. Built browser JavaScript contained no private credential payloads. An independent final review found no remaining actionable issues.

Browser visual verification remains pending: localhost access was rejected by the available browser tool and the restriction was not bypassed. Production deployment remains pending Firebase access to the established `floodcastwebapp` project. This pass changes presentation and interactions, not the forecasting model or its measured reliability.

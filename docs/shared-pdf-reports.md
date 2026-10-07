# Shared PDF reports

Web and native mobile exports use `/api/pdf/render-file`. Both receive a PDF produced by the same server renderer. If the server browser is unavailable, both request `/api/pdf/render-html`; the fallback prints the server's HTML, not a separately maintained mobile layout.

## Report definitions

- `utils/web-pdf-reports.js`: credit cards (overview, cycle, history, monthly, yearly), planner, daily and habit trackers (overview/detail), fixed deposits, friends/loans, split history/session, EMI overview/detail, trips overview/detail, split-trip detail, bank history, expense reports, tenant invoice/month/report, petrol real/fake entries.
- `utils/live-split-friend-pdf.js`: friend-split statements, current balance, selected-period total, and trip member columns.
- `utils/shared-pdf-html.js`: shared rendering and society reports (month, compact month, members, individual member, matrix, expenses, report, custom, map, function).
- `utils/pdf-report-model.js`: converts the migrated web table/card definitions into the shared renderer's data model.

The web's `downloadSharedWebReport` and mobile's `shareWebReport` send a named report, arguments, currency, and selected screen data. They must not assemble separate PDF columns or summary cards. Add new report definitions to the server registry and call that report from both clients.

For reports that fetch fresh data, `utils/pdf-report-api.js` makes read-only requests to the current server's listening socket, forwarding the caller's session cookie or bearer token. Report data reads are restricted to supported API paths and retain the existing API ownership checks. No client-supplied hostname or executable code is accepted.

Screen snapshots preserve the user's selected rows and filters. Matching data, filters, and currency produce the same report. Native download/share UI remains platform-specific.

## Audit scope

All active native PDF export buttons now call the shared report service. The native society-function local HTML fallback and unused mobile PDF layouts were removed. The public tenant portal is a web-only surface: its invoice PDF already uses the same portal code on desktop and mobile browsers; it has no separate native export. Petrol PDF export is web-only today, and its definition is now in the shared registry for future native use.

## Validation and rollout

Run `node --test scripts/test-shared-web-pdf-reports.js scripts/test-friend-trip-pdf-columns.js scripts/test-live-split-friend-pdf-summary.js`. Tests cover populated reports, matching serialized mobile inputs, date-range/current-balance separation, identity columns, report-name validation, and authenticated internal data requests.

Deploy the backend and web assets before distributing the updated mobile build. Existing released clients still use the older generic templates, which remain supported.

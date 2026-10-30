Own Trips packing checklist
==========================

Run `npm run migrate:postgres` before starting the updated backend. It applies
`db/trip-checklist.sql` along with the existing schema, without resetting data.
Deploy the backend and web assets together; build a new mobile release to expose
the checklist in the mobile app. No new packages or notification credentials are required.

The actual trip member roster defines the checklist columns; owning a trip does
not add an extra traveller. Existing guest/user completion keys remain intact;
checks belonging to removed or formerly implicit owner columns are excluded from
progress, without deleting historical data.

Sharing permissions update (29 October 2026): run `npm run migrate:postgres` to
add checklist permission/member mapping columns and the unique assignment index
before restarting the backend. In Share Trip, each app user can be matched to an
existing trip member and given “Can check their own checklist” separately from
view/edit access. Name matches are suggestions; the owner confirms the selection.
Ambiguous names require a manual selection. Existing shares can be updated or
revoked. Nonmembers remain spectators, and public links stay read-only. Guest
completion keys remain unchanged when sharing, so saved checks are preserved.

Each trip has a common item list. Owners and trip editors can add, rename and
remove items. Each linked account can check only its own items, including members
with view access. The owner can check items for guests without accounts. Shared
viewers who are not travellers can see progress but do not receive a packing column.
Guest progress is keyed by normalized name; renaming a guest starts a new guest
checklist. Linked account progress survives member row recreation.

Owners can set reminders for the guest checklists they manage, even if they are
not listed as travellers. Other linked accounts receive reminders for their own items.
Each account sets its own reminder: enabled, number of days before departure
(0–365), once/daily/weekly, time in HH:MM and IANA timezone. Days before and time
also provide a custom first reminder date. The server checks every minute and
uses the existing in-app notification and mobile push delivery system, including
account preferences. Permission to send device notifications must be enabled for
mobile push. Guests without linked accounts cannot receive push notifications.

Notifications name outstanding items and link to Own Trips. They stop after the
departure date in the selected timezone, on completed/cancelled trips, or while
all items are checked. Empty checklists never notify. The first scheduled date
anchors repeating reminders. After downtime the server catches up the current
slot once, rather than sending all missed reminders. Existing notification dedupe
keys prevent duplicate notifications across restarts and multiple server workers.

The web trip grid and mobile trip cards include a compact packing percentage and
progress bar, or a neutral “No packing list” badge. Grid progress includes every
actual member's item checks; the tooltip/accessibility text reports members ready
and checks remaining. Summaries use a single batched database query for the
accessible trips. Detail edits refresh the cached trip summary immediately.

Checks: `node --test tests/trip-checklist.test.js tests/trip-checklist-reminders.test.js`,
`node scripts/test-trip-checklist-browser.js`, `npm run build`.
Mobile JSX is validated with Babel/Expo. Verify on a device with two linked accounts:
add a trip item, independently check each column, confirm both percentages, save
different reminder schedules, and open the trip from a reminder notification.

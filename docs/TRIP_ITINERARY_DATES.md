Own Trips itinerary dates
========================

Each itinerary date group now includes “Add on this date” (mobile: “+ Add”) and
“Change date”. Adding opens the existing editor with that group's date selected;
editing an existing activity continues to use the activity's saved date.

Change date shows the number of entries and moves every entry on the source day
in one transaction. Existing activities on the destination day are retained.
Titles, times, locations and notes stay unchanged. Activity lists refresh and
regroup after the change. This follows the existing owner permission for itinerary
mutations. Invalid dates, identical source/destination dates and empty source days
are rejected. No database migration or new dependencies are required.

API: `PUT /api/trips/:id/itinerary/move-date`
Body: `{ "from_date": "2026-07-31", "to_date": "2026-08-01" }`
Response: `{ "success": true, "count": 6 }`

Validation: `node --test tests/trip-itinerary-date.test.js`,
`node scripts/test-trip-itinerary-date-browser.js`, `npm run build`.
The mobile screen and move-date modal are also compiled with Babel/Expo.

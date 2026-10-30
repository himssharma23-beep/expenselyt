const { query } = require('../db/postgres');
const { load } = require('../db/trip-checklist');
const { dueSlot } = require('./trip-checklist');
const { createAndSendUserNotification } = require('./user-push-events');
let running = false;
async function runTripChecklistReminders(now = new Date()) {
  if (running) return;
  running = true;
  try {
    const rows = await query(`SELECT r.*, t.start_date::text, t.status, t.destination, t.name FROM trip_checklist_reminders r
      JOIN trips t ON t.id = r.trip_id JOIN users u ON u.id = r.user_id
      WHERE r.enabled AND t.start_date >= (NOW() - INTERVAL '2 days')::date
      AND u.is_active = TRUE AND u.deleted_at IS NULL`);
    for (const row of rows.rows) {
      try {
        const slot = dueSlot(row, row, now);
        if (!slot) continue;
        const list = await load(row.user_id, row.trip_id);
        const people = list.participants.filter(p => p.can_check || p.user_id === Number(row.user_id));
        const remaining = people.reduce((n, p) => n + p.remaining, 0);
        if (!remaining) continue;
        const names = list.items.filter(i => people.some(p => !p.checked_items.includes(String(i.id)))).map(i => i.title).join(', ');
        await createAndSendUserNotification({ id: row.user_id }, {
          type: 'trip_packing_reminder', dedupe_key: `trip-packing:${row.trip_id}:${slot}`,
          title: 'Trip packing reminder',
          body: `${row.destination || row.name}: ${remaining} item(s) left to pack. ${names}`.slice(0, 250),
          target_screen: 'Trips', target_params: { tripId: Number(row.trip_id) },
          data: { trip_id: Number(row.trip_id) },
        });
      } catch (e) { console.error('[trip-packing] reminder failed:', e.message); }
    }
  } finally { running = false; }
}
module.exports = { runTripChecklistReminders };

const { query } = require('./postgres');
const core = require('./postgres-core');
const { participants, validateReminder } = require('../utils/trip-checklist');
function fail(message, statusCode = 400) { const e = new Error(message); e.statusCode = statusCode; throw e; }
async function access(userId, tripId) {
  const trip = await core.getTripById(userId, tripId);
  if (!trip) fail('Trip not found', 404);
  return trip;
}
async function load(userId, tripId) {
  const trip = await access(userId, tripId);
  const [items, checks, settings] = await Promise.all([
    query('SELECT id, title FROM trip_checklist_items WHERE trip_id = $1 ORDER BY id', [tripId]),
    query('SELECT c.item_id, c.participant_key FROM trip_checklist_checks c JOIN trip_checklist_items i ON i.id = c.item_id WHERE i.trip_id = $1', [tripId]),
    query('SELECT enabled, days_before, frequency, time, timezone FROM trip_checklist_reminders WHERE trip_id = $1 AND user_id = $2', [tripId, userId]),
  ]);
  const people = participants(trip, userId).map(p => {
    const done = checks.rows.filter(c => c.participant_key === p.key).map(c => String(c.item_id));
    const percent = items.rows.length ? Math.round(done.length / items.rows.length * 100) : 0;
    return { ...p, checked_items: done, complete: done.length, remaining: items.rows.length - done.length, percent };
  });
  return { items: items.rows, participants: people, can_edit: trip.isOwner || trip.userPermission === 'edit',
    can_remind: trip.isOwner || people.some(p => p.user_id === Number(userId)),
    reminder: settings.rows[0] || { enabled: false, days_before: 3, frequency: 'once', time: '09:00', timezone: 'Asia/Kolkata' } };
}
async function editItem(userId, tripId, itemId, data, remove = false) {
  const trip = await access(userId, tripId);
  if (!trip.isOwner && trip.userPermission !== 'edit') fail('Trip edit access required', 403);
  const title = String(data?.title || '').trim();
  if (!remove && (!title || title.length > 160)) fail('Enter an item between 1 and 160 characters');
  let result;
  if (remove) result = await query('DELETE FROM trip_checklist_items WHERE trip_id = $1 AND id = $2 RETURNING id', [tripId, itemId]);
  else if (itemId) result = await query('UPDATE trip_checklist_items SET title = $3 WHERE trip_id = $1 AND id = $2 RETURNING id', [tripId, itemId, title]);
  else result = await query('INSERT INTO trip_checklist_items (trip_id, title) VALUES ($1, $2) RETURNING id', [tripId, title]);
  if (!result.rows.length) fail('Item not found', 404);
}
async function check(userId, tripId, itemId, data) {
  const trip = await access(userId, tripId);
  const person = participants(trip, userId).find(p => p.key === data.participant_key);
  if (!person?.can_check) fail('You can only update your own checklist or guests you manage', 403);
  if (typeof data.checked !== 'boolean') fail('Checked must be true or false');
  const item = await query('SELECT id FROM trip_checklist_items WHERE trip_id = $1 AND id = $2', [tripId, itemId]);
  if (!item.rows.length) fail('Item not found', 404);
  if (data.checked) await query('INSERT INTO trip_checklist_checks (item_id, participant_key) VALUES ($1, $2) ON CONFLICT DO NOTHING', [itemId, person.key]);
  else await query('DELETE FROM trip_checklist_checks WHERE item_id = $1 AND participant_key = $2', [itemId, person.key]);
}
async function saveReminder(userId, tripId, data) {
  const trip = await access(userId, tripId);
  if (!trip.isOwner && !participants(trip, userId).some(p => p.user_id === Number(userId))) fail('Only trip participants can enable packing reminders', 403);
  let r;
  try { r = validateReminder(data); } catch (e) { fail(e.message); }
  await query(`INSERT INTO trip_checklist_reminders (trip_id, user_id, enabled, days_before, frequency, time, timezone)
    VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (trip_id,user_id) DO UPDATE SET
    enabled=EXCLUDED.enabled, days_before=EXCLUDED.days_before, frequency=EXCLUDED.frequency, time=EXCLUDED.time, timezone=EXCLUDED.timezone`,
  [tripId, userId, r.enabled, r.days_before, r.frequency, r.time, r.timezone]);
}
function summarize(trip, rows, userId) {
  const itemIds = new Set(rows.map(r => String(r.id)));
  const people = participants(trip, userId).map(p => {
    const complete = new Set(rows.filter(r => r.participant_key === p.key).map(r => String(r.id))).size;
    return { name: p.name, complete, remaining: itemIds.size - complete,
      percent: itemIds.size ? Math.round(complete / itemIds.size * 100) : 0 };
  });
  const total = itemIds.size * people.length;
  const complete = people.reduce((n, p) => n + p.complete, 0);
  return { item_count: itemIds.size, member_count: people.length, total_checks: total, complete,
    remaining: total - complete, percent: total ? Math.round(complete / total * 100) : 0,
    ready_members: itemIds.size ? people.filter(p => p.remaining === 0).length : 0, participants: people };
}
async function summarizeTrips(userId, trips) {
  if (!trips.length) return trips;
  const result = await query(`SELECT i.trip_id, i.id, c.participant_key FROM trip_checklist_items i
    LEFT JOIN trip_checklist_checks c ON c.item_id = i.id WHERE i.trip_id = ANY($1::bigint[])`, [trips.map(t => t.id)]);
  const grouped = new Map();
  for (const row of result.rows) {
    const id = String(row.trip_id);
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(row);
  }
  return trips.map(t => ({ ...t, packing_summary: summarize(t, grouped.get(String(t.id)) || [], userId) }));
}
module.exports = { load, editItem, check, saveReminder, summarizeTrips, summarize };

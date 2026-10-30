const DAY = 86400000;
function participants(trip, viewerId) {
  const people = new Map();
  const add = (key, name, userId) => {
    if (!people.has(key)) people.set(key, { key, name, user_id: userId || null,
      can_check: userId ? Number(userId) === Number(viewerId) : !!trip.isOwner });
  };
  // The member roster is authoritative. Ownership does not imply an extra traveller.
  for (const m of trip.members || []) {
    const uid = Number(m.linked_user_id) || null;
    // Names keep guest progress stable when the trip editor recreates member rows.
    const key = uid ? `u:${uid}` : `g:${String(m.member_name).trim().toLowerCase()}`;
    add(key, m.member_name, uid);
    const person = people.get(key);
    const shares = trip.shared_users || [];
    const assigned = shares.find(s => s.checklist_member_key === key && s.checklist_can_check);
    const viewerShare = shares.find(s => Number(s.linked_user_id) === Number(viewerId));
    if (assigned && !uid) person.user_id = Number(assigned.linked_user_id);
    if (viewerShare) person.can_check = !!(viewerShare.checklist_can_check && viewerShare.checklist_member_key === key);
  }
  return [...people.values()];
}
function validateReminder(data) {
  if (typeof data.enabled !== 'boolean') throw new Error('Enabled must be true or false');
  const days = Number(data.days_before);
  if (!Number.isInteger(days) || days < 0 || days > 365) throw new Error('Days before must be between 0 and 365');
  if (!['once', 'daily', 'weekly'].includes(data.frequency)) throw new Error('Choose once, daily or weekly');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(data.time || '')) throw new Error('Time must use HH:MM');
  try { new Intl.DateTimeFormat('en', { timeZone: data.timezone }).format(); } catch (_) { throw new Error('Choose a valid timezone'); }
  if (!data.timezone) throw new Error('Timezone is required');
  return { enabled: data.enabled, days_before: days, frequency: data.frequency, time: data.time, timezone: data.timezone };
}
function dueSlot(trip, reminder, now = new Date()) {
  if (!reminder.enabled || ['completed', 'cancelled'].includes(trip.status)) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: reminder.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const start = String(trip.start_date).slice(0, 10);
  const first = Date.parse(start) - reminder.days_before * DAY;
  const today = Date.parse(date);
  if (!Number.isFinite(first) || today < first || today > Date.parse(start) || `${parts.hour}:${parts.minute}` < reminder.time.slice(0, 5)) return null;
  const elapsed = Math.floor((today - first) / DAY);
  const slot = reminder.frequency === 'once' ? 0 : Math.floor(elapsed / (reminder.frequency === 'weekly' ? 7 : 1));
  return `${start}:${reminder.frequency}:${reminder.days_before}:${reminder.time.slice(0, 5)}:${reminder.timezone}:${slot}`;
}
module.exports = { participants, validateReminder, dueSlot };

const { test } = require('node:test');
const assert = require('node:assert/strict');
const from = '2026-07-31', to = '2026-08-01';
let entries, calls;
function reset() {
  calls = [];
  entries = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, trip_id: 1, itinerary_date: from,
    title: `Activity ${i}`, start_time: '10:00', end_time: '11:00', notes: 'Booking confirmed', location: 'Bangkok' }));
  entries.push({ id: 7, trip_id: 1, itinerary_date: to, title: 'Existing day activity' }, { id: 8, trip_id: 2, itinerary_date: from, title: 'Another trip' });
}
const query = async (sql, params) => {
  calls.push({ sql, params });
  if (sql.includes('SELECT id FROM trips')) return { rows: Number(params[1]) === 10 ? [{ id: params[0] }] : [] };
  if (sql.includes('UPDATE trip_itinerary_items')) {
    const rows = entries.filter(e => e.trip_id === Number(params[0]) && e.itinerary_date === params[1]);
    rows.forEach(e => { e.itinerary_date = params[2]; });
    return { rows };
  }
  return { rows: [] };
};
const withTransaction = async work => {
  const before = structuredClone(entries);
  try { return await work({ query }); } catch (e) { entries = before; throw e; }
};
for (const [name, exports] of [['../db/postgres', { query, withTransaction }], ['../db/postgres-billing', {}], ['../db/source-bank-payment', {}]]) {
  require.cache[require.resolve(name)] = { id: require.resolve(name), filename: require.resolve(name), loaded: true, exports };
}
const { moveTripItineraryDate } = require('../db/postgres-core');
test('moves all six entries at once, retains times and details, and merges with destination date', async () => {
  reset();
  const before = structuredClone(entries);
  assert.equal(await moveTripItineraryDate(10, 1, { from_date: from, to_date: to }), 6);
  assert.deepEqual(entries.slice(0, 6), before.slice(0, 6).map(e => ({ ...e, itinerary_date: to })));
  assert.deepEqual(entries.slice(6), before.slice(6));
  assert.equal(entries.filter(e => e.trip_id === 1 && e.itinerary_date === to).length, 7);
  assert.equal(calls.filter(c => c.sql.includes('UPDATE trip_itinerary_items')).length, 1);
  assert.deepEqual(calls.find(c => c.sql.includes('UPDATE trip_itinerary_items')).params, [1, from, to]);
});
test('rejects same date, missing date and impossible calendar dates', async () => {
  reset();
  for (const to_date of [from, '', '2026-02-30', '2026-13-01', '2026-07-32']) {
    await assert.rejects(moveTripItineraryDate(10, 1, { from_date: from, to_date }), { statusCode: 400 });
  }
  assert.equal(calls.length, 0);
});
test('nonowner cannot bulk-move itinerary entries', async () => {
  reset(); const before = structuredClone(entries);
  await assert.rejects(moveTripItineraryDate(99, 1, { from_date: from, to_date: to }), { statusCode: 400 });
  assert.deepEqual(entries, before);
  assert.equal(calls.some(c => c.sql.includes('UPDATE trip_itinerary_items')), false);
});
test('stale or empty source day fails without changing other entries', async () => {
  reset(); const before = structuredClone(entries);
  await assert.rejects(moveTripItineraryDate(10, 1, { from_date: '2026-07-30', to_date: to }), /No itinerary entries/);
  assert.deepEqual(entries, before);
});

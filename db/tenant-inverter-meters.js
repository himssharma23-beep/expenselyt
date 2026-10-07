const postgres = require('./postgres');
const tenants = require('./postgres-tenants');

// Attribute each interval's usage to the month of its ending reading.
function monthlyUnits(readings = []) {
  const cents = {};
  for (const row of readings) {
    if (row.units_used == null) continue;
    const month = String(row.reading_date).slice(0, 7);
    cents[month] = (cents[month] || 0) + Math.round(Number(row.units_used) * 100);
  }
  return Object.fromEntries(Object.entries(cents).map(([month, value]) => [month, value / 100]));
}

function createStore({ query, withTransaction, ensureTenantTables }) {
  let ready;
  const invalid = message => Object.assign(new Error(message), { statusCode: 400 });
  async function ensure() {
    if (!ready) ready = (async () => {
      await ensureTenantTables();
      await query(`CREATE TABLE IF NOT EXISTS tenant_inverter_meters (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        building_id BIGINT NOT NULL REFERENCES tenant_buildings(id) ON DELETE CASCADE,
        tenant_id BIGINT REFERENCES tenant_records(id) ON DELETE CASCADE,
        name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await query(`CREATE TABLE IF NOT EXISTS tenant_inverter_meter_rooms (
        meter_id BIGINT NOT NULL REFERENCES tenant_inverter_meters(id) ON DELETE CASCADE,
        room_id BIGINT NOT NULL REFERENCES tenant_rooms(id) ON DELETE CASCADE,
        PRIMARY KEY (meter_id, room_id)
      )`);
      await query(`CREATE TABLE IF NOT EXISTS tenant_inverter_readings (
        id BIGSERIAL PRIMARY KEY,
        meter_id BIGINT NOT NULL REFERENCES tenant_inverter_meters(id) ON DELETE CASCADE,
        reading_date DATE NOT NULL, reading NUMERIC(14,2) NOT NULL CHECK (reading >= 0),
        note TEXT NOT NULL DEFAULT '', UNIQUE (meter_id, reading_date)
      )`);
    })().catch(err => { ready = null; throw err; });
    await ready;
  }
  async function ownedTenant(userId, tenantId, run = query) {
    const result = await run('SELECT id, room_id, building_id FROM tenant_records WHERE id = $1 AND user_id = $2', [tenantId, userId]);
    if (!result.rows[0]) throw invalid('Tenant not found');
    return result.rows[0];
  }
  function readingInput(data) {
    const date = String(data.reading_date || '');
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw invalid('Choose a valid reading date');
    const value = Number(data.reading);
    if (data.reading == null || String(data.reading).trim() === '' || !Number.isFinite(value) || value < 0 || value > 100000000 || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) throw invalid('Enter a non-negative reading with up to two decimal places');
    const note = String(data.note || '').trim();
    if (note.length > 500) throw invalid('Note must be 500 characters or fewer');
    return { date, value, note };
  }
  async function ownedBuilding(userId, buildingId, run = query) {
    const result = await run('SELECT id FROM tenant_buildings WHERE id = $1 AND user_id = $2', [buildingId, userId]);
    if (!result.rows[0]) throw invalid('Building not found');
    return result.rows[0];
  }
  async function list(userId, tenantId, buildingId = null) {
    await ensure();
    const tenant = buildingId == null ? await ownedTenant(userId, tenantId) : null;
    if (buildingId != null) await ownedBuilding(userId, buildingId);
    const result = await query(`SELECT m.*,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'room_label', r.room_label) ORDER BY r.room_label)
        FROM tenant_inverter_meter_rooms mr JOIN tenant_rooms r ON r.id = mr.room_id WHERE mr.meter_id = m.id), '[]'::jsonb) AS rooms,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'reading_date', x.reading_date, 'reading', x.reading,
        'units_used', x.units_used, 'note', x.note) ORDER BY x.reading_date DESC)
        FROM (SELECT ir.*, reading - LAG(reading) OVER (ORDER BY reading_date) AS units_used
          FROM tenant_inverter_readings ir WHERE ir.meter_id = m.id) x), '[]'::jsonb) AS readings
      FROM tenant_inverter_meters m WHERE m.user_id = $1 AND (($4::bigint IS NOT NULL AND m.building_id = $4) OR
        ($4::bigint IS NULL AND (m.tenant_id = $2 OR
        (m.tenant_id IS NULL AND EXISTS (SELECT 1 FROM tenant_inverter_meter_rooms mr WHERE mr.meter_id = m.id AND mr.room_id = $3)))))
      ORDER BY m.id DESC`, [userId, tenantId, tenant?.room_id || null, buildingId]);
    return result.rows.map(meter => ({ ...meter, monthly_units: monthlyUnits(meter.readings) }));
  }
  async function create(userId, tenantId, data, buildingId = null) {
    await ensure();
    const name = String(data.name || '').trim();
    if (!name || name.length > 100) throw invalid('Meter name is required (maximum 100 characters)');
    if (!['tenant', 'shared'].includes(data.scope)) throw invalid('Choose a tenant meter or shared room meter');
    const input = readingInput(data);
    return withTransaction(async client => {
      const run = client.query.bind(client);
      if (buildingId != null) await ownedBuilding(userId, buildingId, run);
      const assignedTenantId = buildingId == null ? tenantId : data.scope === 'tenant' ? data.tenant_id : null;
      const tenant = assignedTenantId != null ? await ownedTenant(userId, assignedTenantId, run) : null;
      if (data.scope === 'tenant' && !tenant) throw invalid('Select a tenant');
      if (tenant && buildingId != null && Number(tenant.building_id) !== Number(buildingId)) throw invalid('Select a tenant from this building');
      const targetBuilding = buildingId ?? tenant.building_id;
      const roomIds = [...new Set((Array.isArray(data.room_ids) ? data.room_ids : []).map(Number))];
      if (data.scope === 'shared') {
        if (!roomIds.length || roomIds.some(id => !Number.isSafeInteger(id) || id <= 0) || (tenant && !roomIds.includes(Number(tenant.room_id)))) throw invalid('Select this tenant’s room and any rooms sharing the meter, or select rooms for a building meter');
        const rooms = await run(`SELECT r.id FROM tenant_rooms r JOIN tenant_buildings b ON b.id = r.building_id
          WHERE r.id = ANY($1::bigint[]) AND r.building_id = $2 AND b.user_id = $3`, [roomIds, targetBuilding, userId]);
        if (rooms.rows.length !== roomIds.length) throw invalid('Select rooms from this building only');
      }
      const result = await run(`INSERT INTO tenant_inverter_meters (user_id, building_id, tenant_id, name)
        VALUES ($1, $2, $3, $4) RETURNING *`, [userId, targetBuilding, data.scope === 'tenant' ? assignedTenantId : null, name]);
      const meter = result.rows[0];
      if (data.scope === 'shared') await run('INSERT INTO tenant_inverter_meter_rooms (meter_id, room_id) SELECT $1, unnest($2::bigint[])', [meter.id, roomIds]);
      await run('INSERT INTO tenant_inverter_readings (meter_id, reading_date, reading, note) VALUES ($1, $2, $3, $4)', [meter.id, input.date, input.value, input.note]);
      return meter;
    });
  }
  async function addReading(userId, meterId, data) {
    await ensure();
    const input = readingInput(data);
    return withTransaction(async client => {
      const meter = await client.query('SELECT id FROM tenant_inverter_meters WHERE id = $1 AND user_id = $2 FOR UPDATE', [meterId, userId]);
      if (!meter.rows[0]) throw invalid('Meter not found');
      const latest = await client.query(`SELECT reading_date::text, reading FROM tenant_inverter_readings WHERE meter_id = $1 ORDER BY reading_date DESC LIMIT 1`, [meterId]);
      const prior = latest.rows[0];
      if (prior && input.date <= prior.reading_date) throw invalid('Choose a date after the latest reading');
      if (prior && input.value < Number(prior.reading)) throw invalid('Reading cannot be lower than the last reading. Add a new meter if it was replaced.');
      const result = await client.query('INSERT INTO tenant_inverter_readings (meter_id, reading_date, reading, note) VALUES ($1, $2, $3, $4) RETURNING *', [meterId, input.date, input.value, input.note]);
      return result.rows[0];
    });
  }
  return { list, create, addReading };
}

module.exports = { ...createStore({ ...postgres, ensureTenantTables: tenants.ensureTenantTables }), createStore, monthlyUnits };

const fs = require('fs');
const path = require('path');
const { query, withTransaction } = require('./postgres');
const { METHODS, error, validatePermissions } = require('../utils/capture-policy');
let ready;
function ensureSchema() {
  if (!ready) ready = query(fs.readFileSync(path.join(__dirname, 'transaction-capture.sql'), 'utf8')).catch(e => { ready = null; throw e; });
  return ready;
}
async function access(userId, client = null) {
  await ensureSchema();
  const { rows } = await (client || {query}).query(`SELECT u.role,u.is_active,u.deleted_at,p.permissions,p.preferences
    FROM users u LEFT JOIN transaction_capture_access p ON p.user_id=u.id WHERE u.id=$1`, [userId]);
  const row = rows[0];
  if (!row || !row.is_active || row.deleted_at) throw error('Account unavailable.', 403);
  return { permissions: Object.fromEntries(Object.keys(METHODS).map(k => [k, row.permissions?.[k] === true])),
    preferences: row.preferences || {}, role: row.role };
}
async function assertMethod(userId, method, consent = true, client = null) {
  if (!Object.hasOwn(METHODS, method)) throw error('Unknown capture method.');
  const result = await access(userId, client);
  if (!result.permissions[method]) throw error('Your administrator has not enabled ' + METHODS[method] + '.', 403);
  if (consent && !result.preferences[method]) throw error('Enable this capture method in your settings first.', 403);
  return result;
}
async function setPermissions(userId, permissions, adminId) {
  validatePermissions(permissions);
  await ensureSchema();
  await withTransaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [userId]);
    const user = await client.query('SELECT id FROM users WHERE id=$1 AND deleted_at IS NULL', [userId]);
    if (!user.rows.length) throw error('User not found.', 404);
    await client.query(`INSERT INTO transaction_capture_access(user_id,permissions,updated_by) VALUES($1,$2,$3)
      ON CONFLICT(user_id) DO UPDATE SET permissions=transaction_capture_access.permissions || $2::jsonb,updated_by=$3,updated_at=NOW()`, [userId, JSON.stringify(permissions), adminId]);
    await client.query('INSERT INTO transaction_capture_audit(user_id,admin_id,changes) VALUES($1,$2,$3)', [userId, adminId, JSON.stringify(permissions)]);
    for (const [key, enabled] of Object.entries(permissions)) {
      if (!enabled) {
        await client.query(`UPDATE transaction_capture_access SET preferences=preferences || jsonb_build_object($2::text,false) WHERE user_id=$1`, [userId, key]);
        await client.query('DELETE FROM transaction_capture_tokens WHERE user_id=$1 AND method=$2', [userId, key]);
        if (['email_gmail', 'email_outlook'].includes(key)) await client.query('DELETE FROM transaction_capture_mailboxes WHERE user_id=$1 AND method=$2', [userId, key]);
      }
    }
  });
  return access(userId);
}
async function setPreferences(userId, preferences) {
  validatePermissions(preferences);
  await ensureSchema();
  await withTransaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [userId]);
    const current = await access(userId,client);
    for (const [key, enabled] of Object.entries(preferences)) if (enabled && !current.permissions[key]) throw error('Method not enabled by administrator: ' + key, 403);
    await client.query(`INSERT INTO transaction_capture_access(user_id,preferences) VALUES($1,$2)
      ON CONFLICT(user_id) DO UPDATE SET preferences=transaction_capture_access.preferences || $2::jsonb,updated_at=NOW()`, [userId, JSON.stringify(preferences)]);
  });
  return access(userId);
}
module.exports = { ensureSchema, access, assertMethod, setPermissions, setPreferences, query, withTransaction };

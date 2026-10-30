// Optional discovery must never migrate tables or hold up core account access.
const { METHODS } = require('./capture-policy');
const disabled = () => ({ permissions: Object.fromEntries(Object.keys(METHODS).map(k => [k,false])), preferences: {} });
async function readAvailability(userId, runQuery = require('../db/postgres').query) {
  try {
    const { rows } = await runQuery({ text:'SELECT permissions,preferences FROM transaction_capture_access WHERE user_id=$1', query_timeout:1500 },[userId]);
    const row = rows[0];
    return { permissions:Object.fromEntries(Object.keys(METHODS).map(k => [k,row?.permissions?.[k] === true])), preferences:row?.preferences || {} };
  } catch (_) { return disabled(); }
}
module.exports = { readAvailability, disabled };

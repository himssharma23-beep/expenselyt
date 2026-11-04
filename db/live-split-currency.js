const {withTransaction} = require('./postgres');
let ready;
function ensureLiveSplitCurrencySchema() {
  if (!ready) ready = withTransaction(async client => {
    await client.query(`
      ALTER TABLE live_split_trips ADD COLUMN IF NOT EXISTS currency_code TEXT;
      ALTER TABLE live_split_groups ADD COLUMN IF NOT EXISTS currency_code TEXT;
      UPDATE live_split_trips t SET currency_code = COALESCE(NULLIF(upper(u.currency_code), ''), 'INR') FROM users u WHERE u.id=t.user_id AND t.currency_code IS NULL;
      UPDATE live_split_groups g SET currency_code = COALESCE(NULLIF(upper(u.currency_code), ''), 'INR') FROM users u WHERE u.id=g.user_id AND g.currency_code IS NULL;
      CREATE OR REPLACE FUNCTION snapshot_live_split_currency() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.currency_code IS NULL THEN
          SELECT COALESCE(NULLIF(upper(currency_code), ''), 'INR') INTO NEW.currency_code FROM users WHERE id=NEW.user_id;
        END IF;
        NEW.currency_code := COALESCE(NEW.currency_code, 'INR');
        RETURN NEW;
      END $$;
      DROP TRIGGER IF EXISTS snapshot_currency ON live_split_groups;
      CREATE TRIGGER snapshot_currency BEFORE INSERT ON live_split_groups FOR EACH ROW EXECUTE FUNCTION snapshot_live_split_currency();
      DROP TRIGGER IF EXISTS snapshot_currency ON live_split_trips;
      CREATE TRIGGER snapshot_currency BEFORE INSERT ON live_split_trips FOR EACH ROW EXECUTE FUNCTION snapshot_live_split_currency();
    `);
  }).catch(error => {ready=null;throw error;});
  return ready;
}
async function liveSplitWriteCurrency(client, userId, data, tripId=null) {
  if (tripId) {
    const result=await client.query('SELECT currency_code FROM live_split_trips WHERE id=$1',[tripId]);
    if (result.rows[0]?.currency_code) return result.rows[0].currency_code;
  }
  if (data.currency_code != null) {
    const code=String(data.currency_code).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) throw Object.assign(new Error('Invalid split currency'),{statusCode:400});
    return code;
  }
  const result=await client.query('SELECT currency_code FROM users WHERE id=$1',[userId]);
  return result.rows[0]?.currency_code || 'INR';
}
module.exports={ensureLiveSplitCurrencySchema,liveSplitWriteCurrency};

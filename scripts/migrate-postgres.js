const fs = require('fs');
const path = require('path');
try {
  require('fs').readFileSync('.env', 'utf8').split(/\r?\n/).forEach((line) => {
    const [key, ...rest] = line.split('=');
    if (key && !key.startsWith('#') && !process.env[key.trim()]) process.env[key.trim()] = rest.join('=').trim();
  });
} catch (_) {}
const { getPool } = require('../db/postgres');
const { isPostgresConfigured } = require('../db/provider');

async function main() {
  if (!isPostgresConfigured()) {
    console.error('Postgres is not configured. Set DATABASE_URL or PGHOST/PGUSER/PGDATABASE first.');
    process.exit(1);
  }

  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.postgres.sql'), 'utf8');
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log('Postgres schema applied successfully.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Postgres migration failed:', err.message);
  process.exit(1);
});

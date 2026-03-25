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

  const pool = getPool();
  const client = await pool.connect();
  try {
    const now = await client.query('SELECT NOW() AS now');
    const tables = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    console.log('Postgres connection OK');
    console.log('Server time:', now.rows[0].now);
    console.log('Tables:', tables.rows.map(r => r.table_name).join(', ') || '(none)');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Postgres check failed:', err.message);
  process.exit(1);
});

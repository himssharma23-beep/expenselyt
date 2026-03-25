function isPostgresConfigured() {
  return !!(
    (process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim()) ||
    (process.env.PGHOST && process.env.PGUSER && process.env.PGDATABASE)
  );
}

function assertPostgresConfigured() {
  if (!isPostgresConfigured()) {
    throw new Error('Postgres is required. Set DATABASE_URL or PGHOST/PGUSER/PGDATABASE.');
  }
}

function getDbProvider() {
  return 'postgres';
}

module.exports = {
  isPostgresConfigured,
  assertPostgresConfigured,
  getDbProvider,
};

function isPostgresConfigured() {
  return !!(
    (process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim()) ||
    (process.env.PGHOST && process.env.PGUSER && process.env.PGDATABASE)
  );
}

function getDbProvider() {
  return isPostgresConfigured() ? 'postgres' : 'sqlite';
}

module.exports = {
  isPostgresConfigured,
  getDbProvider,
};

# PostgreSQL Migration Notes

This app is currently implemented around a large SQLite-specific data layer in `db/database.js`.

## What is already added

- PostgreSQL runtime dependency in `package.json`
- PostgreSQL session-store dependency in `package.json`
- Connection helper in `db/postgres.js`
- Baseline target schema in `db/schema.postgres.sql`

## Why the migration is not a one-file swap

The current codebase relies on:

- `better-sqlite3` prepared statements and synchronous APIs
- SQLite-specific schema migration patterns using `PRAGMA table_info`
- SQLite-specific SQL such as:
  - `strftime(...)`
  - `datetime('now')`
  - `INSERT OR IGNORE`
  - `lastInsertRowid`
  - direct access to `sqlite_master`
- SQLite-backed sessions via `connect-sqlite3`
- direct raw DB usage from routes in addition to the central DB module

## Required migration steps

1. Switch runtime/session infrastructure from SQLite to Postgres.
2. Rewrite `db/database.js` from sync prepared statements to async Postgres queries.
3. Replace direct SQLite calls in `routes/api.js`.
4. Convert reporting/date queries from SQLite syntax to Postgres syntax.
5. Export/import existing SQLite data into Postgres.
6. Run full behavioral verification on planner, EMI, cards, recurring, tracker, admin, and AI usage flows.

## Recommendation

Do this as a staged migration, not a single blind conversion. The safest order is:

1. infrastructure
2. auth/users/plans
3. expenses/friends/split/trips
4. EMI/cards/banks/planner
5. recurring/tracker/admin/share/AI usage

## Environment variables for Postgres

Use either:

```env
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/expense_lite_ai
PGSSL=require
```

Or:

```env
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=postgres
PGPASSWORD=your-password
PGDATABASE=expense_lite_ai
PGSSL=require
```

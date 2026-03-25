# PostgreSQL Status

Expense Lite AI now runs on PostgreSQL-only runtime paths.

## Current state

- Sessions use `connect-pg-simple`
- Auth, admin, plans, subscriptions, access checks use Postgres
- Expenses, friends, loans, split, trips, shares use Postgres
- EMI, planner, credit cards, tracker, recurring, AI usage, and financial summary use Postgres
- The legacy local file-database module has been removed from the active app path

## Required environment

Use either:

```env
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/expense_lite_ai
PGSSL=require
```

or:

```env
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=postgres
PGPASSWORD=your-password
PGDATABASE=expense_lite_ai
PGSSL=require
```

## Operational commands

```bash
npm run check:postgres
npm run migrate:postgres
npm run build
```

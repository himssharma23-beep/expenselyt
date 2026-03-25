# Expense Lite AI

Personal finance app for expenses, loans, EMIs, cards, planning, reports, and AI-assisted lookup.

## Stack

- Node.js 20+
- Express
- PostgreSQL
- `express-session` + `connect-pg-simple`
- Vanilla HTML/CSS/JS
- React Native / Expo mobile client in the separate mobile repo

## Requirements

- Node.js 20+
- PostgreSQL 16+ recommended

## Environment

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

Also set:

```env
SESSION_SECRET=replace-me
JWT_SECRET=replace-me
ANTHROPIC_API_KEY=replace-me
```

## Setup

```bash
npm install
npm run migrate:postgres
npm run build
npm start
```

App URL:

```text
http://localhost:3000
```

## Database

The app now runs on PostgreSQL-only runtime paths.

Core schema is defined in:

- `db/schema.postgres.sql`

Primary Postgres modules:

- `db/postgres-auth.js`
- `db/postgres-core.js`
- `db/postgres-ops.js`
- `db/postgres-billing.js`
- `db/postgres-finance.js`

## Useful commands

```bash
npm run check:postgres
npm run migrate:postgres
npm run build
```

## Backups

- Database: use `pg_dump`
- Restore: use `psql` / `pg_restore`
- Uploaded profile pictures: back up `public/uploads/profile`

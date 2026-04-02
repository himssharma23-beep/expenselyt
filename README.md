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

For Google login, keep mobile and browser audiences separate:

```env
GOOGLE_ANDROID_CLIENT_ID=replace-me
GOOGLE_IOS_CLIENT_ID=replace-me

# Fallback browser client ID
GOOGLE_WEB_CLIENT_ID=replace-me

# Optional: use different browser IDs for localhost and production
GOOGLE_WEB_CLIENT_ID_LOCAL=replace-me
GOOGLE_WEB_CLIENT_ID_PROD=replace-me

# Optional: accept extra Google/Firebase token audiences on the backend
GOOGLE_OAUTH_CLIENT_IDS=id1.apps.googleusercontent.com,id2.apps.googleusercontent.com
```

Browser sign-in still requires the active site origin to be allowed in Google Cloud / Firebase:

- `http://localhost:3000` for local development
- `https://expenselyt.com` for production
- `https://www.expenselyt.com` if that hostname is used anywhere

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

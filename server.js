// ============================================================
// Server — Express + Session + SQLite
// ============================================================
// Load .env if present
try { require('fs').readFileSync('.env','utf8').split('\n').forEach(l=>{const[k,...v]=l.split('=');if(k&&!k.startsWith('#')&&!process.env[k.trim()])process.env[k.trim()]=v.join('=').trim();}); } catch(_){}
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const path = require('path');
const { requireAuth } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const { isPostgresConfigured, getDbProvider } = require('./db/provider');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure data directory exists
const fs = require('fs');
if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
if (!fs.existsSync('./public/uploads/profile')) fs.mkdirSync('./public/uploads/profile', { recursive: true });

// ─── CORS (for mobile app) ────────────────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ─── Middleware ───────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Session store: Postgres when configured, otherwise SQLite
let sessionStore;
if (isPostgresConfigured()) {
  const PgSession = require('connect-pg-simple')(session);
  const { getPool } = require('./db/postgres');
  sessionStore = new PgSession({
    pool: getPool(),
    tableName: process.env.PGSESSION_TABLE || 'user_sessions',
    createTableIfMissing: true,
  });
} else {
  const SQLiteStore = require('connect-sqlite3')(session);
  sessionStore = new SQLiteStore({ dir: './data', db: 'sessions.db' });
}

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'expense-manager-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    sameSite: 'lax',
  }
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// ─── Routes ──────────────────────────────────────────────────
app.use(authRoutes);
app.use('/api', apiRoutes);

// Landing page for guests, app for logged-in users
app.get('/', (req, res) => {
  if (req.session && req.session.userId) {
    return res.sendFile('app.html', { root: './views' });
  }
  res.sendFile('landing.html', { root: './views' });
});

// Public plans API — no auth required
app.get('/api/public/plans', (req, res) => {
  try {
    const db = require('./db/database');
    const plans = db.getPlans().filter(p => p.is_active);
    res.json({ plans });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public share page — no auth required
app.get('/s/:token', (req, res) => {
  res.sendFile('share.html', { root: './views' });
});

// Public share data API — no auth required
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    app: 'Expense Lite AI',
    db_provider: getDbProvider(),
    env: process.env.NODE_ENV || 'development',
    uptime_seconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.get('/privacy-policy', (req, res) => {
  res.sendFile('privacy.html', { root: './views' });
});

app.get('/terms-and-conditions', (req, res) => {
  res.sendFile('terms.html', { root: './views' });
});

app.get('/contact', (req, res) => {
  res.sendFile('contact.html', { root: './views' });
});

app.get('/api/public/share/:token', (req, res) => {
  try {
    const db = require('./db/database');
    const data = db.getPublicShareData(req.params.token);
    if (!data) return res.status(404).json({ error: 'Link not found or expired' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trip invite — redirect to app with invite token
app.get('/t/:token', (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect(`/?invite=${req.params.token}`);
  }
  res.redirect(`/login?invite=${req.params.token}`);
});

// Global error handler — always return JSON for /api, HTML for pages
app.use((err, req, res, next) => {
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
  res.status(500).send('Internal Server Error');
});

// ─── Start ───────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ┌──────────────────────────────────────────┐
  │                                          │
  │   💰 Expense Lite AI is running!         │
  │                                          │
  │   Open: http://localhost:${PORT}             │
  │                                          │
  └──────────────────────────────────────────┘
  `);
});

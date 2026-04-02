// ============================================================
// Server — Express + Session + Postgres
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
const { assertPostgresConfigured, getDbProvider } = require('./db/provider');
const pgDb = require('./db/postgres-auth');
const pgCoreDb = require('./db/postgres-core');
const { getPool } = require('./db/postgres');
const PgSession = require('connect-pg-simple')(session);
const { sendContactAckEmail, sendContactEmail, isEmailEnabled } = require('./utils/mailer');
const { verifyRecaptcha } = require('./utils/recaptcha');

const app = express();
const PORT = process.env.PORT || 3000;
assertPostgresConfigured();

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

const sessionStore = new PgSession({
  pool: getPool(),
  tableName: process.env.PGSESSION_TABLE || 'user_sessions',
  createTableIfMissing: true,
});

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

// Public plans API — no auth required
function getGoogleWebClientIdForRequest(req) {
  const hostname = String(req.hostname || '').trim().toLowerCase();
  const normalizedHostKey = hostname.replace(/[^a-z0-9]/gi, '_').replace(/^_+|_+$/g, '').toUpperCase();
  const hostSpecificKey = normalizedHostKey ? `GOOGLE_WEB_CLIENT_ID_${normalizedHostKey}` : '';
  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

  return (
    (hostSpecificKey && process.env[hostSpecificKey]) ||
    (isLocalHost && process.env.GOOGLE_WEB_CLIENT_ID_LOCAL) ||
    (!isLocalHost && process.env.GOOGLE_WEB_CLIENT_ID_PROD) ||
    process.env.GOOGLE_WEB_CLIENT_ID ||
    ''
  );
}

app.get('/runtime-config.js', (_req, res) => {
  res.type('application/javascript');
  res.send(
    `window.__appRuntimeConfig = ${JSON.stringify({
      gaMeasurementId: process.env.GA_MEASUREMENT_ID || '',
      googleWebClientId: getGoogleWebClientIdForRequest(_req),
    })};`
  );
});

app.get('/api/public/plans', (req, res) => {
  Promise.resolve(pgDb.getPlans()).then((plans) => {
    res.json({ plans: plans.filter((p) => p.is_active) });
  }).catch((err) => {
    res.status(500).json({ error: err.message });
  });
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
  const html = fs.readFileSync(path.join(__dirname, 'views', 'contact.html'), 'utf8')
    .replace(/__RECAPTCHA_SITE_KEY__/g, process.env.RECAPTCHA_SITE_KEY || '');
  res.send(html);
});

app.get('/api/public/share/:token', (req, res) => {
  Promise.resolve(pgCoreDb.getPublicShareData(req.params.token)).then((data) => {
    if (!data) return res.status(404).json({ error: 'Link not found or expired' });
    res.json(data);
  }).catch((err) => {
    res.status(500).json({ error: err.message });
  });
});

app.post('/api/public/contact', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const subject = String(req.body?.subject || '').trim();
    const message = String(req.body?.message || '').trim();
    const captchaToken = String(req.body?.captchaToken || '').trim();

    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: 'All fields are required.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email is required.' });
    }

    const captcha = await verifyRecaptcha(captchaToken, req.ip);
    if (captcha.enabled && !captcha.success) {
      return res.status(400).json({ error: 'Captcha verification failed. Please try again.' });
    }

    if (isEmailEnabled()) {
      await Promise.allSettled([
        sendContactEmail({ name, email, subject, message }),
        sendContactAckEmail({ to: email, name, subject }),
      ]);
    }

    res.json({ success: true, message: 'Your message has been sent successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

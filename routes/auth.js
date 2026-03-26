// ============================================================
// Auth Routes - Login / Register / Logout
// ============================================================
const express = require('express');
const router = express.Router();
const pgDb = require('../db/postgres-auth');
const { assertPostgresConfigured } = require('../db/provider');
const { guestOnly, requireAuth } = require('../middleware/auth');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'expense-manager-jwt-secret-change-in-prod';
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {
  sendAdminNewUserEmail,
  sendPasswordResetEmail,
  sendPhoneLoginHelpEmail,
  sendWelcomeEmail,
  isEmailEnabled,
} = require('../utils/mailer');

const REGION_TO_CURRENCY = {
  IN: 'INR', US: 'USD', GB: 'GBP', AE: 'AED', AU: 'AUD', CA: 'CAD', SG: 'SGD',
  JP: 'JPY', CN: 'CNY', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', IE: 'EUR',
};
const DEFAULT_LOCALE_BY_CURRENCY = {
  INR: 'en-IN', USD: 'en-US', GBP: 'en-GB', EUR: 'de-DE', AED: 'en-AE',
  AUD: 'en-AU', CAD: 'en-CA', SGD: 'en-SG', JPY: 'ja-JP', CNY: 'zh-CN',
};

function normalizeLocaleCode(locale) {
  const cleaned = String(locale || '').trim().replace(/_/g, '-');
  return /^[a-z]{2,3}(?:-[A-Z]{2})?$/i.test(cleaned) ? cleaned : null;
}

function normalizeCurrencyCode(code) {
  const cleaned = String(code || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(cleaned) ? cleaned : null;
}

function inferPreferences(req) {
  const explicitLocale = normalizeLocaleCode(req.body?.locale_code);
  const acceptLanguage = String(req.headers['accept-language'] || '').split(',')[0];
  const localeCode = explicitLocale || normalizeLocaleCode(acceptLanguage) || 'en-US';
  const region = localeCode.includes('-') ? localeCode.split('-')[1].toUpperCase() : '';
  const currencyCode = normalizeCurrencyCode(req.body?.currency_code) || REGION_TO_CURRENCY[region] || 'USD';
  return {
    currency_code: currencyCode,
    locale_code: DEFAULT_LOCALE_BY_CURRENCY[currencyCode] || localeCode,
  };
}

const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'profile');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    cb(null, `u${req.session?.userId || 'x'}_${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) return cb(new Error('Only image files are allowed'));
    cb(null, true);
  },
});

assertPostgresConfigured();

// GET /login
router.get('/login', guestOnly, (req, res) => {
  res.sendFile('login.html', { root: './views' });
});

// GET /register
router.get('/register', guestOnly, (req, res) => {
  res.sendFile('register.html', { root: './views' });
});

router.get('/forgot-password', guestOnly, (req, res) => {
  res.sendFile('forgot-password.html', { root: './views' });
});

// POST /api/auth/register
router.post('/api/auth/register', async (req, res) => {
  try {
    const authDb = pgDb;
    const { username, email, password, display_name } = req.body;

    if (!username || !email || !password || !display_name) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address' });

    if (await authDb.findUserByUsername(username)) return res.status(400).json({ error: 'Username already taken' });
    if (await authDb.findUserByEmail(email)) return res.status(400).json({ error: 'Email already registered' });

    const prefs = inferPreferences(req);
    const userId = await authDb.createUser(username, email, password, display_name, prefs);
    await authDb.assignSignupPlanToUser(userId);
    await Promise.allSettled([
      sendAdminNewUserEmail({ user: { display_name, username, email } }),
      sendWelcomeEmail({ to: email, name: display_name }),
    ]);
    req.session.userId = userId;
    req.session.displayName = display_name;

    const token = jwt.sign({ userId, displayName: display_name }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, redirect: '/', token, user: { id: userId, display_name, username, email, mobile: null, avatar_url: null, currency_code: prefs.currency_code, locale_code: prefs.locale_code } });
  } catch (err) {
    console.error('Register error:', err);
    if (err?.code === '23505') {
      if (String(err.constraint || '').includes('username')) {
        return res.status(400).json({ error: 'Username already taken' });
      }
      if (String(err.constraint || '').includes('email')) {
        return res.status(400).json({ error: 'Email already registered' });
      }
      return res.status(400).json({ error: 'That account information is already in use' });
    }
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/api/auth/forgot-password', guestOnly, async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }

    const user = await pgDb.findUserByEmail(email);
    if (user && isEmailEnabled()) {
      const token = await pgDb.createPasswordReset(user.id);
      const otpCode = await pgDb.generateOtp(user.id, 'password_reset', 'email');
      const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
      await sendPasswordResetEmail({
        to: user.email,
        name: user.display_name,
        resetCode: otpCode,
        resetLink: `${baseUrl}/reset-password?token=${token}`,
      });
    }

    res.json({ success: true, message: 'If that email exists, a reset email has been sent.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/auth/forgot-password/reset', guestOnly, async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const code = String(req.body?.code || '').trim();
    const password = String(req.body?.password || '');

    if (!email || !code || password.length < 6) {
      return res.status(400).json({ error: 'Email, reset code, and a new password are required.' });
    }

    const user = await pgDb.findUserByEmail(email);
    if (!user) return res.status(400).json({ error: 'Invalid email or reset code.' });

    const ok = await pgDb.useOtp(user.id, code, 'password_reset');
    if (!ok) return res.status(400).json({ error: 'Invalid or expired reset code.' });

    await pgDb.resetUserPassword(user.id, bcrypt.hashSync(password, 10));
    res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/auth/phone-login-help', guestOnly, async (req, res) => {
  try {
    const phone = String(req.body?.phone || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const name = String(req.body?.name || '').trim();
    const note = String(req.body?.note || '').trim();

    if (!phone || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Phone number and valid email are required.' });
    }

    if (isEmailEnabled()) {
      await sendPhoneLoginHelpEmail({ phone, email, name, note });
    }

    res.json({ success: true, message: 'Your request has been sent to the admin.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
router.post('/api/auth/login', async (req, res) => {
  try {
    const authDb = pgDb;
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Email or phone number and password required' });
    }

    let user = await authDb.findUserByUsername(username);
    if (!user) user = await authDb.findUserByEmail(username);
    if (!user) user = await authDb.findUserByMobile(username);

    if (!user || !authDb.verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email, phone number, or password' });
    }

    if (!user.currency_code || !user.locale_code) {
      const prefs = inferPreferences(req);
      user = await authDb.updateUserProfile(user.id, prefs);
    }

    req.session.userId = user.id;
    req.session.displayName = user.display_name;

    const token = jwt.sign({ userId: user.id, displayName: user.display_name }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, redirect: '/', token, user: { id: user.id, display_name: user.display_name, username: user.username, email: user.email, mobile: user.mobile || null, avatar_url: user.avatar_url || null, currency_code: user.currency_code, locale_code: user.locale_code } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/logout
router.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true, redirect: '/login' });
  });
});

// GET /api/auth/me
router.get('/api/auth/me', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  const user = await pgDb.findUserById(req.session.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json(user);
});

router.put('/api/auth/profile', requireAuth, async (req, res) => {
  try {
    const user = await pgDb.updateUserProfile(req.session.userId, req.body || {});
    req.session.displayName = user.display_name;
    res.json({ success: true, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body || {};
    await pgDb.changeUserPassword(req.session.userId, current_password, new_password);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/api/auth/profile', requireAuth, async (req, res) => {
  try {
    await pgDb.softDeleteUser(req.session.userId, req.session.userId);
    req.session.destroy(() => {
      res.json({ success: true, redirect: '/login' });
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/api/auth/profile-photo', requireAuth, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Photo file is required' });
    const avatarUrl = `/uploads/profile/${req.file.filename}`;
    const user = await pgDb.updateUserProfile(req.session.userId, { avatar_url: avatarUrl });
    req.session.displayName = user.display_name;
    res.json({ success: true, avatar_url: avatarUrl, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /reset-password - show reset form
router.get('/reset-password', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect('/login');
  try {
    const reset = await pgDb.getPasswordResetByToken(token);
    if (!reset) {
      return res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:80px"><h2>Link expired or invalid</h2><a href="/login">Back to login</a></body></html>`);
    }
    res.send(`<!DOCTYPE html><html><head><title>Reset Password</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:'DM Sans',sans-serif;background:#f5f6fa;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .box{background:#fff;border-radius:12px;padding:40px;width:360px;box-shadow:0 4px 24px #0001}
  h2{margin:0 0 24px;font-size:22px}
  input{width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px;box-sizing:border-box;margin-bottom:14px}
  button{width:100%;padding:11px;background:#145A3C;color:#fff;border:none;border-radius:6px;font-size:15px;cursor:pointer;font-weight:600}
  .msg{padding:10px;border-radius:6px;margin-bottom:14px;font-size:13px;display:none}</style></head>
  <body><div class="box"><h2>Set New Password</h2>
  <div id="msg" class="msg"></div>
  <input type="password" id="p1" placeholder="New password" required minlength="6">
  <input type="password" id="p2" placeholder="Confirm password" required>
  <button onclick="doReset()">Reset Password</button>
  <script>
  async function doReset(){
    const p1=document.getElementById('p1').value,p2=document.getElementById('p2').value;
    if(p1!==p2){showMsg('Passwords do not match','#FFF3CD');return;}
    if(p1.length<6){showMsg('Minimum 6 characters','#FFF3CD');return;}
    const r=await fetch('/api/reset-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'${token}',password:p1})});
    const d=await r.json();
    if(d.success){showMsg('Password reset! Redirecting...','#D4EDDA');setTimeout(()=>location.href='/login',1500);}
    else showMsg(d.error||'Error','#F8D7DA');
  }
  function showMsg(m,bg){const e=document.getElementById('msg');e.textContent=m;e.style.background=bg;e.style.display='block';}
  </script></div></body></html>`);
  } catch (_err) {
    res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:80px"><h2>Link expired or invalid</h2><a href="/login">Back to login</a></body></html>`);
  }
});

// POST /api/reset-password - process reset (no auth required)
router.post('/api/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password || password.length < 6) return res.status(400).json({ error: 'Invalid request' });
    const success = await pgDb.usePasswordReset(token, bcrypt.hashSync(password, 10));
    if (!success) return res.status(400).json({ error: 'Link expired or already used' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

// ============================================================
// API Routes — Expenses, Friends, Loans, Divide
// ============================================================
const express = require('express');
const router = express.Router();
const multer = require('multer');
const pgDb = require('../db/postgres-auth');
const pgCoreDb = require('../db/postgres-core');
const pgOpsDb = require('../db/postgres-ops');
const pgBillingDb = require('../db/postgres-billing');
const pgFinanceDb = require('../db/postgres-finance');
const { assertPostgresConfigured } = require('../db/provider');
const { requireAuth } = require('../middleware/auth');
const { normalizeMessagePayload, sendExpoPushNotifications } = require('../utils/push-notifications');
const {
  sendSplitShareEmailsToTargets,
  sendTripLinkedEmailToUser,
  sendTripFinalizedEmails,
  sendRecurringAppliedEmailForUser,
  sendTrackerExpenseAppliedEmailForUser,
} = require('../utils/user-email-events');

function normalizeFriendName(name) {
  const value = String(name || '').trim().replace(/\s+/g, ' ');
  if (!value) {
    const err = new Error('Friend name is required');
    err.statusCode = 400;
    throw err;
  }
  if (value.length > 80) {
    const err = new Error('Friend name must be 80 characters or fewer');
    err.statusCode = 400;
    throw err;
  }
  if (!/^[A-Za-z0-9 ]+$/.test(value)) {
    const err = new Error('Friend name can contain only letters, numbers, and spaces');
    err.statusCode = 400;
    throw err;
  }
  return value;
}

function parseBooleanFlag(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function parseAdminUserIdList(raw) {
  return [...new Set((Array.isArray(raw) ? raw : []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
}

function getCoreDb() {
  return pgCoreDb;
}

function getOpsDb() {
  return pgOpsDb;
}

function getBillingDb() {
  return pgBillingDb;
}

function getFinanceDb() {
  return pgFinanceDb;
}

assertPostgresConfigured();

// All API routes require auth
router.use(requireAuth);

// ─── EXPENSES ────────────────────────────────────────────────
router.get('/expenses', async (req, res) => {
  try {
    const coreDb = getCoreDb();
    // month can arrive as 'YYYY-MM' (mobile) or 'MM' (web) — normalise to 'MM'
    const rawMonth = req.query.month;
    const month = rawMonth && rawMonth.includes('-') ? rawMonth.split('-')[1] : rawMonth;
    const expenses = await Promise.resolve(coreDb.getExpenses(req.session.userId, {
      year: req.query.year === 'all' ? null : (req.query.year || (rawMonth && rawMonth.includes('-') ? rawMonth.split('-')[0] : null)),
      month,
      search: req.query.search,
      spendType: req.query.spendType,
    }));
    const total = expenses.reduce((s, e) => s + e.amount, 0);
    res.json({ expenses, total: Math.round(total * 100) / 100, count: expenses.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/expenses/categories', async (req, res) => {
  try {
    const categories = await Promise.resolve(getCoreDb().getExpenseCategories(req.session.userId));
    res.json({ categories });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/expenses', async (req, res) => {
  try {
    const coreDb = getCoreDb();
    const { item_name, category, amount, purchase_date, is_extra, bank_account_id } = req.body;
    if (!item_name || !amount || !purchase_date) return res.status(400).json({ error: 'Missing fields' });
    const id = await Promise.resolve(coreDb.addExpense(req.session.userId, { item_name, category, amount: parseFloat(amount), purchase_date, is_extra, bank_account_id }));
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/expenses/:id', async (req, res) => {
  try {
    const expense = await Promise.resolve(getCoreDb().getExpenseById(req.session.userId, req.params.id));
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    res.json({ expense });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/expenses/:id', async (req, res) => {
  try {
    const coreDb = getCoreDb();
    const { item_name, category, amount, purchase_date, is_extra, bank_account_id } = req.body;
    await Promise.resolve(coreDb.updateExpense(req.session.userId, req.params.id, { item_name, category, amount: parseFloat(amount), purchase_date, is_extra, bank_account_id }));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/expenses/:id', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().deleteExpense(req.session.userId, req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── FILE IMPORT ─────────────────────────────────────────────
const XLSX = require('xlsx');
const XlsxPopulate = require('xlsx-populate');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/expenses/import', upload.single('file'), async (req, res) => {
  try {
    const coreDb = getCoreDb();
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const text = req.file.buffer.toString('utf-8');
    const { mapping } = req.body;
    const map = JSON.parse(mapping);

    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return res.status(400).json({ error: 'File has no data rows' });

    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const rows = lines.slice(1).map(line => {
      const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const obj = {};
      headers.forEach((h, i) => obj[h] = vals[i] || '');
      return obj;
    });

    const expenses = rows.map(r => ({
      item_name: r[map.name] || '',
      amount: parseFloat((r[map.amount] || '0').replace(/[^0-9.-]/g, '')),
      purchase_date: parseImportDate(r[map.date] || ''),
      is_extra: map.isExtra ? ['yes','true','1','extra'].includes((r[map.isExtra]||'').toLowerCase()) : false,
    })).filter(e => e.item_name && e.amount > 0 && e.purchase_date);

    const count = await Promise.resolve(coreDb.bulkAddExpenses(req.session.userId, expenses));
    res.json({ success: true, imported: count, total: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper: run multer and catch its errors as JSON
function withUpload(req, res, next) {
  console.log('[withUpload] called for', req.method, req.originalUrl);
  upload.single('file')(req, res, (err) => {
    if (err) {
      console.error('[withUpload] multer error:', err.message);
      return res.status(400).json({ error: 'Upload error: ' + err.message });
    }
    console.log('[withUpload] multer ok, file:', req.file ? req.file.originalname : 'none');
    next();
  });
}

// Return sheet names — uses xlsx-populate which supports AES-encrypted xlsx
router.post('/expenses/import-excel/sheets', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const password = req.body.password || '';
    const opts = password ? { password } : {};
    const wb = await XlsxPopulate.fromDataAsync(req.file.buffer, opts);
    res.json({ sheets: wb.sheets().map(s => s.name()) });
  } catch (err) {
    const msg = err.message || '';
    if (msg.toLowerCase().includes('password') || msg.toLowerCase().includes('decrypt') || msg.toLowerCase().includes('encrypt')) {
      res.status(400).json({ error: 'Wrong password or file is corrupted.' });
    } else {
      res.status(500).json({ error: msg || 'Failed to read file' });
    }
  }
});

// Preview — parses Excel and returns rows without saving
router.post('/expenses/import-excel/preview', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const sheets = parseSheetParam(req.body.sheets);
    const { rows: expenses, skipped } = await parseExcelBuffer(req.file.buffer, sheets, req.body.password);
    res.json({ count: expenses.length, skipped, preview: expenses.slice(0, 10) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to parse file' });
  }
});

// Excel import — fixed column layout: B=Date, D=Description, E=Debit, F=Extras
router.post('/expenses/import-excel', withUpload, async (req, res) => {
  try {
    const coreDb = getCoreDb();
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const sheets = parseSheetParam(req.body.sheets);
    const { rows: expenses, skipped } = await parseExcelBuffer(req.file.buffer, sheets, req.body.password);
    if (expenses.length === 0) return res.status(400).json({ error: 'No valid rows found. Check the file format.' });
    const count = await Promise.resolve(coreDb.bulkAddExpenses(req.session.userId, expenses));
    res.json({ success: true, imported: count, total: expenses.length + skipped });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Import failed' });
  }
});

function parseSheetParam(param) {
  if (!param) return null;
  try { return JSON.parse(param); } catch { return [param]; }
}

async function parseExcelBuffer(buffer, sheetNames, password) {
  const opts = password ? { password } : {};
  const wb = await XlsxPopulate.fromDataAsync(buffer, opts);

  // Resolve which sheets to parse
  const allSheets = wb.sheets().map(s => s.name());
  const targets = (Array.isArray(sheetNames) && sheetNames.length > 0)
    ? sheetNames.filter(n => allSheets.includes(n))
    : [allSheets[0]];

  const expenses = [];
  let skipped = 0;

  for (const sheetName of targets) {
    const sheet = wb.sheet(sheetName);
    const usedRange = sheet.usedRange();
    if (!usedRange) continue;
    const lastRow = usedRange.endCell().rowNumber();

    for (let r = 2; r <= lastRow; r++) {
      const dateVal  = sheet.cell(r, 2).value();  // Col B
      const desc     = String(sheet.cell(r, 4).value() || '').trim();  // Col D
      const amtRaw   = sheet.cell(r, 5).value();  // Col E
      const extraVal = String(sheet.cell(r, 6).value() || '').trim().toUpperCase();  // Col F

      if (!desc) { skipped++; continue; }
      const amount = parseFloat(String(amtRaw).replace(/[^0-9.-]/g, '')) || 0;
      if (amount <= 0) { skipped++; continue; }
      const purchase_date = parseExcelDate(dateVal);
      if (!purchase_date) { skipped++; continue; }

      expenses.push({ item_name: desc, amount, purchase_date, is_extra: extraVal === 'Y' });
    }
  }
  return { rows: expenses, skipped };
}

async function parseCcExcelBuffer(buffer, sheetNames, password, defaultTxnDate) {
  const opts = password ? { password } : {};
  const wb = await XlsxPopulate.fromDataAsync(buffer, opts);
  const allSheets = wb.sheets().map(s => s.name());
  const targets = (Array.isArray(sheetNames) && sheetNames.length > 0)
    ? sheetNames.filter(n => allSheets.includes(n))
    : [allSheets[0]];

  const txns = [];
  let skipped = 0;

  const norm = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const headerAliases = {
    desc: ['thing', 'description', 'details', 'detail', 'item', 'particular', 'particulars', 'merchant', 'name', 'narration'],
    amount: ['amount', 'amt', 'debit', 'value', 'price'],
    date: ['date', 'txn date', 'transaction date', 'purchase date'],
  };
  const findCol = (headers, aliases) => headers.findIndex(h => aliases.includes(h));

  for (const sheetName of targets) {
    const sheet = wb.sheet(sheetName);
    const usedRange = sheet.usedRange();
    if (!usedRange) continue;
    const lastRow = usedRange.endCell().rowNumber();
    const lastCol = usedRange.endCell().columnNumber();

    let headerRow = 1;
    let descCol = -1, amountCol = -1, dateCol = -1;
    for (let r = 1; r <= Math.min(5, lastRow); r++) {
      const headers = Array.from({ length: lastCol }, (_, i) => norm(sheet.cell(r, i + 1).value()));
      const dCol = findCol(headers, headerAliases.desc);
      const aCol = findCol(headers, headerAliases.amount);
      if (dCol >= 0 && aCol >= 0) {
        headerRow = r;
        descCol = dCol + 1;
        amountCol = aCol + 1;
        dateCol = findCol(headers, headerAliases.date) + 1;
        break;
      }
    }
    if (descCol < 0 || amountCol < 0) {
      headerRow = 1;
      descCol = 1;
      amountCol = 2;
      dateCol = 0;
    }

    for (let r = headerRow + 1; r <= lastRow; r++) {
      const description = String(sheet.cell(r, descCol).value() || '').trim();
      const amtRaw = sheet.cell(r, amountCol).value();
      const amount = parseFloat(String(amtRaw).replace(/[^0-9.-]/g, '')) || 0;
      const txnDate = dateCol ? parseExcelDate(sheet.cell(r, dateCol).value()) : defaultTxnDate;
      if (!description || amount <= 0 || !txnDate) { skipped++; continue; }
      txns.push({ txn_date: txnDate, description, amount });
    }
  }

  return { rows: txns, skipped };
}

function parseExcelDate(val) {
  if (val === null || val === undefined || val === '') return null;
  // xlsx-populate returns JS Date for date-formatted cells
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return val.toISOString().split('T')[0];
  }
  // Excel numeric serial (rare with xlsx-populate but handle it)
  if (typeof val === 'number') {
    const d = XLSX.SSF.parse_date_code(val);
    if (d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }
  const str = String(val).trim();
  const MONS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  // DD-Mon-YY  e.g. "01-Mar-26"
  let m = str.match(/^(\d{1,2})[-\/]([A-Za-z]{3})[-\/](\d{2,4})$/);
  if (m) {
    const day  = m[1].padStart(2, '0');
    const mon  = MONS[m[2].toLowerCase()];
    if (!mon) return null;
    const year = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${year}-${String(mon).padStart(2,'0')}-${day}`;
  }
  // DD-MM-YYYY or DD/MM/YYYY
  m = str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  // YYYY-MM-DD
  m = str.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return null;
}

function parseImportDate(str) {
  if (!str) return null;
  // DD-MM-YYYY or DD/MM/YYYY
  let m = str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  // YYYY-MM-DD
  m = str.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  // Try Date parse
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return null;
}

// ─── FRIENDS ─────────────────────────────────────────────────
router.get('/friends', async (req, res) => {
  try {
    const friends = await Promise.resolve(getCoreDb().getFriends(req.session.userId));
    const netBalance = friends.reduce((s, f) => s + f.balance, 0);
    res.json({ friends, netBalance: Math.round(netBalance * 100) / 100 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/friends', async (req, res) => {
  try {
    const coreDb = getCoreDb();
    const id = await Promise.resolve(coreDb.addFriend(req.session.userId, normalizeFriendName(req.body.name)));
    res.json({ success: true, id });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.put('/friends/:id', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().updateFriend(req.session.userId, req.params.id, normalizeFriendName(req.body.name)));
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.put('/friends/:id/link-user', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().linkFriendToUser(req.session.userId, req.params.id, req.body?.linked_user_id || null));
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.delete('/friends/:id', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().deleteFriend(req.session.userId, req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/push/devices', async (req, res) => {
  try {
    const result = await Promise.resolve(pgDb.upsertPushDeviceToken(req.session.userId, req.body || {}));
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/push/devices', async (req, res) => {
  try {
    const removed = await Promise.resolve(pgDb.deactivatePushDeviceToken(req.session.userId, req.body?.token));
    res.json({ success: true, removed });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── LOAN TRANSACTIONS ──────────────────────────────────────
router.get('/loans/:friendId', async (req, res) => {
  try {
    const txns = await Promise.resolve(getCoreDb().getLoanTransactions(req.session.userId, req.params.friendId));
    const totalPaid = txns.reduce((s, t) => s + t.paid, 0);
    const totalReceived = txns.reduce((s, t) => s + t.received, 0);
    res.json({ transactions: txns, totalPaid, totalReceived, balance: Math.round((totalPaid - totalReceived)*100)/100 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/loans', async (req, res) => {
  try {
    const coreDb = getCoreDb();
    const { friend_id, txn_date, details, paid, received } = req.body;
    if (!friend_id || !details) return res.status(400).json({ error: 'Missing fields' });
    const id = await Promise.resolve(coreDb.addLoanTransaction(req.session.userId, { friend_id, txn_date, details, paid: parseFloat(paid)||0, received: parseFloat(received)||0 }));
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/loans/:id', async (req, res) => {
  try {
    const { txn_date, details, paid, received } = req.body;
    await Promise.resolve(getCoreDb().updateLoanTransaction(req.session.userId, req.params.id, { txn_date, details, paid: parseFloat(paid)||0, received: parseFloat(received)||0 }));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/loans/:id', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().deleteLoanTransaction(req.session.userId, req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DIVIDE EXPENSES ─────────────────────────────────────────
router.get('/divide', async (req, res) => {
  try {
    const groups = await Promise.resolve(getCoreDb().getDivideGroups(req.session.userId));
    res.json({ groups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/divide/:id', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().deleteDivideGroup(req.session.userId, req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(err.message === 'Not found' ? 404 : 500).json({ error: err.message });
  }
});

router.post('/divide', async (req, res) => {
  try {
    const { divide_date, details, paid_by, total_amount, splits, auto_loans, heading, session_id } = req.body;
    if (!details || !total_amount || !splits || splits.length === 0) return res.status(400).json({ error: 'Missing fields' });
    const id = await Promise.resolve(getCoreDb().addDivideGroup(req.session.userId, { divide_date, details, paid_by, total_amount: parseFloat(total_amount), splits, auto_loans, heading, session_id }));
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/divide/share-session', async (req, res) => {
  try {
    const result = await Promise.resolve(
      getCoreDb().syncDivideSessionShares(req.session.userId, req.body?.session_key, req.body?.friend_ids || [])
    );
    const targetUserIds = Array.isArray(result?.target_user_ids) ? result.target_user_ids : [];
    if (targetUserIds.length) {
      sendSplitShareEmailsToTargets(req.session.userId, targetUserIds, req.body?.session_key).catch(() => {});
    }
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.get('/divide/shared', async (req, res) => {
  try {
    const groups = await Promise.resolve(getCoreDb().getReceivedDivideShares(req.session.userId));
    res.json({ groups });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/divide/shared/hide', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().hideReceivedDivideShare(req.session.userId, req.body?.owner_user_id, req.body?.session_key));
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ─── DASHBOARD ───────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const userId = req.session.userId;
    const year = req.query.year || new Date().getFullYear();
    const dashboard = await Promise.resolve(getCoreDb().getDashboardData(userId, year));
    res.json(dashboard);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── FRIEND EXCEL IMPORT ─────────────────────────────────────

// Load sheets + header row from each sheet
router.post('/friends/import-excel/sheets', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const opts = req.body.password ? { password: req.body.password } : {};
    const wb = await XlsxPopulate.fromDataAsync(req.file.buffer, opts);
    const sheets = wb.sheets().map(s => {
      const headers = [];
      for (let c = 1; c <= 15; c++) {
        const v = s.cell(1, c).value();
        if (v !== null && v !== undefined && v !== '') headers.push({ col: c, name: String(v).trim() });
      }
      return { name: s.name(), headers };
    });
    console.log('[friend-import] sheets:', sheets.map(s => `${s.name}(${s.headers.length} headers)`).join(', '));
    res.json({ sheets });
  } catch (err) {
    const msg = err.message || '';
    if (msg.toLowerCase().includes('password') || msg.toLowerCase().includes('decrypt'))
      return res.status(400).json({ error: 'Wrong password or file is corrupted.' });
    res.status(500).json({ error: msg });
  }
});

// Preview rows for one sheet
router.post('/friends/import-excel/preview', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const opts = req.body.password ? { password: req.body.password } : {};
    const mapping = JSON.parse(req.body.mapping);
    const sheetName = req.body.sheet;
    const wb = await XlsxPopulate.fromDataAsync(req.file.buffer, opts);
    const ws = wb.sheet(sheetName) || wb.sheet(0);
    const { rows, skipped } = parseFriendSheet(ws, mapping);
    res.json({ count: rows.length, skipped, preview: rows.slice(0, 10) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Import selected sheets — each sheet = one friend
router.post('/friends/import-excel', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const opts = req.body.password ? { password: req.body.password } : {};
    const mapping = JSON.parse(req.body.mapping);
    const sheetNames = JSON.parse(req.body.sheets);
    const wb = await XlsxPopulate.fromDataAsync(req.file.buffer, opts);
    const coreDb = getCoreDb();
    const allFriends = await Promise.resolve(coreDb.getFriends(req.session.userId));
    const results = [];
    let totalImported = 0;

    for (const sheetName of sheetNames) {
      const ws = wb.sheet(sheetName);
      if (!ws) continue;
      const { rows } = parseFriendSheet(ws, mapping);

      // Find or create friend by sheet name
      let friend = allFriends.find(f => f.name.toLowerCase() === sheetName.toLowerCase());
      if (!friend) {
        const id = await Promise.resolve(coreDb.addFriend(req.session.userId, sheetName));
        friend = { id };
      }

      for (const t of rows) {
        await Promise.resolve(coreDb.addLoanTransaction(req.session.userId, { friend_id: friend.id, txn_date: t.txn_date, details: t.details, paid: t.paid, received: t.received }));
      }
      results.push({ sheet: sheetName, imported: rows.length });
      totalImported += rows.length;
    }
    res.json({ success: true, totalImported, results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function parseFriendSheet(ws, mapping) {
  const usedRange = ws.usedRange();
  if (!usedRange) return { rows: [], skipped: 0 };
  const lastRow = usedRange.endCell().rowNumber();
  const rows = []; let skipped = 0;
  for (let r = 2; r <= lastRow; r++) {
    const details  = String(ws.cell(r, mapping.details).value()  || '').trim();
    const dateVal  = ws.cell(r, mapping.date).value();
    const paid     = parseFloat(String(ws.cell(r, mapping.paid).value()     || 0).replace(/[^0-9.-]/g, '')) || 0;
    const received = parseFloat(String(ws.cell(r, mapping.received).value() || 0).replace(/[^0-9.-]/g, '')) || 0;
    if (!details) { skipped++; continue; }
    const txn_date = parseExcelDate(dateVal);
    if (!txn_date) { skipped++; continue; }
    if (paid === 0 && received === 0) { skipped++; continue; }
    rows.push({ txn_date, details, paid, received });
  }
  return { rows, skipped };
}

// ─── REPORTS ─────────────────────────────────────────────────
// Year-wise summary
router.get('/reports/years', async (req, res) => {
  try {
    const rows = await Promise.resolve(getCoreDb().getReportYears(req.session.userId));
    res.json({ rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Month-wise summary for a year
router.get('/reports/months', async (req, res) => {
  try {
    const year = req.query.year;
    const rows = await Promise.resolve(getCoreDb().getReportMonths(req.session.userId, year));
    res.json({ rows, year });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── TRIPS ───────────────────────────────────────────────────
router.get('/trips', async (req, res) => {
  try { res.json({ trips: await Promise.resolve(getCoreDb().getTrips(req.session.userId)) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/trips', async (req, res) => {
  try {
    const { name, start_date, end_date, members } = req.body;
    if (!name || !start_date) return res.status(400).json({ error: 'Name and start date required' });
    const id = await Promise.resolve(getCoreDb().createTrip(req.session.userId, { name, start_date, end_date, members: members || [] }));
    for (const member of (members || [])) {
      if (member?.linked_user_id) {
        sendTripLinkedEmailToUser(req.session.userId, id, member.linked_user_id, member.permission || 'edit').catch(() => {});
      }
    }
    res.json({ success: true, id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/trips/:id', async (req, res) => {
  try {
    const trip = await Promise.resolve(getCoreDb().getTripById(req.session.userId, req.params.id));
    if (!trip) return res.status(404).json({ error: 'Not found' });
    res.json({ trip });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/trips/:id', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().updateTrip(req.session.userId, req.params.id, req.body));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/trips/:id', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().deleteTrip(req.session.userId, req.params.id));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/trips/:id/expenses', async (req, res) => {
  try {
    const { paid_by_key, paid_by_name, details, amount, expense_date, split_mode, splits } = req.body;
    if (!details || !amount || !splits || splits.length === 0) return res.status(400).json({ error: 'Missing fields' });
    const id = await Promise.resolve(getCoreDb().addTripExpense(req.session.userId, req.params.id, { paid_by_key, paid_by_name, details, amount: parseFloat(amount), expense_date, split_mode, splits }));
    res.json({ success: true, id });
  } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.put('/trips/:id/expenses/:eid', async (req, res) => {
  try {
    const { paid_by_key, paid_by_name, details, amount, expense_date, split_mode, splits } = req.body;
    await Promise.resolve(getCoreDb().updateTripExpense(req.session.userId, req.params.eid, { paid_by_key, paid_by_name, details, amount: parseFloat(amount), expense_date, split_mode, splits }));
    res.json({ success: true });
  } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.delete('/trips/:id/expenses/:eid', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().deleteTripExpense(req.session.userId, req.params.eid));
    res.json({ success: true });
  } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.post('/trips/:id/finalize', async (req, res) => {
  try {
    const result = await Promise.resolve(getCoreDb().finalizeTrip(req.session.userId, req.params.id, {
      is_extra: !!req.body?.is_extra,
      txn_date: req.body?.txn_date,
      category: req.body?.category,
      friend_ids: req.body?.friend_ids || {},
    }));
    sendTripFinalizedEmails(req.session.userId, req.params.id).catch(() => {});
    res.json(result || { success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.put('/trips/:id/members/:mid/lock', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().toggleMemberLock(req.session.userId, req.params.mid));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/trips/:id/members/:mid/link', async (req, res) => {
  try {
    const { linked_user_id, permission } = req.body;
    await Promise.resolve(getCoreDb().linkTripMember(req.session.userId, req.params.mid, linked_user_id || null, permission || 'edit'));
    if (linked_user_id) {
      sendTripLinkedEmailToUser(req.session.userId, req.params.id, linked_user_id, permission || 'edit').catch(() => {});
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/trips/:id/invite/:mid', async (req, res) => {
  try {
    const token = await Promise.resolve(getCoreDb().createTripInvite(req.session.userId, req.params.id, req.params.mid));
    res.json({ success: true, token });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/trips/invite/:token', async (req, res) => {
  try {
    const invite = await Promise.resolve(getCoreDb().getTripInviteByToken(req.params.token));
    if (!invite) return res.status(404).json({ error: 'Invalid invite' });
    res.json({ invite });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/trips/invite/:token/accept', async (req, res) => {
  try {
    const tripId = await Promise.resolve(getCoreDb().acceptTripInvite(req.session.userId, req.params.token));
    res.json({ success: true, tripId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── USER SEARCH ─────────────────────────────────────────────
router.get('/users/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ users: [] });
    res.json({ users: await Promise.resolve(getCoreDb().searchUsers(q, req.session.userId)) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── SHARE LINKS ─────────────────────────────────────────────
router.get('/shares', async (req, res) => {
  try { res.json({ links: await Promise.resolve(getCoreDb().getShareLinks(req.session.userId)) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/shares', async (req, res) => {
  try {
    const token = await Promise.resolve(getCoreDb().createShareLink(req.session.userId, req.body));
    res.json({ success: true, token });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/shares/:id', async (req, res) => {
  try {
    await Promise.resolve(getCoreDb().deleteShareLink(req.session.userId, req.params.id));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── EMI ROUTES ──────────────────────────────────────────────
router.get('/emi/records', async (req, res) => {
  try { res.json({ records: await Promise.resolve(getFinanceDb().getEmiRecords(req.session.userId, parseInt(req.query.for_friend) || 0)) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/emi/records', async (req, res) => {
  try {
    const id = await Promise.resolve(getFinanceDb().saveEmiRecord(req.session.userId, req.body));
    res.json({ success: true, id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/emi/records/:id', async (req, res) => {
  try {
    const record = await Promise.resolve(getFinanceDb().getEmiRecord(req.session.userId, req.params.id));
    if (!record) return res.status(404).json({ error: 'Not found' });
    res.json({ record });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/emi/records/:id', async (req, res) => {
  try { await Promise.resolve(getFinanceDb().updateEmiRecord(req.session.userId, req.params.id, req.body)); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/emi/records/:id', async (req, res) => {
  try { await Promise.resolve(getFinanceDb().deleteEmiRecord(req.session.userId, req.params.id)); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/emi/records/:id/activate', async (req, res) => {
  try {
    const { start_date, add_expenses, expense_type, expense_category } = req.body;
    if (!start_date) return res.status(400).json({ error: 'start_date required' });
    await Promise.resolve(getFinanceDb().activateEmi(
      req.session.userId,
      req.params.id,
      start_date,
      parseBooleanFlag(add_expenses, false),
      parseInt(expense_type) || 0,
      expense_category
    ));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/emi/installments/:id/pay', async (req, res) => {
  try {
    const { paid_amount, paid_date, notes, bank_account_id } = req.body;
    await Promise.resolve(getFinanceDb().payInstallment(req.session.userId, req.params.id, parseFloat(paid_amount) || 0, paid_date, notes, bank_account_id || null));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/emi/installments/:id/amount', async (req, res) => {
  try {
    const { emi_amount } = req.body;
    if (!emi_amount || emi_amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    await Promise.resolve(getFinanceDb().updateInstallmentAmount(req.session.userId, req.params.id, parseFloat(emi_amount)));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/emi/installments/:id/components', async (req, res) => {
  try {
    const { emi_amount, interest_component, principal_component } = req.body;
    if (!emi_amount || emi_amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    await Promise.resolve(getFinanceDb().updateInstallmentComponents(req.session.userId, req.params.id, {
      emi_amount: parseFloat(emi_amount),
      interest_component: parseFloat(interest_component) || 0,
      principal_component: parseFloat(principal_component) || 0
    }));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/emi/records/:id/bulk-amount', async (req, res) => {
  try {
    const { emi_amount } = req.body;
    if (!emi_amount || emi_amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    await Promise.resolve(getFinanceDb().bulkUpdateInstallmentAmount(req.session.userId, req.params.id, parseFloat(emi_amount)));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/emi/records/:id/activate-with-schedule', async (req, res) => {
  try {
    const { start_date, schedule, add_expenses, expense_type, expense_category } = req.body;
    if (!start_date) return res.status(400).json({ error: 'start_date required' });
    if (!Array.isArray(schedule) || schedule.length === 0) return res.status(400).json({ error: 'schedule required' });
    await Promise.resolve(getFinanceDb().activateEmiWithSchedule(
      req.session.userId,
      req.params.id,
      start_date,
      schedule,
      parseBooleanFlag(add_expenses, false),
      parseInt(expense_type) || 0,
      expense_category
    ));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/emi/records/:id/add-expenses', async (req, res) => {
  try {
    const expense_type = parseInt(req.body?.expense_type) || 0;
    await Promise.resolve(getFinanceDb().addEmiExpensesManual(req.session.userId, req.params.id, expense_type, req.body?.expense_category));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/emi/records/:id/add-credit-card', async (req, res) => {
  try {
    const credit_card_id = parseInt(req.body?.credit_card_id) || 0;
    const gst_month_offset = parseInt(req.body?.gst_month_offset) || 0;
    if (!credit_card_id) return res.status(400).json({ error: 'credit_card_id required' });
    await Promise.resolve(getFinanceDb().addEmiToCreditCardManual(req.session.userId, req.params.id, credit_card_id, gst_month_offset));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Return sheet names for EMI Excel
router.post('/emi/import-excel/sheets', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const password = req.body.password || '';
    const opts = password ? { password } : {};
    const wb = await XlsxPopulate.fromDataAsync(req.file.buffer, opts);
    res.json({ sheets: wb.sheets().map(s => s.name()) });
  } catch (err) {
    const msg = err.message || '';
    if (msg.toLowerCase().includes('password') || msg.toLowerCase().includes('decrypt') || msg.toLowerCase().includes('encrypt')) {
      res.status(400).json({ error: 'Wrong password or file is corrupted.' });
    } else {
      res.status(500).json({ error: msg || 'Failed to read file' });
    }
  }
});

// Return column headers from a specific sheet for mapping UI
router.post('/emi/import-excel/headers', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const sheetName = req.body.sheet || null;
    const password  = req.body.password || '';
    const opts = password ? { password } : {};
    const wb    = await XlsxPopulate.fromDataAsync(req.file.buffer, opts);
    const sheet = sheetName ? (wb.sheet(sheetName) || wb.sheets()[0]) : wb.sheets()[0];
    const usedRange = sheet.usedRange();
    if (!usedRange) return res.json({ columns: [] });
    const lastCol = usedRange.endCell().columnNumber();
    // Row 3 = column headers, row 4 = first data sample
    const columns = [];
    for (let c = 1; c <= Math.min(lastCol, 30); c++) {
      const letter = _emiColLetter(c);
      const hVal   = sheet.cell(3, c).value();
      const sVal   = sheet.cell(4, c).value();
      const header = String(hVal !== null && hVal !== undefined ? hVal : '').trim() || letter;
      const sample = String(sVal !== null && sVal !== undefined ? sVal : '').trim();
      if (header !== letter || sample) columns.push({ col: c, letter, header, sample });
    }
    res.json({ columns });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

function _emiColLetter(n) {
  let s = '';
  while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
  return s;
}

// Preview EMI Excel — multiple sheets + column mapping
router.post('/emi/import-excel/preview', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const sheets   = parseSheetParam(req.body.sheets);
    const password = req.body.password || '';
    const mapping  = req.body.mapping ? JSON.parse(req.body.mapping) : null;
    const sheetList = sheets && sheets.length > 0 ? sheets : [null];
    const results = [], errors = [];
    for (const sn of sheetList) {
      try {
        results.push({ sheet: sn, ...await parseEmiExcel(req.file.buffer, sn, password, mapping) });
      } catch (e) { errors.push({ sheet: sn, error: e.message }); }
    }
    res.json({ results, errors });
  } catch (err) { res.status(400).json({ error: err.message || 'Failed to parse file' }); }
});

// Import EMI from Excel — multiple sheets + column mapping
router.post('/emi/import-excel', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const sheets      = parseSheetParam(req.body.sheets);
    const password    = req.body.password || '';
    const mapping     = req.body.mapping ? JSON.parse(req.body.mapping) : null;
    const forFriend   = parseInt(req.body.for_friend) || 0;
    const friendName  = req.body.friend_name || null;
    const sheetList = sheets && sheets.length > 0 ? sheets : [null];
    const imported = [], errors = [];
    for (const sn of sheetList) {
      try {
        const { emiData, installments } = await parseEmiExcel(req.file.buffer, sn, password, mapping);
        emiData.for_friend  = forFriend;
        emiData.friend_name = friendName;
        const r = await Promise.resolve(getFinanceDb().importEmiFromExcel(req.session.userId, emiData, installments));
        imported.push({ sheet: sn, id: r.id, name: emiData.name });
      } catch (e) { errors.push({ sheet: sn, error: e.message }); }
    }
    if (imported.length === 0) return res.status(400).json({ error: errors[0]?.error || 'Import failed', errors });
    res.json({ success: true, imported: imported.length, details: imported, errors });
  } catch (err) { res.status(400).json({ error: err.message || 'Import failed' }); }
});

// Simple import — user provides loan amount; we infer the rate from the installment rows
router.post('/emi/import-excel/simple-preview', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const sheets     = parseSheetParam(req.body.sheets);
    const password   = req.body.password || '';
    const loanAmount = parseFloat(req.body.loan_amount);
    const loanAmounts = parseSimpleLoanAmounts(req.body.loan_amounts);
    const dateCol    = parseInt(req.body.date_col) || 2;
    const srCol      = parseInt(req.body.sr_col)   || 0;
    const totalCol   = parseInt(req.body.total_col) || 0;
    const paidCol    = parseInt(req.body.paid_col)  || 0;
    const sheetList = sheets && sheets.length > 0 ? sheets : [null];
    const results = [], errors = [];
    for (const sn of sheetList) {
      try {
        const sheetLoanAmount = resolveSimpleLoanAmount(sn, loanAmount, loanAmounts);
        results.push({ sheet: sn, ...await parseEmiSimple(req.file.buffer, sn, password, sheetLoanAmount, dateCol, srCol, totalCol, paidCol) });
      } catch (e) { errors.push({ sheet: sn, error: e.message }); }
    }
    res.json({ results, errors });
  } catch (err) { res.status(400).json({ error: err.message || 'Failed' }); }
});

router.post('/emi/import-excel/simple', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const sheets     = parseSheetParam(req.body.sheets);
    const password   = req.body.password || '';
    const loanAmount = parseFloat(req.body.loan_amount);
    const loanAmounts = parseSimpleLoanAmounts(req.body.loan_amounts);
    const dateCol    = parseInt(req.body.date_col) || 2;
    const srCol      = parseInt(req.body.sr_col)   || 0;
    const totalCol   = parseInt(req.body.total_col) || 0;
    const paidCol    = parseInt(req.body.paid_col)  || 0;
    const forFriend  = parseInt(req.body.for_friend) || 0;
    const friendName = req.body.friend_name || null;
    const sheetList = sheets && sheets.length > 0 ? sheets : [null];
    const imported = [], errors = [];
    for (const sn of sheetList) {
      try {
        const sheetLoanAmount = resolveSimpleLoanAmount(sn, loanAmount, loanAmounts);
        const { emiData, installments } = await parseEmiSimple(req.file.buffer, sn, password, sheetLoanAmount, dateCol, srCol, totalCol, paidCol);
        emiData.for_friend  = forFriend;
        emiData.friend_name = friendName;
        const r = await Promise.resolve(getFinanceDb().importEmiFromExcel(req.session.userId, emiData, installments));
        imported.push({ sheet: sn, id: r.id, name: emiData.name });
      } catch (e) { errors.push({ sheet: sn, error: e.message }); }
    }
    if (imported.length === 0) return res.status(400).json({ error: errors[0]?.error || 'Import failed', errors });
    res.json({ success: true, imported: imported.length, details: imported, errors });
  } catch (err) { res.status(400).json({ error: err.message || 'Import failed' }); }
});

async function parseEmiSimple(buffer, sheetName, password, loanAmount, dateCol, srCol, totalCol, paidCol) {
  const opts  = password ? { password } : {};
  const wb    = await XlsxPopulate.fromDataAsync(buffer, opts);
  const sheet = sheetName ? (wb.sheet(sheetName) || wb.sheets()[0]) : wb.sheets()[0];
  const usedRange = sheet.usedRange();
  if (!usedRange) throw new Error(`Sheet "${sheetName || 'Sheet1'}" is empty`);
  const lastRow = usedRange.endCell().rowNumber();

  // EMI name from row 1
  let emiName = '';
  for (let c = 1; c <= 10; c++) {
    const v = sheet.cell(1, c).value();
    if (v && String(v).trim()) { emiName = String(v).trim(); break; }
  }
  if (!emiName) emiName = sheetName || 'Imported EMI';
  emiName = normalizeImportedEmiName(emiName, loanAmount);

  // Detect data start row: scan from row 4, skip empty/header rows
  let dataStartRow = 4;
  for (let r = 4; r <= Math.min(12, lastRow); r++) {
    const dv = sheet.cell(r, dateCol).value();
    if (dv === null || dv === undefined || dv === '') continue;
    const ds = String(dv).trim().toLowerCase();
    if (ds === 'date' || /^(sr\.?\s*no|total|amount)/i.test(ds)) continue;
    dataStartRow = r;
    break;
  }

  // Collect date rows
  const rows = [];
  for (let r = dataStartRow; r <= lastRow; r++) {
    if (srCol > 0) {
      const sv = sheet.cell(r, srCol).value();
      if (sv === null || sv === undefined || sv === '') continue;
      const ss = String(sv).trim().toLowerCase();
      if (/^(total|sr\.?\s*no|amount left)/i.test(ss)) continue;
      if (isNaN(parseInt(sv))) continue;
    }
    const dateVal = sheet.cell(r, dateCol).value();
    const dueDate = parseExcelDate(dateVal);
    if (!dueDate) continue;
    const total = totalCol > 0 ? (parseFloat(sheet.cell(r, totalCol).value()) || 0) : 0;
    const paid = paidCol > 0 ? (parseFloat(sheet.cell(r, paidCol).value()) || 0) : 0;
    const scheduled = total > 0 ? total : paid;
    if (scheduled <= 0) continue;
    rows.push({ dueDate, total: scheduled, paid });
  }
  if (rows.length === 0) throw new Error(`No valid date rows found in "${sheetName || 'Sheet1'}"`);

  const rRate = inferMonthlyRateFromPayments(loanAmount, rows.map(r => r.total));
  const annualRate = Math.round(rRate * 12 * 100 * 100) / 100;

  let bal = Math.round(loanAmount * 100) / 100;
  const installments = rows.map((row, idx) => {
    const interest  = Math.round(bal * rRate * 100) / 100;
    let   principal = Math.round((row.total - interest) * 100) / 100;
    if (idx === rows.length - 1 || principal > bal) principal = Math.round(bal * 100) / 100;
    if (principal < 0) throw new Error(`Unable to derive a valid amortization from "${sheetName || 'Sheet1'}". Check the loan amount, Total column, and Total Paid column.`);
    const total     = Math.round((principal + interest) * 100) / 100;
    bal = Math.max(0, Math.round((bal - principal) * 100) / 100);
    return {
      installment_no:      idx + 1,
      due_date:            row.dueDate,
      principal_component: principal,
      interest_component:  interest,
      gst_amount:          0,
      emi_amount:          total,
      paid_amount:         row.paid,
    };
  });

  if (bal > 1) {
    throw new Error(`Calculated balance did not close for "${sheetName || 'Sheet1'}". Check the loan amount, Total column, and Total Paid column.`);
  }

  return {
    emiData: { name: emiName, annual_rate: annualRate, gst_rate: 0, start_date: installments[0].due_date },
    installments,
  };
}

function inferMonthlyRateFromPayments(principal, payments) {
  const validPayments = payments.map(p => Math.round((parseFloat(p) || 0) * 100) / 100).filter(p => p > 0);
  if (!principal || principal <= 0 || validPayments.length === 0) return 0;

  const totalPaid = validPayments.reduce((s, p) => s + p, 0);
  if (totalPaid <= principal) return 0;

  const remainingBalance = (rate) => {
    let bal = principal;
    for (let i = 0; i < validPayments.length; i++) {
      const interest = bal * rate;
      const principalPaid = validPayments[i] - interest;
      bal -= principalPaid;
    }
    return bal;
  };

  let low = 0;
  let high = 0.5;
  let balLow = remainingBalance(low);
  let balHigh = remainingBalance(high);
  let guard = 0;
  while (balLow * balHigh > 0 && guard < 40) {
    high *= 1.5;
    balHigh = remainingBalance(high);
    guard++;
  }

  if (balLow * balHigh > 0) return 0;

  for (let i = 0; i < 80; i++) {
    const mid = (low + high) / 2;
    const bal = remainingBalance(mid);
    if (Math.abs(bal) < 0.0001) return mid;
    if (balLow * bal > 0) {
      low = mid;
      balLow = bal;
    } else {
      high = mid;
      balHigh = bal;
    }
  }
  return (low + high) / 2;
}

function parseSimpleLoanAmounts(raw) {
  if (!raw) return {};
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (_) {
    return {};
  }
}

function resolveSimpleLoanAmount(sheetName, fallbackLoanAmount, loanAmounts) {
  const key = sheetName || '__default__';
  const direct = parseFloat(loanAmounts[key]);
  if (direct > 0) return direct;
  if (sheetName) {
    const byName = parseFloat(loanAmounts[sheetName]);
    if (byName > 0) return byName;
  }
  if (fallbackLoanAmount > 0) return fallbackLoanAmount;
  throw new Error(`Enter a valid loan amount${sheetName ? ` for "${sheetName}"` : ''}`);
}

function normalizeImportedEmiName(name, principalHint) {
  const raw = String(name || '').trim();
  if (!raw) return 'Imported EMI';
  const compact = Math.round((parseFloat(principalHint) || 0) * 100) / 100;
  if (compact <= 0) return raw;

  const tailMatch = raw.match(/\s*[-–—:]\s*₹?\s*([\d,]+(?:\.\d+)?)\s*$/);
  if (!tailMatch) return raw;

  const tailAmount = parseFloat(String(tailMatch[1]).replace(/,/g, ''));
  if (!Number.isFinite(tailAmount)) return raw;
  if (Math.abs(tailAmount - compact) > 0.5) return raw;

  return raw.replace(/\s*[-–—:]\s*₹?\s*[\d,]+(?:\.\d+)?\s*$/, '').trim() || raw;
}

async function parseEmiExcel(buffer, sheetName, password, mapping) {
  const opts = password ? { password } : {};
  const wb   = await XlsxPopulate.fromDataAsync(buffer, opts);
  const sheet = sheetName ? (wb.sheet(sheetName) || wb.sheets()[0]) : wb.sheets()[0];
  const usedRange = sheet.usedRange();
  if (!usedRange) throw new Error(`Sheet "${sheetName || 'Sheet1'}" is empty`);
  const lastRow = usedRange.endCell().rowNumber();

  // Column mapping (1-indexed), 0 = not mapped.
  // Use explicit null-check so that a user-supplied 0 ("None/Skip") is NOT overridden by the default.
  const _col = (val, def) => (val !== undefined && val !== null) ? parseInt(val) : def;
  const m = {
    srNo:      _col(mapping?.srNo,      0),
    date:      _col(mapping?.date,      2),
    principal: _col(mapping?.principal, 3),
    interest:  _col(mapping?.interest,  4),  // default col 4 only when no mapping sent at all
    gst:       _col(mapping?.gst,       0),
    total:     _col(mapping?.total,     0),
    emiAmount: _col(mapping?.emiAmount, 0),
    iPaid:     _col(mapping?.iPaid,     0),
  };
  // If neither total nor emiAmount mapped, fall back to column 7
  if (m.emiAmount === 0 && m.total === 0) m.emiAmount = 7;

  // Row 1: EMI name/title (first non-empty cell)
  let emiName = '';
  for (let c = 1; c <= 10; c++) {
    const v = sheet.cell(1, c).value();
    if (v && String(v).trim()) { emiName = String(v).trim(); break; }
  }
  if (!emiName) emiName = sheetName || 'Imported EMI';

  // Row 3 = headers. GST rate from the GST column header in row 3, e.g. "GST (18%)"
  let gstRate = 18;
  if (m.gst > 0) {
    const gh = String(sheet.cell(3, m.gst).value() || '');
    const gm = gh.match(/(\d+(?:\.\d+)?)\s*%/);
    if (gm) gstRate = parseFloat(gm[1]);
  }

  // Data starts from row 4
  const dataStartRow = 4;

  // Data rows
  const installments = [];
  for (let r = dataStartRow; r <= lastRow; r++) {
    if (m.srNo > 0) {
      const sv = sheet.cell(r, m.srNo).value();
      if (sv === null || sv === undefined || sv === '') continue;
      const ss = String(sv).trim().toLowerCase();
      if (/^(total|sr\.?\s*no\.?|s\.?\s*no\.?)$/.test(ss)) continue;
      if (isNaN(parseInt(sv))) continue;
    }
    const dateVal   = sheet.cell(r, m.date).value();
    const principal = m.principal > 0 ? (parseFloat(sheet.cell(r, m.principal).value()) || 0) : 0;
    const interest  = m.interest  > 0 ? (parseFloat(sheet.cell(r, m.interest).value())  || 0) : 0;
    const gst       = m.gst   > 0 ? (parseFloat(sheet.cell(r, m.gst).value())   || 0) : 0;
    const totalExGst= m.total > 0 ? (parseFloat(sheet.cell(r, m.total).value()) || 0) : 0;
    let   emiAmt    = m.emiAmount > 0 ? (parseFloat(sheet.cell(r, m.emiAmount).value()) || 0) : 0;
    const iPaid     = m.iPaid > 0 ? (parseFloat(sheet.cell(r, m.iPaid).value()) || 0) : 0;
    const dueDate   = parseExcelDate(dateVal);

    // Derive emiAmount if not directly mapped
    if (emiAmt === 0) {
      if (totalExGst > 0) emiAmt = totalExGst + gst;          // Total ex-GST + GST
      else if (principal > 0 || interest > 0) emiAmt = principal + interest + gst; // sum components
    }

    if (!dueDate || (principal === 0 && interest === 0 && emiAmt === 0)) continue;
    installments.push({
      installment_no:      installments.length + 1,
      due_date:            dueDate,
      principal_component: Math.round(principal   * 100) / 100,
      interest_component:  Math.round(interest    * 100) / 100,
      gst_amount:          Math.round(gst         * 100) / 100,
      emi_amount:          Math.round(emiAmt      * 100) / 100,
      paid_amount:         Math.round(iPaid       * 100) / 100,
    });
  }

  if (installments.length === 0) throw new Error(`No valid data rows in "${sheetName || 'Sheet1'}". Check column mapping.`);

  const totalPrincipal = Math.round(installments.reduce((s, i) => s + i.principal_component, 0) * 100) / 100;
  emiName = normalizeImportedEmiName(emiName, totalPrincipal);
  const annualRate = totalPrincipal > 0 && installments[0].interest_component > 0
    ? Math.round((installments[0].interest_component / totalPrincipal) * 12 * 100 * 100) / 100
    : 0;

  return {
    emiData: { name: emiName, annual_rate: annualRate, gst_rate: gstRate, start_date: installments[0].due_date },
    installments,
  };
}

router.get('/emi/summary', async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    res.json(await Promise.resolve(getFinanceDb().getEmiMonthSummary(req.session.userId, month)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Current user access ─────────────────────────────────────
router.get('/auth/me/access', (req, res) => {
  Promise.all([
    Promise.resolve(pgDb.findUserById(req.session.userId)),
    Promise.resolve(pgDb.getUserAccessiblePages(req.session.userId)),
  ]).then(([user, pages]) => {
    res.json({ role: user?.role || 'user', pages });
  }).catch((err) => {
    res.status(500).json({ error: err.message });
  });
});

// ─── ADMIN ROUTES ────────────────────────────────────────────
const { requireAdmin } = require('../middleware/auth');

router.get('/admin/users', requireAdmin, async (req, res) => {
  try {
    res.json({ users: await Promise.resolve(pgDb.getAllUsers()) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    await Promise.resolve(pgDb.updateUserAdmin(req.params.id, req.body, req.session.userId));
    res.json({ success: true });
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    await Promise.resolve(pgDb.softDeleteUser(req.params.id, req.session.userId));
    res.json({ success: true });
  }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/admin/users/:id/restore', requireAdmin, async (req, res) => {
  try {
    await Promise.resolve(pgDb.restoreUser(req.params.id, req.session.userId));
    res.json({ success: true });
  }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/admin/users/:id/set-password', requireAdmin, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password too short (min 6)' });
    const bcrypt = require('bcryptjs');
    await Promise.resolve(pgDb.resetUserPassword(req.params.id, bcrypt.hashSync(password, 10)));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/users/:id/reset-link', requireAdmin, async (req, res) => {
  try {
    const token = await Promise.resolve(pgDb.createPasswordReset(req.params.id));
    const link = `${req.protocol}://${req.get('host')}/reset-password?token=${token}`;
    res.json({ success: true, token, link });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/users/:id/otp', requireAdmin, async (req, res) => {
  try {
    const { purpose, channel } = req.body;
    const code = await Promise.resolve(pgDb.generateOtp(req.params.id, purpose || 'login', channel || 'email'));
    res.json({ success: true, otp: code });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/notifications/users', requireAdmin, async (req, res) => {
  try {
    const users = await Promise.resolve(pgDb.getAdminPushUsers(req.query.search || ''));
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/notifications/send', requireAdmin, async (req, res) => {
  try {
    const userIds = parseAdminUserIdList(req.body?.user_ids);
    if (!userIds.length) return res.status(400).json({ error: 'Select at least one user' });

    const message = normalizeMessagePayload({
      title: req.body?.title,
      body: req.body?.message,
      data: req.body?.data || {},
    });

    const tokenRows = await Promise.resolve(pgDb.getPushTokensForUsers(userIds));
    if (!tokenRows.length) return res.status(400).json({ error: 'No active push devices found for the selected users' });

    const tokenUsers = new Set(tokenRows.map((row) => row.user_id));
    const missingUserIds = userIds.filter((id) => !tokenUsers.has(id));
    const delivery = await sendExpoPushNotifications(tokenRows.map((row) => ({
      to: row.token,
      title: message.title,
      body: message.body,
      data: {
        ...message.data,
        user_id: row.user_id,
      },
    })));

    res.json({
      success: delivery.errors.length === 0,
      requested_user_count: userIds.length,
      delivered_user_count: tokenUsers.size,
      device_count: tokenRows.length,
      skipped_user_ids: missingUserIds,
      sent_count: delivery.sent,
      errors: delivery.errors,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/admin/plans', requireAdmin, async (req, res) => {
  try {
    res.json({ plans: await Promise.resolve(pgDb.getPlans()) });
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/plans', requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, id: await Promise.resolve(pgDb.createPlan(req.body)) });
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/admin/plans/:id', requireAdmin, async (req, res) => {
  try {
    await Promise.resolve(pgDb.updatePlan(req.params.id, req.body));
    res.json({ success: true });
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/admin/plans/:id', requireAdmin, async (req, res) => {
  try {
    await Promise.resolve(pgDb.deletePlan(req.params.id));
    res.json({ success: true });
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/subscriptions', requireAdmin, async (req, res) => {
  try {
    res.json({ subscriptions: await Promise.resolve(pgDb.getSubscriptions()) });
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/subscriptions', requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, id: await Promise.resolve(pgDb.createSubscription(req.body)) });
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/admin/subscriptions/:id', requireAdmin, async (req, res) => {
  try {
    await Promise.resolve(pgDb.updateSubscription(req.params.id, req.body));
    res.json({ success: true });
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/admin/subscriptions/:id', requireAdmin, async (req, res) => {
  try {
    await Promise.resolve(pgDb.deleteSubscription(req.params.id));
    res.json({ success: true });
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── BANK ACCOUNTS ────────────────────────────────────────────
router.get('/banks', (req, res) => {
  Promise.resolve(getOpsDb().getBankAccounts(req.session.userId)).then((accounts) => {
    res.json({ accounts });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});
router.post('/banks', (req, res) => {
  Promise.resolve(getOpsDb().addBankAccount(req.session.userId, req.body)).then((id) => {
    res.json({ success: true, id });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});
router.put('/banks/:id', (req, res) => {
  Promise.resolve(getOpsDb().updateBankAccount(req.session.userId, req.params.id, req.body)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});
router.delete('/banks/:id', (req, res) => {
  Promise.resolve(getOpsDb().deleteBankAccount(req.session.userId, req.params.id)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});
router.patch('/banks/:id/balance', (req, res) => {
  try {
    const balance = parseFloat(req.body.balance);
    if (isNaN(balance) || balance < 0) return res.status(400).json({ error: 'Invalid balance' });
    Promise.resolve(getOpsDb().updateBankBalance(req.session.userId, req.params.id, balance)).then(() => {
      res.json({ success: true });
    }).catch((err) => { res.status(500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.put('/banks/:id/default', (req, res) => {
  Promise.resolve(getOpsDb().setDefaultBankAccount(req.session.userId, req.params.id)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

// ─── DEFAULT PAYMENTS ─────────────────────────────────────────
router.get('/planner/defaults', (req, res) => {
  Promise.resolve(getOpsDb().getDefaultPayments(req.session.userId)).then((defaults) => {
    res.json({ defaults });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});
router.post('/planner/defaults', (req, res) => {
  Promise.resolve(getOpsDb().addDefaultPayment(req.session.userId, req.body)).then((id) => {
    res.json({ success: true, id });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});
router.put('/planner/defaults/:id', (req, res) => {
  Promise.resolve(getOpsDb().updateDefaultPayment(req.session.userId, req.params.id, req.body)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});
router.delete('/planner/defaults/:id', (req, res) => {
  Promise.resolve(getOpsDb().deleteDefaultPayment(req.session.userId, req.params.id)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

// ─── PLANNER PREVIEW (future month, read-only) ────────────────
router.get('/planner/preview', (req, res) => {
  try {
    const month    = req.query.month || new Date().toISOString().slice(0, 7);
    Promise.all([
      Promise.resolve(getOpsDb().getBankAccounts(req.session.userId)),
      Promise.resolve(getFinanceDb().getPreviewDataForMonth(req.session.userId, month, getBillingDb())),
    ]).then(([accounts, preview]) => {
      res.json({ accounts, ...preview });
    }).catch((err) => { res.status(500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── MONTHLY PAYMENTS ─────────────────────────────────────────
router.get('/planner/monthly', (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    Promise.all([
      Promise.resolve(getOpsDb().getMonthlyPayments(req.session.userId, month)),
      Promise.resolve(getOpsDb().getSkippedPayments(req.session.userId, month)),
      Promise.resolve(getOpsDb().getBankAccounts(req.session.userId)),
      Promise.resolve(getBillingDb().getCcDuesForMonth(req.session.userId, month)),
      Promise.resolve(getFinanceDb().getEmiDuesForMonth(req.session.userId, month)),
    ]).then(([payments, skipped, accounts, ccDues, emiDues]) => {
      res.json({ payments, skipped, accounts, ccDues, emiDues });
    }).catch((err) => { res.status(500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/planner/monthly', (req, res) => {
  Promise.resolve(getOpsDb().addMonthlyPayment(req.session.userId, req.body)).then((id) => {
    res.json({ success: true, id });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});
router.put('/planner/monthly/:id', (req, res) => {
  Promise.resolve(getOpsDb().updateMonthlyPayment(req.session.userId, req.params.id, req.body)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});
router.delete('/planner/monthly/:id', (req, res) => {
  Promise.resolve(getOpsDb().deleteMonthlyPayment(req.session.userId, req.params.id)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});
router.put('/planner/monthly/:id/restore', (req, res) => {
  Promise.resolve(getOpsDb().restoreMonthlyPayment(req.session.userId, req.params.id)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});
router.delete('/planner/monthly/:id/hard', (req, res) => {
  Promise.resolve(getOpsDb().hardDeleteMonthlyPayment(req.session.userId, req.params.id)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});
router.put('/planner/monthly/:id/pay', (req, res) => {
  Promise.resolve(getOpsDb().payMonthlyPayment(req.session.userId, req.params.id, req.body.paid_amount, req.body.paid_date, req.body.bank_account_id)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

// ─── CREDIT CARDS ─────────────────────────────────────────────
router.get('/cc/cards', (req, res) => {
  Promise.resolve(getBillingDb().getCreditCards(req.session.userId)).then((cards) => {
    res.json({ cards });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

router.post('/cc/cards', (req, res) => {
  Promise.resolve(getBillingDb().addCreditCard(req.session.userId, req.body)).then((id) => {
    res.json({ success: true, id });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

router.put('/cc/cards/:id', (req, res) => {
  Promise.resolve(getBillingDb().updateCreditCard(req.session.userId, req.params.id, req.body)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

router.delete('/cc/cards/:id', (req, res) => {
  Promise.resolve(getBillingDb().deleteCreditCard(req.session.userId, req.params.id)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

router.get('/cc/cards/:id/current', (req, res) => {
  Promise.resolve(getBillingDb().getCcCurrentCycle(req.session.userId, req.params.id)).then((data) => {
    res.json(data);
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

router.get('/cc/cards/:id/cycles', (req, res) => {
  Promise.resolve(getBillingDb().getCcCycles(req.session.userId, req.params.id)).then((cycles) => {
    res.json({ cycles });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

router.get('/cc/cards/:id/monthly', (req, res) => {
  const year = req.query.year || null;
  Promise.resolve(getBillingDb().getCcMonthlySummary(req.session.userId, req.params.id, year)).then((months) => {
    res.json({ months });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

router.get('/cc/cards/:id/yearly', (req, res) => {
  Promise.resolve(getBillingDb().getCcYearlySummary(req.session.userId, req.params.id)).then((years) => {
    res.json({ years });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

router.get('/cc/cards/:id/years', (req, res) => {
  Promise.resolve(getBillingDb().getCcAvailableYears(req.session.userId, req.params.id)).then((years) => {
    res.json({ years });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

router.post('/cc/txns', (req, res) => {
  Promise.resolve(getBillingDb().addCcTxn(req.session.userId, req.body)).then((id) => {
    res.json({ success: true, id });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

router.post('/cc/import-excel/sheets', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const password = req.body.password || '';
    const opts = password ? { password } : {};
    const wb = await XlsxPopulate.fromDataAsync(req.file.buffer, opts);
    res.json({ sheets: wb.sheets().map(s => s.name()) });
  } catch (err) {
    const msg = err.message || '';
    if (msg.toLowerCase().includes('password') || msg.toLowerCase().includes('decrypt') || msg.toLowerCase().includes('encrypt')) {
      res.status(400).json({ error: 'Wrong password or file is corrupted.' });
    } else {
      res.status(500).json({ error: msg || 'Failed to read file' });
    }
  }
});

router.post('/cc/import-excel/preview', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const sheets = parseSheetParam(req.body.sheets);
    const defaultTxnDate = req.body.default_txn_date || null;
    const { rows, skipped } = await parseCcExcelBuffer(req.file.buffer, sheets, req.body.password, defaultTxnDate);
    res.json({ count: rows.length, skipped, preview: rows.slice(0, 15) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to parse file' });
  }
});

router.post('/cc/import-excel', withUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const cycleId = parseInt(req.body.cycle_id);
    const discountPct = req.body.discount_pct !== undefined && req.body.discount_pct !== '' ? parseFloat(req.body.discount_pct) : null;
    if (!cycleId) return res.status(400).json({ error: 'cycle_id required' });
    const sheets = parseSheetParam(req.body.sheets);
    const defaultTxnDate = req.body.default_txn_date || null;
    const { rows, skipped } = await parseCcExcelBuffer(req.file.buffer, sheets, req.body.password, defaultTxnDate);
    if (!rows.length) return res.status(400).json({ error: 'No valid rows found. Check the file format.' });
    const count = await Promise.resolve(getBillingDb().bulkAddCcTxnsToCycle(req.session.userId, cycleId, rows, discountPct));
    res.json({ success: true, imported: count, total: rows.length + skipped });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Import failed' });
  }
});

router.put('/cc/txns/:id', (req, res) => {
  try { Promise.resolve(getBillingDb().updateCcTxn(req.session.userId, req.params.id, req.body)).then(() => res.json({ success: true })).catch((err) => res.status(500).json({ error: err.message })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/cc/txns/:id', (req, res) => {
  try { Promise.resolve(getBillingDb().deleteCcTxn(req.session.userId, req.params.id)).then(() => res.json({ success: true })).catch((err) => res.status(500).json({ error: err.message })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Static route must be before dynamic /:id/close to avoid conflict
router.post('/cc/cycles/import', (req, res) => {
  try {
    const { card_id, rows } = req.body;
    if (!card_id || !Array.isArray(rows)) return res.status(400).json({ error: 'card_id and rows required' });
    Promise.resolve(getBillingDb().importHistoricalCycles(req.session.userId, card_id, rows)).then((count) => {
      res.json({ success: true, imported: count });
    }).catch((err) => { res.status(500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/cc/cycles/:id/txns', (req, res) => {
  try {
    Promise.resolve(getBillingDb().addCcTxnToCycle(req.session.userId, req.params.id, req.body)).then((id) => {
      res.json({ success: true, id });
    }).catch((err) => { res.status(500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.put('/cc/cycles/:id', (req, res) => {
  try {
    Promise.resolve(getBillingDb().updateCcCycle(req.session.userId, req.params.id, req.body)).then(() => {
      res.json({ success: true });
    }).catch((err) => { res.status(500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/cc/cycles/:id', (req, res) => {
  try {
    Promise.resolve(getBillingDb().deleteCcCycle(req.session.userId, req.params.id)).then(() => {
      res.json({ success: true });
    }).catch((err) => { res.status(500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/cc/cycles/:id/close', (req, res) => {
  try {
    Promise.resolve(getBillingDb().closeCcCycle(req.session.userId, req.params.id, req.body.paid_amount, req.body.paid_date, req.body.bank_account_id)).then(() => {
      res.json({ success: true });
    }).catch((err) => { res.status(500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── AI LOOKUP ───────────────────────────────────────────────────────────────
const Anthropic = require('@anthropic-ai/sdk');

router.get('/ai/lookup/status', (req, res) => {
  Promise.resolve(getOpsDb().getAiLookupStatus(req.session.userId)).then((status) => {
    res.json({ success: true, ...status });
  }).catch((err) => {
    res.status(500).json({ error: err.message });
  });
});

router.post('/ai/lookup', async (req, res) => {
  try {
    const { question, history } = req.body;
    if (!question) return res.status(400).json({ error: 'Question is required' });

    const aiStatus = await Promise.resolve(getOpsDb().getAiLookupStatus(req.session.userId));
    if (!aiStatus.canAsk) {
      return res.status(402).json({
        error: `You have used all ${aiStatus.dailyFreeLimit} free AI lookups for today. Buy a paid plan for more queries.`,
        ai_status: aiStatus,
      });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'AI service not configured. Set ANTHROPIC_API_KEY environment variable.' });

    // Gather user's complete financial data
    const [summary, currentUser] = await Promise.all([
      Promise.resolve(getFinanceDb().getUserFinancialSummary(req.session.userId)),
      Promise.resolve(pgDb.findUserById(req.session.userId)),
    ]);
    const currencyCode = currentUser?.currency_code || 'USD';
    const localeCode = currentUser?.locale_code || 'en-US';

    const systemPrompt = `You are a personal finance assistant for the Expense Lite AI application.
You have access to the user's complete financial data as of ${summary.as_of}. Answer their questions accurately based on this data.
Be concise but complete. Use Indian number formatting (₹ symbol, lakhs/crores where appropriate).
If the user asks something not covered by the data, say so clearly.

PREFERRED FORMATTING:
Use ${currencyCode} currency formatting with locale ${localeCode}.${currencyCode === 'INR' ? ' Use lakhs/crores where appropriate.' : ''}

USER'S FINANCIAL DATA:
${JSON.stringify(summary, null, 2)}`;

    const client = new Anthropic({ apiKey });

    // Build message history for multi-turn conversation
    const messages = [];
    if (history && Array.isArray(history)) {
      for (const msg of history) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
    messages.push({ role: 'user', content: question });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    });

    const answer = response.content[0]?.text || 'No response';
    const nextStatus = await Promise.resolve(getOpsDb().recordAiLookupUsage(req.session.userId));
    res.json({ success: true, answer, ai_status: nextStatus });
  } catch (err) {
    console.error('[AI lookup]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── DAILY TRACKERS ──────────────────────────────────────────
router.get('/trackers', (req, res) => {
  Promise.resolve(getOpsDb().getDailyTrackers(req.session.userId)).then((trackers) => {
    res.json({ trackers });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

router.post('/trackers', (req, res) => {
  try {
    const { name, unit, price_per_unit, default_qty, is_active, auto_add_to_expense, expense_bank_account_id, expense_category } = req.body;
    if (!name || !price_per_unit) return res.status(400).json({ error: 'Missing required fields' });
    Promise.resolve(getOpsDb().addDailyTracker(req.session.userId, {
      name,
      unit,
      price_per_unit,
      default_qty,
      is_active,
      auto_add_to_expense,
      expense_bank_account_id,
      expense_category,
    })).then((id) => {
      res.json({ success: true, id });
    }).catch((err) => { res.status(500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/trackers/:id', (req, res) => {
  Promise.resolve(getOpsDb().updateDailyTracker(req.session.userId, req.params.id, req.body)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

router.delete('/trackers/:id', (req, res) => {
  Promise.resolve(getOpsDb().deleteDailyTracker(req.session.userId, req.params.id)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

router.get('/trackers/:id/entries', (req, res) => {
  try {
    const { year, month } = req.query;
    Promise.resolve(getOpsDb().getDailyEntries(req.session.userId, req.params.id, year, month)).then((entries) => {
      res.json({ entries });
    }).catch((err) => { res.status(500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/trackers/:id/entries', (req, res) => {
  try {
    const { date, qty, is_auto } = req.body;
    if (!date || qty == null) return res.status(400).json({ error: 'Missing date or qty' });
    Promise.resolve(getOpsDb().upsertDailyEntry(req.session.userId, req.params.id, date, qty, is_auto ? 1 : 0)).then((r) => {
      res.json({ success: true, amount: r.amount });
    }).catch((err) => { res.status(500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/trackers/:id/autofill', (req, res) => {
  try {
    const { year, month } = req.body;
    Promise.resolve(getOpsDb().autoFillDailyEntries(req.session.userId, req.params.id, year, month)).then((filled) => {
      res.json({ success: true, filled });
    }).catch((err) => { res.status(500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/trackers/:id/summary', (req, res) => {
  try {
    const { year, month } = req.query;
    Promise.resolve(getOpsDb().getDailyMonthSummary(req.session.userId, req.params.id, year, month)).then((summary) => {
      res.json({ summary });
    }).catch((err) => { res.status(500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/trackers/:id/month-expense', (req, res) => {
  try {
    const { year, month, bank_account_id, expense_month, expense_category } = req.body;
    Promise.resolve(getOpsDb().addTrackerMonthToExpense(req.session.userId, req.params.id, year, month, { bank_account_id, expense_month, expense_category })).then((amount) => {
      sendTrackerExpenseAppliedEmailForUser(req.session.userId, req.params.id, Number(year), Number(month), { expense_month }).catch(() => {});
      res.json({ success: true, amount });
    }).catch((err) => { res.status(500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── RECURRING ENTRIES ───────────────────────────────────────
router.get('/recurring', (req, res) => {
  Promise.resolve(getOpsDb().getRecurringEntries(req.session.userId)).then((entries) => {
    res.json({ entries });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

router.post('/recurring', (req, res) => {
  try {
    const {
      type,
      description,
      amount,
      interval_months,
      start_month,
      card_id,
      bank_account_id,
      expense_category,
      discount_pct,
      also_expense,
      is_extra,
      apply_current_month,
    } = req.body;
    if (!type || !description || !amount) return res.status(400).json({ error: 'Missing required fields' });
    Promise.resolve(getOpsDb().addRecurringEntry(req.session.userId, {
      type,
      description,
      amount,
      interval_months,
      start_month,
      card_id,
      bank_account_id,
      expense_category,
      discount_pct,
      also_expense,
      is_extra,
    })).then(async (id) => {
      if (apply_current_month) {
        await Promise.resolve(getOpsDb().applyRecurringEntryForCurrentMonth(req.session.userId, id));
        sendRecurringAppliedEmailForUser(req.session.userId, [Number(id)]).catch(() => {});
      }
      res.json({ success: true, id });
    }).catch((err) => { res.status(500).json({ error: err.message }); });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/recurring/:id', (req, res) => {
  Promise.resolve(getOpsDb().updateRecurringEntry(req.session.userId, req.params.id, req.body)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

router.delete('/recurring/:id', (req, res) => {
  Promise.resolve(getOpsDb().deleteRecurringEntry(req.session.userId, req.params.id)).then(() => {
    res.json({ success: true });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

router.post('/recurring/apply', (req, res) => {
  Promise.resolve(getOpsDb().applyRecurringEntries(req.session.userId)).then((applied) => {
    if ((applied || []).length) sendRecurringAppliedEmailForUser(req.session.userId, applied).catch(() => {});
    res.json({ success: true, applied: applied.length, ids: applied });
  }).catch((err) => { res.status(500).json({ error: err.message }); });
});

module.exports = router;

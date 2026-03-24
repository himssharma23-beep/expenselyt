// ============================================================
// Database Setup — SQLite with better-sqlite3
// ============================================================
const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '..', 'data', 'expense_manager.db');

let db;

function getDb() {
  if (!db) {
    const fs = require('fs');
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initTables();
    migrateDb();
  }
  return db;
}

function initTables() {
  db.exec(`
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Expenses table
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      amount REAL NOT NULL,
      purchase_date TEXT NOT NULL,
      is_extra INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_expenses_user ON expenses(user_id);
    CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(purchase_date);

    -- Friends table (per user)
    CREATE TABLE IF NOT EXISTS friends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_friends_user ON friends(user_id);

    -- Loan transactions
    CREATE TABLE IF NOT EXISTS loan_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      friend_id INTEGER NOT NULL,
      txn_date TEXT NOT NULL,
      details TEXT NOT NULL,
      paid REAL DEFAULT 0,
      received REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (friend_id) REFERENCES friends(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_loan_friend ON loan_transactions(friend_id);
    CREATE INDEX IF NOT EXISTS idx_loan_user ON loan_transactions(user_id);

    -- Divide groups
    CREATE TABLE IF NOT EXISTS divide_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      divide_date TEXT NOT NULL,
      details TEXT NOT NULL,
      paid_by TEXT NOT NULL,
      total_amount REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Divide splits
    CREATE TABLE IF NOT EXISTS divide_splits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      friend_id INTEGER NOT NULL,
      friend_name TEXT NOT NULL,
      share_amount REAL NOT NULL,
      is_paid INTEGER DEFAULT 0,
      FOREIGN KEY (group_id) REFERENCES divide_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (friend_id) REFERENCES friends(id) ON DELETE CASCADE
    );

    -- Trips
    CREATE TABLE IF NOT EXISTS trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_trips_user ON trips(user_id);

    -- Trip members
    CREATE TABLE IF NOT EXISTS trip_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL,
      friend_id INTEGER,
      member_name TEXT NOT NULL,
      is_locked INTEGER DEFAULT 0,
      FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
    );

    -- Trip expenses
    CREATE TABLE IF NOT EXISTS trip_expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL,
      paid_by_key TEXT NOT NULL,
      paid_by_name TEXT NOT NULL,
      details TEXT NOT NULL,
      amount REAL NOT NULL,
      expense_date TEXT NOT NULL,
      split_mode TEXT DEFAULT 'equal',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
    );

    -- Trip expense splits
    CREATE TABLE IF NOT EXISTS trip_expense_splits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_id INTEGER NOT NULL,
      member_key TEXT NOT NULL,
      member_name TEXT NOT NULL,
      share_amount REAL NOT NULL,
      FOREIGN KEY (expense_id) REFERENCES trip_expenses(id) ON DELETE CASCADE
    );

    -- EMI Records (saved from calculator or manually entered)
    CREATE TABLE IF NOT EXISTS emi_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      principal REAL NOT NULL,
      annual_rate REAL NOT NULL,
      tenure_months INTEGER NOT NULL,
      monthly_emi REAL NOT NULL,
      total_interest REAL NOT NULL,
      gst_rate REAL DEFAULT 0,
      total_gst REAL DEFAULT 0,
      total_amount REAL NOT NULL,
      grand_total REAL NOT NULL,
      tag TEXT,
      status TEXT DEFAULT 'saved',
      start_date TEXT,
      planner_advance_month INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_emi_user ON emi_records(user_id);

    -- Bank Accounts
    CREATE TABLE IF NOT EXISTS bank_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      bank_name TEXT NOT NULL,
      account_name TEXT,
      account_type TEXT DEFAULT 'savings',
      balance REAL DEFAULT 0,
      min_balance REAL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_bank_user ON bank_accounts(user_id);

    -- Default recurring monthly payments
    CREATE TABLE IF NOT EXISTS default_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      due_day INTEGER DEFAULT 1,
      interval_months INTEGER DEFAULT 1,
      start_month TEXT,
      category TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_defpay_user ON default_payments(user_id);

    -- Monthly payment instances (per month)
    CREATE TABLE IF NOT EXISTS monthly_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      default_payment_id INTEGER,
      recurring_entry_id INTEGER,
      daily_tracker_id INTEGER,
      tracker_source_month TEXT,
      month TEXT NOT NULL,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      due_date TEXT,
      paid_amount REAL DEFAULT 0,
      paid_date TEXT,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_monpay_user ON monthly_payments(user_id);
    CREATE INDEX IF NOT EXISTS idx_monpay_month ON monthly_payments(month);

    -- Credit Cards
    CREATE TABLE IF NOT EXISTS credit_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      bank_name TEXT NOT NULL,
      card_name TEXT NOT NULL,
      last4 TEXT NOT NULL,
      expiry_month INTEGER,
      expiry_year INTEGER,
      bill_gen_day INTEGER NOT NULL DEFAULT 1,
      due_days INTEGER DEFAULT 20,
      default_discount_pct REAL DEFAULT 0,
      credit_limit REAL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_cc_user ON credit_cards(user_id);

    -- Credit Card Billing Cycles
    CREATE TABLE IF NOT EXISTS cc_cycles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      card_id INTEGER NOT NULL,
      cycle_start TEXT NOT NULL,
      cycle_end TEXT NOT NULL,
      due_date TEXT,
      total_amount REAL DEFAULT 0,
      total_discount REAL DEFAULT 0,
      net_payable REAL DEFAULT 0,
      paid_amount REAL DEFAULT 0,
      paid_date TEXT,
      status TEXT DEFAULT 'open',
      manual_total_override INTEGER DEFAULT 0,
      closed_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (card_id) REFERENCES credit_cards(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_cc_cycles_card ON cc_cycles(card_id);

    -- Credit Card Transactions
    CREATE TABLE IF NOT EXISTS cc_txns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      card_id INTEGER NOT NULL,
      cycle_id INTEGER,
      txn_date TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      discount_pct REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      net_amount REAL NOT NULL,
      source TEXT DEFAULT 'manual',
      source_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (card_id) REFERENCES credit_cards(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_cc_txns_card ON cc_txns(card_id);
    CREATE INDEX IF NOT EXISTS idx_cc_txns_cycle ON cc_txns(cycle_id);

    -- EMI Installments (one row per monthly payment)
    CREATE TABLE IF NOT EXISTS emi_installments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      emi_id INTEGER NOT NULL,
      installment_no INTEGER NOT NULL,
      due_date TEXT NOT NULL,
      principal_component REAL NOT NULL,
      interest_component REAL NOT NULL,
      gst_amount REAL DEFAULT 0,
      emi_amount REAL NOT NULL,
      paid_amount REAL DEFAULT 0,
      paid_date TEXT,
      notes TEXT,
      FOREIGN KEY (emi_id) REFERENCES emi_records(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_emi_inst ON emi_installments(emi_id);

    -- Daily Trackers (milk, newspaper, etc.)
    CREATE TABLE IF NOT EXISTS daily_trackers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      unit TEXT DEFAULT 'unit',
      price_per_unit REAL NOT NULL,
      default_qty REAL DEFAULT 1,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS daily_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tracker_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      entry_date TEXT NOT NULL,
      quantity REAL NOT NULL,
      amount REAL NOT NULL,
      is_auto INTEGER DEFAULT 1,
      added_to_expense INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tracker_id) REFERENCES daily_trackers(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(tracker_id, entry_date)
    );
    CREATE INDEX IF NOT EXISTS idx_daily_entries_tracker ON daily_entries(tracker_id, entry_date);

    -- Recurring entries (auto-applied on day 1 of each month)
    CREATE TABLE IF NOT EXISTS recurring_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      interval_months INTEGER DEFAULT 1,
      start_month TEXT,
      card_id INTEGER,
      discount_pct REAL DEFAULT 0,
      also_expense INTEGER DEFAULT 0,
      is_extra INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      last_applied TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Trip invites (invite link for a specific member slot)
    CREATE TABLE IF NOT EXISTS trip_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL,
      member_id INTEGER NOT NULL,
      created_by INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT,
      accepted_by INTEGER,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Share links (public read-only share of friends list)
    CREATE TABLE IF NOT EXISTS share_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      link_type TEXT DEFAULT 'friends',
      filters TEXT,
      expires_at TEXT,
      view_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
}

function migrateDb() {
  // Trip members — linked user sharing
  const tripMemberCols = db.prepare('PRAGMA table_info(trip_members)').all().map(c => c.name);
  if (!tripMemberCols.includes('linked_user_id')) db.exec('ALTER TABLE trip_members ADD COLUMN linked_user_id INTEGER');
  if (!tripMemberCols.includes('permission'))     db.exec("ALTER TABLE trip_members ADD COLUMN permission TEXT DEFAULT 'edit'");

  const cols = db.prepare('PRAGMA table_info(divide_groups)').all().map(c => c.name);
  if (!cols.includes('heading'))    db.exec('ALTER TABLE divide_groups ADD COLUMN heading TEXT');
  if (!cols.includes('session_id')) db.exec('ALTER TABLE divide_groups ADD COLUMN session_id TEXT');

  // Bank accounts migrations
  const bankCols = db.prepare('PRAGMA table_info(bank_accounts)').all().map(c => c.name);
  if (!bankCols.includes('is_default')) db.exec('ALTER TABLE bank_accounts ADD COLUMN is_default INTEGER DEFAULT 0');

  // Default payments migrations
  const defPayCols = db.prepare('PRAGMA table_info(default_payments)').all().map(c => c.name);
  if (!defPayCols.includes('interval_months')) db.exec('ALTER TABLE default_payments ADD COLUMN interval_months INTEGER DEFAULT 1');
  if (!defPayCols.includes('start_month')) db.exec('ALTER TABLE default_payments ADD COLUMN start_month TEXT');
  if (!defPayCols.includes('bank_account_id')) db.exec('ALTER TABLE default_payments ADD COLUMN bank_account_id INTEGER');
  if (!defPayCols.includes('auto_detect_bank')) db.exec('ALTER TABLE default_payments ADD COLUMN auto_detect_bank INTEGER DEFAULT 0');

  // Expenses migrations
  const expCols = db.prepare('PRAGMA table_info(expenses)').all().map(c => c.name);
  if (!expCols.includes('source'))    db.exec('ALTER TABLE expenses ADD COLUMN source TEXT');
  if (!expCols.includes('source_id')) db.exec('ALTER TABLE expenses ADD COLUMN source_id INTEGER');

  const recCols = db.prepare('PRAGMA table_info(recurring_entries)').all().map(c => c.name);
  if (!recCols.includes('interval_months')) db.exec('ALTER TABLE recurring_entries ADD COLUMN interval_months INTEGER DEFAULT 1');
  if (!recCols.includes('start_month')) db.exec('ALTER TABLE recurring_entries ADD COLUMN start_month TEXT');

  // EMI records migrations
  const emiCols = db.prepare('PRAGMA table_info(emi_records)').all().map(c => c.name);
  if (!emiCols.includes('credit_card_id'))        db.exec('ALTER TABLE emi_records ADD COLUMN credit_card_id INTEGER');
  if (!emiCols.includes('gst_month_offset'))       db.exec('ALTER TABLE emi_records ADD COLUMN gst_month_offset INTEGER DEFAULT 0');
  if (!emiCols.includes('cc_processing_charge'))   db.exec('ALTER TABLE emi_records ADD COLUMN cc_processing_charge REAL');
  if (!emiCols.includes('cc_processing_gst_pct'))  db.exec('ALTER TABLE emi_records ADD COLUMN cc_processing_gst_pct REAL');
  if (!emiCols.includes('expenses_added'))         db.exec('ALTER TABLE emi_records ADD COLUMN expenses_added INTEGER DEFAULT 0');
  if (!emiCols.includes('for_friend'))             db.exec('ALTER TABLE emi_records ADD COLUMN for_friend INTEGER DEFAULT 0');
  if (!emiCols.includes('friend_name'))            db.exec('ALTER TABLE emi_records ADD COLUMN friend_name TEXT');
  if (!emiCols.includes('planner_advance_month'))  db.exec('ALTER TABLE emi_records ADD COLUMN planner_advance_month INTEGER DEFAULT 0');

  // Monthly payments migrations
  const monPayCols = db.prepare('PRAGMA table_info(monthly_payments)').all().map(c => c.name);
  if (!monPayCols.includes('recurring_entry_id')) db.exec('ALTER TABLE monthly_payments ADD COLUMN recurring_entry_id INTEGER');
  if (!monPayCols.includes('daily_tracker_id')) db.exec('ALTER TABLE monthly_payments ADD COLUMN daily_tracker_id INTEGER');
  if (!monPayCols.includes('tracker_source_month')) db.exec('ALTER TABLE monthly_payments ADD COLUMN tracker_source_month TEXT');
  if (!monPayCols.includes('bank_account_id')) db.exec('ALTER TABLE monthly_payments ADD COLUMN bank_account_id INTEGER');
  if (!monPayCols.includes('is_skipped'))      db.exec('ALTER TABLE monthly_payments ADD COLUMN is_skipped INTEGER DEFAULT 0');
  if (!monPayCols.includes('paid_amount'))     db.exec('ALTER TABLE monthly_payments ADD COLUMN paid_amount REAL DEFAULT 0');
  if (!monPayCols.includes('paid_date'))       db.exec('ALTER TABLE monthly_payments ADD COLUMN paid_date TEXT');
  if (!monPayCols.includes('status'))          db.exec("ALTER TABLE monthly_payments ADD COLUMN status TEXT DEFAULT 'pending'");

  // CC cycles migrations (only if table exists)
  const ccCycleExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cc_cycles'").get();
  if (ccCycleExists) {
    const ccCycleCols = db.prepare('PRAGMA table_info(cc_cycles)').all().map(c => c.name);
    if (!ccCycleCols.includes('paid_amount')) db.exec('ALTER TABLE cc_cycles ADD COLUMN paid_amount REAL DEFAULT 0');
    if (!ccCycleCols.includes('paid_date'))   db.exec('ALTER TABLE cc_cycles ADD COLUMN paid_date TEXT');
    if (!ccCycleCols.includes('manual_total_override')) db.exec('ALTER TABLE cc_cycles ADD COLUMN manual_total_override INTEGER DEFAULT 0');
  }

  // Users table migrations
  const userCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!userCols.includes('role'))      db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'");
  if (!userCols.includes('mobile'))    db.exec('ALTER TABLE users ADD COLUMN mobile TEXT');
  if (!userCols.includes('is_active')) db.exec('ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1');
  if (!userCols.includes('avatar_url')) db.exec('ALTER TABLE users ADD COLUMN avatar_url TEXT');

  // First user becomes admin
  const firstUser = db.prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get();
  if (firstUser) db.prepare("UPDATE users SET role='admin' WHERE id=? AND (role IS NULL OR role='user')").run(firstUser.id);

  // Admin/subscription tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      price_monthly REAL DEFAULT 0,
      price_yearly REAL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      is_free INTEGER DEFAULT 0,
      auto_assign_on_signup INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS plan_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL,
      page_key TEXT NOT NULL,
      FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS user_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      plan_id INTEGER NOT NULL,
      billing_cycle TEXT DEFAULT 'monthly',
      start_date TEXT NOT NULL,
      end_date TEXT,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (plan_id) REFERENCES plans(id)
    );
    CREATE TABLE IF NOT EXISTS otps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      otp_code TEXT NOT NULL,
      purpose TEXT NOT NULL,
      channel TEXT DEFAULT 'email',
      expires_at DATETIME NOT NULL,
      used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_lookup_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      usage_date TEXT NOT NULL,
      query_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, usage_date)
    );
  `);

  const planCols = db.prepare('PRAGMA table_info(plans)').all().map(c => c.name);
  if (!planCols.includes('auto_assign_on_signup')) db.exec('ALTER TABLE plans ADD COLUMN auto_assign_on_signup INTEGER DEFAULT 0');

  repairCcNetPayables();
}

function repairCcNetPayables() {
  const d = getDb();
  const ccTxnExists = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cc_txns'").get();
  const ccCycleExists = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cc_cycles'").get();
  if (!ccTxnExists || !ccCycleExists) return;

  d.transaction(() => {
    d.prepare('UPDATE cc_txns SET net_amount = ROUND(amount, 2) WHERE ROUND(COALESCE(net_amount, 0), 2) != ROUND(amount, 2)').run();
    d.prepare(`
      UPDATE cc_cycles
      SET manual_total_override = 1
      WHERE id IN (
        SELECT cy.id
        FROM cc_cycles cy
        LEFT JOIN (
          SELECT cycle_id,
                 COUNT(*) as txn_count,
                 ROUND(COALESCE(SUM(amount), 0), 2) as sum_amount,
                 ROUND(COALESCE(SUM(net_amount), 0), 2) as sum_net
          FROM cc_txns
          GROUP BY cycle_id
        ) tx ON tx.cycle_id = cy.id
        WHERE COALESCE(cy.manual_total_override, 0) = 0
          AND (
            (COALESCE(tx.txn_count, 0) = 0 AND ROUND(COALESCE(cy.total_amount, 0), 2) > 0)
            OR ROUND(COALESCE(cy.total_amount, 0), 2) != ROUND(COALESCE(tx.sum_amount, 0), 2)
            OR ROUND(COALESCE(cy.net_payable, 0), 2) != ROUND(COALESCE(tx.sum_net, 0), 2)
          )
      )
    `).run();
    const cycleIds = d.prepare('SELECT id FROM cc_cycles').all().map(r => r.id);
    cycleIds.forEach(cycleId => _updateCycleTotals(d, cycleId));
  })();
}

// ─── User functions ──────────────────────────────────────────
function createUser(username, email, password, displayName) {
  const d = getDb();
  const hash = bcrypt.hashSync(password, 10);
  const stmt = d.prepare('INSERT INTO users (username, email, password_hash, display_name) VALUES (?, ?, ?, ?)');
  const result = stmt.run(username.toLowerCase().trim(), email.toLowerCase().trim(), hash, displayName.trim());
  return result.lastInsertRowid;
}

function findUserByUsername(username) {
  return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase().trim());
}

function findUserByEmail(email) {
  return getDb().prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
}

function findUserById(id) {
  return getDb().prepare('SELECT id, username, email, display_name, role, mobile, avatar_url, is_active, created_at FROM users WHERE id = ?').get(id);
}

function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

function updateUserProfile(userId, data) {
  const d = getDb();
  const current = d.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!current) throw new Error('User not found');

  const nextEmail = data.email != null ? String(data.email).toLowerCase().trim() : current.email;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) throw new Error('Invalid email address');

  const duplicate = d.prepare('SELECT id FROM users WHERE email=? AND id!=?').get(nextEmail, userId);
  if (duplicate) throw new Error('Email already registered');

  const nextName = data.display_name != null ? String(data.display_name).trim() : current.display_name;
  if (!nextName) throw new Error('Display name is required');

  const avatarUrl = data.avatar_url != null ? String(data.avatar_url).trim() : (current.avatar_url || null);
  const normalizedAvatar = avatarUrl || null;
  if (normalizedAvatar && !/^https?:\/\//i.test(normalizedAvatar)) {
    throw new Error('Profile picture must be a valid http/https URL');
  }

  d.prepare(`
    UPDATE users
    SET display_name=?, email=?, mobile=?, avatar_url=?
    WHERE id=?
  `).run(
    nextName,
    nextEmail,
    data.mobile != null ? (String(data.mobile).trim() || null) : (current.mobile || null),
    normalizedAvatar,
    userId
  );

  return findUserById(userId);
}

function changeUserPassword(userId, currentPassword, newPassword) {
  const d = getDb();
  const user = d.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!user) throw new Error('User not found');
  if (!currentPassword || !verifyPassword(currentPassword, user.password_hash)) throw new Error('Current password is incorrect');
  if (!newPassword || String(newPassword).length < 6) throw new Error('Password must be at least 6 characters');
  d.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(String(newPassword), 10), userId);
  return true;
}

// ─── Expense functions ───────────────────────────────────────
function getExpenses(userId, filters = {}) {
  const d = getDb();
  let sql = `SELECT * FROM expenses WHERE user_id = ?
    AND CAST(substr(purchase_date,1,4) AS INTEGER) BETWEEN 2018 AND ${new Date().getFullYear() + 2}`;
  const params = [userId];

  if (filters.year) {
    sql += " AND substr(purchase_date, 1, 4) = ?";
    params.push(String(filters.year));
  }
  if (filters.month) {
    sql += " AND substr(purchase_date, 6, 2) = ?";
    params.push(String(filters.month).padStart(2, '0'));
  }
  if (filters.search) {
    sql += " AND item_name LIKE ?";
    params.push(`%${filters.search}%`);
  }
  if (filters.spendType === 'extra') {
    sql += " AND is_extra = 1";
  } else if (filters.spendType === 'fair') {
    sql += " AND is_extra = 0";
  }

  sql += ' ORDER BY purchase_date DESC, id DESC';
  return d.prepare(sql).all(...params);
}

function addExpense(userId, data) {
  const d = getDb();
  const stmt = d.prepare('INSERT INTO expenses (user_id, item_name, amount, purchase_date, is_extra) VALUES (?, ?, ?, ?, ?)');
  return stmt.run(userId, data.item_name, data.amount, data.purchase_date, data.is_extra ? 1 : 0);
}

function updateExpense(userId, id, data) {
  const d = getDb();
  const stmt = d.prepare('UPDATE expenses SET item_name=?, amount=?, purchase_date=?, is_extra=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?');
  return stmt.run(data.item_name, data.amount, data.purchase_date, data.is_extra ? 1 : 0, id, userId);
}

function deleteExpense(userId, id) {
  return getDb().prepare('DELETE FROM expenses WHERE id=? AND user_id=?').run(id, userId);
}

function bulkAddExpenses(userId, rows) {
  const d = getDb();
  const stmt = d.prepare('INSERT INTO expenses (user_id, item_name, amount, purchase_date, is_extra) VALUES (?, ?, ?, ?, ?)');
  const insertMany = d.transaction((items) => {
    let count = 0;
    for (const r of items) {
      if (r.item_name && r.amount > 0) {
        stmt.run(userId, r.item_name, r.amount, r.purchase_date, r.is_extra ? 1 : 0);
        count++;
      }
    }
    return count;
  });
  return insertMany(rows);
}

// ─── Friend functions ────────────────────────────────────────
function getFriends(userId) {
  const d = getDb();
  const friends = d.prepare('SELECT * FROM friends WHERE user_id = ? ORDER BY name').all(userId);
  // Compute balance for each
  const balStmt = d.prepare('SELECT COALESCE(SUM(paid - received), 0) as balance FROM loan_transactions WHERE friend_id = ?');
  return friends.map(f => {
    const { balance } = balStmt.get(f.id);
    return { ...f, balance: Math.round(balance * 100) / 100 };
  });
}

function addFriend(userId, name) {
  return getDb().prepare('INSERT INTO friends (user_id, name) VALUES (?, ?)').run(userId, name.trim());
}

function deleteFriend(userId, id) {
  const d = getDb();
  d.prepare('DELETE FROM loan_transactions WHERE friend_id = ? AND user_id = ?').run(id, userId);
  return d.prepare('DELETE FROM friends WHERE id = ? AND user_id = ?').run(id, userId);
}

// ─── Loan functions ──────────────────────────────────────────
function getLoanTransactions(userId, friendId) {
  return getDb().prepare('SELECT * FROM loan_transactions WHERE user_id = ? AND friend_id = ? ORDER BY txn_date DESC, id DESC').all(userId, friendId);
}

function addLoanTransaction(userId, data) {
  return getDb().prepare('INSERT INTO loan_transactions (user_id, friend_id, txn_date, details, paid, received) VALUES (?, ?, ?, ?, ?, ?)').run(userId, data.friend_id, data.txn_date, data.details, data.paid || 0, data.received || 0);
}

function updateLoanTransaction(userId, id, data) {
  return getDb().prepare('UPDATE loan_transactions SET txn_date=?, details=?, paid=?, received=? WHERE id=? AND user_id=?').run(data.txn_date, data.details, data.paid || 0, data.received || 0, id, userId);
}

function deleteLoanTransaction(userId, id) {
  return getDb().prepare('DELETE FROM loan_transactions WHERE id=? AND user_id=?').run(id, userId);
}

// ─── Divide functions ────────────────────────────────────────
function getDivideGroups(userId) {
  const d = getDb();
  const groups = d.prepare('SELECT * FROM divide_groups WHERE user_id = ? ORDER BY divide_date DESC, id DESC').all(userId);
  const splitStmt = d.prepare('SELECT * FROM divide_splits WHERE group_id = ?');
  return groups.map(g => ({ ...g, splits: splitStmt.all(g.id) }));
}

function addDivideGroup(userId, data) {
  const d = getDb();
  const insert = d.transaction(() => {
    const grp = d.prepare('INSERT INTO divide_groups (user_id, divide_date, details, paid_by, total_amount, heading, session_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(userId, data.divide_date, data.details, data.paid_by, data.total_amount, data.heading || null, data.session_id || null);
    const groupId = grp.lastInsertRowid;
    const splitStmt = d.prepare('INSERT INTO divide_splits (group_id, friend_id, friend_name, share_amount) VALUES (?, ?, ?, ?)');
    for (const s of data.splits) {
      splitStmt.run(groupId, s.friend_id, s.friend_name, s.share_amount);
    }
    // Auto-create loan transactions
    if (data.auto_loans) {
      const loanStmt = d.prepare('INSERT INTO loan_transactions (user_id, friend_id, txn_date, details, paid, received) VALUES (?, ?, ?, ?, ?, ?)');
      for (const l of data.auto_loans) {
        loanStmt.run(userId, l.friend_id, data.divide_date, `Split: ${data.details}`, l.paid, l.received);
      }
    }
    return groupId;
  });
  return insert();
}

// ─── Trip functions ──────────────────────────────────────────
function createTrip(userId, data) {
  const d = getDb();
  return d.transaction(() => {
    const trip = d.prepare('INSERT INTO trips (user_id, name, start_date, end_date) VALUES (?, ?, ?, ?)').run(userId, data.name.trim(), data.start_date, data.end_date || null);
    const tripId = trip.lastInsertRowid;
    // Always add self as member (friend_id NULL)
    d.prepare('INSERT INTO trip_members (trip_id, friend_id, member_name) VALUES (?, NULL, ?)').run(tripId, 'You');
    const memStmt = d.prepare('INSERT INTO trip_members (trip_id, friend_id, member_name, linked_user_id, permission) VALUES (?, ?, ?, ?, ?)');
    for (const m of (data.members || [])) {
      memStmt.run(tripId, m.friend_id || null, m.member_name, m.linked_user_id || null, m.permission || 'edit');
    }
    return tripId;
  })();
}

function getTrips(userId) {
  const d = getDb();
  // Include trips the user owns OR is a linked member of
  const trips = d.prepare(`
    SELECT DISTINCT t.*, CASE WHEN t.user_id = ? THEN 1 ELSE 0 END as is_owner
    FROM trips t
    LEFT JOIN trip_members m ON m.trip_id = t.id AND m.linked_user_id = ?
    WHERE t.user_id = ? OR m.linked_user_id IS NOT NULL
    ORDER BY t.start_date DESC, t.id DESC
  `).all(userId, userId, userId);
  const memberStmt = d.prepare('SELECT * FROM trip_members WHERE trip_id = ?');
  const expStmt = d.prepare('SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as cnt FROM trip_expenses WHERE trip_id = ?');
  const splitStmt = d.prepare('SELECT member_key, COALESCE(SUM(share_amount),0) as total_share FROM trip_expense_splits WHERE expense_id IN (SELECT id FROM trip_expenses WHERE trip_id = ?) GROUP BY member_key');
  const paidStmt = d.prepare('SELECT paid_by_key, COALESCE(SUM(amount),0) as total_paid FROM trip_expenses WHERE trip_id = ? GROUP BY paid_by_key');
  return trips.map(t => {
    const members = memberStmt.all(t.id);
    const { total, cnt } = expStmt.get(t.id);
    // compute self net balance (for owner: key='self', for linked member: key=their member's key)
    const shares = splitStmt.all(t.id);
    const paid = paidStmt.all(t.id);
    let myKey = 'self';
    if (!t.is_owner) {
      const myMember = members.find(m => m.linked_user_id === userId);
      if (myMember) {
        myKey = myMember.friend_id != null ? String(myMember.friend_id)
              : myMember.linked_user_id  != null ? 'u' + myMember.linked_user_id
              : 'self';
      }
    }
    const selfShare = shares.find(s => s.member_key === myKey)?.total_share || 0;
    const selfPaid = paid.find(p => p.paid_by_key === myKey)?.total_paid || 0;
    const selfNet = selfPaid - selfShare;
    return { ...t, members, totalExpenses: Math.round(total * 100) / 100, expenseCount: cnt, selfNet: Math.round(selfNet * 100) / 100 };
  });
}

function getTripById(userId, tripId) {
  const d = getDb();
  const isOwner = d.prepare('SELECT id FROM trips WHERE id = ? AND user_id = ?').get(tripId, userId);
  const myMember = d.prepare('SELECT * FROM trip_members WHERE trip_id = ? AND linked_user_id = ?').get(tripId, userId);
  if (!isOwner && !myMember) return null;
  const trip = d.prepare('SELECT * FROM trips WHERE id = ?').get(tripId);
  const members = d.prepare('SELECT * FROM trip_members WHERE trip_id = ?').all(tripId);
  const expenses = d.prepare('SELECT * FROM trip_expenses WHERE trip_id = ? ORDER BY expense_date DESC, id DESC').all(tripId);
  const splitStmt = d.prepare('SELECT * FROM trip_expense_splits WHERE expense_id = ?');
  const expensesWithSplits = expenses.map(e => ({ ...e, splits: splitStmt.all(e.id) }));
  const userPermission = isOwner ? 'owner' : (myMember?.permission || 'edit');
  return { ...trip, members, expenses: expensesWithSplits, isOwner: !!isOwner, userPermission };
}

function updateTrip(userId, id, data) {
  const d = getDb();
  const fields = [];
  const params = [];
  if (data.name !== undefined) { fields.push('name=?'); params.push(data.name.trim()); }
  if (data.start_date !== undefined) { fields.push('start_date=?'); params.push(data.start_date); }
  if (data.end_date !== undefined) { fields.push('end_date=?'); params.push(data.end_date || null); }
  if (data.status !== undefined) { fields.push('status=?'); params.push(data.status); }
  if (fields.length === 0) return;
  params.push(id, userId);
  d.prepare(`UPDATE trips SET ${fields.join(',')} WHERE id=? AND user_id=?`).run(...params);
}

function deleteTrip(userId, id) {
  const d = getDb();
  return d.transaction(() => {
    const expenses = d.prepare('SELECT id FROM trip_expenses WHERE trip_id = ?').all(id);
    for (const e of expenses) d.prepare('DELETE FROM trip_expense_splits WHERE expense_id = ?').run(e.id);
    d.prepare('DELETE FROM trip_expenses WHERE trip_id = ?').run(id);
    d.prepare('DELETE FROM trip_members WHERE trip_id = ?').run(id);
    return d.prepare('DELETE FROM trips WHERE id = ? AND user_id = ?').run(id, userId);
  })();
}

function _checkTripEdit(d, userId, tripId) {
  const isOwner = d.prepare('SELECT id FROM trips WHERE id = ? AND user_id = ?').get(tripId, userId);
  if (isOwner) return true;
  const mem = d.prepare("SELECT permission FROM trip_members WHERE trip_id = ? AND linked_user_id = ?").get(tripId, userId);
  if (mem && mem.permission !== 'view') return true;
  return false;
}

function addTripExpense(userId, tripId, data) {
  const d = getDb();
  if (!_checkTripEdit(d, userId, tripId)) throw new Error('Trip not found');
  return d.transaction(() => {
    const exp = d.prepare('INSERT INTO trip_expenses (trip_id, paid_by_key, paid_by_name, details, amount, expense_date, split_mode) VALUES (?, ?, ?, ?, ?, ?, ?)').run(tripId, data.paid_by_key, data.paid_by_name, data.details, data.amount, data.expense_date, data.split_mode || 'equal');
    const expId = exp.lastInsertRowid;
    const splitStmt = d.prepare('INSERT INTO trip_expense_splits (expense_id, member_key, member_name, share_amount) VALUES (?, ?, ?, ?)');
    for (const s of (data.splits || [])) splitStmt.run(expId, s.member_key, s.member_name, s.share_amount);
    return expId;
  })();
}

function updateTripExpense(userId, expenseId, data) {
  const d = getDb();
  const exp = d.prepare('SELECT e.id, e.trip_id FROM trip_expenses e WHERE e.id=?').get(expenseId);
  if (!exp || !_checkTripEdit(d, userId, exp.trip_id)) throw new Error('Not found');
  return d.transaction(() => {
    d.prepare('UPDATE trip_expenses SET paid_by_key=?,paid_by_name=?,details=?,amount=?,expense_date=?,split_mode=? WHERE id=?').run(data.paid_by_key, data.paid_by_name, data.details, data.amount, data.expense_date, data.split_mode || 'equal', expenseId);
    d.prepare('DELETE FROM trip_expense_splits WHERE expense_id=?').run(expenseId);
    const splitStmt = d.prepare('INSERT INTO trip_expense_splits (expense_id, member_key, member_name, share_amount) VALUES (?, ?, ?, ?)');
    for (const s of (data.splits || [])) splitStmt.run(expenseId, s.member_key, s.member_name, s.share_amount);
  })();
}

function deleteTripExpense(userId, expenseId) {
  const d = getDb();
  const exp = d.prepare('SELECT e.id, e.trip_id FROM trip_expenses e WHERE e.id=?').get(expenseId);
  if (!exp || !_checkTripEdit(d, userId, exp.trip_id)) throw new Error('Not found');
  return d.transaction(() => {
    d.prepare('DELETE FROM trip_expense_splits WHERE expense_id=?').run(expenseId);
    d.prepare('DELETE FROM trip_expenses WHERE id=?').run(expenseId);
  })();
}

function toggleMemberLock(userId, memberId) {
  const d = getDb();
  const mem = d.prepare('SELECT m.id, m.is_locked FROM trip_members m JOIN trips t ON t.id=m.trip_id WHERE m.id=? AND t.user_id=?').get(memberId, userId);
  if (!mem) throw new Error('Not found');
  d.prepare('UPDATE trip_members SET is_locked=? WHERE id=?').run(mem.is_locked ? 0 : 1, memberId);
}

// ─── EMI functions ───────────────────────────────────────────

// Shared local-date helper (no UTC shift)
const _localDate = (dt) => {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d2 = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d2}`;
};

function saveEmiRecord(userId, data) {
  return getDb().prepare(
    'INSERT INTO emi_records (user_id,name,description,principal,annual_rate,tenure_months,monthly_emi,total_interest,gst_rate,total_gst,total_amount,grand_total,tag,credit_card_id,gst_month_offset,cc_processing_charge,cc_processing_gst_pct,for_friend,friend_name,planner_advance_month) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ).run(userId, data.name, data.description||null, data.principal, data.annual_rate, data.tenure_months, data.monthly_emi, data.total_interest, data.gst_rate||0, data.total_gst||0, data.total_amount, data.grand_total, data.tag||null, data.credit_card_id||null, data.gst_month_offset||0, data.cc_processing_charge||null, data.cc_processing_gst_pct||null, data.for_friend||0, data.friend_name||null, data.planner_advance_month ? 1 : 0);
}

// Derive live totals from actual installment rows (never trust stored grand_total/monthly_emi)
function _computeEmiLiveTotals(r, insts) {
  const today = new Date().toISOString().split('T')[0];
  const paidCount   = insts.filter(i => i.paid_amount >= i.emi_amount * 0.999).length;
  const partialCount = insts.filter(i => i.paid_amount > 0 && i.paid_amount < i.emi_amount * 0.999).length;
  const totalPaid   = Math.round(insts.reduce((s, i) => s + i.paid_amount, 0) * 100) / 100;
  // Grand total = sum of ALL installment EMI amounts (live, reflects edits)
  const grandTotal  = Math.round(insts.reduce((s, i) => s + i.emi_amount, 0) * 100) / 100;
  const remaining   = Math.round((grandTotal - totalPaid) * 100) / 100;
  // Monthly EMI = most common emi_amount among unpaid rows (or first installment)
  const unpaid = insts.filter(i => i.paid_amount === 0);
  const freq = {};
  unpaid.forEach(i => { freq[i.emi_amount] = (freq[i.emi_amount] || 0) + 1; });
  const monthlyEmi = unpaid.length > 0
    ? parseFloat(Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0])
    : (insts[0]?.emi_amount || r.monthly_emi);
  // Status
  let status = r.status;
  if (insts.length > 0) {
    if (paidCount === insts.length) status = 'completed';
    else if (r.start_date && r.start_date > today) status = 'pending';
    else if (r.start_date && r.start_date <= today) status = 'active';
  }
  return { grandTotal, monthlyEmi, totalPaid, remaining, paidCount, partialCount, status };
}

function getEmiRecords(userId, forFriend = 0) {
  const d = getDb();
  const records = d.prepare('SELECT * FROM emi_records WHERE user_id=? AND for_friend=? ORDER BY id DESC').all(userId, forFriend ? 1 : 0);
  return records.map(r => {
    if (r.status === 'saved') return { ...r, installments: [], paidCount: 0, totalPaid: 0, remaining: r.grand_total, monthly_emi: r.monthly_emi };
    const insts = d.prepare('SELECT * FROM emi_installments WHERE emi_id=? ORDER BY installment_no').all(r.id);
    const live = _computeEmiLiveTotals(r, insts);
    return { ...r, status: live.status, grand_total: live.grandTotal, monthly_emi: live.monthlyEmi,
      installments: insts, paidCount: live.paidCount, partialCount: live.partialCount,
      totalPaid: live.totalPaid, remaining: live.remaining };
  });
}

function getEmiRecord(userId, id) {
  const d = getDb();
  const r = d.prepare('SELECT * FROM emi_records WHERE id=? AND user_id=?').get(id, userId);
  if (!r) return null;
  const insts = d.prepare('SELECT * FROM emi_installments WHERE emi_id=? ORDER BY installment_no').all(id);
  if (insts.length === 0) return { ...r, installments: [], paidCount: 0, totalPaid: 0, remaining: r.grand_total };
  const live = _computeEmiLiveTotals(r, insts);
  return { ...r, status: live.status, grand_total: live.grandTotal, monthly_emi: live.monthlyEmi,
    installments: insts, paidCount: live.paidCount, totalPaid: live.totalPaid, remaining: live.remaining };
}

function updateEmiRecord(userId, id, data) {
  const d = getDb();
  const fields = [], params = [];
  if (data.name !== undefined)             { fields.push('name=?');             params.push(data.name); }
  if (data.description !== undefined)      { fields.push('description=?');      params.push(data.description||null); }
  if (data.tag !== undefined)              { fields.push('tag=?');              params.push(data.tag||null); }
  if (data.status !== undefined)           { fields.push('status=?');           params.push(data.status); }
  if (data.credit_card_id !== undefined)   { fields.push('credit_card_id=?');   params.push(data.credit_card_id||null); }
  if (data.gst_month_offset !== undefined) { fields.push('gst_month_offset=?'); params.push(data.gst_month_offset||0); }
  if (data.friend_name !== undefined)      { fields.push('friend_name=?');      params.push(data.friend_name||null); }
  if (data.planner_advance_month !== undefined) { fields.push('planner_advance_month=?'); params.push(data.planner_advance_month ? 1 : 0); }
  if (fields.length === 0) return;
  params.push(id, userId);
  d.prepare(`UPDATE emi_records SET ${fields.join(',')} WHERE id=? AND user_id=?`).run(...params);
}

function deleteEmiRecord(userId, id) {
  const d = getDb();
  d.prepare('DELETE FROM emi_installments WHERE emi_id=?').run(id);
  d.prepare('DELETE FROM emi_records WHERE id=? AND user_id=?').run(id, userId);
}

// Recalculate and sync grand_total + monthly_emi on emi_records from actual installments
function _syncEmiRecordTotals(d, emiId, newMonthlyEmi) {
  const rows = d.prepare('SELECT emi_amount FROM emi_installments WHERE emi_id=?').all(emiId);
  const grandTotal = Math.round(rows.reduce((s, r) => s + r.emi_amount, 0) * 100) / 100;
  const fields = ['grand_total=?', 'total_amount=?'];
  const params = [grandTotal, grandTotal];
  if (newMonthlyEmi !== undefined) { fields.push('monthly_emi=?'); params.push(newMonthlyEmi); }
  params.push(emiId);
  d.prepare('UPDATE emi_records SET ' + fields.join(',') + ' WHERE id=?').run(...params);
}

// Update a single installment's EMI amount — clear P&I breakdown (manually set)
function updateInstallmentAmount(userId, instId, emiAmount) {
  const d = getDb();
  const inst = d.prepare('SELECT i.* FROM emi_installments i JOIN emi_records r ON r.id=i.emi_id WHERE i.id=? AND r.user_id=?').get(instId, userId);
  if (!inst) throw new Error('Installment not found');
  d.prepare('UPDATE emi_installments SET emi_amount=?, principal_component=-1, interest_component=-1 WHERE id=?').run(emiAmount, instId);
  _syncEmiRecordTotals(d, inst.emi_id);
}

// Update a single installment's Interest, Principal, and EMI (all explicit)
function updateInstallmentComponents(userId, instId, { emi_amount, interest_component, principal_component }) {
  const d = getDb();
  const inst = d.prepare('SELECT i.* FROM emi_installments i JOIN emi_records r ON r.id=i.emi_id WHERE i.id=? AND r.user_id=?').get(instId, userId);
  if (!inst) throw new Error('Installment not found');
  d.prepare('UPDATE emi_installments SET emi_amount=?, interest_component=?, principal_component=? WHERE id=?')
    .run(emi_amount, interest_component, principal_component, instId);
  _syncEmiRecordTotals(d, inst.emi_id);
}

// Bulk update all unpaid installments — clear P&I breakdown (manually set)
function bulkUpdateInstallmentAmount(userId, emiId, emiAmount) {
  const d = getDb();
  const rec = d.prepare('SELECT * FROM emi_records WHERE id=? AND user_id=?').get(emiId, userId);
  if (!rec) throw new Error('EMI not found');
  d.prepare('UPDATE emi_installments SET emi_amount=?, principal_component=-1, interest_component=-1 WHERE emi_id=? AND paid_amount=0').run(emiAmount, emiId);
  _syncEmiRecordTotals(d, emiId, emiAmount);
}

// Auto-mark installments whose due_date is in the past as paid (for historical EMI entry)
function _autoMarkPastInstallmentsPaid(d, emiId) {
  const today = _localDate(new Date());
  d.prepare(
    "UPDATE emi_installments SET paid_amount=emi_amount, paid_date=due_date WHERE emi_id=? AND due_date < ? AND paid_amount=0"
  ).run(emiId, today);
}

// Find or create a CC billing cycle that covers a given date
function _getCycleForDate(d, cardId, userId, txnDate) {
  const existing = d.prepare(
    'SELECT * FROM cc_cycles WHERE card_id=? AND user_id=? AND cycle_start<=? AND cycle_end>=?'
  ).get(cardId, userId, txnDate, txnDate);
  if (existing) return existing;
  const card = d.prepare('SELECT * FROM credit_cards WHERE id=?').get(cardId);
  if (!card) return null;
  const dt = new Date(txnDate + 'T00:00:00');
  const billGenDay = card.bill_gen_day || 1;
  let cycleStart, cycleEnd;
  if (dt.getDate() <= billGenDay) {
    cycleStart = _localDate(new Date(dt.getFullYear(), dt.getMonth() - 1, billGenDay + 1));
    cycleEnd   = _localDate(new Date(dt.getFullYear(), dt.getMonth(),     billGenDay));
  } else {
    cycleStart = _localDate(new Date(dt.getFullYear(), dt.getMonth(),     billGenDay + 1));
    cycleEnd   = _localDate(new Date(dt.getFullYear(), dt.getMonth() + 1, billGenDay));
  }
  const dueEnd = new Date(cycleEnd + 'T00:00:00');
  dueEnd.setDate(dueEnd.getDate() + (card.due_days || 20));
  const check = d.prepare('SELECT * FROM cc_cycles WHERE card_id=? AND user_id=? AND cycle_start=? AND cycle_end=?')
    .get(cardId, userId, cycleStart, cycleEnd);
  if (check) return check;
  const r = d.prepare(
    "INSERT INTO cc_cycles (user_id,card_id,cycle_start,cycle_end,due_date,status) VALUES (?,?,?,?,?,'open')"
  ).run(userId, cardId, cycleStart, cycleEnd, _localDate(dueEnd));
  return d.prepare('SELECT * FROM cc_cycles WHERE id=?').get(r.lastInsertRowid);
}

// Create CC transactions for all installments of an EMI (called inside activation transaction)
function _insertEmiCcTxns(d, userId, emiId) {
  const rec = d.prepare('SELECT * FROM emi_records WHERE id=? AND user_id=?').get(emiId, userId);
  if (!rec || !rec.credit_card_id) return;
  // Remove any previously auto-created CC txns for this EMI
  const oldTxns = d.prepare("SELECT id,cycle_id FROM cc_txns WHERE source='emi' AND source_id=? AND user_id=?").all(emiId, userId);
  const affectedCycles = new Set(oldTxns.map(t => t.cycle_id));
  d.prepare("DELETE FROM cc_txns WHERE source='emi' AND source_id=? AND user_id=?").run(emiId, userId);
  affectedCycles.forEach(cid => _updateCycleTotals(d, cid));

  const insts = d.prepare('SELECT * FROM emi_installments WHERE emi_id=? ORDER BY installment_no').all(emiId);
  const txnStmt = d.prepare(
    'INSERT INTO cc_txns (user_id,card_id,cycle_id,txn_date,description,amount,discount_pct,discount_amount,net_amount,source,source_id) VALUES (?,?,?,?,?,?,0,0,?,?,?)'
  );
  const updatedCycles = new Set();
  for (const inst of insts) {
    const cycle = _getCycleForDate(d, rec.credit_card_id, userId, inst.due_date);
    if (!cycle) continue;
    let inserted = false;
    if (inst.principal_component > 0) {
      txnStmt.run(userId, rec.credit_card_id, cycle.id, inst.due_date, `${rec.name} - Principal`, inst.principal_component, inst.principal_component, 'emi', emiId);
      updatedCycles.add(cycle.id);
      inserted = true;
    }
    if (inst.interest_component > 0) {
      txnStmt.run(userId, rec.credit_card_id, cycle.id, inst.due_date, `${rec.name} - Interest`, inst.interest_component, inst.interest_component, 'emi', emiId);
      updatedCycles.add(cycle.id);
      inserted = true;
    }
    if (inst.gst_amount > 0) {
      let gstDate = inst.due_date;
      if (rec.gst_month_offset === 1) {
        const gdt = new Date(inst.due_date + 'T00:00:00');
        gdt.setMonth(gdt.getMonth() + 1);
        gstDate = _localDate(gdt);
      }
      const gstCycle = _getCycleForDate(d, rec.credit_card_id, userId, gstDate);
      if (gstCycle) {
        txnStmt.run(userId, rec.credit_card_id, gstCycle.id, gstDate, `${rec.name} - GST`, inst.gst_amount, inst.gst_amount, 'emi', emiId);
        updatedCycles.add(gstCycle.id);
      }
    }
    if (!inserted && inst.emi_amount > 0) {
      txnStmt.run(userId, rec.credit_card_id, cycle.id, inst.due_date, `${rec.name} - EMI`, inst.emi_amount, inst.emi_amount, 'emi', emiId);
      updatedCycles.add(cycle.id);
    }
  }
  // Processing charges — add to first installment's cycle
  if (insts.length && rec.cc_processing_charge > 0) {
    const firstCycle = _getCycleForDate(d, rec.credit_card_id, userId, insts[0].due_date);
    if (firstCycle) {
      txnStmt.run(userId, rec.credit_card_id, firstCycle.id, insts[0].due_date,
        `${rec.name} - File Processing`, rec.cc_processing_charge, rec.cc_processing_charge, 'emi', emiId);
      updatedCycles.add(firstCycle.id);
      if (rec.cc_processing_gst_pct > 0) {
        const gstAmt = Math.round(rec.cc_processing_charge * rec.cc_processing_gst_pct / 100 * 100) / 100;
        txnStmt.run(userId, rec.credit_card_id, firstCycle.id, insts[0].due_date,
          `${rec.name} - File Processing GST`, gstAmt, gstAmt, 'emi', emiId);
      }
    }
  }
  updatedCycles.forEach(cid => _updateCycleTotals(d, cid));
}

// Create expense entries for all installments of an EMI (called inside activation transaction)
function _insertEmiExpenses(d, userId, emiId, isExtra = 0) {
  const rec = d.prepare('SELECT * FROM emi_records WHERE id=? AND user_id=?').get(emiId, userId);
  if (!rec) return;
  // Remove previously auto-created expenses for this EMI
  d.prepare("DELETE FROM expenses WHERE source='emi' AND source_id=? AND user_id=?").run(emiId, userId);
  const insts = d.prepare('SELECT * FROM emi_installments WHERE emi_id=? ORDER BY installment_no').all(emiId);
  const expStmt = d.prepare('INSERT INTO expenses (user_id,item_name,amount,purchase_date,is_extra,source,source_id) VALUES (?,?,?,?,?,?,?)');
  for (const inst of insts) {
    const expDate = inst.due_date.slice(0, 7) + '-01';
    let amount = inst.emi_amount;
    if (inst.installment_no === 1 && rec.cc_processing_charge > 0) {
      const procGst = rec.cc_processing_gst_pct > 0
        ? Math.round(rec.cc_processing_charge * rec.cc_processing_gst_pct / 100 * 100) / 100
        : 0;
      amount = Math.round((amount + rec.cc_processing_charge + procGst) * 100) / 100;
    }
    expStmt.run(userId, `${rec.name} - Installment ${inst.installment_no}`, amount, expDate, isExtra ? 1 : 0, 'emi', emiId);
  }
  d.prepare('UPDATE emi_records SET expenses_added=1 WHERE id=?').run(emiId);
}

function addEmiExpensesManual(userId, emiId, expenseType = 0) {
  const d = getDb();
  const rec = d.prepare('SELECT * FROM emi_records WHERE id=? AND user_id=?').get(emiId, userId);
  if (!rec) throw new Error('EMI not found');
  if (rec.status !== 'active' && rec.status !== 'completed') throw new Error('EMI must be active to add expenses');
  d.transaction(() => { _insertEmiExpenses(d, userId, emiId, expenseType); })();
}

function addEmiToCreditCardManual(userId, emiId, creditCardId, gstMonthOffset = 0) {
  const d = getDb();
  const rec = d.prepare('SELECT * FROM emi_records WHERE id=? AND user_id=?').get(emiId, userId);
  if (!rec) throw new Error('EMI not found');
  if (rec.status !== 'active' && rec.status !== 'completed' && rec.status !== 'pending') {
    throw new Error('EMI must be active to add credit card billing');
  }
  const card = d.prepare('SELECT * FROM credit_cards WHERE id=? AND user_id=? AND is_active=1').get(creditCardId, userId);
  if (!card) throw new Error('Credit card not found');
  d.transaction(() => {
    d.prepare('UPDATE emi_records SET credit_card_id=?, gst_month_offset=? WHERE id=? AND user_id=?')
      .run(creditCardId, parseInt(gstMonthOffset) || 0, emiId, userId);
    _insertEmiCcTxns(d, userId, emiId);
  })();
}

// Activate with a custom schedule (from calculator edits)
function activateEmiWithSchedule(userId, emiId, startDate, schedule, addExpenses = false, expenseType = 0) {
  const d = getDb();
  const r = d.prepare('SELECT * FROM emi_records WHERE id=? AND user_id=?').get(emiId, userId);
  if (!r) throw new Error('EMI not found');
  d.transaction(() => {
    d.prepare('DELETE FROM emi_installments WHERE emi_id=?').run(emiId);
    const stmt = d.prepare('INSERT INTO emi_installments (emi_id,installment_no,due_date,principal_component,interest_component,gst_amount,emi_amount) VALUES (?,?,?,?,?,?,?)');
    schedule.forEach((s, idx) => {
      const dt = new Date(startDate + 'T00:00:00');
      dt.setMonth(dt.getMonth() + idx);
      const dueDate = dt.toISOString().split('T')[0];
      stmt.run(emiId, s.installment_no || idx + 1, dueDate, s.principal_component, s.interest_component, s.gst_amount || 0, s.emi_amount);
    });
    d.prepare("UPDATE emi_records SET status='active', start_date=? WHERE id=?").run(startDate, emiId);
    // Sync totals from the custom schedule
    const grandTotal = Math.round(schedule.reduce((s, x) => s + x.emi_amount, 0) * 100) / 100;
    const monthlyEmi = schedule.length > 0 ? schedule[0].emi_amount : r.monthly_emi;
    d.prepare('UPDATE emi_records SET grand_total=?, total_amount=?, monthly_emi=? WHERE id=?').run(grandTotal, grandTotal, monthlyEmi, emiId);
    _autoMarkPastInstallmentsPaid(d, emiId);
    _insertEmiCcTxns(d, userId, emiId);
    if (addExpenses) _insertEmiExpenses(d, userId, emiId, expenseType);
    else {
      d.prepare("DELETE FROM expenses WHERE source='emi' AND source_id=? AND user_id=?").run(emiId, userId);
      d.prepare('UPDATE emi_records SET expenses_added=0 WHERE id=?').run(emiId);
    }
  })();
}

function activateEmi(userId, id, startDate, addExpenses = false, expenseType = 0) {
  const d = getDb();
  const r = d.prepare('SELECT * FROM emi_records WHERE id=? AND user_id=?').get(id, userId);
  if (!r) throw new Error('EMI not found');
  return d.transaction(() => {
    // Delete existing installments if re-activating
    d.prepare('DELETE FROM emi_installments WHERE emi_id=?').run(id);
    const rate = r.annual_rate / 12 / 100;
    let bal = r.principal;
    const stmt = d.prepare('INSERT INTO emi_installments (emi_id,installment_no,due_date,principal_component,interest_component,gst_amount,emi_amount) VALUES (?,?,?,?,?,?,?)');
    for (let m = 1; m <= r.tenure_months; m++) {
      const interest = Math.round(bal * rate * 100) / 100;
      const princ = Math.round((r.monthly_emi - interest) * 100) / 100;
      const gst = Math.round(interest * (r.gst_rate / 100) * 100) / 100;
      const emiAmt = Math.round((r.monthly_emi + gst) * 100) / 100;
      const due = new Date(startDate + 'T00:00:00');
      due.setMonth(due.getMonth() + (m - 1));
      stmt.run(id, m, _localDate(due), Math.max(0, princ), interest, gst, emiAmt);
      bal = Math.max(0, Math.round((bal - princ) * 100) / 100);
    }
    d.prepare("UPDATE emi_records SET status='active', start_date=? WHERE id=?").run(startDate, id);
    _autoMarkPastInstallmentsPaid(d, id);
    _insertEmiCcTxns(d, userId, id);
    if (addExpenses) _insertEmiExpenses(d, userId, id, expenseType);
    else {
      d.prepare("DELETE FROM expenses WHERE source='emi' AND source_id=? AND user_id=?").run(id, userId);
      d.prepare('UPDATE emi_records SET expenses_added=0 WHERE id=?').run(id);
    }
  })();
}

function payInstallment(userId, instId, paidAmount, paidDate, notes, bankAccountId) {
  const d = getDb();
  const inst = d.prepare('SELECT i.* FROM emi_installments i JOIN emi_records r ON r.id=i.emi_id WHERE i.id=? AND r.user_id=?').get(instId, userId);
  if (!inst) throw new Error('Installment not found');
  const prevPaid = parseFloat(inst.paid_amount) || 0;
  d.prepare('UPDATE emi_installments SET paid_amount=?,paid_date=?,notes=? WHERE id=?').run(paidAmount, paidDate||new Date().toISOString().split('T')[0], notes||null, instId);
  // Deduct from bank account if provided
  if (bankAccountId) {
    const diff = paidAmount - prevPaid;
    if (diff !== 0) {
      d.prepare('UPDATE bank_accounts SET balance = balance - ? WHERE id=? AND user_id=?').run(diff, bankAccountId, userId);
    }
  }
  // Check if all paid → mark record completed
  const emiId = inst.emi_id;
  const all = d.prepare('SELECT * FROM emi_installments WHERE emi_id=?').all(emiId);
  const allPaid = all.every(i => (i.id === instId ? paidAmount : i.paid_amount) >= i.emi_amount * 0.999);
  if (allPaid) d.prepare("UPDATE emi_records SET status='completed' WHERE id=?").run(emiId);
}

function getEmiMonthSummary(userId, yearMonth) {
  // yearMonth = 'YYYY-MM'
  const d = getDb();
  const insts = d.prepare(`
    SELECT i.*, r.name, r.tag, r.user_id FROM emi_installments i
    JOIN emi_records r ON r.id=i.emi_id
    WHERE r.user_id=? AND substr(i.due_date,1,7)=?
    ORDER BY i.due_date, r.name
  `).all(userId, yearMonth);
  const totalDue = insts.reduce((s, i) => s + i.emi_amount, 0);
  const totalPaid = insts.reduce((s, i) => s + i.paid_amount, 0);
  return { installments: insts, totalDue: Math.round(totalDue * 100) / 100, totalPaid: Math.round(totalPaid * 100) / 100 };
}

// ─── Admin / User Management ─────────────────────────────────
function getAllUsers() {
  const d = getDb();
  const users = d.prepare('SELECT id, username, email, display_name, role, mobile, is_active, created_at FROM users ORDER BY id').all();
  return users.map(u => {
    const sub = d.prepare(`SELECT s.*, p.name as plan_name FROM user_subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.user_id=? AND s.status='active' ORDER BY s.id DESC LIMIT 1`).get(u.id);
    return { ...u, subscription: sub || null };
  });
}

function updateUserAdmin(id, data) {
  const d = getDb();
  const fields = [], params = [];
  if (data.role !== undefined)         { fields.push('role=?');         params.push(data.role); }
  if (data.mobile !== undefined)       { fields.push('mobile=?');       params.push(data.mobile || null); }
  if (data.is_active !== undefined)    { fields.push('is_active=?');    params.push(data.is_active ? 1 : 0); }
  if (data.display_name !== undefined) { fields.push('display_name=?'); params.push(data.display_name.trim()); }
  if (fields.length === 0) return;
  params.push(id);
  d.prepare(`UPDATE users SET ${fields.join(',')} WHERE id=?`).run(...params);
}

function resetUserPassword(id, newHash) {
  getDb().prepare('UPDATE users SET password_hash=? WHERE id=?').run(newHash, id);
}

// ─── Plans ───────────────────────────────────────────────────
function getPlans() {
  const d = getDb();
  const plans = d.prepare('SELECT * FROM plans ORDER BY id').all();
  const pageStmt = d.prepare('SELECT page_key FROM plan_pages WHERE plan_id=?');
  return plans.map(p => ({ ...p, pages: pageStmt.all(p.id).map(r => r.page_key) }));
}

function createPlan(data) {
  const d = getDb();
  return d.transaction(() => {
    if (data.auto_assign_on_signup) {
      d.prepare('UPDATE plans SET auto_assign_on_signup=0').run();
    }
    const plan = d.prepare('INSERT INTO plans (name,description,price_monthly,price_yearly,is_free,is_active,auto_assign_on_signup) VALUES (?,?,?,?,?,?,?)')
      .run(
        data.name,
        data.description || '',
        data.price_monthly || 0,
        data.price_yearly || 0,
        data.is_free ? 1 : 0,
        data.is_active != null ? (data.is_active ? 1 : 0) : 1,
        data.auto_assign_on_signup ? 1 : 0
      );
    const planId = plan.lastInsertRowid;
    const pStmt = d.prepare('INSERT INTO plan_pages (plan_id,page_key) VALUES (?,?)');
    for (const pg of (data.pages||[])) pStmt.run(planId, pg);
    return planId;
  })();
}

function updatePlan(id, data) {
  const d = getDb();
  d.transaction(() => {
    const fields = [], params = [];
    if (data.name !== undefined)          { fields.push('name=?');          params.push(data.name); }
    if (data.description !== undefined)   { fields.push('description=?');   params.push(data.description); }
    if (data.price_monthly !== undefined) { fields.push('price_monthly=?'); params.push(data.price_monthly); }
    if (data.price_yearly !== undefined)  { fields.push('price_yearly=?');  params.push(data.price_yearly); }
    if (data.is_free !== undefined)       { fields.push('is_free=?');       params.push(data.is_free?1:0); }
    if (data.is_active !== undefined)     { fields.push('is_active=?');     params.push(data.is_active?1:0); }
    if (data.auto_assign_on_signup !== undefined) {
      if (data.auto_assign_on_signup) d.prepare('UPDATE plans SET auto_assign_on_signup=0 WHERE id!=?').run(id);
      fields.push('auto_assign_on_signup=?');
      params.push(data.auto_assign_on_signup ? 1 : 0);
    }
    if (fields.length > 0) { params.push(id); d.prepare(`UPDATE plans SET ${fields.join(',')} WHERE id=?`).run(...params); }
    if (data.pages !== undefined) {
      d.prepare('DELETE FROM plan_pages WHERE plan_id=?').run(id);
      const pStmt = d.prepare('INSERT INTO plan_pages (plan_id,page_key) VALUES (?,?)');
      for (const pg of data.pages) pStmt.run(id, pg);
    }
  })();
}

function deletePlan(id) {
  const d = getDb();
  d.prepare('DELETE FROM plan_pages WHERE plan_id=?').run(id);
  d.prepare('DELETE FROM plans WHERE id=?').run(id);
}

// ─── Subscriptions ───────────────────────────────────────────
function getSubscriptions() {
  return getDb().prepare(`SELECT s.*,u.username,u.email,u.display_name,p.name as plan_name FROM user_subscriptions s JOIN users u ON u.id=s.user_id JOIN plans p ON p.id=s.plan_id ORDER BY s.id DESC`).all();
}

function createSubscription(data) {
  return getDb().prepare('INSERT INTO user_subscriptions (user_id,plan_id,billing_cycle,start_date,end_date,status) VALUES (?,?,?,?,?,?)')
    .run(data.user_id, data.plan_id, data.billing_cycle||'monthly', data.start_date, data.end_date||null, 'active');
}

function assignSignupPlanToUser(userId) {
  const d = getDb();
  const plan = d.prepare('SELECT id FROM plans WHERE is_active=1 AND auto_assign_on_signup=1 ORDER BY id DESC LIMIT 1').get();
  if (!plan) return null;

  const existing = d.prepare("SELECT id FROM user_subscriptions WHERE user_id=? AND status='active'").get(userId);
  if (existing) return null;

  return createSubscription({
    user_id: userId,
    plan_id: plan.id,
    billing_cycle: 'lifetime',
    start_date: new Date().toISOString().slice(0, 10),
    end_date: null,
  });
}

function updateSubscription(id, data) {
  const d = getDb();
  const fields = [], params = [];
  if (data.status !== undefined)        { fields.push('status=?');        params.push(data.status); }
  if (data.end_date !== undefined)      { fields.push('end_date=?');      params.push(data.end_date||null); }
  if (data.billing_cycle !== undefined) { fields.push('billing_cycle=?'); params.push(data.billing_cycle); }
  if (data.plan_id !== undefined)       { fields.push('plan_id=?');       params.push(data.plan_id); }
  if (fields.length === 0) return;
  params.push(id);
  d.prepare(`UPDATE user_subscriptions SET ${fields.join(',')} WHERE id=?`).run(...params);
}

function deleteSubscription(id) {
  getDb().prepare('DELETE FROM user_subscriptions WHERE id=?').run(id);
}

function getUserAccessiblePages(userId) {
  const d = getDb();
  const user = d.prepare('SELECT role FROM users WHERE id=?').get(userId);
  if (!user) return ['dashboard'];
  if (user.role === 'admin') return ['dashboard','expenses','friends','divide','trips','reports','emi','emitracker','friendemis','creditcards','banks','planner','tracker','recurring','ailookup'];
  const pages = new Set(['dashboard']);
  // Free plans — always available
  const freePlans = d.prepare('SELECT id FROM plans WHERE is_free=1 AND is_active=1').all();
  for (const fp of freePlans) {
    d.prepare('SELECT page_key FROM plan_pages WHERE plan_id=?').all(fp.id).forEach(r => pages.add(r.page_key));
  }
  // Active subscriptions
  const subs = d.prepare(`SELECT plan_id FROM user_subscriptions WHERE user_id=? AND status='active' AND (end_date IS NULL OR end_date >= date('now'))`).all(userId);
  for (const s of subs) {
    d.prepare('SELECT page_key FROM plan_pages WHERE plan_id=?').all(s.plan_id).forEach(r => pages.add(r.page_key));
  }
  return [...pages];
}

function getAiLookupStatus(userId) {
  const d = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const dailyFreeLimit = 10;
  const usage = d.prepare('SELECT query_count FROM ai_lookup_usage WHERE user_id=? AND usage_date=?').get(userId, today);
  const usedToday = usage?.query_count || 0;
  const activeSub = d.prepare(`
    SELECT p.is_free, p.name
    FROM user_subscriptions s
    JOIN plans p ON p.id = s.plan_id
    WHERE s.user_id=? AND s.status='active' AND (s.end_date IS NULL OR s.end_date >= date('now'))
    ORDER BY s.id DESC
    LIMIT 1
  `).get(userId);
  const hasPaidPlan = !!(activeSub && !activeSub.is_free);
  const remainingFreeQueries = Math.max(0, dailyFreeLimit - usedToday);
  const canAsk = hasPaidPlan || remainingFreeQueries > 0;
  return {
    date: today,
    dailyFreeLimit,
    usedToday,
    remainingFreeQueries,
    hasPaidPlan,
    planName: activeSub?.name || null,
    canAsk,
    message: hasPaidPlan
      ? `Unlimited AI lookups available on your ${activeSub.name} plan.`
      : `Free plan includes ${dailyFreeLimit} AI lookups per day. ${remainingFreeQueries} remaining today.`,
  };
}

function recordAiLookupUsage(userId) {
  const d = getDb();
  const today = new Date().toISOString().slice(0, 10);
  d.prepare(`
    INSERT INTO ai_lookup_usage (user_id, usage_date, query_count, updated_at)
    VALUES (?, ?, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, usage_date)
    DO UPDATE SET query_count = query_count + 1, updated_at = CURRENT_TIMESTAMP
  `).run(userId, today);
  return getAiLookupStatus(userId);
}

// ─── OTP ─────────────────────────────────────────────────────
function generateOtp(userId, purpose, channel) {
  const d = getDb();
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  d.prepare('UPDATE otps SET used=1 WHERE user_id=? AND purpose=? AND used=0').run(userId, purpose);
  d.prepare('INSERT INTO otps (user_id,otp_code,purpose,channel,expires_at) VALUES (?,?,?,?,?)').run(userId, code, purpose, channel||'email', expiresAt);
  return code;
}

function verifyOtp(userId, purpose, code) {
  const d = getDb();
  const otp = d.prepare("SELECT * FROM otps WHERE user_id=? AND purpose=? AND otp_code=? AND used=0 AND expires_at > datetime('now')").get(userId, purpose, code);
  if (!otp) return false;
  d.prepare('UPDATE otps SET used=1 WHERE id=?').run(otp.id);
  return true;
}

// ─── Password Reset ───────────────────────────────────────────
function createPasswordReset(userId) {
  const d = getDb();
  const crypto = require('crypto');
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  d.prepare('UPDATE password_resets SET used=1 WHERE user_id=? AND used=0').run(userId);
  d.prepare('INSERT INTO password_resets (user_id,token,expires_at) VALUES (?,?,?)').run(userId, token, expiresAt);
  return token;
}

function getPasswordResetByToken(token) {
  return getDb().prepare("SELECT * FROM password_resets WHERE token=? AND used=0 AND expires_at > datetime('now')").get(token);
}

function usePasswordReset(token, newHash) {
  const d = getDb();
  const reset = getPasswordResetByToken(token);
  if (!reset) return false;
  d.prepare('UPDATE users SET password_hash=? WHERE id=?').run(newHash, reset.user_id);
  d.prepare('UPDATE password_resets SET used=1 WHERE id=?').run(reset.id);
  return true;
}

// ─── BANK ACCOUNTS ────────────────────────────────────────────────────────────

function getBankAccounts(userId) {
  return getDb().prepare("SELECT * FROM bank_accounts WHERE user_id=? AND is_active=1 ORDER BY is_default DESC, created_at ASC").all(userId);
}
function addBankAccount(userId, a) {
  const d = getDb();
  const res = d.prepare(
    'INSERT INTO bank_accounts (user_id, bank_name, account_name, account_type, balance, min_balance) VALUES (?,?,?,?,?,?)'
  ).run(userId, a.bank_name, a.account_name || null, a.account_type || 'savings', a.balance || 0, a.min_balance || 0);
  // If no other bank exists, make this one default
  const count = d.prepare('SELECT COUNT(*) as c FROM bank_accounts WHERE user_id=? AND is_active=1').get(userId).c;
  if (count === 1) d.prepare('UPDATE bank_accounts SET is_default=1 WHERE id=?').run(res.lastInsertRowid);
  return res;
}
function updateBankAccount(userId, id, a) {
  getDb().prepare(
    'UPDATE bank_accounts SET bank_name=?, account_name=?, account_type=?, balance=?, min_balance=? WHERE id=? AND user_id=?'
  ).run(a.bank_name, a.account_name || null, a.account_type || 'savings', a.balance || 0, a.min_balance || 0, id, userId);
}
function updateBankBalance(userId, id, balance) {
  getDb().prepare('UPDATE bank_accounts SET balance=? WHERE id=? AND user_id=?').run(balance, id, userId);
}
function setDefaultBankAccount(userId, id) {
  const d = getDb();
  d.prepare('UPDATE bank_accounts SET is_default=0 WHERE user_id=?').run(userId);
  d.prepare('UPDATE bank_accounts SET is_default=1 WHERE id=? AND user_id=?').run(id, userId);
}
function deleteBankAccount(userId, id) {
  const d = getDb();
  d.prepare('DELETE FROM bank_accounts WHERE id=? AND user_id=?').run(id, userId);
  // If deleted bank was default, set next bank as default
  const next = d.prepare('SELECT id FROM bank_accounts WHERE user_id=? AND is_active=1 ORDER BY created_at ASC LIMIT 1').get(userId);
  if (next) d.prepare('UPDATE bank_accounts SET is_default=1 WHERE id=?').run(next.id);
}

// ─── DEFAULT PAYMENTS ─────────────────────────────────────────────────────────

function getDefaultPayments(userId) {
  return getDb().prepare("SELECT * FROM default_payments WHERE user_id=? ORDER BY due_day ASC, name ASC").all(userId);
}
function addDefaultPayment(userId, p) {
  return getDb().prepare(
    'INSERT INTO default_payments (user_id, name, amount, due_day, interval_months, start_month, category, bank_account_id, auto_detect_bank) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(userId, p.name, p.amount, p.due_day || 1, 1, null, p.category || null, p.bank_account_id || null, p.auto_detect_bank ? 1 : 0);
}
function updateDefaultPayment(userId, id, p) {
  getDb().prepare(
    'UPDATE default_payments SET name=?, amount=?, due_day=?, interval_months=?, start_month=?, category=?, is_active=?, bank_account_id=?, auto_detect_bank=? WHERE id=? AND user_id=?'
  ).run(p.name, p.amount, p.due_day || 1, 1, null, p.category || null, p.is_active != null ? p.is_active : 1, p.bank_account_id || null, p.auto_detect_bank ? 1 : 0, id, userId);
}
function deleteDefaultPayment(userId, id) {
  getDb().prepare('DELETE FROM default_payments WHERE id=? AND user_id=?').run(id, userId);
}

// ─── MONTHLY PAYMENTS ─────────────────────────────────────────────────────────

function generateMonthlyPayments(userId, month) {
  const d = getDb();
  const defaults = d.prepare("SELECT * FROM default_payments WHERE user_id=? AND is_active=1").all(userId);
  const recurringEntries = d.prepare(
    "SELECT * FROM recurring_entries WHERE user_id=? AND is_active=1 AND type='expense' AND (card_id IS NULL OR card_id=0)"
  ).all(userId);
  const trackerPlannerItems = _getDailyTrackerPlannerItems(userId, month);
  const [yr, mo] = month.split('-').map(Number);
  for (const dp of defaults) {
    const exists = d.prepare(
      'SELECT id FROM monthly_payments WHERE user_id=? AND month=? AND default_payment_id=?'
    ).get(userId, month, dp.id);
    if (exists) continue; // already exists (including skipped records)
    const dueDay = Math.min(dp.due_day, new Date(yr, mo, 0).getDate()); // clamp to last day of month
    const dueDate = `${month}-${String(dueDay).padStart(2, '0')}`;
    // Resolve bank: auto_detect_bank → use default bank account
    let bankAccountId = dp.bank_account_id || null;
    if (dp.auto_detect_bank) {
      const defBank = d.prepare('SELECT id FROM bank_accounts WHERE user_id=? AND is_default=1 AND is_active=1 LIMIT 1').get(userId);
      if (defBank) bankAccountId = defBank.id;
    }
    d.prepare(
      'INSERT INTO monthly_payments (user_id, default_payment_id, month, name, amount, due_date, bank_account_id) VALUES (?,?,?,?,?,?,?)'
    ).run(userId, dp.id, month, dp.name, dp.amount, dueDate, bankAccountId);
  }
  for (const entry of recurringEntries) {
    if (!_recurringEntryAppliesToMonth(entry, month)) continue;
    const exists = d.prepare(
      'SELECT id FROM monthly_payments WHERE user_id=? AND month=? AND recurring_entry_id=?'
    ).get(userId, month, entry.id);
    if (exists) continue;
    d.prepare(
      'INSERT INTO monthly_payments (user_id, recurring_entry_id, month, name, amount, due_date, bank_account_id, notes) VALUES (?,?,?,?,?,?,?,?)'
    ).run(userId, entry.id, month, entry.description, entry.amount, `${month}-01`, null, 'Recurring entry');
  }
  for (const item of trackerPlannerItems) {
    const exists = d.prepare(
      'SELECT id FROM monthly_payments WHERE user_id=? AND month=? AND daily_tracker_id=? AND tracker_source_month=?'
    ).get(userId, month, item.daily_tracker_id, item.tracker_source_month);
    if (exists) continue;
    d.prepare(
      'INSERT INTO monthly_payments (user_id, daily_tracker_id, tracker_source_month, month, name, amount, due_date, bank_account_id, notes) VALUES (?,?,?,?,?,?,?,?,?)'
    ).run(userId, item.daily_tracker_id, item.tracker_source_month, month, item.name, item.amount, item.due_date, null, item.notes || 'Daily tracker total');
  }
}

function getMonthlyPayments(userId, month) {
  const d = getDb();
  generateMonthlyPayments(userId, month);
  return d.prepare(
    "SELECT * FROM monthly_payments WHERE user_id=? AND month=? AND (is_skipped IS NULL OR is_skipped=0) ORDER BY due_date ASC, name ASC"
  ).all(userId, month);
}

function getSkippedPayments(userId, month) {
  return getDb().prepare(
    "SELECT * FROM monthly_payments WHERE user_id=? AND month=? AND is_skipped=1 ORDER BY due_date ASC, name ASC"
  ).all(userId, month);
}

function restoreMonthlyPayment(userId, id) {
  getDb().prepare('UPDATE monthly_payments SET is_skipped=0 WHERE id=? AND user_id=?').run(id, userId);
}

function addMonthlyPayment(userId, p) {
  const d = getDb();
  return d.prepare(
    'INSERT INTO monthly_payments (user_id, month, name, amount, due_date, notes, bank_account_id) VALUES (?,?,?,?,?,?,?)'
  ).run(userId, p.month, p.name, p.amount, p.due_date || null, p.notes || null, p.bank_account_id || null);
}

function updateMonthlyPayment(userId, id, p) {
  getDb().prepare(
    'UPDATE monthly_payments SET name=?, amount=?, due_date=?, notes=?, bank_account_id=? WHERE id=? AND user_id=?'
  ).run(p.name, p.amount, p.due_date || null, p.notes || null, p.bank_account_id || null, id, userId);
}

function deleteMonthlyPayment(userId, id) {
  const d = getDb();
  const p = d.prepare('SELECT * FROM monthly_payments WHERE id=? AND user_id=?').get(id, userId);
  if (!p) return;
  if (p.default_payment_id) {
    // Recurring payment — mark as skipped so generateMonthlyPayments won't re-create it
    d.prepare('UPDATE monthly_payments SET is_skipped=1 WHERE id=?').run(id);
  } else {
    d.prepare('DELETE FROM monthly_payments WHERE id=? AND user_id=?').run(id, userId);
  }
}

function hardDeleteMonthlyPayment(userId, id) {
  getDb().prepare('DELETE FROM monthly_payments WHERE id=? AND user_id=?').run(id, userId);
}

function payMonthlyPayment(userId, id, paidAmount, paidDate) {
  const d = getDb();
  const p = d.prepare('SELECT * FROM monthly_payments WHERE id=? AND user_id=?').get(id, userId);
  if (!p) throw new Error('Payment not found');
  const paid = parseFloat(paidAmount) || 0;
  const prevPaid = parseFloat(p.paid_amount) || 0;
  const status = paid <= 0 ? 'pending' : paid >= p.amount - 0.01 ? 'paid' : 'partial';
  d.prepare('UPDATE monthly_payments SET paid_amount=?, paid_date=?, status=? WHERE id=?')
    .run(paid, paid > 0 ? (paidDate || new Date().toISOString().split('T')[0]) : null, status, id);
  // Adjust bank account balance if linked
  if (p.bank_account_id) {
    const diff = paid - prevPaid; // positive = more paid, negative = refunded/unmarked
    if (diff !== 0) {
      d.prepare('UPDATE bank_accounts SET balance = balance - ? WHERE id=? AND user_id=?')
        .run(diff, p.bank_account_id, userId);
    }
  }
}

// ─── CREDIT CARDS ─────────────────────────────────────────────────────────────

function _getCcCyclePeriod(billGenDay) {
  const today = new Date();
  const day = today.getDate();
  const y = today.getFullYear(), m = today.getMonth(); // 0-indexed
  let cycleStart, cycleEnd;
  if (day <= billGenDay) {
    // Before bill date: cycle started after bill day of previous month
    const s = new Date(y, m - 1, billGenDay + 1);
    const e = new Date(y, m, billGenDay);
    cycleStart = _localDate(s);
    cycleEnd   = _localDate(e);
  } else {
    // After bill date: cycle started after bill day of this month
    const s = new Date(y, m, billGenDay + 1);
    const e = new Date(y, m + 1, billGenDay);
    cycleStart = _localDate(s);
    cycleEnd   = _localDate(e);
  }
  return { cycleStart, cycleEnd };
}

function _getOrCreateCurrentCycle(d, cardId, userId) {
  const today = _localDate(new Date());
  // Find the open cycle whose date range covers today
  let cycle = d.prepare(
    "SELECT * FROM cc_cycles WHERE card_id=? AND user_id=? AND status='open' AND cycle_start<=? AND cycle_end>=?"
  ).get(cardId, userId, today, today);
  if (cycle) return cycle;
  const card = d.prepare('SELECT * FROM credit_cards WHERE id=? AND user_id=?').get(cardId, userId);
  if (!card) return null;
  const { cycleStart, cycleEnd } = _getCcCyclePeriod(card.bill_gen_day);
  const dueDate = new Date(cycleEnd + 'T00:00:00');
  dueDate.setDate(dueDate.getDate() + (card.due_days || 20));
  // Check if cycle for current period already exists (open or otherwise)
  const existing = d.prepare(
    'SELECT * FROM cc_cycles WHERE card_id=? AND user_id=? AND cycle_start=? AND cycle_end=?'
  ).get(cardId, userId, cycleStart, cycleEnd);
  if (existing) return existing;
  const r = d.prepare(
    "INSERT INTO cc_cycles (user_id, card_id, cycle_start, cycle_end, due_date, status) VALUES (?,?,?,?,?,'open')"
  ).run(userId, cardId, cycleStart, cycleEnd, _localDate(dueDate));
  return d.prepare('SELECT * FROM cc_cycles WHERE id=?').get(r.lastInsertRowid);
}

function _updateCycleTotals(d, cycleId) {
  const cycle = d.prepare('SELECT manual_total_override FROM cc_cycles WHERE id=?').get(cycleId);
  if (cycle && cycle.manual_total_override) return;
  const t = d.prepare(
    'SELECT COUNT(*) as txn_count, COALESCE(SUM(amount),0) as ta, COALESCE(SUM(discount_amount),0) as td, COALESCE(SUM(net_amount),0) as np FROM cc_txns WHERE cycle_id=?'
  ).get(cycleId);
  if (!t.txn_count) return;
  d.prepare('UPDATE cc_cycles SET total_amount=?, total_discount=?, net_payable=? WHERE id=?')
    .run(t.ta, t.td, t.np, cycleId);
}

function _autoClosePastCcCycles(d, userId, cardId = null) {
  const today = _localDate(new Date());
  const whereCard = cardId ? ' AND card_id=?' : '';
  const cycles = d.prepare(
    `SELECT id, net_payable, paid_amount, paid_date
     FROM cc_cycles
     WHERE user_id=? AND status='open' AND cycle_end < ?${whereCard}`
  ).all(...(cardId ? [userId, today, cardId] : [userId, today]));
  if (!cycles.length) return;

  const update = d.prepare(
    "UPDATE cc_cycles SET status=?, paid_amount=?, paid_date=?, closed_at=COALESCE(closed_at, datetime('now')) WHERE id=?"
  );
  const run = d.transaction((items) => {
    for (const cycle of items) {
      const paid = parseFloat(cycle.paid_amount) || 0;
      const due = parseFloat(cycle.net_payable) || 0;
      const status = paid >= due - 0.01 ? 'paid' : paid > 0 ? 'partial' : 'billed';
      update.run(status, paid, cycle.paid_date || null, cycle.id);
    }
  });
  run(cycles);
}

function addCreditCard(userId, card) {
  const d = getDb();
  return d.prepare(
    'INSERT INTO credit_cards (user_id, bank_name, card_name, last4, expiry_month, expiry_year, bill_gen_day, due_days, default_discount_pct, credit_limit) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).run(userId, card.bank_name, card.card_name, card.last4, card.expiry_month || null, card.expiry_year || null,
    card.bill_gen_day || 1, card.due_days || 20, card.default_discount_pct || 0, card.credit_limit || 0);
}

function updateCreditCard(userId, id, card) {
  const d = getDb();
  d.prepare(
    'UPDATE credit_cards SET bank_name=?, card_name=?, last4=?, expiry_month=?, expiry_year=?, bill_gen_day=?, due_days=?, default_discount_pct=?, credit_limit=? WHERE id=? AND user_id=?'
  ).run(card.bank_name, card.card_name, card.last4, card.expiry_month || null, card.expiry_year || null,
    card.bill_gen_day || 1, card.due_days || 20, card.default_discount_pct || 0, card.credit_limit || 0, id, userId);
}

function deleteCreditCard(userId, id) {
  const d = getDb();
  d.prepare('DELETE FROM credit_cards WHERE id=? AND user_id=?').run(id, userId);
}

function getCreditCards(userId) {
  const d = getDb();
  _autoClosePastCcCycles(d, userId);
  const cards = d.prepare("SELECT * FROM credit_cards WHERE user_id=? AND is_active=1 ORDER BY created_at DESC").all(userId);
  return cards.map(card => {
    const today = _localDate(new Date());
    const cycle = d.prepare(
      "SELECT * FROM cc_cycles WHERE card_id=? AND user_id=? AND status='open' AND cycle_start<=? AND cycle_end>=?"
    ).get(card.id, userId, today, today);
    const allTotals = d.prepare(
      'SELECT COALESCE(SUM(amount),0) as total_spent, COALESCE(SUM(net_amount),0) as total_net, COUNT(*) as txn_count FROM cc_txns WHERE card_id=? AND user_id=?'
    ).get(card.id, userId);
    return { ...card, currentCycle: cycle || null, totalSpent: allTotals.total_spent, totalNet: allTotals.total_net, totalTxns: allTotals.txn_count };
  });
}

function getCreditCard(userId, id) {
  return getDb().prepare('SELECT * FROM credit_cards WHERE id=? AND user_id=?').get(id, userId);
}

function addCcTxn(userId, txn) {
  const d = getDb();
  const card = d.prepare('SELECT * FROM credit_cards WHERE id=? AND user_id=?').get(txn.card_id, userId);
  if (!card) throw new Error('Card not found');
  const cycle = _getOrCreateCurrentCycle(d, txn.card_id, userId);
  if (!cycle) throw new Error('Could not get billing cycle');
  const discPct = txn.discount_pct != null ? parseFloat(txn.discount_pct) : card.default_discount_pct;
  const amount  = parseFloat(txn.amount);
  const discAmt = Math.round(amount * discPct / 100 * 100) / 100;
  const netAmt  = Math.round(amount * 100) / 100;
  const r = d.prepare(
    'INSERT INTO cc_txns (user_id, card_id, cycle_id, txn_date, description, amount, discount_pct, discount_amount, net_amount, source, source_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  ).run(userId, txn.card_id, cycle.id, txn.txn_date, txn.description, amount, discPct, discAmt, netAmt, txn.source || 'manual', txn.source_id || null);
  _updateCycleTotals(d, cycle.id);
  return r;
}

function updateCcTxn(userId, id, txn) {
  const d = getDb();
  const existing = d.prepare('SELECT * FROM cc_txns WHERE id=? AND user_id=?').get(id, userId);
  if (!existing) throw new Error('Transaction not found');
  const discPct = txn.discount_pct != null ? parseFloat(txn.discount_pct) : existing.discount_pct;
  const amount  = txn.amount != null ? parseFloat(txn.amount) : existing.amount;
  const discAmt = Math.round(amount * discPct / 100 * 100) / 100;
  const netAmt  = Math.round(amount * 100) / 100;
  d.prepare(
    'UPDATE cc_txns SET txn_date=?, description=?, amount=?, discount_pct=?, discount_amount=?, net_amount=? WHERE id=? AND user_id=?'
  ).run(txn.txn_date || existing.txn_date, txn.description || existing.description, amount, discPct, discAmt, netAmt, id, userId);
  if (existing.cycle_id) _updateCycleTotals(d, existing.cycle_id);
}

function deleteCcTxn(userId, id) {
  const d = getDb();
  const txn = d.prepare('SELECT * FROM cc_txns WHERE id=? AND user_id=?').get(id, userId);
  if (!txn) return;
  d.prepare('DELETE FROM cc_txns WHERE id=? AND user_id=?').run(id, userId);
  if (txn.cycle_id) _updateCycleTotals(d, txn.cycle_id);
}

// Add a transaction directly to a specific cycle (for future open cycles)
function addCcTxnToCycle(userId, cycleId, txn) {
  const d = getDb();
  const cycle = d.prepare('SELECT * FROM cc_cycles WHERE id=? AND user_id=?').get(cycleId, userId);
  if (!cycle) throw new Error('Cycle not found');
  const card = d.prepare('SELECT * FROM credit_cards WHERE id=?').get(cycle.card_id);
  const discPct = txn.discount_pct != null ? parseFloat(txn.discount_pct) : (card?.default_discount_pct || 0);
  const amount  = parseFloat(txn.amount);
  const discAmt = Math.round(amount * discPct / 100 * 100) / 100;
  const netAmt  = Math.round(amount * 100) / 100;
  const r = d.prepare(
    'INSERT INTO cc_txns (user_id,card_id,cycle_id,txn_date,description,amount,discount_pct,discount_amount,net_amount,source,source_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  ).run(userId, cycle.card_id, cycleId, txn.txn_date, txn.description, amount, discPct, discAmt, netAmt, txn.source||'manual', txn.source_id||null);
  _updateCycleTotals(d, cycleId);
  return r;
}

function bulkAddCcTxnsToCycle(userId, cycleId, txns, discountPct = null) {
  const d = getDb();
  const cycle = d.prepare('SELECT * FROM cc_cycles WHERE id=? AND user_id=?').get(cycleId, userId);
  if (!cycle) throw new Error('Cycle not found');
  const card = d.prepare('SELECT * FROM credit_cards WHERE id=?').get(cycle.card_id);
  if (!card) throw new Error('Card not found');
  if (!Array.isArray(txns) || !txns.length) return 0;

  const insert = d.prepare(
    'INSERT INTO cc_txns (user_id,card_id,cycle_id,txn_date,description,amount,discount_pct,discount_amount,net_amount,source,source_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  );
  const run = d.transaction((items) => {
    let count = 0;
    for (const txn of items) {
      const description = String(txn.description || '').trim();
      const amount = parseFloat(txn.amount) || 0;
      const txnDate = txn.txn_date;
      if (!description || amount <= 0 || !txnDate) continue;
      if (txnDate < cycle.cycle_start || txnDate > cycle.cycle_end) {
        throw new Error(`Transaction date ${txnDate} is outside cycle ${cycle.cycle_start} to ${cycle.cycle_end}`);
      }
      const discPct = discountPct != null ? parseFloat(discountPct) : (txn.discount_pct != null ? parseFloat(txn.discount_pct) : (card.default_discount_pct || 0));
      const discAmt = Math.round(amount * discPct / 100 * 100) / 100;
      const netAmt = Math.round(amount * 100) / 100;
      insert.run(userId, cycle.card_id, cycleId, txnDate, description, amount, discPct, discAmt, netAmt, 'manual', null);
      count++;
    }
    _updateCycleTotals(d, cycleId);
    return count;
  });
  return run(txns);
}

// Delete a billing cycle and all its transactions
function deleteCcCycle(userId, cycleId) {
  const d = getDb();
  const cycle = d.prepare('SELECT * FROM cc_cycles WHERE id=? AND user_id=?').get(cycleId, userId);
  if (!cycle) return;
  d.prepare('DELETE FROM cc_txns WHERE cycle_id=? AND user_id=?').run(cycleId, userId);
  d.prepare('DELETE FROM cc_cycles WHERE id=? AND user_id=?').run(cycleId, userId);
}

// Edit a billing cycle's dates, totals, and status
function updateCcCycle(userId, cycleId, data) {
  const d = getDb();
  const cycle = d.prepare('SELECT * FROM cc_cycles WHERE id=? AND user_id=?').get(cycleId, userId);
  if (!cycle) throw new Error('Cycle not found');
  const fields = [], params = [];
  if (data.cycle_start) { fields.push('cycle_start=?'); params.push(data.cycle_start); }
  if (data.cycle_end)   { fields.push('cycle_end=?');   params.push(data.cycle_end); }
  if (data.due_date)    { fields.push('due_date=?');     params.push(data.due_date); }
  let totalAmount = null;
  if (data.total_amount !== undefined && data.total_amount !== null && data.total_amount !== '') {
    totalAmount = Math.max(0, parseFloat(data.total_amount) || 0);
    fields.push('total_amount=?'); params.push(totalAmount);
    fields.push('net_payable=?'); params.push(totalAmount);
    fields.push('manual_total_override=?'); params.push(1);
  }
  if (data.status) {
    const nextStatus = String(data.status);
    const nextNet = totalAmount !== null ? totalAmount : (parseFloat(cycle.net_payable) || 0);
    if (nextStatus === 'paid') {
      fields.push('status=?'); params.push('paid');
      fields.push('paid_amount=?'); params.push(nextNet);
      fields.push('paid_date=?'); params.push(data.paid_date || cycle.paid_date || _localDate(new Date()));
      fields.push("closed_at=datetime('now')");
    } else if (nextStatus === 'billed') {
      fields.push('status=?'); params.push('billed');
      fields.push('paid_amount=?'); params.push(0);
      fields.push('paid_date=?'); params.push(null);
      fields.push("closed_at=COALESCE(closed_at, datetime('now'))");
    } else if (nextStatus === 'open') {
      fields.push('status=?'); params.push('open');
      fields.push('paid_amount=?'); params.push(0);
      fields.push('paid_date=?'); params.push(null);
      fields.push('closed_at=?'); params.push(null);
    }
  }
  if (!fields.length) return;
  params.push(cycleId, userId);
  d.prepare(`UPDATE cc_cycles SET ${fields.join(',')} WHERE id=? AND user_id=?`).run(...params);
}

function getCcCurrentCycle(userId, cardId) {
  const d = getDb();
  _autoClosePastCcCycles(d, userId, cardId);
  const card = d.prepare('SELECT * FROM credit_cards WHERE id=? AND user_id=?').get(cardId, userId);
  if (!card) return null;
  const cycle = _getOrCreateCurrentCycle(d, cardId, userId);
  if (!cycle) return { card, cycle: null, txns: [] };
  const txns = d.prepare('SELECT * FROM cc_txns WHERE cycle_id=? ORDER BY txn_date ASC, id ASC').all(cycle.id);
  return { card, cycle, txns };
}

function getCcCycles(userId, cardId) {
  const d = getDb();
  _autoClosePastCcCycles(d, userId, cardId);
  const cycles = d.prepare('SELECT * FROM cc_cycles WHERE card_id=? AND user_id=? ORDER BY cycle_start DESC').all(cardId, userId);
  return cycles.map(c => ({
    ...c,
    txns: d.prepare('SELECT * FROM cc_txns WHERE cycle_id=? ORDER BY txn_date ASC').all(c.id)
  }));
}

function closeCcCycle(userId, cycleId, paidAmount, paidDate) {
  const d = getDb();
  const cycle = d.prepare('SELECT * FROM cc_cycles WHERE id=? AND user_id=?').get(cycleId, userId);
  if (!cycle) throw new Error('Cycle not found');
  const paid = parseFloat(paidAmount) || 0;
  const status = paid >= cycle.net_payable - 0.01 ? 'paid' : paid > 0 ? 'partial' : 'billed';
  d.prepare("UPDATE cc_cycles SET status=?, paid_amount=?, paid_date=?, closed_at=datetime('now') WHERE id=?")
    .run(status, paid, paidDate || null, cycleId);
  _getOrCreateCurrentCycle(d, cycle.card_id, userId);
}

// Base cycle summary query — uses cc_cycles so imported historical data shows up
const _CC_SUMMARY_SQL = `
  SELECT substr(cy.cycle_end, 1, 7) as month,
         COALESCE(SUM(cy.total_amount), 0) as total_amount,
         COALESCE(SUM(cy.total_discount), 0) as total_discount,
         COALESCE(SUM(cy.net_payable), 0) as net_payable,
         COALESCE(SUM((SELECT COUNT(*) FROM cc_txns t WHERE t.cycle_id = cy.id)), 0) as txn_count
  FROM cc_cycles cy
  WHERE cy.card_id=? AND cy.user_id=? AND cy.status != 'open'`;

function getCcMonthlySummary(userId, cardId, year) {
  const d = getDb();
  if (year) {
    return d.prepare(_CC_SUMMARY_SQL + ` AND substr(cy.cycle_end,1,4)=? GROUP BY month ORDER BY month DESC`)
      .all(cardId, userId, String(year));
  }
  return d.prepare(_CC_SUMMARY_SQL + ` GROUP BY month ORDER BY month DESC`).all(cardId, userId);
}

function getCcYearlySummary(userId, cardId) {
  const d = getDb();
  return d.prepare(`
    SELECT substr(cy.cycle_end, 1, 4) as year,
           COALESCE(SUM(cy.total_amount), 0) as total_amount,
           COALESCE(SUM(cy.total_discount), 0) as total_discount,
           COALESCE(SUM(cy.net_payable), 0) as net_payable,
           COALESCE(SUM((SELECT COUNT(*) FROM cc_txns t WHERE t.cycle_id = cy.id)), 0) as txn_count,
           COUNT(*) as cycle_count
    FROM cc_cycles cy
    WHERE cy.card_id=? AND cy.user_id=? AND cy.status != 'open'
    GROUP BY year ORDER BY year DESC
  `).all(cardId, userId);
}

function getCcAvailableYears(userId, cardId) {
  const d = getDb();
  return d.prepare(`
    SELECT DISTINCT substr(cycle_end,1,4) as year
    FROM cc_cycles WHERE card_id=? AND user_id=? AND status != 'open'
    ORDER BY year DESC
  `).all(cardId, userId).map(r => parseInt(r.year));
}

// Import historical billing cycles (totals only, no transactions)
// rows = [{ year, month (1-12), amount, paid_date (optional) }]
function importHistoricalCycles(userId, cardId, rows) {
  const d = getDb();
  const card = d.prepare('SELECT * FROM credit_cards WHERE id=? AND user_id=?').get(cardId, userId);
  if (!card) throw new Error('Card not found');
  // Prepare statements outside the transaction (better-sqlite3 best practice)
  const checkExisting = d.prepare(
    'SELECT id FROM cc_cycles WHERE card_id=? AND user_id=? AND cycle_start=? AND cycle_end=?'
  );
  const insert = d.prepare(
    'INSERT INTO cc_cycles (user_id, card_id, cycle_start, cycle_end, due_date, total_amount, total_discount, net_payable, paid_amount, paid_date, status, manual_total_override, closed_at) VALUES (?,?,?,?,?,?,0,?,?,?,?,?,?)'
  );

  const importMany = d.transaction((items) => {
    let count = 0;
    for (const row of items) {
      if (!row.amount || row.amount <= 0) continue;
      const y = parseInt(row.year);
      const m = parseInt(row.month); // 1-indexed
      // Cycle: bill_gen_day+1 of previous month → bill_gen_day of this month
      const cycleStart = _localDate(new Date(y, m - 2, card.bill_gen_day + 1));
      const cycleEnd   = _localDate(new Date(y, m - 1, card.bill_gen_day));
      const dueDate    = _localDate(new Date(y, m - 1, card.bill_gen_day + (card.due_days || 20)));
      // Skip if a cycle already exists for this exact period
      if (checkExisting.get(cardId, userId, cycleStart, cycleEnd)) continue;
      const paidDate = row.paid_date || dueDate;
      insert.run(userId, cardId, cycleStart, cycleEnd, dueDate, row.amount, row.amount, row.amount, paidDate, 'closed', 1, paidDate);
      count++;
    }
    return count;
  });
  return importMany(rows);
}

// Returns EMI installments due in a given month (YYYY-MM) for non-CC EMIs.
function getEmiDuesForMonth(userId, month) {
  const d = getDb();
  const [y, m] = month.split('-').map(Number);
  const nextMonth = `${new Date(y, m, 1).getFullYear()}-${String(new Date(y, m, 1).getMonth() + 1).padStart(2, '0')}`;
  return d.prepare(`
    SELECT i.*, r.name AS emi_name, r.id AS emi_record_id, r.status AS emi_status
    FROM emi_installments i
    JOIN emi_records r ON r.id = i.emi_id
    WHERE r.user_id = ?
      AND (
        (COALESCE(r.planner_advance_month, 0) = 0 AND substr(i.due_date, 1, 7) = ?)
        OR
        (COALESCE(r.planner_advance_month, 0) = 1 AND substr(i.due_date, 1, 7) = ?)
      )
      AND (r.credit_card_id IS NULL OR r.credit_card_id = 0)
      AND r.status IN ('active', 'pending', 'completed')
    ORDER BY i.due_date, r.name
  `).all(userId, month, nextMonth);
}

// Returns CC cycles due in a given month (YYYY-MM) that are not fully paid
function getCcDuesForMonth(userId, month) {
  const d = getDb();
  return d.prepare(`
    SELECT cy.*, cc.card_name, cc.bank_name, cc.last4,
           (SELECT COUNT(*) FROM cc_txns t WHERE t.cycle_id = cy.id) as txn_count
    FROM cc_cycles cy
    JOIN credit_cards cc ON cc.id = cy.card_id
    WHERE cy.user_id = ?
      AND substr(cy.due_date, 1, 7) = ?
      AND cy.status IN ('open', 'billed', 'partial')
    ORDER BY cy.due_date ASC
  `).all(userId, month);
}

// ─── AI LOOKUP DATA SNAPSHOT ─────────────────────────────────────────────────
function getUserFinancialSummary(userId) {
  const d = getDb();
  const today = _localDate(new Date());
  const currentMonth = today.slice(0, 7);

  // Bank accounts
  const banks = d.prepare('SELECT bank_name, account_name, account_type, balance, min_balance, is_default FROM bank_accounts WHERE user_id=? AND is_active=1').all(userId);

  // Expenses: totals by year + last 60 transactions
  const expYearly = d.prepare(`
    SELECT strftime('%Y', purchase_date) as year,
           SUM(amount) as total,
           SUM(CASE WHEN is_extra=1 THEN amount ELSE 0 END) as extra,
           SUM(CASE WHEN is_extra=0 THEN amount ELSE 0 END) as fair,
           COUNT(*) as count
    FROM expenses WHERE user_id=? GROUP BY year ORDER BY year DESC
  `).all(userId);
  const expMonthly = d.prepare(`
    SELECT strftime('%Y-%m', purchase_date) as month,
           SUM(amount) as total, COUNT(*) as count
    FROM expenses WHERE user_id=? AND purchase_date >= date('now','-6 months')
    GROUP BY month ORDER BY month DESC
  `).all(userId);
  const recentExpenses = d.prepare(
    "SELECT purchase_date, item_name, amount, is_extra FROM expenses WHERE user_id=? ORDER BY purchase_date DESC LIMIT 30"
  ).all(userId);

  // Friends & loans
  const friends = d.prepare('SELECT id, name FROM friends WHERE user_id=?').all(userId);
  const friendSummaries = friends.map(f => {
    const row = d.prepare(`
      SELECT COALESCE(SUM(paid),0) as total_paid, COALESCE(SUM(received),0) as total_received
      FROM loan_transactions WHERE user_id=? AND friend_id=?
    `).get(userId, f.id);
    const net = (row.total_paid || 0) - (row.total_received || 0);
    return { name: f.name, you_paid: row.total_paid, you_received: row.total_received, net_balance: net };
  });

  // EMIs
  const emis = d.prepare(`
    SELECT r.name, r.status, r.principal, r.annual_rate, r.tenure_months, r.monthly_emi, r.start_date,
           COUNT(i.id) as total_installments,
           SUM(CASE WHEN i.paid_amount >= i.emi_amount*0.99 THEN 1 ELSE 0 END) as paid_count,
           SUM(CASE WHEN i.paid_amount < i.emi_amount*0.99 THEN i.emi_amount ELSE 0 END) as remaining_amount
    FROM emi_records r
    LEFT JOIN emi_installments i ON i.emi_id = r.id
    WHERE r.user_id=?
    GROUP BY r.id ORDER BY r.id DESC
  `).all(userId);

  // Credit cards
  const cards = d.prepare('SELECT card_name, bank_name, last4, credit_limit FROM credit_cards WHERE user_id=?').all(userId);
  const ccSummaries = cards.map(c => {
    const cycle = d.prepare(`
      SELECT net_payable, total_amount as total_spent, status, cycle_start, cycle_end, due_date
      FROM cc_cycles WHERE card_id=(SELECT id FROM credit_cards WHERE user_id=? AND last4=? AND card_name=? LIMIT 1)
      AND user_id=? ORDER BY cycle_start DESC LIMIT 1
    `).get(userId, c.last4, c.card_name, userId);
    return { ...c, current_cycle: cycle || null };
  });

  // Trips (active)
  const trips = d.prepare(`
    SELECT t.name, t.status, t.start_date, t.end_date,
           COUNT(e.id) as expense_count, COALESCE(SUM(e.amount),0) as total_amount
    FROM trips t LEFT JOIN trip_expenses e ON e.trip_id=t.id
    WHERE t.user_id=? GROUP BY t.id ORDER BY t.id DESC LIMIT 10
  `).all(userId);

  // Monthly planner — current month
  const plannerPayments = d.prepare(
    "SELECT name, amount, due_date FROM monthly_payments WHERE user_id=? AND month=? AND (is_skipped IS NULL OR is_skipped=0)"
  ).all(userId, currentMonth);

  // Default payments
  const defaults = d.prepare(
    "SELECT name, amount, due_day, category FROM default_payments WHERE user_id=? AND is_active=1"
  ).all(userId);

  return {
    as_of: today,
    current_month: currentMonth,
    bank_accounts: banks,
    total_bank_balance: banks.reduce((s, b) => s + b.balance, 0),
    total_spendable: banks.reduce((s, b) => s + (b.balance - b.min_balance), 0),
    expense_by_year: expYearly,
    expense_last_6_months: expMonthly,
    recent_expenses: recentExpenses,
    friends_loan_summary: friendSummaries,
    emis,
    credit_cards: ccSummaries,
    active_trips: trips,
    current_month_planner: plannerPayments,
    recurring_defaults: defaults,
  };
}

// ─── FUTURE MONTH PREVIEW (read-only, no DB writes) ──────────────────────────
function getPreviewDataForMonth(userId, month) {
  const d = getDb();
  const [yr, mo] = month.split('-').map(Number);

  // 1. Project active default payments for the month (no DB insert)
  const defaults = d.prepare(
    "SELECT * FROM default_payments WHERE user_id=? AND is_active=1 ORDER BY due_day ASC, name ASC"
  ).all(userId);
  const projectedDefaults = defaults.map(dp => {
    const dueDay = Math.min(dp.due_day || 1, new Date(yr, mo, 0).getDate());
    const due_date = `${month}-${String(dueDay).padStart(2, '0')}`;
    let bank_account_id = dp.bank_account_id || null;
    if (dp.auto_detect_bank) {
      const defBank = d.prepare('SELECT id FROM bank_accounts WHERE user_id=? AND is_default=1 AND is_active=1 LIMIT 1').get(userId);
      if (defBank) bank_account_id = defBank.id;
    }
    return { ...dp, due_date, month, status: 'pending', paid_amount: 0, default_payment_id: dp.id, bank_account_id, is_projected: 1 };
  });

  const recurringEntries = d.prepare(
    "SELECT * FROM recurring_entries WHERE user_id=? AND is_active=1 AND type='expense' AND (card_id IS NULL OR card_id=0) ORDER BY description ASC"
  ).all(userId);
  const projectedRecurring = recurringEntries.filter(entry => _recurringEntryAppliesToMonth(entry, month)).map(entry => ({
    id: `proj_rec_${entry.id}`,
    recurring_entry_id: entry.id,
    name: entry.description,
    amount: entry.amount,
    due_date: `${month}-01`,
    month,
    status: 'pending',
    paid_amount: 0,
    bank_account_id: null,
    is_projected: 1,
  }));
  const projectedTrackerItems = _getDailyTrackerPlannerItems(userId, month).map(item => ({
    id: `proj_tracker_${item.daily_tracker_id}_${item.tracker_source_month}`,
    ...item,
    paid_amount: 0,
    status: 'pending',
    bank_account_id: null,
    is_projected: 1,
  }));

  // 2. EMI installments for the month (already stored in DB, no write needed)
  const emiDues = getEmiDuesForMonth(userId, month).filter(i =>
    (i.emi_status === 'active' || i.emi_status === 'pending') &&
    (Number(i.paid_amount) || 0) < (Number(i.emi_amount) || 0) * 0.999
  );

  // 3. Project CC dues: for each card compute if a billing cycle falls due in this month
  const cards = d.prepare('SELECT * FROM credit_cards WHERE user_id=?').all(userId);
  const projectedCcDues = [];
  for (const card of cards) {
    _autoClosePastCcCycles(d, userId, card.id);
    _getOrCreateCurrentCycle(d, card.id, userId);
    const actualDueCycle = d.prepare(`
      SELECT id, card_id, cycle_start, cycle_end, due_date, net_payable, paid_amount, status
      FROM cc_cycles
      WHERE user_id=? AND card_id=? AND substr(due_date, 1, 7)=?
        AND status IN ('open','billed','partial')
      ORDER BY due_date ASC, cycle_start ASC
      LIMIT 1
    `).get(userId, card.id, month);
    if (actualDueCycle) {
      projectedCcDues.push({
        ...actualDueCycle,
        card_name: card.card_name,
        bank_name: card.bank_name,
        last4: card.last4,
        txn_count: 0,
        is_projected: 0,
      });
      continue;
    }

    const billGenDay = card.bill_gen_day || 1;
    const dueDays    = card.due_days    || 20;
    for (let offset = -2; offset <= 1; offset++) {
      const cycleEndDate = new Date(yr, mo - 1 + offset, billGenDay);
      const dueDateObj   = new Date(cycleEndDate);
      dueDateObj.setDate(dueDateObj.getDate() + dueDays);
      const dueDateStr   = _localDate(dueDateObj);
      if (dueDateStr.slice(0, 7) === month) {
        const cycleStartDate = new Date(yr, mo - 1 + offset - 1, billGenDay + 1);
        const cycleStartStr = _localDate(cycleStartDate);
        const cycleEndStr = _localDate(cycleEndDate);
        const matchingCycle = d.prepare(`
          SELECT id, net_payable, paid_amount, status
          FROM cc_cycles
          WHERE card_id=? AND user_id=? AND cycle_start=? AND cycle_end=?
          LIMIT 1
        `).get(card.id, userId, cycleStartStr, cycleEndStr);
        if (matchingCycle && ['paid', 'closed'].includes(matchingCycle.status)) break;
        // If the matching cycle is not present yet, estimate from the latest known cycle.
        const recentCycle = !matchingCycle ? d.prepare(`
          SELECT net_payable FROM cc_cycles WHERE card_id=? AND user_id=?
          AND status IN ('open','billed','partial','paid') ORDER BY cycle_start DESC LIMIT 1
        `).get(card.id, userId) : null;
        projectedCcDues.push({
          id: matchingCycle?.id || `proj_cc_${card.id}`,
          card_id: card.id,
          card_name: card.card_name,
          bank_name: card.bank_name,
          last4: card.last4,
          cycle_start: cycleStartStr,
          cycle_end: cycleEndStr,
          due_date: dueDateStr,
          net_payable: matchingCycle ? matchingCycle.net_payable : (recentCycle ? recentCycle.net_payable : 0),
          paid_amount: matchingCycle ? (matchingCycle.paid_amount || 0) : 0,
          status: matchingCycle ? matchingCycle.status : 'open',
          txn_count: 0,
          is_projected: matchingCycle ? 0 : 1,
        });
        break;
      }
    }
  }

  return { projectedDefaults: [...projectedDefaults, ...projectedRecurring, ...projectedTrackerItems], emiDues, projectedCcDues };
}

function _defaultPaymentAppliesToMonth(dp, month) {
  return true;
}

function _recurringEntryAppliesToMonth(entry, month) {
  const interval = Math.max(1, parseInt(entry.interval_months) || 1);
  if (interval <= 1) return true;
  const startMonth = entry.start_month || month;
  if (month < startMonth) return false;
  const [startY, startM] = startMonth.split('-').map(Number);
  const [curY, curM] = month.split('-').map(Number);
  if (!startY || !startM || !curY || !curM) return true;
  const diffMonths = (curY - startY) * 12 + (curM - startM);
  return diffMonths >= 0 && diffMonths % interval === 0;
}

function _getDailyTrackerPlannerItems(userId, month) {
  const d = getDb();
  const [yr, mo] = month.split('-').map(Number);
  const prevDate = new Date(yr, mo - 2, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
  const prevPrefix = `${prevMonth}-%`;
  const dueDate = `${month}-01`;
  const trackers = d.prepare('SELECT * FROM daily_trackers WHERE user_id=? AND is_active=1 ORDER BY name').all(userId);
  const summaryStmt = d.prepare(`
    SELECT ROUND(COALESCE(SUM(amount), 0), 2) as total_amount,
           MAX(COALESCE(added_to_expense, 0)) as added_to_expense
    FROM daily_entries
    WHERE user_id=? AND tracker_id=? AND entry_date LIKE ?
  `);
  const monthLabel = prevDate.toLocaleString('en-US', { month: 'short', year: 'numeric' });
  return trackers.flatMap(tracker => {
    const summary = summaryStmt.get(userId, tracker.id, prevPrefix);
    const total = parseFloat(summary?.total_amount) || 0;
    if (total <= 0) return [];
    if (parseInt(summary?.added_to_expense || 0, 10) === 1) return [];
    return [{
      daily_tracker_id: tracker.id,
      tracker_source_month: prevMonth,
      name: `${tracker.name} - ${monthLabel}`,
      amount: total,
      due_date: dueDate,
      notes: `Daily tracker total for ${monthLabel}`,
    }];
  });
}

// ─── Daily Trackers ──────────────────────────────────────────
function getDailyTrackers(userId) {
  const d = getDb();
  const now = new Date();
  const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const trackers = d.prepare('SELECT * FROM daily_trackers WHERE user_id=? ORDER BY name').all(userId);
  return trackers.map(t => {
    const s = d.prepare("SELECT SUM(amount) as total, COUNT(*) as days FROM daily_entries WHERE tracker_id=? AND entry_date LIKE ?").get(t.id, `${prefix}-%`);
    return { ...t, current_month_total: s?.total || 0, current_month_days: s?.days || 0 };
  });
}

function addDailyTracker(userId, data) {
  return getDb().prepare(
    'INSERT INTO daily_trackers (user_id, name, unit, price_per_unit, default_qty) VALUES (?,?,?,?,?)'
  ).run(userId, data.name, data.unit || 'unit', parseFloat(data.price_per_unit), parseFloat(data.default_qty) || 1);
}

function updateDailyTracker(userId, id, data) {
  return getDb().prepare(
    'UPDATE daily_trackers SET name=?, unit=?, price_per_unit=?, default_qty=?, is_active=? WHERE id=? AND user_id=?'
  ).run(data.name, data.unit || 'unit', parseFloat(data.price_per_unit), parseFloat(data.default_qty) || 1,
    data.is_active != null ? (data.is_active ? 1 : 0) : 1, id, userId);
}

function deleteDailyTracker(userId, id) {
  return getDb().prepare('DELETE FROM daily_trackers WHERE id=? AND user_id=?').run(id, userId);
}

function getDailyEntries(userId, trackerId, year, month) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  return getDb().prepare(
    'SELECT * FROM daily_entries WHERE user_id=? AND tracker_id=? AND entry_date LIKE ? ORDER BY entry_date'
  ).all(userId, trackerId, `${prefix}-%`);
}

function upsertDailyEntry(userId, trackerId, date, qty, isAuto) {
  const d = getDb();
  const tracker = d.prepare('SELECT * FROM daily_trackers WHERE id=? AND user_id=?').get(trackerId, userId);
  if (!tracker) throw new Error('Tracker not found');
  const amount = Math.round(parseFloat(qty) * tracker.price_per_unit * 100) / 100;
  d.prepare(`INSERT INTO daily_entries (tracker_id, user_id, entry_date, quantity, amount, is_auto)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(tracker_id, entry_date) DO UPDATE SET quantity=excluded.quantity, amount=excluded.amount, is_auto=excluded.is_auto`
  ).run(trackerId, userId, date, parseFloat(qty), amount, isAuto ? 1 : 0);
  return { amount };
}

function autoFillDailyEntries(userId, trackerId, year, month) {
  const d = getDb();
  const tracker = d.prepare('SELECT * FROM daily_trackers WHERE id=? AND user_id=?').get(trackerId, userId);
  if (!tracker) throw new Error('Tracker not found');
  const today = new Date().toISOString().split('T')[0];
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const existing = new Set(
    d.prepare("SELECT entry_date FROM daily_entries WHERE tracker_id=? AND entry_date LIKE ?").all(trackerId, `${prefix}-%`).map(e => e.entry_date)
  );
  const amount = Math.round(tracker.default_qty * tracker.price_per_unit * 100) / 100;
  const stmt = d.prepare('INSERT OR IGNORE INTO daily_entries (tracker_id, user_id, entry_date, quantity, amount, is_auto) VALUES (?,?,?,?,?,1)');
  const daysInMonth = new Date(year, month, 0).getDate();
  let filled = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${prefix}-${String(day).padStart(2, '0')}`;
    if (dateStr > today) break;
    if (!existing.has(dateStr)) { stmt.run(trackerId, userId, dateStr, tracker.default_qty, amount); filled++; }
  }
  return filled;
}

function getDailyMonthSummary(userId, trackerId, year, month) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  return getDb().prepare(`SELECT COUNT(*) as days, ROUND(SUM(quantity),3) as total_qty, ROUND(SUM(amount),2) as total_amount,
    SUM(CASE WHEN is_auto=1 THEN 1 ELSE 0 END) as auto_days, SUM(CASE WHEN is_auto=0 THEN 1 ELSE 0 END) as edited_days,
    MAX(added_to_expense) as added_to_expense
    FROM daily_entries WHERE user_id=? AND tracker_id=? AND entry_date LIKE ?`
  ).get(userId, trackerId, `${prefix}-%`);
}

function addTrackerMonthToExpense(userId, trackerId, year, month) {
  const d = getDb();
  const tracker = d.prepare('SELECT * FROM daily_trackers WHERE id=? AND user_id=?').get(trackerId, userId);
  if (!tracker) throw new Error('Tracker not found');
  const summary = getDailyMonthSummary(userId, trackerId, year, month);
  if (!summary || !summary.total_amount) throw new Error('No entries for this month');
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const itemName = `${tracker.name} – ${MONTHS[month - 1]} ${year}`;
  const date = `${year}-${String(month).padStart(2, '0')}-01`;
  d.prepare('INSERT INTO expenses (user_id, item_name, amount, purchase_date, is_extra) VALUES (?,?,?,?,0)')
    .run(userId, itemName, summary.total_amount, date);
  d.prepare("UPDATE daily_entries SET added_to_expense=1 WHERE user_id=? AND tracker_id=? AND entry_date LIKE ?")
    .run(userId, trackerId, `${year}-${String(month).padStart(2, '0')}-%`);
  return summary.total_amount;
}

// ─── Trip Sharing ────────────────────────────────────────────
function searchUsers(query, excludeUserId) {
  if (!query || query.length < 2) return [];
  const q = `%${query}%`;
  return getDb().prepare(
    'SELECT id, username, display_name FROM users WHERE (username LIKE ? OR display_name LIKE ?) AND id != ? AND is_active = 1 LIMIT 10'
  ).all(q, q, excludeUserId);
}

function linkTripMember(ownerId, memberId, linkedUserId, permission) {
  const d = getDb();
  const mem = d.prepare('SELECT m.* FROM trip_members m JOIN trips t ON t.id=m.trip_id WHERE m.id=? AND t.user_id=?').get(memberId, ownerId);
  if (!mem) throw new Error('Member not found');
  d.prepare('UPDATE trip_members SET linked_user_id=?, permission=? WHERE id=?').run(linkedUserId || null, permission || 'edit', memberId);
}

function createTripInvite(ownerId, tripId, memberId) {
  const d = getDb();
  const crypto = require('crypto');
  const trip = d.prepare('SELECT * FROM trips WHERE id=? AND user_id=?').get(tripId, ownerId);
  if (!trip) throw new Error('Trip not found');
  const member = d.prepare('SELECT * FROM trip_members WHERE id=? AND trip_id=?').get(memberId, tripId);
  if (!member) throw new Error('Member not found');
  d.prepare("DELETE FROM trip_invites WHERE trip_id=? AND member_id=? AND status='pending'").run(tripId, memberId);
  const token = crypto.randomBytes(20).toString('hex');
  const exp = new Date(); exp.setDate(exp.getDate() + 7);
  d.prepare('INSERT INTO trip_invites (trip_id, member_id, created_by, token, expires_at) VALUES (?,?,?,?,?)').run(tripId, memberId, ownerId, token, exp.toISOString().split('T')[0]);
  return token;
}

function getTripInviteByToken(token) {
  return getDb().prepare(
    'SELECT i.*, t.name as trip_name, u.display_name as owner_name, m.member_name FROM trip_invites i JOIN trips t ON t.id=i.trip_id JOIN users u ON u.id=i.created_by JOIN trip_members m ON m.id=i.member_id WHERE i.token=?'
  ).get(token);
}

function acceptTripInvite(userId, token) {
  const d = getDb();
  const invite = d.prepare('SELECT * FROM trip_invites WHERE token=?').get(token);
  if (!invite) throw new Error('Invalid invite');
  if (invite.status !== 'pending') throw new Error('Invite already used');
  if (invite.expires_at && invite.expires_at < new Date().toISOString().split('T')[0]) throw new Error('Invite expired');
  d.prepare('UPDATE trip_members SET linked_user_id=? WHERE id=?').run(userId, invite.member_id);
  d.prepare("UPDATE trip_invites SET status='accepted', accepted_by=? WHERE id=?").run(userId, invite.id);
  return invite.trip_id;
}

// ─── Share Links ─────────────────────────────────────────────
function createShareLink(userId, data) {
  const d = getDb();
  const crypto = require('crypto');
  const token = crypto.randomBytes(20).toString('hex');
  d.prepare('INSERT INTO share_links (user_id, token, link_type, filters, expires_at) VALUES (?,?,?,?,?)').run(
    userId, token, data.link_type || 'friends',
    data.filters ? JSON.stringify(data.filters) : null,
    data.expires_at || null
  );
  return token;
}

function getShareLinks(userId) {
  return getDb().prepare('SELECT * FROM share_links WHERE user_id=? ORDER BY created_at DESC').all(userId);
}

function deleteShareLink(userId, id) {
  return getDb().prepare('DELETE FROM share_links WHERE id=? AND user_id=?').run(id, userId);
}

function getPublicShareData(token) {
  const d = getDb();
  const link = d.prepare('SELECT * FROM share_links WHERE token=?').get(token);
  if (!link) return null;
  if (link.expires_at && link.expires_at < new Date().toISOString().split('T')[0]) return null;
  d.prepare('UPDATE share_links SET view_count=view_count+1 WHERE id=?').run(link.id);
  const filters = link.filters ? JSON.parse(link.filters) : {};
  let friends = d.prepare('SELECT * FROM friends WHERE user_id=? ORDER BY name').all(link.user_id);
  if (filters.friend_ids && filters.friend_ids.length > 0) {
    friends = friends.filter(f => filters.friend_ids.includes(f.id));
  }
  const balStmt = d.prepare('SELECT COALESCE(SUM(paid-received),0) as balance FROM loan_transactions WHERE friend_id=?');
  const friendsWithData = friends.map(f => {
    const { balance } = balStmt.get(f.id);
    let tq = 'SELECT * FROM loan_transactions WHERE user_id=? AND friend_id=?';
    const tp = [link.user_id, f.id];
    if (filters.year)  { tq += ' AND substr(txn_date,1,4)=?';   tp.push(String(filters.year)); }
    if (filters.month) { tq += ' AND substr(txn_date,6,2)=?'; tp.push(String(filters.month).padStart(2,'0')); }
    tq += ' ORDER BY txn_date DESC';
    return { ...f, balance: Math.round(balance * 100) / 100, transactions: d.prepare(tq).all(...tp) };
  });
  const owner = d.prepare('SELECT display_name FROM users WHERE id=?').get(link.user_id);
  return { owner_name: owner?.display_name, filters, friends: friendsWithData, expires_at: link.expires_at };
}

// ─── Recurring Entries ───────────────────────────────────────
function getRecurringEntries(userId) {
  return getDb().prepare(`
    SELECT r.*, c.card_name, c.bank_name, c.last4
    FROM recurring_entries r
    LEFT JOIN credit_cards c ON r.card_id = c.id
    WHERE r.user_id = ?
    ORDER BY r.created_at DESC
  `).all(userId);
}

function addRecurringEntry(userId, data) {
  return getDb().prepare(
    'INSERT INTO recurring_entries (user_id, type, description, amount, interval_months, start_month, card_id, discount_pct, also_expense, is_extra) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).run(userId, data.type, data.description, parseFloat(data.amount), Math.max(1, parseInt(data.interval_months) || 1), data.start_month || null, data.card_id || null,
    parseFloat(data.discount_pct) || 0, data.also_expense ? 1 : 0, data.is_extra ? 1 : 0);
}

function applyRecurringEntryForCurrentMonth(userId, entryId) {
  const d = getDb();
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const day1 = `${currentMonth}-01`;
  const entry = d.prepare('SELECT * FROM recurring_entries WHERE id=? AND user_id=?').get(entryId, userId);
  if (!entry || !entry.is_active) throw new Error('Recurring entry not found');
  if (entry.last_applied === currentMonth) return false;
  if (!_recurringEntryAppliesToMonth(entry, currentMonth)) return false;

  if (entry.type === 'expense') {
    d.prepare('INSERT INTO expenses (user_id, item_name, amount, purchase_date, is_extra) VALUES (?,?,?,?,?)')
      .run(userId, entry.description, entry.amount, day1, entry.is_extra);
  } else if (entry.type === 'cc_txn' && entry.card_id) {
    addCcTxn(userId, { card_id: entry.card_id, txn_date: day1, description: entry.description, amount: entry.amount, discount_pct: entry.discount_pct });
    if (entry.also_expense) {
      d.prepare('INSERT INTO expenses (user_id, item_name, amount, purchase_date, is_extra) VALUES (?,?,?,?,?)')
        .run(userId, entry.description, entry.amount, day1, 0);
    }
  } else {
    throw new Error('Recurring entry type is not supported');
  }

  d.prepare('UPDATE recurring_entries SET last_applied=? WHERE id=?').run(currentMonth, entry.id);
  return true;
}

function updateRecurringEntry(userId, id, data) {
  return getDb().prepare(
    'UPDATE recurring_entries SET description=?, amount=?, interval_months=?, start_month=?, card_id=?, discount_pct=?, also_expense=?, is_extra=?, is_active=? WHERE id=? AND user_id=?'
  ).run(data.description, parseFloat(data.amount), Math.max(1, parseInt(data.interval_months) || 1), data.start_month || null, data.card_id || null,
    parseFloat(data.discount_pct) || 0, data.also_expense ? 1 : 0, data.is_extra ? 1 : 0,
    data.is_active != null ? (data.is_active ? 1 : 0) : 1, id, userId);
}

function deleteRecurringEntry(userId, id) {
  return getDb().prepare('DELETE FROM recurring_entries WHERE id=? AND user_id=?').run(id, userId);
}

function applyRecurringEntries(userId) {
  const d = getDb();
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const day1 = `${currentMonth}-01`;
  const entries = d.prepare('SELECT * FROM recurring_entries WHERE user_id=? AND is_active=1').all(userId);
  const applied = [];
  for (const entry of entries) {
    if (entry.last_applied === currentMonth) continue;
    if (!_recurringEntryAppliesToMonth(entry, currentMonth)) continue;
    try {
      if (entry.type === 'expense') {
        d.prepare('INSERT INTO expenses (user_id, item_name, amount, purchase_date, is_extra) VALUES (?,?,?,?,?)')
          .run(userId, entry.description, entry.amount, day1, entry.is_extra);
      } else if (entry.type === 'cc_txn' && entry.card_id) {
        addCcTxn(userId, { card_id: entry.card_id, txn_date: day1, description: entry.description, amount: entry.amount, discount_pct: entry.discount_pct });
        if (entry.also_expense) {
          d.prepare('INSERT INTO expenses (user_id, item_name, amount, purchase_date, is_extra) VALUES (?,?,?,?,?)')
            .run(userId, entry.description, entry.amount, day1, 0);
        }
      }
      d.prepare('UPDATE recurring_entries SET last_applied=? WHERE id=?').run(currentMonth, entry.id);
      applied.push(entry.id);
    } catch (_) { /* skip if card deleted etc. */ }
  }
  return applied;
}

function importEmiFromExcel(userId, emiData, installments) {
  const d = getDb();
  return d.transaction(() => {
    const principal    = Math.round(installments.reduce((s, i) => s + i.principal_component, 0) * 100) / 100;
    const totalInterest= Math.round(installments.reduce((s, i) => s + i.interest_component,  0) * 100) / 100;
    const totalGst     = Math.round(installments.reduce((s, i) => s + (i.gst_amount || 0),   0) * 100) / 100;
    const grandTotal   = Math.round(installments.reduce((s, i) => s + i.emi_amount,           0) * 100) / 100;
    const totalAmount  = Math.round((principal + totalInterest) * 100) / 100;
    const monthlyEmi   = installments[0]?.emi_amount || 0;
    const startDate    = emiData.start_date || installments[0]?.due_date || null;

    const rec = d.prepare(
      'INSERT INTO emi_records (user_id,name,description,principal,annual_rate,tenure_months,monthly_emi,total_interest,gst_rate,total_gst,total_amount,grand_total,tag,status,start_date,for_friend,friend_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).run(userId, emiData.name, emiData.description||null, principal, emiData.annual_rate||0,
          installments.length, monthlyEmi, totalInterest, emiData.gst_rate||0, totalGst,
          totalAmount, grandTotal, emiData.tag||null, 'active', startDate,
          emiData.for_friend||0, emiData.friend_name||null);

    const emiId = rec.lastInsertRowid;
    const stmt  = d.prepare(
      'INSERT INTO emi_installments (emi_id,installment_no,due_date,principal_component,interest_component,gst_amount,emi_amount,paid_amount,paid_date) VALUES (?,?,?,?,?,?,?,?,?)'
    );
    for (const inst of installments) {
      const paid = inst.paid_amount || 0;
      stmt.run(emiId, inst.installment_no, inst.due_date,
               inst.principal_component, inst.interest_component, inst.gst_amount||0,
               inst.emi_amount, paid, paid > 0 ? inst.due_date : null);
    }

    // Auto-mark any past-due installments (with no paid_amount) as paid
    _autoMarkPastInstallmentsPaid(d, emiId);

    // Check if all installments are now paid and mark EMI as completed
    const unpaid = d.prepare("SELECT COUNT(*) as n FROM emi_installments WHERE emi_id=? AND paid_amount < emi_amount * 0.999").get(emiId);
    if (unpaid.n === 0) d.prepare("UPDATE emi_records SET status='completed' WHERE id=?").run(emiId);

    return { id: emiId };
  })();
}

module.exports = {
  getDb, createUser, findUserByUsername, findUserByEmail, findUserById, verifyPassword,
  updateUserProfile, changeUserPassword,
  getExpenses, addExpense, updateExpense, deleteExpense, bulkAddExpenses,
  getFriends, addFriend, deleteFriend,
  getLoanTransactions, addLoanTransaction, updateLoanTransaction, deleteLoanTransaction,
  getDivideGroups, addDivideGroup,
  createTrip, getTrips, getTripById, updateTrip, deleteTrip, addTripExpense, updateTripExpense, deleteTripExpense, toggleMemberLock,
  searchUsers, linkTripMember, createTripInvite, getTripInviteByToken, acceptTripInvite,
  createShareLink, getShareLinks, deleteShareLink, getPublicShareData,
  saveEmiRecord, getEmiRecords, getEmiRecord, updateEmiRecord, deleteEmiRecord, activateEmi, payInstallment, getEmiMonthSummary,
  updateInstallmentAmount, updateInstallmentComponents, bulkUpdateInstallmentAmount, activateEmiWithSchedule, addEmiExpensesManual, addEmiToCreditCardManual, importEmiFromExcel,
  getAllUsers, updateUserAdmin, resetUserPassword,
  getPlans, createPlan, updatePlan, deletePlan,
  getSubscriptions, createSubscription, updateSubscription, deleteSubscription, assignSignupPlanToUser, getUserAccessiblePages,
  getAiLookupStatus, recordAiLookupUsage,
  generateOtp, verifyOtp, createPasswordReset, getPasswordResetByToken, usePasswordReset,
  getBankAccounts, addBankAccount, updateBankAccount, updateBankBalance, deleteBankAccount, setDefaultBankAccount,
  getDefaultPayments, addDefaultPayment, updateDefaultPayment, deleteDefaultPayment,
  getMonthlyPayments, getSkippedPayments, restoreMonthlyPayment, addMonthlyPayment, updateMonthlyPayment, deleteMonthlyPayment, hardDeleteMonthlyPayment, payMonthlyPayment, generateMonthlyPayments,
  addCreditCard, updateCreditCard, deleteCreditCard, getCreditCards, getCreditCard,
  addCcTxn, addCcTxnToCycle, bulkAddCcTxnsToCycle, updateCcTxn, deleteCcTxn, deleteCcCycle, updateCcCycle, getCcCurrentCycle, getCcCycles, closeCcCycle,
  getCcMonthlySummary, getCcYearlySummary, getCcAvailableYears, getCcDuesForMonth, getEmiDuesForMonth, importHistoricalCycles,
  getPreviewDataForMonth,
  getUserFinancialSummary,
  getRecurringEntries, addRecurringEntry, applyRecurringEntryForCurrentMonth, updateRecurringEntry, deleteRecurringEntry, applyRecurringEntries,
  getDailyTrackers, addDailyTracker, updateDailyTracker, deleteDailyTracker,
  getDailyEntries, upsertDailyEntry, autoFillDailyEntries, getDailyMonthSummary, addTrackerMonthToExpense,
};

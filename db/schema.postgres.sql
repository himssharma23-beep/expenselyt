-- Expense Lite AI - PostgreSQL schema
-- Apply with psql before starting the app in a fresh environment.

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  mobile TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  avatar_url TEXT,
  currency_code TEXT,
  locale_code TEXT,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  deleted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS currency_code TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locale_code TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_key;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_active_unique ON users (lower(username)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_active_unique ON users (lower(email)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS expenses (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  category TEXT,
  amount NUMERIC(14,2) NOT NULL,
  purchase_date DATE NOT NULL,
  is_extra BOOLEAN NOT NULL DEFAULT FALSE,
  bank_account_id BIGINT,
  source TEXT,
  source_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expenses_user ON expenses(user_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(purchase_date);

CREATE TABLE IF NOT EXISTS friends (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_friends_user ON friends(user_id);

CREATE TABLE IF NOT EXISTS loan_transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id BIGINT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  txn_date DATE NOT NULL,
  details TEXT NOT NULL,
  paid NUMERIC(14,2) NOT NULL DEFAULT 0,
  received NUMERIC(14,2) NOT NULL DEFAULT 0,
  source TEXT,
  source_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_loan_friend ON loan_transactions(friend_id);
CREATE INDEX IF NOT EXISTS idx_loan_user ON loan_transactions(user_id);

CREATE TABLE IF NOT EXISTS divide_groups (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  divide_date DATE NOT NULL,
  details TEXT NOT NULL,
  paid_by TEXT NOT NULL,
  total_amount NUMERIC(14,2) NOT NULL,
  heading TEXT,
  session_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS divide_splits (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL REFERENCES divide_groups(id) ON DELETE CASCADE,
  friend_id BIGINT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  friend_name TEXT NOT NULL,
  share_amount NUMERIC(14,2) NOT NULL,
  is_paid BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS trips (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trips_user ON trips(user_id);

CREATE TABLE IF NOT EXISTS trip_members (
  id BIGSERIAL PRIMARY KEY,
  trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  friend_id BIGINT,
  member_name TEXT NOT NULL,
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  linked_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  permission TEXT NOT NULL DEFAULT 'edit'
);

CREATE TABLE IF NOT EXISTS trip_expenses (
  id BIGSERIAL PRIMARY KEY,
  trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  paid_by_key TEXT NOT NULL,
  paid_by_name TEXT NOT NULL,
  details TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  expense_date DATE NOT NULL,
  split_mode TEXT NOT NULL DEFAULT 'equal',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trip_expense_splits (
  id BIGSERIAL PRIMARY KEY,
  expense_id BIGINT NOT NULL REFERENCES trip_expenses(id) ON DELETE CASCADE,
  member_key TEXT NOT NULL,
  member_name TEXT NOT NULL,
  share_amount NUMERIC(14,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS emi_records (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  principal NUMERIC(14,2) NOT NULL,
  annual_rate NUMERIC(8,4) NOT NULL,
  tenure_months INTEGER NOT NULL,
  monthly_emi NUMERIC(14,2) NOT NULL,
  total_interest NUMERIC(14,2) NOT NULL,
  gst_rate NUMERIC(8,4) NOT NULL DEFAULT 0,
  total_gst NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(14,2) NOT NULL,
  grand_total NUMERIC(14,2) NOT NULL,
  tag TEXT,
  status TEXT NOT NULL DEFAULT 'saved',
  start_date DATE,
  planner_advance_month INTEGER NOT NULL DEFAULT 0,
  credit_card_id BIGINT,
  gst_month_offset INTEGER NOT NULL DEFAULT 0,
  cc_processing_charge NUMERIC(14,2),
  cc_processing_gst_pct NUMERIC(8,4),
  expenses_added BOOLEAN NOT NULL DEFAULT FALSE,
  for_friend BOOLEAN NOT NULL DEFAULT FALSE,
  friend_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_emi_user ON emi_records(user_id);

CREATE TABLE IF NOT EXISTS emi_installments (
  id BIGSERIAL PRIMARY KEY,
  emi_id BIGINT NOT NULL REFERENCES emi_records(id) ON DELETE CASCADE,
  installment_no INTEGER NOT NULL,
  due_date DATE NOT NULL,
  principal_component NUMERIC(14,2) NOT NULL,
  interest_component NUMERIC(14,2) NOT NULL,
  gst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  emi_amount NUMERIC(14,2) NOT NULL,
  paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid_date DATE,
  notes TEXT,
  bank_account_id BIGINT
);
CREATE INDEX IF NOT EXISTS idx_emi_inst ON emi_installments(emi_id);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bank_name TEXT NOT NULL,
  account_name TEXT,
  account_type TEXT NOT NULL DEFAULT 'savings',
  balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  min_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bank_user ON bank_accounts(user_id);

CREATE TABLE IF NOT EXISTS default_payments (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  due_day INTEGER NOT NULL DEFAULT 1,
  interval_months INTEGER NOT NULL DEFAULT 1,
  start_month TEXT,
  category TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  bank_account_id BIGINT,
  auto_detect_bank BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_defpay_user ON default_payments(user_id);

CREATE TABLE IF NOT EXISTS monthly_payments (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  default_payment_id BIGINT,
  recurring_entry_id BIGINT,
  daily_tracker_id BIGINT,
  tracker_source_month TEXT,
  month TEXT NOT NULL,
  name TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  due_date DATE,
  paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid_date DATE,
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  bank_account_id BIGINT,
  is_skipped BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_monpay_user ON monthly_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_monpay_month ON monthly_payments(month);

CREATE TABLE IF NOT EXISTS credit_cards (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bank_name TEXT NOT NULL,
  card_name TEXT NOT NULL,
  last4 TEXT NOT NULL,
  expiry_month INTEGER,
  expiry_year INTEGER,
  bill_gen_day INTEGER NOT NULL DEFAULT 1,
  due_days INTEGER NOT NULL DEFAULT 20,
  default_discount_pct NUMERIC(8,4) NOT NULL DEFAULT 0,
  credit_limit NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cc_user ON credit_cards(user_id);

CREATE TABLE IF NOT EXISTS cc_cycles (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id BIGINT NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
  cycle_start DATE NOT NULL,
  cycle_end DATE NOT NULL,
  due_date DATE,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_discount NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_payable NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid_date DATE,
  status TEXT NOT NULL DEFAULT 'open',
  manual_total_override BOOLEAN NOT NULL DEFAULT FALSE,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cc_cycles_card ON cc_cycles(card_id);

CREATE TABLE IF NOT EXISTS cc_txns (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id BIGINT NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
  cycle_id BIGINT,
  txn_date DATE NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  discount_pct NUMERIC(8,4) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(14,2) NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  source_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cc_txns_card ON cc_txns(card_id);
CREATE INDEX IF NOT EXISTS idx_cc_txns_cycle ON cc_txns(cycle_id);

CREATE TABLE IF NOT EXISTS daily_trackers (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'unit',
  price_per_unit NUMERIC(14,2) NOT NULL,
  default_qty NUMERIC(14,3) NOT NULL DEFAULT 1,
  auto_add_to_expense BOOLEAN NOT NULL DEFAULT FALSE,
  expense_bank_account_id BIGINT,
  expense_category TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_entries (
  id BIGSERIAL PRIMARY KEY,
  tracker_id BIGINT NOT NULL REFERENCES daily_trackers(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  quantity NUMERIC(14,3) NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  is_auto BOOLEAN NOT NULL DEFAULT TRUE,
  added_to_expense BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tracker_id, entry_date)
);
CREATE INDEX IF NOT EXISTS idx_daily_entries_tracker ON daily_entries(tracker_id, entry_date);

CREATE TABLE IF NOT EXISTS recurring_entries (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  interval_months INTEGER NOT NULL DEFAULT 1,
  start_month TEXT,
  card_id BIGINT,
  bank_account_id BIGINT,
  expense_category TEXT,
  discount_pct NUMERIC(8,4) NOT NULL DEFAULT 0,
  also_expense BOOLEAN NOT NULL DEFAULT FALSE,
  is_extra BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_applied TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trip_invites (
  id BIGSERIAL PRIMARY KEY,
  trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  member_id BIGINT NOT NULL,
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at DATE,
  accepted_by BIGINT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS share_links (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  link_type TEXT NOT NULL DEFAULT 'friends',
  filters TEXT,
  expires_at DATE,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plans (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  price_monthly NUMERIC(14,2) NOT NULL DEFAULT 0,
  price_yearly NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_free BOOLEAN NOT NULL DEFAULT FALSE,
  auto_assign_on_signup BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plan_pages (
  id BIGSERIAL PRIMARY KEY,
  plan_id BIGINT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  page_key TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id BIGINT NOT NULL REFERENCES plans(id),
  billing_cycle TEXT NOT NULL DEFAULT 'monthly',
  start_date DATE NOT NULL,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS otps (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  otp_code TEXT NOT NULL,
  purpose TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS password_resets (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_lookup_usage (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL,
  query_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, usage_date)
);

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'expenses',
    'friends',
    'loan_transactions',
    'divide_groups',
    'divide_splits',
    'trips',
    'trip_members',
    'trip_expenses',
    'trip_expense_splits',
    'emi_records',
    'emi_installments',
    'bank_accounts',
    'default_payments',
    'monthly_payments',
    'credit_cards',
    'cc_cycles',
    'cc_txns',
    'daily_trackers',
    'daily_entries',
    'recurring_entries',
    'trip_invites',
    'share_links',
    'plans',
    'plan_pages',
    'user_subscriptions',
    'otps',
    'password_resets',
    'ai_lookup_usage'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id) ON DELETE SET NULL', tbl);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL', tbl);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_by BIGINT REFERENCES users(id) ON DELETE SET NULL', tbl);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()', tbl);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ', tbl);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS bank_account_id BIGINT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE daily_trackers ADD COLUMN IF NOT EXISTS expense_category TEXT;
ALTER TABLE recurring_entries ADD COLUMN IF NOT EXISTS expense_category TEXT;
ALTER TABLE loan_transactions ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE loan_transactions ADD COLUMN IF NOT EXISTS source_id BIGINT;
ALTER TABLE loan_transactions ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE loan_transactions ADD COLUMN IF NOT EXISTS updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE loan_transactions ADD COLUMN IF NOT EXISTS deleted_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE loan_transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE loan_transactions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_loan_source ON loan_transactions(user_id, source, source_id);
ALTER TABLE recurring_entries ADD COLUMN IF NOT EXISTS bank_account_id BIGINT;
ALTER TABLE daily_trackers ADD COLUMN IF NOT EXISTS auto_add_to_expense BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE daily_trackers ADD COLUMN IF NOT EXISTS expense_bank_account_id BIGINT;
ALTER TABLE emi_installments ADD COLUMN IF NOT EXISTS bank_account_id BIGINT;

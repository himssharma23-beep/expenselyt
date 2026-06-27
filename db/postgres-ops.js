const { query, withTransaction } = require('./postgres');
let recurringSchemaEnsured = false;

function num(value) {
  return Number(value || 0);
}

function _localDate(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addMonthToParts(year, month, diff = 0) {
  const date = new Date(year, month - 1 + diff, 1);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
  };
}

function recurringEntryAppliesToMonth(entry, month) {
  const interval = Math.max(1, parseInt(entry.interval_months, 10) || 1);
  if (interval <= 1) return true;
  const startMonth = entry.start_month || month;
  if (month < startMonth) return false;
  const [startY, startM] = startMonth.split('-').map(Number);
  const [curY, curM] = month.split('-').map(Number);
  if (!startY || !startM || !curY || !curM) return true;
  const diffMonths = (curY - startY) * 12 + (curM - startM);
  return diffMonths >= 0 && diffMonths % interval === 0;
}

function recurringDueDateForMonth(month, dueDay) {
  const [year, monthNo] = String(month || '').split('-').map(Number);
  if (!year || !monthNo) return null;
  const maxDay = new Date(year, monthNo, 0).getDate();
  const safeDay = Math.min(normalizeDueDay(dueDay), maxDay);
  return `${month}-${String(safeDay).padStart(2, '0')}`;
}

function localIsoToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeDueDay(value) {
  return Math.max(1, Math.min(28, parseInt(value, 10) || 1));
}

function normalizeReminderFrequency(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['once', 'daily', 'weekly'].includes(normalized) ? normalized : 'once';
}

function normalizeReminderDaysBefore(value) {
  return Math.max(0, Math.min(60, parseInt(value, 10) || 0));
}

function normalizeBankAccountId(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function ensureRecurringSchema() {
  if (recurringSchemaEnsured) return;
  await query(`ALTER TABLE recurring_entries ADD COLUMN IF NOT EXISTS school_kid_id BIGINT`);
  recurringSchemaEnsured = true;
}

function normalizeSchoolKidId(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function validationError(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function normalizeText(value, label, maxLength = 160) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  if (!normalized) throw validationError(`${label} is required`);
  if (normalized.length > maxLength) throw validationError(`${label} must be ${maxLength} characters or fewer`);
  return normalized;
}

function normalizeOptionalText(value, maxLength = 160) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  if (!normalized) return null;
  if (normalized.length > maxLength) throw validationError(`Value must be ${maxLength} characters or fewer`);
  return normalized;
}

function normalizePositiveAmount(value, label = 'Amount') {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw validationError(`${label} must be greater than 0`);
  return Math.round(amount * 100) / 100;
}

function normalizeNonNegativeAmount(value, label = 'Amount') {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw validationError(`${label} cannot be negative`);
  return Math.round(amount * 100) / 100;
}

function normalizeMonthValue(value, label = 'Month') {
  const str = String(value || '').trim();
  if (!/^\d{4}-\d{2}$/.test(str)) throw validationError(`${label} must be in YYYY-MM format`);
  return str;
}

function normalizeDateValue(value, label = 'Date') {
  const str = String(value || '').trim();
  if (!str) return null;
  const normalized = str.length >= 10 ? str.slice(0, 10) : str;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw validationError(`${label} must be in YYYY-MM-DD format`);
  return normalized;
}

function dbDateToYmd(value) {
  if (!value) return null;
  if (value instanceof Date) {
    // pg DATE values are represented as local-midnight Date objects in this app runtime.
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw.slice(0, 10);
  const dt = new Date(raw);
  if (!Number.isNaN(dt.getTime())) {
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return raw.slice(0, 10);
}

function recurringSchoolKidAcademicYearForMonth(month) {
  const [year, monthNo] = String(month || '').split('-').map(Number);
  if (!year || !monthNo) return null;
  const startYear = monthNo >= 4 ? year : (year - 1);
  const endYear = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endYear}`;
}

function recurringSchoolKidMonthFeeLabel(month) {
  const [year, monthNo] = String(month || '').split('-').map(Number);
  if (!year || !monthNo) return 'Monthly fee';
  const dt = new Date(year, monthNo - 1, 1);
  return `${dt.toLocaleString('en-US', { month: 'long' })} fees`;
}

function recurringSchoolKidClassSortValue(row) {
  const normalized = String(row?.class_label || '').trim().toLowerCase();
  const map = {
    playway: 0,
    play: 0,
    nursery: 1,
    lkg: 2,
    ukg: 3,
    '1st': 4,
    '2nd': 5,
    '3rd': 6,
    '4th': 7,
    '5th': 8,
    '6th': 9,
    '7th': 10,
    '8th': 11,
    '9th': 12,
    '10th': 13,
    '11th': 14,
    '12th': 15,
  };
  if (map[normalized] != null) return map[normalized];
  const numMatch = normalized.match(/^(\d{1,2})/);
  if (numMatch) return 100 + Number(numMatch[1]);
  return 999;
}

async function ensureOwnedSchoolKidId(userId, value) {
  const schoolKidId = normalizeSchoolKidId(value);
  if (!schoolKidId) return null;
  const result = await query(
    `SELECT id
     FROM school_kids
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [schoolKidId, userId]
  );
  if (!result.rows[0]) throw validationError('Selected school kid was not found');
  return schoolKidId;
}

async function addRecurringSchoolKidExpenseForMonth(userId, schoolKidId, month, postingDate, description, amount, client) {
  const kidId = normalizeSchoolKidId(schoolKidId);
  if (!kidId) return false;
  const academicYear = recurringSchoolKidAcademicYearForMonth(month);
  const classesResult = await client.query(
    `SELECT c.id, c.academic_year, c.class_label, c.school_name
     FROM school_kid_classes c
     INNER JOIN school_kids k ON k.id = c.kid_id
     WHERE c.kid_id = $1
       AND k.user_id = $2
     ORDER BY c.academic_year DESC, lower(c.school_name), lower(c.class_label), c.id DESC`,
    [kidId, userId]
  );
  const rows = classesResult.rows || [];
  if (!rows.length) return false;
  let classRow = rows.find((row) => String(row.academic_year || '').trim() === String(academicYear || '').trim()) || null;
  if (!classRow && academicYear) {
    const targetStartYear = Number(String(academicYear).slice(0, 4)) || 0;
    const eligible = rows
      .filter((row) => {
        const match = String(row.academic_year || '').match(/(\d{4})/);
        return match ? Number(match[1]) <= targetStartYear : false;
      })
      .sort((a, b) => {
        const aYear = Number(String(a.academic_year || '').match(/(\d{4})/)?.[1] || 0);
        const bYear = Number(String(b.academic_year || '').match(/(\d{4})/)?.[1] || 0);
        if (bYear !== aYear) return bYear - aYear;
        return recurringSchoolKidClassSortValue(b) - recurringSchoolKidClassSortValue(a);
      });
    classRow = eligible[0] || null;
  }
  if (!classRow) return false;
  await client.query(
    `INSERT INTO school_kid_expenses (kid_id, class_id, expense_date, item_name, amount, notes, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      kidId,
      Number(classRow.id),
      postingDate,
      description,
      amount,
      recurringSchoolKidMonthFeeLabel(month),
    ]
  );
  return true;
}

const TRACKER_PRICE_BASELINE_DATE = '1900-01-01';

function monthStartFromYmd(value) {
  const ymd = normalizeDateValue(value, 'Date');
  return `${ymd.slice(0, 7)}-01`;
}

async function setDailyTrackerPriceVersion(userId, trackerId, effectiveFrom, pricePerUnit, client = null) {
  const run = client || { query };
  await run.query(
    `INSERT INTO daily_tracker_prices (tracker_id, user_id, effective_from, price_per_unit, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $2, $2)
     ON CONFLICT (tracker_id, effective_from)
     DO UPDATE SET price_per_unit = EXCLUDED.price_per_unit, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
    [trackerId, userId, effectiveFrom, pricePerUnit]
  );
}

async function ensureDailyTrackerPriceBaseline(userId, trackerId, baselinePricePerUnit, client = null) {
  const run = client || { query };
  await run.query(
    `INSERT INTO daily_tracker_prices (tracker_id, user_id, effective_from, price_per_unit, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $2, $2)
     ON CONFLICT (tracker_id, effective_from) DO NOTHING`,
    [trackerId, userId, TRACKER_PRICE_BASELINE_DATE, baselinePricePerUnit]
  );
}

async function getDailyTrackerPriceForDate(userId, trackerId, entryDate, fallbackPrice = null, client = null) {
  const run = client || { query };
  const normalizedDate = normalizeDateValue(entryDate, 'Entry date');
  const priceR = await run.query(
    `SELECT price_per_unit
     FROM daily_tracker_prices
     WHERE user_id = $1 AND tracker_id = $2 AND effective_from <= $3
     ORDER BY effective_from DESC, id DESC
     LIMIT 1`,
    [userId, trackerId, normalizedDate]
  );
  if (priceR.rows[0]) return num(priceR.rows[0].price_per_unit);
  return Number.isFinite(Number(fallbackPrice)) ? num(fallbackPrice) : 0;
}

async function getDefaultBankAccountId(userId, client = null) {
  const run = client || { query };
  const result = await run.query(
    `SELECT id
     FROM bank_accounts
     WHERE user_id = $1 AND is_default = TRUE AND COALESCE(is_active, TRUE) = TRUE AND deleted_at IS NULL
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] ? Number(result.rows[0].id) : null;
}

let bankAccountHistorySchemaReadyPromise = null;

async function ensureBankAccountHistorySchema(run = null) {
  if (!bankAccountHistorySchemaReadyPromise) {
    const db = run || { query };
    bankAccountHistorySchemaReadyPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS bank_account_history (
          id BIGSERIAL PRIMARY KEY,
          user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          bank_account_id BIGINT NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
          related_bank_account_id BIGINT REFERENCES bank_accounts(id) ON DELETE SET NULL,
          entry_type TEXT NOT NULL,
          direction TEXT NOT NULL,
          amount NUMERIC(14,2) NOT NULL,
          balance_before NUMERIC(14,2) NOT NULL DEFAULT 0,
          balance_after NUMERIC(14,2) NOT NULL DEFAULT 0,
          note TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_bank_account_history_user_bank_created
        ON bank_account_history(user_id, bank_account_id, created_at DESC)
      `);
    })().catch((err) => {
      bankAccountHistorySchemaReadyPromise = null;
      throw err;
    });
  }
  return bankAccountHistorySchemaReadyPromise;
}

async function appendBankHistory(userId, bankAccountId, delta, client = null, meta = {}) {
  const normalizedId = normalizeBankAccountId(bankAccountId);
  const amount = Number(delta || 0);
  if (!normalizedId || !amount) return null;
  const run = client || { query };
  await ensureBankAccountHistorySchema(run);
  const currentR = await run.query(
    `SELECT id, bank_name, account_name, balance
     FROM bank_accounts
     WHERE id = $1 AND user_id = $2 AND COALESCE(is_active, TRUE) = TRUE AND deleted_at IS NULL
     LIMIT 1`,
    [normalizedId, userId]
  );
  const current = currentR.rows[0] || null;
  if (!current) return null;
  const balanceBefore = num(current.balance);
  const balanceAfter = Math.round((balanceBefore + amount) * 100) / 100;
  await run.query(
    `UPDATE bank_accounts
     SET balance = $1, updated_at = NOW(), updated_by = $3
     WHERE id = $2 AND user_id = $3 AND COALESCE(is_active, TRUE) = TRUE AND deleted_at IS NULL`,
    [balanceAfter, normalizedId, userId]
  );
  await run.query(
    `INSERT INTO bank_account_history (
       user_id, bank_account_id, related_bank_account_id, entry_type, direction, amount,
       balance_before, balance_after, note
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      userId,
      normalizedId,
      normalizeBankAccountId(meta.related_bank_account_id),
      String(meta.entry_type || 'balance_change').trim() || 'balance_change',
      amount >= 0 ? 'credit' : 'debit',
      Math.abs(amount),
      balanceBefore,
      balanceAfter,
      meta.note != null ? String(meta.note).trim() : null,
    ]
  );
  return {
    bank_account_id: normalizedId,
    balance_before: balanceBefore,
    balance_after: balanceAfter,
    amount,
  };
}

async function adjustBankBalance(userId, bankAccountId, delta, client = null, meta = {}) {
  await appendBankHistory(userId, bankAccountId, delta, client, meta);
}

async function insertTrackerMonthExpense(userId, tracker, year, month, client, bankAccountId = null, expenseMonth = null, expenseCategory = null) {
  const summary = await getDailyMonthSummary(userId, tracker.id, year, month);
  if (!summary || !summary.total_amount) return 0;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const itemName = `${tracker.name} - ${months[month - 1]} ${year}`;
  const targetExpenseMonth = String(expenseMonth || `${year}-${String(month).padStart(2, '0')}`).trim();
  const expenseDate = `${targetExpenseMonth}-01`;
  const targetBankId = normalizeBankAccountId(bankAccountId != null ? bankAccountId : tracker.expense_bank_account_id);
  const targetCategory = normalizeOptionalText(expenseCategory != null ? expenseCategory : tracker.expense_category, 80);

  await client.query(
    `INSERT INTO expenses (user_id, item_name, category, amount, purchase_date, is_extra, bank_account_id, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, FALSE, $6, $1, $1)`,
    [userId, itemName, targetCategory, summary.total_amount, expenseDate, targetBankId]
  );
  if (targetBankId) await adjustBankBalance(userId, targetBankId, -summary.total_amount, client);
  await client.query(
    `UPDATE daily_entries
     SET added_to_expense = TRUE, updated_at = NOW(), updated_by = $1
     WHERE user_id = $1 AND tracker_id = $2 AND entry_date::text LIKE $3`,
    [userId, tracker.id, `${year}-${String(month).padStart(2, '0')}-%`]
  );
  return summary.total_amount;
}

async function autoAddCompletedTrackerExpenses(userId) {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const year = prev.getFullYear();
  const month = prev.getMonth() + 1;
  const prefix = `${year}-${String(month).padStart(2, '0')}`;

  const trackersR = await query(
    `SELECT *
     FROM daily_trackers
     WHERE user_id = $1
       AND is_active = TRUE
       AND COALESCE(auto_add_to_expense, FALSE) = TRUE
       AND deleted_at IS NULL`,
    [userId]
  );
  if (!trackersR.rows.length) return [];

  return withTransaction(async (client) => {
    const applied = [];
    for (const tracker of trackersR.rows) {
      const statsR = await client.query(
        `SELECT
           COUNT(*)::int AS day_count,
           COALESCE(SUM(amount), 0) AS total_amount,
           MAX(CASE WHEN added_to_expense = TRUE THEN 1 ELSE 0 END) AS already_added
         FROM daily_entries
         WHERE user_id = $1 AND tracker_id = $2 AND entry_date::text LIKE $3`,
        [userId, tracker.id, `${prefix}-%`]
      );
      const stats = statsR.rows[0];
      if (!stats || Number(stats.day_count || 0) === 0) continue;
      if (Number(stats.already_added || 0) === 1) continue;
      const nextExpenseMonth = addMonthToParts(year, month, 1);
      const amount = await insertTrackerMonthExpense(
        userId,
        tracker,
        year,
        month,
        client,
        tracker.expense_bank_account_id,
        `${nextExpenseMonth.year}-${String(nextExpenseMonth.month).padStart(2, '0')}`,
        tracker.expense_category
      );
      if (amount > 0) applied.push({ tracker_id: Number(tracker.id), year, month, amount });
    }
    return applied;
  });
}

async function getAiLookupStatus(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const DEFAULT_FREE_LIMIT = 10;
  const [usageR, activeSubR, userR] = await Promise.all([
    query('SELECT query_count FROM ai_lookup_usage WHERE user_id = $1 AND usage_date = $2 LIMIT 1', [userId, today]),
    query(
      `SELECT p.is_free, p.name, p.ai_query_limit
       FROM user_subscriptions s
       JOIN plans p ON p.id = s.plan_id
       WHERE s.user_id = $1
         AND s.status = 'active'
         AND (s.end_date IS NULL OR s.end_date >= CURRENT_DATE)
       ORDER BY s.id DESC
       LIMIT 1`,
      [userId]
    ),
    query('SELECT role FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1', [userId]),
  ]);
  const usedToday = Number(usageR.rows[0]?.query_count || 0);
  const activeSub = activeSubR.rows[0] || null;
  const isAdmin = userR.rows[0]?.role === 'admin';
  const normalizeMode = (mode) => {
    const value = String(mode || '').trim().toLowerCase();
    return ['none', 'offline', 'online', 'both'].includes(value) ? value : 'both';
  };
  const modeToAllowed = (mode) => {
    const normalized = normalizeMode(mode);
    return {
      mode: normalized,
      offline: normalized === 'offline' || normalized === 'both',
      online: normalized === 'online' || normalized === 'both',
    };
  };
  const aiModeRows = await query(
    `SELECT p.ai_lookup_mode
     FROM plans p
     JOIN plan_pages pp
       ON pp.plan_id = p.id
      AND pp.page_key = 'ailookup'
     LEFT JOIN user_subscriptions s
       ON s.plan_id = p.id
      AND s.user_id = $1
      AND s.status = 'active'
      AND (s.end_date IS NULL OR s.end_date >= CURRENT_DATE)
     WHERE (p.is_free = TRUE AND p.is_active = TRUE) OR s.id IS NOT NULL`,
    [userId]
  );
  let allowOffline = false;
  let allowOnline = false;
  for (const row of aiModeRows.rows) {
    const modes = modeToAllowed(row.ai_lookup_mode);
    allowOffline = allowOffline || modes.offline;
    allowOnline = allowOnline || modes.online;
  }
  const allowedModes = isAdmin
    ? modeToAllowed('both')
    : allowOffline && allowOnline
      ? modeToAllowed('both')
      : allowOnline
        ? modeToAllowed('online')
        : allowOffline
          ? modeToAllowed('offline')
          : modeToAllowed('none');

  if (isAdmin) {
    return {
      date: today,
      dailyFreeLimit: -1,
      usedToday,
      remainingFreeQueries: -1,
      hasPaidPlan: true,
      isAdmin: true,
      planName: activeSub?.name || 'Admin',
      canAsk: true,
      allowed_modes: allowedModes,
      message: 'Admin account — unlimited AI lookups.',
    };
  }

  // Determine daily limit from plan's ai_query_limit, or fall back to default
  const planLimit = activeSub?.ai_query_limit != null ? Number(activeSub.ai_query_limit) : null;
  const dailyLimit = planLimit != null ? planLimit : (activeSub ? -1 : DEFAULT_FREE_LIMIT);
  const isUnlimited = dailyLimit === -1;
  const hasPaidPlan = !!(activeSub && !activeSub.is_free);
  const remainingFreeQueries = isUnlimited ? -1 : Math.max(0, dailyLimit - usedToday);
  const hasAnyMode = allowedModes.offline || allowedModes.online;
  const canAsk = hasAnyMode && (isUnlimited ? true : remainingFreeQueries > 0);

  return {
    date: today,
    dailyFreeLimit: isUnlimited ? -1 : dailyLimit,
    usedToday,
    remainingFreeQueries,
    hasPaidPlan,
    isAdmin: false,
    planName: activeSub?.name || null,
    canAsk,
    message: !hasAnyMode
      ? 'AI Lookup is not included in your current plan.'
      : isUnlimited
        ? `Unlimited AI lookups available on your ${activeSub?.name || 'plan'}.`
        : `Plan includes ${dailyLimit} AI lookups per day. ${remainingFreeQueries} remaining today.`,
    allowed_modes: allowedModes,
  };
}

async function getAiQueryHistory(userId, limit = 30) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 30));
  const result = await query(
    `SELECT id, question, response_preview, detected_intent, answer_type, was_fallback, created_at
     FROM ai_query_logs
     WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, safeLimit]
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    question: row.question,
    response_preview: row.response_preview || null,
    detected_intent: row.detected_intent || null,
    answer_type: row.answer_type || null,
    was_fallback: !!row.was_fallback,
    created_at: row.created_at,
  }));
}

async function recordAiLookupUsage(userId) {
  const today = new Date().toISOString().slice(0, 10);
  await query(
    `INSERT INTO ai_lookup_usage (user_id, usage_date, query_count, updated_at)
     VALUES ($1, $2, 1, NOW())
     ON CONFLICT (user_id, usage_date)
     DO UPDATE SET query_count = ai_lookup_usage.query_count + 1, updated_at = NOW()`,
    [userId, today]
  );
  return getAiLookupStatus(userId);
}

async function logAiLookupQuery(userId, payload = {}) {
  const question = String(payload.question || '').trim();
  if (!question) return null;
  const normalizedQuestion = payload.normalized_question != null
    ? String(payload.normalized_question || '').trim()
    : question.toLowerCase().replace(/\s+/g, ' ').trim();
  const detectedIntent = payload.detected_intent ? String(payload.detected_intent).trim() : null;
  const answerType = payload.answer_type ? String(payload.answer_type).trim() : 'structured_rule';
  const wasFallback = !!payload.was_fallback;
  const responsePreview = payload.response_preview ? String(payload.response_preview).slice(0, 500) : null;
  const result = await query(
    `INSERT INTO ai_query_logs (
       user_id, question, normalized_question, detected_intent, answer_type, was_fallback, response_preview, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $1, $1)
     RETURNING id`,
    [userId, question, normalizedQuestion || null, detectedIntent, answerType, wasFallback, responsePreview]
  );
  return Number(result.rows[0]?.id || 0);
}

async function getAiIntentLearningExamples(limit = 400) {
  const safeLimit = Math.max(20, Math.min(1000, Number(limit) || 400));
  const result = await query(
    `SELECT normalized_question, detected_intent, COUNT(*)::int AS use_count, MAX(created_at) AS last_seen_at
     FROM ai_query_logs
     WHERE was_fallback = FALSE
       AND COALESCE(detected_intent, '') NOT IN ('', 'unknown')
       AND COALESCE(normalized_question, '') <> ''
       AND deleted_at IS NULL
     GROUP BY normalized_question, detected_intent
     ORDER BY COUNT(*) DESC, MAX(created_at) DESC
     LIMIT $1`,
    [safeLimit]
  );
  return result.rows.map((row) => ({
    normalized_question: row.normalized_question,
    detected_intent: row.detected_intent,
    use_count: Number(row.use_count || 0),
    last_seen_at: row.last_seen_at || null,
  }));
}

async function getAiLearningReport(days = 30) {
  const safeDays = Math.max(1, Math.min(365, Number(days) || 30));
  const topQuestionsR = await query(
    `SELECT normalized_question, COUNT(*)::int AS ask_count, MAX(created_at) AS last_seen_at
     FROM ai_query_logs
     WHERE created_at >= NOW() - ($1::text || ' days')::interval
       AND COALESCE(normalized_question, '') <> ''
       AND deleted_at IS NULL
     GROUP BY normalized_question
     ORDER BY COUNT(*) DESC, MAX(created_at) DESC
     LIMIT 20`,
    [safeDays]
  );
  const topFallbackR = await query(
    `SELECT normalized_question, COUNT(*)::int AS fail_count, MAX(created_at) AS last_seen_at
     FROM ai_query_logs
     WHERE created_at >= NOW() - ($1::text || ' days')::interval
       AND was_fallback = TRUE
       AND COALESCE(normalized_question, '') <> ''
       AND deleted_at IS NULL
     GROUP BY normalized_question
     ORDER BY COUNT(*) DESC, MAX(created_at) DESC
     LIMIT 20`,
    [safeDays]
  );
  const unknownIntentR = await query(
    `SELECT normalized_question, COUNT(*)::int AS ask_count, MAX(created_at) AS last_seen_at
     FROM ai_query_logs
     WHERE created_at >= NOW() - ($1::text || ' days')::interval
       AND COALESCE(detected_intent, 'unknown') = 'unknown'
       AND deleted_at IS NULL
     GROUP BY normalized_question
     ORDER BY COUNT(*) DESC, MAX(created_at) DESC
     LIMIT 20`,
    [safeDays]
  );
  const fallbackByDayR = await query(
    `SELECT created_at::date AS day,
            COUNT(*)::int AS total_count,
            COUNT(*) FILTER (WHERE was_fallback = TRUE)::int AS fallback_count
     FROM ai_query_logs
     WHERE created_at >= NOW() - ($1::text || ' days')::interval
        AND deleted_at IS NULL
     GROUP BY created_at::date
     ORDER BY created_at::date DESC
     LIMIT $2`,
    [safeDays, safeDays]
  );
  const topIntentR = await query(
    `SELECT detected_intent, COUNT(*)::int AS ask_count
     FROM ai_query_logs
     WHERE created_at >= NOW() - ($1::text || ' days')::interval
       AND COALESCE(detected_intent, '') NOT IN ('', 'unknown')
       AND deleted_at IS NULL
     GROUP BY detected_intent
     ORDER BY COUNT(*) DESC, detected_intent ASC
     LIMIT 20`,
    [safeDays]
  );
  const recentQueriesR = await query(
    `SELECT
       q.id,
       q.question,
       q.normalized_question,
       q.detected_intent,
       q.answer_type,
       q.was_fallback,
       q.response_preview,
       q.created_at,
       q.user_id,
       COALESCE(NULLIF(u.display_name, ''), NULLIF(u.username, ''), NULLIF(u.email, ''), ('User #' || q.user_id::text)) AS user_label
     FROM ai_query_logs q
     LEFT JOIN users u ON u.id = q.user_id
     WHERE q.created_at >= NOW() - ($1::text || ' days')::interval
       AND q.deleted_at IS NULL
     ORDER BY q.created_at DESC
     LIMIT 50`,
    [safeDays]
  );
  const unresolvedQueriesR = await query(
    `SELECT
       q.id,
       q.question,
       q.normalized_question,
       q.detected_intent,
       q.answer_type,
       q.was_fallback,
       q.response_preview,
       q.created_at,
       q.user_id,
       COALESCE(NULLIF(u.display_name, ''), NULLIF(u.username, ''), NULLIF(u.email, ''), ('User #' || q.user_id::text)) AS user_label
     FROM ai_query_logs q
     LEFT JOIN users u ON u.id = q.user_id
     WHERE q.created_at >= NOW() - ($1::text || ' days')::interval
       AND q.deleted_at IS NULL
       AND (
         q.was_fallback = TRUE
         OR COALESCE(q.detected_intent, '') IN ('', 'unknown')
         OR COALESCE(q.answer_type, '') IN ('fallback')
       )
     ORDER BY q.created_at DESC
     LIMIT 50`,
    [safeDays]
  );
  return {
    days: safeDays,
    top_questions: topQuestionsR.rows.map((row) => ({
      normalized_question: row.normalized_question,
      ask_count: Number(row.ask_count || 0),
      last_seen_at: row.last_seen_at || null,
    })),
    top_fallback_questions: topFallbackR.rows.map((row) => ({
      normalized_question: row.normalized_question,
      fail_count: Number(row.fail_count || 0),
      last_seen_at: row.last_seen_at || null,
    })),
    unknown_intents: unknownIntentR.rows.map((row) => ({
      normalized_question: row.normalized_question,
      ask_count: Number(row.ask_count || 0),
      last_seen_at: row.last_seen_at || null,
    })),
    fallback_by_day: fallbackByDayR.rows.map((row) => ({
      day: row.day,
      total_count: Number(row.total_count || 0),
      fallback_count: Number(row.fallback_count || 0),
    })),
    top_intents: topIntentR.rows.map((row) => ({
      detected_intent: row.detected_intent,
      ask_count: Number(row.ask_count || 0),
    })),
    recent_queries: recentQueriesR.rows.map((row) => ({
      id: Number(row.id || 0),
      user_id: Number(row.user_id || 0),
      user_label: row.user_label || `User #${row.user_id || ''}`,
      question: row.question || '',
      normalized_question: row.normalized_question || '',
      detected_intent: row.detected_intent || 'unknown',
      answer_type: row.answer_type || '',
      was_fallback: !!row.was_fallback,
      response_preview: row.response_preview || '',
      created_at: row.created_at || null,
    })),
    unresolved_queries: unresolvedQueriesR.rows.map((row) => ({
      id: Number(row.id || 0),
      user_id: Number(row.user_id || 0),
      user_label: row.user_label || `User #${row.user_id || ''}`,
      question: row.question || '',
      normalized_question: row.normalized_question || '',
      detected_intent: row.detected_intent || 'unknown',
      answer_type: row.answer_type || '',
      was_fallback: !!row.was_fallback,
      response_preview: row.response_preview || '',
      created_at: row.created_at || null,
    })),
  };
}

async function teachAiIntent(normalizedQuestion, detectedIntent, adminUserId) {
  const normalized = String(normalizedQuestion || '').trim().toLowerCase();
  const intent = String(detectedIntent || '').trim();
  if (!normalized) throw new Error('Normalized question is required');
  if (!intent) throw new Error('Detected intent is required');
  const result = await query(
    `UPDATE ai_query_logs
     SET detected_intent = $2,
         was_fallback = FALSE,
         answer_type = 'admin_taught',
         updated_at = NOW(),
         updated_by = $3
     WHERE normalized_question = $1
       AND deleted_at IS NULL`,
    [normalized, intent, adminUserId]
  );
  return { updated_count: Number(result.rowCount || 0) };
}

async function ensureAiTrainingExamplesTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS ai_training_examples (
      id BIGSERIAL PRIMARY KEY,
      normalized_question TEXT NOT NULL UNIQUE,
      original_question TEXT,
      detected_intent TEXT,
      ideal_answer TEXT NOT NULL,
      notes TEXT,
      training_payload JSONB,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      deleted_at TIMESTAMPTZ
    )
  `);
  await query('CREATE INDEX IF NOT EXISTS idx_ai_training_examples_active ON ai_training_examples(is_active, updated_at DESC)');
}

async function saveAiTrainingExample(payload = {}, adminUserId) {
  await ensureAiTrainingExamplesTable();
  const originalQuestion = String(payload.question || '').trim();
  const normalizedQuestion = String(payload.normalized_question || originalQuestion || '').trim().toLowerCase();
  const detectedIntent = payload.detected_intent ? String(payload.detected_intent).trim() : null;
  const idealAnswer = String(payload.ideal_answer || '').trim();
  const notes = payload.notes ? String(payload.notes).trim() : null;
  const trainingPayload = payload.training_payload && typeof payload.training_payload === 'object'
    ? payload.training_payload
    : null;

  if (!normalizedQuestion) throw new Error('normalized_question is required');
  if (!idealAnswer) throw new Error('ideal_answer is required');

  const result = await query(
    `INSERT INTO ai_training_examples (
       normalized_question, original_question, detected_intent, ideal_answer, notes, training_payload, is_active, created_by, updated_by, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $7, NOW())
     ON CONFLICT (normalized_question)
     DO UPDATE SET
       original_question = EXCLUDED.original_question,
       detected_intent = EXCLUDED.detected_intent,
       ideal_answer = EXCLUDED.ideal_answer,
       notes = EXCLUDED.notes,
       training_payload = EXCLUDED.training_payload,
       is_active = TRUE,
       updated_at = NOW(),
       updated_by = EXCLUDED.updated_by
     RETURNING id, normalized_question, detected_intent, ideal_answer, updated_at`,
    [normalizedQuestion, originalQuestion || null, detectedIntent, idealAnswer, notes, trainingPayload ? JSON.stringify(trainingPayload) : null, adminUserId]
  );

  const row = result.rows[0] || {};
  return {
    id: Number(row.id || 0),
    normalized_question: row.normalized_question || normalizedQuestion,
    detected_intent: row.detected_intent || detectedIntent,
    ideal_answer: row.ideal_answer || idealAnswer,
    updated_at: row.updated_at || null,
  };
}

async function findAiTrainingExample(normalizedQuestion) {
  await ensureAiTrainingExamplesTable();
  const normalized = String(normalizedQuestion || '').trim().toLowerCase();
  if (!normalized) return null;
  const result = await query(
    `SELECT id, normalized_question, original_question, detected_intent, ideal_answer, notes, training_payload, updated_at
     FROM ai_training_examples
     WHERE normalized_question = $1
       AND is_active = TRUE
       AND deleted_at IS NULL
     LIMIT 1`,
    [normalized]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: Number(row.id || 0),
    normalized_question: row.normalized_question,
    original_question: row.original_question || null,
    detected_intent: row.detected_intent || null,
    ideal_answer: row.ideal_answer || '',
    notes: row.notes || null,
    training_payload: row.training_payload || null,
    updated_at: row.updated_at || null,
  };
}

async function getBankAccounts(userId) {
  const result = await query(
    `SELECT *
     FROM bank_accounts
     WHERE user_id = $1 AND is_active = TRUE AND deleted_at IS NULL
     ORDER BY is_default DESC, created_at ASC`,
    [userId]
  );
  return result.rows.map((row) => ({ ...row, balance: num(row.balance), min_balance: num(row.min_balance), is_default: !!row.is_default, is_active: !!row.is_active }));
}

async function getBankAccountHistory(userId, bankAccountId, limit = 200) {
  const normalizedId = normalizeBankAccountId(bankAccountId);
  if (!normalizedId) throw validationError('Bank account is required');
  await ensureBankAccountHistorySchema();
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 200));
  const result = await query(
    `SELECT
       h.*,
       b.bank_name,
       b.account_name,
       rb.bank_name AS related_bank_name,
       rb.account_name AS related_account_name
     FROM bank_account_history h
     JOIN bank_accounts b
       ON b.id = h.bank_account_id
     LEFT JOIN bank_accounts rb
       ON rb.id = h.related_bank_account_id
     WHERE h.user_id = $1
       AND h.bank_account_id = $2
     ORDER BY h.created_at DESC, h.id DESC
     LIMIT $3`,
    [userId, normalizedId, safeLimit]
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    bank_account_id: Number(row.bank_account_id),
    related_bank_account_id: row.related_bank_account_id ? Number(row.related_bank_account_id) : null,
    bank_name: row.bank_name || '',
    account_name: row.account_name || '',
    related_bank_name: row.related_bank_name || '',
    related_account_name: row.related_account_name || '',
    entry_type: row.entry_type || 'balance_change',
    direction: row.direction || 'credit',
    amount: num(row.amount),
    balance_before: num(row.balance_before),
    balance_after: num(row.balance_after),
    note: row.note || '',
    created_at: row.created_at,
  }));
}

async function addBankAccount(userId, account) {
  return withTransaction(async (client) => {
    const bankName = normalizeText(account.bank_name, 'Bank name', 80);
    const accountName = normalizeOptionalText(account.account_name, 80);
    const balance = normalizeNonNegativeAmount(account.balance || 0, 'Balance');
    const minBalance = normalizeNonNegativeAmount(account.min_balance || 0, 'Minimum balance');
    const result = await client.query(
      `INSERT INTO bank_accounts (user_id, bank_name, account_name, account_type, balance, min_balance, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $1, $1)
       RETURNING id`,
      [userId, bankName, accountName, account.account_type || 'savings', balance, minBalance]
    );
    const id = Number(result.rows[0].id);
    const countR = await client.query('SELECT COUNT(*)::int AS c FROM bank_accounts WHERE user_id = $1 AND is_active = TRUE AND deleted_at IS NULL', [userId]);
    if (countR.rows[0]?.c === 1) {
      await client.query('UPDATE bank_accounts SET is_default = TRUE WHERE id = $1', [id]);
    }
    if (balance > 0) {
      await ensureBankAccountHistorySchema(client);
      await client.query(
        `INSERT INTO bank_account_history (
           user_id, bank_account_id, entry_type, direction, amount, balance_before, balance_after, note
         ) VALUES ($1, $2, 'opening_balance', 'credit', $3, 0, $3, $4)`,
        [userId, id, balance, 'Opening balance']
      );
    }
    return id;
  });
}

async function updateBankAccount(userId, id, account) {
  const bankName = normalizeText(account.bank_name, 'Bank name', 80);
  const accountName = normalizeOptionalText(account.account_name, 80);
  const balance = normalizeNonNegativeAmount(account.balance || 0, 'Balance');
  const minBalance = normalizeNonNegativeAmount(account.min_balance || 0, 'Minimum balance');
  await withTransaction(async (client) => {
    const currentR = await client.query(
      `SELECT balance
       FROM bank_accounts
       WHERE id = $1 AND user_id = $2 AND COALESCE(is_active, TRUE) = TRUE AND deleted_at IS NULL
       LIMIT 1`,
      [id, userId]
    );
    const current = currentR.rows[0] || null;
    if (!current) throw validationError('Bank account not found');
    const prevBalance = num(current.balance);
    await client.query(
      `UPDATE bank_accounts
       SET bank_name = $1, account_name = $2, account_type = $3, balance = $4, min_balance = $5, updated_at = NOW(), updated_by = $7
       WHERE id = $6 AND user_id = $7`,
      [bankName, accountName, account.account_type || 'savings', balance, minBalance, id, userId]
    );
    const delta = Math.round((balance - prevBalance) * 100) / 100;
    if (delta !== 0) {
      await ensureBankAccountHistorySchema(client);
      await client.query(
        `INSERT INTO bank_account_history (
           user_id, bank_account_id, entry_type, direction, amount, balance_before, balance_after, note
         ) VALUES ($1, $2, 'balance_set', $3, $4, $5, $6, $7)`,
        [
          userId,
          Number(id),
          delta >= 0 ? 'credit' : 'debit',
          Math.abs(delta),
          prevBalance,
          balance,
          'Balance edited from account settings',
        ]
      );
    }
  });
}

async function updateBankBalance(userId, id, balance) {
  const nextBalance = normalizeNonNegativeAmount(balance, 'Balance');
  await withTransaction(async (client) => {
    const currentR = await client.query(
      `SELECT balance
       FROM bank_accounts
       WHERE id = $1 AND user_id = $2 AND COALESCE(is_active, TRUE) = TRUE AND deleted_at IS NULL
       LIMIT 1`,
      [id, userId]
    );
    const current = currentR.rows[0] || null;
    if (!current) throw validationError('Bank account not found');
    const prevBalance = num(current.balance);
    await client.query(
      'UPDATE bank_accounts SET balance = $1, updated_at = NOW(), updated_by = $3 WHERE id = $2 AND user_id = $3',
      [nextBalance, id, userId]
    );
    const delta = Math.round((nextBalance - prevBalance) * 100) / 100;
    if (delta !== 0) {
      await ensureBankAccountHistorySchema(client);
      await client.query(
        `INSERT INTO bank_account_history (
           user_id, bank_account_id, entry_type, direction, amount, balance_before, balance_after, note
         ) VALUES ($1, $2, 'balance_set', $3, $4, $5, $6, $7)`,
        [
          userId,
          Number(id),
          delta >= 0 ? 'credit' : 'debit',
          Math.abs(delta),
          prevBalance,
          nextBalance,
          'Balance edited manually',
        ]
      );
    }
  });
}

async function setDefaultBankAccount(userId, id) {
  await withTransaction(async (client) => {
    await client.query('UPDATE bank_accounts SET is_default = FALSE WHERE user_id = $1', [userId]);
    await client.query('UPDATE bank_accounts SET is_default = TRUE WHERE id = $1 AND user_id = $2', [id, userId]);
  });
}

async function transferBetweenBankAccounts(userId, payload = {}) {
  return withTransaction(async (client) => {
    const fromBankId = normalizeBankAccountId(payload.from_bank_id);
    const toBankId = normalizeBankAccountId(payload.to_bank_id);
    const amount = normalizePositiveAmount(payload.amount, 'Transfer amount');
    if (!fromBankId) throw validationError('Source bank account is required');
    if (!toBankId) throw validationError('Destination bank account is required');
    if (fromBankId === toBankId) throw validationError('Choose two different bank accounts');

    const sourceResult = await client.query(
      `SELECT id, bank_name, account_name, balance, min_balance
       FROM bank_accounts
       WHERE id = $1 AND user_id = $2 AND is_active = TRUE AND deleted_at IS NULL
       LIMIT 1`,
      [fromBankId, userId]
    );
    const targetResult = await client.query(
      `SELECT id, bank_name, account_name, balance, min_balance
       FROM bank_accounts
       WHERE id = $1 AND user_id = $2 AND is_active = TRUE AND deleted_at IS NULL
       LIMIT 1`,
      [toBankId, userId]
    );

    const source = sourceResult.rows[0] || null;
    const target = targetResult.rows[0] || null;
    if (!source) throw validationError('Source bank account was not found');
    if (!target) throw validationError('Destination bank account was not found');

    const sourceBalance = num(source.balance);
    const sourceMinBalance = num(source.min_balance);
    const sourceSpendable = Math.max(0, sourceBalance - sourceMinBalance);
    if (amount > sourceSpendable) {
      throw validationError('Transfer amount exceeds spendable balance in source account');
    }

    const sourceLabel = [source.bank_name, source.account_name].filter(Boolean).join(' - ');
    const targetLabel = [target.bank_name, target.account_name].filter(Boolean).join(' - ');
    const cleanNotes = payload.notes ? String(payload.notes).trim() : '';

    await adjustBankBalance(userId, fromBankId, -amount, client, {
      entry_type: 'transfer_out',
      related_bank_account_id: toBankId,
      note: cleanNotes || `Transfer to ${targetLabel}`,
    });
    await adjustBankBalance(userId, toBankId, amount, client, {
      entry_type: 'transfer_in',
      related_bank_account_id: fromBankId,
      note: cleanNotes || `Transfer from ${sourceLabel}`,
    });

    return {
      success: true,
      from_bank_id: fromBankId,
      to_bank_id: toBankId,
      amount,
      source_spendable_before: sourceSpendable,
      source_balance_after: Math.round((sourceBalance - amount) * 100) / 100,
      target_balance_after: Math.round((num(target.balance) + amount) * 100) / 100,
    };
  });
}

async function deleteBankAccount(userId, id) {
  await withTransaction(async (client) => {
    await client.query('DELETE FROM bank_accounts WHERE id = $1 AND user_id = $2', [id, userId]);
    const nextR = await client.query(
      `SELECT id
       FROM bank_accounts
       WHERE user_id = $1 AND is_active = TRUE AND deleted_at IS NULL
       ORDER BY created_at ASC
       LIMIT 1`,
      [userId]
    );
    if (nextR.rows[0]) await client.query('UPDATE bank_accounts SET is_default = TRUE WHERE id = $1', [nextR.rows[0].id]);
  });
}

async function getDefaultPayments(userId) {
  const result = await query('SELECT * FROM default_payments WHERE user_id = $1 AND deleted_at IS NULL ORDER BY due_day ASC, name ASC', [userId]);
  return result.rows.map((row) => ({ ...row, amount: num(row.amount), auto_detect_bank: !!row.auto_detect_bank, is_active: !!row.is_active }));
}

async function addDefaultPayment(userId, payment) {
  const name = normalizeText(payment.name, 'Payment name', 120);
  const amount = normalizePositiveAmount(payment.amount);
  const dueDay = Math.max(1, Math.min(28, parseInt(payment.due_day, 10) || 1));
  const result = await query(
    `INSERT INTO default_payments (user_id, name, amount, due_day, interval_months, start_month, category, bank_account_id, auto_detect_bank)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [userId, name, amount, dueDay, 1, null, normalizeOptionalText(payment.category, 80), normalizeBankAccountId(payment.bank_account_id), !!payment.auto_detect_bank]
  );
  return Number(result.rows[0].id);
}

async function updateDefaultPayment(userId, id, payment) {
  const name = normalizeText(payment.name, 'Payment name', 120);
  const amount = normalizePositiveAmount(payment.amount);
  const dueDay = Math.max(1, Math.min(28, parseInt(payment.due_day, 10) || 1));
  await query(
    `UPDATE default_payments
     SET name = $1, amount = $2, due_day = $3, interval_months = $4, start_month = $5, category = $6,
         is_active = $7, bank_account_id = $8, auto_detect_bank = $9
     WHERE id = $10 AND user_id = $11`,
    [name, amount, dueDay, 1, null, normalizeOptionalText(payment.category, 80), payment.is_active != null ? !!payment.is_active : true, normalizeBankAccountId(payment.bank_account_id), !!payment.auto_detect_bank, id, userId]
  );
}

async function deleteDefaultPayment(userId, id) {
  await query('DELETE FROM default_payments WHERE id = $1 AND user_id = $2', [id, userId]);
}

async function generateMonthlyPayments(userId, month) {
  const [yr, mo] = month.split('-').map(Number);
  const [defaults, recurringEntries, trackerPlannerItems] = await Promise.all([
    getDefaultPayments(userId).then((rows) => rows.filter((row) => row.is_active)),
    getRecurringEntries(userId).then((rows) => rows.filter((row) => row.is_active && row.type === 'expense' && !row.card_id)),
    getDailyTrackerPlannerItems(userId, month),
  ]);
  await withTransaction(async (client) => {
    for (const dp of defaults) {
      const exists = await client.query(
        `SELECT id FROM monthly_payments WHERE user_id = $1 AND month = $2 AND default_payment_id = $3 LIMIT 1`,
        [userId, month, dp.id]
      );
      if (exists.rows[0]) continue;
      const dueDay = Math.min(dp.due_day || 1, new Date(yr, mo, 0).getDate());
      const dueDate = `${month}-${String(dueDay).padStart(2, '0')}`;
      let bankAccountId = dp.bank_account_id || null;
      if (dp.auto_detect_bank) {
        const defBank = await client.query(
          'SELECT id FROM bank_accounts WHERE user_id = $1 AND is_default = TRUE AND COALESCE(is_active, TRUE) = TRUE AND deleted_at IS NULL LIMIT 1',
          [userId]
        );
        if (defBank.rows[0]) bankAccountId = defBank.rows[0].id;
      }
      await client.query(
        `INSERT INTO monthly_payments (user_id, default_payment_id, month, name, amount, due_date, bank_account_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [userId, dp.id, month, dp.name, dp.amount, dueDate, bankAccountId]
      );
    }
    for (const entry of recurringEntries) {
      if (!recurringEntryAppliesToMonth(entry, month)) continue;
      const exists = await client.query(
        `SELECT id FROM monthly_payments WHERE user_id = $1 AND month = $2 AND recurring_entry_id = $3 LIMIT 1`,
        [userId, month, entry.id]
      );
      const dueDay = Math.min(normalizeDueDay(entry.due_day), new Date(yr, mo, 0).getDate());
      const dueDate = `${month}-${String(dueDay).padStart(2, '0')}`;
      if (exists.rows[0]) {
        await client.query(
          `UPDATE monthly_payments
           SET name = $1,
               amount = $2,
               due_date = $3,
               bank_account_id = $4,
               notes = $5
           WHERE id = $6
             AND (status = 'pending' OR status IS NULL)
             AND COALESCE(paid_amount, 0) <= 0`,
          [entry.description, entry.amount, dueDate, normalizeBankAccountId(entry.bank_account_id), 'Recurring entry', exists.rows[0].id]
        );
        continue;
      }
      await client.query(
        `INSERT INTO monthly_payments (user_id, recurring_entry_id, month, name, amount, due_date, bank_account_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [userId, entry.id, month, entry.description, entry.amount, dueDate, normalizeBankAccountId(entry.bank_account_id), 'Recurring entry']
      );
    }
    for (const item of trackerPlannerItems) {
      const exists = await client.query(
        `SELECT id, status, paid_amount
         FROM monthly_payments
         WHERE user_id = $1 AND month = $2 AND daily_tracker_id = $3 AND tracker_source_month = $4
         LIMIT 1`,
        [userId, month, item.daily_tracker_id, item.tracker_source_month]
      );
      const existing = exists.rows[0];
      if (existing) {
        const existingPaid = parseFloat(existing.paid_amount) || 0;
        const canRefresh = (existing.status === 'pending' || !existing.status) && existingPaid <= 0;
        if (canRefresh) {
          await client.query(
            `UPDATE monthly_payments
             SET name = $1, amount = $2, due_date = $3, notes = $4
             WHERE id = $5`,
            [item.name, item.amount, item.due_date, item.notes || 'Daily tracker total', existing.id]
          );
        }
        continue;
      }
      await client.query(
        `INSERT INTO monthly_payments (user_id, daily_tracker_id, tracker_source_month, month, name, amount, due_date, bank_account_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [userId, item.daily_tracker_id, item.tracker_source_month, month, item.name, item.amount, item.due_date, null, item.notes || 'Daily tracker total']
      );
    }
  });
}

async function getMonthlyPayments(userId, month) {
  await generateMonthlyPayments(userId, month);
  const result = await query(
    `SELECT *
     FROM monthly_payments
     WHERE user_id = $1 AND month = $2 AND COALESCE(is_skipped, FALSE) = FALSE
     ORDER BY due_date ASC, name ASC`,
    [userId, month]
  );
  return result.rows.map((row) => ({ ...row, amount: num(row.amount), paid_amount: num(row.paid_amount), is_skipped: !!row.is_skipped }));
}

async function getSkippedPayments(userId, month) {
  const result = await query(
    `SELECT *
     FROM monthly_payments
     WHERE user_id = $1 AND month = $2 AND is_skipped = TRUE
     ORDER BY due_date ASC, name ASC`,
    [userId, month]
  );
  return result.rows.map((row) => ({ ...row, amount: num(row.amount), paid_amount: num(row.paid_amount), is_skipped: !!row.is_skipped }));
}

async function restoreMonthlyPayment(userId, id) {
  await query('UPDATE monthly_payments SET is_skipped = FALSE WHERE id = $1 AND user_id = $2', [id, userId]);
}

async function addMonthlyPayment(userId, payment) {
  const month = normalizeMonthValue(payment.month);
  const name = normalizeText(payment.name, 'Payment name', 120);
  const amount = normalizePositiveAmount(payment.amount);
  const result = await query(
    `INSERT INTO monthly_payments (user_id, month, name, amount, due_date, notes, bank_account_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [userId, month, name, amount, normalizeDateValue(payment.due_date, 'Due date'), normalizeOptionalText(payment.notes, 240), normalizeBankAccountId(payment.bank_account_id)]
  );
  return Number(result.rows[0].id);
}

async function updateMonthlyPayment(userId, id, payment) {
  const name = normalizeText(payment.name, 'Payment name', 120);
  const amount = normalizePositiveAmount(payment.amount);
  await query(
    `UPDATE monthly_payments
     SET name = $1, amount = $2, due_date = $3, notes = $4, bank_account_id = $5
     WHERE id = $6 AND user_id = $7`,
    [name, amount, normalizeDateValue(payment.due_date, 'Due date'), normalizeOptionalText(payment.notes, 240), normalizeBankAccountId(payment.bank_account_id), id, userId]
  );
}

async function deleteMonthlyPayment(userId, id) {
  const result = await query('SELECT * FROM monthly_payments WHERE id = $1 AND user_id = $2 LIMIT 1', [id, userId]);
  const payment = result.rows[0];
  if (!payment) return;
  if (payment.default_payment_id) {
    await query('UPDATE monthly_payments SET is_skipped = TRUE WHERE id = $1', [id]);
  } else {
    await query('DELETE FROM monthly_payments WHERE id = $1 AND user_id = $2', [id, userId]);
  }
}

async function hardDeleteMonthlyPayment(userId, id) {
  await query('DELETE FROM monthly_payments WHERE id = $1 AND user_id = $2', [id, userId]);
}

async function payMonthlyPayment(userId, id, paidAmount, paidDate, bankAccountId = undefined) {
  return withTransaction(async (client) => {
    const paymentR = await client.query('SELECT * FROM monthly_payments WHERE id = $1 AND user_id = $2 LIMIT 1', [id, userId]);
    const payment = paymentR.rows[0];
    if (!payment) throw validationError('Payment not found');
    const paid = normalizeNonNegativeAmount(paidAmount || 0, 'Paid amount');
    const prevPaid = parseFloat(payment.paid_amount) || 0;
    const amount = parseFloat(payment.amount) || 0;
    const status = paid <= 0 ? 'pending' : paid >= amount - 0.01 ? 'paid' : 'partial';
    const effectivePaidDate = paid > 0 ? (normalizeDateValue(paidDate, 'Paid date') || _localDate(new Date())) : null;
    const prevBankId = normalizeBankAccountId(payment.bank_account_id) || await getDefaultBankAccountId(userId, client);
    const requestedBankId = bankAccountId !== undefined ? normalizeBankAccountId(bankAccountId) : normalizeBankAccountId(payment.bank_account_id);
    const nextBankId = paid > 0 ? (requestedBankId || await getDefaultBankAccountId(userId, client)) : null;
    await client.query(
      `UPDATE monthly_payments
       SET paid_amount = $1, paid_date = $2, status = $3, bank_account_id = $4
       WHERE id = $5`,
      [paid, effectivePaidDate, status, nextBankId, id]
    );
    if (prevBankId && nextBankId && prevBankId === nextBankId) {
      const diff = paid - prevPaid;
      if (diff !== 0) await adjustBankBalance(userId, nextBankId, -diff, client);
    } else {
      if (prevBankId && prevPaid > 0) await adjustBankBalance(userId, prevBankId, prevPaid, client);
      if (nextBankId && paid > 0) await adjustBankBalance(userId, nextBankId, -paid, client);
    }
  });
}

async function getDailyTrackers(userId) {
  await autoAddCompletedTrackerExpenses(userId);
  const now = new Date();
  const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const result = await query(
    `SELECT
       t.*,
       COALESCE(SUM(e.amount), 0) AS current_month_total,
       COUNT(e.id) AS current_month_days
     FROM daily_trackers t
     LEFT JOIN daily_entries e
       ON e.tracker_id = t.id
      AND e.entry_date::text LIKE $2
     WHERE t.user_id = $1 AND t.deleted_at IS NULL
     GROUP BY t.id
     ORDER BY t.name`,
    [userId, `${prefix}-%`]
  );
  return result.rows.map((row) => ({
    ...row,
    price_per_unit: num(row.price_per_unit),
    default_qty: Number(row.default_qty || 0),
    current_month_total: num(row.current_month_total),
    current_month_days: Number(row.current_month_days || 0),
    auto_add_to_expense: !!row.auto_add_to_expense,
    expense_bank_account_id: normalizeBankAccountId(row.expense_bank_account_id),
    is_active: !!row.is_active,
  }));
}

async function addDailyTracker(userId, data) {
  const name = normalizeText(data.name, 'Tracker name', 80);
  const unit = normalizeText(data.unit || 'unit', 'Unit', 30);
  const pricePerUnit = normalizePositiveAmount(data.price_per_unit, 'Price per unit');
  const defaultQty = Number(data.default_qty);
  if (!Number.isFinite(defaultQty) || defaultQty < 0) throw validationError('Default quantity cannot be negative');
  const expenseBankAccountId = normalizeBankAccountId(data.expense_bank_account_id);
  const expenseCategory = normalizeOptionalText(data.expense_category, 80);
  const result = await query(
    `INSERT INTO daily_trackers (user_id, name, unit, price_per_unit, default_qty, is_active, auto_add_to_expense, expense_bank_account_id, expense_category, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $1, $1)
     RETURNING id`,
    [userId, name, unit, pricePerUnit, defaultQty || 1, data.is_active != null ? !!data.is_active : true, !!data.auto_add_to_expense, expenseBankAccountId, expenseCategory]
  );
  const trackerId = Number(result.rows[0].id);
  await ensureDailyTrackerPriceBaseline(userId, trackerId, pricePerUnit);
  return trackerId;
}

async function updateDailyTracker(userId, id, data) {
  const trackerId = Number(id);
  if (!Number.isFinite(trackerId) || trackerId <= 0) throw validationError('Invalid tracker id');
  const trackerR = await query(
    'SELECT id, price_per_unit FROM daily_trackers WHERE id = $1 AND user_id = $2 LIMIT 1',
    [trackerId, userId]
  );
  const currentTracker = trackerR.rows[0];
  if (!currentTracker) throw validationError('Tracker not found');

  const name = normalizeText(data.name, 'Tracker name', 80);
  const unit = normalizeText(data.unit || 'unit', 'Unit', 30);
  const pricePerUnit = normalizePositiveAmount(data.price_per_unit, 'Price per unit');
  const defaultQty = Number(data.default_qty);
  if (!Number.isFinite(defaultQty) || defaultQty < 0) throw validationError('Default quantity cannot be negative');
  const expenseBankAccountId = normalizeBankAccountId(data.expense_bank_account_id);
  const expenseCategory = normalizeOptionalText(data.expense_category, 80);
  await query(
    `UPDATE daily_trackers
     SET name = $1, unit = $2, price_per_unit = $3, default_qty = $4, is_active = $5,
         auto_add_to_expense = $6, expense_bank_account_id = $7, expense_category = $8, updated_at = NOW(), updated_by = $10
     WHERE id = $9 AND user_id = $10`,
    [name, unit, pricePerUnit, defaultQty || 1, data.is_active != null ? !!data.is_active : true, !!data.auto_add_to_expense, expenseBankAccountId, expenseCategory, trackerId, userId]
  );

  // Keep historical tracker prices immutable for prior months.
  await ensureDailyTrackerPriceBaseline(userId, trackerId, num(currentTracker.price_per_unit));
  const currentMonthStart = monthStartFromYmd(_localDate(new Date()));
  await setDailyTrackerPriceVersion(userId, trackerId, currentMonthStart, pricePerUnit);
}

async function deleteDailyTracker(userId, id) {
  await query('DELETE FROM daily_trackers WHERE id = $1 AND user_id = $2', [id, userId]);
}

async function getDailyEntries(userId, trackerId, year, month) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const result = await query(
    `SELECT *
     FROM daily_entries
     WHERE user_id = $1 AND tracker_id = $2 AND entry_date::text LIKE $3
     ORDER BY entry_date`,
    [userId, trackerId, `${prefix}-%`]
  );
  return result.rows.map((row) => ({
    ...row,
    entry_date: dbDateToYmd(row.entry_date),
    quantity: Number(row.quantity || 0),
    amount: num(row.amount),
    is_auto: !!row.is_auto,
    added_to_expense: !!row.added_to_expense,
  }));
}

async function upsertDailyEntry(userId, trackerId, date, qty, isAuto) {
  const trackerR = await query('SELECT * FROM daily_trackers WHERE id = $1 AND user_id = $2 LIMIT 1', [trackerId, userId]);
  const tracker = trackerR.rows[0];
  if (!tracker) throw validationError('Tracker not found');
  const entryDate = normalizeDateValue(date, 'Entry date');
  const quantity = Number(qty);
  if (!Number.isFinite(quantity) || quantity < 0) throw validationError('Quantity cannot be negative');
  const unitPrice = await getDailyTrackerPriceForDate(userId, trackerId, entryDate, tracker.price_per_unit);
  const amount = Math.round(quantity * unitPrice * 100) / 100;
  await query(
    `INSERT INTO daily_entries (tracker_id, user_id, entry_date, quantity, amount, is_auto)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tracker_id, entry_date)
     DO UPDATE SET quantity = EXCLUDED.quantity, amount = EXCLUDED.amount, is_auto = EXCLUDED.is_auto`,
    [trackerId, userId, entryDate, quantity, amount, !!isAuto]
  );
  return { amount };
}

async function autoFillDailyEntries(userId, trackerId, year, month) {
  const trackerR = await query('SELECT * FROM daily_trackers WHERE id = $1 AND user_id = $2 LIMIT 1', [trackerId, userId]);
  const tracker = trackerR.rows[0];
  if (!tracker) throw new Error('Tracker not found');
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const existingR = await query(
    `SELECT entry_date
     FROM daily_entries
     WHERE tracker_id = $1 AND entry_date::text LIKE $2`,
    [trackerId, `${prefix}-%`]
  );
  const existing = new Set(existingR.rows.map((row) => dbDateToYmd(row.entry_date)));
  const monthStart = `${prefix}-01`;
  const unitPrice = await getDailyTrackerPriceForDate(userId, trackerId, monthStart, tracker.price_per_unit);
  const amount = Math.round(parseFloat(tracker.default_qty) * unitPrice * 100) / 100;
  const daysInMonth = new Date(year, month, 0).getDate();
  let filled = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${prefix}-${String(day).padStart(2, '0')}`;
    if (!existing.has(dateStr)) {
      await query(
        `INSERT INTO daily_entries (tracker_id, user_id, entry_date, quantity, amount, is_auto)
         VALUES ($1, $2, $3, $4, $5, TRUE)
         ON CONFLICT (tracker_id, entry_date) DO NOTHING`,
        [trackerId, userId, dateStr, parseFloat(tracker.default_qty), amount]
      );
      filled++;
    }
  }
  return filled;
}

async function getDailyMonthSummary(userId, trackerId, year, month) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const result = await query(
    `SELECT
       COUNT(*) AS days,
       ROUND(COALESCE(SUM(quantity), 0)::numeric, 3) AS total_qty,
       ROUND(COALESCE(SUM(amount), 0)::numeric, 2) AS total_amount,
       SUM(CASE WHEN is_auto = TRUE THEN 1 ELSE 0 END) AS auto_days,
       SUM(CASE WHEN is_auto = FALSE THEN 1 ELSE 0 END) AS edited_days,
       MAX(CASE WHEN added_to_expense = TRUE THEN 1 ELSE 0 END) AS added_to_expense
     FROM daily_entries
     WHERE user_id = $1 AND tracker_id = $2 AND entry_date::text LIKE $3`,
    [userId, trackerId, `${prefix}-%`]
  );
  const row = result.rows[0] || {};
  return {
    days: Number(row.days || 0),
    total_qty: Number(row.total_qty || 0),
    total_amount: num(row.total_amount),
    auto_days: Number(row.auto_days || 0),
    edited_days: Number(row.edited_days || 0),
    added_to_expense: Number(row.added_to_expense || 0),
  };
}

async function addTrackerMonthToExpense(userId, trackerId, year, month, options = {}) {
  const trackerR = await query('SELECT * FROM daily_trackers WHERE id = $1 AND user_id = $2 LIMIT 1', [trackerId, userId]);
  const tracker = trackerR.rows[0];
  if (!tracker) throw new Error('Tracker not found');
  return withTransaction(async (client) => insertTrackerMonthExpense(
    userId,
    tracker,
    year,
    month,
    client,
    options.bank_account_id,
    options.expense_month,
    options.expense_category
  ));
}

function normalizeExpenseBucketFrequency(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['none', 'daily', 'monthly'].includes(normalized) ? normalized : 'none';
}

function normalizeExpenseBucketIntervalMonths(value) {
  const parsed = parseInt(value, 10);
  const safe = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  const allowed = [1, 2, 3, 6, 12];
  return allowed.includes(safe) ? safe : 1;
}

function normalizeExpenseBucketDay(value, fallback = 1) {
  const parsed = Number(value);
  const safe = Number.isInteger(parsed) && parsed >= 1 && parsed <= 28 ? parsed : Number(fallback || 1);
  return Math.max(1, Math.min(28, safe));
}

function bucketEntryDateInRange(dateStr, bucket = {}) {
  if (!dateStr) return false;
  if (bucket.start_date && dateStr < String(bucket.start_date)) return false;
  if (bucket.end_date && dateStr > String(bucket.end_date)) return false;
  return true;
}

function bucketMonthKey(dateStr) {
  return String(dateStr || '').slice(0, 7);
}

function bucketNextMonth(monthKey) {
  const [year, month] = String(monthKey || '').split('-').map(Number);
  if (!year || !month) return null;
  const next = new Date(year, month, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
}

function bucketAdvanceMonths(monthKey, months = 1) {
  const [year, month] = String(monthKey || '').split('-').map(Number);
  const step = Math.max(1, parseInt(months, 10) || 1);
  if (!year || !month) return null;
  const next = new Date(year, month - 1 + step, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
}

async function getExpenseBucketById(userId, bucketId) {
  const safeId = Number(bucketId);
  if (!Number.isFinite(safeId) || safeId <= 0) throw validationError('Invalid bucket id');
  const result = await query(
    `SELECT *
     FROM expense_buckets
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [safeId, userId]
  );
  return result.rows[0] || null;
}

async function ensureExpenseBucketGeneratedEntryUniqueIndex() {
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uniq_expense_bucket_generated_entry
      ON expense_bucket_entries(source_template_id, entry_date)
      WHERE source_template_id IS NOT NULL AND is_template = FALSE`
  );
}

async function ensureExpenseBucketTemplateColumns() {
  await query(
    `ALTER TABLE expense_bucket_entries
      ADD COLUMN IF NOT EXISTS auto_add_interval_months INTEGER NOT NULL DEFAULT 1`
  );
}

async function ensureExpenseBucketEntrySkipsTable() {
  await query(
    `CREATE TABLE IF NOT EXISTS expense_bucket_entry_skips (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bucket_id BIGINT NOT NULL REFERENCES expense_buckets(id) ON DELETE CASCADE,
      source_template_id BIGINT NOT NULL REFERENCES expense_bucket_entries(id) ON DELETE CASCADE,
      entry_date DATE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (source_template_id, entry_date)
    )`
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_expense_bucket_entry_skips_template
      ON expense_bucket_entry_skips(source_template_id, entry_date)`
  );
}

async function applyExpenseBucketTemplates(userId, bucketId = null) {
  await ensureExpenseBucketTemplateColumns();
  await ensureExpenseBucketEntrySkipsTable();
  const today = localIsoToday();
  const params = [userId];
  let bucketFilter = '';
  if (bucketId != null) {
    params.push(Number(bucketId));
    bucketFilter = ' AND b.id = $2';
  }
  const templateR = await query(
    `SELECT
       e.*,
       b.start_date AS bucket_start_date,
       b.end_date AS bucket_end_date,
       b.is_active AS bucket_is_active
     FROM expense_bucket_entries e
     JOIN expense_buckets b ON b.id = e.bucket_id
     WHERE e.user_id = $1
       AND e.is_template = TRUE
       AND e.auto_add_enabled = TRUE
       AND b.is_active = TRUE${bucketFilter}
     ORDER BY e.bucket_id ASC, e.id ASC`,
    params
  );
  let created = 0;
  for (const template of (templateR.rows || [])) {
    const frequency = normalizeExpenseBucketFrequency(template.auto_add_frequency);
    const intervalMonths = frequency === 'monthly'
      ? normalizeExpenseBucketIntervalMonths(template.auto_add_interval_months)
      : 1;
    if (frequency === 'none') continue;
    const bucket = {
      start_date: dbDateToYmd(template.bucket_start_date),
      end_date: dbDateToYmd(template.bucket_end_date),
    };
    const anchorDate = dbDateToYmd(template.entry_date) || bucket.start_date || today;
    if (!anchorDate || anchorDate > today) continue;
    if (frequency === 'daily') {
      let cursor = bucket.start_date && bucket.start_date > anchorDate ? bucket.start_date : anchorDate;
      while (cursor && cursor <= today) {
        if (bucketEntryDateInRange(cursor, bucket)) {
          await query(
            `INSERT INTO expense_bucket_entries (
               bucket_id, user_id, name, entry_type, entry_date, amount,
               is_template, is_auto_generated, auto_add_enabled, auto_add_frequency, auto_add_day, auto_add_interval_months,
               reminder_enabled, reminder_days_before, reminder_frequency, reminder_silent,
               source_template_id, created_by, updated_by
             )
             SELECT $1, $2, $3, $4, $5, $6, FALSE, TRUE, FALSE, 'none', NULL, 1, FALSE, 0, 'once', FALSE, $7, $2, $2
             WHERE NOT EXISTS (
               SELECT 1
               FROM expense_bucket_entry_skips s
               WHERE s.user_id = $2
                 AND s.bucket_id = $1
                 AND s.source_template_id = $7
                 AND s.entry_date = $5
             )
             ON CONFLICT DO NOTHING`,
            [template.bucket_id, userId, template.name, template.entry_type || null, cursor, num(template.amount), template.id]
          );
          created += 1;
        }
        const next = new Date(`${cursor}T00:00:00`);
        next.setDate(next.getDate() + 1);
        cursor = _localDate(next);
      }
    } else if (frequency === 'monthly') {
      const day = normalizeExpenseBucketDay(template.auto_add_day, String(anchorDate).slice(8, 10));
      let monthCursor = bucket.start_date && bucketMonthKey(bucket.start_date) > bucketMonthKey(anchorDate)
        ? bucketMonthKey(bucket.start_date)
        : bucketMonthKey(anchorDate);
      const todayMonth = bucketMonthKey(today);
      while (monthCursor && monthCursor <= todayMonth) {
        const candidate = recurringDueDateForMonth(monthCursor, day);
        if (candidate && candidate >= anchorDate && candidate <= today && bucketEntryDateInRange(candidate, bucket)) {
          await query(
            `INSERT INTO expense_bucket_entries (
               bucket_id, user_id, name, entry_type, entry_date, amount,
               is_template, is_auto_generated, auto_add_enabled, auto_add_frequency, auto_add_day, auto_add_interval_months,
               reminder_enabled, reminder_days_before, reminder_frequency, reminder_silent,
               source_template_id, created_by, updated_by
             )
             SELECT $1, $2, $3, $4, $5, $6, FALSE, TRUE, FALSE, 'none', NULL, 1, FALSE, 0, 'once', FALSE, $7, $2, $2
             WHERE NOT EXISTS (
               SELECT 1
               FROM expense_bucket_entry_skips s
               WHERE s.user_id = $2
                 AND s.bucket_id = $1
                 AND s.source_template_id = $7
                 AND s.entry_date = $5
             )
             ON CONFLICT DO NOTHING`,
            [template.bucket_id, userId, template.name, template.entry_type || null, candidate, num(template.amount), template.id]
          );
          created += 1;
        }
        monthCursor = bucketAdvanceMonths(monthCursor, intervalMonths);
      }
    }
  }
  return created;
}

async function cleanupExpenseBucketGeneratedDuplicates(userId, bucketId = null) {
  const params = [userId];
  let bucketFilter = '';
  if (bucketId != null) {
    params.push(Number(bucketId));
    bucketFilter = ' AND bucket_id = $2';
  }
  await query(
    `DELETE FROM expense_bucket_entries e
     WHERE e.user_id = $1${bucketFilter}
       AND e.is_template = FALSE
       AND e.source_template_id IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM expense_bucket_entries newer
         WHERE newer.user_id = e.user_id
           AND newer.bucket_id = e.bucket_id
           AND newer.source_template_id = e.source_template_id
           AND newer.entry_date = e.entry_date
           AND newer.id > e.id
       )`,
    params
  );
}

async function getExpenseBuckets(userId) {
  await ensureExpenseBucketEntrySkipsTable();
  await cleanupExpenseBucketGeneratedDuplicates(userId);
  await ensureExpenseBucketGeneratedEntryUniqueIndex();
  await applyExpenseBucketTemplates(userId);
  await cleanupExpenseBucketGeneratedDuplicates(userId);
  await ensureExpenseBucketGeneratedEntryUniqueIndex();
  const result = await query(
    `SELECT
       b.*,
       COALESCE(SUM(CASE WHEN e.is_template = FALSE THEN e.amount ELSE 0 END), 0) AS total_amount,
       COUNT(CASE WHEN e.is_template = FALSE THEN 1 END) AS expense_count,
       COUNT(CASE WHEN e.is_template = TRUE THEN 1 END) AS template_count
     FROM expense_buckets b
     LEFT JOIN expense_bucket_entries e
       ON e.bucket_id = b.id
      AND e.user_id = b.user_id
     WHERE b.user_id = $1
     GROUP BY b.id
     ORDER BY COALESCE(b.start_date, CURRENT_DATE) DESC, lower(b.name) ASC, b.id DESC`,
    [userId]
  );
  return (result.rows || []).map((row) => ({
    ...row,
    start_date: dbDateToYmd(row.start_date),
    end_date: dbDateToYmd(row.end_date),
    total_amount: num(row.total_amount),
    expense_count: Number(row.expense_count || 0),
    template_count: Number(row.template_count || 0),
    is_tax_saver: !!row.is_tax_saver,
    is_active: !!row.is_active,
  }));
}

async function addExpenseBucket(userId, data = {}) {
  const name = normalizeText(data.name, 'Bucket name', 100);
  const startDate = normalizeDateValue(data.start_date, 'Start date');
  const endDate = normalizeDateValue(data.end_date, 'End date');
  if (startDate && endDate && endDate < startDate) throw validationError('End date cannot be before start date');
  const result = await query(
    `INSERT INTO expense_buckets (user_id, name, start_date, end_date, is_tax_saver, is_active, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $1, $1)
     RETURNING id`,
    [userId, name, startDate, endDate, !!data.is_tax_saver, data.is_active != null ? !!data.is_active : true]
  );
  return Number(result.rows[0]?.id || 0);
}

async function updateExpenseBucket(userId, bucketId, data = {}) {
  const bucket = await getExpenseBucketById(userId, bucketId);
  if (!bucket) throw validationError('Bucket not found');
  const name = normalizeText(data.name, 'Bucket name', 100);
  const startDate = normalizeDateValue(data.start_date, 'Start date');
  const endDate = normalizeDateValue(data.end_date, 'End date');
  if (startDate && endDate && endDate < startDate) throw validationError('End date cannot be before start date');
  await query(
    `UPDATE expense_buckets
     SET name = $1,
         start_date = $2,
         end_date = $3,
         is_tax_saver = $4,
         is_active = $5,
         updated_at = NOW(),
         updated_by = $7
     WHERE id = $6
       AND user_id = $7`,
    [name, startDate, endDate, !!data.is_tax_saver, data.is_active != null ? !!data.is_active : true, Number(bucketId), userId]
  );
}

async function deleteExpenseBucket(userId, bucketId) {
  await query('DELETE FROM expense_buckets WHERE id = $1 AND user_id = $2', [bucketId, userId]);
}

function mapExpenseBucketEntryRow(row) {
  return {
    ...row,
    entry_date: dbDateToYmd(row.entry_date),
    amount: num(row.amount),
    is_template: !!row.is_template,
    is_auto_generated: !!row.is_auto_generated,
    auto_add_enabled: !!row.auto_add_enabled,
    auto_add_interval_months: normalizeExpenseBucketIntervalMonths(row.auto_add_interval_months),
    reminder_enabled: !!row.reminder_enabled,
    reminder_days_before: normalizeReminderDaysBefore(row.reminder_days_before),
    reminder_frequency: normalizeReminderFrequency(row.reminder_frequency),
    reminder_silent: !!row.reminder_silent,
  };
}

async function getExpenseBucketEntries(userId, bucketId) {
  const bucket = await getExpenseBucketById(userId, bucketId);
  if (!bucket) throw validationError('Bucket not found');
  await ensureExpenseBucketTemplateColumns();
  await ensureExpenseBucketEntrySkipsTable();
  await cleanupExpenseBucketGeneratedDuplicates(userId, bucketId);
  await ensureExpenseBucketGeneratedEntryUniqueIndex();
  await applyExpenseBucketTemplates(userId, bucketId);
  await cleanupExpenseBucketGeneratedDuplicates(userId, bucketId);
  await ensureExpenseBucketGeneratedEntryUniqueIndex();
  const result = await query(
    `SELECT *
     FROM expense_bucket_entries
     WHERE bucket_id = $1
       AND user_id = $2
     ORDER BY is_template DESC, entry_date DESC, id DESC`,
    [bucketId, userId]
  );
  return (result.rows || []).map(mapExpenseBucketEntryRow);
}

async function addExpenseBucketEntry(userId, bucketId, data = {}) {
  const bucket = await getExpenseBucketById(userId, bucketId);
  if (!bucket) throw validationError('Bucket not found');
  await ensureExpenseBucketTemplateColumns();
  const name = normalizeText(data.name, 'Entry name', 120);
  const entryType = normalizeOptionalText(data.entry_type, 60);
  const entryDate = normalizeDateValue(data.entry_date, 'Entry date');
  const amount = normalizePositiveAmount(data.amount, 'Amount');
  const autoAddEnabled = !!data.auto_add_enabled;
  const autoAddFrequency = autoAddEnabled ? normalizeExpenseBucketFrequency(data.auto_add_frequency) : 'none';
  const autoAddIntervalMonths = autoAddFrequency === 'monthly' ? normalizeExpenseBucketIntervalMonths(data.auto_add_interval_months) : 1;
  const autoAddDay = autoAddFrequency === 'monthly' ? normalizeExpenseBucketDay(data.auto_add_day, String(entryDate).slice(8, 10)) : null;
  const reminderEnabled = !!data.reminder_enabled;
  const reminderDaysBefore = normalizeReminderDaysBefore(data.reminder_days_before);
  const reminderFrequency = normalizeReminderFrequency(data.reminder_frequency);
  const reminderSilent = !!data.reminder_silent;
  const isTemplate = autoAddEnabled && autoAddFrequency !== 'none';
  const result = await query(
    `INSERT INTO expense_bucket_entries (
       bucket_id, user_id, name, entry_type, entry_date, amount, is_template, is_auto_generated,
       auto_add_enabled, auto_add_frequency, auto_add_day, auto_add_interval_months,
       reminder_enabled, reminder_days_before, reminder_frequency, reminder_silent,
       created_by, updated_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, $8, $9, $10, $11, $12, $13, $14, $15, $2, $2)
     RETURNING id`,
    [bucketId, userId, name, entryType, entryDate, amount, isTemplate, autoAddEnabled, autoAddFrequency, autoAddDay, autoAddIntervalMonths, reminderEnabled, reminderDaysBefore, reminderFrequency, reminderSilent]
  );
  if (isTemplate) await applyExpenseBucketTemplates(userId, bucketId);
  return Number(result.rows[0]?.id || 0);
}

async function updateExpenseBucketEntry(userId, bucketId, entryId, data = {}) {
  const bucket = await getExpenseBucketById(userId, bucketId);
  if (!bucket) throw validationError('Bucket not found');
  await ensureExpenseBucketTemplateColumns();
  const currentR = await query(
    `SELECT *
     FROM expense_bucket_entries
     WHERE id = $1 AND bucket_id = $2 AND user_id = $3
     LIMIT 1`,
    [entryId, bucketId, userId]
  );
  const current = currentR.rows[0];
  if (!current) throw validationError('Entry not found');
  const name = normalizeText(data.name, 'Entry name', 120);
  const entryType = normalizeOptionalText(data.entry_type, 60);
  const entryDate = normalizeDateValue(data.entry_date, 'Entry date');
  const amount = normalizePositiveAmount(data.amount, 'Amount');
  const autoAddEnabled = !!data.auto_add_enabled;
  const autoAddFrequency = autoAddEnabled ? normalizeExpenseBucketFrequency(data.auto_add_frequency) : 'none';
  const autoAddIntervalMonths = autoAddFrequency === 'monthly' ? normalizeExpenseBucketIntervalMonths(data.auto_add_interval_months) : 1;
  const autoAddDay = autoAddFrequency === 'monthly' ? normalizeExpenseBucketDay(data.auto_add_day, String(entryDate).slice(8, 10)) : null;
  const reminderEnabled = !!data.reminder_enabled;
  const reminderDaysBefore = normalizeReminderDaysBefore(data.reminder_days_before);
  const reminderFrequency = normalizeReminderFrequency(data.reminder_frequency);
  const reminderSilent = !!data.reminder_silent;
  const isTemplate = autoAddEnabled && autoAddFrequency !== 'none';
  await query(
    `UPDATE expense_bucket_entries
     SET name = $1,
         entry_type = $2,
         entry_date = $3,
         amount = $4,
         is_template = $5,
         auto_add_enabled = $6,
         auto_add_frequency = $7,
         auto_add_day = $8,
         auto_add_interval_months = $9,
         reminder_enabled = $10,
         reminder_days_before = $11,
         reminder_frequency = $12,
         reminder_silent = $13,
         updated_at = NOW(),
         updated_by = $15
     WHERE id = $14
       AND bucket_id = $16
       AND user_id = $15`,
    [name, entryType, entryDate, amount, isTemplate, autoAddEnabled, autoAddFrequency, autoAddDay, autoAddIntervalMonths, reminderEnabled, reminderDaysBefore, reminderFrequency, reminderSilent, entryId, userId, bucketId]
  );
  if (isTemplate) {
    await applyExpenseBucketTemplates(userId, bucketId);
  }
}

async function deleteExpenseBucketEntry(userId, bucketId, entryId) {
  const currentR = await query(
    `SELECT id, is_template, is_auto_generated, source_template_id, entry_date
     FROM expense_bucket_entries
     WHERE id = $1 AND bucket_id = $2 AND user_id = $3
     LIMIT 1`,
    [entryId, bucketId, userId]
  );
  const current = currentR.rows[0];
  if (!current) throw validationError('Entry not found');
  await ensureExpenseBucketEntrySkipsTable();
  if (current.is_template) {
    await query('DELETE FROM expense_bucket_entries WHERE source_template_id = $1 AND user_id = $2', [entryId, userId]);
    await query('DELETE FROM expense_bucket_entry_skips WHERE source_template_id = $1 AND user_id = $2', [entryId, userId]);
  } else if (current.is_auto_generated && current.source_template_id) {
    await query(
      `INSERT INTO expense_bucket_entry_skips (user_id, bucket_id, source_template_id, entry_date)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (source_template_id, entry_date) DO NOTHING`,
      [userId, bucketId, current.source_template_id, current.entry_date]
    );
  }
  await query('DELETE FROM expense_bucket_entries WHERE id = $1 AND bucket_id = $2 AND user_id = $3', [entryId, bucketId, userId]);
}

function mapFixedDepositRow(row) {
  const today = localIsoToday();
  const maturityDate = dbDateToYmd(row.maturity_date);
  return {
    ...row,
    deposit_date: dbDateToYmd(row.deposit_date),
    maturity_date: maturityDate,
    amount_deposited: num(row.amount_deposited),
    maturity_amount: num(row.maturity_amount),
    interest_amount: num(row.interest_amount),
    interest_rate: num(row.interest_rate),
    tenure_months: row.tenure_months != null ? Number(row.tenure_months) : null,
    tenure_years: row.tenure_years != null ? Number(row.tenure_years) : 0,
    tenure_extra_months: row.tenure_extra_months != null ? Number(row.tenure_extra_months) : 0,
    tenure_days: row.tenure_days != null ? Number(row.tenure_days) : 0,
    notify_enabled: !!row.notify_enabled,
    email_enabled: !!row.email_enabled,
    reminder_days_before: normalizeReminderDaysBefore(row.reminder_days_before),
    reminder_frequency: normalizeReminderFrequency(row.reminder_frequency),
    reminder_silent: !!row.reminder_silent,
    is_active: !!row.is_active,
    status: maturityDate && maturityDate < today ? 'expired' : 'ongoing',
  };
}

async function ensureFixedDepositDurationColumns() {
  await query(`ALTER TABLE fixed_deposits ADD COLUMN IF NOT EXISTS tenure_years INTEGER NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE fixed_deposits ADD COLUMN IF NOT EXISTS tenure_extra_months INTEGER NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE fixed_deposits ADD COLUMN IF NOT EXISTS tenure_days INTEGER NOT NULL DEFAULT 0`);
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

async function getFixedDeposits(userId, filters = {}) {
  await ensureFixedDepositDurationColumns();
  const params = [userId];
  const clauses = ['user_id = $1'];
  const personName = String(filters.person_name || '').trim();
  if (personName && personName.toLowerCase() !== 'all') {
    params.push(personName);
    clauses.push(`person_name = $${params.length}`);
  }
  const status = String(filters.status || '').trim().toLowerCase();
  const today = localIsoToday();
  if (status === 'ongoing') {
    params.push(today);
    clauses.push(`maturity_date >= $${params.length}`);
  } else if (status === 'expired') {
    params.push(today);
    clauses.push(`maturity_date < $${params.length}`);
  }
  const result = await query(
    `SELECT *
     FROM fixed_deposits
     WHERE ${clauses.join(' AND ')}
     ORDER BY maturity_date ASC, lower(person_name) ASC, lower(bank_name) ASC, id DESC`,
    params
  );
  return (result.rows || []).map(mapFixedDepositRow);
}

async function addFixedDeposit(userId, data = {}) {
  await ensureFixedDepositDurationColumns();
  const personName = normalizeText(data.person_name, 'Person name', 100);
  const bankName = normalizeText(data.bank_name, 'Bank name', 100);
  const fdNumber = normalizeText(data.fd_number, 'FD number', 120);
  const interestRate = normalizeNonNegativeAmount(data.interest_rate || 0, 'Interest rate');
  const tenureYears = normalizeNonNegativeInteger(data.tenure_years, 0);
  const tenureExtraMonths = normalizeNonNegativeInteger(data.tenure_extra_months, 0);
  const tenureDays = normalizeNonNegativeInteger(data.tenure_days, 0);
  const tenureMonths = data.tenure_months == null || data.tenure_months === ''
    ? ((tenureYears || tenureExtraMonths || tenureDays) ? (tenureYears * 12) + tenureExtraMonths : null)
    : Math.max(1, parseInt(data.tenure_months, 10) || 0);
  const depositDate = normalizeDateValue(data.deposit_date, 'Deposit date');
  const maturityDate = normalizeDateValue(data.maturity_date, 'Maturity date');
  if (!depositDate || !maturityDate) throw validationError('Deposit date and maturity date are required');
  if (maturityDate < depositDate) throw validationError('Maturity date cannot be before deposit date');
  const amountDeposited = normalizePositiveAmount(data.amount_deposited, 'Amount deposited');
  const maturityAmount = normalizeNonNegativeAmount(data.maturity_amount || 0, 'Amount matured');
  const interestAmount = normalizeNonNegativeAmount(data.interest_amount || 0, 'Interest amount');
  const notifyEnabled = !!data.notify_enabled;
  const emailEnabled = !!data.email_enabled;
  const reminderDaysBefore = normalizeReminderDaysBefore(data.reminder_days_before);
  const reminderFrequency = normalizeReminderFrequency(data.reminder_frequency);
  const reminderSilent = !!data.reminder_silent;
  const isActive = data.is_active != null ? !!data.is_active : true;
  const result = await query(
    `INSERT INTO fixed_deposits (
      user_id, person_name, bank_name, fd_number, interest_rate, tenure_months,
      tenure_years, tenure_extra_months, tenure_days,
      deposit_date, maturity_date, amount_deposited, maturity_amount, interest_amount,
      notify_enabled, email_enabled, reminder_days_before, reminder_frequency, reminder_silent,
      is_active, created_by, updated_by
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$1,$1)
    RETURNING id`,
    [userId, personName, bankName, fdNumber, interestRate, tenureMonths, tenureYears, tenureExtraMonths, tenureDays, depositDate, maturityDate, amountDeposited, maturityAmount, interestAmount, notifyEnabled, emailEnabled, reminderDaysBefore, reminderFrequency, reminderSilent, isActive]
  );
  return Number(result.rows[0]?.id || 0);
}

async function updateFixedDeposit(userId, id, data = {}) {
  await ensureFixedDepositDurationColumns();
  const currentR = await query('SELECT id FROM fixed_deposits WHERE id = $1 AND user_id = $2 LIMIT 1', [id, userId]);
  if (!currentR.rows[0]) throw validationError('FD not found');
  const personName = normalizeText(data.person_name, 'Person name', 100);
  const bankName = normalizeText(data.bank_name, 'Bank name', 100);
  const fdNumber = normalizeText(data.fd_number, 'FD number', 120);
  const interestRate = normalizeNonNegativeAmount(data.interest_rate || 0, 'Interest rate');
  const tenureYears = normalizeNonNegativeInteger(data.tenure_years, 0);
  const tenureExtraMonths = normalizeNonNegativeInteger(data.tenure_extra_months, 0);
  const tenureDays = normalizeNonNegativeInteger(data.tenure_days, 0);
  const tenureMonths = data.tenure_months == null || data.tenure_months === ''
    ? ((tenureYears || tenureExtraMonths || tenureDays) ? (tenureYears * 12) + tenureExtraMonths : null)
    : Math.max(1, parseInt(data.tenure_months, 10) || 0);
  const depositDate = normalizeDateValue(data.deposit_date, 'Deposit date');
  const maturityDate = normalizeDateValue(data.maturity_date, 'Maturity date');
  if (!depositDate || !maturityDate) throw validationError('Deposit date and maturity date are required');
  if (maturityDate < depositDate) throw validationError('Maturity date cannot be before deposit date');
  const amountDeposited = normalizePositiveAmount(data.amount_deposited, 'Amount deposited');
  const maturityAmount = normalizeNonNegativeAmount(data.maturity_amount || 0, 'Amount matured');
  const interestAmount = normalizeNonNegativeAmount(data.interest_amount || 0, 'Interest amount');
  const notifyEnabled = !!data.notify_enabled;
  const emailEnabled = !!data.email_enabled;
  const reminderDaysBefore = normalizeReminderDaysBefore(data.reminder_days_before);
  const reminderFrequency = normalizeReminderFrequency(data.reminder_frequency);
  const reminderSilent = !!data.reminder_silent;
  const isActive = data.is_active != null ? !!data.is_active : true;
  await query(
    `UPDATE fixed_deposits
     SET person_name = $1,
         bank_name = $2,
         fd_number = $3,
         interest_rate = $4,
         tenure_months = $5,
         tenure_years = $6,
         tenure_extra_months = $7,
         tenure_days = $8,
         deposit_date = $9,
         maturity_date = $10,
         amount_deposited = $11,
         maturity_amount = $12,
         interest_amount = $13,
         notify_enabled = $14,
         email_enabled = $15,
         reminder_days_before = $16,
         reminder_frequency = $17,
         reminder_silent = $18,
         is_active = $19,
         updated_at = NOW(),
         updated_by = $21
     WHERE id = $20
       AND user_id = $21`,
    [personName, bankName, fdNumber, interestRate, tenureMonths, tenureYears, tenureExtraMonths, tenureDays, depositDate, maturityDate, amountDeposited, maturityAmount, interestAmount, notifyEnabled, emailEnabled, reminderDaysBefore, reminderFrequency, reminderSilent, isActive, id, userId]
  );
}

async function deleteFixedDeposit(userId, id) {
  await query('DELETE FROM fixed_deposits WHERE id = $1 AND user_id = $2', [id, userId]);
}

function normalizeHabitBinaryValue(value, label = 'Value') {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || ![0, 1].includes(parsed)) throw validationError(`${label} must be 0 or 1`);
  return parsed;
}

function normalizeTrackerMonthPart(value, label, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw validationError(`${label} is invalid`);
  return parsed;
}

function habitMonthPrefix(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function habitDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

async function ensureHabitEntriesForMonth(userId, trackerId, year, month) {
  const safeYear = normalizeTrackerMonthPart(year, 'Year', 2000, 2100);
  const safeMonth = normalizeTrackerMonthPart(month, 'Month', 1, 12);
  const trackerR = await query(
    'SELECT id, default_value FROM habit_trackers WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL LIMIT 1',
    [trackerId, userId]
  );
  const tracker = trackerR.rows[0];
  if (!tracker) throw validationError('Tracker not found');
  const prefix = habitMonthPrefix(safeYear, safeMonth);
  const existingR = await query(
    `SELECT entry_date
     FROM habit_entries
     WHERE tracker_id = $1
       AND user_id = $2
       AND entry_date::text LIKE $3`,
    [trackerId, userId, `${prefix}-%`]
  );
  const existing = new Set(existingR.rows.map((row) => dbDateToYmd(row.entry_date)));
  const totalDays = habitDaysInMonth(safeYear, safeMonth);
  const defaultValue = normalizeHabitBinaryValue(tracker.default_value, 'Default value');
  for (let day = 1; day <= totalDays; day++) {
    const dateStr = `${prefix}-${String(day).padStart(2, '0')}`;
    if (existing.has(dateStr)) continue;
    await query(
      `INSERT INTO habit_entries (tracker_id, user_id, entry_date, entry_value, is_auto)
       VALUES ($1, $2, $3, $4, TRUE)
       ON CONFLICT (tracker_id, entry_date) DO NOTHING`,
      [trackerId, userId, dateStr, defaultValue]
    );
  }
}

async function getHabitTrackers(userId, year, month) {
  const now = new Date();
  const safeYear = normalizeTrackerMonthPart(year || now.getFullYear(), 'Year', 2000, 2100);
  const safeMonth = normalizeTrackerMonthPart(month || (now.getMonth() + 1), 'Month', 1, 12);
  const trackersR = await query(
    `SELECT *
     FROM habit_trackers
     WHERE user_id = $1
       AND deleted_at IS NULL
     ORDER BY lower(name) ASC, id ASC`,
    [userId]
  );
  const trackers = trackersR.rows || [];
  for (const tracker of trackers) {
    await ensureHabitEntriesForMonth(userId, tracker.id, safeYear, safeMonth);
  }
  const prefix = habitMonthPrefix(safeYear, safeMonth);
  const todayKey = dbDateToYmd(new Date()) || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const summaryR = await query(
    `SELECT
       t.id,
       COUNT(e.id) AS total_days,
       COALESCE(SUM(CASE WHEN e.entry_value = 1 THEN 1 ELSE 0 END), 0) AS one_days,
       MAX(CASE WHEN e.entry_date = $3::date THEN e.entry_value END) AS today_value
     FROM habit_trackers t
     LEFT JOIN habit_entries e
       ON e.tracker_id = t.id
      AND e.user_id = $1
       AND e.entry_date::text LIKE $2
     WHERE t.user_id = $1
       AND t.deleted_at IS NULL
     GROUP BY t.id`,
    [userId, `${prefix}-%`, todayKey]
  );
  const summaryMap = new Map(summaryR.rows.map((row) => [Number(row.id), row]));
  const daysInMonth = habitDaysInMonth(safeYear, safeMonth);
  return trackers.map((row) => {
    const summary = summaryMap.get(Number(row.id)) || {};
    const oneDays = Number(summary.one_days || 0);
    const totalDays = Number(summary.total_days || 0) || daysInMonth;
    return {
      ...row,
      default_value: normalizeHabitBinaryValue(row.default_value, 'Default value'),
      notes: row.notes || '',
      is_active: !!row.is_active,
      month_one_days: oneDays,
      month_total_days: totalDays,
      month_percent: totalDays ? Math.round((oneDays / totalDays) * 10000) / 100 : 0,
      today_value: summary.today_value == null ? null : normalizeHabitBinaryValue(summary.today_value, 'Today value'),
    };
  });
}

async function addHabitTracker(userId, data = {}) {
  const name = normalizeText(data.name, 'Tracker name', 80);
  const defaultValue = normalizeHabitBinaryValue(data.default_value ?? 0, 'Default daily value');
  const notes = normalizeOptionalText(data.notes, 500);
  const result = await query(
    `INSERT INTO habit_trackers (user_id, name, default_value, notes, is_active, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $1, $1)
     RETURNING id`,
    [userId, name, defaultValue, notes, data.is_active != null ? !!data.is_active : true]
  );
  return Number(result.rows[0]?.id || 0);
}

async function updateHabitTracker(userId, id, data = {}) {
  const trackerId = Number(id);
  if (!Number.isFinite(trackerId) || trackerId <= 0) throw validationError('Invalid tracker id');
  const trackerR = await query(
    'SELECT id FROM habit_trackers WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL LIMIT 1',
    [trackerId, userId]
  );
  if (!trackerR.rows[0]) throw validationError('Tracker not found');
  const name = normalizeText(data.name, 'Tracker name', 80);
  const defaultValue = normalizeHabitBinaryValue(data.default_value ?? 0, 'Default daily value');
  const notes = normalizeOptionalText(data.notes, 500);
  await query(
    `UPDATE habit_trackers
     SET name = $1,
         default_value = $2,
         notes = $3,
         is_active = $4,
         updated_at = NOW(),
         updated_by = $6
     WHERE id = $5
       AND user_id = $6`,
    [name, defaultValue, notes, data.is_active != null ? !!data.is_active : true, trackerId, userId]
  );
}

async function deleteHabitTracker(userId, id) {
  await query('DELETE FROM habit_trackers WHERE id = $1 AND user_id = $2', [id, userId]);
}

async function getHabitEntries(userId, trackerId, year, month) {
  const safeYear = normalizeTrackerMonthPart(year, 'Year', 2000, 2100);
  const safeMonth = normalizeTrackerMonthPart(month, 'Month', 1, 12);
  await ensureHabitEntriesForMonth(userId, trackerId, safeYear, safeMonth);
  const prefix = habitMonthPrefix(safeYear, safeMonth);
  const result = await query(
    `SELECT *
     FROM habit_entries
     WHERE user_id = $1
       AND tracker_id = $2
       AND entry_date::text LIKE $3
     ORDER BY entry_date ASC`,
    [userId, trackerId, `${prefix}-%`]
  );
  return result.rows.map((row) => ({
    ...row,
    entry_date: dbDateToYmd(row.entry_date),
    entry_value: normalizeHabitBinaryValue(row.entry_value, 'Entry value'),
    is_auto: !!row.is_auto,
  }));
}

async function upsertHabitEntry(userId, trackerId, date, entryValue, isAuto = false) {
  const trackerR = await query(
    'SELECT id FROM habit_trackers WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL LIMIT 1',
    [trackerId, userId]
  );
  if (!trackerR.rows[0]) throw validationError('Tracker not found');
  const entryDate = normalizeDateValue(date, 'Entry date');
  const normalizedValue = normalizeHabitBinaryValue(entryValue, 'Entry value');
  await query(
    `INSERT INTO habit_entries (tracker_id, user_id, entry_date, entry_value, is_auto)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tracker_id, entry_date)
     DO UPDATE SET entry_value = EXCLUDED.entry_value, is_auto = EXCLUDED.is_auto`,
    [trackerId, userId, entryDate, normalizedValue, !!isAuto]
  );
  return { entry_value: normalizedValue };
}

async function getHabitMonthSummary(userId, trackerId, year, month) {
  const safeYear = normalizeTrackerMonthPart(year, 'Year', 2000, 2100);
  const safeMonth = normalizeTrackerMonthPart(month, 'Month', 1, 12);
  await ensureHabitEntriesForMonth(userId, trackerId, safeYear, safeMonth);
  const prefix = habitMonthPrefix(safeYear, safeMonth);
  const result = await query(
    `SELECT
       COUNT(*) AS total_days,
       COALESCE(SUM(CASE WHEN entry_value = 1 THEN 1 ELSE 0 END), 0) AS one_days,
       COALESCE(SUM(CASE WHEN entry_value = 0 THEN 1 ELSE 0 END), 0) AS zero_days,
       COALESCE(SUM(CASE WHEN is_auto = TRUE THEN 1 ELSE 0 END), 0) AS auto_days
     FROM habit_entries
     WHERE user_id = $1
       AND tracker_id = $2
       AND entry_date::text LIKE $3`,
    [userId, trackerId, `${prefix}-%`]
  );
  const row = result.rows[0] || {};
  const totalDays = Number(row.total_days || 0);
  const oneDays = Number(row.one_days || 0);
  return {
    total_days: totalDays,
    one_days: oneDays,
    zero_days: Number(row.zero_days || 0),
    auto_days: Number(row.auto_days || 0),
    percent: totalDays ? Math.round((oneDays / totalDays) * 10000) / 100 : 0,
  };
}

async function getHabitYearSummary(userId, trackerId, year) {
  const safeYear = normalizeTrackerMonthPart(year, 'Year', 2000, 2100);
  const months = [];
  let totalOneDays = 0;
  let totalDays = 0;
  for (let month = 1; month <= 12; month++) {
    const summary = await getHabitMonthSummary(userId, trackerId, safeYear, month);
    totalOneDays += Number(summary.one_days || 0);
    totalDays += Number(summary.total_days || 0);
    months.push({
      year: safeYear,
      month,
      ...summary,
    });
  }
  return {
    year: safeYear,
    one_days: totalOneDays,
    total_days: totalDays,
    percent: totalDays ? Math.round((totalOneDays / totalDays) * 10000) / 100 : 0,
    months,
  };
}

async function getHabitYearsSummary(userId, trackerId) {
  const trackerR = await query(
    'SELECT id FROM habit_trackers WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL LIMIT 1',
    [trackerId, userId]
  );
  if (!trackerR.rows[0]) throw validationError('Tracker not found');
  const result = await query(
    `SELECT
       EXTRACT(YEAR FROM entry_date)::int AS year,
       COUNT(*) AS total_days,
       COALESCE(SUM(CASE WHEN entry_value = 1 THEN 1 ELSE 0 END), 0) AS one_days
     FROM habit_entries
     WHERE user_id = $1
       AND tracker_id = $2
     GROUP BY EXTRACT(YEAR FROM entry_date)
     ORDER BY year DESC`,
    [userId, trackerId]
  );
  return (result.rows || []).map((row) => {
    const totalDays = Number(row.total_days || 0);
    const oneDays = Number(row.one_days || 0);
    return {
      year: Number(row.year || 0),
      one_days: oneDays,
      total_days: totalDays,
      percent: totalDays ? Math.round((oneDays / totalDays) * 10000) / 100 : 0,
    };
  });
}

async function importHabitEntries(userId, trackerId, items = []) {
  const trackerR = await query(
    'SELECT id FROM habit_trackers WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL LIMIT 1',
    [trackerId, userId]
  );
  if (!trackerR.rows[0]) throw validationError('Tracker not found');
  let imported = 0;
  for (const item of Array.isArray(items) ? items : []) {
    const entryDate = normalizeDateValue(item.entry_date, 'Entry date');
    const entryValue = normalizeHabitBinaryValue(item.entry_value, 'Entry value');
    await query(
      `INSERT INTO habit_entries (tracker_id, user_id, entry_date, entry_value, is_auto)
       VALUES ($1, $2, $3, $4, FALSE)
       ON CONFLICT (tracker_id, entry_date)
       DO UPDATE SET entry_value = EXCLUDED.entry_value, is_auto = FALSE`,
      [trackerId, userId, entryDate, entryValue]
    );
    imported++;
  }
  return imported;
}

async function getRecurringEntries(userId) {
  await ensureRecurringSchema();
  const result = await query(
    `SELECT r.*, c.card_name, c.bank_name, c.last4, b.bank_name AS recurring_bank_name, b.account_name AS recurring_account_name,
            sk.kid_name AS school_kid_name
     FROM recurring_entries r
     LEFT JOIN credit_cards c ON r.card_id = c.id
     LEFT JOIN bank_accounts b ON r.bank_account_id = b.id
     LEFT JOIN school_kids sk ON r.school_kid_id = sk.id
     WHERE r.user_id = $1 AND r.deleted_at IS NULL
     ORDER BY r.created_at DESC`,
    [userId]
  );
  return result.rows.map((row) => ({
    ...row,
    amount: num(row.amount),
    discount_pct: num(row.discount_pct),
    due_day: normalizeDueDay(row.due_day),
    reminder_enabled: !!row.reminder_enabled,
    reminder_days_before: normalizeReminderDaysBefore(row.reminder_days_before),
    reminder_frequency: normalizeReminderFrequency(row.reminder_frequency),
    reminder_silent: !!row.reminder_silent,
    school_kid_id: row.school_kid_id != null ? Number(row.school_kid_id) : null,
    also_expense: !!row.also_expense,
    is_extra: !!row.is_extra,
    is_active: !!row.is_active,
  }));
}

async function addRecurringEntry(userId, data) {
  await ensureRecurringSchema();
  const description = normalizeText(data.description, 'Recurring description', 160);
  const amount = normalizePositiveAmount(data.amount);
  const expenseCategory = normalizeOptionalText(data.expense_category, 80);
  const dueDay = normalizeDueDay(data.due_day);
  const reminderEnabled = !!data.reminder_enabled;
  const reminderDaysBefore = normalizeReminderDaysBefore(data.reminder_days_before);
  const reminderFrequency = normalizeReminderFrequency(data.reminder_frequency);
  const reminderSilent = !!data.reminder_silent;
  const schoolKidId = data.school_kid_id ? await ensureOwnedSchoolKidId(userId, data.school_kid_id) : null;
  const result = await query(
    `INSERT INTO recurring_entries (user_id, type, description, amount, interval_months, start_month, due_day, card_id, bank_account_id, school_kid_id, expense_category, discount_pct, also_expense, is_extra, reminder_enabled, reminder_days_before, reminder_frequency, reminder_silent, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $1, $1)
     RETURNING id`,
    [
      userId,
      data.type,
      description,
      amount,
      Math.max(1, parseInt(data.interval_months, 10) || 1),
      data.start_month || null,
      dueDay,
      data.card_id || null,
      normalizeBankAccountId(data.bank_account_id),
      schoolKidId,
      expenseCategory,
      parseFloat(data.discount_pct) || 0,
      !!data.also_expense,
      !!data.is_extra,
      reminderEnabled,
      reminderDaysBefore,
      reminderFrequency,
      reminderSilent,
    ]
  );
  return Number(result.rows[0].id);
}

async function applyRecurringEntryForCurrentMonth(userId, entryId) {
  await ensureRecurringSchema();
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const entryR = await query('SELECT * FROM recurring_entries WHERE id = $1 AND user_id = $2 LIMIT 1', [entryId, userId]);
  const entry = entryR.rows[0];
  if (!entry || !entry.is_active) throw new Error('Recurring entry not found');
  if (entry.last_applied === currentMonth) return false;
  if (!recurringEntryAppliesToMonth(entry, currentMonth)) return false;
  const postingDate = recurringDueDateForMonth(currentMonth, entry.due_day);
  if (!postingDate) return false;
  if (postingDate > localIsoToday()) return false;
  if (entry.type === 'expense' && !entry.card_id) {
    await generateMonthlyPayments(userId, currentMonth);
  }
  await withTransaction(async (client) => {
    if (entry.type === 'expense') {
      const bankAccountId = normalizeBankAccountId(entry.bank_account_id);
      await client.query(
        `INSERT INTO expenses (user_id, item_name, category, amount, purchase_date, is_extra, bank_account_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $1, $1)`,
        [userId, entry.description, entry.expense_category || null, entry.amount, postingDate, !!entry.is_extra, bankAccountId]
      );
      if (bankAccountId) {
        await adjustBankBalance(userId, bankAccountId, -num(entry.amount), client);
      }
      if (entry.school_kid_id) {
        await addRecurringSchoolKidExpenseForMonth(
          userId,
          entry.school_kid_id,
          currentMonth,
          postingDate,
          entry.description,
          num(entry.amount),
          client
        );
      }
      await client.query(
        `UPDATE monthly_payments
         SET paid_amount = $1,
             paid_date = $2,
             status = 'paid',
             bank_account_id = COALESCE($3, bank_account_id)
         WHERE user_id = $4
           AND month = $5
           AND recurring_entry_id = $6`,
        [num(entry.amount), postingDate, bankAccountId, userId, currentMonth, entry.id]
      );
    } else if (entry.type === 'cc_txn' && entry.card_id) {
      const billingDb = require('./postgres-billing');
      await billingDb.addCcTxn(userId, {
        card_id: entry.card_id,
        txn_date: postingDate,
        description: entry.description,
        amount: num(entry.amount),
        discount_pct: num(entry.discount_pct),
        source: 'recurring',
        source_id: entry.id,
      });
      if (entry.also_expense) {
        const bankAccountId = normalizeBankAccountId(entry.bank_account_id);
        await client.query(
          `INSERT INTO expenses (user_id, item_name, category, amount, purchase_date, is_extra, bank_account_id, source, source_id, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, FALSE, $6, $7, $8, $1, $1)`,
          [userId, entry.description, entry.expense_category || null, entry.amount, postingDate, bankAccountId, 'recurring', Number(entry.id)]
        );
        if (bankAccountId) await adjustBankBalance(userId, bankAccountId, -num(entry.amount), client);
        if (entry.school_kid_id) {
          await addRecurringSchoolKidExpenseForMonth(
            userId,
            entry.school_kid_id,
            currentMonth,
            postingDate,
            entry.description,
            num(entry.amount),
            client
          );
        }
      }
    } else {
      throw new Error('Recurring entry type is not supported');
    }
    await client.query('UPDATE recurring_entries SET last_applied = $1 WHERE id = $2', [currentMonth, entry.id]);
  });
  return true;
}

async function updateRecurringEntry(userId, id, data) {
  await ensureRecurringSchema();
  const type = data.type === 'cc_txn' ? 'cc_txn' : 'expense';
  const description = normalizeText(data.description, 'Recurring description', 160);
  const amount = normalizePositiveAmount(data.amount);
  const expenseCategory = normalizeOptionalText(data.expense_category, 80);
  const dueDay = normalizeDueDay(data.due_day);
  const reminderEnabled = !!data.reminder_enabled;
  const reminderDaysBefore = normalizeReminderDaysBefore(data.reminder_days_before);
  const reminderFrequency = normalizeReminderFrequency(data.reminder_frequency);
  const reminderSilent = !!data.reminder_silent;
  const intervalMonths = Math.max(1, parseInt(data.interval_months, 10) || 1);
  const bankAccountId = type === 'expense' ? normalizeBankAccountId(data.bank_account_id) : null;
  const schoolKidId = data.school_kid_id ? await ensureOwnedSchoolKidId(userId, data.school_kid_id) : null;
  const cardId = type === 'cc_txn' ? (parseInt(data.card_id, 10) || null) : null;
  const discountPct = type === 'cc_txn' ? (parseFloat(data.discount_pct) || 0) : 0;
  const alsoExpense = type === 'cc_txn' ? !!data.also_expense : false;
  const isExtra = type === 'expense' ? !!data.is_extra : false;
  const isActive = data.is_active != null ? !!data.is_active : true;
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE recurring_entries
       SET type = $1, description = $2, amount = $3, interval_months = $4, start_month = $5, due_day = $6, card_id = $7,
           bank_account_id = $8, school_kid_id = $9, expense_category = $10, discount_pct = $11, also_expense = $12, is_extra = $13,
           reminder_enabled = $14, reminder_days_before = $15, reminder_frequency = $16, reminder_silent = $17,
           is_active = $18, updated_at = NOW(), updated_by = $20
       WHERE id = $19 AND user_id = $20`,
      [
        type,
        description,
        amount,
        intervalMonths,
        data.start_month || null,
        dueDay,
        cardId,
        bankAccountId,
        schoolKidId,
        expenseCategory,
        discountPct,
        alsoExpense,
        isExtra,
        reminderEnabled,
        reminderDaysBefore,
        reminderFrequency,
        reminderSilent,
        isActive,
        id,
        userId,
      ]
    );

    const linkedPayments = await client.query(
      `SELECT id, month
       FROM monthly_payments
       WHERE user_id = $1
         AND recurring_entry_id = $2
         AND COALESCE(paid_amount, 0) <= 0
         AND (status = 'pending' OR status IS NULL)`,
      [userId, id]
    );

    for (const row of linkedPayments.rows) {
      await client.query(
        `UPDATE monthly_payments
         SET name = $1,
             amount = $2,
             due_date = $3,
             bank_account_id = $4,
             notes = $5
         WHERE id = $6`,
        [description, amount, recurringDueDateForMonth(row.month, dueDay), bankAccountId, 'Recurring entry', row.id]
      );
    }
  });
}

async function deleteRecurringEntry(userId, id) {
  await ensureRecurringSchema();
  await query('DELETE FROM recurring_entries WHERE id = $1 AND user_id = $2', [id, userId]);
}

async function applyRecurringEntries(userId) {
  await ensureRecurringSchema();
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const entries = await getRecurringEntries(userId);
  const applied = [];
  for (const entry of entries) {
    if (!entry.is_active) continue;
    if (entry.last_applied === currentMonth) continue;
    if (!recurringEntryAppliesToMonth(entry, currentMonth)) continue;
    try {
      const didApply = await applyRecurringEntryForCurrentMonth(userId, entry.id);
      if (didApply) applied.push(entry.id);
    } catch (_) {
      // Skip unsupported or broken recurring rows for now.
    }
  }
  return applied;
}

async function getDailyTrackerPlannerItems(userId, month, options = {}) {
  const includeAutoAddToExpense = !!options.includeAutoAddToExpense;
  const [yr, mo] = month.split('-').map(Number);
  const prevDate = new Date(yr, mo - 2, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
  const dueDate = `${month}-01`;
  const monthLabel = prevDate.toLocaleString('en-US', { month: 'short', year: 'numeric' });
  const result = await query(
    `SELECT
       t.id AS daily_tracker_id,
       t.name,
       COALESCE(t.auto_add_to_expense, FALSE) AS auto_add_to_expense,
       ROUND(COALESCE(SUM(e.amount), 0)::numeric, 2) AS total_amount
     FROM daily_trackers t
     LEFT JOIN daily_entries e
       ON e.tracker_id = t.id
      AND e.user_id = $1
      AND e.entry_date::text LIKE $2
     WHERE t.user_id = $1 AND t.deleted_at IS NULL
     GROUP BY t.id
     ORDER BY t.name`,
    [userId, `${prevMonth}-%`]
  );
  return result.rows.flatMap((row) => {
    const total = num(row.total_amount);
    if (total <= 0) return [];
    if (row.auto_add_to_expense && !includeAutoAddToExpense) return [];
    return [{
      daily_tracker_id: Number(row.daily_tracker_id),
      tracker_source_month: prevMonth,
      name: `${row.name} - ${monthLabel}`,
      amount: total,
      due_date: dueDate,
      notes: `Daily tracker total for ${monthLabel}`,
    }];
  });
}

module.exports = {
  getAiLookupStatus,
  recordAiLookupUsage,
  logAiLookupQuery,
  getAiIntentLearningExamples,
  getAiLearningReport,
  teachAiIntent,
  saveAiTrainingExample,
  findAiTrainingExample,
  getAiQueryHistory,
  getBankAccounts,
  getBankAccountHistory,
  addBankAccount,
  updateBankAccount,
  updateBankBalance,
  setDefaultBankAccount,
  transferBetweenBankAccounts,
  deleteBankAccount,
  getDefaultPayments,
  addDefaultPayment,
  updateDefaultPayment,
  deleteDefaultPayment,
  getMonthlyPayments,
  getSkippedPayments,
  restoreMonthlyPayment,
  addMonthlyPayment,
  updateMonthlyPayment,
  deleteMonthlyPayment,
  hardDeleteMonthlyPayment,
  payMonthlyPayment,
  getDailyTrackers,
  addDailyTracker,
  updateDailyTracker,
  deleteDailyTracker,
  getDailyEntries,
  upsertDailyEntry,
  autoFillDailyEntries,
  getDailyMonthSummary,
  addTrackerMonthToExpense,
  getExpenseBuckets,
  addExpenseBucket,
  updateExpenseBucket,
  deleteExpenseBucket,
  getExpenseBucketEntries,
  addExpenseBucketEntry,
  updateExpenseBucketEntry,
  deleteExpenseBucketEntry,
  getFixedDeposits,
  addFixedDeposit,
  updateFixedDeposit,
  deleteFixedDeposit,
  getHabitTrackers,
  addHabitTracker,
  updateHabitTracker,
  deleteHabitTracker,
  getHabitEntries,
  upsertHabitEntry,
  getHabitMonthSummary,
  getHabitYearSummary,
  getHabitYearsSummary,
  importHabitEntries,
  getRecurringEntries,
  addRecurringEntry,
  applyRecurringEntryForCurrentMonth,
  updateRecurringEntry,
  deleteRecurringEntry,
  applyRecurringEntries,
  getDailyTrackerPlannerItems,
  autoAddCompletedTrackerExpenses,
};

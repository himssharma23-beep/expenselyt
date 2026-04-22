const { query, withTransaction } = require('./postgres');

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

async function adjustBankBalance(userId, bankAccountId, delta, client = null) {
  const normalizedId = normalizeBankAccountId(bankAccountId);
  const amount = Number(delta || 0);
  if (!normalizedId || !amount) return;
  const run = client || { query };
  await run.query(
    `UPDATE bank_accounts
     SET balance = balance + $1, updated_at = NOW(), updated_by = $3
     WHERE id = $2 AND user_id = $3 AND COALESCE(is_active, TRUE) = TRUE AND deleted_at IS NULL`,
    [amount, normalizedId, userId]
  );
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
      message: 'Admin account — unlimited AI lookups.',
    };
  }

  // Determine daily limit from plan's ai_query_limit, or fall back to default
  const planLimit = activeSub?.ai_query_limit != null ? Number(activeSub.ai_query_limit) : null;
  const dailyLimit = planLimit != null ? planLimit : (activeSub ? -1 : DEFAULT_FREE_LIMIT);
  const isUnlimited = dailyLimit === -1;
  const hasPaidPlan = !!(activeSub && !activeSub.is_free);
  const remainingFreeQueries = isUnlimited ? -1 : Math.max(0, dailyLimit - usedToday);
  const canAsk = isUnlimited ? true : remainingFreeQueries > 0;

  return {
    date: today,
    dailyFreeLimit: isUnlimited ? -1 : dailyLimit,
    usedToday,
    remainingFreeQueries,
    hasPaidPlan,
    isAdmin: false,
    planName: activeSub?.name || null,
    canAsk,
    message: isUnlimited
      ? `Unlimited AI lookups available on your ${activeSub?.name || 'plan'}.`
      : `Plan includes ${dailyLimit} AI lookups per day. ${remainingFreeQueries} remaining today.`,
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
    return id;
  });
}

async function updateBankAccount(userId, id, account) {
  const bankName = normalizeText(account.bank_name, 'Bank name', 80);
  const accountName = normalizeOptionalText(account.account_name, 80);
  const balance = normalizeNonNegativeAmount(account.balance || 0, 'Balance');
  const minBalance = normalizeNonNegativeAmount(account.min_balance || 0, 'Minimum balance');
  await query(
    `UPDATE bank_accounts
     SET bank_name = $1, account_name = $2, account_type = $3, balance = $4, min_balance = $5, updated_at = NOW(), updated_by = $7
     WHERE id = $6 AND user_id = $7`,
    [bankName, accountName, account.account_type || 'savings', balance, minBalance, id, userId]
  );
}

async function updateBankBalance(userId, id, balance) {
  const nextBalance = normalizeNonNegativeAmount(balance, 'Balance');
  await query('UPDATE bank_accounts SET balance = $1, updated_at = NOW(), updated_by = $3 WHERE id = $2 AND user_id = $3', [nextBalance, id, userId]);
}

async function setDefaultBankAccount(userId, id) {
  await withTransaction(async (client) => {
    await client.query('UPDATE bank_accounts SET is_default = FALSE WHERE user_id = $1', [userId]);
    await client.query('UPDATE bank_accounts SET is_default = TRUE WHERE id = $1 AND user_id = $2', [id, userId]);
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

async function getRecurringEntries(userId) {
  const result = await query(
    `SELECT r.*, c.card_name, c.bank_name, c.last4, b.bank_name AS recurring_bank_name, b.account_name AS recurring_account_name
     FROM recurring_entries r
     LEFT JOIN credit_cards c ON r.card_id = c.id
     LEFT JOIN bank_accounts b ON r.bank_account_id = b.id
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
    also_expense: !!row.also_expense,
    is_extra: !!row.is_extra,
    is_active: !!row.is_active,
  }));
}

async function addRecurringEntry(userId, data) {
  const description = normalizeText(data.description, 'Recurring description', 160);
  const amount = normalizePositiveAmount(data.amount);
  const expenseCategory = normalizeOptionalText(data.expense_category, 80);
  const dueDay = normalizeDueDay(data.due_day);
  const reminderEnabled = !!data.reminder_enabled;
  const reminderDaysBefore = normalizeReminderDaysBefore(data.reminder_days_before);
  const reminderFrequency = normalizeReminderFrequency(data.reminder_frequency);
  const reminderSilent = !!data.reminder_silent;
  const result = await query(
    `INSERT INTO recurring_entries (user_id, type, description, amount, interval_months, start_month, due_day, card_id, bank_account_id, expense_category, discount_pct, also_expense, is_extra, reminder_enabled, reminder_days_before, reminder_frequency, reminder_silent, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $1, $1)
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
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const day1 = `${currentMonth}-01`;
  const entryR = await query('SELECT * FROM recurring_entries WHERE id = $1 AND user_id = $2 LIMIT 1', [entryId, userId]);
  const entry = entryR.rows[0];
  if (!entry || !entry.is_active) throw new Error('Recurring entry not found');
  if (entry.last_applied === currentMonth) return false;
  if (!recurringEntryAppliesToMonth(entry, currentMonth)) return false;
  await withTransaction(async (client) => {
    if (entry.type === 'expense') {
      const bankAccountId = normalizeBankAccountId(entry.bank_account_id);
      await client.query(
        `INSERT INTO expenses (user_id, item_name, category, amount, purchase_date, is_extra, bank_account_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $1, $1)`,
        [userId, entry.description, entry.expense_category || null, entry.amount, day1, !!entry.is_extra, bankAccountId]
      );
      if (bankAccountId) {
        await adjustBankBalance(userId, bankAccountId, -num(entry.amount), client);
      }
    } else if (entry.type === 'cc_txn' && entry.card_id) {
      const billingDb = require('./postgres-billing');
      await billingDb.addCcTxn(userId, {
        card_id: entry.card_id,
        txn_date: day1,
        description: entry.description,
        amount: num(entry.amount),
        discount_pct: num(entry.discount_pct),
        source: 'recurring',
        source_id: entry.id,
      });
      if (entry.also_expense) {
        const bankAccountId = normalizeBankAccountId(entry.bank_account_id);
        await client.query(
          `INSERT INTO expenses (user_id, item_name, category, amount, purchase_date, is_extra, bank_account_id, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, FALSE, $6, $1, $1)`,
          [userId, entry.description, entry.expense_category || null, entry.amount, day1, bankAccountId]
        );
        if (bankAccountId) await adjustBankBalance(userId, bankAccountId, -num(entry.amount), client);
      }
    } else {
      throw new Error('Recurring entry type is not supported');
    }
    await client.query('UPDATE recurring_entries SET last_applied = $1 WHERE id = $2', [currentMonth, entry.id]);
  });
  return true;
}

async function updateRecurringEntry(userId, id, data) {
  const description = normalizeText(data.description, 'Recurring description', 160);
  const amount = normalizePositiveAmount(data.amount);
  const expenseCategory = normalizeOptionalText(data.expense_category, 80);
  const dueDay = normalizeDueDay(data.due_day);
  const reminderEnabled = !!data.reminder_enabled;
  const reminderDaysBefore = normalizeReminderDaysBefore(data.reminder_days_before);
  const reminderFrequency = normalizeReminderFrequency(data.reminder_frequency);
  const reminderSilent = !!data.reminder_silent;
  const intervalMonths = Math.max(1, parseInt(data.interval_months, 10) || 1);
  const bankAccountId = normalizeBankAccountId(data.bank_account_id);
  const isActive = data.is_active != null ? !!data.is_active : true;
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE recurring_entries
       SET description = $1, amount = $2, interval_months = $3, start_month = $4, due_day = $5, card_id = $6,
           bank_account_id = $7, expense_category = $8, discount_pct = $9, also_expense = $10, is_extra = $11,
           reminder_enabled = $12, reminder_days_before = $13, reminder_frequency = $14, reminder_silent = $15,
           is_active = $16, updated_at = NOW(), updated_by = $18
       WHERE id = $17 AND user_id = $18`,
      [
        description,
        amount,
        intervalMonths,
        data.start_month || null,
        dueDay,
        data.card_id || null,
        bankAccountId,
        expenseCategory,
        parseFloat(data.discount_pct) || 0,
        !!data.also_expense,
        !!data.is_extra,
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
  await query('DELETE FROM recurring_entries WHERE id = $1 AND user_id = $2', [id, userId]);
}

async function applyRecurringEntries(userId) {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const entries = await getRecurringEntries(userId);
  const applied = [];
  for (const entry of entries) {
    if (!entry.is_active) continue;
    if (entry.last_applied === currentMonth) continue;
    if (!recurringEntryAppliesToMonth(entry, currentMonth)) continue;
    try {
      await applyRecurringEntryForCurrentMonth(userId, entry.id);
      applied.push(entry.id);
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
  addBankAccount,
  updateBankAccount,
  updateBankBalance,
  setDefaultBankAccount,
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
  getRecurringEntries,
  addRecurringEntry,
  applyRecurringEntryForCurrentMonth,
  updateRecurringEntry,
  deleteRecurringEntry,
  applyRecurringEntries,
  getDailyTrackerPlannerItems,
  autoAddCompletedTrackerExpenses,
};

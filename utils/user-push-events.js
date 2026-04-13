const pgAuth = require('../db/postgres-auth');
const pgOps = require('../db/postgres-ops');
const pgFinance = require('../db/postgres-finance');
const pgBilling = require('../db/postgres-billing');
const { query } = require('../db/postgres');
const { sendExpoPushNotifications } = require('./push-notifications');
const { notifyMonthlyLiveSplitSummary } = require('./live-split-notifications');

function num(value) {
  return Number(value || 0);
}

function currentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function monthLabel(month, localeCode = 'en-IN') {
  if (!month) return '';
  const [year, monthNo] = String(month).split('-').map(Number);
  const date = new Date(year, (monthNo || 1) - 1, 1);
  try {
    return new Intl.DateTimeFormat(localeCode || 'en-IN', { month: 'long', year: 'numeric' }).format(date);
  } catch (_err) {
    return date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  }
}

function prevMonth(month) {
  const [year, monthNo] = String(month).split('-').map(Number);
  const date = new Date(year, (monthNo || 1) - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatCurrency(amount, currencyCode = 'INR', localeCode = 'en-IN') {
  try {
    return new Intl.NumberFormat(localeCode || 'en-IN', {
      style: 'currency',
      currency: currencyCode || 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num(amount));
  } catch (_err) {
    return `${currencyCode || 'INR'} ${num(amount).toFixed(2)}`;
  }
}

async function createAndSendUserNotification(user, payload = {}) {
  const created = await pgAuth.createUserNotification(user.id, payload);
  if (!created) return null;

  const prefs = await pgAuth.getUserNotificationPreferences(user.id);
  const unreadCount = await pgAuth.getUnreadNotificationCount(user.id);
  if (prefs.push_enabled !== false) {
    const devices = await pgAuth.getPushTokensForUsers([user.id]);
    if (devices.length) {
      const messageData = {
        notificationId: created.id,
        screen: created.target_screen || null,
        params: created.target_params || {},
        type: created.type,
        ...(created.data || {}),
      };
      await sendExpoPushNotifications(devices.map((device) => ({
        to: device.token,
        title: created.title,
        body: created.body,
        badge: unreadCount,
        data: messageData,
      })));
      await pgAuth.markUserNotificationPushed(user.id, created.id);
    }
  }
  return created;
}

function summarizeNames(items = [], max = 3) {
  const names = items.map((item) => String(item || '').trim()).filter(Boolean);
  if (!names.length) return '';
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} +${names.length - max} more`;
}

async function notifyMonthlySummariesForUser(user, month) {
  const lastMonth = prevMonth(month);
  const lastMonthLabel = monthLabel(lastMonth, user.locale_code);
  const currentMonthLabel = monthLabel(month, user.locale_code);

  const [summary, accounts, payments, ccDues, emiDues, preview, trackers, recurringEntries] = await Promise.all([
    pgFinance.getUserFinancialSummary(user.id),
    pgOps.getBankAccounts(user.id),
    pgOps.getMonthlyPayments(user.id, month),
    pgBilling.getCcDuesForMonth(user.id, month),
    pgFinance.getEmiDuesForMonth(user.id, month),
    pgFinance.getPreviewDataForMonth(user.id, month, pgBilling),
    pgOps.getDailyTrackers(user.id),
    pgOps.getRecurringEntries(user.id),
  ]);

  const currentDue = Math.round((
    (payments || []).filter((payment) => payment.status !== 'paid').reduce((sum, payment) => sum + num(payment.amount) - num(payment.paid_amount), 0) +
    (ccDues || []).reduce((sum, due) => sum + (num(due.net_payable) - num(due.paid_amount)), 0) +
    (emiDues || []).filter((item) => num(item.paid_amount) < num(item.emi_amount) * 0.999).reduce((sum, item) => sum + (num(item.emi_amount) - num(item.paid_amount)), 0)
  ) * 100) / 100;
  const projectedDue = Math.round((
    (preview?.projectedDefaults || []).reduce((sum, item) => sum + num(item.amount), 0) +
    (preview?.projectedCcDues || []).reduce((sum, item) => sum + num(item.net_payable), 0) +
    (preview?.emiDues || []).filter((item) => num(item.paid_amount) < num(item.emi_amount) * 0.999).reduce((sum, item) => sum + (num(item.emi_amount) - num(item.paid_amount)), 0)
  ) * 100) / 100;
  const spendable = Math.round((accounts || []).reduce((sum, account) => sum + (num(account.balance) - num(account.min_balance)), 0) * 100) / 100;
  const afterAll = Math.round((spendable - currentDue) * 100) / 100;

  await createAndSendUserNotification(user, {
    type: 'planner_estimate_monthly',
    dedupe_key: month,
    title: `${currentMonthLabel} planner estimate`,
    body: `Estimated due is ${formatCurrency(projectedDue, user.currency_code, user.locale_code)}. After current dues you have ${formatCurrency(afterAll, user.currency_code, user.locale_code)} left.`,
    target_screen: 'Planner',
    target_params: {},
    data: { month },
  });

  const yearlyRows = Array.isArray(summary?.expense_last_6_months) ? summary.expense_last_6_months : [];
  const lastMonthSpend = yearlyRows.find((row) => String(row.month) === lastMonth);
  const lastMonthTotal = num(lastMonthSpend?.total);
  await createAndSendUserNotification(user, {
    type: 'expenses_last_month',
    dedupe_key: lastMonth,
    title: `${lastMonthLabel} expenses`,
    body: `You spent ${formatCurrency(lastMonthTotal, user.currency_code, user.locale_code)} in ${lastMonthLabel}.`,
    target_screen: 'Expenses',
    data: { month: lastMonth },
  });

  const friendSummary = Array.isArray(summary?.friends_loan_summary) ? summary.friends_loan_summary : [];
  const owedToYou = friendSummary.filter((entry) => num(entry.net_balance) > 0);
  const youOwe = friendSummary.filter((entry) => num(entry.net_balance) < 0);
  const owedToYouTotal = owedToYou.reduce((sum, entry) => sum + num(entry.net_balance), 0);
  const youOweTotal = youOwe.reduce((sum, entry) => sum + Math.abs(num(entry.net_balance)), 0);
  await createAndSendUserNotification(user, {
    type: 'friends_balance_monthly',
    dedupe_key: month,
    title: 'Friend balances update',
    body: owedToYou.length || youOwe.length
      ? `${owedToYou.length ? `${summarizeNames(owedToYou.map((entry) => entry.name))} owe you ${formatCurrency(owedToYouTotal, user.currency_code, user.locale_code)}` : 'Nobody owes you right now'}. ${youOwe.length ? `You owe ${formatCurrency(youOweTotal, user.currency_code, user.locale_code)} to ${summarizeNames(youOwe.map((entry) => entry.name))}` : 'You do not owe anyone right now'}.`
      : 'You do not have any pending friend balances right now.',
    target_screen: 'Friends',
    data: { month },
  });

  const totalBalance = Math.round((accounts || []).reduce((sum, account) => sum + num(account.balance), 0) * 100) / 100;
  await createAndSendUserNotification(user, {
    type: 'bank_update_monthly',
    dedupe_key: month,
    title: 'Bank accounts update',
    body: `${accounts.length} bank account${accounts.length === 1 ? '' : 's'} total ${formatCurrency(totalBalance, user.currency_code, user.locale_code)}. Spendable balance is ${formatCurrency(spendable, user.currency_code, user.locale_code)}.`,
    target_screen: 'Banks',
    data: { month },
  });

  const [trackerYear, trackerMonthNo] = lastMonth.split('-').map(Number);
  const trackerTotals = [];
  for (const tracker of trackers || []) {
    const trackerSummary = await pgOps.getDailyMonthSummary(user.id, tracker.id, trackerYear, trackerMonthNo);
    if (num(trackerSummary?.total_amount) > 0) {
      trackerTotals.push({ name: tracker.name, total_amount: num(trackerSummary.total_amount) });
    }
  }
  const trackerTotalAmount = trackerTotals.reduce((sum, entry) => sum + num(entry.total_amount), 0);
  if (trackerTotals.length) {
    await createAndSendUserNotification(user, {
      type: 'tracker_monthly_total',
      dedupe_key: lastMonth,
      title: `${lastMonthLabel} tracker total`,
      body: `${summarizeNames(trackerTotals.map((entry) => entry.name))} totaled ${formatCurrency(trackerTotalAmount, user.currency_code, user.locale_code)} last month.`,
      target_screen: 'Tracker',
      data: { month: lastMonth },
    });
  }

  const applicableRecurring = (recurringEntries || []).filter((entry) => {
    const interval = Math.max(1, parseInt(entry.interval_months, 10) || 1);
    if (!entry.is_active) return false;
    if (interval <= 1) return true;
    const startMonth = entry.start_month || month;
    if (month < startMonth) return false;
    const [startY, startM] = startMonth.split('-').map(Number);
    const [year, monthNo] = month.split('-').map(Number);
    const diffMonths = (year - startY) * 12 + (monthNo - startM);
    return diffMonths >= 0 && diffMonths % interval === 0;
  });
  const appliedRecurringIds = await pgOps.applyRecurringEntries(user.id);
  const appliedRecurring = applicableRecurring.filter((entry) => appliedRecurringIds.includes(Number(entry.id)));
  if (appliedRecurring.length) {
    const expenseRecurring = appliedRecurring.filter((entry) => entry.type === 'expense');
    const cardRecurring = appliedRecurring.filter((entry) => entry.type === 'cc_txn');
    await createAndSendUserNotification(user, {
      type: 'recurring_applied_monthly',
      dedupe_key: month,
      title: `${currentMonthLabel} recurring added`,
      body: `${appliedRecurring.length} recurring entr${appliedRecurring.length === 1 ? 'y was' : 'ies were'} applied. ${expenseRecurring.length ? `${expenseRecurring.length} to expenses.` : ''}${cardRecurring.length ? ` ${cardRecurring.length} to credit cards.` : ''}`.trim(),
      target_screen: 'Recurring',
      data: { month, recurring_ids: appliedRecurringIds },
    });
  }
}

async function notifyUpcomingEmiRemindersForUser(user, dueDate) {
  const dueDateKey = localDate(dueDate);
  const result = await query(
    `SELECT
       r.id AS emi_id,
       r.name,
       i.installment_no,
       i.due_date,
       i.emi_amount,
       i.paid_amount
     FROM emi_installments i
     JOIN emi_records r ON r.id = i.emi_id
     WHERE r.user_id = $1
       AND r.status IN ('active', 'pending')
       AND i.due_date = $2
       AND COALESCE(i.paid_amount, 0) < COALESCE(i.emi_amount, 0) * 0.999
     ORDER BY i.due_date, r.name`,
    [user.id, dueDateKey]
  );
  for (const row of result.rows) {
    const amountDue = Math.max(0, num(row.emi_amount) - num(row.paid_amount));
    await createAndSendUserNotification(user, {
      type: 'emi_due_reminder',
      dedupe_key: `${row.emi_id}:${row.installment_no}:${row.due_date}`,
      title: 'EMI due in 3 days',
      body: `${row.name} installment ${row.installment_no} is due on ${row.due_date}. Amount due: ${formatCurrency(amountDue, user.currency_code, user.locale_code)}.`,
      target_screen: 'EMITracker',
      data: { emi_id: Number(row.emi_id), due_date: row.due_date },
    });
  }
}

async function notifyCreditCardCycleEventsForUser(user, today, reminderDate) {
  const todayKey = localDate(today);
  const reminderKey = localDate(reminderDate);

  const cycleCompleteResult = await query(
    `SELECT
       cy.id,
       cy.card_id,
       cy.cycle_end,
       cy.due_date,
       cy.net_payable,
       cy.paid_amount,
       c.card_name,
       c.bank_name,
       c.last4
     FROM cc_cycles cy
     JOIN credit_cards c ON c.id = cy.card_id
     WHERE cy.user_id = $1
       AND cy.cycle_end = $2
       AND c.is_active = TRUE`,
    [user.id, todayKey]
  );
  for (const row of cycleCompleteResult.rows) {
    const remaining = Math.max(0, num(row.net_payable) - num(row.paid_amount));
    await createAndSendUserNotification(user, {
      type: 'credit_cycle_closed',
      dedupe_key: `${row.id}:${row.cycle_end}`,
      title: `${row.card_name} cycle completed`,
      body: `Your ${row.bank_name} ${row.card_name} ending ${row.last4} cycle closed today. Total amount to pay is ${formatCurrency(remaining, user.currency_code, user.locale_code)}.`,
      target_screen: 'CreditCards',
      data: { card_id: Number(row.card_id), cycle_id: Number(row.id) },
    });
  }

  const dueReminderResult = await query(
    `SELECT
       cy.id,
       cy.card_id,
       cy.due_date,
       cy.net_payable,
       cy.paid_amount,
       cy.status,
       c.card_name,
       c.bank_name,
       c.last4
     FROM cc_cycles cy
     JOIN credit_cards c ON c.id = cy.card_id
     WHERE cy.user_id = $1
       AND cy.due_date = $2
       AND c.is_active = TRUE
       AND cy.status IN ('open', 'billed', 'partial')
       AND COALESCE(cy.net_payable, 0) > COALESCE(cy.paid_amount, 0)`,
    [user.id, reminderKey]
  );
  for (const row of dueReminderResult.rows) {
    const remaining = Math.max(0, num(row.net_payable) - num(row.paid_amount));
    await createAndSendUserNotification(user, {
      type: 'credit_due_reminder',
      dedupe_key: `${row.id}:${row.due_date}`,
      title: 'Credit card due in 3 days',
      body: `${row.bank_name} ${row.card_name} ending ${row.last4} is due on ${row.due_date}. Amount due: ${formatCurrency(remaining, user.currency_code, user.locale_code)}.`,
      target_screen: 'CreditCards',
      data: { card_id: Number(row.card_id), cycle_id: Number(row.id), due_date: row.due_date },
    });
  }
}

async function runPushNotificationCycle() {
  const now = new Date();
  const users = await pgAuth.getAllActiveUsersForNotifications();
  const month = currentMonthKey(now);
  const dueReminderDate = addDays(now, 3);

  for (const user of users) {
    try {
      if (now.getDate() === 1) {
        await notifyMonthlySummariesForUser(user, month);
        await notifyMonthlyLiveSplitSummary(user, month);
      }
      await notifyUpcomingEmiRemindersForUser(user, dueReminderDate);
      await notifyCreditCardCycleEventsForUser(user, now, dueReminderDate);
    } catch (err) {
      console.error(`[push] notification cycle failed for user ${user.id}:`, err?.message || err);
    }
  }
}

module.exports = {
  runPushNotificationCycle,
};

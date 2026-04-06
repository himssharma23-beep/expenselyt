const pgAuth = require('../db/postgres-auth');
const pgCore = require('../db/postgres-core');
const pgOps = require('../db/postgres-ops');
const pgFinance = require('../db/postgres-finance');
const pgBilling = require('../db/postgres-billing');
const {
  isEmailEnabled,
  sendSplitSharedEmail,
  sendTripLinkedEmail,
  sendTripFinalizedEmail,
  sendMonthlyPlannerSummaryEmail,
  sendTrackerMonthSummaryEmail,
  sendRecurringAppliedEmail,
  sendTrackerExpenseAppliedEmail,
} = require('./mailer');

function monthLabel(month, localeCode = 'en-IN') {
  if (!month) return '';
  const [year, monthNo] = String(month).split('-').map(Number);
  if (!year || !monthNo) return String(month);
  const date = new Date(year, monthNo - 1, 1);
  try {
    return new Intl.DateTimeFormat(localeCode, { month: 'long', year: 'numeric' }).format(date);
  } catch (_err) {
    return date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  }
}

function prevMonth(month) {
  const [year, monthNo] = String(month).split('-').map(Number);
  const date = new Date(year, monthNo - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function currentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

async function sendSplitShareEmails(ownerUserId, sessionKey) {
  if (!isEmailEnabled()) return;
  const owner = await pgAuth.findUserById(ownerUserId);
  if (!owner) return;
  const shares = await pgCore.getReceivedDivideShares(ownerUserId);
  void shares;
}

async function sendSplitShareEmailsToTargets(ownerUserId, targetUserIds = [], sessionKey = '') {
  if (!isEmailEnabled()) return;
  const owner = await pgAuth.findUserById(ownerUserId);
  const targets = await pgAuth.getBasicUsersByIds(targetUserIds);
  if (!owner || !targets.length) return;
  for (const target of targets) {
    if (!target?.email) continue;
    const shared = await pgCore.getReceivedDivideShares(target.id);
    const match = (shared || []).find((item) => String(item.owner_user_id) === String(ownerUserId) && String(item.session_id || '') === String(sessionKey || ''));
    if (!match) continue;
    await sendSplitSharedEmail({
      to: target.email,
      ownerName: owner.display_name,
      recipientName: target.display_name,
      sessionTitle: match.heading || match.details,
      divideDate: match.divide_date,
      totalAmount: match.total_amount,
      yourShare: match.friend_share_amount,
      itemCount: Array.isArray(match.splits) ? match.splits.length : 0,
      currencyCode: target.currency_code,
      localeCode: target.locale_code,
    }).catch(() => {});
  }
}

async function sendTripLinkedEmailToUser(ownerUserId, tripId, linkedUserId, permission = 'edit') {
  if (!isEmailEnabled() || !linkedUserId) return;
  const [owner, target, trip] = await Promise.all([
    pgAuth.findUserById(ownerUserId),
    pgAuth.findUserById(linkedUserId),
    pgCore.getTripById(ownerUserId, tripId),
  ]);
  if (!owner || !target?.email || !trip) return;
  await sendTripLinkedEmail({
    to: target.email,
    ownerName: owner.display_name,
    recipientName: target.display_name,
    tripName: trip.name,
    startDate: trip.start_date,
    permission,
    currencyCode: target.currency_code,
    localeCode: target.locale_code,
  }).catch(() => {});
}

async function sendTripFinalizedEmails(ownerUserId, tripId) {
  if (!isEmailEnabled()) return;
  const [owner, trip] = await Promise.all([
    pgAuth.findUserById(ownerUserId),
    pgCore.getTripById(ownerUserId, tripId),
  ]);
  if (!owner || !trip) return;

  const memberUsers = await pgAuth.getBasicUsersByIds((trip.members || []).map((member) => member.linked_user_id).filter(Boolean));
  const userMap = new Map(memberUsers.map((user) => [String(user.id), user]));

  const totals = new Map();
  for (const member of trip.members || []) {
    const key = member.friend_id != null ? String(member.friend_id) : member.linked_user_id != null ? `u${member.linked_user_id}` : 'self';
    totals.set(key, { paid: 0, share: 0, member });
  }
  for (const expense of trip.expenses || []) {
    const paidEntry = totals.get(String(expense.paid_by_key));
    if (paidEntry) paidEntry.paid += Number(expense.amount || 0);
    for (const split of expense.splits || []) {
      const splitEntry = totals.get(String(split.member_key));
      if (splitEntry) splitEntry.share += Number(split.share_amount || 0);
    }
  }

  for (const member of trip.members || []) {
    if (!member.linked_user_id) continue;
    const target = userMap.get(String(member.linked_user_id));
    if (!target?.email) continue;
    const key = member.friend_id != null ? String(member.friend_id) : `u${member.linked_user_id}`;
    const total = totals.get(key) || { paid: 0, share: 0 };
    const net = Math.round((total.paid - total.share) * 100) / 100;
    await sendTripFinalizedEmail({
      to: target.email,
      recipientName: target.display_name,
      tripName: trip.name,
      ownerName: owner.display_name,
      currencyCode: target.currency_code,
      localeCode: target.locale_code,
      summaryLines: [
        { label: 'Trip', value: trip.name },
        { label: 'Start Date', value: trip.start_date },
        { label: 'End Date', value: trip.end_date || trip.start_date },
        { label: 'You Paid', value: total.paid, is_money: true },
        { label: 'Your Share', value: total.share, is_money: true },
        { label: net >= 0 ? 'You Are Owed' : 'You Owe', value: Math.abs(net), is_money: true },
      ],
    }).catch(() => {});
  }
}

async function sendRecurringAppliedEmailForUser(userId, entryIds = [], month = currentMonthKey()) {
  if (!isEmailEnabled() || !entryIds.length) return;
  const [user, entries] = await Promise.all([
    pgAuth.findUserById(userId),
    pgOps.getRecurringEntries(userId),
  ]);
  if (!user?.email) return;
  const appliedEntries = (entries || []).filter((entry) => entryIds.includes(Number(entry.id)));
  if (!appliedEntries.length) return;
  await sendRecurringAppliedEmail({
    to: user.email,
    name: user.display_name,
    monthLabel: monthLabel(month, user.locale_code),
    currencyCode: user.currency_code,
    localeCode: user.locale_code,
    entries: appliedEntries.map((entry) => ({
      label: entry.description,
      amount: Number(entry.amount || 0),
    })),
  }).catch(() => {});
}

async function sendTrackerExpenseAppliedEmailForUser(userId, trackerId, sourceYear, sourceMonth, options = {}) {
  if (!isEmailEnabled()) return;
  const [user, trackers] = await Promise.all([
    pgAuth.findUserById(userId),
    pgOps.getDailyTrackers(userId),
  ]);
  if (!user?.email) return;
  const tracker = (trackers || []).find((item) => Number(item.id) === Number(trackerId));
  if (!tracker) return;
  const summary = await pgOps.getDailyMonthSummary(userId, trackerId, sourceYear, sourceMonth);
  if (!summary || Number(summary.total_amount || 0) <= 0) return;
  const srcMonthKey = `${sourceYear}-${String(sourceMonth).padStart(2, '0')}`;
  await sendTrackerExpenseAppliedEmail({
    to: user.email,
    name: user.display_name,
    trackerName: tracker.name,
    sourceMonthLabel: monthLabel(srcMonthKey, user.locale_code),
    expenseMonthLabel: monthLabel(options.expense_month || currentMonthKey(), user.locale_code),
    amount: summary.total_amount,
    currencyCode: user.currency_code,
    localeCode: user.locale_code,
  }).catch(() => {});
}

async function sendMonthlySummaryEmailsForCurrentMonth() {
  if (!isEmailEnabled()) return;
  const month = currentMonthKey();
  const users = await pgAuth.getAllActiveUsersForEmail();
  for (const user of users) {
    if (!user?.email) continue;
    const alreadySent = await pgAuth.hasEmailNotificationBeenSent(user.id, 'monthly-summary', month);
    if (alreadySent) continue;

    const [payments, accounts, ccDues, emiDues, preview] = await Promise.all([
      pgOps.getMonthlyPayments(user.id, month),
      pgOps.getBankAccounts(user.id),
      pgBilling.getCcDuesForMonth(user.id, month),
      pgFinance.getEmiDuesForMonth(user.id, month),
      pgFinance.getPreviewDataForMonth(user.id, month, pgBilling),
    ]);

    const currentDue = Math.round((
      (payments || []).filter((payment) => payment.status !== 'paid').reduce((sum, payment) => sum + Number(payment.amount || 0) - Number(payment.paid_amount || 0), 0) +
      (ccDues || []).reduce((sum, due) => sum + (Number(due.net_payable || 0) - Number(due.paid_amount || 0)), 0) +
      (emiDues || []).filter((item) => Number(item.paid_amount || 0) < Number(item.emi_amount || 0) * 0.999).reduce((sum, item) => sum + (Number(item.emi_amount || 0) - Number(item.paid_amount || 0)), 0)
    ) * 100) / 100;
    const projectedDue = Math.round((
      (preview?.projectedDefaults || []).reduce((sum, item) => sum + Number(item.amount || 0), 0) +
      (preview?.projectedCcDues || []).reduce((sum, item) => sum + Number(item.net_payable || 0), 0) +
      (preview?.emiDues || []).filter((item) => Number(item.paid_amount || 0) < Number(item.emi_amount || 0) * 0.999).reduce((sum, item) => sum + (Number(item.emi_amount || 0) - Number(item.paid_amount || 0)), 0)
    ) * 100) / 100;
    const bankBalance = Math.round((accounts || []).reduce((sum, account) => sum + Number(account.balance || 0), 0) * 100) / 100;
    const spendable = Math.round((accounts || []).reduce((sum, account) => sum + (Number(account.balance || 0) - Number(account.min_balance || 0)), 0) * 100) / 100;
    const afterAll = Math.round((spendable - currentDue) * 100) / 100;

    await sendMonthlyPlannerSummaryEmail({
      to: user.email,
      name: user.display_name,
      monthLabel: monthLabel(month, user.locale_code),
      currentDue,
      projectedDue,
      bankBalance,
      spendable,
      afterAll,
      currencyCode: user.currency_code,
      localeCode: user.locale_code,
    }).catch(() => {});

    const trackers = await pgOps.getDailyTrackers(user.id);
    const trackerMonth = prevMonth(month);
    const [trackerYear, trackerMon] = trackerMonth.split('-').map(Number);
    for (const tracker of trackers || []) {
      const trackerLogKey = `tracker-summary:${tracker.id}`;
      const trackerSent = await pgAuth.hasEmailNotificationBeenSent(user.id, trackerLogKey, month);
      if (trackerSent) continue;
      const summary = await pgOps.getDailyMonthSummary(user.id, tracker.id, trackerYear, trackerMon);
      if (!summary || Number(summary.total_amount || 0) <= 0) continue;
      await sendTrackerMonthSummaryEmail({
        to: user.email,
        name: user.display_name,
        trackerName: tracker.name,
        monthLabel: monthLabel(trackerMonth, user.locale_code),
        totalAmount: summary.total_amount,
        totalQty: summary.total_qty,
        autoDays: summary.auto_days,
        editedDays: summary.edited_days,
        expenseMonthLabel: tracker.auto_add_to_expense ? monthLabel(month, user.locale_code) : 'Planner carry forward',
        currencyCode: user.currency_code,
        localeCode: user.locale_code,
      }).catch(() => {});
      await pgAuth.markEmailNotificationSent(user.id, trackerLogKey, month, { tracker_id: tracker.id });
    }

    await pgAuth.markEmailNotificationSent(user.id, 'monthly-summary', month, { month });
  }
}

module.exports = {
  sendSplitShareEmailsToTargets,
  sendTripLinkedEmailToUser,
  sendTripFinalizedEmails,
  sendRecurringAppliedEmailForUser,
  sendTrackerExpenseAppliedEmailForUser,
  sendMonthlySummaryEmailsForCurrentMonth,
};

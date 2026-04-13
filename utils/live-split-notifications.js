const pgAuth = require('../db/postgres-auth');
const pgCore = require('../db/postgres-core');
const { query } = require('../db/postgres');
const { sendExpoPushNotifications } = require('./push-notifications');
const { getLiveSplitBalanceSummaryForUser } = require('./live-split-summary');
const { sendLiveSplitTripCreatedEmail, sendLiveSplitMonthlySummaryEmail, isEmailEnabled } = require('./mailer');

function n(value) {
  return Number(value || 0);
}

function r2(value) {
  return Math.round(n(value) * 100) / 100;
}

function formatCurrency(amount, currencyCode = 'INR', localeCode = 'en-IN') {
  try {
    return new Intl.NumberFormat(localeCode || 'en-IN', {
      style: 'currency',
      currency: currencyCode || 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n(amount));
  } catch (_err) {
    return `${currencyCode || 'INR'} ${n(amount).toFixed(2)}`;
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

async function notifyLiveSplitTripCreated(ownerUserId, tripId) {
  const [owner, trips] = await Promise.all([
    pgAuth.findUserById(ownerUserId),
    pgCore.getLiveSplitTrips(ownerUserId),
  ]);
  const trip = (trips || []).find((item) => Number(item.id) === Number(tripId));
  if (!owner || !trip) return { notified: 0 };

  const targetUserIds = [...new Set((trip.members || [])
    .map((member) => Number(member?.target_user_id || 0))
    .filter((uid) => uid > 0 && uid !== Number(ownerUserId)))];
  if (!targetUserIds.length) return { notified: 0 };

  const targets = await pgAuth.getBasicUsersByIds(targetUserIds);
  const ownerName = String(owner.display_name || owner.username || 'A friend').trim();
  let notified = 0;

  for (const target of targets) {
    const uid = Number(target?.id || 0);
    if (!(uid > 0)) continue;
    const title = 'New Live Split Trip';
    const body = `${ownerName} created trip "${trip.name}" with you.`;
    const created = await createAndSendUserNotification(target, {
      type: 'live_split_trip_created',
      dedupe_key: `${trip.id}:${uid}`,
      title,
      body,
      target_screen: 'LiveSplit',
      target_params: { tripId: Number(trip.id) },
      data: { trip_id: Number(trip.id), owner_user_id: Number(ownerUserId) },
    });
    if (created) notified += 1;

    if (isEmailEnabled() && target?.email) {
      await sendLiveSplitTripCreatedEmail({
        to: target.email,
        ownerName,
        recipientName: target.display_name || target.username || '',
        tripName: trip.name || `Trip #${trip.id}`,
        startDate: trip.start_date,
        endDate: trip.end_date,
        currencyCode: target.currency_code,
        localeCode: target.locale_code,
      }).catch(() => {});
    }
  }

  return { notified };
}

async function notifyLiveSplitSessionShared(ownerUserId, sessionKey, targetUserIds = []) {
  const owner = await pgAuth.findUserById(ownerUserId);
  if (!owner) return { notified: 0 };
  const uniqueTargetIds = [...new Set((targetUserIds || []).map((id) => Number(id)).filter((id) => id > 0 && id !== Number(ownerUserId)))];
  if (!uniqueTargetIds.length) return { notified: 0 };

  const groupsResult = await query(
    `SELECT id, details, total_amount, trip_id
     FROM live_split_groups
     WHERE user_id = $1
       AND (session_id = $2 OR ($2 LIKE '_solo_%' AND id = NULLIF(REPLACE($2, '_solo_', ''), '')::bigint))
     ORDER BY id DESC`,
    [ownerUserId, String(sessionKey || '').trim()]
  );
  const groups = groupsResult.rows || [];
  if (!groups.length) return { notified: 0 };
  const expenseCount = groups.length;
  const totalAmount = r2(groups.reduce((sum, row) => sum + n(row.total_amount), 0));
  const sample = groups[0];
  const tripId = Number(sample?.trip_id || 0) > 0 ? Number(sample.trip_id) : null;
  let tripName = '';
  if (tripId) {
    const trips = await pgCore.getLiveSplitTrips(ownerUserId);
    tripName = String((trips || []).find((trip) => Number(trip.id) === tripId)?.name || '').trim();
  }

  const ownerName = String(owner.display_name || owner.username || 'A friend').trim();
  const targets = await pgAuth.getBasicUsersByIds(uniqueTargetIds);
  let notified = 0;

  for (const target of targets) {
    const uid = Number(target?.id || 0);
    if (!(uid > 0)) continue;
    const title = tripName ? 'New Trip Split Added' : 'New Live Split Added';
    const body = expenseCount > 1
      ? `${ownerName} added ${expenseCount} Live Split expenses${tripName ? ` in "${tripName}"` : ''} totaling ${formatCurrency(totalAmount, target.currency_code, target.locale_code)}.`
      : `${ownerName} added "${String(sample?.details || 'Live Split expense').trim()}"${tripName ? ` in "${tripName}"` : ''} for ${formatCurrency(sample?.total_amount, target.currency_code, target.locale_code)}.`;
    const created = await createAndSendUserNotification(target, {
      type: 'live_split_shared',
      dedupe_key: `${ownerUserId}:${String(sessionKey || '').trim()}:${uid}`,
      title,
      body,
      target_screen: 'LiveSplit',
      target_params: tripId ? { tripId } : {},
      data: {
        session_key: String(sessionKey || '').trim(),
        owner_user_id: Number(ownerUserId),
        trip_id: tripId,
        group_id: Number(sample?.id || 0) || null,
      },
    });
    if (created) notified += 1;
  }
  return { notified };
}

async function notifyMonthlyLiveSplitSummary(user, month) {
  const summary = await getLiveSplitBalanceSummaryForUser(user.id);
  const oweToMe = r2(summary?.totals?.oweToMe);
  const iOwe = r2(summary?.totals?.iOwe);
  if (!(oweToMe > 0 || iOwe > 0)) return { skipped: true };
  const balance = r2(oweToMe - iOwe);
  const topRows = (summary?.rows || []).slice(0, 3);
  const topLine = topRows.length
    ? topRows.map((row) => {
      const amount = Math.abs(r2(row.amount));
      const label = row.amount > 0 ? 'owes you' : row.amount < 0 ? 'you owe' : 'settled';
      return `${row.name} ${label} ${formatCurrency(amount, user.currency_code, user.locale_code)}`;
    }).join(' · ')
    : '';
  await createAndSendUserNotification(user, {
    type: 'live_split_monthly_summary',
    dedupe_key: month,
    title: 'Live Split monthly summary',
    body: `Owed to you: ${formatCurrency(oweToMe, user.currency_code, user.locale_code)}. You owe: ${formatCurrency(iOwe, user.currency_code, user.locale_code)}. Net: ${formatCurrency(balance, user.currency_code, user.locale_code)}.${topLine ? ` ${topLine}` : ''}`,
    target_screen: 'LiveSplit',
    target_params: {},
    data: { month },
  });

  if (isEmailEnabled() && user?.email) {
    await sendLiveSplitMonthlySummaryEmail({
      to: user.email,
      name: user.display_name || user.username || '',
      month,
      oweToMe,
      iOwe,
      net: balance,
      topRows,
      currencyCode: user.currency_code,
      localeCode: user.locale_code,
    }).catch(() => {});
  }
  return { skipped: false };
}

module.exports = {
  notifyLiveSplitTripCreated,
  notifyLiveSplitSessionShared,
  notifyMonthlyLiveSplitSummary,
};

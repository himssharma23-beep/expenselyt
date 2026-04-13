const pgAuth = require('../db/postgres-auth');
const pgCore = require('../db/postgres-core');

function n(value) {
  return Number(value || 0);
}

function r2(value) {
  return Math.round(n(value) * 100) / 100;
}

function ensureRow(map, name, extra = {}) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  if (!map.has(key)) map.set(key, { key, name: String(name || '').trim(), amount: 0, linked_user_id: null, friend_id: null, ...extra });
  const row = map.get(key);
  if (extra.linked_user_id && !row.linked_user_id) row.linked_user_id = extra.linked_user_id;
  if (extra.friend_id && !row.friend_id) row.friend_id = extra.friend_id;
  return row;
}

function findExistingLinkedRowByName(map, name) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  const row = map.get(key);
  return row && Number(row.linked_user_id) > 0 ? row : null;
}

function findExistingLinkedRowByUserId(map, linkedUserId) {
  const uid = Number(linkedUserId);
  if (!(uid > 0)) return null;
  for (const row of map.values()) {
    if (Number(row?.linked_user_id) === uid) return row;
  }
  return null;
}

function computeLiveSplitRows(friends, groups, sharedGroups, currentUser) {
  const allFriends = friends || [];
  const appFriends = allFriends.filter((friend) => Number(friend?.linked_user_id) > 0);
  const friendById = new Map(allFriends.map((friend) => [Number(friend.id), friend]));
  const map = new Map();
  appFriends.forEach((friend) => ensureRow(map, friend.name, { linked_user_id: friend.linked_user_id || null, friend_id: Number(friend.id) || null }));

  (groups || []).forEach((group) => {
    const splits = Array.isArray(group?.splits) ? group.splits : [];
    const groupMode = String(group?.split_mode || '').trim().toLowerCase();
    const shareTargetByFriendId = new Map(
      (Array.isArray(group?.shared_targets) ? group.shared_targets : [])
        .map((item) => [Number(item?.friend_id), Number(item?.target_user_id)])
    );
    const total = r2(group?.total_amount);
    const totalFriends = r2(splits.reduce((sum, split) => sum + n(split.share_amount), 0));
    const selfShare = r2(total - totalFriends);
    const payerName = String(group?.paid_by || '').trim();
    const payerNameKey = payerName.toLowerCase();
    const selfIsPayer = payerName === 'You'
      || payerName === String(currentUser?.display_name || '').trim()
      || payerName === String(currentUser?.username || '').trim();

    splits.forEach((split) => {
      const friendName = String(split?.friend_name || '').trim();
      const friendNameKey = friendName.toLowerCase();
      const linkedFriend = friendById.get(Number(split?.friend_id));
      const splitLinkedUserId = Number(split?.linked_user_id || shareTargetByFriendId.get(Number(split?.friend_id)) || 0);
      const linkedByUser = splitLinkedUserId > 0 ? findExistingLinkedRowByUserId(map, splitLinkedUserId) : null;
      const fallbackFriendByUser = splitLinkedUserId > 0
        ? appFriends.find((friend) => Number(friend?.linked_user_id) === splitLinkedUserId)
        : null;
      const row = (linkedFriend && Number(linkedFriend?.linked_user_id) > 0)
        ? ensureRow(map, linkedByUser ? linkedByUser.name : friendName, { friend_id: Number(linkedFriend.id) || null, linked_user_id: linkedFriend.linked_user_id || null })
        : linkedByUser
          || (fallbackFriendByUser
            ? ensureRow(map, String(fallbackFriendByUser?.name || friendName).trim(), { friend_id: Number(fallbackFriendByUser?.id) || null, linked_user_id: splitLinkedUserId })
            : findExistingLinkedRowByName(map, friendName));
      if (!row) return;
      const rowNameKey = String(row?.name || '').trim().toLowerCase();
      const linkedFriendNameKey = String(linkedFriend?.name || '').trim().toLowerCase();
      const fallbackNameKey = String(fallbackFriendByUser?.name || '').trim().toLowerCase();
      const splitIsPayer = !!payerNameKey && (
        payerNameKey === friendNameKey
        || (rowNameKey && payerNameKey === rowNameKey)
        || (linkedFriendNameKey && payerNameKey === linkedFriendNameKey)
        || (fallbackNameKey && payerNameKey === fallbackNameKey)
      );
      if (groupMode === 'settlement') {
        if (selfIsPayer) row.amount = r2(row.amount + n(split.share_amount));
        else if (splitIsPayer) row.amount = r2(row.amount - n(split.share_amount));
        return;
      }
      if (selfIsPayer) row.amount = r2(row.amount + n(split.share_amount));
      else if (splitIsPayer && selfShare > 0) row.amount = r2(row.amount - selfShare);
    });
  });

  (sharedGroups || []).forEach((group) => {
    const splits = Array.isArray(group?.splits) ? group.splits : [];
    const groupMode = String(group?.split_mode || '').trim().toLowerCase();
    const total = r2(group?.total_amount);
    const targetName = String(group?.friend_name || '').trim();
    const ownerName = String(group?.owner_name || 'Owner').trim();
    const ownerUserId = Number(group?.owner_user_id || 0);
    if (!targetName) return;
    const meId = Number(group?.target_user_id || currentUser?.id || 0);
    let targetShare = r2(group?.friend_share_amount);
    if (!(targetShare > 0)) {
      const byLinkedUser = meId > 0 ? splits.find((split) => Number(split?.linked_user_id || 0) === meId) : null;
      if (byLinkedUser) targetShare = r2(byLinkedUser?.share_amount);
    }
    if (!(targetShare > 0)) {
      const byFriendId = Number(group?.friend_id) > 0 ? splits.find((split) => Number(split?.friend_id) === Number(group?.friend_id)) : null;
      if (byFriendId) targetShare = r2(byFriendId?.share_amount);
    }
    if (!(targetShare > 0)) {
      const targetKey = targetName.toLowerCase();
      const byName = targetKey ? splits.find((split) => String(split?.friend_name || '').trim().toLowerCase() === targetKey) : null;
      if (byName) targetShare = r2(byName?.share_amount);
    }
    const sumSplit = r2(splits.reduce((sum, split) => sum + n(split.share_amount), 0));
    const ownerShare = r2(total - sumSplit);
    const payerRaw = String(group?.paid_by || '').trim();
    const payer = payerRaw === 'You' ? ownerName : payerRaw;
    const payerIsOwner = payer === ownerName;
    const payerIsTarget = payer === targetName;
    const ownerRow = (ownerUserId > 0 ? findExistingLinkedRowByUserId(map, ownerUserId) : null) || ensureRow(map, ownerName);
    if (groupMode === 'settlement') {
      if (payerIsOwner) {
        if (ownerRow && targetShare > 0) ownerRow.amount = r2(ownerRow.amount + targetShare);
      } else if (payerIsTarget) {
        if (ownerRow && targetShare > 0) ownerRow.amount = r2(ownerRow.amount - targetShare);
      }
      return;
    }
    if (payerIsOwner) {
      if (ownerRow && targetShare > 0) ownerRow.amount = r2(ownerRow.amount - targetShare);
    } else if (payerIsTarget) {
      if (ownerRow && ownerShare > 0) ownerRow.amount = r2(ownerRow.amount + ownerShare);
    }
  });

  const rows = [...map.values()]
    .map((row) => ({ ...row, amount: r2(row.amount) }))
    .sort((a, b) => Math.abs(n(b.amount)) - Math.abs(n(a.amount)) || String(a.name || '').localeCompare(String(b.name || '')));

  const oweToMe = r2(rows.filter((row) => n(row.amount) > 0).reduce((sum, row) => sum + n(row.amount), 0));
  const iOwe = r2(rows.filter((row) => n(row.amount) < 0).reduce((sum, row) => sum + Math.abs(n(row.amount)), 0));
  return { rows, totals: { oweToMe, iOwe } };
}

async function getLiveSplitBalanceSummaryForUser(userId) {
  const [user, friends, groups, sharedGroups] = await Promise.all([
    pgAuth.findUserById(userId),
    pgCore.getLiveSplitFriends(userId),
    pgCore.getLiveSplitGroups(userId),
    pgCore.getReceivedLiveSplitShares(userId),
  ]);
  const summary = computeLiveSplitRows(friends || [], groups || [], sharedGroups || [], user || {});
  return {
    user,
    ...summary,
  };
}

module.exports = {
  getLiveSplitBalanceSummaryForUser,
};

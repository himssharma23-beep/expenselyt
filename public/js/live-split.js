(function attachLiveSplit() {
  const MODES = [
    { key: 'equal', label: 'Equal' },
    { key: 'percent', label: '% Percent' },
    { key: 'fraction', label: 'Fraction' },
    { key: 'amount', label: 'Direct Rs' },
    { key: 'parts', label: 'Parts/Ratio' },
  ];

  const state = {
    friends: [],
    appFriends: [],
    groups: [],
    sharedGroups: [],
    liveTrips: [],
    incomingInvites: [],
    outgoingInvites: [],
    inviteActionBusy: new Set(),
    hiddenIncomingInviteKeys: new Set(),
    friendDeleteBusy: new Set(),
    outgoingCancelBusy: new Set(),
    requestActionBusy: false,
    createRequestActionBusy: false,
    saveBusy: false,
    tripSaveBusy: false,
    tripActionBusy: false,
    tripMemberBusy: false,
    settleBusy: false,
    rows: [],
    totals: { oweToMe: 0, iOwe: 0 },
    bankAccounts: [],
    creditCards: [],
    create: null,
    editExpense: null,
    settle: null,
    invite: {
      query: '',
      results: [],
      searching: false,
    },
    createInvite: {
      query: '',
      results: [],
      searching: false,
    },
    activeTripDetail: null,
    rowDetailRef: '',
    eventDetailContext: null,
    sort: 'az',
    friendFilter: 'all',
    tripCreate: null,
    tripManage: null,
  };

  function n(v) {
    const value = Number(v);
    return Number.isFinite(value) ? value : 0;
  }
  function r2(v) { return Math.round(n(v) * 100) / 100; }
  function todayLocalIso() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function toLocalIsoDate(value, fallback = '') {
    if (value == null) return fallback;
    const raw = String(value).trim();
    if (!raw) return fallback;
    const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
    const dmy = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return fallback;
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function isSelfCandidate(user) {
    const me = window._currentUser || {};
    if (!user) return false;
    if (Number(user.id) > 0 && Number(me.id) > 0 && Number(user.id) === Number(me.id)) return true;
    const userUsername = String(user.username || '').trim().toLowerCase();
    const myUsername = String(me.username || '').trim().toLowerCase();
    if (userUsername && myUsername && userUsername === myUsername) return true;
    const userEmail = String(user.email || '').trim().toLowerCase();
    const myEmail = String(me.email || '').trim().toLowerCase();
    if (userEmail && myEmail && userEmail === myEmail) return true;
    return false;
  }
  function textKey(value) {
    return String(value || '').trim().toLowerCase();
  }
  function normalizePersonName(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function firstNameToken(value) {
    return normalizePersonName(value).split(' ')[0] || '';
  }
  function _renderAvatar(name, avatarUrl, extraStyle) {
    const initial = escHtml((String(name || '?')[0]).toUpperCase());
    const styleAttr = extraStyle ? ` style="${extraStyle}"` : '';
    if (avatarUrl) {
      const fallbackStyle = `display:none${extraStyle ? ';' + extraStyle : ''}`;
      return `<img src="${escHtml(avatarUrl)}" class="avatar" style="object-fit:cover${extraStyle ? ';' + extraStyle : ''}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="avatar" style="${fallbackStyle}">${initial}</div>`;
    }
    return `<div class="avatar"${styleAttr}>${initial}</div>`;
  }
  function isYouLabel(value) {
    return textKey(value) === 'you';
  }
  function isCurrentUserPayer(value) {
    const payerKey = textKey(value);
    if (!payerKey) return false;
    const me = window._currentUser || {};
    const displayKey = textKey(me.display_name);
    const usernameKey = textKey(me.username);
    return payerKey === 'you' || (displayKey && payerKey === displayKey) || (usernameKey && payerKey === usernameKey);
  }
  function currentUserNameKeys() {
    const me = window._currentUser || {};
    const keys = [
      textKey(me.display_name),
      textKey(me.username),
    ];
    const emailLocal = String(me.email || '').trim().toLowerCase().split('@')[0] || '';
    if (emailLocal) keys.push(textKey(emailLocal));
    return [...new Set(keys.filter(Boolean))];
  }
  function isSelfLinkedEntity(entity = {}) {
    const me = window._currentUser || {};
    const meId = Number(me.id || 0);
    const linkedId = Number(entity?.linked_user_id || 0);
    if (meId > 0 && linkedId > 0 && meId === linkedId) return true;
    const keys = currentUserNameKeys();
    if (!keys.length) return false;
    const candidates = [
      textKey(entity?.name),
      textKey(entity?.linked_user_display_name),
      textKey(entity?.linked_user_username),
    ].filter(Boolean);
    return candidates.some((value) => keys.includes(value));
  }
  function isLikelySelfPayerForOwnGroup(payer, splits = []) {
    if (isCurrentUserPayer(payer)) return true;
    const payerKey = textKey(payer);
    if (!payerKey) return false;
    const hasMatchInParticipants = (splits || []).some((split) => textKey(split?.friend_name) === payerKey);
    // If payer isn't one of split participants, treat it as owner/self alias.
    return !hasMatchInParticipants;
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
  function ensureLinkedRow(map, linkedUserId, name, extra = {}) {
    const uid = Number(linkedUserId || 0);
    if (!(uid > 0)) return ensureRow(map, name, extra);
    const key = `u:${uid}`;
    const safeName = String(name || '').trim() || 'User';
    if (!map.has(key)) map.set(key, { key, name: safeName, amount: 0, linked_user_id: uid, friend_id: null, ...extra });
    const row = map.get(key);
    row.linked_user_id = uid;
    if (extra.friend_id && !row.friend_id) row.friend_id = extra.friend_id;
    if ((!row.name || String(row.name).trim().length < 2) && safeName) row.name = safeName;
    return row;
  }

  function findExistingLinkedRowByName(map, name) {
    const key = normalizePersonName(name);
    if (!key) return null;
    for (const row of map.values()) {
      if (Number(row?.linked_user_id) <= 0) continue;
      const rowKey = normalizePersonName(row?.name);
      if (!rowKey) continue;
      if (rowKey === key) return row;
      if (firstNameToken(rowKey) && firstNameToken(rowKey) === firstNameToken(key)) return row;
    }
    return null;
  }
  function findLinkedFriendByName(appFriends = [], friendName = '') {
    const nameKey = normalizePersonName(friendName);
    if (!nameKey) return null;
    const token = firstNameToken(nameKey);
    return (appFriends || []).find((friend) => {
      const friendKey = normalizePersonName(
        friend?.linked_user_display_name
        || friend?.linked_user_username
        || friend?.name
      );
      if (!friendKey) return false;
      return friendKey === nameKey || (token && firstNameToken(friendKey) === token);
    }) || null;
  }

  function findExistingLinkedRowByUserId(map, linkedUserId) {
    const uid = Number(linkedUserId);
    if (!(uid > 0)) return null;
    for (const row of map.values()) {
      if (Number(row?.linked_user_id) === uid) return row;
    }
    return null;
  }

  function computeLiveSplitRows(friends, groups, sharedGroups) {
    const allFriends = friends || [];
    const meId = Number(window._currentUser?.id || 0);
    const appFriends = allFriends.filter((friend) => {
      const linkedId = Number(friend?.linked_user_id || 0);
      return linkedId > 0 && !isSelfLinkedEntity(friend) && (!(meId > 0) || linkedId !== meId);
    });
    const friendById = new Map(allFriends.map((friend) => [Number(friend.id), friend]));
    const map = new Map();
    appFriends.forEach((friend) => {
      const linkedUserId = Number(friend?.linked_user_id || 0);
      const preferredName = String(friend?.linked_user_display_name || friend?.linked_user_username || friend?.name || '').trim();
      if (linkedUserId > 0) ensureLinkedRow(map, linkedUserId, preferredName, { friend_id: Number(friend.id) || null });
      else ensureRow(map, friend.name, { linked_user_id: friend.linked_user_id || null, friend_id: Number(friend.id) || null });
    });

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
      const payerNameKey = textKey(payerName);
      const selfIsPayer = isLikelySelfPayerForOwnGroup(payerName, splits);

      splits.forEach((split) => {
        const friendName = String(split?.friend_name || '').trim();
        const friendNameKey = friendName.toLowerCase();
        const linkedFriend = friendById.get(Number(split?.friend_id));
        const linkedFriendLinkedUserId = Number(linkedFriend?.linked_user_id || 0);
        const shareTargetLinkedUserId = Number(shareTargetByFriendId.get(Number(split?.friend_id)) || 0);
        const splitLinkedUserIdRaw = Number(split?.linked_user_id || 0);
        const normalizedLinkedFriendUserId = (meId > 0 && linkedFriendLinkedUserId === meId) ? 0 : linkedFriendLinkedUserId;
        let splitLinkedUserId = splitLinkedUserIdRaw;
        if (meId > 0 && splitLinkedUserId === meId && shareTargetLinkedUserId > 0 && shareTargetLinkedUserId !== meId) {
          splitLinkedUserId = shareTargetLinkedUserId;
        }
        if (meId > 0 && splitLinkedUserId === meId) splitLinkedUserId = 0;
        const linkedByUser = splitLinkedUserId > 0 ? findExistingLinkedRowByUserId(map, splitLinkedUserId) : null;
        let fallbackFriendByUser = null;
        if (splitLinkedUserId > 0) {
          fallbackFriendByUser = appFriends.find((friend) => Number(friend?.linked_user_id) === splitLinkedUserId) || null;
        }
        if (!fallbackFriendByUser) {
          fallbackFriendByUser = findLinkedFriendByName(appFriends, friendName) || null;
        }
        if (!linkedFriend && !fallbackFriendByUser && !linkedByUser) return;
        const preferredLinkedName = String(
          linkedFriend?.linked_user_display_name
          || linkedFriend?.linked_user_username
          || fallbackFriendByUser?.linked_user_display_name
          || fallbackFriendByUser?.linked_user_username
          || linkedByUser?.name
          || friendName
          || fallbackFriendByUser?.name
          || ''
        ).trim();
        const row = (linkedFriend && normalizedLinkedFriendUserId > 0)
          ? ensureLinkedRow(map, normalizedLinkedFriendUserId, preferredLinkedName, { friend_id: Number(linkedFriend.id) || null })
          : linkedByUser
            || (fallbackFriendByUser
              ? ensureLinkedRow(map, splitLinkedUserId, preferredLinkedName, { friend_id: Number(fallbackFriendByUser?.id) || null })
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
        if (selfIsPayer) {
          row.amount = r2(row.amount + n(split.share_amount));
        } else if (splitIsPayer && selfShare > 0) {
          row.amount = r2(row.amount - selfShare);
        }
      });
    });

    (sharedGroups || []).forEach((group) => {
      const splits = Array.isArray(group?.splits) ? group.splits : [];
      const total = r2(group?.total_amount);
      const ownerName = String(group?.owner_name || 'Owner').trim() || 'Owner';
      const ownerUserId = Number(group?.owner_user_id || 0);
      const meId = Number(group?.target_user_id || window._currentUser?.id || 0);
      const sumSplit = r2(splits.reduce((sum, split) => sum + n(split.share_amount), 0));
      const ownerShare = r2(total - sumSplit);
      const participants = [
        {
          key: `owner:${ownerUserId || textKey(ownerName)}`,
          name: ownerName,
          share: ownerShare,
          linked_user_id: ownerUserId > 0 ? ownerUserId : null,
          friend_id: null,
        },
        ...splits.map((split, index) => ({
          key: `split:${Number(split?.id || 0) || index + 1}`,
          name: String(split?.friend_name || '').trim(),
          share: r2(split?.share_amount),
          linked_user_id: Number(split?.linked_user_id || 0) || null,
          friend_id: Number(split?.friend_id || 0) || null,
        })),
      ].filter((participant) => participant.name);

      if (!participants.length) return;

      const targetNameNorm = normalizePersonName(group?.friend_name || '');
      let selfParticipant = null;
      if (meId > 0) selfParticipant = participants.find((participant) => Number(participant?.linked_user_id || 0) === meId) || null;
      if (!selfParticipant && Number(group?.friend_id || 0) > 0) {
        selfParticipant = participants.find((participant) => Number(participant?.friend_id || 0) === Number(group.friend_id)) || null;
      }
      if (!selfParticipant && targetNameNorm) {
        selfParticipant = participants.find((participant) => {
          const nameNorm = normalizePersonName(participant?.name || '');
          if (!nameNorm) return false;
          return nameNorm === targetNameNorm
            || (firstNameToken(nameNorm) && firstNameToken(nameNorm) === firstNameToken(targetNameNorm));
        }) || null;
      }
      if (!selfParticipant && meId > 0 && ownerUserId > 0 && ownerUserId === meId) selfParticipant = participants[0];
      if (!selfParticipant) return;

      const payerRaw = String(group?.paid_by || '').trim();
      const payer = isYouLabel(payerRaw) ? ownerName : payerRaw;
      const payerNorm = normalizePersonName(payer);
      const payerParticipant = participants.find((participant) => {
        const nameNorm = normalizePersonName(participant?.name || '');
        if (!nameNorm || !payerNorm) return false;
        return nameNorm === payerNorm
          || (firstNameToken(nameNorm) && firstNameToken(nameNorm) === firstNameToken(payerNorm));
      }) || null;
      const selfShare = r2(selfParticipant.share);
      const selfIsPayer = !!(payerParticipant && payerParticipant.key === selfParticipant.key);

      participants.forEach((participant) => {
        if (participant.key === selfParticipant.key) return;
        const participantLinkedId = Number(participant?.linked_user_id || 0);
        if (meId > 0 && participantLinkedId > 0 && participantLinkedId === meId) return;
        if (!(participantLinkedId > 0)) return;

        const linkedFriend = participantLinkedId > 0
          ? (state.friends || []).find((friend) => Number(friend?.linked_user_id || 0) === participantLinkedId)
          : null;
        if (!linkedFriend) return;
        const preferredName = String(
          linkedFriend?.linked_user_display_name
          || linkedFriend?.linked_user_username
          || participant?.name
          || linkedFriend?.name
          || ''
        ).trim();
        const row = ensureLinkedRow(map, participantLinkedId, preferredName, {
          friend_id: Number(linkedFriend?.id || participant?.friend_id || 0) || null,
        });
        if (!row) return;
        if (isSelfLinkedEntity(row)) return;

        let delta = 0;
        if (selfIsPayer) {
          delta = r2(participant.share);
        } else if (payerParticipant && payerParticipant.key === participant.key && selfShare > 0) {
          delta = r2(0 - selfShare);
        }
        if (delta !== 0) row.amount = r2(row.amount + delta);
      });
    });

    const rows = [...map.values()]
      .map((row) => ({ ...row, amount: r2(row.amount) }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount) || a.name.localeCompare(b.name));

    const oweToMe = r2(rows.filter((row) => row.amount > 0).reduce((sum, row) => sum + row.amount, 0));
    const iOwe = r2(rows.filter((row) => row.amount < 0).reduce((sum, row) => sum + Math.abs(row.amount), 0));
    return { rows, totals: { oweToMe, iOwe } };
  }

  function buildVisibleLiveSplitRows() {
    const meId = Number(window._currentUser?.id || 0);
    const map = new Map();
    (state.rows || []).forEach((row) => {
      const key = String(row?.key || row?.name || '').trim().toLowerCase();
      if (!key) return;
      if (isSelfLinkedEntity(row)) return;
      if (meId > 0 && Number(row?.linked_user_id || 0) === meId) return;
      map.set(key, { ...row, amount: r2(row.amount) });
    });

    (state.friends || [])
      .filter((friend) => {
        const linkedId = Number(friend?.linked_user_id || 0);
        return linkedId > 0 && !isSelfLinkedEntity(friend) && (!(meId > 0) || linkedId !== meId);
      })
      .forEach((friend) => {
        const linkedUserId = Number(friend?.linked_user_id || 0);
        const key = String(friend?.name || '').trim().toLowerCase();
        if (!key) return;
        const preferredName = String(friend?.linked_user_display_name || friend?.linked_user_username || friend?.name || 'User').trim();
        const mapKey = linkedUserId > 0 ? `u:${linkedUserId}` : key;
        if (!map.has(mapKey)) {
          map.set(mapKey, {
            key: mapKey,
            name: preferredName,
            amount: 0,
            linked_user_id: linkedUserId || null,
            friend_id: Number(friend.id) || null,
          });
        }
      });

    return [...map.values()];
  }

  function buildVisibleLiveSplitRowsFromSummary(summaryRows, friends) {
    const currentRows = state.rows;
    const currentFriends = state.friends;
    state.rows = Array.isArray(summaryRows) ? summaryRows : [];
    state.friends = Array.isArray(friends) ? friends : [];
    const visibleRows = buildVisibleLiveSplitRows();
    state.rows = currentRows;
    state.friends = currentFriends;
    return visibleRows;
  }

  function resolveFriendIdForRow(row) {
    const directFriendId = Number(row?.friend_id || 0);
    if (directFriendId > 0) return directFriendId;
    const linkedUserId = Number(row?.linked_user_id || 0);
    if (!(linkedUserId > 0)) return 0;
    const linkedFriend = (state.friends || []).find((friend) =>
      Number(friend?.linked_user_id || 0) === linkedUserId
      && !isSelfLinkedEntity(friend)
    );
    return linkedFriend ? Number(linkedFriend.id || 0) : 0;
  }

  function findVisibleRow(rowRef) {
    const rows = buildVisibleLiveSplitRows();
    const raw = String(rowRef ?? '').trim();
    if (!raw) return null;
    let decoded = raw;
    try { decoded = decodeURIComponent(raw); } catch (_) { decoded = raw; }
    const numeric = Number(decoded);
    if (Number.isFinite(numeric) && numeric > 0) {
      return rows.find((row) => Number(row?.friend_id || 0) === numeric)
        || rows.find((row) => Number(row?.linked_user_id || 0) === numeric)
        || null;
    }
    const key = textKey(decoded);
    return rows.find((row) => textKey(row?.key) === key)
      || rows.find((row) => textKey(row?.name) === key)
      || null;
  }

  function liveSplitInviteIdentity(invite) {
    const inviterId = Number(invite?.inviter_user_id) || 0;
    const targetUserId = Number(invite?.target_user_id) || 0;
    const targetEmail = String(invite?.target_email || '').trim().toLowerCase();
    const targetPhone = String(invite?.target_phone || '').replace(/\D/g, '');
    if (inviterId || targetUserId || targetEmail || targetPhone) {
      return `inviter:${inviterId}|target:${targetUserId}|email:${targetEmail}|phone:${targetPhone}`;
    }
    return `invite:${Number(invite?.id) || 0}`;
  }

  function dedupeIncomingInvites(invites) {
    const list = Array.isArray(invites) ? invites : [];
    const seen = new Set();
    return list.filter((invite) => {
      const key = liveSplitInviteIdentity(invite);
      if (state.hiddenIncomingInviteKeys.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function mergeAcceptedLiveSplitFriend(result = {}, invite = {}) {
    const meId = Number(window._currentUser?.id || 0);
    const linkedUserId = Number(result?.inviter_user_id || invite?.inviter_user_id || 0);
    if (!linkedUserId) return;
    if (meId > 0 && linkedUserId === meId) return;
    const friendId = Number(result?.reverse_friend_id || 0);
    const name = String(
      result?.inviter_name
      || invite?.inviter_display_name
      || invite?.inviter_username
      || 'User'
    ).trim();
    if (!name) return;
    if (isSelfLinkedEntity({ linked_user_id: linkedUserId, name })) return;

    const existingFriend = (state.friends || []).find((friend) =>
      Number(friend?.linked_user_id) === linkedUserId || (friendId > 0 && Number(friend?.id) === friendId)
    );

    if (existingFriend) {
      existingFriend.linked_user_id = linkedUserId;
      if (!existingFriend.name) existingFriend.name = name;
      if (friendId > 0) existingFriend.id = friendId;
    } else {
      state.friends.unshift({
        id: friendId > 0 ? friendId : `temp-linked-${linkedUserId}`,
        name,
        linked_user_id: linkedUserId,
      });
    }

    state.appFriends = (state.friends || []).filter((friend) => Number(friend?.linked_user_id) > 0);
    const alreadyVisible = (state.rows || []).some((row) => Number(row?.linked_user_id) === linkedUserId || (friendId > 0 && Number(row?.friend_id) === friendId));
    if (!alreadyVisible) {
      state.rows.unshift({
        key: String(name).trim().toLowerCase(),
        name,
        amount: 0,
        linked_user_id: linkedUserId,
        friend_id: friendId > 0 ? friendId : null,
      });
    }
  }

  function hideIncomingInviteKeyTemporarily(key) {
    if (!key) return;
    state.hiddenIncomingInviteKeys.add(key);
    window.setTimeout(() => {
      state.hiddenIncomingInviteKeys.delete(key);
    }, 15000);
  }

  function isUserAlreadyLinked(userId) {
    const uid = Number(userId);
    return uid > 0 && (state.friends || []).some((friend) => Number(friend?.linked_user_id) === uid);
  }

  function isUserPending(userId) {
    const uid = Number(userId);
    return uid > 0 && (state.outgoingInvites || []).some((invite) => Number(invite?.target_user_id) === uid);
  }

  function liveSplitBusyLabel(label) {
    return `<span class="btn-loading-inline"><span class="btn-loading-dot"></span>${escHtml(label)}</span>`;
  }

  function createInitialForm() {
    const firstCard = (state.creditCards || [])[0] || null;
    return {
      step: 1,
      selected: new Set(['self']),
      date: todayLocalIso(),
      details: '',
      amount: '',
      paidBy: 'self',
      splitMode: 'equal',
      splitValues: {},
      trip_id: null,
      addExpense: true,
      expense_type: 'fair',
      category: '',
      finance_target: 'none',
      bank_account_id: null,
      card_id: firstCard ? Number(firstCard.id) : null,
      card_discount_pct: firstCard ? Number(firstCard.default_discount_pct || 0) : 0,
    };
  }

  function createInitialTripForm() {
    return {
      name: '',
      start_date: todayLocalIso(),
      end_date: '',
      show_add_to_expense_option: true,
      selected: new Set(),
    };
  }

  function getTripById(tripId) {
    const tid = Number(tripId || 0);
    if (!(tid > 0)) return null;
    return (state.liveTrips || []).find((trip) => Number(trip?.id || 0) === tid) || null;
  }

  function tripAllowsOwnerExpenseOption(tripId) {
    const trip = getTripById(tripId);
    if (!trip) return true;
    return trip.show_add_to_expense_option !== false;
  }

  function mapFriendToTripMemberPayload(friend) {
    const linkedUserId = Number(friend?.linked_user_id || 0);
    const meId = Number(window?._currentUser?.id || 0);
    const selfLinked = linkedUserId > 0 && meId > 0 && linkedUserId === meId;
    if (selfLinked) {
      return {
        friend_id: null,
        member_name: String(friend?.name || 'Member').trim(),
        target_user_id: null,
        permission: 'view',
      };
    }
    return {
      friend_id: Number(friend.id),
      member_name: String(friend?.name || 'Member').trim(),
      target_user_id: linkedUserId > 0 ? linkedUserId : null,
      permission: linkedUserId > 0 ? 'edit' : 'view',
    };
  }

  async function ensureFinanceOptionsLoaded() {
    if ((state.bankAccounts || []).length && (state.creditCards || []).length) return;
    const [banksResult, cardsResult] = await Promise.allSettled([
      api('/api/banks'),
      api('/api/cc/cards'),
    ]);
    if (banksResult.status === 'fulfilled') {
      state.bankAccounts = Array.isArray(banksResult.value?.accounts) ? banksResult.value.accounts : [];
    }
    if (cardsResult.status === 'fulfilled') {
      state.creditCards = Array.isArray(cardsResult.value?.cards) ? cardsResult.value.cards : [];
    }
  }

  function peopleForForm(form) {
    const scopedFriendIds = getTripScopedFriendIds(form?.trip_id);
    const selected = [...(form?.selected || new Set())].filter((key) => {
      if (key === 'self') return true;
      if (!scopedFriendIds) return true;
      return scopedFriendIds.has(Number(key));
    });
    return selected.map((key) => {
      if (key === 'self') return { key: 'self', name: 'You' };
      const friend = state.friends.find((item) => String(item.id) === String(key));
      return friend ? { key: String(friend.id), name: friend.name } : null;
    }).filter(Boolean);
  }

  function payerPeopleForForm(form) {
    if (!form) return [];
    if (Number(form.trip_id || 0) > 0) {
      const scopedFriendIds = getTripScopedFriendIds(form.trip_id);
      const people = [{ key: 'self', name: 'You' }];
      (state.friends || []).forEach((friend) => {
        const friendId = Number(friend?.id || 0);
        if (!(friendId > 0)) return;
        if (scopedFriendIds && !scopedFriendIds.has(friendId)) return;
        people.push({ key: String(friendId), name: String(friend?.name || '').trim() || 'Friend' });
      });
      return people.filter((person) => person.name);
    }
    return peopleForForm(form);
  }

  function getTripScopedFriendIds(tripId) {
    const tid = Number(tripId || 0);
    if (!(tid > 0)) return null;
    const trip = (state.liveTrips || []).find((item) => Number(item.id) === tid);
    if (!trip) return new Set();
    const ids = new Set();
    const memberNames = new Set();
    (trip.members || []).forEach((member) => {
      if (String(member?.permission || '').toLowerCase() === 'owner') return;
      const fid = Number(member?.friend_id || 0);
      if (fid > 0) ids.add(fid);
      const name = String(member?.member_name || '').trim().toLowerCase();
      if (name && name !== 'you') memberNames.add(name);
    });
    (state.friends || []).forEach((friend) => {
      if (memberNames.has(String(friend?.name || '').trim().toLowerCase())) ids.add(Number(friend.id));
    });
    return ids;
  }

  function peopleForEditExpense(form) {
    if (!form) return [];
    const selectedKeys = new Set((form.selected_keys || []).map((key) => String(key)));
    return editSelectablePeople(form).filter((person) => selectedKeys.has(String(person.key)));
  }

  function editSelectablePeople(form) {
    if (!form) return [];
    const ownerKey = String(form.owner_key || 'owner');
    const selectedKeys = new Set((form.selected_keys || []).map((key) => String(key)));
    const scopedFriendIds = getTripScopedFriendIds(form.trip_id);
    const people = [
      {
        key: ownerKey,
        name: String(form.owner_name || 'Owner').trim() || 'Owner',
        friend_id: null,
      },
    ];
    (state.friends || []).forEach((friend) => {
      const friendId = Number(friend?.id || 0);
      if (!(friendId > 0)) return;
      const key = String(friendId);
      if (scopedFriendIds && !scopedFriendIds.has(friendId) && !selectedKeys.has(key)) return;
      people.push({
        key,
        name: String(friend?.name || '').trim(),
        friend_id: friendId,
      });
    });
    (form.splits || []).forEach((split) => {
      const friendId = Number(split?.friend_id || 0);
      if (!(friendId > 0)) return;
      const key = String(friendId);
      if (people.some((person) => String(person.key) === key)) return;
      people.push({
        key,
        name: String(split?.friend_name || '').trim(),
        friend_id: friendId,
      });
    });
    return people.filter((person) => person.name);
  }

  function editPayerPeople(form) {
    if (!form) return [];
    const basePeople = Number(form.trip_id || 0) > 0 ? editSelectablePeople(form) : peopleForEditExpense(form);
    const payerNames = [
      String(form.paid_by || '').trim(),
      String(form.original_paid_by || '').trim(),
    ].filter(Boolean);
    payerNames.forEach((name) => {
      const exists = basePeople.some((person) => String(person.name || '').trim().toLowerCase() === name.toLowerCase());
      if (!exists) {
        basePeople.push({
          key: `payer:${name.toLowerCase()}`,
          name,
          friend_id: null,
        });
      }
    });
    return basePeople;
  }

  function autoFillValues(mode, people, amount) {
    const amt = n(amount);
    const values = {};
    if (!people.length || amt <= 0 || mode === 'equal') return values;
    if (mode === 'percent') {
      const base = Math.floor(100 / people.length);
      const rem = 100 - (base * people.length);
      people.forEach((person, index) => { values[person.key] = index === 0 ? base + rem : base; });
    } else if (mode === 'fraction') {
      people.forEach((person) => { values[person.key] = Number((1 / people.length).toFixed(4)); });
    } else if (mode === 'amount') {
      const base = Math.floor((amt / people.length) * 100) / 100;
      const rem = r2(amt - (base * people.length));
      people.forEach((person, index) => { values[person.key] = index === 0 ? r2(base + rem) : base; });
    } else if (mode === 'parts') {
      people.forEach((person) => { values[person.key] = 1; });
    }
    return values;
  }

  function computeShares(amount, mode, people, values) {
    const amt = r2(amount);
    if (!people.length) return { valid: false, error: 'Select at least one participant.', shares: [] };
    if (amt <= 0) return { valid: false, error: 'Enter a valid amount.', shares: [] };
    if (mode === 'equal') {
      const share = r2(amt / people.length);
      return {
        valid: true,
        shares: people.map((person, index) => ({
          key: person.key,
          name: person.name,
          share: index === 0 ? r2(amt - (share * (people.length - 1))) : share,
        })),
      };
    }
    if (mode === 'percent') {
      const totalPercent = people.reduce((sum, person) => sum + n(values[person.key]), 0);
      if (Math.abs(totalPercent - 100) > 0.01) return { valid: false, error: `Percent total is ${totalPercent.toFixed(2)}. It must be 100.` };
      return { valid: true, shares: people.map((person) => ({ key: person.key, name: person.name, share: r2((amt * n(values[person.key])) / 100) })) };
    }
    if (mode === 'fraction') {
      const totalFraction = people.reduce((sum, person) => sum + n(values[person.key]), 0);
      if (Math.abs(totalFraction - 1) > 0.001) return { valid: false, error: `Fractions total is ${totalFraction.toFixed(4)}. It must be 1.0.` };
      return { valid: true, shares: people.map((person) => ({ key: person.key, name: person.name, share: r2(amt * n(values[person.key])) })) };
    }
    if (mode === 'amount') {
      const totalAmount = people.reduce((sum, person) => sum + n(values[person.key]), 0);
      if (Math.abs(totalAmount - amt) > 0.01) return { valid: false, error: `Split amount is ${fmtCur(totalAmount)}. It must match ${fmtCur(amt)}.` };
      return { valid: true, shares: people.map((person) => ({ key: person.key, name: person.name, share: r2(values[person.key]) })) };
    }
    if (mode === 'parts') {
      const totalParts = people.reduce((sum, person) => sum + n(values[person.key]), 0);
      if (totalParts <= 0) return { valid: false, error: 'Parts total must be greater than 0.' };
      return { valid: true, shares: people.map((person) => ({ key: person.key, name: person.name, share: r2((amt * n(values[person.key])) / totalParts) })) };
    }
    return { valid: false, error: 'Invalid split mode.' };
  }

  function splitProgress(amount, mode, people, values) {
    const amt = r2(amount);
    if (!people?.length || !(amt > 0)) return null;
    if (mode === 'percent') {
      const entered = r2(people.reduce((sum, person) => sum + n(values[person.key]), 0));
      return { label: 'Percent total', entered, target: 100, remaining: r2(100 - entered), unit: '%' };
    }
    if (mode === 'fraction') {
      const entered = Number(people.reduce((sum, person) => sum + n(values[person.key]), 0).toFixed(4));
      return { label: 'Fraction total', entered, target: 1, remaining: Number((1 - entered).toFixed(4)), unit: '' };
    }
    if (mode === 'amount') {
      const entered = r2(people.reduce((sum, person) => sum + n(values[person.key]), 0));
      return { label: 'Split total', entered, target: amt, remaining: r2(amt - entered), unit: 'amount' };
    }
    if (mode === 'parts') {
      const entered = r2(people.reduce((sum, person) => sum + n(values[person.key]), 0));
      return { label: 'Total parts', entered, target: null, remaining: null, unit: 'parts' };
    }
    return null;
  }

  function monthLabel(dateStr) {
    const raw = toLocalIsoDate(dateStr);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return 'Unknown';
    const d = new Date(`${raw}T00:00:00`);
    if (Number.isNaN(d.getTime())) return 'Unknown';
    return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  }

  function shortDate(dateStr) {
    const raw = toLocalIsoDate(dateStr);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw || '-';
    const d = new Date(`${raw}T00:00:00`);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleString('en-US', { month: 'short', day: '2-digit' });
  }

  function buildRowEvents(row) {
    const rowName = String(row?.name || '').trim();
    if (!rowName) return [];
    const rowKey = rowName.toLowerCase();
    const rowFriendId = Number(row?.friend_id || 0);
    const rowLinkedUserId = Number(row?.linked_user_id || 0);
    const events = [];

    (state.groups || []).forEach((group) => {
      const splits = Array.isArray(group?.splits) ? group.splits : [];
      const groupMode = String(group?.split_mode || '').trim().toLowerCase();
      const shareTargetByFriendId = new Map(
        (Array.isArray(group?.shared_targets) ? group.shared_targets : [])
          .map((item) => [Number(item?.friend_id), Number(item?.target_user_id)])
      );
      const total = r2(group?.total_amount);
      const totalFriends = r2(splits.reduce((sum, split) => sum + n(split.share_amount), 0));
      const selfShare = r2(total - totalFriends);
      const payer = String(group?.paid_by || '').trim();
      const selfPayer = isLikelySelfPayerForOwnGroup(payer, splits);
      const payerKey = textKey(payer);
      let delta = 0;
      let involved = false;
      splits.forEach((split) => {
        const friendName = String(split?.friend_name || '').trim();
        const splitFriendId = Number(split?.friend_id || 0);
        const currentUserId = Number(window._currentUser?.id || 0);
        const shareTargetLinkedUserId = Number(shareTargetByFriendId.get(splitFriendId) || 0);
        const splitLinkedUserIdRaw = Number(split?.linked_user_id || 0);
        let splitLinkedUserId = splitLinkedUserIdRaw;
        if (currentUserId > 0 && splitLinkedUserId === currentUserId && shareTargetLinkedUserId > 0 && shareTargetLinkedUserId !== currentUserId) {
          splitLinkedUserId = shareTargetLinkedUserId;
        }
        if (currentUserId > 0 && splitLinkedUserId === currentUserId) splitLinkedUserId = 0;
        const friendNameNorm = normalizePersonName(friendName);
        const rowKeyNorm = normalizePersonName(rowKey);
        const matchesByName = friendNameNorm === rowKeyNorm
          || (firstNameToken(friendNameNorm) && firstNameToken(friendNameNorm) === firstNameToken(rowKeyNorm));
        const matchesRow = matchesByName
          || (rowFriendId > 0 && splitFriendId > 0 && rowFriendId === splitFriendId)
          || (rowLinkedUserId > 0 && splitLinkedUserId > 0 && rowLinkedUserId === splitLinkedUserId);
        if (matchesRow) {
          involved = true;
          if (groupMode === 'settlement') {
            if (selfPayer) delta = r2(delta + n(split.share_amount));
            else if (payerKey && (payerKey === friendName.toLowerCase() || payerKey === rowKey)) delta = r2(delta - n(split.share_amount));
            return;
          }
          if (selfPayer) delta = r2(delta + n(split.share_amount));
          else if (payerKey && (payerKey === friendName.toLowerCase() || payerKey === rowKey) && selfShare > 0) delta = r2(delta - selfShare);
        }
      });
      if (payerKey === rowKey) involved = true;
      if (involved) {
        const participants = [
          { name: 'You', share: selfShare, paid: selfPayer },
          ...splits.map((split) => ({
            name: String(split?.friend_name || '').trim(),
            share: r2(split?.share_amount),
            paid: textKey(split?.friend_name) === payerKey,
          })),
        ].filter((item) => item.name);
        events.push({
          key: `g-${group?.id || ''}-${group?.divide_date || ''}-${group?.details || ''}`,
          group_id: Number(group?.id) || null,
          trip_id: Number(group?.trip_id || 0) > 0 ? Number(group?.trip_id) : null,
          date: toLocalIsoDate(group?.divide_date),
          details: String(group?.details || group?.heading || 'Split expense').trim(),
          payer: payer || '-',
          total,
          delta,
          added_to_expense: !!group?.owner_added_to_expense,
          participants,
        });
      }
    });

    (state.sharedGroups || []).forEach((group) => {
      const splits = Array.isArray(group?.splits) ? group.splits : [];
      const total = r2(group?.total_amount);
      const ownerName = String(group?.owner_name || 'Owner').trim();
      const ownerUserId = Number(group?.owner_user_id || 0);
      const meId = Number(group?.target_user_id || window._currentUser?.id || 0);
      const sumSplit = r2(splits.reduce((sum, split) => sum + n(split.share_amount), 0));
      const ownerShare = r2(total - sumSplit);
      const participants = [
        {
          key: `owner:${ownerUserId || textKey(ownerName)}`,
          name: ownerName,
          share: ownerShare,
          linked_user_id: ownerUserId > 0 ? ownerUserId : null,
          friend_id: null,
        },
        ...splits.map((split, index) => ({
          key: `split:${Number(split?.id || 0) || index + 1}`,
          name: String(split?.friend_name || '').trim(),
          share: r2(split?.share_amount),
          linked_user_id: Number(split?.linked_user_id || 0) || null,
          friend_id: Number(split?.friend_id || 0) || null,
        })),
      ].filter((participant) => participant.name);
      if (!participants.length) return;

      const targetNameNorm = normalizePersonName(group?.friend_name || '');
      let selfParticipant = null;
      if (meId > 0) selfParticipant = participants.find((participant) => Number(participant?.linked_user_id || 0) === meId) || null;
      if (!selfParticipant && Number(group?.friend_id || 0) > 0) {
        selfParticipant = participants.find((participant) => Number(participant?.friend_id || 0) === Number(group.friend_id)) || null;
      }
      if (!selfParticipant && targetNameNorm) {
        selfParticipant = participants.find((participant) => {
          const nameNorm = normalizePersonName(participant?.name || '');
          if (!nameNorm) return false;
          return nameNorm === targetNameNorm
            || (firstNameToken(nameNorm) && firstNameToken(nameNorm) === firstNameToken(targetNameNorm));
        }) || null;
      }
      if (!selfParticipant && meId > 0 && ownerUserId > 0 && ownerUserId === meId) selfParticipant = participants[0];
      if (!selfParticipant) return;

      const payerRaw = String(group?.paid_by || '').trim();
      const payer = isYouLabel(payerRaw) ? ownerName : payerRaw;
      const payerNorm = normalizePersonName(payer);
      const payerParticipant = participants.find((participant) => {
        const nameNorm = normalizePersonName(participant?.name || '');
        if (!nameNorm || !payerNorm) return false;
        return nameNorm === payerNorm
          || (firstNameToken(nameNorm) && firstNameToken(nameNorm) === firstNameToken(payerNorm));
      }) || null;
      const selfShare = r2(selfParticipant.share);
      const selfIsPayer = !!(payerParticipant && payerParticipant.key === selfParticipant.key);

      const rowParticipant = participants.find((participant) => {
        const participantNameNorm = normalizePersonName(participant?.name || '');
        const rowNameNorm = normalizePersonName(rowName);
        const matchesByName = participantNameNorm && rowNameNorm && (
          participantNameNorm === rowNameNorm
          || (firstNameToken(participantNameNorm) && firstNameToken(participantNameNorm) === firstNameToken(rowNameNorm))
        );
        return matchesByName
          || (rowFriendId > 0 && Number(participant?.friend_id || 0) > 0 && rowFriendId === Number(participant.friend_id))
          || (rowLinkedUserId > 0 && Number(participant?.linked_user_id || 0) > 0 && rowLinkedUserId === Number(participant.linked_user_id));
      }) || null;
      if (!rowParticipant || rowParticipant.key === selfParticipant.key) return;

      let delta = 0;
      if (selfIsPayer) {
        delta = r2(rowParticipant.share);
      } else if (payerParticipant && payerParticipant.key === rowParticipant.key && selfShare > 0) {
        delta = r2(0 - selfShare);
      }

      const eventParticipants = participants.map((participant) => ({
        name: participant.name,
        share: r2(participant.share),
        paid: !!(payerParticipant && payerParticipant.key === participant.key),
        contextOnly: participant.key !== selfParticipant.key && participant.key !== rowParticipant.key,
      }));

      if (eventParticipants.length) {
        events.push({
          key: `s-${group?.id || ''}-${group?.divide_date || ''}-${group?.details || ''}`,
          group_id: Number(group?.id) || null,
          trip_id: Number(group?.trip_id || 0) > 0 ? Number(group?.trip_id) : null,
          date: toLocalIsoDate(group?.divide_date),
          details: String(group?.details || group?.heading || 'Shared split').trim(),
          payer: payer || ownerName || '-',
          total,
          delta,
          added_to_expense: !!group?.added_to_expense,
          participants: eventParticipants,
        });
      }
    });

    const directEvents = events.filter((event) => !(Number(event?.trip_id || 0) > 0));
    const tripBuckets = new Map();
    events.filter((event) => Number(event?.trip_id || 0) > 0).forEach((event) => {
      const tid = Number(event.trip_id);
      const existing = tripBuckets.get(tid) || {
        trip_id: tid,
        date: event.date,
        delta: 0,
        expense_count: 0,
      };
      existing.delta = r2(existing.delta + n(event.delta));
      existing.expense_count += 1;
      if (String(event.date || '') > String(existing.date || '')) existing.date = event.date;
      tripBuckets.set(tid, existing);
    });
    const tripSummaryEvents = [...tripBuckets.values()].map((trip) => {
      const tripMeta = (state.liveTrips || []).find((item) => Number(item.id) === Number(trip.trip_id));
      return {
        key: `trip-summary-${trip.trip_id}`,
        type: 'trip_summary',
        trip_id: Number(trip.trip_id),
        group_id: null,
        date: toLocalIsoDate(trip.date, todayLocalIso()),
        details: `Trip: ${String(tripMeta?.name || `#${trip.trip_id}`).trim()}`,
        payer: '-',
        total: r2(Math.abs(n(trip.delta))),
        delta: r2(trip.delta),
        expense_count: Number(trip.expense_count || 0),
        participants: [],
      };
    });
    return [...directEvents, ...tripSummaryEvents].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  async function refreshActiveLiveSplitModal() {
    if (state.eventDetailContext?.rowRef && state.eventDetailContext?.eventKey) {
      await openEventDetails(state.eventDetailContext.rowRef, state.eventDetailContext.eventKey);
      return;
    }
    if (state.rowDetailRef) {
      await openRowDetails(state.rowDetailRef);
      return;
    }
    closeModal();
  }

  function computeTripMemberBalances(tripId) {
    const tid = Number(tripId || 0);
    if (!(tid > 0)) return [];
    const trip = (state.liveTrips || []).find((item) => Number(item?.id || 0) === tid) || null;
    const ownGroups = (state.groups || []).filter((group) => Number(group?.trip_id || 0) === tid);
    const sharedGroups = (state.sharedGroups || []).filter((group) => Number(group?.trip_id || 0) === tid);
    const summary = computeLiveSplitRows(state.friends || [], ownGroups, sharedGroups);
    const memberFriendIds = new Set(
      ((trip?.members || []).map((member) => Number(member?.friend_id || 0)).filter((id) => id > 0))
    );
    const memberTargetIds = new Set(
      ((trip?.members || []).map((member) => Number(member?.target_user_id || 0)).filter((id) => id > 0))
    );
    const memberNames = new Set(
      (trip?.members || [])
        .map((member) => normalizePersonName(member?.member_name || ''))
        .filter((name) => !!name && name !== 'you')
    );
    return (summary.rows || [])
      .map((row) => ({ ...row, amount: r2(row.amount) }))
      .filter((row) => {
        const fid = Number(row?.friend_id || 0);
        const luid = Number(row?.linked_user_id || 0);
        const nameKey = normalizePersonName(row?.name || '');
        return (fid > 0 && memberFriendIds.has(fid))
          || (luid > 0 && memberTargetIds.has(luid))
          || (!!nameKey && memberNames.has(nameKey));
      })
      .sort((a, b) => Math.abs(n(b.amount)) - Math.abs(n(a.amount)));
  }

  function buildTripEvents(tripId) {
    const tid = Number(tripId || 0);
    if (!(tid > 0)) return [];
    const allGroups = [...(state.groups || []), ...(state.sharedGroups || [])];
    const dedup = new Map();
    allGroups.forEach((group) => {
      const gid = Number(group?.id || 0);
      if (!(gid > 0)) return;
      if (Number(group?.trip_id || 0) !== tid) return;
      if (!dedup.has(gid)) dedup.set(gid, group);
    });
    return [...dedup.values()]
      .map((group) => {
        const splits = Array.isArray(group?.splits) ? group.splits : [];
        const total = r2(group?.total_amount);
        const isSharedRow = Number(group?.owner_user_id || 0) > 0 && Number(group?.target_user_id || 0) > 0;
        if (isSharedRow) {
          const targetName = String(group?.friend_name || '').trim();
          const ownerName = String(group?.owner_name || 'Owner').trim() || 'Owner';
          let targetShare = r2(group?.friend_share_amount);
          if (!(targetShare > 0)) {
            const byName = splits.find((split) => String(split?.friend_name || '').trim().toLowerCase() === targetName.toLowerCase());
            if (byName) targetShare = r2(byName?.share_amount);
          }
          const splitSum = r2(splits.reduce((sum, split) => sum + n(split.share_amount), 0));
          const ownerShare = r2(total - splitSum);
          const payerRaw = String(group?.paid_by || '').trim();
          const payer = isYouLabel(payerRaw) ? ownerName : (payerRaw || ownerName);
          const payerKey = textKey(payer);
          const payerOwner = !!payerKey && payerKey === textKey(ownerName);
          const payerTarget = !!payerKey && payerKey === textKey(targetName);
          const extraParticipants = splits
            .map((split) => ({
              name: String(split?.friend_name || '').trim(),
              share: r2(split?.share_amount),
              paid: textKey(split?.friend_name) === payerKey,
              contextOnly: true,
            }))
            .filter((item) => item.name && item.name !== ownerName && item.name !== targetName)
            .filter((item, index, arr) => arr.findIndex((v) => v.name.toLowerCase() === item.name.toLowerCase()) === index);
          return {
            key: `t-${group?.id || ''}-${group?.divide_date || ''}`,
            group_id: Number(group?.id) || null,
            date: toLocalIsoDate(group?.divide_date),
            details: String(group?.details || group?.heading || 'Split expense').trim(),
            payer,
            total,
            participants: [
              { name: ownerName, share: ownerShare, paid: payerOwner },
              { name: targetName, share: targetShare, paid: payerTarget },
              ...extraParticipants,
            ].filter((item) => item.name),
          };
        }
        const payer = String(group?.paid_by || group?.owner_name || '').trim() || '-';
        const payerKey = textKey(payer);
        const selfPayer = isLikelySelfPayerForOwnGroup(payer, splits);
        const totalFriends = r2(splits.reduce((sum, split) => sum + n(split.share_amount), 0));
        const selfShare = r2(total - totalFriends);
        return {
          key: `t-${group?.id || ''}-${group?.divide_date || ''}`,
          group_id: Number(group?.id) || null,
          date: toLocalIsoDate(group?.divide_date),
          details: String(group?.details || group?.heading || 'Split expense').trim(),
          payer,
          total,
          participants: [
            { name: 'You', share: selfShare, paid: selfPayer },
            ...splits.map((split) => ({
              name: String(split?.friend_name || '').trim(),
              share: r2(split?.share_amount),
              paid: textKey(split?.friend_name) === payerKey,
            })),
          ].filter((item) => item.name),
        };
      })
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  function inferActivitySplitType(group = {}) {
    if (String(group?.split_mode || '').trim().toLowerCase() === 'settlement') return 'Settlement';
    const shares = Array.isArray(group?.splits) ? group.splits.map((split) => r2(split?.share_amount)).filter((value) => value >= 0) : [];
    if (shares.length > 1) {
      const first = shares[0];
      if (shares.every((value) => Math.abs(value - first) <= 0.009)) return 'Equal';
    }
    const mode = String(group?.split_mode || '').trim().toLowerCase();
    if (mode === 'equal') return 'Equal';
    if (mode === 'percent') return '% Percent';
    if (mode === 'fraction') return 'Fraction';
    if (mode === 'parts') return 'Parts/Ratio';
    if (mode === 'amount') return 'Direct Rs';
    return 'Direct Rs';
  }

  function expenseActivityHtml(activities = [], groupContext = {}) {
    if (!activities.length) return '<div style="font-size:12px;color:var(--t3)">No activity yet.</div>';
    const cleanActivityValue = (value) => {
      const text = String(value || '').trim();
      if (!text) return '';
      const lower = text.toLowerCase();
      if (lower === '-' || lower === '_' || lower === '--' || lower === 'n/a' || lower === 'na' || lower === 'null' || lower === 'undefined') return '';
      return text;
    };
    const activityLines = (item) => {
      const actor = String(item.actor_name || item.actor_username || 'Someone').trim() || 'Someone';
      const raw = String(item.summary || '').trim();
      let expenseName = String(groupContext?.details || groupContext?.heading || 'expense').trim() || 'expense';
      let amount = Number.isFinite(Number(groupContext?.total_amount)) ? n(groupContext.total_amount).toFixed(2) : '0.00';
      let splitType = inferActivitySplitType(groupContext);
      const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (lines.length) {
        const expenseMatch = lines[0].match(/updated the\s+"([^"]+)"/i);
        const parsedExpense = cleanActivityValue(expenseMatch?.[1]);
        if (parsedExpense) expenseName = parsedExpense;
        const amountMatch = lines.find((line) => /new amount\s*=/i.test(line))?.match(/new amount\s*=\s*"?([^"]+)"?/i);
        const parsedAmount = cleanActivityValue(amountMatch?.[1]);
        if (parsedAmount) {
          const numericAmount = Number(parsedAmount);
          amount = Number.isFinite(numericAmount) ? numericAmount.toFixed(2) : parsedAmount;
        }
        const splitMatch = lines.find((line) => /split type\s*=/i.test(line))?.match(/split type\s*=\s*"?([^"]+)"?/i);
        const parsedSplit = cleanActivityValue(splitMatch?.[1]);
        if (parsedSplit) splitType = parsedSplit;
      } else {
        const expLegacy = raw.match(/updated\s+"([^"]+)"/i);
        const parsedExpense = cleanActivityValue(expLegacy?.[1]);
        if (parsedExpense) expenseName = parsedExpense;
        const amtLegacy = raw.match(/amount[^0-9]*([0-9]+(?:\.[0-9]+)?)[^0-9]+([0-9]+(?:\.[0-9]+)?)/i);
        if (amtLegacy?.[2]) amount = Number(amtLegacy[2]).toFixed(2);
        if (/equally/i.test(raw)) splitType = 'Equal';
      }
      return [
        `${actor} updated the "${expenseName}"`,
        `new amount = "${amount}"`,
        `Split type = "${splitType}"`,
      ];
    };
    return `
      <div class="ls-expense-activity-list" style="display:grid;gap:8px">
        ${activities.map((item) => {
          const lines = activityLines(item);
          return `
            <div class="ls-expense-activity-card" style="padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:#fff">
              <div class="ls-expense-activity-title" style="font-size:13px;color:var(--t1);margin-top:2px;font-weight:700;line-height:1.5">${escHtml(lines[0])}</div>
              <div class="ls-expense-activity-line" style="font-size:12px;color:var(--t2);margin-top:2px">${escHtml(lines[1])}</div>
              <div class="ls-expense-activity-line" style="font-size:12px;color:var(--t2);margin-top:2px">${escHtml(lines[2])}</div>
              <div class="ls-expense-activity-date" style="font-size:11px;color:var(--t3);margin-top:4px">${escHtml(fmtDate(item.created_at))}</div>
            </div>
          `;
        }).join('')}
      </div>`;
  }

  function friendActivityHtml(activities = []) {
    if (!activities.length) {
      return '<div style="border:1px solid var(--border);border-radius:12px;background:#fbfcfb;padding:12px 14px;font-size:12px;color:var(--t3)">No friend activity yet.</div>';
    }
    const formatActivityTime = (value) => {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return String(value || '');
      return parsed.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    };
    return `
      <div style="display:grid;gap:8px">
        ${activities.map((item) => {
          const actor = String(item?.actor_name || item?.actor_username || 'Someone').trim();
          const summary = String(item?.summary || `${item?.action || 'updated'} this split`).trim();
          const details = String(item?.expense_details || '').trim();
          const amount = Number(item?.total_amount);
          const hasAmount = Number.isFinite(amount) && amount > 0;
          const meta = [
            item?.divide_date ? fmtDate(item.divide_date) : '',
            hasAmount ? fmtCur(amount) : '',
            details && !summary.toLowerCase().includes(details.toLowerCase()) ? details : '',
          ].filter(Boolean);
          return `
            <div style="border:1px solid #e5ece8;border-radius:14px;background:linear-gradient(180deg,#fff 0%,#fbfcfb 100%);padding:11px 12px;box-shadow:0 4px 14px rgba(15,23,42,.04)">
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
                <div style="font-size:13px;font-weight:700;color:var(--t1);line-height:1.38;flex:1">${escHtml(actor)} ${escHtml(summary)}</div>
                <div style="font-size:10px;color:var(--t3);white-space:nowrap;padding-top:1px">${escHtml(formatActivityTime(item.created_at))}</div>
              </div>
              ${meta.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">${meta.map((line) => `<span style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;background:#f2f6f4;color:var(--t2);font-size:11px;font-weight:600">${escHtml(line)}</span>`).join('')}</div>` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function inferEditSplitMode(totalAmount, splitValues = {}, persistedMode = '') {
    const saved = String(persistedMode || '').trim().toLowerCase();
    if (['equal', 'percent', 'fraction', 'amount', 'parts'].includes(saved)) return saved;
    const values = Object.values(splitValues).map((value) => r2(value)).filter((value) => value >= 0);
    if (values.length > 1) {
      const first = values[0];
      if (values.every((value) => Math.abs(value - first) <= 0.009)) return 'equal';
      const sum = r2(values.reduce((acc, value) => acc + value, 0));
      if (Math.abs(sum - r2(totalAmount)) <= 0.009) return 'amount';
    }
    return 'amount';
  }

  function buildEditSplitValuesForMode(totalAmount, shareByKey = {}, mode = 'equal') {
    const amt = r2(totalAmount);
    const keys = Object.keys(shareByKey);
    if (!keys.length) return {};
    const normalizedMode = String(mode || 'equal').trim().toLowerCase();
    if (normalizedMode === 'percent' && amt > 0) {
      return keys.reduce((acc, key) => {
        acc[key] = r2((n(shareByKey[key]) / amt) * 100);
        return acc;
      }, {});
    }
    if (normalizedMode === 'fraction' && amt > 0) {
      return keys.reduce((acc, key) => {
        acc[key] = Number((n(shareByKey[key]) / amt).toFixed(4));
        return acc;
      }, {});
    }
    if (normalizedMode === 'parts') {
      return keys.reduce((acc, key) => {
        acc[key] = r2(n(shareByKey[key]));
        return acc;
      }, {});
    }
    return keys.reduce((acc, key) => {
      acc[key] = r2(n(shareByKey[key]));
      return acc;
    }, {});
  }

  function createExpenseEditorState(group) {
    const ownerName = String(group?.owner_name || group?.owner_username || 'Owner').trim();
    const splitRows = (group?.splits || []).map((split) => ({
      friend_id: Number(split.friend_id),
      friend_name: String(split.friend_name || '').trim(),
      share_amount: r2(split.share_amount),
    }));
    const shareByKey = splitRows.reduce((acc, split) => {
      acc[String(split.friend_id)] = r2(split.share_amount);
      return acc;
    }, {
      owner: r2(r2(group?.total_amount) - splitRows.reduce((sum, split) => r2(sum + r2(split.share_amount)), 0)),
    });
    const mode = inferEditSplitMode(group?.total_amount, shareByKey, group?.split_mode);
    const splitValues = buildEditSplitValuesForMode(group?.total_amount, shareByKey, mode);
    return {
      id: Number(group?.id),
      trip_id: Number(group?.trip_id || 0) > 0 ? Number(group?.trip_id) : null,
      divide_date: toLocalIsoDate(group?.divide_date, todayLocalIso()),
      details: String(group?.details || '').trim(),
      heading: String(group?.heading || group?.details || '').trim(),
      total_amount: r2(group?.total_amount),
      paid_by: String(group?.paid_by || ownerName).trim(),
      original_paid_by: String(group?.paid_by || ownerName).trim(),
      owner_key: 'owner',
      owner_name: ownerName,
      splits: splitRows,
      selected_keys: ['owner', ...splitRows.map((split) => String(split.friend_id))],
      splitMode: mode,
      splitValues,
      activities: group?.activities || [],
    };
  }

  function renderExpenseEditorModal() {
    const form = state.editExpense;
    if (!form) return;
    const people = peopleForEditExpense(form);
    const selectablePeople = editSelectablePeople(form);
    const payerPeople = editPayerPeople(form);
    const selectedKeys = new Set((form.selected_keys || []).map((key) => String(key)));
    const ownerKey = String(form.owner_key || 'owner');
    const scopedFriendIds = getTripScopedFriendIds(form.trip_id);
    const preview = computeShares(n(form.total_amount), form.splitMode, people, form.splitValues);
    const progress = splitProgress(n(form.total_amount), form.splitMode, people, form.splitValues);
    const payerOptions = payerPeople.map((person) => person.name)
      .filter((value, index, arr) => value && arr.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index)
      .map((name) => `<option value="${escHtml(name)}" ${String(form.paid_by || '') === name ? 'selected' : ''}>${escHtml(name)}</option>`)
      .join('');
    window.__modalHeaderActionsHTML = `<button class="live-split-icon-btn" title="Update expense" aria-label="Update expense" onclick="liveSplitSaveEditedExpense()">${state.saveBusy ? '<span style="font-size:11px;line-height:1">...</span>' : '<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z\"/></svg>'}</button>`;
    openModal('Edit Live Split Expense', `
      <div style="display:grid;gap:12px;margin-top:-8px">
        <div class="fg">
          <label class="fl">Date<input class="fi" type="date" value="${escHtml(form.divide_date)}" onchange="liveSplitEditExpenseField('divide_date', this.value)"></label>
          <label class="fl">Amount<input class="fi" type="number" step="0.01" value="${escHtml(String(form.total_amount))}" onchange="liveSplitEditExpenseField('total_amount', this.value)"></label>
          <label class="fl full">Details<input class="fi" value="${escHtml(form.details)}" onchange="liveSplitEditExpenseField('details', this.value)"></label>
          <label class="fl">Paid By<select class="fi" onchange="liveSplitEditExpenseField('paid_by', this.value)">${payerOptions}</select></label>
        </div>
        <div>
          <div style="font-size:12px;color:var(--t2);font-weight:700;margin-bottom:8px">Participants ${Number(form.trip_id || 0) > 0 ? '(Trip members)' : ''}</div>
          <div style="display:grid;gap:8px">
            ${selectablePeople.map((person) => `
              <label style="display:flex;align-items:center;gap:8px;font-size:14px;color:var(--t1)">
                <input type="checkbox" ${selectedKeys.has(String(person.key)) ? 'checked' : ''} onchange="liveSplitEditExpenseToggleParticipant('${escHtml(String(person.key))}')">
                <span>${escHtml(person.name)}${String(person.key) === ownerKey ? ' (You)' : ''}</span>
              </label>
            `).join('')}
          </div>
          ${scopedFriendIds ? '<div style="margin-top:6px;font-size:12px;color:var(--t3)">Only trip members can be participants. Payer can still be you or any trip member.</div>' : ''}
        </div>
        <div>
          <div style="font-size:12px;color:var(--t2);font-weight:700;margin-bottom:8px">Split Mode</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${MODES.map((mode) => `<button class="chip ${form.splitMode === mode.key ? 'active' : ''}" onclick="liveSplitEditExpenseMode('${mode.key}')">${escHtml(mode.label)}</button>`).join('')}
          </div>
          ${renderSplitInputRows(form, people).replace(/liveSplitSetValue/g, 'liveSplitEditExpenseValue')}
          <div id="lsSplitProgress" style="margin-top:8px;font-size:12px;color:var(--t2)">
            ${progress
              ? (progress.unit === 'amount'
                ? `${escHtml(progress.label)}: ${fmtCur(progress.entered)} / ${fmtCur(progress.target)} \u00b7 Remaining: ${fmtCur(progress.remaining)}`
                : progress.unit === '%'
                  ? `${escHtml(progress.label)}: ${progress.entered.toFixed(2)}% / 100% \u00b7 Remaining: ${progress.remaining.toFixed(2)}%`
                  : progress.unit === 'parts'
                    ? `${escHtml(progress.label)}: ${progress.entered.toFixed(2)}`
                    : `${escHtml(progress.label)}: ${progress.entered.toFixed(4)} / 1.0000 \u00b7 Remaining: ${progress.remaining.toFixed(4)}`)
              : ''}
          </div>
          <div id="lsSplitPreview" style="margin-top:10px;padding:10px;border-radius:10px;background:var(--green-l2)">
            <div style="font-size:11px;color:var(--t3);text-transform:uppercase;font-weight:700">${preview.valid ? 'Split Preview' : 'Fix Split Values'}</div>
            <div style="font-size:13px;color:${preview.valid ? 'var(--t1)' : 'var(--red)'};margin-top:3px">
              ${preview.valid ? preview.shares.map((share) => `${escHtml(share.name)}: ${fmtCur(share.share)}`).join(' | ') : escHtml(preview.error || 'Enter valid split values')}
            </div>
          </div>
        </div>
      </div>
    `);
  }

  async function openEventDetails(rowRef, eventKeyOrGroupId) {
    const row = findVisibleRow(rowRef) || null;
    const rowFriendId = resolveFriendIdForRow(row);
    const rowRefToken = encodeURIComponent(String(row?.key || rowRef || rowFriendId || ''));
    const events = row ? buildRowEvents(row) : [];
    const rawEventKey = String(eventKeyOrGroupId || '');
    let decodedEventKey = rawEventKey;
    try { decodedEventKey = decodeURIComponent(rawEventKey); } catch (_) { decodedEventKey = rawEventKey; }
    state.rowDetailRef = rowRefToken;
    state.eventDetailContext = { rowRef: rowRefToken, eventKey: rawEventKey || decodedEventKey };
    const numericToken = Number(decodedEventKey || rawEventKey);
    let event = null;
    if (numericToken > 0) {
      event = events.find((item) => Number(item.group_id) === numericToken) || null;
    }
    if (!event) {
      event = events.find((item) =>
        String(item.key) === decodedEventKey
        || String(item.key) === rawEventKey
      ) || null;
    }
    if (!event && numericToken > 0) {
      try {
        const detail = await api(`/api/live-split/groups/${numericToken}`);
        const groupFromId = detail?.group || null;
        if (groupFromId) {
          const splits = Array.isArray(groupFromId?.splits) ? groupFromId.splits : [];
          const total = r2(groupFromId?.total_amount);
          const totalFriends = r2(splits.reduce((sum, split) => sum + n(split.share_amount), 0));
          const selfShare = r2(total - totalFriends);
          const payer = String(groupFromId?.paid_by || '').trim();
          const payerKey = textKey(payer);
          const selfPayer = isLikelySelfPayerForOwnGroup(payer, splits);
          event = {
            key: `g-${groupFromId?.id || ''}-${groupFromId?.divide_date || ''}-${groupFromId?.details || ''}`,
            group_id: Number(groupFromId?.id) || numericToken,
            date: toLocalIsoDate(groupFromId?.divide_date),
            details: String(groupFromId?.details || groupFromId?.heading || 'Split expense').trim(),
            payer: payer || '-',
            total,
            delta: 0,
            added_to_expense: !!groupFromId?.added_to_expense,
            participants: [
              { name: 'You', share: selfShare, paid: selfPayer },
              ...splits.map((split) => ({
                name: String(split?.friend_name || '').trim(),
                share: r2(split?.share_amount),
                paid: textKey(split?.friend_name) === payerKey,
              })),
            ].filter((item) => item.name),
          };
        }
      } catch (_) {
        // ignore and fall through to not-found return
      }
    }
    if (!event) {
      toast('Could not open this split detail. Please refresh once and try again.', false);
      return;
    }
    const backAction = row
      ? `liveSplitOpenDetails('${rowRefToken}')`
      : (Number(state.activeTripDetail || 0) > 0 ? `liveSplitOpenTripDetails(${Number(state.activeTripDetail)})` : 'closeModal()');
    let group = null;
    if (event.group_id) {
      try {
        const detail = await api(`/api/live-split/groups/${Number(event.group_id)}`);
        group = detail?.group || null;
        if (group) event.added_to_expense = !!group.added_to_expense;
      } catch (error) {
        const fallback = [...(state.groups || []), ...(state.sharedGroups || [])]
          .find((item) => Number(item?.id) === Number(event.group_id));
        group = fallback || null;
        toast(error?.message || 'Could not load latest details. Showing available data.', false);
      }
    }
    window.__modalClassName = 'modal-wide live-split-detail-modal';
    window.__modalOverlayClassName = 'live-split-detail-overlay';
    openModal('Details', `
      <div class="live-split-modal-shell" style="display:grid;gap:10px">
        <div class="summary-card ls-expense-detail-summary" style="text-align:left;margin-bottom:4px;padding:18px 22px">
          <div class="live-split-detail-hero" style="display:grid;grid-template-columns:36px 1fr auto;align-items:center;gap:10px;margin-bottom:8px">
            <button class="live-split-icon-btn hero" title="Back" aria-label="Back" onclick="${backAction}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z"/></svg></button>
            <div class="ls-expense-detail-title" style="font-size:16px;font-weight:700;color:#fff;text-align:center;line-height:1.2">${escHtml(event.details || '-')}</div>
            <div class="live-split-detail-actions" style="display:flex;justify-content:flex-end;gap:8px">
              ${group?.can_edit ? `<button class="live-split-icon-btn hero" title="Edit expense" aria-label="Edit expense" onclick="liveSplitEditExpense(${Number(group.id)})"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zm2.92 2.33H5v-.92l8.06-8.06.92.92L5.92 19.58zM20.71 7.04a1.003 1.003 0 0 0 0-1.42L18.37 3.29a1.003 1.003 0 0 0-1.42 0L15.13 5.1l3.75 3.75 1.83-1.81z"/></svg></button>` : ''}
              ${group?.can_delete ? `<button class="live-split-icon-btn hero danger" title="Delete expense" aria-label="Delete expense" onclick="liveSplitDeleteExpense(${Number(group.id)})"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12v2H6V7zm2 3h8l-.7 9.1c-.1 1.1-1 1.9-2.1 1.9h-2.4c-1.1 0-2-.8-2.1-1.9L8 10zm3-5h2l1 1h4v2H6V6h4l1-1z"/></svg></button>` : ''}
            </div>
          </div>
          <div class="summary-amount ls-expense-detail-amount" style="margin-top:4px;font-size:44px;text-align:center;line-height:1.1">${fmtCur(event.total)}</div>
          <div class="summary-words ls-expense-detail-meta" style="margin-top:6px;text-align:center">Added on ${escHtml(event.date || '-')} by ${escHtml((!group?.is_owner && isYouLabel(event?.payer)) ? String(group?.owner_name || event?.payer || '-') : (event?.payer || '-'))}</div>
        </div>
        <div class="live-split-table-wrap ls-expense-participant-table" style="border-radius:12px;border:1px solid var(--border);background:var(--white);overflow:hidden">
          <table style="min-width:0;table-layout:fixed;width:100%">
            <thead><tr><th>Name</th><th>Status</th></tr></thead>
            <tbody>
              ${(event.participants || []).map((p) => {
    const meName = String(window?._currentUser?.display_name || window?._currentUser?.username || 'You').trim();
    const sharedOwnerName = !group?.is_owner ? String(group?.owner_name || '').trim() : '';
    const rawName = String(p?.name || '').trim();
    const displayName = rawName.toLowerCase() === 'you'
      ? (sharedOwnerName || meName || rawName)
      : rawName;
    const exists = rawName.toLowerCase() === 'you' || (state.friends || []).some((friend) => String(friend?.name || '').trim().toLowerCase() === String(displayName || '').trim().toLowerCase());
    const encodedName = encodeURIComponent(String(displayName || '').trim());
    const statusHtml = p.contextOnly
      ? `Also in this split | ${p.paid ? `Paid ${fmtCur(p.share)}` : `Owes ${fmtCur(p.share)}`}${exists ? ' (already in your list)' : ` <button class="btn btn-s btn-sm" style="margin-left:8px" onclick="liveSplitAddFriendFromDetails('${encodedName}')">Add to my list</button>`}`
      : (p.paid ? `Paid ${fmtCur(p.share)}` : `Owes ${fmtCur(p.share)}`);
    const statusColor = p.contextOnly ? 'var(--t2)' : (p.paid ? 'var(--t2)' : 'var(--red)');
    return `
                <tr>
                  <td style="font-weight:600">${escHtml(displayName || p.name)}</td>
                  <td style="color:${statusColor}">${statusHtml}</td>
                </tr>
              `;
  }).join('')}
            </tbody>
          </table>
        </div>
        <div class="ls-expense-participant-list">
          ${(event.participants || []).map((p) => {
    const meName = String(window?._currentUser?.display_name || window?._currentUser?.username || 'You').trim();
    const sharedOwnerName = !group?.is_owner ? String(group?.owner_name || '').trim() : '';
    const rawName = String(p?.name || '').trim();
    const displayName = rawName.toLowerCase() === 'you'
      ? (sharedOwnerName || meName || rawName)
      : rawName;
    const exists = rawName.toLowerCase() === 'you' || (state.friends || []).some((friend) => String(friend?.name || '').trim().toLowerCase() === String(displayName || '').trim().toLowerCase());
    const encodedName = encodeURIComponent(String(displayName || '').trim());
    const statusHtml = p.contextOnly
      ? `Also in this split | ${p.paid ? `Paid ${fmtCur(p.share)}` : `Owes ${fmtCur(p.share)}`}${exists ? ' (already in your list)' : ` <button class="btn btn-s btn-sm" style="margin-left:8px" onclick="liveSplitAddFriendFromDetails('${encodedName}')">Add to my list</button>`}`
      : (p.paid ? `Paid ${fmtCur(p.share)}` : `Owes ${fmtCur(p.share)}`);
    const statusColor = p.contextOnly ? 'var(--t2)' : (p.paid ? 'var(--t2)' : 'var(--red)');
    return `
          <div class="ls-expense-participant-card">
            <div class="ls-expense-participant-name">${escHtml(displayName || p.name)}</div>
            <div class="ls-expense-participant-status" style="color:${statusColor}">${statusHtml}</div>
          </div>
        `;
  }).join('')}
        </div>
        ${event.delta < 0 && Math.abs(event.delta) > 0 && !event.added_to_expense ? `
          <button
            id="lsAddToExpenseBtn"
            class="btn btn-p btn-sm ls-expense-add-btn"
            style="margin-top:4px"
            data-default-label="Add My Share (${fmtCur(Math.abs(event.delta))}) to Expenses"
            onclick="liveSplitAddToExpense(${Math.abs(event.delta)}, decodeURIComponent('${encodeURIComponent(String(event.details || ''))}'), '${String(event.date || '')}', 'lsAddToExpenseBtn', ${Number(event.group_id) || 0})"
          >
            Add My Share (${fmtCur(Math.abs(event.delta))}) to Expenses
          </button>
        ` : ''}
        <div class="ls-expense-activity-wrap">
          <div class="ls-expense-activity-heading" style="font-size:12px;color:var(--t2);font-weight:700;margin-bottom:8px">Activity</div>
          <div class="live-split-activity-list" style="max-height:240px;overflow:auto;padding-right:4px">
            ${expenseActivityHtml(group?.activities || [], group || {})}
          </div>
        </div>
      </div>
    `);
  }

  async function openRowDetails(rowRef) {
    state.activeTripDetail = null;
    const refToken = String(rowRef ?? '');
    state.rowDetailRef = refToken;
    state.eventDetailContext = null;
    let row = findVisibleRow(refToken);
    if (!row) return;
    let rowFriendId = resolveFriendIdForRow(row);
    let friendActivities = [];
    const rowRefToken = encodeURIComponent(String(row?.key || refToken || rowFriendId || ''));
    let events = buildRowEvents(row);
    if (!events.length) {
      try {
        const sharedData = await api(`/api/live-split/groups/shared?_=${Date.now()}&recover=1`);
        if (Array.isArray(sharedData?.groups)) {
          state.sharedGroups = sharedData.groups;
          const summary = computeLiveSplitRows(state.friends, state.groups, state.sharedGroups);
          state.rows = buildVisibleLiveSplitRowsFromSummary(summary.rows, state.friends);
          state.totals = summary.totals;
          row = findVisibleRow(refToken) || row;
          rowFriendId = resolveFriendIdForRow(row);
          events = buildRowEvents(row);
        }
      } catch (_) {
        // keep existing state and show current details fallback
      }
    }
    if (rowFriendId > 0) {
      try {
        const activityData = await api(`/api/live-split/friends/${rowFriendId}/activity`);
        friendActivities = Array.isArray(activityData?.activities) ? activityData.activities : [];
      } catch (_) {
        friendActivities = [];
      }
    }
    const grouped = {};
    events.forEach((event) => {
      const key = monthLabel(event.date);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(event);
    });
    window.__modalClassName = 'modal-wide live-split-detail-modal';
    window.__modalOverlayClassName = 'live-split-detail-overlay';
    openModal(`Live Split - ${escHtml(row.name)}`, `
      <div class="live-split-modal-shell" style="display:grid;gap:10px">
        <div class="live-split-modal-top" style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <div style="font-size:13px;color:var(--t2)">Current balance: <b style="color:${row.amount >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtCur(row.amount)}</b></div>
          <button class="live-split-icon-btn" title="Add split" aria-label="Add split" onclick="${rowFriendId > 0 ? `liveSplitOpenCreateForFriend(${rowFriendId})` : 'liveSplitOpenCreate()'}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 11H13V5h-2v6H5v2h6v6h2v-6h6z"/></svg>
          </button>
        </div>
        <div>
          ${events.length ? Object.entries(grouped).map(([month, monthEvents]) => `
            <div style="margin-bottom:10px">
              <div style="font-size:14px;font-weight:800;color:var(--t1);margin:6px 0">${escHtml(month)}</div>
              <div class="live-split-table-wrap ls-desktop-event-wrap" style="border-radius:12px;border:1px solid var(--border);background:var(--white);overflow:hidden">
                <table class="live-split-event-table" style="min-width:0;table-layout:fixed;width:100%">
                  <thead><tr><th>Date</th><th>Details</th><th class="td-m live-split-action-col"></th><th class="td-m live-split-amount-col">Amount</th></tr></thead>
                  <tbody>
                    ${monthEvents.map((event) => {
                      const tone = event.delta > 0 ? 'var(--green)' : event.delta < 0 ? 'var(--red)' : 'var(--t3)';
                      const canManage = Number(event.group_id) > 0;
                      const isTripSummary = String(event?.type || '') === 'trip_summary' && Number(event?.trip_id || 0) > 0;
                      const canAddMyShare = !isTripSummary && !event.added_to_expense && Number(event.delta) < 0 && Math.abs(Number(event.delta)) > 0;
                      const openCall = isTripSummary
                        ? `liveSplitOpenTripDetails(${Number(event.trip_id)})`
                        : `liveSplitOpenEvent('${rowRefToken}', '${Number(event.group_id) || 0}')`;
                      const addShareBtnId = `lsAddToExpenseBtn_${Number(event.group_id) || 0}`;
                      const mobileAddShareBtnId = `lsAddToExpenseBtn_mobile_${Number(event.group_id) || 0}`;
                      const addShareLabel = `Add My Share (${fmtCur(Math.abs(Number(event.delta) || 0))})`;
                      const buildActionHtml = (buttonId) => (canManage && !isTripSummary) || canAddMyShare ? `
                        <div class="live-split-row-actions">
                          ${canManage && !isTripSummary ? `
                          <button class="live-split-icon-btn soft" title="Edit expense" aria-label="Edit expense" onclick="liveSplitEditExpense(${Number(event.group_id)})">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zm2.92 2.33H5v-.92l8.06-8.06.92.92L5.92 19.58zM20.71 7.04a1.003 1.003 0 0 0 0-1.42L18.37 3.29a1.003 1.003 0 0 0-1.42 0L15.13 5.1l3.75 3.75 1.83-1.81z"/></svg>
                          </button>
                          <button class="live-split-icon-btn danger" title="Delete expense" aria-label="Delete expense" onclick="liveSplitDeleteExpense(${Number(event.group_id)})">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12v2H6V7zm2 3h8l-.7 9.1c-.1 1.1-1 1.9-2.1 1.9h-2.4c-1.1 0-2-.8-2.1-1.9L8 10zm3-5h2l1 1h4v2H6V6h4l1-1z"/></svg>
                          </button>
                          ` : ''}
                          ${canAddMyShare ? `
                          <button
                            id="${buttonId}"
                            class="live-split-icon-btn success emphasize"
                            title="${escHtml(`${addShareLabel} to Expenses`)}"
                            aria-label="${escHtml(`${addShareLabel} to Expenses`)}"
                            data-default-label="icon"
                            onclick="liveSplitAddToExpense(${Math.abs(Number(event.delta) || 0)}, decodeURIComponent('${encodeURIComponent(String(event.details || ''))}'), '${String(event.date || '')}', '${buttonId}', ${Number(event.group_id) || 0})"
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14m-7-7h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                          </button>
                          ` : ''}
                        </div>
                      ` : '<span style="font-size:11px;color:var(--t3)">-</span>';
                      const mobileActionHtml = buildActionHtml(mobileAddShareBtnId);
                      const desktopActionHtml = buildActionHtml(addShareBtnId);
                      return `
                        <tr>
                          <td class="live-split-date-col" style="cursor:pointer" onclick="${openCall}">${escHtml(shortDate(event.date))}</td>
                          <td class="live-split-details-col" style="cursor:pointer" onclick="${openCall}">
                            <div style="display:flex;width:100%;align-items:flex-start;justify-content:space-between;gap:10px">
                              <div style="font-weight:700;font-size:14px;flex:1;min-width:0;word-break:break-word;line-height:1.4">${escHtml(event.details || '-')}</div>
                              <div class="ls-hide-desktop" style="font-family:var(--mono);font-weight:700;font-size:14px;flex-shrink:0;white-space:nowrap;color:${tone}">${fmtCur(event.delta)}</div>
                            </div>
                            <div style="font-size:12px;color:var(--t3);margin-top:5px">${isTripSummary ? `${Number(event.expense_count || 0)} trip expenses` : `${fmtCur(event.total)} paid by ${escHtml(event.payer || '-')}`}</div>
                            <div class="ls-hide-desktop" style="display:flex;width:100%;align-items:center;justify-content:space-between;gap:8px;margin-top:10px" onclick="event.stopPropagation()">
                              <span style="font-size:11px;color:var(--t3);font-weight:600">${escHtml(shortDate(event.date))}</span>
                              <div style="display:flex;flex-shrink:0">${mobileActionHtml}</div>
                            </div>
                          </td>
                          <td class="td-m live-split-action-col" onclick="event.stopPropagation()">
                            ${desktopActionHtml}
                          </td>
                          <td class="td-m live-split-amount-col" style="color:${tone};cursor:pointer" onclick="${openCall}">${fmtCur(event.delta)}</td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
              <div class="ls-mobile-event-list">
                ${monthEvents.map((event) => {
                  const tone = event.delta > 0 ? 'var(--green)' : event.delta < 0 ? 'var(--red)' : 'var(--t3)';
                  const canManage = Number(event.group_id) > 0;
                  const isTripSummary = String(event?.type || '') === 'trip_summary' && Number(event?.trip_id || 0) > 0;
                  const canAddMyShare = !isTripSummary && !event.added_to_expense && Number(event.delta) < 0 && Math.abs(Number(event.delta)) > 0;
                  const openCall = isTripSummary
                    ? `liveSplitOpenTripDetails(${Number(event.trip_id)})`
                    : `liveSplitOpenEvent('${rowRefToken}', '${Number(event.group_id) || 0}')`;
                  const mobileAddShareBtnId = `lsAddToExpenseBtn_mobile_card_${Number(event.group_id) || 0}`;
                  const addShareLabel = `Add My Share (${fmtCur(Math.abs(Number(event.delta) || 0))})`;
                  const actionHtml = (canManage && !isTripSummary) || canAddMyShare ? `
                    <div class="live-split-row-actions">
                      ${canManage && !isTripSummary ? `
                      <button class="live-split-icon-btn soft" title="Edit expense" aria-label="Edit expense" onclick="liveSplitEditExpense(${Number(event.group_id)})">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zm2.92 2.33H5v-.92l8.06-8.06.92.92L5.92 19.58zM20.71 7.04a1.003 1.003 0 0 0 0-1.42L18.37 3.29a1.003 1.003 0 0 0-1.42 0L15.13 5.1l3.75 3.75 1.83-1.81z"/></svg>
                      </button>
                      <button class="live-split-icon-btn danger" title="Delete expense" aria-label="Delete expense" onclick="liveSplitDeleteExpense(${Number(event.group_id)})">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12v2H6V7zm2 3h8l-.7 9.1c-.1 1.1-1 1.9-2.1 1.9h-2.4c-1.1 0-2-.8-2.1-1.9L8 10zm3-5h2l1 1h4v2H6V6h4l1-1z"/></svg>
                      </button>
                      ` : ''}
                      ${canAddMyShare ? `
                      <button
                        id="${mobileAddShareBtnId}"
                        class="live-split-icon-btn success emphasize"
                        title="${escHtml(`${addShareLabel} to Expenses`)}"
                        aria-label="${escHtml(`${addShareLabel} to Expenses`)}"
                        data-default-label="icon"
                        onclick="liveSplitAddToExpense(${Math.abs(Number(event.delta) || 0)}, decodeURIComponent('${encodeURIComponent(String(event.details || ''))}'), '${String(event.date || '')}', '${mobileAddShareBtnId}', ${Number(event.group_id) || 0})"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14m-7-7h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                      </button>
                      ` : ''}
                    </div>
                  ` : '<span style="font-size:11px;color:var(--t3)">-</span>';
                  return `
                    <div class="ls-mobile-event-card" onclick="${openCall}">
                      <div class="ls-mobile-event-head">
                        <div class="ls-mobile-event-title">${escHtml(event.details || '-')}</div>
                        <div class="ls-mobile-event-amount" style="color:${tone}">${fmtCur(event.delta)}</div>
                      </div>
                      <div class="ls-mobile-event-sub">${isTripSummary ? `${Number(event.expense_count || 0)} trip expenses` : `${fmtCur(event.total)} paid by ${escHtml(event.payer || '-')}`}</div>
                      <div class="ls-mobile-event-foot" onclick="event.stopPropagation()">
                        <span class="ls-mobile-event-date">${escHtml(shortDate(event.date))}</span>
                        <div class="ls-mobile-event-actions">${actionHtml}</div>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          `).join('') : '<div class="empty-td">No split details yet.</div>'}
        </div>
        ${rowFriendId > 0 ? `
          <div style="margin-top:6px">
            <div style="font-size:12px;color:var(--t2);font-weight:700;margin-bottom:8px">Friend Activity</div>
            <div class="live-split-activity-list" style="max-height:240px;overflow:auto;padding-right:4px">${friendActivityHtml(friendActivities)}</div>
          </div>
        ` : ''}
      </div>
    `);
  }

  async function openTripDetails(tripId) {
    const tid = Number(tripId || 0);
    if (!(tid > 0)) return;
    const trip = (state.liveTrips || []).find((item) => Number(item.id) === tid);
    if (!trip) {
      toast('Trip not found', 'warning');
      return;
    }
    state.activeTripDetail = tid;
    const events = buildTripEvents(tid);
    const memberBalances = computeTripMemberBalances(tid);
    const grouped = {};
    events.forEach((event) => {
      const key = monthLabel(event.date);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(event);
    });
    // Build per-member paid/share summary from events
    const memberSummaryMap = {};
    events.forEach((event) => {
      (event.participants || []).forEach((p) => {
        if (!p.name) return;
        if (!memberSummaryMap[p.name]) memberSummaryMap[p.name] = { name: p.name, paid: 0, share: 0 };
        memberSummaryMap[p.name].share = r2(memberSummaryMap[p.name].share + r2(p.share));
        if (p.paid) memberSummaryMap[p.name].paid = r2(memberSummaryMap[p.name].paid + r2(event.total));
      });
    });
    const memberSummary = Object.values(memberSummaryMap);
    const status = String(trip.status || 'active').toLowerCase();
    const statusTone = status === 'completed' ? 'var(--t3)' : 'var(--green)';
    window.__modalClassName = 'modal-wide live-split-detail-modal';
    window.__modalOverlayClassName = 'live-split-detail-overlay';
    openModal(`Trip - ${escHtml(trip.name || 'Trip')}`, `
      <div class="live-split-modal-shell" style="display:grid;gap:10px">
        <div class="live-split-modal-top" style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <div style="font-size:13px;color:var(--t2)">
            <b style="color:${statusTone};text-transform:capitalize">${escHtml(status)}</b>
            | ${fmtCur(trip.total_amount || 0)} | ${(trip.members || []).length} members | ${Number(trip.expense_count || 0)} expenses
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${trip.show_add_to_expense_option === false ? (trip.added_to_expense
              ? `<div style="font-size:11px;font-weight:700;color:var(--green);padding:6px 10px;border-radius:999px;background:#edfbf3;border:1px solid #cdeeda">Added to expenses${trip.added_to_expense_is_extra ? ' · Extra' : ' · Fair'}</div>`
              : `<button class="btn btn-s btn-sm" ${Number(trip.total_amount || 0) > 0 ? `onclick="liveSplitAddTripToExpense(${tid}, decodeURIComponent('${encodeURIComponent(String(trip.name || 'Trip').trim())}'), ${Number(trip.total_amount || 0)})"` : 'disabled'}>${Number(trip.total_amount || 0) > 0 ? 'Add To Expenses' : 'Add To Expenses'}</button>`) : ''}
            <button class="live-split-icon-btn" title="Add split" aria-label="Add split" onclick="liveSplitUseTrip(${tid})">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 11H13V5h-2v6H5v2h6v6h2v-6h6z"/></svg>
            </button>
          </div>
        </div>
        ${trip.is_owner ? `
          <div style="display:flex;justify-content:flex-end">
            <button class="btn btn-g btn-sm" onclick="liveSplitDeleteTrip(${tid})">Delete Trip</button>
          </div>
        ` : ''}
        ${memberBalances.length ? `
          <div class="live-split-summary-chips" style="display:flex;flex-wrap:wrap;gap:6px">
            ${memberBalances.map((item) => {
              const amount = r2(item.amount);
              const tone = amount > 0 ? 'var(--green)' : amount < 0 ? 'var(--red)' : 'var(--t3)';
              const status = amount > 0 ? 'owes you' : amount < 0 ? 'you owe' : 'settled';
              return `
                <div style="padding:5px 10px;border:1px solid var(--border);border-radius:999px;background:#fff;font-size:12px;color:var(--t2)">
                  <b style="color:var(--t1)">${escHtml(item.name || 'Friend')}</b> <span style="color:${tone}">${escHtml(status)} ${fmtCur(Math.abs(amount))}</span>
                </div>
              `;
            }).join('')}
          </div>
        ` : ''}
        ${memberSummary.length ? `
          <div class="live-split-member-grid" style="display:flex;flex-wrap:wrap;gap:8px">
            ${memberSummary.map((m) => {
              const net = r2(m.paid - m.share);
              const netColor = net > 0.005 ? 'var(--green)' : net < -0.005 ? 'var(--red)' : 'var(--t3)';
              const netBg = net > 0.005 ? '#edfbf3' : net < -0.005 ? '#fff1f1' : 'var(--bg2)';
              const netLabel = net > 0.005 ? `+${fmtCur(net)}` : net < -0.005 ? `-${fmtCur(Math.abs(net))}` : 'Settled';
              return `
                <div class="live-split-member-card" style="border:1px solid var(--border);border-radius:12px;overflow:hidden;flex:1;min-width:120px;background:#fff">
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;padding:8px 12px;border-bottom:1px solid var(--border);background:var(--bg2)">
                    <span style="font-size:13px;font-weight:700;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1">${escHtml(m.name)}</span>
                    <span style="font-size:12px;font-weight:700;color:${netColor};background:${netBg};padding:2px 8px;border-radius:20px;flex-shrink:0;white-space:nowrap">${netLabel}</span>
                  </div>
                  <div class="live-split-member-stats" style="display:flex;padding:8px 12px;gap:16px">
                    <div>
                      <div style="font-size:10px;color:var(--t3);font-weight:600;text-transform:uppercase;margin-bottom:2px">Paid</div>
                      <div style="font-size:13px;font-weight:600;color:${m.paid > 0 ? 'var(--green)' : 'var(--t3)'}">${m.paid > 0 ? fmtCur(m.paid) : '&mdash;'}</div>
                    </div>
                    <div>
                      <div style="font-size:10px;color:var(--t3);font-weight:600;text-transform:uppercase;margin-bottom:2px">Share</div>
                      <div style="font-size:13px;font-weight:600;color:var(--t1)">${fmtCur(m.share)}</div>
                    </div>
                  </div>
                </div>`;
            }).join('')}
          </div>
        ` : ''}
        <div>
          ${events.length ? Object.entries(grouped).map(([month, monthEvents]) => `
            <div style="margin-bottom:10px">
              <div style="font-size:14px;font-weight:800;color:var(--t1);margin:6px 0">${escHtml(month)}</div>
              <div class="live-split-table-wrap ls-desktop-event-wrap" style="border-radius:12px;border:1px solid var(--border);background:var(--white);overflow:hidden">
                <table class="live-split-event-table" style="min-width:0;table-layout:fixed;width:100%">
                  <thead><tr><th>Date</th><th>Details</th><th class="td-m live-split-action-col"></th><th class="td-m live-split-amount-col">Amount</th></tr></thead>
                  <tbody>
                    ${monthEvents.map((event) => {
                      const canManage = Number(event.group_id) > 0;
                      const openCall = `liveSplitOpenTripEvent(${tid}, ${Number(event.group_id) || 0})`;
                      const actionHtml = canManage ? `
                        <div class="live-split-row-actions">
                          <button class="live-split-icon-btn" title="Edit expense" aria-label="Edit expense" onclick="liveSplitEditExpense(${Number(event.group_id)})">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zm2.92 2.33H5v-.92l8.06-8.06.92.92L5.92 19.58zM20.71 7.04a1.003 1.003 0 0 0 0-1.42L18.37 3.29a1.003 1.003 0 0 0-1.42 0L15.13 5.1l3.75 3.75 1.83-1.81z"/></svg>
                          </button>
                          <button class="live-split-icon-btn danger" title="Delete expense" aria-label="Delete expense" onclick="liveSplitDeleteExpense(${Number(event.group_id)})">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12v2H6V7zm2 3h8l-.7 9.1c-.1 1.1-1 1.9-2.1 1.9h-2.4c-1.1 0-2-.8-2.1-1.9L8 10zm3-5h2l1 1h4v2H6V6h4l1-1z"/></svg>
                          </button>
                        </div>
                      ` : '<span style="font-size:11px;color:var(--t3)">-</span>';
                      return `
                        <tr>
                          <td class="live-split-date-col" style="cursor:pointer" onclick="${openCall}">${escHtml(shortDate(event.date))}</td>
                          <td class="live-split-details-col" style="cursor:pointer" onclick="${openCall}">
                            <div style="display:flex;width:100%;align-items:flex-start;justify-content:space-between;gap:10px">
                              <div style="font-weight:700;font-size:14px;flex:1;min-width:0;word-break:break-word;line-height:1.4">${escHtml(event.details || '-')}</div>
                              <div class="ls-hide-desktop" style="font-family:var(--mono);font-weight:700;font-size:14px;flex-shrink:0;white-space:nowrap">${fmtCur(event.total)}</div>
                            </div>
                            <div style="font-size:12px;color:var(--t3);margin-top:5px">${fmtCur(event.total)} paid by ${escHtml(event.payer || '-')}</div>
                            <div class="ls-hide-desktop" style="display:flex;width:100%;align-items:center;justify-content:space-between;gap:8px;margin-top:10px" onclick="event.stopPropagation()">
                              <span style="font-size:11px;color:var(--t3);font-weight:600">${escHtml(shortDate(event.date))}</span>
                              <div style="display:flex;flex-shrink:0">${actionHtml}</div>
                            </div>
                          </td>
                          <td class="td-m live-split-action-col" onclick="event.stopPropagation()">
                            ${actionHtml}
                          </td>
                          <td class="td-m live-split-amount-col" style="color:var(--t1);cursor:pointer" onclick="${openCall}">${fmtCur(event.total)}</td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
              <div class="ls-mobile-event-list">
                ${monthEvents.map((event) => {
                  const canManage = Number(event.group_id) > 0;
                  const openCall = `liveSplitOpenTripEvent(${tid}, ${Number(event.group_id) || 0})`;
                  const actionHtml = canManage ? `
                    <div class="live-split-row-actions">
                      <button class="live-split-icon-btn" title="Edit expense" aria-label="Edit expense" onclick="liveSplitEditExpense(${Number(event.group_id)})">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zm2.92 2.33H5v-.92l8.06-8.06.92.92L5.92 19.58zM20.71 7.04a1.003 1.003 0 0 0 0-1.42L18.37 3.29a1.003 1.003 0 0 0-1.42 0L15.13 5.1l3.75 3.75 1.83-1.81z"/></svg>
                      </button>
                      <button class="live-split-icon-btn danger" title="Delete expense" aria-label="Delete expense" onclick="liveSplitDeleteExpense(${Number(event.group_id)})">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12v2H6V7zm2 3h8l-.7 9.1c-.1 1.1-1 1.9-2.1 1.9h-2.4c-1.1 0-2-.8-2.1-1.9L8 10zm3-5h2l1 1h4v2H6V6h4l1-1z"/></svg>
                      </button>
                    </div>
                  ` : '<span style="font-size:11px;color:var(--t3)">-</span>';
                  return `
                    <div class="ls-mobile-event-card" onclick="${openCall}">
                      <div class="ls-mobile-event-head">
                        <div class="ls-mobile-event-title">${escHtml(event.details || '-')}</div>
                        <div class="ls-mobile-event-amount">${fmtCur(event.total)}</div>
                      </div>
                      <div class="ls-mobile-event-sub">${fmtCur(event.total)} paid by ${escHtml(event.payer || '-')}</div>
                      <div class="ls-mobile-event-foot" onclick="event.stopPropagation()">
                        <span class="ls-mobile-event-date">${escHtml(shortDate(event.date))}</span>
                        <div class="ls-mobile-event-actions">${actionHtml}</div>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          `).join('') : '<div class="empty-td">No trip split details yet.</div>'}
        </div>
      </div>
    `);
  }

  async function openTripEventDetails(tripId, groupId) {
    state.activeTripDetail = Number(tripId || 0) > 0 ? Number(tripId) : null;
    await openEventDetails(0, Number(groupId || 0));
  }

  function renderRows() {
    const rows = buildVisibleLiveSplitRows().filter((row) => {
      if (String(state.friendFilter || 'all') === 'hide_settled') return Math.abs(n(row?.amount)) > 0.004;
      return true;
    });
    if (!rows.length) {
      return `
        <div style="border:1px dashed var(--line);border-radius:14px;padding:22px;text-align:center;color:var(--t3);background:#fff">
          No live split balances yet.
        </div>`;
    }
    if (state.sort === 'high') {
      rows.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount) || a.name.localeCompare(b.name));
    } else if (state.sort === 'low') {
      rows.sort((a, b) => Math.abs(a.amount) - Math.abs(b.amount) || a.name.localeCompare(b.name));
    } else {
      rows.sort((a, b) => a.name.localeCompare(b.name));
    }
    return rows.map((row) => {
      const amount = row.amount;
      const friendId = resolveFriendIdForRow(row);
      const canSettle = friendId > 0 && Math.abs(n(amount)) > 0.004;
      const rowRef = encodeURIComponent(String(row?.key || friendId || row?.name || ''));
      const tone = row.amount > 0 ? 'var(--green)' : row.amount < 0 ? 'var(--red)' : 'var(--t3)';
      const label = row.amount > 0 ? 'They owe' : row.amount < 0 ? 'You owe' : 'Settled';
      return `
        <div class="friend-card live-split-card" style="cursor:pointer" onclick="liveSplitOpenDetails('${rowRef}')">
          <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
            ${_renderAvatar(row.name, row.linked_user_avatar_url)}
            <div class="friend-info">
              <div class="friend-name">${escHtml(row.name)}</div>
              <div style="font-size:11px;color:${tone}">${escHtml(label)}</div>
              <div style="font-size:11px;color:${row.linked_user_id ? 'var(--green)' : 'var(--t3)'};margin-top:2px">${row.linked_user_id ? 'App user' : ''}</div>
            </div>
          </div>
          <div class="live-split-card-actions" style="display:flex;align-items:center;gap:10px" onclick="event.stopPropagation()">
            ${canSettle ? `<button class="btn btn-s btn-sm" onclick="liveSplitOpenSettle(${friendId})">Settle</button>` : ''}
            <button class="btn btn-g btn-sm" ${friendId > 0 && state.friendDeleteBusy.has(friendId) ? 'disabled' : ''} onclick="${friendId > 0 ? `liveSplitDeleteFriend(${friendId})` : 'return false'}">${friendId > 0 && state.friendDeleteBusy.has(friendId) ? liveSplitBusyLabel('Deleting...') : 'Delete'}</button>
            <div class="friend-bal" style="color:${tone}">${fmtCur(amount)}</div>
          </div>
        </div>`;
    }).join('');
  }

  function renderTripsSection() {
    const trips = [...(state.liveTrips || [])]
      .sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')) || Number(b.id || 0) - Number(a.id || 0));
    if (!trips.length) {
      return `
        <div style="margin-top:14px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <div style="font-size:13px;font-weight:800;color:var(--t2)">Trips</div>
            <button class="btn btn-s btn-sm" onclick="liveSplitOpenTripCreate()">+ New Trip</button>
          </div>
          <div class="card" style="text-align:center;color:var(--t3);padding:18px">No Trips yet.</div>
        </div>`;
    }
    return `
      <div style="margin-top:14px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="font-size:13px;font-weight:800;color:var(--t2)">Trips</div>
          <button class="btn btn-s btn-sm" onclick="liveSplitOpenTripCreate()">+ New Trip</button>
        </div>
        <div style="display:grid;gap:8px">
          ${trips.map((trip) => {
            const status = String(trip?.status || 'active').toLowerCase();
            const statusTone = status === 'completed' ? 'var(--t3)' : 'var(--green)';
            const busy = state.tripActionBusy === Number(trip.id);
            return `
              <div class="friend-card live-split-card" style="cursor:pointer" onclick="liveSplitOpenTripDetails(${Number(trip.id)})">
                <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
                  <div class="friend-info">
                    <div class="friend-name">${escHtml(trip.name || 'Trip')}</div>
                    <div style="font-size:11px;color:var(--t3)">
            | ${fmtCur(trip.total_amount || 0)} | ${(trip.members || []).length} members | ${Number(trip.expense_count || 0)} expenses
                    </div>
                  </div>
                </div>
                <div class="live-split-card-actions live-split-trip-action-wrap" onclick="event.stopPropagation()">
                  <span class="live-split-trip-status" style="font-size:11px;font-weight:700;color:${statusTone};text-transform:capitalize">${escHtml(status)}</span>
                  <div class="live-split-trip-actions">
                    <button class="btn btn-p btn-sm" onclick="liveSplitUseTrip(${Number(trip.id)})">Add Split</button>
                    ${trip.show_add_to_expense_option === false ? (trip.added_to_expense
                      ? `<button class="btn btn-s btn-sm" disabled>${trip.added_to_expense_is_extra ? 'Added Extra' : 'Added Fair'}</button>`
                      : `<button class="btn btn-s btn-sm" ${Number(trip.total_amount || 0) > 0 ? `onclick="liveSplitAddTripToExpense(${Number(trip.id)}, decodeURIComponent('${encodeURIComponent(String(trip.name || 'Trip').trim())}'), ${Number(trip.total_amount || 0)})"` : 'disabled'}>Add To Expenses</button>`) : ''}
                    <button class="btn btn-s btn-sm" onclick="liveSplitManageTripMembers(${Number(trip.id)})">Members</button>
                    ${trip.is_owner ? `<button class="btn btn-g btn-sm" ${busy ? 'disabled' : ''} onclick="liveSplitDeleteTrip(${Number(trip.id)})">${busy ? liveSplitBusyLabel('Deleting...') : 'Delete Trip'}</button>` : ''}
                    ${trip.is_owner ? `<button class="btn btn-g btn-sm" ${busy ? 'disabled' : ''} onclick="liveSplitToggleTripStatus(${Number(trip.id)}, '${status === 'completed' ? 'active' : 'completed'}')">${busy ? liveSplitBusyLabel('Saving...') : (status === 'completed' ? 'Reopen' : 'Complete')}</button>` : ''}
                  </div>
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  function renderSettleModal() {
    const settle = state.settle;
    if (!settle) return;
    const friend = (state.friends || []).find((item) => Number(item.id) === Number(settle.friend_id));
    if (!friend) return;
    const outstanding = r2(settle.outstanding_amount);
    openModal(`Settle - ${escHtml(friend.name || 'Friend')}`, `
      <div style="display:grid;gap:12px">
        <div style="font-size:12px;color:var(--t2)">
          Outstanding: <b style="color:${settle.direction === 'received' ? 'var(--green)' : 'var(--red)'}">${fmtCur(outstanding)}</b> (${settle.direction === 'received' ? 'to receive' : 'to pay'})
        </div>
        <label class="fl">Amount
          <input class="fi" type="number" step="0.01" min="0.01" value="${escHtml(String(settle.amount || ''))}" oninput="liveSplitSettleField('amount', this.value)">
        </label>
        <div>
          <div style="font-size:12px;color:var(--t2);font-weight:700;margin-bottom:8px">Settlement Type</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="chip ${settle.direction === 'received' ? 'active' : ''}" onclick="liveSplitSettleField('direction','received')">I Received</button>
            <button class="chip ${settle.direction === 'paid' ? 'active' : ''}" onclick="liveSplitSettleField('direction','paid')">I Paid</button>
          </div>
        </div>
        <div style="font-size:12px;color:var(--t3)">
          ${settle.direction === 'received' ? 'Use this when friend paid you back.' : 'Use this when you paid this friend.'}
        </div>
        <label class="fc"><input type="checkbox" ${settle.record_finance ? 'checked' : ''} onchange="liveSplitSettleField('record_finance', this.checked)"><span>Also record this in my finances</span></label>
        ${settle.record_finance ? `
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="chip ${settle.finance_target === 'none' ? 'active' : ''}" onclick="liveSplitSettleField('finance_target','none')">None</button>
            <button class="chip ${settle.finance_target === 'expense' ? 'active' : ''}" onclick="liveSplitSettleField('finance_target','expense')">Expense / Bank</button>
            <button class="chip ${settle.finance_target === 'card' ? 'active' : ''}" onclick="liveSplitSettleField('finance_target','card')">Credit Card</button>
          </div>
          ${settle.finance_target === 'expense' ? `
            <label class="fl">Deduct From Bank (optional)
              <select class="fi" onchange="liveSplitSettleField('bank_account_id', this.value)">
                <option value="">Do not deduct</option>
                ${(state.bankAccounts || []).map((bank) => `<option value="${Number(bank.id)}" ${Number(settle.bank_account_id) === Number(bank.id) ? 'selected' : ''}>${escHtml(String(bank.bank_name || 'Bank').trim())}${bank.account_name ? ` - ${escHtml(String(bank.account_name).trim())}` : ''}</option>`).join('')}
              </select>
            </label>
          ` : settle.finance_target === 'card' ? `
            <label class="fl">Credit Card
              <select class="fi" onchange="liveSplitSettleField('card_id', this.value)">
                <option value="">None</option>
                ${(state.creditCards || []).map((card) => `<option value="${Number(card.id)}" ${Number(settle.card_id) === Number(card.id) ? 'selected' : ''}>${escHtml(String(card.card_name || 'Card').trim())} (${escHtml(String(card.bank_name || 'Bank').trim())} **${escHtml(String(card.last4 || ''))})</option>`).join('')}
              </select>
            </label>
            <label class="fl">Discount % (optional)
              <input class="fi" type="number" step="0.1" min="0" max="100" value="${escHtml(String(settle.card_discount_pct ?? 0))}" onchange="liveSplitSettleField('card_discount_pct', this.value)">
            </label>
          ` : ``}
        ` : ''}
        <div class="fa">
          <button class="btn btn-g" onclick="liveSplitCancelSettle()">Cancel</button>
          <button class="btn btn-p" ${state.settleBusy ? 'disabled' : ''} onclick="liveSplitSaveSettle()">${state.settleBusy ? liveSplitBusyLabel('Saving...') : 'Settle'}</button>
        </div>
      </div>
    `);
  }

  async function openSettleModal(friendId) {
    const id = Number(friendId);
    if (!id) return;
    await ensureFinanceOptionsLoaded();
    const firstCard = (state.creditCards || [])[0] || null;
    const row = buildVisibleLiveSplitRows().find((item) => Number(item.friend_id) === id);
    const current = r2(row?.amount);
    const direction = current < 0 ? 'paid' : 'received';
    const outstanding = Math.abs(current);
    state.settle = {
      friend_id: id,
      amount: outstanding > 0 ? String(outstanding) : '',
      direction,
      outstanding_amount: outstanding,
      record_finance: false,
      finance_target: 'none',
      bank_account_id: null,
      card_id: firstCard ? Number(firstCard.id) : null,
      card_discount_pct: firstCard ? Number(firstCard.default_discount_pct || 0) : 0,
    };
    renderSettleModal();
  }

  async function openCreateForFriend(friendId) {
    const id = Number(friendId);
    await Promise.resolve(ensureFinanceOptionsLoaded()).catch(() => {});
    state.create = createInitialForm();
    state.createInvite = { query: '', results: [], searching: false, searched: false };
    if (id > 0) state.create.selected.add(String(id));
    if ([...state.create.selected].filter((key) => key !== 'self').length > 0) state.create.step = 2;
    closeModal();
    renderCreateModal();
  }

  async function saveSettleEntry() {
    const settle = state.settle;
    if (!settle) return;
    const friend = (state.friends || []).find((item) => Number(item.id) === Number(settle.friend_id));
    if (!friend) return;
    const amount = r2(settle.amount);
    if (!(amount > 0)) {
      toast('Enter a valid amount', 'warning');
      return;
    }
    const paidBy = settle.direction === 'paid' ? 'You' : String(friend.name || '').trim();
    const sessionKey = `live_settle_${Date.now()}`;
    try {
      state.settleBusy = true;
      renderSettleModal();
      await api('/api/live-split/groups', {
        method: 'POST',
        body: {
          divide_date: todayLocalIso(),
          details: 'Settlement',
          paid_by: paidBy,
          total_amount: amount,
          split_mode: 'settlement',
          splits: [{ friend_id: Number(friend.id), friend_name: String(friend.name || '').trim(), share_amount: amount }],
          heading: 'Settlement',
          session_id: sessionKey,
        },
      });
      if (Number(friend.linked_user_id) > 0) {
        await api('/api/live-split/groups/share-session', {
          method: 'POST',
          body: { session_key: sessionKey, friend_ids: [Number(friend.id)] },
        });
      }
      if (settle.record_finance) {
        if (settle.finance_target === 'card' && Number(settle.card_id || 0) > 0) {
          const cardId = Number(settle.card_id || 0);
          await api('/api/cc/txns', {
            method: 'POST',
            body: {
              card_id: cardId,
              txn_date: todayLocalIso(),
              description: `Settlement - ${String(friend.name || 'Friend').trim()}`,
              amount,
              discount_pct: Number(settle.card_discount_pct || 0),
              source: 'live_split_settlement',
            },
          });
        } else if (settle.finance_target === 'expense') {
          await api('/api/expenses', {
            method: 'POST',
            body: {
              item_name: `Settlement - ${String(friend.name || 'Friend').trim()}`,
              category: 'Settlement',
              amount,
              purchase_date: todayLocalIso(),
              is_extra: false,
              bank_account_id: settle.bank_account_id ? Number(settle.bank_account_id) : null,
            },
          });
        }
      }
      state.settle = null;
      state.settleBusy = false;
      closeModal();
      await loadLiveSplit();
      toast('Settlement added', 'success');
    } catch (error) {
      state.settleBusy = false;
      if (state.settle) renderSettleModal();
      toast(error?.message || 'Could not settle amount', 'error');
    }
  }

  function getPendingInviteRows() {
    const pendingFriends = (state.friends || []).filter((friend) => !Number(friend?.linked_user_id));
    const outgoing = state.outgoingInvites || [];
    const outgoingNames = new Set(outgoing.map((invite) => String(invite.target_name || invite.target_display_name || invite.target_username || '').trim().toLowerCase()).filter(Boolean));
    const merged = [
      ...outgoing.map((invite) => ({
        id: invite.id,
        inviteId: invite.id,
        friendId: (state.friends || []).find((friend) => String(friend?.name || '').trim().toLowerCase() === String(invite.target_name || invite.target_display_name || invite.target_username || invite.target_email || invite.target_phone || '').trim().toLowerCase())?.id || null,
        name: String(invite.target_name || invite.target_display_name || invite.target_username || invite.target_email || invite.target_phone || 'Friend').trim(),
        canResend: true,
      })),
      ...pendingFriends
        .filter((friend) => !outgoingNames.has(String(friend.name || '').trim().toLowerCase()))
        .map((friend) => ({
          id: `friend-${friend.id}`,
          inviteId: null,
          friendId: friend.id,
          name: friend.name || 'Friend',
          canResend: false,
        })),
    ];
    return merged;
  }

  function renderPendingInvites() {
    const pending = getPendingInviteRows();
    if (!pending.length) return '';
    return `
      <div style="margin-top:14px">
        <div style="font-size:13px;font-weight:800;color:var(--t2);margin-bottom:8px">Pending Invites (${pending.length})</div>
        <div style="display:grid;gap:8px">
          ${pending.map((friend) => `
            <div class="friend-card live-split-card" style="cursor:default">
              <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
                ${_renderAvatar(friend.name, friend.linked_user_avatar_url, 'background:#f5f7fa;color:var(--t2)')}
                <div class="friend-info">
                  <div class="friend-name">${escHtml(friend.name || 'Friend')}</div>
                  <div style="font-size:11px;color:var(--t3)">Invite sent - waiting to join/link</div>
                </div>
              </div>
              <div class="live-split-card-actions" style="display:flex;align-items:center;gap:8px">
                ${friend.inviteId ? `<button class="btn btn-g btn-sm" ${state.outgoingCancelBusy.has(Number(friend.inviteId)) ? 'disabled' : ''} onclick="liveSplitCancelInvite(${Number(friend.inviteId)})">${state.outgoingCancelBusy.has(Number(friend.inviteId)) ? liveSplitBusyLabel('Cancelling...') : 'Cancel'}</button>` : ''}
                <button class="btn btn-s btn-sm" onclick="${friend.canResend ? `liveSplitResendInvite(${Number(friend.id)})` : `liveSplitResendInviteByName('${encodeURIComponent(friend.name || '')}')`}">Send Again</button>
                ${friend.friendId ? `<button class="btn btn-g btn-sm" ${state.friendDeleteBusy.has(Number(friend.friendId)) ? 'disabled' : ''} onclick="liveSplitDeleteFriend(${Number(friend.friendId)})">${state.friendDeleteBusy.has(Number(friend.friendId)) ? liveSplitBusyLabel('Deleting...') : 'Delete'}</button>` : ''}
                <div style="font-size:11px;color:var(--orange);font-weight:700">Pending</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function openPendingInvitesModal() {
    const pending = getPendingInviteRows();
    if (!pending.length) {
      toast('No pending invites right now.', false);
      return;
    }
    openModal(`Pending Invites (${pending.length})`, `
      <div style="display:grid;gap:8px">
        ${pending.map((friend) => `
          <div class="friend-card live-split-card" style="cursor:default">
            <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
              ${_renderAvatar(friend.name, friend.linked_user_avatar_url, 'background:#f5f7fa;color:var(--t2)')}
              <div class="friend-info">
                <div class="friend-name">${escHtml(friend.name || 'Friend')}</div>
                <div style="font-size:11px;color:var(--t3)">Invite sent - waiting to join/link</div>
              </div>
            </div>
            <div class="live-split-card-actions" style="display:flex;align-items:center;gap:8px">
              ${friend.inviteId ? `<button class="btn btn-g btn-sm" ${state.outgoingCancelBusy.has(Number(friend.inviteId)) ? 'disabled' : ''} onclick="liveSplitCancelInvite(${Number(friend.inviteId)})">${state.outgoingCancelBusy.has(Number(friend.inviteId)) ? liveSplitBusyLabel('Cancelling...') : 'Cancel'}</button>` : ''}
              <button class="btn btn-s btn-sm" onclick="${friend.canResend ? `liveSplitResendInvite(${Number(friend.id)})` : `liveSplitResendInviteByName('${encodeURIComponent(friend.name || '')}')`}">Send Again</button>
              ${friend.friendId ? `<button class="btn btn-g btn-sm" ${state.friendDeleteBusy.has(Number(friend.friendId)) ? 'disabled' : ''} onclick="liveSplitDeleteFriend(${Number(friend.friendId)})">${state.friendDeleteBusy.has(Number(friend.friendId)) ? liveSplitBusyLabel('Deleting...') : 'Delete'}</button>` : ''}
              <div style="font-size:11px;color:var(--orange);font-weight:700">Pending</div>
            </div>
          </div>
        `).join('')}
      </div>
    `);
  }

  function renderIncomingInvites() {
    const incoming = dedupeIncomingInvites(state.incomingInvites || []);
    if (!incoming.length) return '';
    return `
      <div style="margin-top:14px">
        <div style="font-size:13px;font-weight:800;color:var(--t2);margin-bottom:8px">Received Requests (${incoming.length})</div>
        <div style="display:grid;gap:8px">
          ${incoming.map((invite) => `
            <div class="friend-card live-split-request-card" style="cursor:default">
              <div class="live-split-request-main" style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
                ${_renderAvatar(invite.inviter_display_name || invite.inviter_username, invite.inviter_avatar_url, 'background:#f5f7fa;color:var(--t2)')}
                <div class="friend-info">
                  <div class="friend-name">${escHtml(invite.inviter_display_name || invite.inviter_username || 'User')}</div>
                  <div style="font-size:11px;color:var(--t3)">Invited you to Live Split</div>
                </div>
              </div>
              <div class="live-split-request-actions" style="display:flex;gap:8px">
                <button class="btn btn-p btn-sm" ${state.inviteActionBusy.has(Number(invite.id)) ? 'disabled' : ''} onclick="liveSplitAcceptInvite(${Number(invite.id)})">Accept</button>
                <button class="btn btn-g btn-sm" ${state.inviteActionBusy.has(Number(invite.id)) ? 'disabled' : ''} onclick="liveSplitRejectInvite(${Number(invite.id)})">Reject</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderMain() {
    const { oweToMe, iOwe } = state.totals;
    const net = r2(oweToMe - iOwe);
    const pendingCount = getPendingInviteRows().length;
    const main = document.getElementById('main');
    if (!main) return;
    main.innerHTML = `
      <div class="tab-content">
        <div class="summary-card" style="text-align:center">
          <div class="summary-label">NET BALANCE</div>
          <div class="summary-amount" style="color:${typeof balColorLight === 'function' ? balColorLight(net) : (net >= 0 ? 'var(--green)' : 'var(--red)')}">${fmtCur(net)}</div>
          <div class="summary-words">${net < 0 ? 'Overall you owe' : 'Overall you are owed'}</div>
        </div>
        <div class="filter-row">
          <button class="btn btn-p btn-sm" onclick="liveSplitOpenCreate()">+ Add Split</button>
          ${pendingCount > 0 ? `<button class="btn btn-s btn-sm" onclick="liveSplitOpenPendingInvites()">Pending Invites (${pendingCount})</button>` : ''}
          <div class="chip-group">
            <button class="chip ${state.sort === 'az' ? 'active' : ''}" onclick="liveSplitSetSort('az')">A-Z</button>
            <button class="chip ${state.sort === 'high' ? 'active' : ''}" onclick="liveSplitSetSort('high')">Highest</button>
            <button class="chip ${state.sort === 'low' ? 'active' : ''}" onclick="liveSplitSetSort('low')">Lowest</button>
          </div>
          <div class="chip-group">
            <button class="chip ${state.friendFilter === 'all' ? 'active' : ''}" onclick="liveSplitSetFriendFilter('all')">All Friends</button>
            <button class="chip ${state.friendFilter === 'hide_settled' ? 'active' : ''}" onclick="liveSplitSetFriendFilter('hide_settled')">Hide Settled Friends</button>
          </div>
        </div>
        <div>
          ${renderRows()}
        </div>
        ${renderTripsSection()}
        ${renderIncomingInvites()}
      </div>`;
  }

  async function fetchData() {
    const [friendResult, divideResult, sharedResult, incomingResult, outgoingResult, tripsResult] = await Promise.allSettled([
      api('/api/live-split/friends'),
      api('/api/live-split/groups'),
      api(`/api/live-split/groups/shared?_=${Date.now()}`),
      api('/api/live-split/invites/incoming'),
      api('/api/live-split/invites/outgoing'),
      api('/api/live-split/trips'),
    ]);
    if (friendResult.status !== 'fulfilled' || divideResult.status !== 'fulfilled') {
      throw new Error(friendResult.reason?.message || divideResult.reason?.message || 'Could not load live split');
    }
    let safeSharedGroups = Array.isArray(state.sharedGroups) ? state.sharedGroups : [];
    if (sharedResult.status === 'fulfilled' && Array.isArray(sharedResult.value?.groups)) {
      safeSharedGroups = sharedResult.value.groups;
    } else {
      try {
        const retry = await api(`/api/live-split/groups/shared?_=${Date.now()}&retry=1`);
        if (Array.isArray(retry?.groups)) safeSharedGroups = retry.groups;
      } catch (_) {
        // Keep previous shared data if shared endpoint is temporarily unavailable.
      }
    }
    const incomingData = incomingResult.status === 'fulfilled' ? incomingResult.value : { invites: state.incomingInvites || [] };
    const outgoingData = outgoingResult.status === 'fulfilled' ? outgoingResult.value : { invites: state.outgoingInvites || [] };
    if (sharedResult.status !== 'fulfilled') {
      toast('Some shared split details are delayed. Pull to refresh once.', false);
    }
    state.friends = friendResult.value?.friends || [];
    state.appFriends = state.friends.filter((friend) => Number(friend?.linked_user_id) > 0);
    state.groups = divideResult.value?.groups || [];
    state.sharedGroups = safeSharedGroups;
    state.incomingInvites = dedupeIncomingInvites(incomingData?.invites || []);
    state.outgoingInvites = outgoingData?.invites || [];
    state.liveTrips = tripsResult.status === 'fulfilled' ? (tripsResult.value?.trips || []) : [];
    const summary = computeLiveSplitRows(state.friends, state.groups, state.sharedGroups);
    state.rows = buildVisibleLiveSplitRowsFromSummary(summary.rows, state.friends);
    state.totals = summary.totals;
  }

  async function loadLiveSplit() {
    const main = document.getElementById('main');
    if (!main) return;
    main.innerHTML = '<div class="tab-content"><div class="section-card" style="padding:24px;text-align:center;color:var(--t3)">Loading live split...</div></div>';
    try {
      await fetchData();
      renderMain();
    } catch (error) {
      main.innerHTML = `<div class="tab-content"><div class="section-card" style="padding:24px;color:var(--red)">${escHtml(error?.message || 'Could not load live split')}</div></div>`;
    }
  }

  function toggleParticipant(id) {
    const key = String(id);
    const scopedFriendIds = getTripScopedFriendIds(state.create?.trip_id);
    if (key !== 'self' && scopedFriendIds && !scopedFriendIds.has(Number(key))) {
      toast('For trip split, participants must be trip members', 'warning');
      return;
    }
    if (state.create.selected.has(key)) state.create.selected.delete(key);
    else state.create.selected.add(key);
    const allowedPayers = payerPeopleForForm(state.create);
    if (!allowedPayers.some((person) => String(person.key) === String(state.create.paidBy))) {
      state.create.paidBy = allowedPayers[0]?.key || 'self';
    }
    if (!state.create.selected.has('self')) state.create.addExpense = false;
    if (Number(state.create.trip_id || 0) > 0 && !tripAllowsOwnerExpenseOption(state.create.trip_id)) {
      state.create.addExpense = false;
    }
    state.create.splitValues = autoFillValues(state.create.splitMode, peopleForForm(state.create), n(state.create.amount));
    renderCreateModal();
  }

  function setSplitMode(mode) {
    state.create.splitMode = mode;
    state.create.splitValues = autoFillValues(mode, peopleForForm(state.create), n(state.create.amount));
    renderCreateModal();
  }

  function renderSplitInputRows(form, people) {
    if (form.splitMode === 'equal') return '';
    return `
      <div style="display:grid;gap:8px;margin-top:10px">
        ${people.map((person) => `
          <label class="fl" style="margin-bottom:0">
            ${escHtml(person.name)}
            <input class="fi" type="number" step="any" value="${escHtml(String(form.splitValues[person.key] ?? ''))}" oninput="liveSplitSetValue('${escHtml(person.key)}', this.value)">
          </label>
        `).join('')}
      </div>`;
  }

  function refreshSplitStatus(form, people) {
    const total = n(form.amount !== undefined ? form.amount : form.total_amount);
    const preview = computeShares(total, form.splitMode, people, form.splitValues);
    const progress = splitProgress(total, form.splitMode, people, form.splitValues);

    const progressEl = document.getElementById('lsSplitProgress');
    if (progressEl) {
      progressEl.innerHTML = progress
        ? (progress.unit === 'amount'
          ? `${escHtml(progress.label)}: ${fmtCur(progress.entered)} / ${fmtCur(progress.target)} \u00b7 Remaining: ${fmtCur(progress.remaining)}`
          : progress.unit === '%'
            ? `${escHtml(progress.label)}: ${progress.entered.toFixed(2)}% / 100% \u00b7 Remaining: ${progress.remaining.toFixed(2)}%`
            : progress.unit === 'parts'
              ? `${escHtml(progress.label)}: ${progress.entered.toFixed(2)}`
              : `${escHtml(progress.label)}: ${progress.entered.toFixed(4)} / 1.0000 \u00b7 Remaining: ${progress.remaining.toFixed(4)}`)
        : '';
    }

    const previewEl = document.getElementById('lsSplitPreview');
    if (previewEl) {
      previewEl.innerHTML = `
        <div style="font-size:11px;color:var(--t3);text-transform:uppercase;font-weight:700">${preview.valid ? 'Split Preview' : 'Fix Split Values'}</div>
        <div style="font-size:13px;color:${preview.valid ? 'var(--t1)' : 'var(--red)'};margin-top:3px">
          ${preview.valid ? preview.shares.map((share) => `${escHtml(share.name)}: ${fmtCur(share.share)}`).join(' | ') : escHtml(preview.error || 'Enter valid split values')}
        </div>`;
    }
  }

  function renderCreateModal() {
    const form = state.create;
    if (!form) return;
    const people = peopleForForm(form);
    const payerPeople = payerPeopleForForm(form);
    const scopedFriendIds = getTripScopedFriendIds(form.trip_id);
    const stepTwoSelectableFriends = (state.friends || [])
      .filter((friend) => !scopedFriendIds || scopedFriendIds.has(Number(friend.id)));
    const preview = computeShares(n(form.amount), form.splitMode, people, form.splitValues);
    const progress = splitProgress(n(form.amount), form.splitMode, people, form.splitValues);
    const friendPeople = people.filter((person) => person.key !== 'self');
    const payerOptions = payerPeople.map((person) => `<option value="${escHtml(person.key)}" ${form.paidBy === person.key ? 'selected' : ''}>${escHtml(person.name)}</option>`).join('');
    const tripAllowsExpenseOption = Number(form.trip_id || 0) > 0 ? tripAllowsOwnerExpenseOption(form.trip_id) : true;
    if (form.step === 1) {
      const outgoingNames = new Set((state.outgoingInvites || []).map((invite) => String(invite.target_name || invite.target_display_name || invite.target_username || '').trim().toLowerCase()).filter(Boolean));
      const scopedFriendIds = getTripScopedFriendIds(form.trip_id);
      const selectableFriends = (state.friends || [])
        .filter((friend) => !Number(friend?.linked_user_id) || Number(friend?.linked_user_id) > 0)
        .filter((friend) => !scopedFriendIds || scopedFriendIds.has(Number(friend.id)));
      openModal('Live Split - Select Friends', `
        <div style="display:grid;gap:10px">
          <div style="font-size:12px;color:var(--t3)">${Number(form.trip_id || 0) > 0 ? 'Pick any trip members you want in this split. You can also keep only yourself selected.' : 'Pick people for this split. You are selected by default.'}</div>
          <label class="fc"><input type="checkbox" checked disabled><span>You</span></label>
          ${selectableFriends.map((friend) => {
            const isPending = !Number(friend?.linked_user_id) && outgoingNames.has(String(friend?.name || '').trim().toLowerCase());
            const suffix = isPending ? ' <span style="color:var(--amber);font-size:11px">(invitation sent)</span>' : (Number(friend?.linked_user_id) > 0 ? ' <span style="color:var(--t3);font-size:11px">(app user)</span>' : '');
            return `
            <label class="fc">
              <input type="checkbox" ${form.selected.has(String(friend.id)) ? 'checked' : ''} onchange="liveSplitToggleParticipant('${friend.id}')">
              <span>${escHtml(friend.name)}${suffix}</span>
            </label>`;
          }).join('')}
          ${Number(form.trip_id || 0) > 0 ? '<div style="margin-top:6px;font-size:12px;color:var(--t3)">Only trip members can be part of this split.</div>' : `
            <div style="margin-top:8px;padding:12px;border:1px solid var(--line);border-radius:12px;background:#f8fcfa">
              <div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:6px">Add App User</div>
              <div style="display:flex;gap:8px;align-items:center">
                <input class="fi" id="liveSplitCreateInviteQ" value="${escHtml(state.createInvite.query || '')}" placeholder="Name, username, email, or phone..." style="flex:1;margin-bottom:0" onkeydown="if(event.key==='Enter')liveSplitDoCreateInviteSearch()">
                <button class="btn btn-p btn-sm" style="white-space:nowrap" onclick="liveSplitDoCreateInviteSearch()">Search</button>
              </div>
              <div id="liveSplitCreateInviteResults" style="margin-top:10px;max-height:180px;overflow:auto"></div>
            </div>
          `}
        </div>
        <div class="fa" style="margin-top:14px">
          <button class="btn btn-p" onclick="liveSplitNextStep()">Next</button>
          <button class="btn btn-g" onclick="closeModal()">Cancel</button>
        </div>`);
      if (!(Number(form.trip_id || 0) > 0)) renderCreateInviteResults();
      return;
    }

    openModal('Live Split - Add Expense', `
      <div class="fg">
        <label class="fl">Date<input class="fi" type="date" value="${escHtml(form.date)}" onchange="liveSplitSetDate(this.value)"></label>
        <label class="fl">Amount<input class="fi" type="number" step="0.01" value="${escHtml(form.amount)}" placeholder="0.00" onchange="liveSplitSetAmount(this.value)"></label>
        <label class="fl full">Item Details<input class="fi" value="${escHtml(form.details)}" placeholder="Dinner, groceries..." onchange="liveSplitSetDetails(this.value)"></label>
        <label class="fl">Paid By<select class="fi" onchange="liveSplitSetPaidBy(this.value)">${payerOptions}</select></label>
      </div>
      ${Number(form.trip_id || 0) > 0 ? `<div style="margin-top:8px;font-size:12px;color:var(--t2);font-weight:700">Trip: ${escHtml(getTripById(form.trip_id)?.name || `#${Number(form.trip_id)}`)}</div>` : ''}
      <div style="margin-top:10px">
        <div style="font-size:12px;color:var(--t2);font-weight:700;margin-bottom:6px">
          Participants ${Number(form.trip_id || 0) > 0 ? '(Trip members)' : ''}
        </div>
        <div style="display:grid;gap:6px;max-height:160px;overflow:auto;padding-right:2px;border:1px solid var(--line);border-radius:10px;padding:8px;background:#fff">
          <label class="fc">
            <input type="checkbox" ${form.selected.has('self') ? 'checked' : ''} onchange="liveSplitToggleParticipant('self')">
            <span>You</span>
          </label>
          ${stepTwoSelectableFriends.map((friend) => `
            <label class="fc">
              <input type="checkbox" ${form.selected.has(String(friend.id)) ? 'checked' : ''} onchange="liveSplitToggleParticipant('${friend.id}')">
              <span>${escHtml(String(friend.name || 'Friend').trim())}${Number(friend?.linked_user_id) > 0 ? ' <span style="color:var(--t3);font-size:11px">(app user)</span>' : ''}</span>
            </label>
          `).join('')}
          ${!stepTwoSelectableFriends.length ? '<div style="font-size:12px;color:var(--t3)">No selectable members.</div>' : ''}
        </div>
        ${Number(form.trip_id || 0) > 0 ? '<div style="margin-top:6px;font-size:12px;color:var(--t3)">Only trip members can be participants. Payer can be you or any trip member.</div>' : ''}
      </div>
      <div style="margin-top:10px">
        <div style="font-size:12px;color:var(--t2);font-weight:700;margin-bottom:6px">Split Mode</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          ${MODES.map((mode) => `<button class="chip ${form.splitMode === mode.key ? 'active' : ''}" onclick="liveSplitSetMode('${mode.key}')">${escHtml(mode.label)}</button>`).join('')}
        </div>
        ${renderSplitInputRows(form, people)}
        <div id="lsSplitProgress" style="margin-top:8px;font-size:12px;color:var(--t2)">
          ${progress
            ? (progress.unit === 'amount'
              ? `${escHtml(progress.label)}: ${fmtCur(progress.entered)} / ${fmtCur(progress.target)} \u00b7 Remaining: ${fmtCur(progress.remaining)}`
              : progress.unit === '%'
                ? `${escHtml(progress.label)}: ${progress.entered.toFixed(2)}% / 100% \u00b7 Remaining: ${progress.remaining.toFixed(2)}%`
                : progress.unit === 'parts'
                  ? `${escHtml(progress.label)}: ${progress.entered.toFixed(2)}`
                  : `${escHtml(progress.label)}: ${progress.entered.toFixed(4)} / 1.0000 \u00b7 Remaining: ${progress.remaining.toFixed(4)}`)
            : ''}
        </div>
      </div>
      <div id="lsSplitPreview" style="margin-top:10px;padding:10px;border-radius:10px;background:var(--green-l2)">
        <div style="font-size:11px;color:var(--t3);text-transform:uppercase;font-weight:700">${preview.valid ? 'Split Preview' : 'Fix Split Values'}</div>
        <div style="font-size:13px;color:${preview.valid ? 'var(--t1)' : 'var(--red)'};margin-top:3px">
          ${preview.valid ? preview.shares.map((share) => `${escHtml(share.name)}: ${fmtCur(share.share)}`).join(' | ') : escHtml(preview.error || 'Enter valid split values')}
        </div>
      </div>
      <div id="lsAddExpenseBlock" style="margin-top:12px">
        ${tripAllowsExpenseOption ? `
        <label class="fc"><input type="checkbox" ${form.addExpense ? 'checked' : ''} ${form.selected.has('self') ? '' : 'disabled'} onchange="liveSplitSetAddExpense(this.checked)"><span style="font-weight:600">Add my share to expenses${form.selected.has('self') ? '' : ' (select You first)'}</span></label>
        ${form.addExpense ? `
          <div style="margin-top:8px">
            <div style="font-size:12px;color:var(--t2);font-weight:700;margin-bottom:6px">Expense Type</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="chip ${form.expense_type !== 'extra' ? 'active' : ''}" onclick="liveSplitSetExpenseType('fair')">Fair / Regular</button>
              <button class="chip ${form.expense_type === 'extra' ? 'active' : ''}" onclick="liveSplitSetExpenseType('extra')">Extra / Non-essential</button>
            </div>
          </div>
          <label class="fl" style="margin-top:8px">Expense Category (optional)
            <input class="fi" value="${escHtml(form.category)}" placeholder="Food, travel..." onchange="liveSplitSetCategory(this.value)">
          </label>
          ${form.paidBy === 'self' ? `
            <div style="margin-top:8px">
              <div style="font-size:12px;color:var(--t2);font-weight:700;margin-bottom:6px">Post Full Amount To (optional)</div>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button class="chip ${form.finance_target === 'none' ? 'active' : ''}" onclick="liveSplitSetFinanceTarget('none')">None</button>
                <button class="chip ${form.finance_target === 'expense' ? 'active' : ''}" onclick="liveSplitSetFinanceTarget('expense')">Expense / Bank</button>
                <button class="chip ${form.finance_target === 'card' ? 'active' : ''}" onclick="liveSplitSetFinanceTarget('card')">Credit Card</button>
              </div>
            </div>
            ${form.finance_target === 'expense' ? `
              <label class="fl" style="margin-top:8px">Deduct From Bank (optional)
                <select class="fi" onchange="liveSplitSetFinanceBank(this.value)">
                  <option value="">Do not deduct</option>
                  ${(state.bankAccounts || []).map((bank) => `<option value="${Number(bank.id)}" ${Number(form.bank_account_id) === Number(bank.id) ? 'selected' : ''}>${escHtml(String(bank.bank_name || 'Bank').trim())}${bank.account_name ? ` - ${escHtml(String(bank.account_name).trim())}` : ''}</option>`).join('')}
                </select>
              </label>
            ` : form.finance_target === 'card' ? `
              <label class="fl" style="margin-top:8px">Credit Card
                <select class="fi" onchange="liveSplitSetFinanceCard(this.value)">
                  <option value="">None</option>
                  ${(state.creditCards || []).map((card) => `<option value="${Number(card.id)}" ${Number(form.card_id) === Number(card.id) ? 'selected' : ''}>${escHtml(String(card.card_name || 'Card').trim())} (${escHtml(String(card.bank_name || 'Bank').trim())} **${escHtml(String(card.last4 || ''))})</option>`).join('')}
                </select>
              </label>
              <label class="fl">Discount % (optional)
                <input class="fi" type="number" step="0.1" min="0" max="100" value="${escHtml(String(form.card_discount_pct ?? 0))}" onchange="liveSplitSetFinanceCardDiscount(this.value)">
              </label>
            ` : ``}
          ` : ''}
        ` : ''}
        ` : (Number(form.trip_id || 0) > 0 ? '<div style="font-size:12px;color:var(--t3)">This trip is set to keep Live Split only, so "Add my share to expenses" is hidden.</div>' : '')}
      </div>
      <div class="fa" style="margin-top:14px">
        <button class="btn btn-g" onclick="liveSplitBackStep()">Back</button>
        <button class="btn btn-p" ${state.saveBusy ? 'disabled' : ''} onclick="liveSplitSave()">${state.saveBusy ? liveSplitBusyLabel('Saving...') : 'Save'}</button>
      </div>`);
  }

  function openTripCreateModal() {
    state.tripCreate = createInitialTripForm();
    renderTripCreateModal();
  }

  function renderTripCreateModal() {
    const form = state.tripCreate;
    if (!form) return;
    const selectableFriends = (state.friends || []);
    openModal('Live Split Trip - New', `
      <div class="fg">
        <label class="fl full">Trip Name
          <input class="fi" value="${escHtml(form.name || '')}" placeholder="Goa 2026, Team Offsite..." onchange="liveSplitTripField('name', this.value)">
        </label>
        <label class="fl">Start Date
          <input class="fi" type="date" value="${escHtml(form.start_date || todayLocalIso())}" onchange="liveSplitTripField('start_date', this.value)">
        </label>
        <label class="fl">End Date (optional)
          <input class="fi" type="date" value="${escHtml(form.end_date || '')}" onchange="liveSplitTripField('end_date', this.value)">
        </label>
      </div>
      <div style="margin-top:10px;padding:12px;border:1px solid var(--line);border-radius:12px;background:#f8fcfa">
        <label class="fc" style="align-items:flex-start">
          <input type="checkbox" ${form.show_add_to_expense_option !== false ? 'checked' : ''} onchange="liveSplitTripToggleExpenseOption(this.checked)">
          <span>
            <span style="display:block;font-weight:700;color:var(--t1)">Show "Add my share to expenses" option</span>
            <span style="display:block;font-size:12px;color:var(--t3);margin-top:4px">Turn this off if this trip should stay only inside Live Split and should not offer posting your own share to Expenses.</span>
          </span>
        </label>
      </div>
      <div style="margin-top:10px">
        <div style="font-size:12px;color:var(--t2);font-weight:700;margin-bottom:6px">Members</div>
        <div style="font-size:12px;color:var(--t3);margin-bottom:8px">Pick from Live Split friends. Linked app users can also see this trip.</div>
        <div style="display:grid;gap:6px;max-height:240px;overflow:auto;padding-right:2px">
          ${selectableFriends.map((friend) => `
            <label class="fc">
              <input type="checkbox" ${form.selected.has(String(friend.id)) ? 'checked' : ''} onchange="liveSplitTripToggleMember('${String(friend.id)}')">
              <span>${escHtml(String(friend.name || 'Friend').trim())}${Number(friend?.linked_user_id) > 0 ? ' <span style="color:var(--t3);font-size:11px">(app user)</span>' : ''}</span>
            </label>
          `).join('')}
        </div>
      </div>
      <div class="fa" style="margin-top:14px">
        <button class="btn btn-g" onclick="closeModal()">Cancel</button>
        <button class="btn btn-p" ${state.tripSaveBusy ? 'disabled' : ''} onclick="liveSplitTripSave()">${state.tripSaveBusy ? liveSplitBusyLabel('Saving...') : 'Create Trip'}</button>
      </div>
    `);
  }

  async function saveLiveSplitTrip() {
    const form = state.tripCreate;
    if (!form) return;
    const name = String(form.name || '').trim();
    if (!name) {
      toast('Trip name is required', 'warning');
      return;
    }
    if (!form.start_date) {
      toast('Start date is required', 'warning');
      return;
    }
    if (form.end_date && form.end_date < form.start_date) {
      toast('End date cannot be before start date', 'warning');
      return;
    }
    const members = [...(form.selected || new Set())]
      .map((id) => state.friends.find((friend) => String(friend.id) === String(id)))
      .filter(Boolean)
      .map((friend) => mapFriendToTripMemberPayload(friend));
    try {
      state.tripSaveBusy = true;
      renderTripCreateModal();
      const result = await api('/api/live-split/trips', {
        method: 'POST',
        body: {
          name,
          start_date: toLocalIsoDate(form.start_date, todayLocalIso()),
          end_date: form.end_date ? toLocalIsoDate(form.end_date) : null,
          show_add_to_expense_option: form.show_add_to_expense_option !== false,
          members,
        },
      });
      if (!result || result.error) throw new Error(result?.error || 'Could not create live split trip');
      state.tripSaveBusy = false;
      state.tripCreate = null;
      closeModal();
      await loadLiveSplit();
      toast('Live split trip created', 'success');
    } catch (error) {
      state.tripSaveBusy = false;
      if (state.tripCreate) renderTripCreateModal();
      toast(error?.message || 'Could not create live split trip', 'error');
    }
  }

  async function openCreateFromTrip(tripId) {
    const id = Number(tripId);
    const trip = (state.liveTrips || []).find((item) => Number(item.id) === id);
    if (!trip) {
      toast('Trip not found', 'warning');
      return;
    }
    await Promise.resolve(ensureFinanceOptionsLoaded()).catch(() => {});
    state.create = createInitialForm();
    state.createInvite = { query: '', results: [], searching: false, searched: false };
    state.create.trip_id = id;
    state.create.addExpense = trip.show_add_to_expense_option !== false;
    (trip.members || []).forEach((member) => {
      const targetUserId = Number(member?.target_user_id || 0);
      if (targetUserId > 0 && Number(window._currentUser?.id || 0) === targetUserId) return;
      let friendId = Number(member?.friend_id || 0);
      if (!(friendId > 0) && targetUserId > 0) {
        const linked = (state.friends || []).find((friend) => Number(friend?.linked_user_id || 0) === targetUserId);
        friendId = Number(linked?.id || 0);
      }
      if (friendId > 0) state.create.selected.add(String(friendId));
    });
    if ([...state.create.selected].some((key) => key !== 'self')) state.create.step = 2;
    renderCreateModal();
  }

  async function updateLiveSplitTripStatus(tripId, status) {
    const id = Number(tripId);
    if (!(id > 0)) return;
    try {
      state.tripActionBusy = id;
      renderMain();
      const result = await api(`/api/live-split/trips/${id}`, {
        method: 'PUT',
        body: { status: String(status || 'active').trim().toLowerCase() },
      });
      if (!result || result.error) throw new Error(result?.error || 'Could not update trip status');
      state.tripActionBusy = false;
      await loadLiveSplit();
    } catch (error) {
      state.tripActionBusy = false;
      renderMain();
      toast(error?.message || 'Could not update trip status', 'error');
    }
  }

  function openTripMembersModal(tripId) {
    const id = Number(tripId);
    const trip = (state.liveTrips || []).find((item) => Number(item.id) === id);
    if (!trip) {
      toast('Trip not found', 'warning');
      return;
    }
    state.tripManage = {
      trip_id: id,
      name: String(trip.name || '').trim(),
      show_add_to_expense_option: trip.show_add_to_expense_option !== false,
      selected: new Set(),
    };
    renderTripMembersModal();
  }

  function renderTripMembersModal() {
    const form = state.tripManage;
    if (!form) return;
    const trip = (state.liveTrips || []).find((item) => Number(item.id) === Number(form.trip_id));
    if (!trip) return;
    const canManage = !!trip.is_owner;
    const existingFriendIds = new Set((trip.members || []).map((member) => Number(member.friend_id || 0)).filter((id) => id > 0));
    const selectableFriends = (state.friends || []).filter((friend) => !existingFriendIds.has(Number(friend.id)));
    openModal(`Trip Members - ${escHtml(trip.name || 'Trip')}`, `
      <div style="display:grid;gap:10px">
        <div style="font-size:12px;color:var(--t3)">${canManage ? 'Manage trip members. Added app users can see this trip in Live Split.' : 'Trip members visible to you.'}</div>
        <label class="fl full" style="margin:0">
          Trip Name
          <input class="fi" value="${escHtml(form.name || '')}" ${canManage ? '' : 'disabled'} placeholder="Trip name" onchange="liveSplitTripManageField('name', this.value)">
        </label>
        <div style="padding:12px;border:1px solid var(--line);border-radius:12px;background:#f8fcfa">
          <label class="fc" style="align-items:flex-start">
            <input type="checkbox" ${form.show_add_to_expense_option !== false ? 'checked' : ''} ${canManage ? '' : 'disabled'} onchange="liveSplitTripToggleExpenseOptionEdit(this.checked)">
            <span>
              <span style="display:block;font-weight:700;color:var(--t1)">Show "Add my share to expenses" option</span>
              <span style="display:block;font-size:12px;color:var(--t3);margin-top:4px">${canManage ? 'Turn this off if this trip should remain only in Live Split and should not offer posting your own share to Expenses.' : 'Trip owner controls whether this trip can post your own share to Expenses.'}</span>
            </span>
          </label>
        </div>
        <div style="font-size:12px;color:var(--t2);font-weight:700">Current Members</div>
        <div style="display:grid;gap:6px;max-height:180px;overflow:auto;padding-right:2px">
          ${(trip.members || []).map((member) => {
            const canRemove = canManage && String(member.permission || '').toLowerCase() !== 'owner';
            return `
              <div class="friend-card" style="cursor:default;padding:8px 10px;border-radius:10px">
                <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">
                  ${_renderAvatar(member.member_name, member.linked_user_avatar_url, 'width:32px;height:32px;border-radius:16px;font-size:13px')}
                  <div class="friend-info">
                    <div class="friend-name" style="font-size:13px">${escHtml(member.member_name || 'Member')}</div>
                    <div style="font-size:11px;color:var(--t3)">${escHtml(String(member.permission || 'edit'))}${Number(member.target_user_id || 0) > 0 ? ' | app user' : ''}</div>
                  </div>
                </div>
                ${canRemove ? `<button class="btn btn-g btn-sm" ${state.tripMemberBusy ? 'disabled' : ''} onclick="liveSplitTripRemoveMember(${Number(trip.id)}, ${Number(member.id)})">Remove</button>` : `<div style="font-size:11px;color:var(--t3)">${escHtml(String(member.permission || 'view'))}</div>`}
              </div>`;
          }).join('')}
        </div>
        ${canManage ? `
          <div style="font-size:12px;color:var(--t2);font-weight:700;margin-top:4px">Add Members</div>
          <div style="display:grid;gap:6px;max-height:200px;overflow:auto;padding-right:2px">
            ${selectableFriends.map((friend) => `
              <label class="fc">
                <input type="checkbox" ${form.selected.has(String(friend.id)) ? 'checked' : ''} onchange="liveSplitTripToggleAdd('${String(friend.id)}')">
                <span>${escHtml(String(friend.name || 'Friend').trim())}${Number(friend?.linked_user_id) > 0 ? ' <span style="color:var(--t3);font-size:11px">(app user)</span>' : ''}</span>
              </label>
            `).join('')}
            ${!selectableFriends.length ? '<div style="font-size:12px;color:var(--t3)">No more friends to add.</div>' : ''}
          </div>
        ` : ''}
      </div>
      <div class="fa" style="margin-top:14px">
        <button class="btn btn-g" onclick="closeModal()">Close</button>
        ${canManage ? `<button class="btn btn-s" ${state.tripMemberBusy ? 'disabled' : ''} onclick="liveSplitTripSaveSettings()">${state.tripMemberBusy ? liveSplitBusyLabel('Saving...') : 'Save Settings'}</button>` : ''}
        ${canManage ? `<button class="btn btn-p" ${state.tripMemberBusy ? 'disabled' : ''} onclick="liveSplitTripAddMembers()">${state.tripMemberBusy ? liveSplitBusyLabel('Saving...') : 'Add Selected'}</button>` : ''}
      </div>
    `);
  }

  async function saveTripManageSettings() {
    const form = state.tripManage;
    if (!form) return;
    const trip = (state.liveTrips || []).find((item) => Number(item.id) === Number(form.trip_id));
    if (!trip) return;
    if (!trip.is_owner) {
      toast('Only trip owner can update trip settings', 'warning');
      return;
    }
    const nextName = String(form.name || '').trim();
    if (!nextName) {
      toast('Trip name is required', 'warning');
      return;
    }
    try {
      state.tripMemberBusy = true;
      renderTripMembersModal();
      const result = await api(`/api/live-split/trips/${Number(trip.id)}`, {
        method: 'PUT',
        body: {
          name: nextName,
          show_add_to_expense_option: form.show_add_to_expense_option !== false,
        },
      });
      if (!result || result.error) throw new Error(result?.error || 'Could not update trip settings');
      state.tripMemberBusy = false;
      await loadLiveSplit();
      state.tripManage = null;
      closeModal();
      toast('Trip settings updated', 'success');
    } catch (error) {
      state.tripMemberBusy = false;
      renderTripMembersModal();
      toast(error?.message || 'Could not update trip settings', 'error');
    }
  }

  async function addTripMembers() {
    const form = state.tripManage;
    if (!form) return;
    const trip = (state.liveTrips || []).find((item) => Number(item.id) === Number(form.trip_id));
    if (!trip) return;
    if (!trip.is_owner) {
      toast('Only trip owner can add members', 'warning');
      return;
    }
    const selectedIds = [...(form.selected || new Set())].map((id) => Number(id)).filter((id) => id > 0);
    if (!selectedIds.length) {
      toast('Select at least one friend', 'warning');
      return;
    }
    const members = selectedIds
      .map((id) => state.friends.find((friend) => Number(friend.id) === id))
      .filter(Boolean)
      .map((friend) => mapFriendToTripMemberPayload(friend));
    try {
      state.tripMemberBusy = true;
      renderTripMembersModal();
      const result = await api(`/api/live-split/trips/${Number(trip.id)}/members`, {
        method: 'POST',
        body: { members },
      });
      if (!result || result.error) throw new Error(result?.error || 'Could not add members');
      state.tripMemberBusy = false;
      await loadLiveSplit();
      state.tripManage = {
        trip_id: Number(trip.id),
        name: String(form.name || trip.name || '').trim(),
        show_add_to_expense_option: form.show_add_to_expense_option !== false,
        selected: new Set(),
      };
      renderTripMembersModal();
      const added = Number(result?.added || 0);
      const attempted = Number(result?.attempted || selectedIds.length);
      const normalized = Number(result?.normalized || 0);
      toast(
        added > 0
          ? `Added ${added} member${added === 1 ? '' : 's'}`
          : `No new members were added (selected: ${attempted}, valid: ${normalized})`,
        added > 0 ? 'success' : 'warning'
      );
    } catch (error) {
      state.tripMemberBusy = false;
      renderTripMembersModal();
      toast(error?.message || 'Could not add members', 'error');
    }
  }

  async function removeTripMember(tripId, memberId) {
    const trip = (state.liveTrips || []).find((item) => Number(item.id) === Number(tripId));
    if (trip && !trip.is_owner) {
      toast('Only trip owner can remove members', 'warning');
      return;
    }
    try {
      state.tripMemberBusy = true;
      renderTripMembersModal();
      const result = await api(`/api/live-split/trips/${Number(tripId)}/members/${Number(memberId)}`, {
        method: 'DELETE',
      });
      if (!result || result.error) throw new Error(result?.error || 'Could not remove member');
      state.tripMemberBusy = false;
      await loadLiveSplit();
      state.tripManage = {
        trip_id: Number(tripId),
        name: String(state.tripManage?.name || trip?.name || '').trim(),
        show_add_to_expense_option: state.tripManage?.show_add_to_expense_option !== false,
        selected: new Set(),
      };
      renderTripMembersModal();
    } catch (error) {
      state.tripMemberBusy = false;
      renderTripMembersModal();
      toast(error?.message || 'Could not remove member', 'error');
    }
  }

  async function saveLiveSplit() {
    const form = state.create;
    const people = peopleForForm(form);
    const payerPeople = payerPeopleForForm(form);
    const preview = computeShares(n(form.amount), form.splitMode, people, form.splitValues);
    if (!preview.valid) {
      toast(preview.error || 'Invalid split values', 'warning');
      return;
    }
    if (!(Number(form.trip_id || 0) > 0) && !friendPeopleCount()) {
      toast('Select at least one friend', 'warning');
      return;
    }
    const payerPerson = payerPeople.find((person) => person.key === form.paidBy);
    if (!payerPerson) {
      toast('Choose who paid', 'warning');
      return;
    }
    if (!String(form.details || '').trim()) {
      toast('Enter item details', 'warning');
      return;
    }

    const total = r2(form.amount);
    const normalizedDate = toLocalIsoDate(form.date, todayLocalIso());
    const shares = preview.shares;
    const selfShare = r2((shares.find((share) => share.key === 'self') || {}).share || 0);
    const payerKey = form.paidBy;
    const splitsPayload = shares.filter((share) => share.key !== 'self').map((share) => ({
      friend_id: Number(share.key),
      friend_name: share.name,
      share_amount: r2(share.share),
    }));

    try {
      state.saveBusy = true;
      renderCreateModal();
      const sessionKey = `live_${Date.now()}`;
      await api('/api/live-split/groups', {
        method: 'POST',
        body: {
          divide_date: normalizedDate,
          details: form.details.trim(),
          paid_by: payerPerson.name,
          total_amount: total,
          split_mode: String(form.splitMode || 'equal'),
          trip_id: Number(form.trip_id || 0) > 0 ? Number(form.trip_id) : null,
          splits: splitsPayload,
          heading: form.details.trim(),
          session_id: sessionKey,
          owner_added_to_expense: !!(form.addExpense && selfShare > 0),
        },
      });

      const linkedFriendIds = splitsPayload
        .map((split) => state.appFriends.find((friend) => Number(friend.id) === Number(split.friend_id)))
        .filter((friend) => friend && Number(friend.linked_user_id) > 0)
        .map((friend) => Number(friend.id));
      if (linkedFriendIds.length) {
        await api('/api/live-split/groups/share-session', {
          method: 'POST',
          body: { session_key: sessionKey, friend_ids: [...new Set(linkedFriendIds)] },
        });
      }

      if (form.addExpense && selfShare > 0) {
        await api('/api/expenses', {
          method: 'POST',
          body: {
            item_name: form.details.trim(),
            category: form.category ? form.category.trim() : null,
            amount: selfShare,
            purchase_date: normalizedDate,
            is_extra: String(form.expense_type || 'fair') === 'extra',
            bank_account_id: null,
          },
        });
      }

      const payerIsSelf = String(form.paidBy || '') === 'self';
      if (payerIsSelf && total > 0) {
        if (form.finance_target === 'card' && Number(form.card_id || 0) > 0) {
          const cardId = Number(form.card_id || 0);
          await api('/api/cc/txns', {
            method: 'POST',
            body: {
              card_id: cardId,
              txn_date: normalizedDate,
              description: form.details.trim(),
              amount: total,
              discount_pct: Number(form.card_discount_pct || 0),
              source: 'live_split',
            },
          });
        } else if (form.bank_account_id) {
          const bankId = Number(form.bank_account_id);
          const bank = (state.bankAccounts || []).find((item) => Number(item.id) === bankId);
          if (bank) {
            const nextBalance = r2(Number(bank.balance || 0) - total);
            await api(`/api/banks/${bankId}/balance`, {
              method: 'PATCH',
              body: { balance: nextBalance >= 0 ? nextBalance : 0 },
            });
          }
        }
      }

      closeModal();
      state.create = null;
      state.saveBusy = false;
      await loadLiveSplit();
      toast('Live split saved', 'success');
    } catch (error) {
      state.saveBusy = false;
      if (state.create) renderCreateModal();
      toast(error?.message || 'Could not save live split', 'error');
    }
  }

  function friendPeopleCount() {
    if (!state.create) return 0;
    return peopleForForm(state.create).filter((person) => person.key !== 'self').length;
  }

  function nextStep() {
    if (!state.create) return;
    if (!(Number(state.create.trip_id || 0) > 0) && !friendPeopleCount()) {
      toast('Select at least one friend to continue', 'warning');
      return;
    }
    state.create.step = 2;
    renderCreateModal();
  }

  function renderInviteResults() {
    const box = document.getElementById('liveSplitInviteResults');
    if (!box) return;
    const q = String(state.invite.query || '').trim();
    if (!q) {
      box.innerHTML = '<div style="font-size:12px;color:var(--t3)">Enter a name, username, email, or phone and tap Search.</div>';
      return;
    }
    if (state.invite.searching) {
      box.innerHTML = '<div style="font-size:12px;color:var(--t3)">Searching...</div>';
      return;
    }
    if (!state.invite.results.length) {
      if (!state.invite.searched) { box.innerHTML = ''; return; }
      const isEmail = q.includes('@');
      const isPhone = /\d{6,}/.test(q.replace(/\D/g, ''));
      const canInvite = isEmail || isPhone;
      box.innerHTML = `<div style="font-size:12px;color:var(--t3);margin-bottom:8px">No app user found for &ldquo;${escHtml(q)}&rdquo;.</div>`
        + (canInvite
          ? `<button class="btn btn-p btn-sm" ${state.requestActionBusy ? 'disabled' : ''} onclick="liveSplitSendInvite()">${state.requestActionBusy ? liveSplitBusyLabel('Sending...') : 'Send Invite'}</button>`
          : '<div style="font-size:12px;color:var(--t3)">To invite someone not on the app, search by their email or phone number.</div>');
      return;
    }
    box.innerHTML = state.invite.results.map((user) => `
      ${(() => {
        const linked = isUserAlreadyLinked(user.id);
        const pending = !linked && isUserPending(user.id);
        const actionHtml = linked
          ? '<div style="font-size:12px;font-weight:700;color:var(--green)">Added</div>'
          : pending
            ? '<div style="font-size:12px;font-weight:700;color:var(--orange)">Pending</div>'
            : `<button class="btn btn-p btn-sm" ${state.requestActionBusy ? 'disabled' : ''} onclick="liveSplitLinkExistingUser(${Number(user.id)})">${state.requestActionBusy ? liveSplitBusyLabel('Sending...') : 'Request'}</button>`;
        return `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)">
        <div>
          <div style="font-size:14px;font-weight:700;color:var(--t1)">${escHtml(user.display_name || user.username || 'User')}</div>
          <div style="font-size:12px;color:var(--t3)">@${escHtml(user.username || '')}${user.email ? ` | ${escHtml(user.email)}` : ''}</div>
        </div>
        ${actionHtml}
      </div>`;
      })()}
    `).join('');
  }

  function renderCreateInviteResults() {
    const box = document.getElementById('liveSplitCreateInviteResults');
    if (!box) return;
    const q = String(state.createInvite.query || '').trim();
    if (!q) {
      box.innerHTML = '<div style="font-size:12px;color:var(--t3)">Enter a name, username, email, or phone and tap Search.</div>';
      return;
    }
    if (state.createInvite.searching) {
      box.innerHTML = '<div style="font-size:12px;color:var(--t3)">Searching...</div>';
      return;
    }
    if (!state.createInvite.results.length) {
      if (!state.createInvite.searched) { box.innerHTML = ''; return; }
      const isEmail = q.includes('@');
      const isPhone = /\d{6,}/.test(q.replace(/\D/g, ''));
      const canInvite = isEmail || isPhone;
      box.innerHTML = `<div style="font-size:12px;color:var(--t3);margin-bottom:8px">No app user found for &ldquo;${escHtml(q)}&rdquo;.</div>`
        + (canInvite
          ? `<button class="btn btn-p btn-sm" ${state.createRequestActionBusy ? 'disabled' : ''} onclick="liveSplitCreateInvite()">${state.createRequestActionBusy ? liveSplitBusyLabel('Sending...') : 'Send Invite'}</button>`
          : '<div style="font-size:12px;color:var(--t3)">To invite someone not on the app, search by their email or phone number.</div>');
      return;
    }
    box.innerHTML = state.createInvite.results.map((user) => `
      ${(() => {
        const linked = isUserAlreadyLinked(user.id);
        const pending = !linked && isUserPending(user.id);
        const actionHtml = linked
          ? '<div style="font-size:12px;font-weight:700;color:var(--green)">Added</div>'
          : pending
            ? '<div style="font-size:12px;font-weight:700;color:var(--orange)">Pending</div>'
            : `<button class="btn btn-p btn-sm" ${state.createRequestActionBusy ? 'disabled' : ''} onclick="liveSplitCreateLinkExistingUser(${Number(user.id)})">${state.createRequestActionBusy ? liveSplitBusyLabel('Sending...') : 'Request'}</button>`;
        return `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)">
        <div>
          <div style="font-size:14px;font-weight:700;color:var(--t1)">${escHtml(user.display_name || user.username || 'User')}</div>
          <div style="font-size:12px;color:var(--t3)">@${escHtml(user.username || '')}${user.email ? ` | ${escHtml(user.email)}` : ''}</div>
        </div>
        ${actionHtml}
      </div>`;
      })()}
    `).join('');
  }

  async function openInviteModal() {
    state.invite = { query: '', results: [], searching: false, searched: false };
    openModal('Invite To Live Split', `
      <div style="display:grid;gap:14px">
        <div style="padding:12px;border:1px solid var(--line);border-radius:12px;background:#f8fcfa">
          <div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:6px">Add App User</div>
          <div style="display:flex;gap:8px;align-items:center">
            <input class="fi" id="liveSplitInviteQ" placeholder="Name, username, email, or phone..." style="flex:1;margin-bottom:0" onkeydown="if(event.key==='Enter')liveSplitDoInviteSearch()">
            <button class="btn btn-p btn-sm" style="white-space:nowrap" onclick="liveSplitDoInviteSearch()">Search</button>
          </div>
          <div id="liveSplitInviteResults" style="margin-top:10px;max-height:220px;overflow:auto"></div>
        </div>
        <div class="fa">
          <button class="btn btn-g" onclick="closeModal()">Close</button>
        </div>
      </div>
    `);
    renderInviteResults();
  }

  async function ensureFriendForUser(user) {
    if (isSelfCandidate(user)) throw new Error('You cannot add yourself to Live Split');
    const allFriends = await api('/api/live-split/friends');
    const friends = allFriends?.friends || [];
    const linked = friends.find((friend) => Number(friend.linked_user_id) === Number(user.id));
    if (linked) return linked;

    const safeName = String(user.display_name || user.username || 'Friend').trim();
    let friend = friends.find((item) => String(item.name || '').trim().toLowerCase() === safeName.toLowerCase());
    if (!friend) {
      const created = await api('/api/live-split/friends', { method: 'POST', body: { name: safeName } });
      friend = { id: created?.id, name: safeName };
    }
    await api(`/api/live-split/friends/${friend.id}/link-user`, {
      method: 'PUT',
      body: { linked_user_id: Number(user.id) },
    });
    return friend;
  }

  async function searchInviteUsers(query) {
    state.invite.query = String(query || '').trim();
    if (!state.invite.query) {
      state.invite.results = [];
      state.invite.searching = false;
      state.invite.searched = false;
      renderInviteResults();
      return;
    }
    state.invite.searching = true;
    state.invite.searched = false;
    renderInviteResults();
    try {
      const data = await api(`/api/users/search?q=${encodeURIComponent(state.invite.query)}`);
      state.invite.results = (data?.users || []).filter((item) => !isSelfCandidate(item)).slice(0, 20);
    } catch (_) {
      state.invite.results = [];
    } finally {
      state.invite.searching = false;
      state.invite.searched = true;
      renderInviteResults();
    }
  }

  async function searchCreateInviteUsers(query) {
    state.createInvite.query = String(query || '').trim();
    if (!state.createInvite.query) {
      state.createInvite.results = [];
      state.createInvite.searching = false;
      state.createInvite.searched = false;
      renderCreateInviteResults();
      return;
    }
    state.createInvite.searching = true;
    state.createInvite.searched = false;
    renderCreateInviteResults();
    try {
      const data = await api(`/api/users/search?q=${encodeURIComponent(state.createInvite.query)}`);
      state.createInvite.results = (data?.users || []).filter((item) => !isSelfCandidate(item)).slice(0, 20);
    } catch (_) {
      state.createInvite.results = [];
    } finally {
      state.createInvite.searching = false;
      state.createInvite.searched = true;
      renderCreateInviteResults();
    }
  }

  async function linkExistingUser(userId) {
    const user = (state.invite.results || []).find((item) => Number(item.id) === Number(userId));
    if (!user) {
      toast('User not found in search list', 'warning');
      return;
    }
    if (isSelfCandidate(user)) {
      toast('You cannot add yourself to Live Split', 'warning');
      return;
    }
    if (isUserAlreadyLinked(user.id)) {
      toast('Already in your Live Split list', 'success');
      return;
    }
    if (isUserPending(user.id)) {
      toast('Request already sent', 'warning');
      return;
    }
    try {
      state.requestActionBusy = true;
      renderInviteResults();
      const result = await api('/api/live-split/invite-user', {
        method: 'POST',
        body: { target_user_id: Number(user.id) },
      });
      if (!result?.success) throw new Error(result?.error || 'Could not send request');
      closeModal();
      await loadLiveSplit();
      toast(result?.message || 'Request sent', 'success');
    } catch (error) {
      toast(error?.message || 'Could not link user', 'error');
    } finally {
      state.requestActionBusy = false;
      renderInviteResults();
    }
  }

  async function sendInvite() {
    const raw = String(document.getElementById('liveSplitInviteQ')?.value || state.invite.query || '').trim();
    if (!raw) {
      toast('Enter name, email, or phone', 'warning');
      return;
    }
    const contact = raw;
    const isEmail = contact.includes('@');
    const isPhone = /\d{6,}/.test(contact.replace(/\D/g, ''));
    if (!isEmail && !isPhone) {
      toast('For invite, enter email or phone in the same box', 'warning');
      return;
    }
    const name = isEmail ? contact.split('@')[0] : 'Friend';
    try {
      state.requestActionBusy = true;
      if (document.getElementById('liveSplitInviteResults')) renderInviteResults();
      const result = await api('/api/live-split/invite', {
        method: 'POST',
        body: { target: contact, fallback_name: name },
      });
      if (!result?.success) throw new Error(result?.error || 'Could not send invite');
      closeModal();
      await loadLiveSplit();
      toast(result?.message || 'Invite processed', 'success');
    } catch (error) {
      toast(error?.message || 'Could not send invite', 'error');
    } finally {
      state.requestActionBusy = false;
      if (document.getElementById('liveSplitInviteResults')) renderInviteResults();
    }
  }

  async function addFriendFromDetails(encodedName) {
    const name = decodeURIComponent(String(encodedName || '')).trim();
    if (!name || name.toLowerCase() === 'you') return;
    const exists = (state.friends || []).some((friend) => String(friend?.name || '').trim().toLowerCase() === name.toLowerCase());
    if (exists) {
      toast('Already in your Live Split list', 'success');
      return;
    }
    try {
      state.createRequestActionBusy = true;
      renderCreateInviteResults();
      const data = await api(`/api/users/search?q=${encodeURIComponent(name)}`);
      const users = (data?.users || []).filter((user) => !isSelfCandidate(user));
      const exact = users.filter((user) => {
        const displayName = String(user.display_name || '').trim().toLowerCase();
        const username = String(user.username || '').trim().toLowerCase();
        return displayName === name.toLowerCase() || username === name.toLowerCase();
      });

      if (exact.length === 1) {
        const user = exact[0];
        if (isUserAlreadyLinked(user.id)) {
          toast('Already in your Live Split list', 'success');
          return;
        }
        if (isUserPending(user.id)) {
          toast('Request already sent', 'warning');
          return;
        }
        const result = await api('/api/live-split/invite-user', {
          method: 'POST',
          body: { target_user_id: Number(user.id) },
        });
        if (!result?.success) throw new Error(result?.error || 'Could not send request');
        await fetchData();
        renderMain();
        toast(result?.message || 'Request sent', 'success');
        return;
      }

      const result = await api('/api/live-split/friends', { method: 'POST', body: { name } });
      if (!result?.success && !result?.id) throw new Error(result?.error || 'Could not add friend');
      await fetchData();
      renderMain();
      toast('Added to your Live Split list', 'success');
    } catch (error) {
      toast(error?.message || 'Could not add friend', 'error');
    } finally {
      state.createRequestActionBusy = false;
      if (document.getElementById('liveSplitCreateInviteResults')) renderCreateInviteResults();
    }
  }

  async function acceptIncomingInvite(id) {
    const inviteId = Number(id);
    const invite = (state.incomingInvites || []).find((item) => Number(item.id) === inviteId);
    const inviteKey = liveSplitInviteIdentity(invite || { id: inviteId });
    try {
      state.inviteActionBusy.add(inviteId);
      renderMain();
      const result = await api(`/api/live-split/invites/${inviteId}/accept`, { method: 'POST' });
      if (!result?.success) throw new Error(result?.error || 'Could not accept request');
      hideIncomingInviteKeyTemporarily(inviteKey);
      state.incomingInvites = dedupeIncomingInvites((state.incomingInvites || []).filter((item) => liveSplitInviteIdentity(item) !== inviteKey));
      mergeAcceptedLiveSplitFriend(result, invite);
      renderMain();
      await fetchData();
      renderMain();
      setTimeout(async () => {
        try {
          await fetchData();
          renderMain();
        } catch (_) {}
      }, 500);
      toast('Live Split request accepted', 'success');
    } catch (error) {
      toast(error?.message || 'Could not accept request', 'error');
    } finally {
      state.inviteActionBusy.delete(inviteId);
      renderMain();
    }
  }

  async function rejectIncomingInvite(id) {
    const inviteId = Number(id);
    const invite = (state.incomingInvites || []).find((item) => Number(item.id) === inviteId);
    const inviteKey = liveSplitInviteIdentity(invite || { id: inviteId });
    try {
      state.inviteActionBusy.add(inviteId);
      renderMain();
      const result = await api(`/api/live-split/invites/${inviteId}/reject`, { method: 'POST' });
      if (!result?.success) throw new Error(result?.error || 'Could not reject request');
      hideIncomingInviteKeyTemporarily(inviteKey);
      state.incomingInvites = dedupeIncomingInvites((state.incomingInvites || []).filter((item) => liveSplitInviteIdentity(item) !== inviteKey));
      await fetchData();
      renderMain();
      toast('Live Split request rejected', 'success');
    } catch (error) {
      toast(error?.message || 'Could not reject request', 'error');
    } finally {
      state.inviteActionBusy.delete(inviteId);
      renderMain();
    }
  }

  async function resendPendingInvite(id) {
    try {
      const result = await api(`/api/live-split/invites/${Number(id)}/resend`, { method: 'POST' });
      toast(result?.message || 'Invite sent again', 'success');
      await fetchData();
      renderMain();
    } catch (error) {
      toast(error?.message || 'Could not resend invite', 'error');
    }
  }

  async function cancelPendingInvite(id) {
    const inviteId = Number(id);
    if (!inviteId) return;
    if (!await confirmDialog('Cancel this pending invite?')) return;
    try {
      state.outgoingCancelBusy.add(inviteId);
      renderMain();
      const result = await api(`/api/live-split/invites/${inviteId}/cancel`, { method: 'POST' });
      if (!result?.success) throw new Error(result?.error || 'Could not cancel invite');
      await fetchData();
      renderMain();
      toast('Invite cancelled', 'success');
    } catch (error) {
      toast(error?.message || 'Could not cancel invite', 'error');
    } finally {
      state.outgoingCancelBusy.delete(inviteId);
      renderMain();
    }
  }

  async function deleteLiveSplitFriend(friendId) {
    const id = Number(friendId);
    if (!id) return;
    if (!await confirmDialog('Delete this person from your Live Split list?')) return;
    try {
      state.friendDeleteBusy.add(id);
      renderMain();
      const result = await api(`/api/live-split/friends/${id}`, { method: 'DELETE' });
      if (!result?.success) throw new Error(result?.error || 'Could not delete user');
      closeModal();
      await fetchData();
      renderMain();
      toast('Removed from Live Split list', 'success');
    } catch (error) {
      toast(error?.message || 'Could not delete user', 'error');
    } finally {
      state.friendDeleteBusy.delete(id);
      renderMain();
    }
  }

  async function openEditExpense(groupId) {
    const detail = await api(`/api/live-split/groups/${Number(groupId)}`);
    if (!detail?.group) {
      toast(detail?.error || 'Expense not found', 'error');
      return;
    }
    state.editExpense = createExpenseEditorState(detail.group);
    renderExpenseEditorModal();
  }

  async function reopenExpenseDetails(groupId) {
    const detail = await api(`/api/live-split/groups/${Number(groupId)}`);
    const group = detail?.group;
    if (!group) {
      toast(detail?.error || 'Expense not found', 'error');
      return;
    }
    const row = buildVisibleLiveSplitRows().find((item) => {
      const match = (group.splits || []).some((split) => Number(split.friend_id) === Number(item.friend_id) || String(split.friend_name || '').trim().toLowerCase() === String(item.name || '').trim().toLowerCase());
      return match;
    });
    if (!row) {
      closeModal();
      return;
    }
    const events = buildRowEvents(row);
    const event = events.find((item) => Number(item.group_id) === Number(groupId));
    if (!event) {
      closeModal();
      return;
    }
    state.editExpense = null;
    await openEventDetails(encodeURIComponent(String(row?.key || row?.friend_id || row?.name || '')), event.key);
  }

  async function deleteLiveSplitTrip(tripId) {
    const id = Number(tripId);
    if (!(id > 0)) return;
    if (!await confirmDialog('Delete this trip and all its split entries?')) return;
    try {
      state.tripActionBusy = id;
      renderMain();
      const result = await api(`/api/live-split/trips/${id}`, { method: 'DELETE' });
      if (!result?.success) throw new Error(result?.error || 'Could not delete trip');
      closeModal();
      state.activeTripDetail = null;
      state.tripActionBusy = false;
      await loadLiveSplit();
      toast('Trip deleted', 'success');
    } catch (error) {
      state.tripActionBusy = false;
      renderMain();
      toast(error?.message || 'Could not delete trip', 'error');
    }
  }

  async function saveEditedExpense() {
    const form = state.editExpense;
    if (!form) return;
    if (!String(form.details || '').trim()) {
      toast('Enter expense details', 'warning');
      return;
    }
    if (!(Number(form.total_amount) > 0)) {
      toast('Enter a valid total amount', 'warning');
      return;
    }
    const people = peopleForEditExpense(form);
    const payerPeople = editPayerPeople(form);
    if (!(Number(form.trip_id || 0) > 0) && !people.filter((person) => String(person.key) !== String(form.owner_key || 'owner')).length) {
      toast('At least one participant is required', 'warning');
      return;
    }
    const preview = computeShares(n(form.total_amount), form.splitMode, people, form.splitValues);
    if (!preview.valid) {
      toast(preview.error || 'Invalid split values', 'warning');
      return;
    }
    const payerName = String(form.paid_by || form.original_paid_by || '').trim();
    const matchedPayer = payerPeople.find((person) => String(person.name || '').trim().toLowerCase() === payerName.toLowerCase());
    if (!matchedPayer && !payerName) {
      toast('Choose who paid', 'warning');
      return;
    }
    const payload = {
      divide_date: toLocalIsoDate(form.divide_date, todayLocalIso()),
      details: String(form.details || '').trim(),
      heading: String(form.heading || form.details || '').trim(),
       paid_by: String(matchedPayer?.name || payerName).trim(),
      total_amount: Number(form.total_amount),
      split_mode: String(form.splitMode || 'equal'),
      trip_id: Number(form.trip_id || 0) > 0 ? Number(form.trip_id) : null,
      splits: preview.shares
        .filter((share) => String(share.key) !== String(form.owner_key || 'owner'))
        .map((share) => {
          const source = people.find((person) => String(person.key) === String(share.key));
          const original = (form.splits || []).find((split) => String(split.friend_id) === String(share.key));
          return {
            friend_id: Number(source?.friend_id || original?.friend_id || share.key),
            friend_name: String(source?.name || original?.friend_name || share.name || '').trim(),
            share_amount: r2(share.share),
          };
        }),
    };
    try {
      state.saveBusy = true;
      renderExpenseEditorModal();
      const result = await api(`/api/live-split/groups/${Number(form.id)}`, {
        method: 'PUT',
        body: payload,
      });
      if (!result?.success) throw new Error(result?.error || 'Could not update expense');
      state.editExpense = null;
      state.saveBusy = false;
      await loadLiveSplit();
      await reopenExpenseDetails(form.id);
      toast('Expense updated', 'success');
    } catch (error) {
      state.saveBusy = false;
      if (state.editExpense) renderExpenseEditorModal();
      toast(error?.message || 'Could not update expense', 'error');
    }
  }

  async function deleteLiveSplitExpense(groupId) {
    const id = Number(groupId);
    if (!id) return;
    if (!await confirmDialog('Delete this Live Split expense for everyone in it?')) return;
    try {
      const result = await api(`/api/live-split/groups/${id}`, { method: 'DELETE' });
      if (!result?.success) throw new Error(result?.error || 'Could not delete expense');
      state.editExpense = null;
      closeModal();
      await loadLiveSplit();
      toast('Expense deleted', 'success');
    } catch (error) {
      toast(error?.message || 'Could not delete expense', 'error');
    }
  }

  async function resendPendingInviteByName(encodedName) {
    const name = decodeURIComponent(String(encodedName || '')).trim();
    if (!name) return;
    try {
      const data = await api(`/api/users/search?q=${encodeURIComponent(name)}`);
      const users = (data?.users || []).filter((user) => !isSelfCandidate(user));
      const exact = users.filter((user) => {
        const dn = String(user.display_name || '').trim().toLowerCase();
        const un = String(user.username || '').trim().toLowerCase();
        return dn === name.toLowerCase() || un === name.toLowerCase();
      });
      if (exact.length !== 1) {
        toast('Could not auto-match this pending name. Please use Add Split search and tap Request.', 'warning');
        return;
      }
      const result = await api('/api/live-split/invite-user', {
        method: 'POST',
        body: { target_user_id: Number(exact[0].id) },
      });
      toast(result?.message || 'Request sent', 'success');
      await fetchData();
      renderMain();
    } catch (error) {
      toast(error?.message || 'Could not resend invite', 'error');
    }
  }

  async function linkCreateExistingUser(userId) {
    const user = (state.createInvite.results || []).find((item) => Number(item.id) === Number(userId));
    if (!user) {
      toast('User not found in search list', 'warning');
      return;
    }
    if (isSelfCandidate(user)) {
      toast('You cannot add yourself to Live Split', 'warning');
      return;
    }
    if (isUserAlreadyLinked(user.id)) {
      toast('Already in your Live Split list', 'success');
      return;
    }
    if (isUserPending(user.id)) {
      toast('Request already sent', 'warning');
      return;
    }
    try {
      state.createRequestActionBusy = true;
      renderCreateInviteResults();
      const result = await api('/api/live-split/invite-user', {
        method: 'POST',
        body: { target_user_id: Number(user.id) },
      });
      if (!result?.success) throw new Error(result?.error || 'Could not send request');
      await fetchData();
      renderMain();
      const pendingFriend = (state.friends || []).find((friend) => String(friend?.name || '').trim().toLowerCase() === String(user.display_name || user.username || '').trim().toLowerCase());
      if (pendingFriend?.id && state.create) state.create.selected.add(String(pendingFriend.id));
      state.createInvite.query = '';
      state.createInvite.results = [];
      state.createInvite.searching = false;
      state.createInvite.searched = false;
      renderCreateModal();
      toast(result?.message || 'Request sent', 'success');
    } catch (error) {
      toast(error?.message || 'Could not link user', 'error');
    } finally {
      state.createRequestActionBusy = false;
      if (document.getElementById('liveSplitCreateInviteResults')) renderCreateInviteResults();
    }
  }

  async function sendCreateInvite() {
    const raw = String(document.getElementById('liveSplitCreateInviteQ')?.value || state.createInvite.query || '').trim();
    if (!raw) {
      toast('Enter name, email, or phone', 'warning');
      return;
    }
    const isEmail = raw.includes('@');
    const isPhone = /\d{6,}/.test(raw.replace(/\D/g, ''));
    if (!isEmail && !isPhone) {
      toast('For invite, enter email or phone in the same box', 'warning');
      return;
    }
    try {
      state.createRequestActionBusy = true;
      if (document.getElementById('liveSplitCreateInviteResults')) renderCreateInviteResults();
      const result = await api('/api/live-split/invite', {
        method: 'POST',
        body: { target: raw, fallback_name: (isEmail ? raw.split('@')[0] : 'Friend') },
      });
      if (!result?.success) throw new Error(result?.error || 'Could not send invite');
      await fetchData();
      renderMain();
      if (result?.mode === 'linked_existing') {
        const linkedUserId = Number(result?.friend?.linked_user_id || 0);
        const linked = (state.appFriends || []).find((friend) => Number(friend.linked_user_id) === linkedUserId);
        if (linked?.id && state.create) state.create.selected.add(String(linked.id));
      } else {
        const fallbackName = String(isEmail ? raw.split('@')[0] : 'Friend').trim().toLowerCase();
        const pendingFriend = (state.friends || []).find((friend) => String(friend?.name || '').trim().toLowerCase() === fallbackName);
        if (pendingFriend?.id && state.create) state.create.selected.add(String(pendingFriend.id));
      }
      state.createInvite.query = '';
      state.createInvite.results = [];
      state.createInvite.searching = false;
      renderCreateModal();
      toast(result?.message || 'Invite processed', 'success');
    } catch (error) {
      toast(error?.message || 'Could not send invite', 'error');
    } finally {
      state.createRequestActionBusy = false;
      if (document.getElementById('liveSplitCreateInviteResults')) renderCreateInviteResults();
    }
  }

  window.loadLiveSplit = loadLiveSplit;
  window.liveSplitOpenCreate = function liveSplitOpenCreate() {
    Promise.resolve(ensureFinanceOptionsLoaded()).catch(() => {}).finally(() => {
      state.create = createInitialForm();
      state.createInvite = { query: '', results: [], searching: false, searched: false };
      renderCreateModal();
    });
  };
  window.liveSplitOpenTripCreate = openTripCreateModal;
  window.liveSplitTripField = function liveSplitTripField(field, value) {
    if (!state.tripCreate) return;
    state.tripCreate[field] = value || '';
  };
  window.liveSplitTripToggleExpenseOption = function liveSplitTripToggleExpenseOption(checked) {
    if (!state.tripCreate) return;
    state.tripCreate.show_add_to_expense_option = !!checked;
    renderTripCreateModal();
  };
  window.liveSplitTripToggleMember = function liveSplitTripToggleMember(friendId) {
    if (!state.tripCreate) return;
    const key = String(friendId || '');
    if (state.tripCreate.selected.has(key)) state.tripCreate.selected.delete(key);
    else state.tripCreate.selected.add(key);
    renderTripCreateModal();
  };
  window.liveSplitTripSave = saveLiveSplitTrip;
  window.liveSplitOpenTripDetails = openTripDetails;
  window.liveSplitOpenTripEvent = openTripEventDetails;
  window.liveSplitUseTrip = openCreateFromTrip;
  window.liveSplitToggleTripStatus = updateLiveSplitTripStatus;
  window.liveSplitDeleteTrip = deleteLiveSplitTrip;
  window.liveSplitManageTripMembers = openTripMembersModal;
  window.liveSplitTripToggleAdd = function liveSplitTripToggleAdd(friendId) {
    if (!state.tripManage) return;
    const key = String(friendId || '');
    if (state.tripManage.selected.has(key)) state.tripManage.selected.delete(key);
    else state.tripManage.selected.add(key);
    renderTripMembersModal();
  };
  window.liveSplitTripManageField = function liveSplitTripManageField(field, value) {
    if (!state.tripManage) return;
    state.tripManage[field] = value || '';
  };
  window.liveSplitTripToggleExpenseOptionEdit = function liveSplitTripToggleExpenseOptionEdit(checked) {
    if (!state.tripManage) return;
    state.tripManage.show_add_to_expense_option = !!checked;
    renderTripMembersModal();
  };
  window.liveSplitTripSaveSettings = saveTripManageSettings;
  window.liveSplitTripAddMembers = addTripMembers;
  window.liveSplitTripRemoveMember = removeTripMember;
  window.liveSplitOpenInviteModal = openInviteModal;
  window.liveSplitInviteSearch = searchInviteUsers;
  window.liveSplitDoInviteSearch = function liveSplitDoInviteSearch() {
    const q = String(document.getElementById('liveSplitInviteQ')?.value || '').trim();
    if (q) searchInviteUsers(q);
  };
  window.liveSplitLinkExistingUser = linkExistingUser;
  window.liveSplitSendInvite = sendInvite;
  window.liveSplitCreateInviteSearch = searchCreateInviteUsers;
  window.liveSplitDoCreateInviteSearch = function liveSplitDoCreateInviteSearch() {
    const q = String(document.getElementById('liveSplitCreateInviteQ')?.value || '').trim();
    if (q) searchCreateInviteUsers(q);
  };
  window.liveSplitCreateLinkExistingUser = linkCreateExistingUser;
  window.liveSplitCreateInvite = sendCreateInvite;
  window.liveSplitToggleParticipant = toggleParticipant;
  window.liveSplitNextStep = nextStep;
  window.liveSplitBackStep = function liveSplitBackStep() {
    if (!state.create) return;
    state.create.step = 1;
    renderCreateModal();
  };
  window.liveSplitSetMode = setSplitMode;
  window.liveSplitSetDate = function liveSplitSetDate(value) {
    if (!state.create) return;
    state.create.date = toLocalIsoDate(value, state.create.date || todayLocalIso());
  };
  window.liveSplitSetAmount = function liveSplitSetAmount(value) {
    if (!state.create) return;
    state.create.amount = value;
    state.create.splitValues = autoFillValues(state.create.splitMode, peopleForForm(state.create), n(value));
    renderCreateModal();
  };
  window.liveSplitSetDetails = function liveSplitSetDetails(value) { if (state.create) state.create.details = value || ''; };
  window.liveSplitSetPaidBy = function liveSplitSetPaidBy(value) {
    if (!state.create) return;
    state.create.paidBy = String(value || 'self');
    if (state.create.paidBy !== 'self') {
      state.create.finance_target = 'none';
    }
    renderCreateModal();
  };
  window.liveSplitSetValue = function liveSplitSetValue(key, value) {
    if (!state.create) return;
    state.create.splitValues[String(key)] = value;
    refreshSplitStatus(state.create, peopleForForm(state.create));
  };
  window.liveSplitSetAddExpense = function liveSplitSetAddExpense(checked) {
    if (!state.create) return;
    if (Number(state.create.trip_id || 0) > 0 && !tripAllowsOwnerExpenseOption(state.create.trip_id)) {
      state.create.addExpense = false;
      renderCreateModal();
      return;
    }
    state.create.addExpense = !!checked;
    renderCreateModal();
  };
  window.liveSplitSetExpenseType = function liveSplitSetExpenseType(value) {
    if (!state.create) return;
    state.create.expense_type = value === 'extra' ? 'extra' : 'fair';
    renderCreateModal();
  };
  window.liveSplitSetCategory = function liveSplitSetCategory(value) { if (state.create) state.create.category = value || ''; };
  window.liveSplitSetFinanceTarget = function liveSplitSetFinanceTarget(value) {
    if (!state.create) return;
    state.create.finance_target = value === 'card' ? 'card' : value === 'expense' ? 'expense' : 'none';
    renderCreateModal();
  };
  window.liveSplitSetFinanceBank = function liveSplitSetFinanceBank(value) {
    if (!state.create) return;
    state.create.bank_account_id = value ? Number(value) : null;
  };
  window.liveSplitSetFinanceCard = function liveSplitSetFinanceCard(value) {
    if (!state.create) return;
    state.create.card_id = value ? Number(value) : null;
  };
  window.liveSplitSetFinanceCardDiscount = function liveSplitSetFinanceCardDiscount(value) {
    if (!state.create) return;
    state.create.card_discount_pct = Number(value || 0);
  };
  window.liveSplitSave = saveLiveSplit;
  window.liveSplitSetSort = function liveSplitSetSort(sort) {
    state.sort = sort;
    renderMain();
  };
  window.liveSplitSetFriendFilter = function liveSplitSetFriendFilter(filterKey) {
    state.friendFilter = filterKey === 'hide_settled' ? 'hide_settled' : 'all';
    renderMain();
  };
  window.liveSplitOpenPendingInvites = openPendingInvitesModal;
  window.liveSplitAcceptInvite = acceptIncomingInvite;
  window.liveSplitRejectInvite = rejectIncomingInvite;
  window.liveSplitCancelInvite = cancelPendingInvite;
  window.liveSplitResendInvite = resendPendingInvite;
  window.liveSplitResendInviteByName = resendPendingInviteByName;
  window.liveSplitAddFriendFromDetails = addFriendFromDetails;
  window.refreshActiveLiveSplitModal = refreshActiveLiveSplitModal;
  window.liveSplitAddToExpense = function liveSplitAddToExpense(amount, details, date, buttonId, groupId) {
    const resolvedAmount = Number(amount || 0);
    if (!(resolvedAmount > 0)) {
      toast('No share amount found for this split', 'error');
      return;
    }
    openModal('Add To Expenses', `
      <div style="display:grid;gap:12px">
        <div style="font-size:13px;color:var(--t2)">Choose how to record <b style="color:var(--t1)">${fmtCur(resolvedAmount)}</b> for <b style="color:var(--t1)">${escHtml(String(details || 'Shared split').trim() || 'Shared split')}</b>.</div>
        <div style="display:grid;gap:8px">
          <button class="btn btn-p" onclick="liveSplitConfirmAddToExpense('fair', ${resolvedAmount}, decodeURIComponent('${encodeURIComponent(String(details || ''))}'), '${String(date || '')}', '${String(buttonId || 'lsAddToExpenseBtn')}', ${Number(groupId) || 0})">Fair / Regular</button>
          <button class="btn btn-s" onclick="liveSplitConfirmAddToExpense('extra', ${resolvedAmount}, decodeURIComponent('${encodeURIComponent(String(details || ''))}'), '${String(date || '')}', '${String(buttonId || 'lsAddToExpenseBtn')}', ${Number(groupId) || 0})">Extra / Non-essential</button>
        </div>
        <div class="fa" style="margin-top:2px">
          <button class="btn btn-g" onclick="refreshActiveLiveSplitModal()">Cancel</button>
        </div>
      </div>
    `);
  };
  window.liveSplitAddTripToExpense = function liveSplitAddTripToExpense(tripId, tripName, totalAmount) {
    const resolvedTripId = Number(tripId || 0);
    const resolvedAmount = Number(totalAmount || 0);
    if (!(resolvedTripId > 0) || !(resolvedAmount > 0)) {
      toast('Trip total is not available', 'error');
      return;
    }
    openModal('Add Trip To Expenses', `
      <div style="display:grid;gap:12px">
        <div style="font-size:13px;color:var(--t2)">Add the full trip total <b style="color:var(--t1)">${fmtCur(resolvedAmount)}</b> to Expenses using trip name <b style="color:var(--t1)">${escHtml(String(tripName || 'Trip').trim() || 'Trip')}</b>.</div>
        <div style="display:grid;gap:8px">
          <button class="btn btn-p" onclick="liveSplitConfirmAddTripToExpense('fair', ${resolvedTripId})">Fair / Regular</button>
          <button class="btn btn-s" onclick="liveSplitConfirmAddTripToExpense('extra', ${resolvedTripId})">Extra / Non-essential</button>
        </div>
        <div class="fa" style="margin-top:2px">
          <button class="btn btn-g" onclick="refreshActiveLiveSplitModal()">Cancel</button>
        </div>
      </div>
    `);
  };
  window.liveSplitConfirmAddTripToExpense = async function liveSplitConfirmAddTripToExpense(type, tripId) {
    try {
      const result = await api(`/api/live-split/trips/${Number(tripId)}/add-to-expense`, {
        method: 'POST',
        body: {
          expense_type: String(type || '').toLowerCase() === 'extra' ? 'extra' : 'fair',
        },
      });
      if (!result?.success) throw new Error(result?.error || 'Could not add trip to expenses');
      await loadLiveSplit();
      toast(`Trip total has been added to expenses as ${String(type || '').toLowerCase() === 'extra' ? 'Extra' : 'Fair'}`, 'success');
      await refreshActiveLiveSplitModal();
    } catch (error) {
      toast(error?.message || 'Could not add trip to expenses', 'error');
      await refreshActiveLiveSplitModal();
    }
  };
  window.liveSplitConfirmAddToExpense = async function liveSplitConfirmAddToExpense(type, amount, details, date, buttonId, groupId) {
    const btn = document.getElementById(String(buttonId || 'lsAddToExpenseBtn'));
    const defaultLabel = btn?.dataset?.defaultLabel || '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span style="font-size:11px;line-height:1">...</span>';
    }
    try {
      await api('/api/expenses', {
        method: 'POST',
        body: {
          item_name: String(details || 'Shared split').trim(),
          amount: Number(amount),
          purchase_date: String(date || todayLocalIso()),
          is_extra: String(type || '').toLowerCase() === 'extra',
          bank_account_id: null,
        },
      });
      if (Number(groupId) > 0) {
        await api(`/api/live-split/groups/${Number(groupId)}/expense-status`, {
          method: 'POST',
          body: { added: true },
        });
      }
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="currentColor"/></svg>';
      }
      await loadLiveSplit();
      toast(`Your share has been added to expenses as ${String(type || '').toLowerCase() === 'extra' ? 'Extra' : 'Fair'}`, 'success');
      await refreshActiveLiveSplitModal();
    } catch (error) {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = defaultLabel === 'icon'
          ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14m-7-7h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
          : escHtml(defaultLabel);
      }
      toast(error?.message || 'Could not add to expenses', 'error');
      await refreshActiveLiveSplitModal();
    }
  };
  window.liveSplitEditExpense = openEditExpense;
  window.liveSplitReopenExpenseDetails = reopenExpenseDetails;
  window.liveSplitSaveEditedExpense = saveEditedExpense;
  window.liveSplitDeleteExpense = deleteLiveSplitExpense;
  window.liveSplitEditExpenseField = function liveSplitEditExpenseField(field, value) {
    if (!state.editExpense) return;
    if (field === 'divide_date') {
      state.editExpense.divide_date = toLocalIsoDate(value, state.editExpense.divide_date || todayLocalIso());
    } else {
      state.editExpense[field] = field === 'total_amount' ? value : (value || '');
    }
    if (field === 'total_amount') {
      state.editExpense.splitValues = autoFillValues(
        state.editExpense.splitMode,
        peopleForEditExpense(state.editExpense),
        n(value)
      );
      renderExpenseEditorModal();
    }
    // paid_by and details changes: state-only update, no full re-render to avoid DOM race conditions
  };
  window.liveSplitEditExpenseSplit = function liveSplitEditExpenseSplit(index, value) {
    if (!state.editExpense || !state.editExpense.splits?.[index]) return;
    state.editExpense.splits[index].share_amount = value;
  };
  window.liveSplitEditExpenseMode = function liveSplitEditExpenseMode(mode) {
    if (!state.editExpense) return;
    state.editExpense.splitMode = mode;
    state.editExpense.splitValues = autoFillValues(mode, peopleForEditExpense(state.editExpense), n(state.editExpense.total_amount));
    renderExpenseEditorModal();
  };
  window.liveSplitEditExpenseValue = function liveSplitEditExpenseValue(key, value) {
    if (!state.editExpense) return;
    state.editExpense.splitValues[String(key)] = value;
    refreshSplitStatus(state.editExpense, peopleForEditExpense(state.editExpense));
  };
  window.liveSplitEditExpenseToggleParticipant = function liveSplitEditExpenseToggleParticipant(key) {
    if (!state.editExpense) return;
    const form = state.editExpense;
    const ownerKey = String(form.owner_key || 'owner');
    const nextKey = String(key || '').trim();
    if (!nextKey) return;
    const scopedFriendIds = getTripScopedFriendIds(form.trip_id);
    if (nextKey !== ownerKey && scopedFriendIds && !scopedFriendIds.has(Number(nextKey))) {
      toast('For trip split, participants must be trip members', 'warning');
      return;
    }
    const selected = new Set((form.selected_keys || []).map((item) => String(item)));
    if (selected.has(nextKey)) {
      const nonOwnerCount = [...selected].filter((item) => item !== ownerKey).length;
      if (nextKey !== ownerKey && nonOwnerCount <= 1 && !(Number(form.trip_id || 0) > 0)) {
        toast('At least one participant is required', 'warning');
        return;
      }
      selected.delete(nextKey);
    } else {
      selected.add(nextKey);
    }
    form.selected_keys = [...selected];
    const people = peopleForEditExpense(form);
    const payerPeople = editPayerPeople(form);
    const paidExists = payerPeople.some((person) => String(person.name || '').trim().toLowerCase() === String(form.paid_by || '').trim().toLowerCase());
    if (!paidExists) form.paid_by = payerPeople[0]?.name || '';
    form.splitValues = autoFillValues(form.splitMode, people, n(form.total_amount));
    renderExpenseEditorModal();
  };
  window.liveSplitDeleteFriend = deleteLiveSplitFriend;
  window.liveSplitOpenSettle = openSettleModal;
  window.liveSplitOpenCreateForFriend = openCreateForFriend;
  window.liveSplitCancelSettle = function liveSplitCancelSettle() {
    state.settle = null;
    closeModal();
  };
  window.liveSplitSaveSettle = saveSettleEntry;
  window.liveSplitSettleField = function liveSplitSettleField(field, value) {
    if (!state.settle) return;
    if (field === 'amount') {
      state.settle.amount = value;
      return;
    }
    if (field === 'record_finance') state.settle.record_finance = !!value;
    else if (field === 'bank_account_id' || field === 'card_id') state.settle[field] = value ? Number(value) : null;
    else if (field === 'card_discount_pct') state.settle.card_discount_pct = Number(value || 0);
    else state.settle[field] = value;
    renderSettleModal();
  };
  window.liveSplitOpenDetails = openRowDetails;
  window.liveSplitOpenEvent = openEventDetails;
})();

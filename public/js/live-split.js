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
    friendNudgeBusy: new Set(),
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
    friendFilter: 'hide_settled',
    showCompletedTrips: false,
    tripCreate: null,
    tripManage: null,
    tripBulkEdit: null,
    voiceRecorder: null,
    voiceStream: null,
    voiceChunks: [],
    voiceBusy: false,
    voiceIgnoreNextResult: false,
    voiceMode: 'split',
    tripLedgerCache: {},
  };

  function n(v) {
    const value = Number(v);
    return Number.isFinite(value) ? value : 0;
  }
  function r2(v) { return Math.round(n(v) * 100) / 100; }
  const toJsArg = (value) => JSON.stringify(String(value ?? ''));
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
  function normalizeAvatarUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith('//')) return `${window.location.protocol}${raw}`;
    if (raw.startsWith('/')) return `${window.location.origin}${raw}`;
    return `${window.location.origin}/${raw.replace(/^\/+/, '')}`;
  }
  function _renderAvatar(name, avatarUrl, extraStyle) {
    const initial = escHtml((String(name || '?')[0]).toUpperCase());
    const styleAttr = extraStyle ? ` style="${extraStyle}"` : '';
    const safeAvatarUrl = normalizeAvatarUrl(avatarUrl);
    if (safeAvatarUrl) {
      const fallbackStyle = `display:none${extraStyle ? ';' + extraStyle : ''}`;
      return `<img src="${escHtml(safeAvatarUrl)}" class="avatar" style="object-fit:cover${extraStyle ? ';' + extraStyle : ''}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="avatar" style="${fallbackStyle}">${initial}</div>`;
    }
    return `<div class="avatar"${styleAttr}>${initial}</div>`;
  }
  function renderAvatarPreviewTrigger(name, avatarUrl, extraStyle = '') {
    const safeName = String(name || 'User').trim() || 'User';
    const safeAvatarUrl = normalizeAvatarUrl(avatarUrl);
    if (!safeAvatarUrl) return _renderAvatar(safeName, avatarUrl, extraStyle);
    return `
      <button
        type="button"
        class="live-split-avatar-trigger"
        data-avatar-name="${escHtml(safeName)}"
        data-avatar-url="${escHtml(safeAvatarUrl)}"
        aria-label="View ${escHtml(safeName)} photo"
        title="View photo"
        style="padding:0;border:none;background:transparent;border-radius:999px;display:flex;align-items:center;justify-content:center"
      >
        ${_renderAvatar(safeName, safeAvatarUrl, extraStyle)}
      </button>`;
  }
  function openAvatarPreview(ev, name, avatarUrl) {
    if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
    if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
    if (ev && typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    const safeAvatarUrl = normalizeAvatarUrl(avatarUrl);
    if (!safeAvatarUrl) return false;
    openModal(escHtml(String(name || 'Photo').trim() || 'Photo'), `
      <div style="display:grid;gap:12px">
        <div style="display:flex;justify-content:center">
          <img
            src="${escHtml(safeAvatarUrl)}"
            alt="${escHtml(String(name || 'User photo').trim() || 'User photo')}"
            style="max-width:min(92vw,520px);max-height:70vh;width:auto;height:auto;display:block;border-radius:18px;object-fit:contain;background:#f4f7f5;border:1px solid var(--line)"
          >
        </div>
      </div>
    `);
    return false;
  }
  function bindAvatarPreviewClicks() {
    if (window.__liveSplitAvatarPreviewBound) return;
    window.__liveSplitAvatarPreviewBound = true;
    document.addEventListener('click', (event) => {
      const trigger = event.target instanceof Element ? event.target.closest('.live-split-avatar-trigger') : null;
      if (!trigger) return;
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      openAvatarPreview(
        event,
        trigger.getAttribute('data-avatar-name') || 'Photo',
        trigger.getAttribute('data-avatar-url') || ''
      );
    }, true);
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
    const knownFriendMatch = (state.friends || []).some((friend) => {
      const keys = [
        textKey(friend?.name),
        textKey(friend?.linked_user_display_name),
        textKey(friend?.linked_user_username),
      ].filter(Boolean);
      return keys.includes(payerKey);
    });
    if (knownFriendMatch) return false;
    const hasMatchInParticipants = (splits || []).some((split) => textKey(split?.friend_name) === payerKey);
    // If payer isn't one of split participants, treat it as owner/self alias.
    return !hasMatchInParticipants;
  }

  function participantMatchesViewer(participant, fallbackName = '') {
    if (!participant) return false;
    const meId = Number(window._currentUser?.id || 0);
    const participantLinkedId = Number(participant?.linked_user_id || 0);
    if (meId > 0 && participantLinkedId > 0 && participantLinkedId === meId) return true;
    const viewerKeys = currentUserNameKeys();
    const participantKeys = [participant?.name, fallbackName].map(textKey).filter(Boolean);
    return participantKeys.some((key) => viewerKeys.includes(key));
  }

  function findSharedGroupSelfParticipant(participants, group) {
    const list = Array.isArray(participants) ? participants : [];
    if (!list.length) return null;
    const meId = Number(window._currentUser?.id || 0);
    const ownerUserId = Number(group?.owner_user_id || 0);
    const targetUserId = Number(group?.target_user_id || 0);
    const targetFriendId = Number(group?.friend_id || 0);
    const targetNameNorm = normalizePersonName(group?.friend_name || '');
    if (meId > 0) {
      const byViewerId = list.find((participant) => Number(participant?.linked_user_id || 0) === meId);
      if (byViewerId) return byViewerId;
    }
    if (targetUserId > 0) {
      const byTargetUser = list.find((participant) => Number(participant?.linked_user_id || 0) === targetUserId);
      if (byTargetUser) return byTargetUser;
    }
    if (targetFriendId > 0) {
      const byFriendId = list.find((participant) => Number(participant?.friend_id || 0) === targetFriendId);
      if (byFriendId) return byFriendId;
    }
    if (targetNameNorm) {
      const byName = list.find((participant) => {
        const nameNorm = normalizePersonName(participant?.name || '');
        if (!nameNorm) return false;
        return nameNorm === targetNameNorm
          || (firstNameToken(nameNorm) && firstNameToken(nameNorm) === firstNameToken(targetNameNorm));
      });
      if (byName) return byName;
    }
    if (meId > 0 && ownerUserId > 0 && ownerUserId === meId) {
      const ownerParticipant = list.find((participant) => Number(participant?.linked_user_id || 0) === ownerUserId);
      if (ownerParticipant) return ownerParticipant;
    }
    return list.find((participant) => participantMatchesViewer(participant, group?.friend_name || '')) || null;
  }

  function resolveSharedGroupContext(group) {
    const splits = Array.isArray(group?.splits) ? group.splits : [];
    const total = r2(group?.total_amount);
    const groupMode = String(group?.split_mode || '').trim().toLowerCase();
    const ownerName = String(group?.owner_name || 'Owner').trim() || 'Owner';
    const ownerUserId = Number(group?.owner_user_id || 0);
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
    if (!participants.length) return null;
    const selfParticipant = findSharedGroupSelfParticipant(participants, group);
    if (!selfParticipant) return null;
    const payerRaw = String(group?.paid_by || '').trim();
    const payerName = isYouLabel(payerRaw) ? ownerName : payerRaw;
    const payerNorm = normalizePersonName(payerName);
    const payerParticipant = participants.find((participant) => {
      const nameNorm = normalizePersonName(participant?.name || '');
      if (!nameNorm || !payerNorm) return false;
      return nameNorm === payerNorm
        || (firstNameToken(nameNorm) && firstNameToken(nameNorm) === firstNameToken(payerNorm));
    }) || null;
    return {
      total,
      groupMode,
      ownerName,
      ownerUserId,
      ownerKey: `owner:${ownerUserId || textKey(ownerName)}`,
      participants,
      selfParticipant,
      payerName,
      payerParticipant,
      selfShare: r2(selfParticipant.share),
      selfIsPayer: !!(payerParticipant && payerParticipant.key === selfParticipant.key),
    };
  }

  function sharedParticipantDisplayName(participant, selfParticipant) {
    if (!participant) return '';
    if (selfParticipant && participant.key === selfParticipant.key) return 'You';
    return String(participant?.name || '').trim();
  }

  function canonicalLiveSplitName(value, fallback = '') {
    const raw = String(value || '').trim();
    if (raw) return raw;
    return String(fallback || '').trim();
  }

  function namesMatchLoosely(a, b) {
    const aNorm = normalizePersonName(a || '');
    const bNorm = normalizePersonName(b || '');
    if (!aNorm || !bNorm) return false;
    return aNorm === bNorm
      || (firstNameToken(aNorm) && firstNameToken(aNorm) === firstNameToken(bNorm));
  }

  function canonicalTripPayerName(group) {
    const ownerName = canonicalLiveSplitName(group?.owner_name || group?.owner_username || 'Owner', 'Owner');
    const payerRaw = String(group?.paid_by || '').trim();
    if (isYouLabel(payerRaw)) return ownerName;
    return canonicalLiveSplitName(payerRaw, ownerName);
  }

  function buildCanonicalTripParticipants(group) {
    const splits = Array.isArray(group?.splits) ? group.splits : [];
    const total = r2(group?.total_amount);
    const ownerName = canonicalLiveSplitName(group?.owner_name || group?.owner_username || 'Owner', 'Owner');
    const ownerShareBase = r2(splits.reduce((sum, split) => sum + n(split?.share_amount), 0));
    const ownerShare = String(group?.split_mode || '').trim().toLowerCase() === 'settlement'
      ? (ownerShareBase || total)
      : r2(total - ownerShareBase);
    const payerName = canonicalTripPayerName(group);
    const participants = [
      { name: ownerName, share: ownerShare, paid: namesMatchLoosely(ownerName, payerName) },
      ...splits.map((split) => ({
        name: canonicalLiveSplitName(split?.friend_name),
        share: r2(split?.share_amount),
        paid: namesMatchLoosely(split?.friend_name, payerName),
      })),
    ].filter((participant) => participant.name);
    const payerTracked = participants.some((participant) => participant.paid);
    if (!payerTracked && payerName) {
      participants.push({ name: payerName, share: 0, paid: true, contextOnly: true });
    }
    return participants.filter((participant, index, arr) => (
      arr.findIndex((item) => namesMatchLoosely(item.name, participant.name)) === index
    ));
  }

  function buildCanonicalTripEventsFromLedger(trip = {}) {
    return (Array.isArray(trip?.groups) ? trip.groups : [])
      .map((group) => ({
        key: `trip-ledger-${group?.id || ''}-${group?.divide_date || ''}`,
        group_id: Number(group?.id) || null,
        date: toLocalIsoDate(group?.divide_date),
        details: String(group?.details || group?.heading || 'Split expense').trim(),
        payer: canonicalTripPayerName(group) || '-',
        total: r2(group?.total_amount),
        participants: buildCanonicalTripParticipants(group),
      }))
      .sort((a, b) => {
        const dateCmp = String(b.date || '').localeCompare(String(a.date || ''));
        if (dateCmp !== 0) return dateCmp;
        return Number(b.group_id || 0) - Number(a.group_id || 0);
      });
  }

  function buildCanonicalTripMemberBalances(events = []) {
    const map = new Map();
    (events || []).forEach((event) => {
      (Array.isArray(event?.participants) ? event.participants : []).forEach((participant) => {
        const name = String(participant?.name || '').trim();
        if (!name) return;
        const key = normalizePersonName(name);
        if (!key) return;
        const current = map.get(key) || { name, amount: 0 };
        current.amount = r2(current.amount + (participant?.paid ? n(event?.total) : 0) - n(participant?.share));
        map.set(key, current);
      });
    });
    return [...map.values()]
      .filter((item) => Math.abs(n(item?.amount)) > 0.005)
      .sort((a, b) => Math.abs(n(b?.amount)) - Math.abs(n(a?.amount)));
  }

  async function fetchTripLedger(tripId, force = false) {
    const tid = Number(tripId || 0);
    if (!(tid > 0)) return null;
    if (!force && state.tripLedgerCache[tid]) return state.tripLedgerCache[tid];
    const result = await api(`/api/live-split/trips/${tid}/ledger`);
    if (!result || result.error || !result.trip) {
      throw new Error(result?.error || 'Could not load trip details');
    }
    state.tripLedgerCache[tid] = result.trip;
    return result.trip;
  }

  function resolveTripBulkEditDefaults(trip) {
    const tripGroups = [...(state.groups || [])].filter((group) => Number(group?.trip_id || 0) === Number(trip?.id || 0));
    const latestGroup = [...tripGroups]
      .sort((a, b) => {
        const dateCmp = String(b?.divide_date || '').localeCompare(String(a?.divide_date || ''));
        if (dateCmp !== 0) return dateCmp;
        return Number(b?.id || 0) - Number(a?.id || 0);
      })[0] || null;
    return {
      paid_by: String(latestGroup?.paid_by || 'You').trim() || 'You',
      divide_date: toLocalIsoDate(latestGroup?.divide_date || trip?.latest_divide_date || trip?.start_date, todayLocalIso()),
    };
  }

  function ensureRow(map, name, extra = {}) {
    const key = String(name || '').trim().toLowerCase();
    if (!key) return null;
    if (!map.has(key)) map.set(key, { key, name: String(name || '').trim(), amount: 0, linked_user_id: null, friend_id: null, ...extra });
    const row = map.get(key);
    if (extra.linked_user_id && !row.linked_user_id) row.linked_user_id = extra.linked_user_id;
    if (extra.friend_id && !row.friend_id) row.friend_id = extra.friend_id;
    if (extra.linked_user_avatar_url && !row.linked_user_avatar_url) row.linked_user_avatar_url = extra.linked_user_avatar_url;
    if (extra.linked_user_display_name && !row.linked_user_display_name) row.linked_user_display_name = extra.linked_user_display_name;
    if (extra.linked_user_username && !row.linked_user_username) row.linked_user_username = extra.linked_user_username;
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
    if (extra.linked_user_avatar_url && !row.linked_user_avatar_url) row.linked_user_avatar_url = extra.linked_user_avatar_url;
    if (extra.linked_user_display_name && !row.linked_user_display_name) row.linked_user_display_name = extra.linked_user_display_name;
    if (extra.linked_user_username && !row.linked_user_username) row.linked_user_username = extra.linked_user_username;
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
      const extra = {
        friend_id: Number(friend.id) || null,
        linked_user_id: friend.linked_user_id || null,
        linked_user_avatar_url: friend.linked_user_avatar_url || '',
        linked_user_display_name: friend.linked_user_display_name || '',
        linked_user_username: friend.linked_user_username || '',
      };
      if (linkedUserId > 0) ensureLinkedRow(map, linkedUserId, preferredName, extra);
      else ensureRow(map, friend.name, extra);
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
      let payerHandled = false;

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
          ? ensureLinkedRow(map, normalizedLinkedFriendUserId, preferredLinkedName, {
              friend_id: Number(linkedFriend.id) || null,
              linked_user_avatar_url: linkedFriend?.linked_user_avatar_url || fallbackFriendByUser?.linked_user_avatar_url || '',
              linked_user_display_name: linkedFriend?.linked_user_display_name || fallbackFriendByUser?.linked_user_display_name || '',
              linked_user_username: linkedFriend?.linked_user_username || fallbackFriendByUser?.linked_user_username || '',
            })
          : linkedByUser
            || (fallbackFriendByUser
              ? ensureLinkedRow(map, splitLinkedUserId, preferredLinkedName, {
                  friend_id: Number(fallbackFriendByUser?.id) || null,
                  linked_user_avatar_url: fallbackFriendByUser?.linked_user_avatar_url || '',
                  linked_user_display_name: fallbackFriendByUser?.linked_user_display_name || '',
                  linked_user_username: fallbackFriendByUser?.linked_user_username || '',
                })
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
        if (splitIsPayer) payerHandled = true;
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

      if (!selfIsPayer && selfShare > 0 && payerNameKey && !payerHandled) {
        const payerFriend = allFriends.find((friend) => {
          const keys = [
            textKey(friend?.name),
            textKey(friend?.linked_user_display_name),
            textKey(friend?.linked_user_username),
          ].filter(Boolean);
          return keys.includes(payerNameKey);
        }) || null;
        const payerLinkedId = Number(payerFriend?.linked_user_id || 0);
        const payerPreferredName = String(
          payerFriend?.linked_user_display_name
          || payerFriend?.linked_user_username
          || payerFriend?.name
          || payerName
        ).trim() || payerName;
        const payerRow = payerLinkedId > 0
          ? ensureLinkedRow(map, payerLinkedId, payerPreferredName, {
              friend_id: Number(payerFriend?.id || 0) || null,
              linked_user_avatar_url: payerFriend?.linked_user_avatar_url || '',
              linked_user_display_name: payerFriend?.linked_user_display_name || '',
              linked_user_username: payerFriend?.linked_user_username || '',
            })
          : findExistingLinkedRowByName(map, payerName)
            || ensureRow(map, payerFriend?.name || payerName, {
              friend_id: Number(payerFriend?.id || 0) || null,
            });
        if (payerRow) payerRow.amount = r2(payerRow.amount - selfShare);
      }
    });

    (sharedGroups || []).forEach((group) => {
      const context = resolveSharedGroupContext(group);
      if (!context) return;
      const { groupMode, participants, selfParticipant, payerParticipant, selfShare, selfIsPayer } = context;
      const meId = Number(window._currentUser?.id || 0);

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
          linked_user_avatar_url: linkedFriend?.linked_user_avatar_url || '',
          linked_user_display_name: linkedFriend?.linked_user_display_name || '',
          linked_user_username: linkedFriend?.linked_user_username || '',
        });
        if (!row) return;
        if (isSelfLinkedEntity(row)) return;

        let delta = 0;
        if (groupMode === 'settlement') {
          if (selfIsPayer && selfShare > 0) {
            delta = selfShare;
          } else if (payerParticipant && payerParticipant.key === participant.key && selfShare > 0) {
            delta = r2(0 - selfShare);
          }
        } else if (selfIsPayer) {
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
      const friendMatch = (state.friends || []).find((friend) =>
        (Number(row?.friend_id || 0) > 0 && Number(friend?.id || 0) === Number(row.friend_id))
        || (Number(row?.linked_user_id || 0) > 0 && Number(friend?.linked_user_id || 0) === Number(row.linked_user_id))
      );
      map.set(key, { ...row, can_delete: friendMatch?.can_delete !== false && row?.can_delete !== false, amount: r2(row.amount) });
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
            can_delete: friend?.can_delete !== false,
            linked_user_avatar_url: friend.linked_user_avatar_url || '',
            linked_user_display_name: friend.linked_user_display_name || '',
            linked_user_username: friend.linked_user_username || '',
          });
        }
      });

    return reconcileVisibleLiveSplitRows([...map.values()]);
  }

  function reconcileVisibleLiveSplitRows(rows = []) {
    return (rows || []).map((row) => {
      const computedAmount = r2(buildRowEvents(row).reduce((sum, event) => sum + n(event?.delta), 0));
      if (Math.abs(computedAmount - n(row?.amount)) > 0.004) {
        return { ...row, amount: computedAmount };
      }
      return { ...row, amount: r2(row?.amount) };
    });
  }

  function canDeleteLiveSplitRow(row) {
    return Number(resolveFriendIdForRow(row) || 0) > 0 && row?.can_delete !== false;
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
      voice_preferred_friend_id: null,
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
      voice_only: false,
      voice_drafts: [],
      voice_transcript: '',
    };
  }

  function createInitialTripForm() {
    return {
      name: '',
      start_date: todayLocalIso(),
      end_date: '',
      bulk_date: todayLocalIso(),
      paid_by: 'You',
      show_add_to_expense_option: true,
      selected: new Set(),
      scan_files: [],
      scan_items: [],
      scan_merchant: '',
      scan_total_amount: 0,
      scan_tax_override: '',
      scan_debug: null,
      manual_items: [createTripManualEntry(0)],
      voice_only: false,
      voice_drafts: [],
      voice_transcript: '',
    };
  }

  function normalizeTripReceiptScanDraft(draft, { fallbackDate = todayLocalIso(), defaultAssignment = 'self', pageIndex = 0, selectedFriendIds = [] } = {}) {
    const merchant = String(draft?.merchant || 'Scanned bill').trim() || 'Scanned bill';
    const purchaseDate = toLocalIsoDate(draft?.purchase_date, fallbackDate || todayLocalIso());
    const totalAmount = Number(draft?.total_amount || 0) > 0 ? r2(draft.total_amount) : 0;
    const rows = Array.isArray(draft?.items) ? draft.items : [];
    const defaultParticipantKeys = defaultAssignment === 'shared'
      ? ['self', ...selectedFriendIds.map((id) => String(id))]
      : defaultAssignment.startsWith('friend:')
        ? [String(defaultAssignment.split(':')[1] || '')].filter(Boolean)
        : ['self'];
    return {
      merchant,
      purchase_date: purchaseDate,
      total_amount: totalAmount,
      items: rows.map((item, index) => ({
        key: `trip-scan-${Date.now()}-${pageIndex}-${index}`,
        item_name: String(item?.item_name || '').trim() || `Item ${index + 1}`,
        amount: String(item?.amount ?? '').trim(),
        purchase_date: toLocalIsoDate(item?.purchase_date, purchaseDate),
        category: String(item?.category || '').trim(),
        is_extra: !!item?.is_extra,
        selected: item?.selected !== false,
        assignment: defaultAssignment,
        participant_keys: [...defaultParticipantKeys],
        split_mode: 'equal',
        split_values: {},
      })),
    };
  }

  function buildTripScanMatchKey(item) {
    const name = String(item?.item_name || '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const amount = Number(item?.amount || 0);
    return name && amount > 0 ? `${name}|${amount.toFixed(2)}` : '';
  }

  function createTripManualEntry(index = 0, assignment = 'self', form = state.tripCreate) {
    const participantKeys = normalizeTripManualRowParticipantKeys({ assignment }, form);
    return {
      key: `trip-manual-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
      item_name: '',
      amount: '',
      assignment,
      participant_keys: [...participantKeys],
      split_mode: 'equal',
      split_values: {},
    };
  }

  function getTripAssignmentOptions(form) {
    const selectedFriends = tripCreateSelectedFriends(form);
    return [
      { key: 'self', label: 'Mine' },
      ...(selectedFriends.length ? [{ key: 'shared', label: 'Split' }] : []),
      ...selectedFriends.map((friend) => ({
        key: `friend:${Number(friend.id)}`,
        label: String(friend.name || 'Friend').trim() || 'Friend',
      })),
    ];
  }

  function normalizeTripAssignmentsForSelectedFriends(items, selectedIds) {
    return (items || []).map((item) => {
      const assignment = String(item?.assignment || 'self');
      if (!assignment.startsWith('friend:')) return item;
      const friendIdNum = Number(assignment.split(':')[1] || 0);
      if (selectedIds.has(friendIdNum)) return item;
      return { ...item, assignment: selectedIds.size ? 'shared' : 'self' };
    });
  }

  function getTripScanParticipantOptions(form) {
    return [
      { key: 'self', name: 'You' },
      ...tripCreateSelectedFriends(form).map((friend) => ({
        key: String(friend.id),
        name: String(friend.name || 'Friend').trim() || 'Friend',
      })),
    ];
  }

  function normalizeTripManualRowParticipantKeys(row, form) {
    const availableKeys = getTripScanParticipantOptions(form).map((person) => String(person.key));
    const availableKeySet = new Set(availableKeys);
    const nextKeys = [...new Set((Array.isArray(row?.participant_keys) ? row.participant_keys : []).map((key) => String(key)).filter((key) => availableKeySet.has(key)))];
    const looksUntouchedDefaultRow = nextKeys.length === 1
      && nextKeys[0] === 'self'
      && availableKeys.length > 1
      && !String(row?.item_name || '').trim()
      && !(n(row?.amount) > 0)
      && !(row?.split_values && Object.keys(row.split_values).length);
    if (looksUntouchedDefaultRow) return [...availableKeys];
    if (nextKeys.length) return nextKeys;
    const assignment = String(row?.assignment || 'self');
    if (assignment === 'shared') return [...availableKeys];
    if (assignment.startsWith('friend:')) {
      const friendKey = String(assignment.split(':')[1] || '');
      return availableKeySet.has(friendKey) ? [friendKey] : ['self'];
    }
    return availableKeys.length ? [...availableKeys] : ['self'];
  }

  function normalizeTripScanRowParticipantKeys(row, form) {
    const availableKeys = new Set(getTripScanParticipantOptions(form).map((person) => String(person.key)));
    const nextKeys = [...new Set((Array.isArray(row?.participant_keys) ? row.participant_keys : []).map((key) => String(key)).filter((key) => availableKeys.has(key)))];
    if (nextKeys.length) return nextKeys;
    const assignment = String(row?.assignment || 'self');
    if (assignment === 'shared') return [...availableKeys];
    if (assignment.startsWith('friend:')) {
      const friendKey = String(assignment.split(':')[1] || '');
      return availableKeys.has(friendKey) ? [friendKey] : ['self'];
    }
    return ['self'];
  }

  function getTripScanSubtotalAll(form) {
    return r2((form?.scan_items || []).reduce((sum, item) => sum + n(item?.amount), 0));
  }

  function getTripScanReceiptTax(form) {
    if (form && form.scan_tax_override !== '' && form.scan_tax_override !== null && form.scan_tax_override !== undefined) {
      return Math.max(0, r2(Number(form.scan_tax_override || 0)));
    }
    const totalAmount = r2(Number(form?.scan_total_amount || 0));
    const subtotal = getTripScanSubtotalAll(form);
    const diff = r2(totalAmount - subtotal);
    return diff > 0 ? diff : 0;
  }

  function getTripScanReceiptTaxPct(form) {
    const subtotal = getTripScanSubtotalAll(form);
    const tax = getTripScanReceiptTax(form);
    return subtotal > 0 && tax > 0 ? (tax / subtotal) : 0;
  }

  function getTripScanSelectedTaxMap(form) {
    const selectedRows = (form?.scan_items || []).filter((item) => item?.selected !== false);
    const tax = getTripScanReceiptTax(form);
    const allSubtotal = getTripScanSubtotalAll(form);
    const selectedSubtotal = r2(selectedRows.reduce((sum, item) => sum + n(item?.amount), 0));
    const allocation = {};
    if (!(tax > 0) || !(selectedSubtotal > 0)) return allocation;
    const targetTax = r2((selectedSubtotal / allSubtotal) * tax);
    let used = 0;
    selectedRows.forEach((item, index) => {
      const rowAmount = n(item?.amount);
      const share = index === selectedRows.length - 1
        ? r2(targetTax - used)
        : r2((rowAmount / selectedSubtotal) * targetTax);
      used = r2(used + share);
      allocation[String(item.key || '')] = share;
    });
    return allocation;
  }

  function getTripScanRowTaxShare(form, row) {
    const allocation = getTripScanSelectedTaxMap(form);
    return r2(allocation[String(row?.key || '')] || 0);
  }

  function getTripScanRowEffectiveAmount(form, row) {
    return r2(n(row?.amount) + getTripScanRowTaxShare(form, row));
  }

  function normalizeTripScanRowSplitState(row, form) {
    const participantKeys = normalizeTripScanRowParticipantKeys(row, form);
    row.participant_keys = participantKeys;
    const mode = ['equal', 'percent', 'fraction', 'amount', 'parts'].includes(String(row?.split_mode || '').toLowerCase())
      ? String(row.split_mode).toLowerCase()
      : 'equal';
    row.split_mode = mode;
    const people = getTripScanParticipantOptions(form).filter((person) => participantKeys.includes(String(person.key)));
    const currentValues = row.split_values && typeof row.split_values === 'object' ? row.split_values : {};
    const nextValues = {};
    people.forEach((person) => {
      if (currentValues[person.key] !== undefined && currentValues[person.key] !== null && currentValues[person.key] !== '') {
        nextValues[person.key] = currentValues[person.key];
      }
    });
    const hasAllValues = people.length && people.every((person) => nextValues[person.key] !== undefined && nextValues[person.key] !== null && nextValues[person.key] !== '');
    row.split_values = hasAllValues ? nextValues : autoFillValues(mode, people, getTripScanRowEffectiveAmount(form, row));
    return row;
  }

  function getTripScanRowPeople(row, form) {
    const participantKeys = normalizeTripScanRowParticipantKeys(row, form);
    return getTripScanParticipantOptions(form).filter((person) => participantKeys.includes(String(person.key)));
  }

  function computeTripScanRowSplit(row, form) {
    const normalizedRow = normalizeTripScanRowSplitState(row, form);
    const people = getTripScanRowPeople(normalizedRow, form);
    const amount = getTripScanRowEffectiveAmount(form, normalizedRow);
    if (!people.length) return { valid: false, error: 'No participants selected', shares: [] };
    return computeShares(amount, String(normalizedRow.split_mode || 'equal'), people, normalizedRow.split_values || {});
  }

  function normalizeTripManualRowSplitState(row, form) {
    row.participant_keys = normalizeTripManualRowParticipantKeys(row, form);
    const mode = ['equal', 'percent', 'fraction', 'amount', 'parts'].includes(String(row?.split_mode || '').toLowerCase())
      ? String(row.split_mode).toLowerCase()
      : 'equal';
    row.split_mode = mode;
    const people = getTripScanParticipantOptions(form).filter((person) => row.participant_keys.includes(String(person.key)));
    const currentValues = row.split_values && typeof row.split_values === 'object' ? row.split_values : {};
    const nextValues = {};
    people.forEach((person) => {
      if (currentValues[person.key] !== undefined && currentValues[person.key] !== null && currentValues[person.key] !== '') {
        nextValues[person.key] = currentValues[person.key];
      }
    });
    const hasAllValues = people.length && people.every((person) => nextValues[person.key] !== undefined && nextValues[person.key] !== null && nextValues[person.key] !== '');
    row.split_values = hasAllValues ? nextValues : autoFillValues(mode, people, n(row?.amount));
    return row;
  }

  function getTripManualRowPeople(row, form) {
    const participantKeys = normalizeTripManualRowParticipantKeys(row, form);
    return getTripScanParticipantOptions(form).filter((person) => participantKeys.includes(String(person.key)));
  }

  function computeTripManualRowSplit(row, form) {
    const normalizedRow = normalizeTripManualRowSplitState(row, form);
    const people = getTripManualRowPeople(normalizedRow, form);
    const amount = r2(n(normalizedRow?.amount));
    if (!people.length) return { valid: false, error: 'No participants selected', shares: [] };
    return computeShares(amount, String(normalizedRow.split_mode || 'equal'), people, normalizedRow.split_values || {});
  }

  function renderTripScanDebugRows(rows = []) {
    if (!Array.isArray(rows) || !rows.length) return '<div style="font-size:12px;color:var(--t3)">No rows</div>';
    return `
      <div style="display:grid;gap:6px">
        ${rows.map((row, index) => `
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid var(--border);border-radius:10px;background:#fff">
            <div style="min-width:0">
              <div style="font-size:12px;font-weight:700;color:var(--t1)">${index + 1}. ${escHtml(String(row?.item_name || 'Row'))}</div>
            </div>
            <div style="font-size:12px;font-weight:800;color:var(--green);white-space:nowrap">${fmtCur(row?.amount || 0)}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function computeTripRowSelfShare(row, friendCount = 0) {
    if (Array.isArray(row?.participant_keys) && row.participant_keys.length && state.tripCreate) {
      const split = String(row?.key || '').startsWith('trip-manual-')
        ? computeTripManualRowSplit(row, state.tripCreate)
        : computeTripScanRowSplit(row, state.tripCreate);
      if (!split?.valid) return 0;
      const selfShare = split.shares.find((share) => String(share.key) === 'self');
      return r2(Number(selfShare?.share || 0));
    }
    const amountValue = r2(row?.amount);
    if (!(amountValue > 0)) return 0;
    const assignment = String(row?.assignment || 'self');
    if (assignment === 'shared' && friendCount > 0) {
      const participantCount = friendCount + 1;
      const perHead = r2(amountValue / participantCount);
      let remaining = amountValue;
      let selfShare = 0;
      for (let index = 0; index < participantCount; index += 1) {
        const shareValue = index === participantCount - 1 ? r2(remaining) : perHead;
        remaining = r2(remaining - shareValue);
        if (index === 0) selfShare = shareValue;
      }
      return r2(selfShare);
    }
    if (assignment.startsWith('friend:')) return 0;
    return amountValue;
  }

  function getTripById(tripId) {
    const tid = Number(tripId || 0);
    if (!(tid > 0)) return null;
    return (state.liveTrips || []).find((trip) => Number(trip?.id || 0) === tid) || null;
  }

  function liveSplitEventShareAmount(event) {
    const isTripSummary = String(event?.type || '') === 'trip_summary' && Number(event?.trip_id || 0) > 0;
    if (isTripSummary) {
      const trip = getTripById(event?.trip_id);
      return r2(Number(trip?.my_share_amount || event?.my_share_amount || 0));
    }
    return r2(Number(event?.my_share_amount || 0));
  }

  function liveSplitEventAddedToExpense(event) {
    const isTripSummary = String(event?.type || '') === 'trip_summary' && Number(event?.trip_id || 0) > 0;
    if (isTripSummary) {
      const trip = getTripById(event?.trip_id);
      return !!trip?.added_to_expense;
    }
    return !!event?.added_to_expense;
  }

  function canAddLiveSplitEventToExpense(event) {
    const shareAmount = liveSplitEventShareAmount(event);
    const isTripSummary = String(event?.type || '') === 'trip_summary' && Number(event?.trip_id || 0) > 0;
    if (!(shareAmount > 0) || liveSplitEventAddedToExpense(event)) return false;
    if (isTripSummary) {
      const trip = getTripById(event?.trip_id);
      return !!trip && trip.show_add_to_expense_option !== false;
    }
    return String(event?.split_mode || '').toLowerCase() !== 'settlement';
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

  function buildVoiceTripMembersPayload(draft) {
    const memberIds = Array.isArray(draft?.selected) ? draft.selected : [];
    return [...new Map(memberIds
      .map((id) => state.friends.find((friend) => String(friend.id) === String(id)))
      .filter(Boolean)
      .map((friend) => mapFriendToTripMemberPayload(friend))
      .map((member) => [String(member?.friend_id || member?.target_user_id || member?.member_name || ''), member])).values()];
  }

  function validateVoiceTripDrafts(entries = []) {
    for (const draft of (Array.isArray(entries) ? entries : [])) {
      const tripName = String(draft?.name || 'Trip').trim() || 'Trip';
      const unresolved = (Array.isArray(draft?.unresolved_member_names) ? draft.unresolved_member_names : [])
        .map((name) => String(name || '').trim())
        .filter(Boolean);
      if (unresolved.length) {
        return {
          valid: false,
          error: `Trip "${tripName}" has unknown member${unresolved.length === 1 ? '' : 's'}: ${unresolved.join(', ')}. Use existing Live Split friends only.`,
        };
      }
    }
    return { valid: true };
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

  function groupEventsByMonth(events = [], amountSelector = null) {
    const grouped = {};
    (events || []).forEach((event) => {
      const key = monthLabel(event?.date);
      if (!grouped[key]) grouped[key] = { events: [], total: 0 };
      grouped[key].events.push(event);
      grouped[key].total = r2(grouped[key].total + n(typeof amountSelector === 'function' ? amountSelector(event) : 0));
    });
    return Object.entries(grouped);
  }

  function buildSettlementParticipantsForOwnGroup(splits, total, payer, selfPayer) {
    const payerKey = textKey(payer);
    const ownerAmount = r2(splits.reduce((sum, split) => sum + n(split?.share_amount), 0)) || r2(total);
    return [
      { name: 'You', share: ownerAmount, paid: !!selfPayer },
      ...splits.map((split) => ({
        name: String(split?.friend_name || '').trim(),
        share: r2(split?.share_amount),
        paid: textKey(split?.friend_name) === payerKey,
      })),
    ].filter((item) => item.name);
  }

  function buildSettlementParticipantsForSharedGroup(participants, ownerKey, payerParticipant, rowParticipant, total) {
    return participants.map((participant) => ({
      name: participant.name,
      share: participant.key === ownerKey ? r2(total) : r2(participant.share),
      paid: !!(payerParticipant && payerParticipant.key === participant.key),
      contextOnly: participant.key !== ownerKey && participant.key !== rowParticipant.key,
    }));
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
      const rowIsNamedPayer = !!payerKey && payerKey === rowKey;
      let payerHandled = false;
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
          if (payerKey && (payerKey === friendName.toLowerCase() || payerKey === rowKey)) payerHandled = true;
          if (groupMode === 'settlement') {
            if (selfPayer) delta = r2(delta + n(split.share_amount));
            else if (payerKey && (payerKey === friendName.toLowerCase() || payerKey === rowKey)) delta = r2(delta - n(split.share_amount));
            return;
          }
          if (selfPayer) delta = r2(delta + n(split.share_amount));
          else if (payerKey && (payerKey === friendName.toLowerCase() || payerKey === rowKey) && selfShare > 0) delta = r2(delta - selfShare);
        }
      });
      if (!selfPayer && rowIsNamedPayer && selfShare > 0 && !payerHandled) {
        involved = true;
        delta = r2(delta - selfShare);
      }
      if (payerKey === rowKey) involved = true;
      if (involved) {
        const payerAlreadyTracked = selfPayer || splits.some((split) => textKey(split?.friend_name) === payerKey);
        const participants = groupMode === 'settlement'
          ? buildSettlementParticipantsForOwnGroup(splits, total, payer, selfPayer)
          : [
              { name: 'You', share: selfShare, paid: selfPayer },
              ...splits.map((split) => ({
                name: String(split?.friend_name || '').trim(),
                share: r2(split?.share_amount),
                paid: textKey(split?.friend_name) === payerKey,
              })),
              ...(!selfPayer && payerKey && !payerAlreadyTracked ? [{ name: payer, share: 0, paid: true, contextOnly: true }] : []),
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
          my_share_amount: groupMode === 'settlement' ? 0 : selfShare,
          split_mode: groupMode || 'equal',
          added_to_expense: !!group?.owner_added_to_expense,
          participants,
        });
      }
    });

    (state.sharedGroups || []).forEach((group) => {
      const context = resolveSharedGroupContext(group);
      if (!context) return;
      const { total, groupMode, participants, selfParticipant, payerName, payerParticipant, selfShare, selfIsPayer, ownerKey, ownerName, ownerUserId } = context;
      const rowNameNorm = normalizePersonName(rowName);
      const ownerNameNorm = normalizePersonName(ownerName || '');
      const ownerParticipant = participants.find((participant) => (
        String(participant?.key || '') === String(ownerKey || '')
        || (Number(ownerUserId || 0) > 0 && Number(participant?.linked_user_id || 0) === Number(ownerUserId || 0))
      )) || null;
      const rowMatchesOwner = !!ownerParticipant && (
        (rowLinkedUserId > 0 && Number(ownerUserId || 0) > 0 && rowLinkedUserId === Number(ownerUserId || 0))
        || (rowNameNorm && ownerNameNorm && (
          rowNameNorm === ownerNameNorm
          || (firstNameToken(rowNameNorm) && firstNameToken(rowNameNorm) === firstNameToken(ownerNameNorm))
        ))
      );

      const rowParticipant = (rowMatchesOwner ? ownerParticipant : null) || participants.find((participant) => {
        const participantNameNorm = normalizePersonName(participant?.name || '');
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
      if (groupMode === 'settlement') {
        if (selfIsPayer && selfShare > 0) {
          delta = selfShare;
        } else if (payerParticipant && payerParticipant.key === rowParticipant.key && selfShare > 0) {
          delta = r2(0 - selfShare);
        }
      } else if (selfIsPayer) {
        delta = r2(rowParticipant.share);
      } else if (payerParticipant && payerParticipant.key === rowParticipant.key && selfShare > 0) {
        delta = r2(0 - selfShare);
      }

      const eventParticipants = groupMode === 'settlement'
        ? buildSettlementParticipantsForSharedGroup(participants, context.ownerKey, payerParticipant, rowParticipant, total)
          .map((participant) => ({
            ...participant,
            name: participantMatchesViewer(participant, group?.friend_name || '') ? 'You' : participant.name,
          }))
        : participants.map((participant) => ({
            name: sharedParticipantDisplayName(participant, selfParticipant),
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
          payer: sharedParticipantDisplayName(payerParticipant, selfParticipant) || payerName || '-',
          total,
          delta,
          my_share_amount: groupMode === 'settlement' ? 0 : selfShare,
          split_mode: groupMode || 'equal',
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
        my_share_amount: r2(Number(tripMeta?.my_share_amount || 0)),
        expense_count: Number(trip.expense_count || 0),
        added_to_expense: !!tripMeta?.added_to_expense,
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
          const context = resolveSharedGroupContext(group);
          if (!context) return null;
          const extraParticipants = context.participants
            .map((participant) => ({
              name: sharedParticipantDisplayName(participant, context.selfParticipant),
              share: r2(participant.share),
              paid: !!(context.payerParticipant && context.payerParticipant.key === participant.key),
              contextOnly: participant.key !== context.selfParticipant.key,
            }))
            .filter((item, index, arr) => item.name && arr.findIndex((v) => v.name.toLowerCase() === item.name.toLowerCase()) === index);
          return {
            key: `t-${group?.id || ''}-${group?.divide_date || ''}`,
            group_id: Number(group?.id) || null,
            date: toLocalIsoDate(group?.divide_date),
            details: String(group?.details || group?.heading || 'Split expense').trim(),
            payer: sharedParticipantDisplayName(context.payerParticipant, context.selfParticipant) || context.payerName || '-',
            total: context.total,
            participants: extraParticipants,
          };
        }
        const payer = String(group?.paid_by || group?.owner_name || '').trim() || '-';
        const payerKey = textKey(payer);
        const selfPayer = isLikelySelfPayerForOwnGroup(payer, splits);
        const totalFriends = r2(splits.reduce((sum, split) => sum + n(split.share_amount), 0));
        const selfShare = r2(total - totalFriends);
        const payerAlreadyTracked = selfPayer || splits.some((split) => textKey(split?.friend_name) === payerKey);
        const extraPayerParticipant = !selfPayer && payerKey && !payerAlreadyTracked
          ? [{ name: payer, share: 0, paid: true, contextOnly: true }]
          : [];
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
            ...extraPayerParticipant,
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
    const values = Object.values(splitValues).map((value) => r2(value)).filter((value) => value >= 0);
    if (values.length > 1) {
      const first = values[0];
      if (values.every((value) => Math.abs(value - first) <= 0.009)) return 'equal';
      const sum = r2(values.reduce((acc, value) => acc + value, 0));
      if (Math.abs(sum - r2(totalAmount)) <= 0.009) return 'amount';
    }
    if (['percent', 'fraction', 'parts'].includes(saved)) return saved;
    if (saved === 'equal' && values.length > 1) {
      const first = values[0];
      if (!values.every((value) => Math.abs(value - first) <= 0.009)) return 'amount';
    }
    if (saved === 'amount') return 'amount';
    if (saved === 'equal') return 'equal';
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
          const sharedContext = !groupFromId?.is_owner ? resolveSharedGroupContext(groupFromId) : null;
          if (sharedContext) {
            event = {
              key: `g-${groupFromId?.id || ''}-${groupFromId?.divide_date || ''}-${groupFromId?.details || ''}`,
              group_id: Number(groupFromId?.id) || numericToken,
              date: toLocalIsoDate(groupFromId?.divide_date),
              details: String(groupFromId?.details || groupFromId?.heading || 'Split expense').trim(),
              payer: sharedParticipantDisplayName(sharedContext.payerParticipant, sharedContext.selfParticipant) || sharedContext.payerName || '-',
              total: sharedContext.total,
              delta: 0,
              my_share_amount: sharedContext.groupMode === 'settlement' ? 0 : sharedContext.selfShare,
              split_mode: sharedContext.groupMode || 'equal',
              added_to_expense: !!groupFromId?.added_to_expense,
              participants: sharedContext.groupMode === 'settlement'
                ? buildSettlementParticipantsForSharedGroup(
                    sharedContext.participants,
                    sharedContext.ownerKey,
                    sharedContext.payerParticipant,
                    sharedContext.selfParticipant,
                    sharedContext.total
                  ).map((participant) => ({
                    ...participant,
                    name: participantMatchesViewer(participant, groupFromId?.friend_name || '') ? 'You' : participant.name,
                  }))
                : sharedContext.participants.map((participant) => ({
                    name: sharedParticipantDisplayName(participant, sharedContext.selfParticipant),
                    share: r2(participant.share),
                    paid: !!(sharedContext.payerParticipant && sharedContext.payerParticipant.key === participant.key),
                    contextOnly: participant.key !== sharedContext.selfParticipant.key,
                  })).filter((item) => item.name),
            };
          } else {
            const splits = Array.isArray(groupFromId?.splits) ? groupFromId.splits : [];
            const total = r2(groupFromId?.total_amount);
            const totalFriends = r2(splits.reduce((sum, split) => sum + n(split.share_amount), 0));
            const selfShare = r2(total - totalFriends);
            const payer = String(groupFromId?.paid_by || '').trim();
            const groupMode = String(groupFromId?.split_mode || '').trim().toLowerCase();
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
              my_share_amount: groupMode === 'settlement' ? 0 : selfShare,
              split_mode: groupMode || 'equal',
              added_to_expense: !!groupFromId?.added_to_expense,
              participants: groupMode === 'settlement'
                ? buildSettlementParticipantsForOwnGroup(splits, total, payer, selfPayer)
                : [
                    { name: 'You', share: selfShare, paid: selfPayer },
                    ...splits.map((split) => ({
                      name: String(split?.friend_name || '').trim(),
                      share: r2(split?.share_amount),
                      paid: textKey(split?.friend_name) === payerKey,
                    })),
                  ].filter((item) => item.name),
            };
          }
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
    const rawName = String(p?.name || '').trim();
    const displayName = rawName.toLowerCase() === 'you'
      ? (meName || rawName)
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
    const rawName = String(p?.name || '').trim();
    const displayName = rawName.toLowerCase() === 'you'
      ? (meName || rawName)
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
        ${canAddLiveSplitEventToExpense(event) ? `
          <button
            id="lsAddToExpenseBtn"
            class="btn btn-p btn-sm ls-expense-add-btn"
            style="margin-top:4px"
            data-default-label="Add My Share (${fmtCur(liveSplitEventShareAmount(event))}) to Expenses"
            onclick="liveSplitAddToExpense(${liveSplitEventShareAmount(event)}, decodeURIComponent('${encodeURIComponent(String(event.details || ''))}'), '${String(event.date || '')}', 'lsAddToExpenseBtn', ${Number(event.group_id) || 0})"
          >
            Add My Share (${fmtCur(liveSplitEventShareAmount(event))}) to Expenses
          </button>
        ` : (liveSplitEventAddedToExpense(event) ? `
          <div style="margin-top:4px;font-size:12px;font-weight:700;color:var(--green)">My share already added to expenses</div>
        ` : '')}
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
    const grouped = groupEventsByMonth(events, (event) => event.delta);
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
          ${events.length ? grouped.map(([month, monthData]) => `
            <div style="margin-bottom:10px">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin:6px 0">
                <div style="font-size:14px;font-weight:800;color:var(--t1)">${escHtml(month)}</div>
                <div style="font-size:13px;font-weight:800;color:${monthData.total >= 0 ? 'var(--green)' : 'var(--red)'};text-align:right">${fmtCur(monthData.total)}</div>
              </div>
              <div class="live-split-table-wrap ls-desktop-event-wrap" style="border-radius:12px;border:1px solid var(--border);background:var(--white);overflow:hidden">
                <table class="live-split-event-table" style="min-width:0;table-layout:fixed;width:100%">
                  <thead><tr><th>Date</th><th>Details</th><th class="td-m live-split-action-col"></th><th class="td-m live-split-amount-col">Amount</th></tr></thead>
                  <tbody>
                    ${monthData.events.map((event) => {
                      const tone = event.delta > 0 ? 'var(--green)' : event.delta < 0 ? 'var(--red)' : 'var(--t3)';
                      const canManage = Number(event.group_id) > 0;
                      const isTripSummary = String(event?.type || '') === 'trip_summary' && Number(event?.trip_id || 0) > 0;
                      const canAddMyShare = canAddLiveSplitEventToExpense(event);
                      const addedToExpense = liveSplitEventAddedToExpense(event);
                      const shareAmount = liveSplitEventShareAmount(event);
                      const addedLabel = isTripSummary
                        ? (((getTripById(event.trip_id)?.added_to_expense_is_extra) ? 'Added Extra' : 'Added Fair'))
                        : (event.added_to_expense_is_extra ? 'Added Extra' : 'Added');
                      const openCall = isTripSummary
                        ? `liveSplitOpenTripDetails(${Number(event.trip_id)})`
                        : `liveSplitOpenEvent('${rowRefToken}', '${Number(event.group_id) || 0}')`;
                      const addShareBtnId = `lsAddToExpenseBtn_${Number(event.group_id) || 0}`;
                      const mobileAddShareBtnId = `lsAddToExpenseBtn_mobile_${Number(event.group_id) || 0}`;
                      const addShareLabel = `Add My Share (${fmtCur(shareAmount)})`;
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
                          ${addedToExpense ? `
                          <button class="live-split-icon-btn success" title="${escHtml(addedLabel)}" aria-label="${escHtml(addedLabel)}" disabled>
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="currentColor"/></svg>
                          </button>
                          ` : ''}
                          ${canAddMyShare ? `
                          <button
                            id="${buttonId}"
                            class="live-split-icon-btn success emphasize"
                            title="${escHtml(`${addShareLabel} to Expenses`)}"
                            aria-label="${escHtml(`${addShareLabel} to Expenses`)}"
                            data-default-label="icon"
                            onclick="${isTripSummary
                              ? `liveSplitAddTripToExpense(${Number(event.trip_id) || 0}, decodeURIComponent('${encodeURIComponent(String(getTripById(event.trip_id)?.name || 'Trip').trim())}'), ${shareAmount})`
                              : `liveSplitAddToExpense(${shareAmount}, decodeURIComponent('${encodeURIComponent(String(event.details || ''))}'), '${String(event.date || '')}', '${buttonId}', ${Number(event.group_id) || 0})`}"
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14m-7-7h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                          </button>
                          ` : ''}
                        </div>
                      ` : (addedToExpense
                        ? `<span style="font-size:11px;font-weight:700;color:var(--green)">${escHtml(addedLabel)}</span>`
                        : '<span style="font-size:11px;color:var(--t3)">-</span>');
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
                ${monthData.events.map((event) => {
                  const tone = event.delta > 0 ? 'var(--green)' : event.delta < 0 ? 'var(--red)' : 'var(--t3)';
                  const canManage = Number(event.group_id) > 0;
                  const isTripSummary = String(event?.type || '') === 'trip_summary' && Number(event?.trip_id || 0) > 0;
                  const canAddMyShare = canAddLiveSplitEventToExpense(event);
                  const addedToExpense = liveSplitEventAddedToExpense(event);
                  const shareAmount = liveSplitEventShareAmount(event);
                  const addedLabel = isTripSummary
                    ? (((getTripById(event.trip_id)?.added_to_expense_is_extra) ? 'Added Extra' : 'Added Fair'))
                    : (event.added_to_expense_is_extra ? 'Added Extra' : 'Added');
                  const openCall = isTripSummary
                    ? `liveSplitOpenTripDetails(${Number(event.trip_id)})`
                    : `liveSplitOpenEvent('${rowRefToken}', '${Number(event.group_id) || 0}')`;
                  const mobileAddShareBtnId = `lsAddToExpenseBtn_mobile_card_${Number(event.group_id) || 0}`;
                  const addShareLabel = `Add My Share (${fmtCur(shareAmount)})`;
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
                      ${addedToExpense ? `
                      <button class="live-split-icon-btn success" title="${escHtml(addedLabel)}" aria-label="${escHtml(addedLabel)}" disabled>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="currentColor"/></svg>
                      </button>
                      ` : ''}
                      ${canAddMyShare ? `
                      <button
                        id="${mobileAddShareBtnId}"
                        class="live-split-icon-btn success emphasize"
                        title="${escHtml(`${addShareLabel} to Expenses`)}"
                        aria-label="${escHtml(`${addShareLabel} to Expenses`)}"
                        data-default-label="icon"
                        onclick="${isTripSummary
                          ? `liveSplitAddTripToExpense(${Number(event.trip_id) || 0}, decodeURIComponent('${encodeURIComponent(String(getTripById(event.trip_id)?.name || 'Trip').trim())}'), ${shareAmount})`
                          : `liveSplitAddToExpense(${shareAmount}, decodeURIComponent('${encodeURIComponent(String(event.details || ''))}'), '${String(event.date || '')}', '${mobileAddShareBtnId}', ${Number(event.group_id) || 0})`}"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14m-7-7h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                      </button>
                      ` : ''}
                    </div>
                  ` : (addedToExpense
                    ? `<span style="font-size:11px;font-weight:700;color:var(--green)">${escHtml(addedLabel)}</span>`
                    : '<span style="font-size:11px;color:var(--t3)">-</span>');
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
    const tripMeta = (state.liveTrips || []).find((item) => Number(item.id) === tid) || null;
    let trip = tripMeta;
    if (!trip) {
      toast('Trip not found', 'warning');
      return;
    }
    try {
      trip = await fetchTripLedger(tid, true);
    } catch (error) {
      toast(error?.message || 'Could not load trip details', 'error');
      return;
    }
    state.activeTripDetail = tid;
    const events = buildCanonicalTripEventsFromLedger(trip);
    const memberBalances = buildCanonicalTripMemberBalances(events);
    const grouped = groupEventsByMonth(events, (event) => event.total);
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
    const memberBalanceChips = (memberBalances || [])
      .filter((item) => Math.abs(n(item?.amount)) > 0.005)
      .map((item) => ({ ...item, amount: r2(item.amount) }))
      .sort((a, b) => Math.abs(n(b.amount)) - Math.abs(n(a.amount)));
    if (!state.tripDetailShowSplits || typeof state.tripDetailShowSplits !== 'object') state.tripDetailShowSplits = {};
    const showItemSplits = !!state.tripDetailShowSplits[tid];
    const renderEventSplitHtml = (event) => {
      if (!showItemSplits) return '';
      const participants = Array.isArray(event?.participants)
        ? event.participants.filter((p) => String(p?.name || '').trim())
        : [];
      if (!participants.length) return '';
      return `
        <div class="ls-trip-inline-splits" style="margin-top:8px;padding:8px 10px;border:1px dashed #d8e5dd;border-radius:10px;background:#fbfdfb">
          <div class="ls-trip-inline-split-kicker" style="font-size:11px;font-weight:700;color:var(--t2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Each split</div>
          <div class="ls-trip-inline-split-chips" style="display:flex;flex-wrap:wrap;gap:6px">
            ${participants.map((p) => {
              const share = r2(p?.share);
              const isPayer = !!p?.paid;
              const contextOnly = !!p?.contextOnly;
              const tone = isPayer ? 'var(--green)' : (contextOnly ? 'var(--t2)' : 'var(--red)');
              const bg = isPayer ? '#edfbf3' : (contextOnly ? '#f4f7f5' : '#fff1f1');
              const label = contextOnly
                ? `${escHtml(p.name)} · ${fmtCur(share)} in split`
                : `${escHtml(p.name)} · ${isPayer ? 'paid' : 'owes'} ${fmtCur(share)}`;
              return `<span class="ls-trip-inline-split-chip" style="display:inline-flex;align-items:center;padding:5px 9px;border-radius:999px;background:${bg};color:${tone};font-size:11px;font-weight:600;line-height:1.2">${label}</span>`;
            }).join('')}
          </div>
        </div>
      `;
    };
    const status = String(trip.status || 'active').toLowerCase();
    const statusTone = status === 'completed' ? 'var(--t3)' : 'var(--green)';
    window.__modalClassName = 'modal-wide live-split-detail-modal';
    window.__modalOverlayClassName = 'live-split-detail-overlay';
    openModal(`Trip - ${escHtml(trip.name || 'Trip')}`, `
      <div class="live-split-modal-shell ls-trip-detail-shell" style="display:grid;gap:10px">
        <div class="live-split-modal-top ls-trip-detail-top" style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <div class="ls-trip-top-meta" style="font-size:13px;color:var(--t2)">
            <b style="color:${statusTone};text-transform:capitalize">${escHtml(status)}</b>
            | ${fmtCur(trip.total_amount || 0)} | ${(trip.members || []).length} members | ${Number(trip.expense_count || 0)} expenses
          </div>
          <div class="ls-trip-top-actions" style="display:flex;align-items:center;gap:8px;flex-wrap:nowrap">
            ${trip.added_to_expense
              ? `<span class="ls-trip-toolbar-pill" title="Added to expenses${trip.added_to_expense_is_extra ? ' · Extra' : ' · Fair'}" aria-label="Added to expenses${trip.added_to_expense_is_extra ? ' · Extra' : ' · Fair'}">
                  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><path d="M12 3l7 4v5c0 4.2-2.7 8-7 9-4.3-1-7-4.8-7-9V7l7-4z"/></svg>
                </span>`
              : `<button class="live-split-icon-btn soft" title="${Number(trip.my_share_amount || 0) > 0 ? `Add My Share (${fmtCur(trip.my_share_amount || 0)})` : 'Add My Share'}" aria-label="${Number(trip.my_share_amount || 0) > 0 ? `Add My Share (${fmtCur(trip.my_share_amount || 0)})` : 'Add My Share'}" ${Number(trip.my_share_amount || 0) > 0 ? `onclick="liveSplitAddTripToExpense(${tid}, decodeURIComponent('${encodeURIComponent(String(trip.name || 'Trip').trim())}'), ${Number(trip.my_share_amount || 0)})"` : 'disabled'}>
                  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M12 9v6M9 12h6"/></svg>
                </button>`}
            <button class="live-split-icon-btn soft" title="${showItemSplits ? 'Hide Each Split' : 'Show Each Split'}" aria-label="${showItemSplits ? 'Hide Each Split' : 'Show Each Split'}" onclick="liveSplitToggleTripSplitView(${tid})">
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h7M4 12h16M13 17h7"/><circle cx="14" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>
            </button>
            ${trip.is_owner ? `<button class="live-split-icon-btn soft" title="Bulk Edit Rows" aria-label="Bulk Edit Rows" onclick="liveSplitOpenTripBulkEdit(${tid})">
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h10M4 12h7M4 17h12"/><path d="M16.5 5.5l2 2"/><path d="M14 8l5-5 2 2-5 5-3 1z"/></svg>
            </button>` : ''}
            <button class="live-split-icon-btn soft" title="Trip PDF" aria-label="Trip PDF" onclick="liveSplitDownloadTripPdf(${tid})">
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v5h5"/><path d="M6 3h8l5 5v13H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M8 15h8M8 18h5"/></svg>
            </button>
            <button class="live-split-icon-btn soft" title="Voice split" aria-label="Voice split" onclick="liveSplitOpenVoiceFromTrip(${tid})">
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/></svg>
            </button>
            <button class="live-split-icon-btn" title="Add split" aria-label="Add split" onclick="liveSplitUseTrip(${tid})">
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>
            </button>
            ${trip.is_owner ? `<button class="live-split-icon-btn danger" title="Delete Trip" aria-label="Delete Trip" onclick="liveSplitDeleteTrip(${tid})">
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4h6v3"/></svg>
            </button>` : ''}
          </div>
        </div>
        ${memberBalanceChips.length ? `
          <div class="live-split-summary-chips ls-trip-balance-strip" style="display:flex;flex-wrap:wrap;gap:6px">
            ${memberBalanceChips.map((item) => {
              const amount = r2(item.amount);
              const tone = amount > 0 ? 'var(--green)' : amount < 0 ? 'var(--red)' : 'var(--t3)';
              const status = amount > 0 ? 'gets' : amount < 0 ? 'owes' : 'settled';
              return `
                <div style="padding:5px 10px;border:1px solid var(--border);border-radius:999px;background:#fff;font-size:12px;color:var(--t2)">
                  <b style="color:var(--t1)">${escHtml(item.name || 'Friend')}</b> <span style="color:${tone}">${escHtml(status)} ${fmtCur(Math.abs(amount))}</span>
                </div>
              `;
            }).join('')}
          </div>
        ` : ''}
        ${memberSummary.length ? `
          <div class="live-split-member-grid ls-trip-member-grid" style="display:flex;flex-wrap:wrap;gap:8px">
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
        <div class="ls-trip-month-stack">
          ${events.length ? grouped.map(([month, monthData]) => `
            <div class="ls-trip-month-card" style="margin-bottom:10px">
              <div class="ls-trip-month-head" style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin:6px 0">
                <div class="ls-trip-month-title" style="font-size:14px;font-weight:800;color:var(--t1)">${escHtml(month)}</div>
                <div class="ls-trip-month-total" style="font-size:13px;font-weight:800;color:var(--t1);text-align:right">${fmtCur(monthData.total)}</div>
              </div>
              <div class="live-split-table-wrap ls-desktop-event-wrap ls-trip-event-wrap" style="border-radius:12px;border:1px solid var(--border);background:var(--white);overflow:hidden">
                <table class="live-split-event-table ls-trip-event-table" style="min-width:0;table-layout:fixed;width:100%">
                  <thead><tr><th>Date</th><th>Details</th><th class="td-m live-split-action-col"></th><th class="td-m live-split-amount-col">Amount</th></tr></thead>
                  <tbody>
                    ${monthData.events.map((event) => {
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
                        <tr class="ls-trip-event-row">
                          <td class="live-split-date-col ls-trip-date-col" style="cursor:pointer" onclick="${openCall}">${escHtml(shortDate(event.date))}</td>
                          <td class="live-split-details-col ls-trip-details-col" style="cursor:pointer" onclick="${openCall}">
                            <div style="display:flex;width:100%;align-items:flex-start;justify-content:space-between;gap:10px">
                              <div style="font-weight:700;font-size:14px;flex:1;min-width:0;word-break:break-word;line-height:1.4">${escHtml(event.details || '-')}</div>
                              <div class="ls-hide-desktop" style="font-family:var(--mono);font-weight:700;font-size:14px;flex-shrink:0;white-space:nowrap">${fmtCur(event.total)}</div>
                            </div>
                            <div style="font-size:12px;color:var(--t3);margin-top:5px">${fmtCur(event.total)} paid by ${escHtml(event.payer || '-')}</div>
                            ${renderEventSplitHtml(event)}
                            <div class="ls-hide-desktop" style="display:flex;width:100%;align-items:center;justify-content:space-between;gap:8px;margin-top:10px" onclick="event.stopPropagation()">
                              <span style="font-size:11px;color:var(--t3);font-weight:600">${escHtml(shortDate(event.date))}</span>
                              <div style="display:flex;flex-shrink:0">${actionHtml}</div>
                            </div>
                          </td>
                          <td class="td-m live-split-action-col" onclick="event.stopPropagation()">
                            ${actionHtml}
                          </td>
                          <td class="td-m live-split-amount-col ls-trip-amount-col" style="color:var(--t1);cursor:pointer" onclick="${openCall}">${fmtCur(event.total)}</td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
              <div class="ls-mobile-event-list">
                ${monthData.events.map((event) => {
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
                    <div class="ls-mobile-event-card ls-trip-mobile-card" onclick="${openCall}">
                      <div class="ls-mobile-event-head">
                        <div class="ls-mobile-event-title">${escHtml(event.details || '-')}</div>
                        <div class="ls-mobile-event-amount">${fmtCur(event.total)}</div>
                      </div>
                      <div class="ls-mobile-event-sub">${fmtCur(event.total)} paid by ${escHtml(event.payer || '-')}</div>
                      ${renderEventSplitHtml(event)}
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

  async function liveSplitDownloadTripPdf(tripId) {
    const tid = Number(tripId || 0);
    if (!(tid > 0)) return;
    const tripMeta = (state.liveTrips || []).find((item) => Number(item.id) === tid) || null;
    let trip = tripMeta;
    if (!trip) {
      toast('Trip not found', 'warning');
      return;
    }
    if (typeof _P === 'undefined' || !_P || typeof _P.init !== 'function') {
      toast('PDF tools are not ready yet', 'warning');
      return;
    }

    try {
      trip = await fetchTripLedger(tid, true);
    } catch (error) {
      toast(error?.message || 'Could not load trip details', 'error');
      return;
    }

    const events = buildCanonicalTripEventsFromLedger(trip);
    const memberSummaryMap = {};
    events.forEach((event) => {
      (event.participants || []).forEach((p) => {
        if (!p?.name) return;
        if (!memberSummaryMap[p.name]) memberSummaryMap[p.name] = { name: p.name, paid: 0, share: 0 };
        memberSummaryMap[p.name].share = r2(memberSummaryMap[p.name].share + r2(p.share));
        if (p.paid) memberSummaryMap[p.name].paid = r2(memberSummaryMap[p.name].paid + r2(event.total));
      });
    });
    const memberSummary = Object.values(memberSummaryMap);
    const members = Array.isArray(trip.members) ? trip.members : [];
    const memberNames = members.map((member) => String(member?.name || member?.display_name || member?.username || '').trim()).filter(Boolean);
    const subtitleParts = [
      `${members.length} members`,
      `${events.length} item${events.length === 1 ? '' : 's'}`,
      `${String(trip.status || 'active').toUpperCase()}`,
    ];
    const createdDate = trip.created_at ? _P.dt(trip.created_at) : '';
    if (createdDate && createdDate !== '-') subtitleParts.unshift(createdDate);

    const doc = _P.init(true);
    let y = _P.header(doc, `Live Split Trip: ${trip.name || 'Trip'}`, subtitleParts.join('  ·  '));
    y = _P.cards(doc, y, [
      { label: 'Trip Total', value: _P.cur(trip.total_amount || 0), color: '' },
      { label: 'My Share', value: _P.cur(trip.my_share_amount || 0), color: 'amber' },
      { label: 'Expenses', value: String(Number(trip.expense_count || events.length || 0)), color: '' },
      { label: 'Members', value: String(members.length || memberSummary.length || 0), color: '' },
    ]);
    if (memberNames.length) y = _P.note(doc, y, `Members: ${memberNames.join('  ·  ')}`);

    if (memberSummary.length) {
      y = _P.section(doc, y, 'Member Summary');
      y = _P.table(
        doc,
        y,
        [['Member', 'Paid', 'Share', 'Net']],
        memberSummary.map((member) => {
          const net = r2(member.paid - member.share);
          return [
            member.name || '-',
            _P.cur(member.paid || 0),
            _P.cur(member.share || 0),
            `${net > 0.005 ? '+' : net < -0.005 ? '-' : ''}${_P.cur(Math.abs(net))}`,
          ];
        }),
        { 0: { cellWidth: 52 }, 1: { cellWidth: 34 }, 2: { cellWidth: 34 }, 3: { cellWidth: 34 } },
        true
      );
    }

    y = _P.section(doc, y, 'Item Splits');
    y = _P.table(
      doc,
      y,
      [['Date', 'Item', 'Paid By', 'Amount', 'Each Split']],
      events.map((event) => {
        const splitText = Array.isArray(event?.participants) && event.participants.length
          ? event.participants
            .filter((p) => String(p?.name || '').trim())
            .map((p) => {
              const share = _P.cur(r2(p?.share));
              if (p?.contextOnly) return `${p.name}: ${share} in split`;
              return `${p.name}: ${p?.paid ? `paid ${share}` : `owes ${share}`}`;
            })
            .join('\n')
          : '-';
        return [
          _P.dt(event?.date),
          event?.details || '-',
          event?.payer || '-',
          _P.cur(event?.total || 0),
          splitText,
        ];
      }),
      {
        0: { cellWidth: 24 },
        1: { cellWidth: 68 },
        2: { cellWidth: 34 },
        3: { cellWidth: 26 },
        4: { cellWidth: 'auto' },
      },
      true
    );

    _P.save(doc, String(trip.name || 'Live_Split_Trip').replace(/[^\w\s-]/g, '_').trim() || 'Live_Split_Trip');
  }

  async function toggleTripSplitView(tripId) {
    const tid = Number(tripId || 0);
    if (!(tid > 0)) return;
    if (!state.tripDetailShowSplits || typeof state.tripDetailShowSplits !== 'object') state.tripDetailShowSplits = {};
    state.tripDetailShowSplits[tid] = !state.tripDetailShowSplits[tid];
    await openTripDetails(tid);
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
      const nudgeAccess = window._liveSplitAccess?.nudge || {};
      const canNudge = Math.abs(Number(amount)) > 0.004
        && friendId > 0
        && Number(row?.linked_user_id || 0) > 0
        && Number(row?.linked_user_id || 0) !== Number(window._currentUser?.id || 0)
        && !!nudgeAccess.enabled;
      const nudgeDisabled = !nudgeAccess.can_use || state.friendNudgeBusy.has(friendId);
      const canDelete = canDeleteLiveSplitRow(row);
      const rowRef = encodeURIComponent(String(row?.key || friendId || row?.name || ''));
      const tone = row.amount > 0 ? 'var(--green)' : row.amount < 0 ? 'var(--red)' : 'var(--t3)';
      const label = row.amount > 0 ? 'They owe' : row.amount < 0 ? 'You owe' : 'Settled';
      return `
        <div class="friend-card live-split-card">
          <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
            ${renderAvatarPreviewTrigger(row.name, row.linked_user_avatar_url)}
            <div class="friend-info" style="cursor:pointer" onclick="liveSplitOpenDetails('${rowRef}')">
              <div class="friend-name">${escHtml(row.name)}</div>
              <div style="font-size:11px;color:${tone}">${escHtml(label)}</div>
            </div>
          </div>
          <div class="live-split-card-actions" style="display:flex;align-items:center;gap:10px" onclick="event.stopPropagation()">
            ${friendId > 0 ? `<button class="live-split-icon-btn soft" title="Voice split" aria-label="Voice split" onclick="liveSplitOpenVoiceForFriend(${friendId})">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5-3a1 1 0 1 1 2 0 7 7 0 0 1-6 6.92V21h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-3.08A7 7 0 0 1 5 11a1 1 0 1 1 2 0 5 5 0 1 0 10 0z"/></svg>
            </button>` : ''}
            ${canNudge ? `<button class="live-split-icon-btn" title="${escHtml(nudgeAccess.can_use === false ? (nudgeAccess.message || 'Nudge limit reached') : 'Nudge')}" aria-label="Nudge" ${nudgeDisabled ? 'disabled' : ''} onclick="liveSplitSendNudge(${friendId})">${state.friendNudgeBusy.has(friendId) ? '<span style="font-size:11px;line-height:1">...</span>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22a2.5 2.5 0 0 1-2.45-2h4.9A2.5 2.5 0 0 1 12 22Zm7-4H5v-1l1.5-1.5V10a5.5 5.5 0 1 1 11 0v5.5L19 17v1Zm-2-2V10a4 4 0 1 0-8 0v6h8Z"/></svg>'}</button>` : ''}
            ${canSettle ? `<button class="btn btn-s btn-sm" onclick="liveSplitOpenSettle(${friendId})">Settle</button>` : ''}
            ${canDelete ? `<button class="btn btn-g btn-sm" ${state.friendDeleteBusy.has(friendId) ? 'disabled' : ''} onclick="liveSplitDeleteFriend(${friendId})">${state.friendDeleteBusy.has(friendId) ? liveSplitBusyLabel('Deleting...') : 'Delete'}</button>` : ''}
            <div class="friend-bal" style="color:${tone}">${fmtCur(amount)}</div>
          </div>
        </div>`;
    }).join('');
  }

  function renderTripsSection() {
    const allTrips = [...(state.liveTrips || [])]
      .sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')) || Number(b.id || 0) - Number(a.id || 0));
    const completedTrips = allTrips.filter((trip) => String(trip?.status || '').toLowerCase() === 'completed');
    const trips = state.showCompletedTrips
      ? allTrips
      : allTrips.filter((trip) => String(trip?.status || '').toLowerCase() !== 'completed');
    const toggleBtnHtml = completedTrips.length
      ? `<button class="chip ${state.showCompletedTrips ? 'active' : ''}" onclick="liveSplitToggleCompletedTrips()">${state.showCompletedTrips ? 'Hide Completed Trips' : `Show Completed Trips (${completedTrips.length})`}</button>`
      : '';
    if (!allTrips.length) {
      return `
        <div style="margin-top:14px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <div style="font-size:13px;font-weight:800;color:var(--t2)">Trips</div>
            <div style="display:flex;align-items:center;gap:8px">
              <button class="live-split-icon-btn soft" title="Voice trip" aria-label="Voice trip" onclick="liveSplitOpenVoiceTripCreate()">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5-3a1 1 0 1 1 2 0 7 7 0 0 1-6 6.92V21h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-3.08A7 7 0 0 1 5 11a1 1 0 1 1 2 0 5 5 0 1 0 10 0z"/></svg>
              </button>
              <button class="btn btn-s btn-sm" onclick="liveSplitOpenTripCreate()">+ New Trip</button>
            </div>
          </div>
          <div class="card" style="text-align:center;color:var(--t3);padding:18px">No Trips yet.</div>
        </div>`;
    }
    return `
      <div style="margin-top:14px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <div style="font-size:13px;font-weight:800;color:var(--t2)">Trips</div>
            ${toggleBtnHtml}
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <button class="live-split-icon-btn soft" title="Voice trip" aria-label="Voice trip" onclick="liveSplitOpenVoiceTripCreate()">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5-3a1 1 0 1 1 2 0 7 7 0 0 1-6 6.92V21h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-3.08A7 7 0 0 1 5 11a1 1 0 1 1 2 0 5 5 0 1 0 10 0z"/></svg>
            </button>
            <button class="btn btn-s btn-sm" onclick="liveSplitOpenTripCreate()">+ New Trip</button>
          </div>
        </div>
        ${!trips.length ? '<div class="card" style="text-align:center;color:var(--t3);padding:18px">Completed trips are hidden.</div>' : ''}
        <div style="display:grid;gap:8px">
          ${trips.map((trip) => {
            const status = String(trip?.status || 'active').toLowerCase();
            const statusTone = status === 'completed' ? 'var(--t3)' : 'var(--green)';
            const busy = state.tripActionBusy === Number(trip.id);
            const toggleLabel = status === 'completed' ? 'Reopen trip' : 'Complete trip';
            return `
              <div class="friend-card live-split-card" style="cursor:pointer" onclick="liveSplitOpenTripDetails(${Number(trip.id)})">
                <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0">
                  <div style="display:flex;align-items:center;gap:6px;align-self:stretch" onclick="event.stopPropagation()">
                    <button class="live-split-icon-btn soft" title="Manage trip members" aria-label="Manage trip members" onclick="liveSplitManageTripMembers(${Number(trip.id)})">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zm2.92 2.33H5v-.92l8.06-8.06.92.92L5.92 19.58zM20.71 7.04a1.003 1.003 0 0 0 0-1.42L18.37 3.29a1.003 1.003 0 0 0-1.42 0L15.13 5.1l3.75 3.75 1.83-1.81z"/></svg>
                    </button>
                    ${trip.is_owner ? `<button class="live-split-icon-btn ${status === 'completed' ? 'soft' : 'success'}" title="${toggleLabel}" aria-label="${toggleLabel}" ${busy ? 'disabled' : ''} onclick="liveSplitToggleTripStatus(${Number(trip.id)}, '${status === 'completed' ? 'active' : 'completed'}')">
                      ${busy ? '<span style="font-size:11px;line-height:1">...</span>' : (status === 'completed'
                        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6a6 6 0 0 1-10.24 4.24l-1.42 1.42A8 8 0 1 0 12 5z"/></svg>'
                        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>')}
                    </button>` : ''}
                    ${trip.is_owner ? `<button class="live-split-icon-btn danger" title="Delete trip" aria-label="Delete trip" ${busy ? 'disabled' : ''} onclick="liveSplitDeleteTrip(${Number(trip.id)})">
                      ${busy ? '<span style="font-size:11px;line-height:1">...</span>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12v2H6V7zm2 3h8l-.7 9.1c-.1 1.1-1 1.9-2.1 1.9h-2.4c-1.1 0-2-.8-2.1-1.9L8 10zm3-5h2l1 1h4v2H6V6h4l1-1z"/></svg>'}
                    </button>` : ''}
                  </div>
                  <div class="friend-info" style="min-width:0">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                      <div class="friend-name">${escHtml(trip.name || 'Trip')}</div>
                      <span style="font-size:10px;font-weight:700;color:${statusTone};text-transform:capitalize;padding:3px 8px;border-radius:999px;background:${status === 'completed' ? 'rgba(148,163,184,0.16)' : 'rgba(20,90,60,0.14)'};border:1px solid ${status === 'completed' ? 'rgba(148,163,184,0.28)' : 'rgba(20,90,60,0.18)'}">${escHtml(status)}</span>
                    </div>
                    <div style="font-size:11px;color:var(--t3)">
            ${fmtCur(trip.total_amount || 0)} | ${(trip.members || []).length} members | ${Number(trip.expense_count || 0)} expenses
                    </div>
                  </div>
                </div>
                <div class="live-split-card-actions live-split-trip-action-wrap" onclick="event.stopPropagation()">
                  <div class="live-split-trip-actions">
                    <button class="live-split-icon-btn soft" title="Voice split" aria-label="Voice split" onclick="liveSplitOpenVoiceFromTrip(${Number(trip.id)})">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5-3a1 1 0 1 1 2 0 7 7 0 0 1-6 6.92V21h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-3.08A7 7 0 0 1 5 11a1 1 0 1 1 2 0 5 5 0 1 0 10 0z"/></svg>
                    </button>
                    <button class="btn btn-p btn-sm" onclick="liveSplitUseTrip(${Number(trip.id)})">Add Split</button>
                    ${trip.added_to_expense
                      ? `<button class="btn btn-s btn-sm" disabled>${trip.added_to_expense_is_extra ? 'Added Extra' : 'Added Fair'}</button>`
                      : `<button class="btn btn-s btn-sm" ${Number(trip.my_share_amount || 0) > 0 ? `onclick="liveSplitAddTripToExpense(${Number(trip.id)}, decodeURIComponent('${encodeURIComponent(String(trip.name || 'Trip').trim())}'), ${Number(trip.my_share_amount || 0)})"` : 'disabled'}>Add My Share</button>`}
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
    window.__modalClassName = 'live-split-settle-modal';
    openModal(`Settle - ${escHtml(friend.name || 'Friend')}`, `
      <div class="live-split-settle-shell" style="display:grid;gap:12px">
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
        <div class="fa live-split-settle-actions">
          <button class="btn btn-p" ${state.settleBusy ? 'disabled' : ''} onclick="liveSplitSaveSettle()">${state.settleBusy ? liveSplitBusyLabel('Saving...') : 'Settle'}</button>
          <button class="btn btn-g" onclick="liveSplitCancelSettle()">Cancel</button>
        </div>
      </div>
    `);
  }

  function peopleForVoiceSplitDraft(draft) {
    const selected = Array.isArray(draft?.selected_keys) ? draft.selected_keys : ['self'];
    return selected.map((key) => {
      if (String(key) === 'self') return { key: 'self', name: 'You' };
      const friend = (state.friends || []).find((item) => String(item.id) === String(key));
      return friend ? { key: String(friend.id), name: friend.name } : null;
    }).filter(Boolean);
  }

  function validateLiveSplitVoiceDraft(draft) {
    const people = peopleForVoiceSplitDraft(draft);
    const preview = computeShares(n(draft?.total_amount), String(draft?.split_mode || 'equal'), people, draft?.split_values || {});
    return {
      valid: !!preview?.valid,
      error: preview?.error || '',
      preview,
    };
  }

  function validateLiveSplitVoiceDrafts(drafts = []) {
    const issues = (Array.isArray(drafts) ? drafts : [])
      .map((draft, index) => {
        const validation = validateLiveSplitVoiceDraft(draft);
        if (validation.valid) return null;
        return {
          index,
          details: String(draft?.details || `Split ${index + 1}`).trim() || `Split ${index + 1}`,
          error: validation.error || 'Invalid split values.',
        };
      })
      .filter(Boolean);
    return {
      valid: !issues.length,
      issues,
    };
  }

  function renderLiveSplitVoiceCard(mode = 'split', drafts = [], transcript = '') {
    const isTrip = mode === 'trip';
    const isRecording = state.voiceRecorder?.state === 'recording' && String(state.voiceMode || 'split') === String(mode || 'split');
    const draftValidation = isTrip ? validateVoiceTripDrafts(drafts) : validateLiveSplitVoiceDrafts(drafts);
    const hint = isTrip ? 'Create trip using your voice.' : 'Add split using your voice.';
    const title = isTrip ? 'Voice AI Trip' : 'Voice AI Split';
    const preview = (Array.isArray(drafts) ? drafts : []).map((item, index) => {
      if (isTrip) {
        return `
          <div style="padding:10px 12px;border-radius:12px;background:#fff;border:1px solid var(--line)">
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
              <div style="min-width:0">
                <div style="font-size:13px;font-weight:800;color:var(--t1)">${index + 1}. ${escHtml(String(item?.name || 'Trip'))}</div>
                <div style="font-size:11px;color:var(--t2);margin-top:4px">${escHtml(String(item?.start_date || todayLocalIso()))}${item?.end_date ? ` to ${escHtml(String(item.end_date))}` : ''}</div>
                <div style="font-size:11px;color:var(--t2);margin-top:4px">${escHtml((item?.member_names || []).join(', ') || 'No members')}</div>
                ${Array.isArray(item?.unresolved_member_names) && item.unresolved_member_names.length ? `<div style="font-size:11px;color:var(--red);font-weight:700;margin-top:6px">Unknown friends: ${escHtml(item.unresolved_member_names.join(', '))}</div>` : ''}
              </div>
              <div style="font-size:11px;font-weight:700;color:${item?.show_add_to_expense_option === false ? 'var(--t2)' : 'var(--green)'};white-space:nowrap">${item?.show_add_to_expense_option === false ? 'Live Split only' : 'Add my share on'}</div>
            </div>
          </div>`;
      }
      const validation = validateLiveSplitVoiceDraft(item);
      return `
        <div style="padding:10px 12px;border-radius:12px;background:#fff;border:1px solid var(--line)">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
            <div style="min-width:0">
              <div style="font-size:13px;font-weight:800;color:var(--t1)">${index + 1}. ${escHtml(String(item?.details || 'Split expense'))}</div>
              <div style="font-size:11px;color:var(--t2);margin-top:4px">${escHtml(String(item?.divide_date || todayLocalIso()))} · ${escHtml(String(item?.paid_by || 'You'))}</div>
              <div style="font-size:11px;color:var(--t2);margin-top:4px">${escHtml((item?.participants || []).map((p) => `${p.name}: ${p.share_value}`).join(', ') || 'No participants')}</div>
              <div style="font-size:11px;color:var(--t2);margin-top:4px">${item?.card_id ? `Card: ${escHtml(String(item.card_id))}` : item?.bank_account_id ? `Bank: ${escHtml(String(item.bank_account_id))}` : 'No bank/card selected'}${item?.trip_name ? ` · Trip: ${escHtml(String(item.trip_name))}` : ''}${item?.addExpense ? ` · ${item.expense_type === 'extra' ? 'Extra' : 'Fair'}` : ''}</div>
              ${validation.valid ? '' : `<div style="font-size:11px;color:var(--red);font-weight:700;margin-top:6px">${escHtml(validation.error || 'Invalid split values')}</div>`}
            </div>
            <div style="font-size:14px;font-weight:800;color:var(--green);white-space:nowrap">${fmtCur(Number(item?.total_amount || 0))}</div>
          </div>
        </div>`;
    }).join('');
    return `
      <div style="margin-bottom:14px;padding:14px;border:1px solid var(--line);border-radius:14px;background:linear-gradient(180deg,#fbfdfc 0%,#f3f9f6 100%)">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <div>
            <div style="font-size:14px;font-weight:800;color:var(--em)">${title}</div>
            <div style="font-size:12px;color:var(--t2);margin-top:3px">${hint}</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn btn-s btn-sm" onclick="liveSplitVoiceStart('${mode}')" ${isRecording || state.voiceBusy ? 'disabled' : ''}>${state.voiceBusy ? 'Processing...' : isRecording ? 'Recording...' : 'Start Voice'}</button>
            <button type="button" class="btn btn-g btn-sm" onclick="liveSplitVoiceStop()" ${isRecording && !state.voiceBusy ? '' : 'disabled'}>Stop</button>
            <button type="button" class="btn btn-g btn-sm" onclick="liveSplitVoiceReset('${mode}')" ${state.voiceBusy ? 'disabled' : ''}>Reset</button>
          </div>
        </div>
        <div style="font-size:12px;color:var(--t3);margin-top:10px">${isRecording ? 'Listening now. Tap Stop when you finish speaking.' : state.voiceBusy ? 'Transcribing and updating draft list...' : 'Voice capture is idle.'}</div>
        ${transcript ? `<div style="margin-top:10px;padding:10px 12px;border-radius:12px;background:#fff;border:1px solid var(--line);font-size:12px;color:var(--t2);line-height:1.45;white-space:pre-wrap">${escHtml(transcript)}</div>` : ''}
        ${(drafts || []).length ? `<div style="font-size:12px;color:var(--t2);font-weight:700;margin-top:10px">${drafts.length} detected ${isTrip ? `trip${drafts.length === 1 ? '' : 's'}` : `split${drafts.length === 1 ? '' : 's'}`}. Save will add all detected entries.</div>` : ''}
        ${!draftValidation.valid ? `<div style="font-size:12px;color:var(--red);font-weight:700;margin-top:8px">${isTrip ? escHtml(draftValidation.error || 'Fix the detected trip members before saving.') : `Fix the detected split values before saving. ${escHtml(draftValidation.issues[0]?.error || '')}`}</div>` : ''}
        ${preview ? `<div style="display:grid;gap:8px;margin-top:10px">${preview}</div>` : ''}
      </div>`;
  }

  function liveSplitVoiceTargetForm(mode = 'split') {
    return mode === 'trip' ? state.tripCreate : state.create;
  }

  function renderLiveSplitVoiceCurrentModal(mode = 'split') {
    if (mode === 'trip') renderTripCreateModal();
    else renderCreateModal();
  }

  function cleanupLiveSplitVoiceCapture() {
    try {
      state.voiceRecorder = null;
      if (state.voiceStream) state.voiceStream.getTracks().forEach((track) => track.stop());
    } catch (_err) {}
    state.voiceStream = null;
    state.voiceChunks = [];
  }

  async function parseLiveSplitVoiceBlob(blob, mode = 'split') {
    const form = liveSplitVoiceTargetForm(mode);
    if (!form) return;
    state.voiceBusy = true;
    renderLiveSplitVoiceCurrentModal(mode);
    try {
      const fd = new FormData();
      const ext = blob.type.includes('mp4') || blob.type.includes('m4a') ? 'm4a' : 'webm';
      fd.append('file', blob, `live-split-voice.${ext}`);
      fd.append('mode', mode);
      if (Array.isArray(form.voice_drafts) && form.voice_drafts.length) fd.append('current_entries', JSON.stringify(form.voice_drafts));
      if (mode === 'split') {
        const anchoredFriendId = Number(form.voice_preferred_friend_id || 0);
        const preselectedFriendIds = anchoredFriendId > 0
          ? [anchoredFriendId]
          : [...(form.selected || new Set())]
              .map((value) => Number(value))
              .filter((value) => value > 0);
        if (preselectedFriendIds.length) fd.append('preselected_friend_ids', JSON.stringify(preselectedFriendIds));
        if (anchoredFriendId > 0) fd.append('preferred_friend_id', String(anchoredFriendId));
        else if (preselectedFriendIds.length === 1) fd.append('preferred_friend_id', String(preselectedFriendIds[0]));
        if (Number(form.trip_id || 0) > 0) fd.append('preferred_trip_id', String(Number(form.trip_id)));
      }
      const res = await fetch('/api/live-split/voice-prefill', { method: 'POST', body: fd });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result?.error || `Voice parse failed with HTTP ${res.status}`);
      const suggestions = Array.isArray(result?.suggestions) ? result.suggestions : [];
      if (!suggestions.length) throw new Error('Voice parse did not return any live split entries.');
      form.voice_drafts = suggestions;
      form.voice_transcript = [form.voice_transcript || '', String(result?.transcript || '').trim()].filter(Boolean).join('\n');
      toast('Voice details added', 'success');
    } catch (error) {
      toast(error?.message || 'Could not parse live split voice note', 'error');
    } finally {
      state.voiceBusy = false;
      renderLiveSplitVoiceCurrentModal(mode);
    }
  }

  async function startLiveSplitVoiceCapture(mode = 'split') {
    if (state.voiceBusy || state.voiceRecorder?.state === 'recording') return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast('Voice capture is not supported in this browser', 'error');
      return;
    }
    try {
      state.voiceMode = mode;
      state.voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.voiceChunks = [];
      state.voiceRecorder = new MediaRecorder(state.voiceStream);
      state.voiceRecorder.ondataavailable = (event) => {
        if (event.data?.size) state.voiceChunks.push(event.data);
      };
      state.voiceRecorder.onstop = async () => {
        const blob = state.voiceChunks.length ? new Blob(state.voiceChunks, { type: state.voiceRecorder?.mimeType || 'audio/webm' }) : null;
        cleanupLiveSplitVoiceCapture();
        if (state.voiceIgnoreNextResult) {
          state.voiceIgnoreNextResult = false;
          renderLiveSplitVoiceCurrentModal(mode);
          return;
        }
        if (!blob || !blob.size) {
          toast('No audio captured. Please try again.', 'warning');
          renderLiveSplitVoiceCurrentModal(mode);
          return;
        }
        await parseLiveSplitVoiceBlob(blob, mode);
      };
      state.voiceRecorder.start();
      renderLiveSplitVoiceCurrentModal(mode);
    } catch (error) {
      cleanupLiveSplitVoiceCapture();
      toast(error?.message || 'Could not start microphone', 'error');
      renderLiveSplitVoiceCurrentModal(mode);
    }
  }

  function stopLiveSplitVoiceCapture() {
    if (!state.voiceRecorder || state.voiceRecorder.state !== 'recording') return;
    state.voiceBusy = true;
    renderLiveSplitVoiceCurrentModal(state.voiceMode || 'split');
    state.voiceRecorder.stop();
  }

  function resetLiveSplitVoice(mode = 'split') {
    const form = liveSplitVoiceTargetForm(mode);
    if (!form) return;
    if (state.voiceRecorder?.state === 'recording') state.voiceIgnoreNextResult = true;
    if (state.voiceRecorder?.state === 'recording') {
      try { state.voiceRecorder.stop(); } catch (_err) {}
    }
    form.voice_drafts = [];
    form.voice_transcript = '';
    renderLiveSplitVoiceCurrentModal(mode);
  }

  function hasLiveSplitVoiceDrafts(form) {
    return !!(form && Array.isArray(form.voice_drafts) && form.voice_drafts.length);
  }

  async function persistLiveSplitEntry(entry) {
    const total = r2(entry?.total_amount);
    const normalizedDate = toLocalIsoDate(entry?.divide_date, todayLocalIso());
    const details = String(entry?.details || '').trim() || 'Split expense';
    const shares = Array.isArray(entry?.participants) ? entry.participants : [];
    const selfShare = r2((shares.find((share) => String(share?.key || '') === 'self') || {}).share_value || 0);
    const splitsPayload = shares
      .filter((share) => String(share?.key || '') !== 'self' && Number(share?.share_value || 0) > 0)
      .map((share) => ({
        friend_id: Number(share.key),
        friend_name: share.name,
        share_amount: r2(share.share_value),
      }));
    const sessionKey = `live_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const createBody = {
      divide_date: normalizedDate,
      details,
      paid_by: String(entry?.paid_by || 'You').trim() || 'You',
      total_amount: total,
      split_mode: String(entry?.split_mode || 'equal'),
      trip_id: Number(entry?.trip_id || 0) > 0 ? Number(entry.trip_id) : null,
      splits: splitsPayload,
      heading: details,
      session_id: sessionKey,
      owner_added_to_expense: !!(entry?.addExpense && selfShare > 0),
    };
    let createResult = await api('/api/live-split/groups', {
      method: 'POST',
      body: createBody,
    });
    if (createResult?.status === 409 && isLiveSplitDuplicateWarning(createResult)) {
      const shouldAddAgain = await confirmDialog(liveSplitDuplicateConfirmHtml(createResult.error));
      if (!shouldAddAgain) return { skipped: true };
      createResult = await api('/api/live-split/groups', {
        method: 'POST',
        body: { ...createBody, allow_duplicate: true },
      });
    }
    if (!createResult || createResult.error) {
      throw new Error(createResult?.error || 'Could not save live split');
    }

    const linkedFriendIds = splitsPayload
      .map((split) => state.appFriends.find((friend) => Number(friend.id) === Number(split.friend_id)))
      .filter((friend) => friend && Number(friend.linked_user_id) > 0)
      .map((friend) => Number(friend.id));
    if (linkedFriendIds.length) {
      const shareResult = await api('/api/live-split/groups/share-session', {
        method: 'POST',
        body: { session_key: sessionKey, friend_ids: [...new Set(linkedFriendIds)] },
      });
      if (shareResult?.error) throw new Error(shareResult.error);
    }

    if (entry?.addExpense && selfShare > 0) {
      const expenseResult = await api('/api/expenses', {
        method: 'POST',
        body: {
          item_name: details,
          category: entry?.category ? String(entry.category).trim() : null,
          amount: selfShare,
          purchase_date: normalizedDate,
          is_extra: String(entry?.expense_type || 'fair') === 'extra',
          bank_account_id: null,
        },
      });
      if (expenseResult?.error) throw new Error(expenseResult.error);
    }

    const payerIsSelf = String(entry?.paid_by_key || 'self') === 'self';
    if (payerIsSelf && total > 0) {
      if (String(entry?.finance_target || 'none') === 'card' && Number(entry?.card_id || 0) > 0) {
        const cardTxnResult = await api('/api/cc/txns', {
          method: 'POST',
          body: {
            card_id: Number(entry.card_id),
            txn_date: normalizedDate,
            description: details,
            amount: total,
            discount_pct: Number(entry?.card_discount_pct || 0),
            source: 'live_split',
          },
        });
        if (cardTxnResult?.error) throw new Error(cardTxnResult.error);
      } else if (String(entry?.finance_target || 'none') === 'expense' && Number(entry?.bank_account_id || 0) > 0) {
        const bankId = Number(entry.bank_account_id);
        const bank = (state.bankAccounts || []).find((item) => Number(item.id) === bankId);
        if (bank) {
          const nextBalance = r2(Number(bank.balance || 0) - total);
          const bankResult = await api(`/api/banks/${bankId}/balance`, {
            method: 'PATCH',
            body: { balance: nextBalance >= 0 ? nextBalance : 0 },
          });
          if (bankResult?.error) throw new Error(bankResult.error);
        }
      }
    }
    return { skipped: false };
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
    setupCreateForFriend(id);
    closeModal();
    renderCreateModal();
  }

  function setupCreateForFriend(friendId) {
    const id = Number(friendId);
    state.create = createInitialForm();
    state.createInvite = { query: '', results: [], searching: false, searched: false };
    if (id > 0) {
      state.create.selected = new Set(['self', String(id)]);
      state.create.voice_preferred_friend_id = id;
    }
    if ([...state.create.selected].filter((key) => key !== 'self').length > 0) state.create.step = 2;
  }

  function openVoiceSplitForFriend(friendId) {
    setupCreateForFriend(friendId);
    closeModal();
    if (state.create) {
      state.create.voice_only = true;
      state.create.step = 2;
      renderCreateModal();
    }
    startLiveSplitVoiceCapture('split').catch(() => {});
    Promise.resolve(ensureFinanceOptionsLoaded()).catch(() => {});
  }

  function openVoiceTripCreate() {
    openTripCreateModal();
    if (state.tripCreate) {
      state.tripCreate.voice_only = true;
      renderTripCreateModal();
    }
    startLiveSplitVoiceCapture('trip').catch(() => {});
  }

  function openVoiceSplitFromTrip(tripId) {
    setupCreateFromTrip(tripId);
    if (state.create) {
      state.create.voice_only = true;
      state.create.step = 2;
      renderCreateModal();
    }
    startLiveSplitVoiceCapture('split').catch(() => {});
    Promise.resolve(ensureFinanceOptionsLoaded()).catch(() => {});
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
        linked_user_avatar_url: (state.friends || []).find((friend) => String(friend?.name || '').trim().toLowerCase() === String(invite.target_name || invite.target_display_name || invite.target_username || invite.target_email || invite.target_phone || '').trim().toLowerCase())?.linked_user_avatar_url || '',
        name: String(invite.target_name || invite.target_display_name || invite.target_username || invite.target_email || invite.target_phone || 'Friend').trim(),
        canResend: true,
      })),
      ...pendingFriends
        .filter((friend) => !outgoingNames.has(String(friend.name || '').trim().toLowerCase()))
        .map((friend) => ({
          id: `friend-${friend.id}`,
          inviteId: null,
          friendId: friend.id,
          linked_user_avatar_url: friend.linked_user_avatar_url || '',
          name: friend.name || 'Friend',
          canResend: false,
        })),
    ];
    return merged;
  }

  function renderPendingInviteCard(friend) {
    const inviteId = Number(friend?.inviteId || 0);
    const friendId = Number(friend?.friendId || 0);
    const cancelBusy = inviteId > 0 && state.outgoingCancelBusy.has(inviteId);
    const deleteBusy = friendId > 0 && state.friendDeleteBusy.has(friendId);
    const canDelete = friendId > 0;
    const resendAction = friend.canResend
      ? `liveSplitResendInvite(${Number(friend.id)})`
      : `liveSplitResendInviteByName('${encodeURIComponent(friend.name || '')}')`;
    return `
      <div class="friend-card live-split-card live-split-pending-card" style="cursor:default">
        <div class="live-split-pending-main">
          <div class="live-split-pending-avatar">
            ${_renderAvatar(friend.name, friend.linked_user_avatar_url, 'background:#f5f7fa;color:var(--t2)')}
          </div>
          <div class="friend-info live-split-pending-copy">
            <div class="live-split-pending-head">
              <div class="friend-name">${escHtml(friend.name || 'Friend')}</div>
              <div class="live-split-pending-status">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.75a10.25 10.25 0 1 0 10.25 10.25A10.26 10.26 0 0 0 12 1.75Zm0 18.5A8.25 8.25 0 1 1 20.25 12 8.26 8.26 0 0 1 12 20.25Zm.75-13h-1.5v5.19l4.09 2.45.77-1.28-3.36-2.01Z"/></svg>
                <span>Pending</span>
              </div>
            </div>
            <div class="live-split-pending-meta">Invite sent. Waiting for them to join or link their account.</div>
          </div>
        </div>
        <div class="live-split-pending-actions">
          ${inviteId ? `<button class="live-split-icon-btn soft" title="${cancelBusy ? 'Cancelling...' : 'Cancel invite'}" aria-label="${cancelBusy ? 'Cancelling...' : 'Cancel invite'}" ${cancelBusy ? 'disabled' : ''} onclick="liveSplitCancelInvite(${inviteId})">${cancelBusy ? '<span style="font-size:11px;line-height:1">...</span>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.29 19.7 2.88 18.3 9.17 12 2.88 5.71 4.29 4.29l6.3 6.3 6.29-6.3z"/></svg>'}</button>` : ''}
          <button class="live-split-icon-btn" title="Send invite again" aria-label="Send invite again" onclick="${resendAction}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6V3L8 7l4 4V8c2.76 0 5 2.24 5 5a5 5 0 0 1-8.66 3.42l-1.42 1.42A7 7 0 1 0 12 6z"/></svg></button>
          ${canDelete ? `<button class="live-split-icon-btn danger" title="${deleteBusy ? 'Deleting...' : 'Delete pending entry'}" aria-label="${deleteBusy ? 'Deleting...' : 'Delete pending entry'}" ${deleteBusy ? 'disabled' : ''} onclick="liveSplitDeleteFriend(${friendId})">${deleteBusy ? '<span style="font-size:11px;line-height:1">...</span>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12v2H6V7zm2 3h8l-.7 9.1c-.1 1.1-1 1.9-2.1 1.9h-2.4c-1.1 0-2-.8-2.1-1.9L8 10zm3-5h2l1 1h4v2H6V6h4l1-1z"/></svg>'}</button>` : ''}
        </div>
      </div>
    `;
  }

  function renderPendingInvites() {
    const pending = getPendingInviteRows();
    if (!pending.length) return '';
    return `
      <div style="margin-top:14px">
        <div style="font-size:13px;font-weight:800;color:var(--t2);margin-bottom:8px">Pending Invites (${pending.length})</div>
        <div style="display:grid;gap:8px">
          ${pending.map(renderPendingInviteCard).join('')}
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
        ${pending.map(renderPendingInviteCard).join('')}
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
    if (
      friendResult.status !== 'fulfilled'
      || divideResult.status !== 'fulfilled'
      || friendResult.value?.error
      || divideResult.value?.error
    ) {
      throw new Error(
        friendResult.value?.error
        || divideResult.value?.error
        || friendResult.reason?.message
        || divideResult.reason?.message
        || 'Could not load live split'
      );
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
    const voiceOnly = !!form.voice_only;
    const voiceDraftValidation = validateLiveSplitVoiceDrafts(form.voice_drafts || []);
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
    if (form.step === 1 && !voiceOnly) {
      const outgoingNames = new Set((state.outgoingInvites || []).map((invite) => String(invite.target_name || invite.target_display_name || invite.target_username || '').trim().toLowerCase()).filter(Boolean));
      const scopedFriendIds = getTripScopedFriendIds(form.trip_id);
      const selectableFriends = (state.friends || [])
        .filter((friend) => !Number(friend?.linked_user_id) || Number(friend?.linked_user_id) > 0)
        .filter((friend) => !scopedFriendIds || scopedFriendIds.has(Number(friend.id)));
      openModal('Live Split - Select Friends', `
        <div style="display:grid;gap:10px">
          ${(voiceOnly || hasLiveSplitVoiceDrafts(form)) ? renderLiveSplitVoiceCard('split', form.voice_drafts, form.voice_transcript) : ''}
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
      ${(voiceOnly || hasLiveSplitVoiceDrafts(form)) ? renderLiveSplitVoiceCard('split', form.voice_drafts, form.voice_transcript) : ''}
      ${(voiceOnly || hasLiveSplitVoiceDrafts(form)) ? `
        <div style="padding:12px;border:1px solid rgba(22,101,52,.14);border-radius:12px;background:#ecfdf3;font-size:12px;color:var(--t2);margin-bottom:12px">
          Voice split drafts are ready below. Save will add every detected split. Record again to append or update the list, or use Reset to clear it and return to manual entry.
        </div>
        ${form.voice_drafts?.length ? `
          <div class="fa" style="margin-bottom:12px">
            <button class="btn btn-p" ${state.saveBusy || !voiceDraftValidation.valid ? 'disabled' : ''} onclick="liveSplitSave()">${state.saveBusy ? liveSplitBusyLabel('Saving...') : 'Save Detected Splits'}</button>
            <button class="btn btn-g" ${state.saveBusy ? 'disabled' : ''} onclick="closeModal()">Cancel</button>
          </div>
          ${voiceDraftValidation.valid ? '' : `<div style="font-size:12px;color:var(--red);font-weight:700;margin:-4px 0 12px">Detected split totals do not match. ${escHtml(voiceDraftValidation.issues[0]?.error || '')}</div>`}
        ` : ''}
      ` : ''}
      ${(voiceOnly || hasLiveSplitVoiceDrafts(form)) ? '' : `
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
      </div>
      `}`);
  }

  function openTripCreateModal() {
    state.tripCreate = createInitialTripForm();
    renderTripCreateModal();
  }

  function tripCreateSelectedFriends(form) {
    return [...(form?.selected || new Set())]
      .map((id) => (state.friends || []).find((friend) => String(friend?.id) === String(id)))
      .filter(Boolean);
  }

  function tripCreatePayerOptions(form) {
    return [
      'You',
      ...tripCreateSelectedFriends(form)
        .map((friend) => String(friend?.name || '').trim())
        .filter(Boolean),
    ].filter((name, index, arr) => arr.findIndex((item) => textKey(item) === textKey(name)) === index);
  }

  async function rebuildTripReceiptScanFromFiles(nextFiles = [], { nextTripName = '' } = {}) {
    const form = state.tripCreate;
    if (!form) return;
    if (!nextFiles.length) {
      form.scan_files = [];
      form.scan_items = [];
      form.scan_merchant = '';
      form.scan_total_amount = 0;
      form.scan_tax_override = '';
      form.scan_debug = null;
      renderTripCreateModal();
      return;
    }
    const fd = new FormData();
    nextFiles.forEach((file) => fd.append('files', file));
    fd.append('reference_date', String(form.bulk_date || form.start_date || todayLocalIso()));
    fd.append('scan_context', 'trip_bill');
    const response = await fetch('/api/expenses/scan-images-batch', { method: 'POST', body: fd });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || payload?.message || `HTTP ${response.status}`);

    const selectedFriends = tripCreateSelectedFriends(form);
    const previousSelectionMap = new Map(
      (form.scan_items || []).map((item) => [buildTripScanMatchKey(item), {
        assignment: item?.assignment,
        selected: item?.selected,
        item_name: item?.item_name,
        participant_keys: item?.participant_keys,
        split_mode: item?.split_mode,
        split_values: item?.split_values,
      }]).filter(([key]) => !!key)
    );
    const normalized = normalizeTripReceiptScanDraft(payload?.draft || {}, {
      fallbackDate: form.start_date || todayLocalIso(),
      defaultAssignment: selectedFriends.length ? 'shared' : 'self',
      pageIndex: nextFiles.length,
      selectedFriendIds: selectedFriends.map((friend) => Number(friend.id)),
    });
    normalized.items = normalized.items.map((item) => {
      const previous = previousSelectionMap.get(buildTripScanMatchKey(item));
      if (!previous) return item;
      return {
        ...item,
        assignment: previous.assignment || item.assignment,
        selected: previous.selected !== undefined ? previous.selected : item.selected,
        item_name: previous.item_name || item.item_name,
        participant_keys: Array.isArray(previous.participant_keys) ? previous.participant_keys : item.participant_keys,
        split_mode: previous.split_mode || item.split_mode,
        split_values: previous.split_values || item.split_values,
      };
    });

    form.scan_files = nextFiles;
    form.scan_merchant = normalized.merchant || '';
    form.scan_total_amount = Number(normalized.total_amount || 0) || 0;
    form.scan_tax_override = '';
    form.scan_debug = payload?.debug || null;
    form.scan_items = normalized.items;
    form.scan_items = form.scan_items.map((item) => normalizeTripScanRowSplitState(item, form));
    if (!String(nextTripName || form.name || '').trim() && normalized.merchant && normalized.merchant !== 'Scanned bill') {
      form.name = `${normalized.merchant} Trip`;
    }
    renderTripCreateModal();
  }

  function liveSplitTriggerTripScanPick(source = 'upload') {
    if (!state.tripCreate || state.tripSaveBusy) return;
    syncTripCreateDraftFromDom();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = source !== 'camera';
    if (source === 'camera') input.capture = 'environment';
    input.onchange = async () => {
      const files = Array.from(input.files || []).filter(Boolean);
      if (!files.length || !state.tripCreate) return;
      try {
        state.tripSaveBusy = true;
        renderTripCreateModal();
        await rebuildTripReceiptScanFromFiles([...(state.tripCreate.scan_files || []), ...files], { nextTripName: state.tripCreate.name || '' });
      } catch (error) {
        toast(error?.message || 'Could not scan these images', 'error');
      } finally {
        state.tripSaveBusy = false;
        if (state.tripCreate) renderTripCreateModal();
      }
    };
    input.click();
  }

  async function removeLastTripReceiptScanPageWeb() {
    if (!state.tripCreate || state.tripSaveBusy || !(state.tripCreate.scan_files || []).length) return;
    syncTripCreateDraftFromDom();
    try {
      state.tripSaveBusy = true;
      renderTripCreateModal();
      await rebuildTripReceiptScanFromFiles((state.tripCreate.scan_files || []).slice(0, -1), { nextTripName: state.tripCreate.name || '' });
    } catch (error) {
      toast(error?.message || 'Could not remove the last scanned page', 'error');
    } finally {
      state.tripSaveBusy = false;
      if (state.tripCreate) renderTripCreateModal();
    }
  }

  function captureTripCreateModalUiState() {
    if (typeof document === 'undefined') return null;
    const overlay = document.getElementById('modalOverlay');
    const active = document.activeElement;
    const focus = {};
    if (active && active.closest && active.closest('#modalContent')) {
      const dataset = active.dataset || {};
      if (dataset.tripScanKey && dataset.tripScanField) {
        focus.kind = 'trip-scan-field';
        focus.key = String(dataset.tripScanKey);
        focus.field = String(dataset.tripScanField);
      } else if (dataset.tripScanKey && dataset.tripScanSplitPerson) {
        focus.kind = 'trip-scan-split';
        focus.key = String(dataset.tripScanKey);
        focus.person = String(dataset.tripScanSplitPerson);
      } else if (dataset.tripManualKey && dataset.tripManualField) {
        focus.kind = 'trip-manual-field';
        focus.key = String(dataset.tripManualKey);
        focus.field = String(dataset.tripManualField);
      } else if (dataset.tripManualKey && dataset.tripManualSplitPerson) {
        focus.kind = 'trip-manual-split';
        focus.key = String(dataset.tripManualKey);
        focus.person = String(dataset.tripManualSplitPerson);
      } else if (active.id) {
        focus.kind = 'id';
        focus.id = active.id;
      }
      if (typeof active.selectionStart === 'number') focus.selectionStart = active.selectionStart;
      if (typeof active.selectionEnd === 'number') focus.selectionEnd = active.selectionEnd;
    }
    return {
      overlayScrollTop: overlay ? overlay.scrollTop : 0,
      focus,
    };
  }

  function restoreTripCreateModalUiState(snapshot) {
    if (!snapshot || typeof document === 'undefined') return;
    const overlay = document.getElementById('modalOverlay');
    if (overlay) overlay.scrollTop = Number(snapshot.overlayScrollTop || 0);
    const focus = snapshot.focus || {};
    let target = null;
    if (focus.kind === 'trip-scan-field' && focus.key && focus.field) {
      target = [...document.querySelectorAll('#modalContent [data-trip-scan-key][data-trip-scan-field]')].find((node) => (
        String(node.getAttribute('data-trip-scan-key') || '') === String(focus.key)
        && String(node.getAttribute('data-trip-scan-field') || '') === String(focus.field)
      )) || null;
    } else if (focus.kind === 'trip-scan-split' && focus.key && focus.person) {
      target = [...document.querySelectorAll('#modalContent [data-trip-scan-key][data-trip-scan-split-person]')].find((node) => (
        String(node.getAttribute('data-trip-scan-key') || '') === String(focus.key)
        && String(node.getAttribute('data-trip-scan-split-person') || '') === String(focus.person)
      )) || null;
    } else if (focus.kind === 'trip-manual-field' && focus.key && focus.field) {
      target = [...document.querySelectorAll('#modalContent [data-trip-manual-key][data-trip-manual-field]')].find((node) => (
        String(node.getAttribute('data-trip-manual-key') || '') === String(focus.key)
        && String(node.getAttribute('data-trip-manual-field') || '') === String(focus.field)
      )) || null;
    } else if (focus.kind === 'trip-manual-split' && focus.key && focus.person) {
      target = [...document.querySelectorAll('#modalContent [data-trip-manual-key][data-trip-manual-split-person]')].find((node) => (
        String(node.getAttribute('data-trip-manual-key') || '') === String(focus.key)
        && String(node.getAttribute('data-trip-manual-split-person') || '') === String(focus.person)
      )) || null;
    } else if (focus.kind === 'id' && focus.id) {
      target = document.getElementById(focus.id);
    }
    if (!target || typeof target.focus !== 'function') return;
    try {
      target.focus({ preventScroll: true });
    } catch (_err) {
      target.focus();
    }
    if (typeof focus.selectionStart === 'number' && typeof target.setSelectionRange === 'function') {
      try {
        target.setSelectionRange(focus.selectionStart, typeof focus.selectionEnd === 'number' ? focus.selectionEnd : focus.selectionStart);
      } catch (_err) {}
    }
  }

  function rerenderTripCreateModalPreservingUi() {
    const snapshot = captureTripCreateModalUiState();
    renderTripCreateModal();
    restoreTripCreateModalUiState(snapshot);
  }

  function updateTripScanItemWeb(itemKey, patch = {}) {
    const form = state.tripCreate;
    if (!form) return;
    form.scan_items = (form.scan_items || []).map((item) => {
      if (String(item.key) !== String(itemKey)) return item;
      return normalizeTripScanRowSplitState({ ...item, ...patch }, form);
    });
    rerenderTripCreateModalPreservingUi();
  }

  function deleteTripScanItemWeb(itemKey) {
    const form = state.tripCreate;
    if (!form) return;
    form.scan_items = (form.scan_items || []).filter((item) => String(item.key) !== String(itemKey));
    renderTripCreateModal();
  }

  function syncTripCreateDraftFromDom() {
    const form = state.tripCreate;
    if (!form || typeof document === 'undefined') return;

    const tripNameInput = document.querySelector('[data-trip-field="name"]');
    if (tripNameInput) form.name = String(tripNameInput.value || '');

    const scanPatches = new Map();
    document.querySelectorAll('[data-trip-scan-key][data-trip-scan-field]').forEach((node) => {
      const key = String(node.getAttribute('data-trip-scan-key') || '');
      const field = String(node.getAttribute('data-trip-scan-field') || '');
      if (!key || !field) return;
      if (!scanPatches.has(key)) scanPatches.set(key, {});
      scanPatches.get(key)[field] = String(node.value || '');
    });
    if (scanPatches.size) {
      form.scan_items = (form.scan_items || []).map((item) => (
        scanPatches.has(String(item.key || ''))
          ? { ...item, ...scanPatches.get(String(item.key || '')) }
          : item
      ));
    }

    document.querySelectorAll('[data-trip-scan-key][data-trip-scan-selected]').forEach((node) => {
      const key = String(node.getAttribute('data-trip-scan-key') || '');
      if (!key) return;
      form.scan_items = (form.scan_items || []).map((item) => (
        String(item.key || '') === key
          ? { ...item, selected: !!node.checked }
          : item
      ));
    });

    const manualPatches = new Map();
    document.querySelectorAll('[data-trip-manual-key][data-trip-manual-field]').forEach((node) => {
      const key = String(node.getAttribute('data-trip-manual-key') || '');
      const field = String(node.getAttribute('data-trip-manual-field') || '');
      if (!key || !field) return;
      if (!manualPatches.has(key)) manualPatches.set(key, {});
      manualPatches.get(key)[field] = String(node.value || '');
    });
    if (manualPatches.size) {
      form.manual_items = (form.manual_items || []).map((item) => (
        manualPatches.has(String(item.key || ''))
          ? { ...item, ...manualPatches.get(String(item.key || '')) }
          : item
      ));
    }

    const manualSplitPatches = new Map();
    document.querySelectorAll('[data-trip-manual-key][data-trip-manual-split-person]').forEach((node) => {
      const key = String(node.getAttribute('data-trip-manual-key') || '');
      const person = String(node.getAttribute('data-trip-manual-split-person') || '');
      if (!key || !person) return;
      if (!manualSplitPatches.has(key)) manualSplitPatches.set(key, {});
      manualSplitPatches.get(key)[person] = String(node.value || '');
    });
    if (manualSplitPatches.size) {
      form.manual_items = (form.manual_items || []).map((item) => (
        manualSplitPatches.has(String(item.key || ''))
          ? { ...item, split_values: { ...(item.split_values || {}), ...manualSplitPatches.get(String(item.key || '')) } }
          : item
      ));
    }
  }

  function selectAllTripScanItemsWeb(checked) {
    const form = state.tripCreate;
    if (!form) return;
    form.scan_items = (form.scan_items || []).map((item) => ({ ...item, selected: !!checked }));
    renderTripCreateModal();
  }

  function resetTripReceiptScanStateWeb() {
    const form = state.tripCreate;
    if (!form) return;
    syncTripCreateDraftFromDom();
    form.scan_files = [];
    form.scan_items = [];
    form.scan_merchant = '';
    form.scan_total_amount = 0;
    form.scan_tax_override = '';
    form.scan_debug = null;
    renderTripCreateModal();
  }

  function applyTripCreateMetaToRowsWeb({ dateValue = null } = {}) {
    const form = state.tripCreate;
    if (!form) return;
    const nextDate = dateValue ? toLocalIsoDate(dateValue, form.start_date || todayLocalIso()) : '';
    if (nextDate) {
      form.bulk_date = nextDate;
      form.scan_items = (form.scan_items || []).map((item) => ({ ...item, purchase_date: nextDate }));
      form.manual_items = (form.manual_items || []).map((item) => ({ ...item, purchase_date: nextDate }));
    }
    rerenderTripCreateModalPreservingUi();
  }

  function addTripManualItemWeb() {
    const form = state.tripCreate;
    if (!form) return;
    syncTripCreateDraftFromDom();
    form.manual_items = [...(form.manual_items || []), createTripManualEntry((form.manual_items || []).length, 'self', form)].map((item) => normalizeTripManualRowSplitState(item, form));
    renderTripCreateModal();
  }

  function updateTripManualItemWeb(itemKey, patch = {}) {
    const form = state.tripCreate;
    if (!form) return;
    syncTripCreateDraftFromDom();
    form.manual_items = (form.manual_items || []).map((item) => (
      String(item.key) === String(itemKey)
        ? normalizeTripManualRowSplitState({ ...item, ...patch }, form)
        : item
    ));
    rerenderTripCreateModalPreservingUi();
  }

  function deleteTripManualItemWeb(itemKey) {
    const form = state.tripCreate;
    if (!form) return;
    const nextItems = (form.manual_items || []).filter((item) => String(item.key) !== String(itemKey));
    form.manual_items = nextItems.length ? nextItems : [createTripManualEntry(0, 'self', form)];
    renderTripCreateModal();
  }

  function renderTripCreateModal() {
    const form = state.tripCreate;
    if (!form) return;
    const voiceOnly = !!form.voice_only;
    const selectableFriends = (state.friends || []);
    const selectedFriends = tripCreateSelectedFriends(form);
    const selectedFriendCount = selectedFriends.length;
    const scanSelectedRows = (form.scan_items || []).filter((item) => item?.selected !== false);
    const scanSelectedTotal = r2(scanSelectedRows.reduce((sum, item) => sum + getTripScanRowEffectiveAmount(form, item), 0));
    const scanSelectedMyShare = r2(scanSelectedRows.reduce((sum, item) => sum + computeTripRowSelfShare(item, selectedFriendCount), 0));
    const scanDetectedDate = form.scan_items?.length
      ? toLocalIsoDate((form.scan_items.find((item) => String(item?.purchase_date || '').trim())?.purchase_date) || form.start_date, todayLocalIso())
      : '';
    const scanSubtotalAll = getTripScanSubtotalAll(form);
    const scanTaxTotal = getTripScanReceiptTax(form);
    const scanTaxPct = getTripScanReceiptTaxPct(form);
    const scanSelectedTax = r2(scanSelectedRows.reduce((sum, item) => sum + getTripScanRowTaxShare(form, item), 0));
    const manualRows = (form.manual_items || []).map((item) => normalizeTripManualRowSplitState({ ...item }, form));
    const manualActiveRows = manualRows.filter((item) => String(item?.item_name || '').trim() || Number(item?.amount || 0) > 0);
    const manualTotal = r2(manualActiveRows.reduce((sum, item) => sum + n(item?.amount), 0));
    const manualMyShare = r2(manualActiveRows.reduce((sum, item) => sum + computeTripRowSelfShare(item, selectedFriendCount), 0));
    openModal('Live Split Trip - New', `
      ${(voiceOnly || hasLiveSplitVoiceDrafts(form)) ? renderLiveSplitVoiceCard('trip', form.voice_drafts, form.voice_transcript) : ''}
      ${(voiceOnly || hasLiveSplitVoiceDrafts(form)) ? `
        <div style="padding:12px;border:1px solid rgba(22,101,52,.14);border-radius:12px;background:#ecfdf3;font-size:12px;color:var(--t2);margin-bottom:12px">
          Voice trip drafts are ready below. Create Trip will add every detected trip. Record again to append or update the list, or use Reset to clear it and return to manual entry.
        </div>
        ${form.voice_drafts?.length ? `
          ${(() => {
            const tripValidation = validateVoiceTripDrafts(form.voice_drafts);
            return tripValidation.valid ? '' : `<div style="margin-bottom:12px;padding:10px 12px;border:1px solid rgba(220,38,38,.18);border-radius:12px;background:#fff5f5;font-size:12px;color:#991b1b">${escHtml(tripValidation.error || 'Voice trip drafts are invalid.')}</div>`;
          })()}
          <div class="fa" style="margin-bottom:12px">
            <button class="btn btn-p" ${state.tripSaveBusy ? 'disabled' : ''} onclick="liveSplitTripSave()">${state.tripSaveBusy ? liveSplitBusyLabel('Saving...') : 'Create Detected Trips'}</button>
            <button class="btn btn-g" ${state.tripSaveBusy ? 'disabled' : ''} onclick="closeModal()">Cancel</button>
          </div>
        ` : ''}
      ` : ''}
      ${(voiceOnly || hasLiveSplitVoiceDrafts(form)) ? '' : `
      <div class="fg">
        <label class="fl full">Trip Name
          <input class="fi" data-trip-field="name" value="${escHtml(form.name || '')}" placeholder="Goa 2026, Team Offsite..." onchange="liveSplitTripField('name', this.value)">
        </label>
        <label class="fl">Start Date
          <input class="fi" type="date" value="${escHtml(form.start_date || todayLocalIso())}" onchange="liveSplitTripField('start_date', this.value)">
        </label>
        <label class="fl">End Date (optional)
          <input class="fi" type="date" value="${escHtml(form.end_date || '')}" onchange="liveSplitTripField('end_date', this.value)">
        </label>
      </div>
      <div style="margin-top:10px;padding:14px;border:1px solid #d8deea;border-radius:14px;background:linear-gradient(180deg,#f8fbff 0%,#f4faf7 100%)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
          <div style="flex:1;min-width:220px">
            <div style="font-size:14px;font-weight:800;color:var(--t1)">Apply To All Trip Entries</div>
            <div style="font-size:12px;color:var(--t2);margin-top:3px">Choose one payer and one bill date that should be used for every row created from this receipt or manual list.</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span class="badge" style="background:#fff;color:#35518f">Paid by ${escHtml(form.paid_by || 'You')}</span>
            <span class="badge" style="background:#fff;color:#145a3c">${escHtml(form.bulk_date || form.start_date || todayLocalIso())}</span>
          </div>
        </div>
        <div class="fg" style="margin-top:10px">
          <label class="fl">Paid By
            <select class="fi" onchange="liveSplitTripBulkPaidBy(this.value)">
              ${tripCreatePayerOptions(form).map((name) => `<option value="${escHtml(name)}" ${textKey(form.paid_by || 'You') === textKey(name) ? 'selected' : ''}>${escHtml(name)}</option>`).join('')}
            </select>
          </label>
          <label class="fl">Entry Date For All
            <input class="fi" type="date" value="${escHtml(form.bulk_date || form.start_date || todayLocalIso())}" onchange="liveSplitTripBulkDate(this.value)">
          </label>
        </div>
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
      <div style="margin-top:12px;padding:14px;border:1px solid #cfe5d9;border-radius:14px;background:#f6fbf8">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
          <div style="flex:1;min-width:220px">
            <div style="font-size:14px;font-weight:800;color:var(--em)">Scan Bill To Trip</div>
            <div style="font-size:12px;color:var(--t2);margin-top:3px">Upload images or click a receipt photo. AI reads the receipt, merges pages, and prepares editable rows before saving them into this trip.</div>
            ${(form.scan_files || []).length ? `<div style="margin-top:6px;font-size:12px;color:var(--t2);font-weight:700">${Number(form.scan_files.length)} page${Number(form.scan_files.length) === 1 ? '' : 's'} added</div>` : ''}
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-s btn-sm" ${state.tripSaveBusy ? 'disabled' : ''} onclick="liveSplitTripScanPick('camera')">${(form.scan_items || []).length ? 'Add Clicked Image' : 'Click Image'}</button>
            <button class="btn btn-g btn-sm" ${state.tripSaveBusy ? 'disabled' : ''} onclick="liveSplitTripScanPick('upload')">${(form.scan_items || []).length ? 'Add Upload Image' : 'Upload Image'}</button>
            ${(form.scan_items || []).length ? `<button class="btn btn-g btn-sm" ${state.tripSaveBusy ? 'disabled' : ''} onclick="liveSplitTripScanRemoveLast()">Remove Last Page</button>` : ''}
            ${(form.scan_items || []).length ? `<button class="btn btn-g btn-sm" ${state.tripSaveBusy ? 'disabled' : ''} onclick="liveSplitTripScanClear()">Clear</button>` : ''}
          </div>
        </div>
        ${state.tripSaveBusy ? `<div style="margin-top:10px;font-size:12px;color:var(--t3)">${liveSplitBusyLabel('Processing receipt images...')}</div>` : ''}
        ${(form.scan_items || []).length ? `
          <div style="margin-top:10px;display:grid;gap:10px">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
              <div style="display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;background:#e8f5ed;color:var(--green);font-size:12px;font-weight:800">
                <span>AI parsed receipt</span>
              </div>
              <div style="font-size:12px;color:var(--t3)">Review and edit before creating the trip</div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px">
              <div style="padding:12px;border:1px solid var(--border);border-radius:12px;background:#fff">
                <div style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.08em">Merchant</div>
                <div style="font-size:16px;font-weight:900;color:var(--t1);margin-top:6px">${escHtml(form.scan_merchant || 'Scanned bill')}</div>
              </div>
              <div style="padding:12px;border:1px solid var(--border);border-radius:12px;background:#fff">
                <div style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.08em">Detected Date</div>
                <div style="font-size:16px;font-weight:900;color:var(--t1);margin-top:6px">${escHtml(scanDetectedDate || 'Not found')}</div>
              </div>
              <div style="padding:12px;border:1px solid var(--border);border-radius:12px;background:#fff">
                <div style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.08em">AI Total</div>
                <div style="font-size:16px;font-weight:900;color:var(--t1);margin-top:6px">${Number(form.scan_total_amount || 0) > 0 ? fmtCur(form.scan_total_amount) : 'Not found'}</div>
              </div>
              <div style="padding:12px;border:1px solid var(--border);border-radius:12px;background:#fff">
                <div style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.08em">Receipt Tax</div>
                <div style="font-size:16px;font-weight:900;color:var(--t1);margin-top:6px">${fmtCur(scanTaxTotal)}</div>
                <div style="font-size:11px;color:var(--t3);margin-top:4px">${scanTaxPct > 0 ? `${(scanTaxPct * 100).toFixed(2)}% of subtotal added to split` : 'No tax detected'}</div>
                <input class="fi" type="number" step="0.01" min="0" value="${escHtml(String(form.scan_tax_override !== '' ? form.scan_tax_override : scanTaxTotal))}" placeholder="0" style="margin-top:8px;width:100%;text-align:right" onchange="liveSplitTripScanTax(this.value)">
              </div>
              <div style="padding:12px;border:1px solid var(--border);border-radius:12px;background:#fff">
                <div style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.08em">Selected Rows</div>
                <div style="font-size:16px;font-weight:900;color:var(--t1);margin-top:6px">${scanSelectedRows.length}/${form.scan_items.length}</div>
              </div>
              <div style="padding:12px;border:1px solid var(--border);border-radius:12px;background:#fff">
                <div style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.08em">Selected Total Incl Tax</div>
                <div style="font-size:16px;font-weight:900;color:var(--t1);margin-top:6px">${fmtCur(scanSelectedTotal)}</div>
              </div>
              <div style="padding:12px;border:1px solid var(--border);border-radius:12px;background:#fff">
                <div style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.08em">My Share</div>
                <div style="font-size:16px;font-weight:900;color:var(--green);margin-top:6px">${fmtCur(scanSelectedMyShare)}</div>
              </div>
            </div>
          </div>
          <div style="margin-top:2px;font-size:12px;color:var(--t3)">Subtotal ${fmtCur(scanSubtotalAll)} • Receipt tax ${fmtCur(scanTaxTotal)} • Tax currently added into selected rows ${fmtCur(scanSelectedTax)}.</div>
          ${form.scan_debug ? `
            <details style="margin-top:10px;border:1px solid var(--border);border-radius:12px;background:#fcfdfc;padding:10px">
              <summary style="cursor:pointer;font-size:12px;font-weight:800;color:var(--t1)">Scan Debug View</summary>
              <div style="display:grid;gap:12px;margin-top:10px">
                <div>
                  <div style="font-size:11px;color:var(--t3);font-weight:800;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Final Rows Used</div>
                  ${renderTripScanDebugRows(form.scan_debug?.final_rows || [])}
                </div>
                ${Array.isArray(form.scan_debug?.pages) ? form.scan_debug.pages.map((page) => `
                  <div style="padding:10px;border:1px solid var(--border);border-radius:12px;background:#fff">
                    <div style="font-size:12px;font-weight:800;color:var(--t1);margin-bottom:8px">Page ${Number(page?.page || 0) || 1}</div>
                    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
                      <div>
                        <div style="font-size:11px;color:var(--t3);font-weight:800;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">OCR Rows</div>
                        ${renderTripScanDebugRows(page?.ocr_rows || [])}
                      </div>
                      <div>
                        <div style="font-size:11px;color:var(--t3);font-weight:800;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">AI Rows</div>
                        ${renderTripScanDebugRows(page?.ai_rows || [])}
                      </div>
                      <div>
                        <div style="font-size:11px;color:var(--t3);font-weight:800;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Corrected Rows</div>
                        ${renderTripScanDebugRows(page?.final_rows || [])}
                      </div>
                    </div>
                  </div>
                `).join('') : ''}
              </div>
            </details>
          ` : ''}
          <div style="margin-top:10px;border:1px solid var(--border);border-radius:12px;background:#fff;padding:10px">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:4px 2px 10px 2px;border-bottom:1px solid var(--border);flex-wrap:wrap">
              <label class="fc" style="margin:0;font-size:12px;font-weight:700;color:var(--t2)">
                <input type="checkbox" ${(form.scan_items || []).every((item) => item?.selected !== false) ? 'checked' : ''} onchange="liveSplitTripScanSelectAll(this.checked)">
                <span>Select all</span>
              </label>
              <div style="font-size:12px;color:var(--t3)">Edit rows below</div>
            </div>
            <div style="display:grid;gap:10px;margin-top:10px">
            ${(form.scan_items || []).map((item) => {
              const rowKey = String(item.key || '');
              const participantOptions = getTripScanParticipantOptions(form);
              const friendParticipantOptions = participantOptions.filter((person) => String(person.key) !== 'self');
              const normalizedItem = normalizeTripScanRowSplitState({ ...item }, form);
              const participantKeys = normalizedItem.participant_keys || [];
              const splitMode = String(normalizedItem.split_mode || 'equal');
              const splitPreview = computeTripScanRowSplit(normalizedItem, form);
              const splitHints = { percent: '(must total 100)', fraction: '(must total 1.0)', amount: '(sum must match amount)', parts: '(ratio parts)' };
              return `
                <div style="border:1px solid var(--border);border-radius:12px;padding:10px;background:${item.selected !== false ? '#fff' : '#fafafa'}">
                  <div style="display:flex;align-items:flex-start;gap:10px">
                    <label class="fc" style="margin:0;padding-top:2px">
                      <input type="checkbox" data-trip-scan-key="${escHtml(rowKey)}" data-trip-scan-selected="1" ${item.selected !== false ? 'checked' : ''} onchange="liveSplitTripScanItem(${toJsArg(rowKey)},'selected', this.checked ? '1' : '0')">
                    </label>
                    <div style="flex:1;min-width:0">
                      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:6px">
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                          <span style="font-size:11px;color:var(--t3);font-weight:800;letter-spacing:.08em;text-transform:uppercase">Item ${Number((form.scan_items || []).indexOf(item)) + 1}</span>
                          <span style="font-size:11px;color:var(--t3)">${escHtml(item.purchase_date || scanDetectedDate || form.start_date || todayLocalIso())}</span>
                        </div>
                        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                          ${item.category ? `<span class="badge" style="background:#f4f6f4;color:var(--t2)">${escHtml(item.category)}</span>` : ''}
                          <span class="badge" style="background:#ecfdf3;color:var(--green)">Tax ${fmtCur(getTripScanRowTaxShare(form, normalizedItem))}</span>
                          <span class="badge" style="background:#f3f6ff;color:#4268b2">${fmtCur(getTripScanRowEffectiveAmount(form, normalizedItem))}</span>
                        </div>
                      </div>
                      <input class="fi" data-trip-scan-key="${escHtml(rowKey)}" data-trip-scan-field="item_name" style="font-size:15px;font-weight:800;min-width:0;width:100%" value="${escHtml(String(item.item_name || ''))}" placeholder="Item name" onchange='liveSplitTripScanItem(${toJsArg(rowKey)}, "item_name", this.value)'>
                    </div>
                    <button type="button" class="btn btn-g btn-sm" style="min-width:0;padding:8px 10px;flex-shrink:0" onclick='liveSplitTripScanDelete(${toJsArg(rowKey)})' title="Delete row">&times;</button>
                  </div>
                  <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;margin-top:10px">
                    <label style="display:block;min-width:0">
                      <div style="font-size:11px;color:var(--t3);font-weight:700;margin-bottom:4px">Amount After Discount</div>
                      <input class="fi" data-trip-scan-key="${escHtml(rowKey)}" data-trip-scan-field="amount" style="text-align:right;width:100%" type="number" step="0.01" min="0" value="${escHtml(String(item.amount ?? ''))}" placeholder="0" onchange='liveSplitTripScanItem(${toJsArg(rowKey)}, "amount", this.value)'>
                    </label>
                    <div style="display:block;min-width:0">
                      <div style="font-size:11px;color:var(--t3);font-weight:700;margin-bottom:4px">Participants</div>
                      <div style="display:flex;flex-wrap:wrap;gap:6px;padding:8px;border:1px solid var(--border);border-radius:12px;background:#fff;min-height:44px">
                        ${friendParticipantOptions.length
                          ? friendParticipantOptions.map((person) => `<button type="button" class="chip ${participantKeys.includes(String(person.key)) ? 'active' : ''}" onclick='liveSplitTripScanToggleParticipant(${toJsArg(rowKey)}, ${toJsArg(person.key)})'>${escHtml(person.name)}</button>`).join('')
                          : `<div style="font-size:12px;color:var(--t3)">Select trip members above to enable participants.</div>`}
                      </div>
                    </div>
                  </div>
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:10px">
                    <label class="fc" style="margin:0;font-size:12px;color:var(--t2)"><input type="checkbox" ${participantKeys.includes('self') ? 'checked' : ''} onchange='liveSplitTripScanToggleSelf(${toJsArg(rowKey)}, this.checked)'><span>Include me in this item</span></label>
                    <div style="font-size:12px;color:var(--t3)">${participantKeys.length} participant${participantKeys.length === 1 ? '' : 's'}</div>
                  </div>
                  <div style="margin-top:10px">
                    <div style="font-size:11px;color:var(--t3);font-weight:700;margin-bottom:6px">Split Mode</div>
                    <div style="display:flex;flex-wrap:wrap;gap:6px">
                      ${[
                        ['equal', 'Equal'],
                        ['percent', '%'],
                        ['fraction', 'Fraction'],
                        ['amount', 'Direct'],
                        ['parts', 'Parts'],
                      ].map(([modeKey, label]) => `<button type="button" class="chip ${splitMode === modeKey ? 'active' : ''}" onclick='liveSplitTripScanSplitMode(${toJsArg(rowKey)}, ${toJsArg(modeKey)})'>${label}</button>`).join('')}
                    </div>
                    <div style="font-size:11px;color:var(--t3);margin-top:6px">${splitHints[splitMode] || ''}</div>
                  </div>
                  ${splitMode !== 'equal'
                    ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:10px">
                        ${getTripScanRowPeople(normalizedItem, form).map((person) => `<label style="display:block;min-width:0">
                          <div style="font-size:11px;color:var(--t3);font-weight:700;margin-bottom:4px">${escHtml(person.name)}</div>
                          <input class="fi" data-trip-scan-key="${escHtml(rowKey)}" data-trip-scan-split-person="${escHtml(String(person.key || ''))}" type="number" step="${splitMode === 'fraction' ? '0.0001' : '0.01'}" min="0" value="${escHtml(String((normalizedItem.split_values || {})[person.key] ?? ''))}" onchange='liveSplitTripScanSplitValue(${toJsArg(rowKey)}, ${toJsArg(person.key)}, this.value)'>
                        </label>`).join('')}
                      </div>`
                    : ''}
                  <div style="margin-top:10px;padding:10px 12px;border:1px dashed var(--border);border-radius:12px;background:#fafcfb">
                    <div style="font-size:11px;color:var(--t3);font-weight:700;margin-bottom:6px">Split Preview</div>
                    ${splitPreview?.valid
                      ? `<div style="display:flex;flex-wrap:wrap;gap:8px">${(splitPreview.shares || []).map((share) => `<span class="chip active">${escHtml(share.name)} • ${fmtCur(share.share)}</span>`).join('')}</div>`
                      : `<div style="font-size:12px;color:var(--red)">${escHtml(splitPreview?.error || 'Invalid split')}</div>`}
                  </div>
                </div>
              `;
            }).join('')}
            </div>
          </div>
        ` : ''}
      </div>
      <div style="margin-top:12px;padding:14px;border:1px solid #d8deea;border-radius:14px;background:#f8fafc">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
          <div style="flex:1;min-width:220px">
            <div style="font-size:14px;font-weight:800;color:var(--t1)">Manual Trip Entries</div>
            <div style="font-size:12px;color:var(--t2);margin-top:3px">Add multiple trip rows manually with item, amount, participants, split type, and delete.</div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <div style="font-size:12px;color:var(--t2);font-weight:700">Trip total: ${fmtCur(manualTotal)}</div>
            <div style="font-size:13px;color:var(--t1);font-weight:800">My share: ${fmtCur(manualMyShare)}</div>
            <button class="btn btn-s btn-sm" ${state.tripSaveBusy ? 'disabled' : ''} onclick="liveSplitTripManualAdd()">Add Row</button>
          </div>
        </div>
        <div style="margin-top:10px;display:grid;gap:10px">
          ${(manualRows || []).map((item, index) => {
            const rowKey = String(item.key || '');
            const participantOptions = getTripScanParticipantOptions(form);
            const friendParticipantOptions = participantOptions.filter((person) => String(person.key) !== 'self');
            const participantKeys = item.participant_keys || [];
            const splitMode = String(item.split_mode || 'equal');
            const splitPreview = computeTripManualRowSplit(item, form);
            const splitHints = { percent: '(must total 100)', fraction: '(must total 1.0)', amount: '(sum must match amount)', parts: '(ratio parts)' };
            return `
              <div style="border:1px solid var(--border);border-radius:12px;padding:10px;background:#fff">
                <div style="display:flex;align-items:flex-start;gap:10px">
                  <div style="flex:1;min-width:0">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:6px">
                      <span style="font-size:11px;color:var(--t3);font-weight:800;letter-spacing:.08em;text-transform:uppercase">Manual Item ${index + 1}</span>
                      <span class="badge" style="background:#f3f6ff;color:#4268b2">${fmtCur(n(item.amount))}</span>
                    </div>
                    <div style="display:grid;grid-template-columns:minmax(0,1.5fr) minmax(120px,.8fr);gap:8px">
                      <input class="fi" data-trip-manual-key="${escHtml(rowKey)}" data-trip-manual-field="item_name" style="width:100%" value="${escHtml(String(item.item_name || ''))}" placeholder="Item name" onchange="liveSplitTripManualItem(${toJsArg(rowKey)}, 'item_name', this.value)">
                      <input class="fi" data-trip-manual-key="${escHtml(rowKey)}" data-trip-manual-field="amount" style="width:100%;text-align:right" type="number" step="0.01" min="0" value="${escHtml(String(item.amount ?? ''))}" placeholder="0" onchange="liveSplitTripManualItem(${toJsArg(rowKey)}, 'amount', this.value)">
                    </div>
                  </div>
                  <button class="btn btn-g btn-sm" style="min-width:0;padding:8px 10px;flex-shrink:0" onclick="liveSplitTripManualDelete(${toJsArg(rowKey)})" title="Delete row">&times;</button>
                </div>
                <div style="display:block;min-width:0;margin-top:10px">
                  <div style="font-size:11px;color:var(--t3);font-weight:700;margin-bottom:4px">Participants</div>
                  <div style="display:flex;flex-wrap:wrap;gap:6px;padding:8px;border:1px solid var(--border);border-radius:12px;background:#fff;min-height:44px">
                    ${friendParticipantOptions.length
                      ? friendParticipantOptions.map((person) => `<button type="button" class="chip ${participantKeys.includes(String(person.key)) ? 'active' : ''}" onclick='liveSplitTripManualToggleParticipant(${toJsArg(rowKey)}, ${toJsArg(person.key)})'>${escHtml(person.name)}</button>`).join('')
                      : `<div style="font-size:12px;color:var(--t3)">Select trip members above to enable participants.</div>`}
                  </div>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:10px">
                  <label class="fc" style="margin:0;font-size:12px;color:var(--t2)"><input type="checkbox" ${participantKeys.includes('self') ? 'checked' : ''} onchange='liveSplitTripManualToggleSelf(${toJsArg(rowKey)}, this.checked)'><span>Include me in this item</span></label>
                  <div style="font-size:12px;color:var(--t3)">${participantKeys.length} participant${participantKeys.length === 1 ? '' : 's'}</div>
                </div>
                <div style="margin-top:10px">
                  <div style="font-size:11px;color:var(--t3);font-weight:700;margin-bottom:6px">Split Mode</div>
                  <div style="display:flex;flex-wrap:wrap;gap:6px">
                    ${[
                      ['equal', 'Equal'],
                      ['percent', '%'],
                      ['fraction', 'Fraction'],
                      ['amount', 'Direct'],
                      ['parts', 'Parts'],
                    ].map(([modeKey, label]) => `<button type="button" class="chip ${splitMode === modeKey ? 'active' : ''}" onclick='liveSplitTripManualSplitMode(${toJsArg(rowKey)}, ${toJsArg(modeKey)})'>${label}</button>`).join('')}
                  </div>
                  <div style="font-size:11px;color:var(--t3);margin-top:6px">${splitHints[splitMode] || ''}</div>
                </div>
                ${splitMode !== 'equal'
                  ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:10px">
                      ${getTripManualRowPeople(item, form).map((person) => `<label style="display:block;min-width:0">
                        <div style="font-size:11px;color:var(--t3);font-weight:700;margin-bottom:4px">${escHtml(person.name)}</div>
                        <input class="fi" data-trip-manual-key="${escHtml(rowKey)}" data-trip-manual-split-person="${escHtml(String(person.key || ''))}" type="number" step="${splitMode === 'fraction' ? '0.0001' : '0.01'}" min="0" value="${escHtml(String((item.split_values || {})[person.key] ?? ''))}" onchange='liveSplitTripManualSplitValue(${toJsArg(rowKey)}, ${toJsArg(person.key)}, this.value)'>
                      </label>`).join('')}
                    </div>`
                  : ''}
                <div style="margin-top:10px;padding:10px 12px;border:1px dashed var(--border);border-radius:12px;background:#fafcfb">
                  <div style="font-size:11px;color:var(--t3);font-weight:700;margin-bottom:6px">Split Preview</div>
                  ${splitPreview?.valid
                    ? `<div style="display:flex;flex-wrap:wrap;gap:8px">${(splitPreview.shares || []).map((share) => `<span class="chip active">${escHtml(share.name)} • ${fmtCur(share.share)}</span>`).join('')}</div>`
                    : `<div style="font-size:12px;color:var(--red)">${escHtml(splitPreview?.error || 'Invalid split')}</div>`}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
      <div class="fa" style="margin-top:14px">
        <button class="btn btn-g" onclick="closeModal()">Cancel</button>
        <button class="btn btn-p" ${state.tripSaveBusy ? 'disabled' : ''} onclick="liveSplitTripSave()">${state.tripSaveBusy ? liveSplitBusyLabel('Saving...') : 'Create Trip'}</button>
      </div>
    `}`);
  }

  async function saveLiveSplitTrip() {
    const form = state.tripCreate;
    if (!form) return;
    syncTripCreateDraftFromDom();
    const voiceDrafts = Array.isArray(form.voice_drafts) ? form.voice_drafts : [];
    if (voiceDrafts.length) {
      try {
        const validation = validateVoiceTripDrafts(voiceDrafts);
        if (!validation.valid) throw new Error(validation.error || 'Voice trip drafts are invalid.');
        state.tripSaveBusy = true;
        renderTripCreateModal();
        for (const draft of voiceDrafts) {
          const startDate = toLocalIsoDate(draft?.start_date, todayLocalIso());
          const endDate = draft?.end_date ? toLocalIsoDate(draft.end_date, '') : '';
          if (endDate && endDate < startDate) {
            throw new Error(`Trip "${String(draft?.name || 'Trip').trim() || 'Trip'}" has an end date before its start date.`);
          }
          const members = buildVoiceTripMembersPayload(draft);
          const result = await api('/api/live-split/trips', {
            method: 'POST',
            body: {
              name: String(draft?.name || '').trim() || 'Trip',
              start_date: startDate,
              end_date: endDate || null,
              show_add_to_expense_option: draft?.show_add_to_expense_option !== false,
              members,
            },
          });
          if (!result || result.error) throw new Error(result?.error || 'Could not create live split trip');
        }
        state.tripSaveBusy = false;
        state.tripCreate = null;
        closeModal();
        await loadLiveSplit();
        toast(voiceDrafts.length === 1 ? 'Live split trip created' : `${voiceDrafts.length} live split trips created`, 'success');
      } catch (error) {
        state.tripSaveBusy = false;
        if (state.tripCreate) renderTripCreateModal();
        toast(error?.message || 'Could not create live split trip', 'error');
      }
      return;
    }
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
    const selectedScannedRows = (form.scan_items || []).filter((item) => item?.selected !== false);
    const appliedBulkDate = toLocalIsoDate(form.bulk_date || form.start_date, todayLocalIso());
    const appliedPaidBy = String(form.paid_by || 'You').trim() || 'You';
    const manualRowsToSave = (form.manual_items || [])
      .filter((item) => String(item?.item_name || '').trim() || Number(item?.amount || 0) > 0)
      .map((item) => normalizeTripManualRowSplitState({
        key: String(item?.key || ''),
        item_name: String(item?.item_name || '').trim(),
        amount: item?.amount,
        assignment: String(item?.assignment || 'self'),
        category: '',
        is_extra: false,
        participant_keys: Array.isArray(item?.participant_keys) ? item.participant_keys : [],
        split_mode: item?.split_mode,
        split_values: item?.split_values || {},
      }, form));
    const members = [...(form.selected || new Set())]
      .map((id) => state.friends.find((friend) => String(friend.id) === String(id)))
      .filter(Boolean)
      .map((friend) => mapFriendToTripMemberPayload(friend));
    for (const row of selectedScannedRows) {
      if (!String(row?.item_name || '').trim()) {
        toast('Each selected scanned row needs an item name', 'warning');
        return;
      }
      const amountValue = Number(row?.amount || 0);
      if (!(amountValue > 0)) {
        toast('Each selected scanned row needs a valid amount', 'warning');
        return;
      }
      const splitResult = computeTripScanRowSplit(row, form);
      if (!splitResult?.valid) {
        toast(`${String(row?.item_name || 'Scanned item')}: ${splitResult?.error || 'Invalid split'}`, 'warning');
        return;
      }
    }
    for (const row of manualRowsToSave) {
      if (!String(row?.item_name || '').trim()) {
        toast('Each manual entry needs an item name', 'warning');
        return;
      }
      const amountValue = Number(row?.amount || 0);
      if (!(amountValue > 0)) {
        toast('Each manual entry needs a valid amount', 'warning');
        return;
      }
      const splitResult = computeTripManualRowSplit(row, form);
      if (!splitResult?.valid) {
        toast(`${String(row?.item_name || 'Manual item')}: ${splitResult?.error || 'Invalid split'}`, 'warning');
        return;
      }
    }
    let createdTripId = 0;
    let savedTripItemCount = 0;
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
      createdTripId = Number(result?.id || 0);
      const rowsToPersist = [
        ...selectedScannedRows.map((row) => ({ ...row, _source: 'scan' })),
        ...manualRowsToSave.map((row) => ({ ...row, _source: 'manual' })),
      ];
      if (createdTripId > 0 && rowsToPersist.length) {
        for (const row of rowsToPersist) {
          const isScannedRow = String(row?._source || '') === 'scan';
          const amountValue = isScannedRow ? getTripScanRowEffectiveAmount(form, row) : r2(row?.amount);
          let participants = [{ key: 'self', name: 'You', share_value: amountValue }];
          let splitModeValue = 'amount';
          if (isScannedRow) {
            const splitResult = computeTripScanRowSplit(row, form);
            participants = (splitResult.shares || []).map((share) => ({
              key: String(share.key),
              name: String(share.name || 'Participant').trim() || 'Participant',
              share_value: r2(share.share),
            }));
            splitModeValue = String(row?.split_mode || 'equal');
          } else {
            const splitResult = computeTripManualRowSplit(row, form);
            participants = (splitResult.shares || []).map((share) => ({
              key: String(share.key),
              name: String(share.name || 'Participant').trim() || 'Participant',
              share_value: r2(share.share),
            }));
            splitModeValue = String(row?.split_mode || 'equal');
          }

          await persistLiveSplitEntry({
            divide_date: appliedBulkDate || toLocalIsoDate(row?.purchase_date || form.start_date, todayLocalIso()),
            details: String(row?.item_name || '').trim(),
            paid_by: appliedPaidBy,
            paid_by_key: textKey(appliedPaidBy) === 'you' ? 'self' : '',
            total_amount: amountValue,
            split_mode: splitModeValue,
            trip_id: createdTripId,
            participants,
            category: String(row?.category || '').trim(),
            expense_type: row?.is_extra ? 'extra' : 'fair',
            addExpense: false,
            finance_target: 'none',
          });
          savedTripItemCount += 1;
        }
      }
      state.tripSaveBusy = false;
      state.tripCreate = null;
      closeModal();
      await loadLiveSplit();
      const totalSavedRows = selectedScannedRows.length + manualRowsToSave.length;
      toast(totalSavedRows ? `Live split trip created with ${totalSavedRows} item${totalSavedRows === 1 ? '' : 's'}` : 'Live split trip created', 'success');
    } catch (error) {
      state.tripSaveBusy = false;
      if (state.tripCreate) renderTripCreateModal();
      const totalRows = selectedScannedRows.length + manualRowsToSave.length;
      if (createdTripId > 0 && totalRows) {
        toast(`Trip was created, but only ${savedTripItemCount} of ${totalRows} item${totalRows === 1 ? '' : 's'} were added. ${error?.message || ''}`.trim(), 'warning');
      } else {
        toast(error?.message || 'Could not create live split trip', 'error');
      }
    }
  }

  function openTripBulkEditModal(tripId) {
    const tid = Number(tripId || 0);
    const trip = (state.liveTrips || []).find((item) => Number(item.id) === tid);
    if (!trip || !trip.is_owner) {
      toast('Only trip owner can bulk edit trip rows', 'warning');
      return;
    }
    const defaults = resolveTripBulkEditDefaults(trip);
    state.tripBulkEdit = {
      trip_id: tid,
      paid_by: defaults.paid_by,
      divide_date: defaults.divide_date,
    };
    renderTripBulkEditModal();
  }

  function renderTripBulkEditModal() {
    const form = state.tripBulkEdit;
    if (!form) return;
    const trip = (state.liveTrips || []).find((item) => Number(item.id) === Number(form.trip_id));
    if (!trip) return;
    const payerOptions = [
      'You',
      ...(trip.members || [])
        .filter((member) => textKey(member?.member_name || '') !== 'you')
        .map((member) => String(member?.member_name || '').trim())
        .filter(Boolean),
    ].filter((name, index, arr) => arr.findIndex((item) => textKey(item) === textKey(name)) === index);
    const tripGroups = [...(state.groups || [])].filter((group) => Number(group?.trip_id || 0) === Number(trip.id));
    openModal(`Bulk Edit - ${escHtml(trip.name || 'Trip')}`, `
      <div style="display:grid;gap:12px">
        <div style="padding:14px;border:1px solid #d8deea;border-radius:14px;background:linear-gradient(180deg,#f8fbff 0%,#f4faf7 100%)">
          <div style="font-size:15px;font-weight:900;color:var(--t1)">Update All Trip Rows</div>
          <div style="font-size:12px;color:var(--t2);margin-top:4px">This updates every saved trip entry in this Live Split trip with one payer and one date. Split shares and amounts stay unchanged.</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
            <span class="badge" style="background:#fff;color:#35518f">${tripGroups.length} rows</span>
            <span class="badge" style="background:#fff;color:#145a3c">${fmtCur(trip.total_amount || 0)} total</span>
          </div>
        </div>
        <div class="fg">
          <label class="fl">Paid By
            <select class="fi" onchange="liveSplitTripBulkEditField('paid_by', this.value)">
              ${payerOptions.map((name) => `<option value="${escHtml(name)}" ${textKey(form.paid_by || 'You') === textKey(name) ? 'selected' : ''}>${escHtml(name)}</option>`).join('')}
            </select>
          </label>
          <label class="fl">Date For All Rows
            <input class="fi" type="date" value="${escHtml(form.divide_date || trip.start_date || todayLocalIso())}" onchange="liveSplitTripBulkEditField('divide_date', this.value)">
          </label>
        </div>
      </div>
      <div class="fa" style="margin-top:14px">
        <button class="btn btn-g" onclick="closeModal()">Cancel</button>
        <button class="btn btn-p" ${state.tripActionBusy ? 'disabled' : ''} onclick="liveSplitTripBulkEditSave()">${state.tripActionBusy ? liveSplitBusyLabel('Saving...') : 'Apply To All Rows'}</button>
      </div>
    `);
  }

  async function saveTripBulkEditModal() {
    const form = state.tripBulkEdit;
    if (!form) return;
    const trip = (state.liveTrips || []).find((item) => Number(item.id) === Number(form.trip_id));
    if (!trip || !trip.is_owner) {
      toast('Trip not found', 'error');
      return;
    }
    const divideDate = toLocalIsoDate(form.divide_date, trip.start_date || todayLocalIso());
    const paidBy = String(form.paid_by || 'You').trim() || 'You';
    const tripGroups = [...(state.groups || [])].filter((group) => Number(group?.trip_id || 0) === Number(trip.id));
    if (!tripGroups.length) {
      toast('No trip rows found to update', 'warning');
      return;
    }
    try {
      state.tripActionBusy = Number(trip.id);
      renderTripBulkEditModal();
      for (const group of tripGroups) {
        const result = await api(`/api/live-split/groups/${Number(group.id)}`, {
          method: 'PUT',
          body: {
            divide_date: divideDate,
            details: String(group?.details || group?.heading || 'Split expense').trim(),
            paid_by: paidBy,
            total_amount: Number(group?.total_amount || 0),
            split_mode: String(group?.split_mode || 'equal'),
            trip_id: Number(group?.trip_id || 0) || null,
            heading: String(group?.heading || group?.details || '').trim() || null,
            splits: Array.isArray(group?.splits) ? group.splits.map((split) => ({
              friend_id: Number(split?.friend_id || 0),
              friend_name: String(split?.friend_name || '').trim(),
              share_amount: Number(split?.share_amount || 0),
            })) : [],
            allow_duplicate: true,
          },
        });
        if (!result || result.error) throw new Error(result?.error || 'Could not bulk update trip rows');
      }
      state.tripActionBusy = false;
      state.tripBulkEdit = null;
      closeModal();
      await fetchData();
      await openTripDetails(trip.id);
      toast(`Updated ${tripGroups.length} trip row${tripGroups.length === 1 ? '' : 's'}`, 'success');
    } catch (error) {
      state.tripActionBusy = false;
      if (state.tripBulkEdit) renderTripBulkEditModal();
      toast(error?.message || 'Could not bulk update trip rows', 'error');
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
    setupCreateFromTrip(id);
    renderCreateModal();
  }

  function setupCreateFromTrip(tripId) {
    const id = Number(tripId);
    const trip = (state.liveTrips || []).find((item) => Number(item.id) === id);
    if (!trip) return;
    state.create = createInitialForm();
    state.createInvite = { query: '', results: [], searching: false, searched: false };
    state.create.trip_id = id;
    state.create.voice_preferred_friend_id = null;
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

  function isLiveSplitDuplicateWarning(resultOrMessage) {
    const message = typeof resultOrMessage === 'string'
      ? resultOrMessage
      : String(resultOrMessage?.error || resultOrMessage?.message || '');
    return message.toLowerCase().includes('this live split expense looks already added');
  }

  function liveSplitDuplicateConfirmHtml(message) {
    const safeMessage = escHtml(String(message || '')).replace(/\n/g, '<br>');
    return `
      <div style="display:grid;gap:10px;text-align:left">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:38px;height:38px;border-radius:12px;background:rgba(217,119,6,.12);color:#b45309;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:800">!</div>
          <div>
            <div style="font-weight:800;color:var(--t1);font-size:15px">Possible Duplicate</div>
            <div style="font-size:12px;color:var(--t3)">This looks like the same split was already added.</div>
          </div>
        </div>
        <div style="font-size:13px;line-height:1.6;color:var(--t2);background:var(--bg2);border:1px solid var(--border);border-radius:14px;padding:12px 14px">${safeMessage}</div>
        <div style="font-size:13px;color:var(--t2)">Do you want to add it again anyway?</div>
      </div>
    `;
  }

  async function saveLiveSplit() {
    const form = state.create;
    const voiceDrafts = Array.isArray(form?.voice_drafts) ? form.voice_drafts : [];
    if (voiceDrafts.length) {
      const validation = validateLiveSplitVoiceDrafts(voiceDrafts);
      if (!validation.valid) {
        toast(validation.issues[0]?.error || 'Fix the detected split values before saving.', 'warning');
        renderCreateModal();
        return;
      }
      try {
        state.saveBusy = true;
        renderCreateModal();
        let savedCount = 0;
        for (const draft of voiceDrafts) {
          const result = await persistLiveSplitEntry(draft);
          if (!result?.skipped) savedCount += 1;
        }
        closeModal();
        state.create = null;
        state.saveBusy = false;
        await loadLiveSplit();
        toast(savedCount > 0 ? `${savedCount} live split${savedCount === 1 ? '' : 's'} saved` : 'No live split was added', savedCount > 0 ? 'success' : 'warning');
      } catch (error) {
        state.saveBusy = false;
        if (state.create) renderCreateModal();
        toast(error?.message || 'Could not save live split', 'error');
      }
      return;
    }
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
      await persistLiveSplitEntry({
        divide_date: normalizedDate,
        details: form.details.trim(),
        total_amount: total,
        paid_by: payerPerson.name,
        paid_by_key: payerKey,
        split_mode: String(form.splitMode || 'equal'),
        trip_id: Number(form.trip_id || 0) > 0 ? Number(form.trip_id) : null,
        participants: shares.map((share) => ({
          key: share.key,
          name: share.name,
          share_value: r2(share.share),
        })),
        addExpense: !!form.addExpense,
        expense_type: form.expense_type,
        category: form.category,
        finance_target: form.finance_target,
        bank_account_id: form.bank_account_id,
        card_id: form.card_id,
        card_discount_pct: form.card_discount_pct,
      });

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
    if (!(Number(state.create.trip_id || 0) > 0) && !friendPeopleCount() && !hasLiveSplitVoiceDrafts(state.create)) {
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
    const row = buildVisibleLiveSplitRows().find((item) => Number(resolveFriendIdForRow(item) || 0) === id) || null;
    if (row && row.can_delete === false) {
      toast('Your current plan does not allow deleting Live Split friends.', 'warning');
      return;
    }
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

  async function sendLiveSplitNudge(friendId) {
    const id = Number(friendId || 0);
    if (!(id > 0)) return;
    const nudgeAccess = window._liveSplitAccess?.nudge || {};
    if (!nudgeAccess.enabled) {
      toast(nudgeAccess.message || 'Live Split nudges are not included in your current plan.', 'warning');
      return;
    }
    if (nudgeAccess.can_use === false) {
      toast(nudgeAccess.message || 'You have used all Live Split nudges for now.', 'warning');
      return;
    }
    const row = buildVisibleLiveSplitRows().find((item) => Number(resolveFriendIdForRow(item) || 0) === id) || null;
    const rawAmount = n(row?.amount);
    const amount = Math.abs(rawAmount);
    if (!(amount > 0.004)) {
      toast('Nudges are only available when there is a pending balance.', 'warning');
      return;
    }
    if (Number(row?.linked_user_id || 0) <= 0) {
      toast('This friend is not linked to an app user yet.', 'warning');
      return;
    }
    const direction = rawAmount < 0 ? 'i_owe_them' : 'they_owe_me';
    const prompt = direction === 'i_owe_them'
      ? `Send a balance update to ${row?.name || 'this friend'} for ${fmtCur(amount)}?`
      : `Send a payment reminder to ${row?.name || 'this friend'} for ${fmtCur(amount)}?`;
    const confirmed = await confirmDialog(prompt);
    if (!confirmed) return;
    try {
      state.friendNudgeBusy.add(id);
      renderMain();
      const result = await api(`/api/live-split/friends/${id}/nudge`, {
        method: 'POST',
        body: { amount, direction },
      });
      if (!result?.success) throw new Error(result?.error || 'Could not send nudge');
      if (result?.access) {
        window._liveSplitAccess = result.access;
      }
      const sentPushCount = Number(result?.sent_push_count || 0);
      toast(
        result?.already_sent
          ? (result?.message || 'A nudge for this amount was already sent today.')
          : (sentPushCount > 0 ? 'Nudge sent as a push notification' : 'Nudge saved as an in-app notification'),
        result?.already_sent ? 'info' : 'success'
      );
    } catch (error) {
      toast(error?.message || 'Could not send nudge', 'error');
    } finally {
      state.friendNudgeBusy.delete(id);
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
  window.liveSplitOpenVoiceTripCreate = openVoiceTripCreate;
  window.liveSplitTripField = function liveSplitTripField(field, value) {
    if (!state.tripCreate) return;
    state.tripCreate[field] = value || '';
  };
  window.liveSplitTripToggleExpenseOption = function liveSplitTripToggleExpenseOption(checked) {
    if (!state.tripCreate) return;
    state.tripCreate.show_add_to_expense_option = !!checked;
    renderTripCreateModal();
  };
  window.liveSplitTripBulkEditField = function liveSplitTripBulkEditField(field, value) {
    if (!state.tripBulkEdit) return;
    state.tripBulkEdit[field] = value || '';
  };
  window.liveSplitOpenTripBulkEdit = openTripBulkEditModal;
  window.liveSplitTripBulkEditSave = saveTripBulkEditModal;
  window.liveSplitTripBulkPaidBy = function liveSplitTripBulkPaidBy(value) {
    if (!state.tripCreate) return;
    state.tripCreate.paid_by = String(value || 'You').trim() || 'You';
    rerenderTripCreateModalPreservingUi();
  };
  window.liveSplitTripBulkDate = function liveSplitTripBulkDate(value) {
    if (!state.tripCreate) return;
    applyTripCreateMetaToRowsWeb({ dateValue: value });
  };
  window.liveSplitTripToggleMember = function liveSplitTripToggleMember(friendId) {
    if (!state.tripCreate) return;
    syncTripCreateDraftFromDom();
    const key = String(friendId || '');
    if (state.tripCreate.selected.has(key)) state.tripCreate.selected.delete(key);
    else state.tripCreate.selected.add(key);
    const selectedIds = new Set(tripCreateSelectedFriends(state.tripCreate).map((friend) => Number(friend.id)));
    state.tripCreate.scan_items = normalizeTripAssignmentsForSelectedFriends(state.tripCreate.scan_items, selectedIds);
    state.tripCreate.scan_items = (state.tripCreate.scan_items || []).map((item) => normalizeTripScanRowSplitState(item, state.tripCreate));
    state.tripCreate.manual_items = normalizeTripAssignmentsForSelectedFriends(state.tripCreate.manual_items, selectedIds);
    state.tripCreate.manual_items = (state.tripCreate.manual_items || []).map((item) => normalizeTripManualRowSplitState(item, state.tripCreate));
    const payerOptions = tripCreatePayerOptions(state.tripCreate);
    if (!payerOptions.some((name) => textKey(name) === textKey(state.tripCreate.paid_by || 'You'))) {
      state.tripCreate.paid_by = 'You';
    }
    renderTripCreateModal();
  };
  window.liveSplitTripScanPick = liveSplitTriggerTripScanPick;
  window.liveSplitTripScanRemoveLast = removeLastTripReceiptScanPageWeb;
  window.liveSplitTripScanClear = resetTripReceiptScanStateWeb;
  window.liveSplitTripScanDelete = deleteTripScanItemWeb;
  window.liveSplitTripScanSelectAll = selectAllTripScanItemsWeb;
  window.liveSplitTripScanItem = function liveSplitTripScanItem(itemKey, field, value) {
    if (!state.tripCreate) return;
    if (field === 'selected') {
      updateTripScanItemWeb(itemKey, { selected: String(value) === '1' });
      return;
    }
    updateTripScanItemWeb(itemKey, { [field]: value });
  };
  window.liveSplitTripScanToggleParticipant = function liveSplitTripScanToggleParticipant(itemKey, participantKey) {
    if (!state.tripCreate) return;
    const item = (state.tripCreate.scan_items || []).find((row) => String(row.key) === String(itemKey));
    if (!item) return;
    const nextKeys = new Set((Array.isArray(item.participant_keys) ? item.participant_keys : []).map((key) => String(key)));
    const key = String(participantKey || '');
    if (!key) return;
    if (nextKeys.has(key)) nextKeys.delete(key);
    else nextKeys.add(key);
    updateTripScanItemWeb(itemKey, { participant_keys: [...nextKeys] });
  };
  window.liveSplitTripScanToggleSelf = function liveSplitTripScanToggleSelf(itemKey, checked) {
    if (!state.tripCreate) return;
    const item = (state.tripCreate.scan_items || []).find((row) => String(row.key) === String(itemKey));
    if (!item) return;
    const nextKeys = new Set((Array.isArray(item.participant_keys) ? item.participant_keys : []).map((key) => String(key)));
    if (checked) nextKeys.add('self');
    else nextKeys.delete('self');
    updateTripScanItemWeb(itemKey, { participant_keys: [...nextKeys] });
  };
  window.liveSplitTripScanSplitMode = function liveSplitTripScanSplitMode(itemKey, mode) {
    if (!state.tripCreate) return;
    updateTripScanItemWeb(itemKey, { split_mode: String(mode || 'equal').toLowerCase(), split_values: {} });
  };
  window.liveSplitTripScanSplitValue = function liveSplitTripScanSplitValue(itemKey, key, value) {
    if (!state.tripCreate) return;
    const item = (state.tripCreate.scan_items || []).find((row) => String(row.key) === String(itemKey));
    if (!item) return;
    const nextValues = { ...(item.split_values || {}) };
    nextValues[String(key)] = value === '' ? '' : Number(value);
    updateTripScanItemWeb(itemKey, { split_values: nextValues });
  };
  window.liveSplitTripScanTax = function liveSplitTripScanTax(value) {
    if (!state.tripCreate) return;
    state.tripCreate.scan_tax_override = value === '' ? '' : Math.max(0, r2(Number(value || 0)));
    rerenderTripCreateModalPreservingUi();
  };
  window.liveSplitTripManualAdd = addTripManualItemWeb;
  window.liveSplitTripManualDelete = deleteTripManualItemWeb;
  window.liveSplitTripManualItem = function liveSplitTripManualItem(itemKey, field, value) {
    if (!state.tripCreate) return;
    updateTripManualItemWeb(itemKey, { [field]: value });
  };
  window.liveSplitTripManualToggleParticipant = function liveSplitTripManualToggleParticipant(itemKey, participantKey) {
    if (!state.tripCreate) return;
    const item = (state.tripCreate.manual_items || []).find((row) => String(row.key) === String(itemKey));
    if (!item) return;
    const nextKeys = new Set((Array.isArray(item.participant_keys) ? item.participant_keys : []).map((key) => String(key)));
    const key = String(participantKey || '');
    if (!key) return;
    if (nextKeys.has(key)) nextKeys.delete(key);
    else nextKeys.add(key);
    updateTripManualItemWeb(itemKey, { participant_keys: [...nextKeys] });
  };
  window.liveSplitTripManualToggleSelf = function liveSplitTripManualToggleSelf(itemKey, checked) {
    if (!state.tripCreate) return;
    const item = (state.tripCreate.manual_items || []).find((row) => String(row.key) === String(itemKey));
    if (!item) return;
    const nextKeys = new Set((Array.isArray(item.participant_keys) ? item.participant_keys : []).map((key) => String(key)));
    if (checked) nextKeys.add('self');
    else nextKeys.delete('self');
    updateTripManualItemWeb(itemKey, { participant_keys: [...nextKeys] });
  };
  window.liveSplitTripManualSplitMode = function liveSplitTripManualSplitMode(itemKey, mode) {
    if (!state.tripCreate) return;
    updateTripManualItemWeb(itemKey, { split_mode: String(mode || 'equal').toLowerCase(), split_values: {} });
  };
  window.liveSplitTripManualSplitValue = function liveSplitTripManualSplitValue(itemKey, key, value) {
    if (!state.tripCreate) return;
    const item = (state.tripCreate.manual_items || []).find((row) => String(row.key) === String(itemKey));
    if (!item) return;
    const nextValues = { ...(item.split_values || {}) };
    nextValues[String(key)] = value === '' ? '' : Number(value);
    updateTripManualItemWeb(itemKey, { split_values: nextValues });
  };
  window.liveSplitTripSave = saveLiveSplitTrip;
  window.liveSplitOpenTripDetails = openTripDetails;
  window.liveSplitOpenTripEvent = openTripEventDetails;
  window.liveSplitToggleTripSplitView = toggleTripSplitView;
  window.liveSplitDownloadTripPdf = liveSplitDownloadTripPdf;
  window.liveSplitUseTrip = openCreateFromTrip;
  window.liveSplitOpenVoiceFromTrip = openVoiceSplitFromTrip;
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
  window.liveSplitVoiceStart = startLiveSplitVoiceCapture;
  window.liveSplitVoiceStop = stopLiveSplitVoiceCapture;
  window.liveSplitVoiceReset = resetLiveSplitVoice;
  window.liveSplitSave = saveLiveSplit;
  window.liveSplitSetSort = function liveSplitSetSort(sort) {
    state.sort = sort;
    renderMain();
  };
  window.liveSplitSetFriendFilter = function liveSplitSetFriendFilter(filterKey) {
    state.friendFilter = filterKey === 'hide_settled' ? 'hide_settled' : 'all';
    renderMain();
  };
  window.liveSplitToggleCompletedTrips = function liveSplitToggleCompletedTrips() {
    state.showCompletedTrips = !state.showCompletedTrips;
    renderMain();
  };
  window.liveSplitOpenPendingInvites = openPendingInvitesModal;
  window.liveSplitOpenAvatarPreview = openAvatarPreview;
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
  window.liveSplitAddTripToExpense = function liveSplitAddTripToExpense(tripId, tripName, myShareAmount) {
    const resolvedTripId = Number(tripId || 0);
    const trip = getTripById(resolvedTripId);
    const resolvedAmount = Number(
      Number.isFinite(Number(trip?.my_share_amount)) && Number(trip?.my_share_amount) > 0
        ? Number(trip.my_share_amount)
        : (Number(myShareAmount || 0))
    );
    if (!(resolvedTripId > 0) || !(resolvedAmount > 0)) {
      toast('Your trip share is not available', 'error');
      return;
    }
    openModal('Add Trip To Expenses', `
      <div style="display:grid;gap:12px">
        <div style="font-size:13px;color:var(--t2)">Add your trip share <b style="color:var(--t1)">${fmtCur(resolvedAmount)}</b> to Expenses using trip name <b style="color:var(--t1)">${escHtml(String(tripName || 'Trip').trim() || 'Trip')}</b>.</div>
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
      toast(`Your trip share has been added to expenses as ${String(type || '').toLowerCase() === 'extra' ? 'Extra' : 'Fair'}`, 'success');
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
  window.liveSplitSendNudge = sendLiveSplitNudge;
  window.liveSplitOpenSettle = openSettleModal;
  window.liveSplitOpenCreateForFriend = openCreateForFriend;
  window.liveSplitOpenVoiceForFriend = openVoiceSplitForFriend;
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
  bindAvatarPreviewClicks();
})();

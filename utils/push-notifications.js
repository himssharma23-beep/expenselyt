function chunkArray(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function normalizeMessagePayload(payload = {}) {
  const title = String(payload.title || '').trim();
  const body = String(payload.body || payload.message || '').trim();
  if (!title) throw new Error('Notification title is required');
  if (!body) throw new Error('Notification message is required');
  if (title.length > 80) throw new Error('Notification title must be 80 characters or fewer');
  if (body.length > 250) throw new Error('Notification message must be 250 characters or fewer');
  return {
    title,
    body,
    data: payload.data && typeof payload.data === 'object' ? payload.data : {},
    badge: Number.isFinite(Number(payload.badge)) ? Math.max(0, Math.trunc(Number(payload.badge))) : undefined,
  };
}

function isExpoPushToken(token) {
  return /^(?:Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/.test(String(token || '').trim());
}

// Send via Expo (legacy fallback for any remaining Expo tokens)
async function sendViaExpo(messages) {
  if (!messages.length) return { sent: 0, errors: [], tickets: [], results: [] };

  const expoHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
  };

  const errors = [];
  const tickets = [];
  const results = [];

  for (const batch of chunkArray(messages, 100)) {
    let response;
    try {
      response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: expoHeaders,
        body: JSON.stringify(batch.map((item) => item.message)),
      });
    } catch (err) {
      errors.push(err.message || 'Push send request failed');
      continue;
    }

    let payload;
    try { payload = await response.json(); } catch (_) { payload = null; }

    if (!response.ok) {
      errors.push(payload?.errors?.map((e) => e?.message).filter(Boolean).join(', ') || `Push send failed with HTTP ${response.status}`);
      continue;
    }

    const ticketData = Array.isArray(payload?.data) ? payload.data : [];
    ticketData.forEach((ticket, index) => {
      tickets.push({ meta: batch[index]?.meta || null, ticket: ticket || null });
      results.push({
        provider: 'expo',
        success: ticket?.status === 'ok',
        provider_message_id: ticket?.id || null,
        error: ticket?.status === 'error' ? (ticket?.message || ticket?.details?.error || 'Expo push failed') : null,
        response: ticket || {},
        meta: batch[index]?.meta || null,
      });
    });
  }

  const ticketErrors = tickets
    .filter((e) => e?.ticket?.status === 'error')
    .map((e) => e?.ticket?.message || e?.ticket?.details?.error)
    .filter(Boolean);

  return { sent: messages.length, errors: [...errors, ...ticketErrors], tickets, results };
}

// Send via Firebase Cloud Messaging directly
async function sendViaFcm(messages) {
  if (!messages.length) return { sent: 0, errors: [], results: [] };

  let messaging;
  try {
    const { getMessaging } = require('./firebase');
    messaging = getMessaging();
  } catch (err) {
    return { sent: 0, errors: [`Firebase not configured: ${err.message}`], results: [] };
  }

  const errors = [];
  let sent = 0;
  const results = [];

  // FCM sendEach supports up to 500 messages per batch
  for (const batch of chunkArray(messages, 500)) {
    const fcmMessages = batch.map((item) => {
      const msg = {
        token: item.meta.to,
        notification: {
          title: item.message.title,
          body: item.message.body,
        },
        data: Object.fromEntries(
          Object.entries(item.message.data || {}).map(([k, v]) => [k, String(v)])
        ),
      };

      if (item.meta.platform === 'android') {
        msg.android = {
          priority: 'high',
          notification: { channelId: 'default', sound: 'default' },
        };
      } else if (item.meta.platform === 'ios') {
        msg.apns = {
          payload: {
            aps: {
              sound: 'default',
              ...(item.message.badge != null ? { badge: item.message.badge } : {}),
            },
          },
        };
      }

      return msg;
    });

    try {
      const result = await messaging.sendEach(fcmMessages);
      sent += result.successCount || 0;
      (result.responses || []).forEach((resp, i) => {
        results.push({
          provider: 'fcm',
          success: !!resp?.success,
          provider_message_id: resp?.messageId || null,
          error: resp?.success ? null : (resp?.error?.message || 'FCM send failed'),
          response: {
            success: !!resp?.success,
            messageId: resp?.messageId || null,
            error: resp?.error?.message || null,
          },
          meta: batch[i]?.meta || null,
        });
        if (!resp.success && resp.error) {
          errors.push(`Token ${batch[i]?.meta?.to?.slice(0, 20)}...: ${resp.error.message}`);
        }
      });
    } catch (err) {
      errors.push(err.message || 'FCM batch send failed');
      batch.forEach((item) => {
        results.push({
          provider: 'fcm',
          success: false,
          provider_message_id: null,
          error: err.message || 'FCM batch send failed',
          response: {},
          meta: item?.meta || null,
        });
      });
    }
  }

  return { sent, errors, results };
}

async function sendExpoPushNotifications(messages = []) {
  const normalized = (Array.isArray(messages) ? messages : []).map((entry) => {
    const to = String(entry.to || '').trim();
    if (!to) return null;
    const base = normalizeMessagePayload(entry);
    return {
      meta: {
        to,
        user_id: entry.user_id != null ? Number(entry.user_id) : null,
        notification_id: entry.notification_id != null ? Number(entry.notification_id) : null,
        platform: String(entry.platform || '').trim().toLowerCase() || null,
      },
      message: {
        to,
        title: base.title,
        body: base.body,
        data: base.data,
        badge: base.badge,
        sound: 'default',
        priority: 'high',
      },
    };
  }).filter(Boolean);

  if (!normalized.length) {
    return { ok: true, sent: 0, errors: [], tickets: [], receipts: [] };
  }

  // Route by token type: FCM tokens go directly, Expo tokens go via Expo relay
  const fcmMessages = normalized.filter((m) => !isExpoPushToken(m.meta.to));
  const expoMessages = normalized.filter((m) => isExpoPushToken(m.meta.to));

  const [fcmResult, expoResult] = await Promise.all([
    sendViaFcm(fcmMessages),
    sendViaExpo(expoMessages),
  ]);

  const allErrors = [...(fcmResult.errors || []), ...(expoResult.errors || [])];
  const totalSent = (fcmResult.sent || 0) + (expoResult.sent || 0);

  return {
    ok: allErrors.length === 0,
    sent: totalSent,
    errors: allErrors,
    tickets: expoResult.tickets || [],
    receipts: [],
    results: [...(fcmResult.results || []), ...(expoResult.results || [])],
  };
}

module.exports = {
  normalizeMessagePayload,
  sendExpoPushNotifications,
};

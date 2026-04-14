function chunkArray(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function readJsonSafe(response) {
  try {
    return await response.json();
  } catch (_err) {
    return null;
  }
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
        ...(String(entry.platform || '').trim().toLowerCase() === 'android' ? { channelId: 'default' } : {}),
      },
    };
  }).filter(Boolean);

  if (!normalized.length) {
    return { ok: true, sent: 0, chunks: [], errors: [], tickets: [], receipts: [] };
  }

  const batches = chunkArray(normalized, 100);
  const chunks = [];
  const errors = [];
  const tickets = [];

  for (const batch of batches) {
    let response;
    try {
      response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(batch.map((item) => item.message)),
      });
    } catch (err) {
      errors.push(err.message || 'Push send request failed');
      continue;
    }

    const payload = await readJsonSafe(response);

    if (!response.ok) {
      errors.push(payload?.errors?.map((entry) => entry?.message).filter(Boolean).join(', ') || `Push send failed with HTTP ${response.status}`);
      continue;
    }

    const ticketData = Array.isArray(payload?.data) ? payload.data : [];
    ticketData.forEach((ticket, index) => {
      tickets.push({
        meta: batch[index]?.meta || null,
        ticket: ticket || null,
      });
    });

    chunks.push({
      request_count: batch.length,
      data: ticketData,
      errors: Array.isArray(payload?.errors) ? payload.errors : [],
    });
  }

  const receiptIds = tickets
    .map((entry) => String(entry?.ticket?.id || '').trim())
    .filter(Boolean);
  const receipts = [];
  for (const idBatch of chunkArray(receiptIds, 300)) {
    let response;
    try {
      response = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ ids: idBatch }),
      });
    } catch (err) {
      errors.push(err.message || 'Push receipt request failed');
      continue;
    }

    const payload = await readJsonSafe(response);
    if (!response.ok) {
      errors.push(payload?.errors?.map((entry) => entry?.message).filter(Boolean).join(', ') || `Push receipts failed with HTTP ${response.status}`);
      continue;
    }

    const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
    idBatch.forEach((id) => {
      receipts.push({ id, receipt: data[id] || null });
    });
  }

  const sent = chunks.reduce((sum, chunk) => sum + chunk.request_count, 0);
  const apiErrors = chunks.flatMap((chunk) => (chunk.errors || []).map((entry) => entry?.message).filter(Boolean));
  const ticketErrors = tickets
    .filter((entry) => entry?.ticket?.status === 'error')
    .map((entry) => entry?.ticket?.message || entry?.ticket?.details?.error)
    .filter(Boolean);
  const receiptErrors = receipts
    .filter((entry) => entry?.receipt?.status === 'error')
    .map((entry) => entry?.receipt?.message || entry?.receipt?.details?.error)
    .filter(Boolean);
  return {
    ok: errors.length === 0 && apiErrors.length === 0 && ticketErrors.length === 0 && receiptErrors.length === 0,
    sent,
    chunks,
    tickets,
    receipts,
    errors: [...errors, ...apiErrors, ...ticketErrors, ...receiptErrors],
  };
}

module.exports = {
  normalizeMessagePayload,
  sendExpoPushNotifications,
};

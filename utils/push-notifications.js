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

async function sendExpoPushNotifications(messages = []) {
  const normalized = (Array.isArray(messages) ? messages : []).map((entry) => {
    const to = String(entry.to || '').trim();
    if (!to) return null;
    const base = normalizeMessagePayload(entry);
    return {
      to,
      title: base.title,
      body: base.body,
      data: base.data,
      badge: base.badge,
      sound: 'default',
      priority: 'high',
    };
  }).filter(Boolean);

  if (!normalized.length) {
    return { ok: true, sent: 0, chunks: [], errors: [] };
  }

  const batches = chunkArray(normalized, 100);
  const chunks = [];
  const errors = [];

  for (const batch of batches) {
    let response;
    try {
      response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(batch),
      });
    } catch (err) {
      errors.push(err.message || 'Push send request failed');
      continue;
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch (_err) {
      payload = null;
    }

    if (!response.ok) {
      errors.push(payload?.errors?.map((entry) => entry?.message).filter(Boolean).join(', ') || `Push send failed with HTTP ${response.status}`);
      continue;
    }

    chunks.push({
      request_count: batch.length,
      data: Array.isArray(payload?.data) ? payload.data : [],
      errors: Array.isArray(payload?.errors) ? payload.errors : [],
    });
  }

  const sent = chunks.reduce((sum, chunk) => sum + chunk.request_count, 0);
  const apiErrors = chunks.flatMap((chunk) => (chunk.errors || []).map((entry) => entry?.message).filter(Boolean));
  return {
    ok: errors.length === 0 && apiErrors.length === 0,
    sent,
    chunks,
    errors: [...errors, ...apiErrors],
  };
}

module.exports = {
  normalizeMessagePayload,
  sendExpoPushNotifications,
};

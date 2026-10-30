const crypto = require('crypto');
const db = require('../db/transaction-capture');
const { error } = require('./capture-policy');
const { hash } = require('./transaction-capture');
const PROVIDERS = {
  email_gmail: { auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', scope: 'openid email https://www.googleapis.com/auth/gmail.readonly', prefix: 'CAPTURE_GOOGLE' },
  email_outlook: { auth: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', scope: 'offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read', prefix: 'CAPTURE_MICROSOFT' },
};
function key() {
  const value = Buffer.from(process.env.CAPTURE_TOKEN_ENCRYPTION_KEY || '', 'base64');
  if (value.length !== 32) throw error('Email token encryption key is not configured.', 503);
  return value;
}
function encrypt(value) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}
function decrypt(value) {
  const buffer = Buffer.from(value, 'base64'), decipher = crypto.createDecipheriv('aes-256-gcm', key(), buffer.subarray(0,12));
  decipher.setAuthTag(buffer.subarray(12,28));
  return JSON.parse(Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString());
}
function config(method) {
  const provider = PROVIDERS[method];
  if (!provider) throw error('Unsupported email provider.');
  const base = String(process.env.APP_BASE_URL || '').replace(/\/$/, '');
  if (!/^https:\/\//.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw error('APP_BASE_URL must be configured.', 503);
  const clientId = process.env[provider.prefix + '_CLIENT_ID'];
  const clientSecret = process.env[provider.prefix + '_CLIENT_SECRET'];
  if (!clientId || !clientSecret) throw error('Email OAuth credentials are not configured.', 503);
  key();
  return { ...provider, clientId, clientSecret, redirect: base + '/api/capture/email/callback/' + method };
}
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw error('Email provider request failed. Reconnect if the problem persists.', 502);
  return result;
}
async function exchange(method, params) {
  const c = config(method);
  return request(c.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, ...params }) });
}
async function start(userId, method, senders) {
  await db.assertMethod(userId, method);
  const c = config(method);
  const allowed = String(senders || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length || allowed.length > 20 || allowed.some(s => !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s))) throw error('Enter 1–20 exact bank or receipt sender email addresses.');
  const state = crypto.randomBytes(32).toString('base64url'), verifier = crypto.randomBytes(48).toString('base64url');
  await db.query('DELETE FROM transaction_capture_oauth WHERE expires_at<NOW()');
  await db.query('INSERT INTO transaction_capture_oauth(state_hash,user_id,method,verifier) VALUES($1,$2,$3,$4)', [hash(state), userId, method, encrypt({ verifier, senders: allowed })]);
  const url = new URL(c.auth);
  url.search = new URLSearchParams({ client_id: c.clientId, redirect_uri: c.redirect, response_type: 'code', scope: c.scope, state,
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    ...(method === 'email_gmail' ? { access_type: 'offline', prompt: 'consent' } : {}) }).toString();
  return url.toString();
}
async function callback(method, state, code) {
  await db.ensureSchema();
  const { rows } = await db.query('DELETE FROM transaction_capture_oauth WHERE state_hash=$1 AND method=$2 AND expires_at>NOW() RETURNING *', [hash(state), method]);
  if (!rows[0] || !code) throw error('Email connection expired or was declined. Start again.');
  const row = rows[0], saved = decrypt(row.verifier), c = config(method);
  await db.assertMethod(row.user_id, method);
  const tokens = await exchange(method, { code, code_verifier: saved.verifier, grant_type: 'authorization_code', redirect_uri: c.redirect });
  if (!tokens.refresh_token) throw error('Offline email access was not granted. Reconnect and approve access.');
  const profile = await request(method === 'email_gmail' ? 'https://gmail.googleapis.com/gmail/v1/users/me/profile' : 'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', { headers: { Authorization: 'Bearer ' + tokens.access_token } });
  await db.withTransaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)',[row.user_id]);
    await db.assertMethod(row.user_id,method,true,client);
    await client.query(`INSERT INTO transaction_capture_mailboxes(user_id,method,email,token_encrypted) VALUES($1,$2,$3,$4)
      ON CONFLICT(user_id,method) DO UPDATE SET email=$3,token_encrypted=$4,cursor_value=NULL,last_error=NULL`,
      [row.user_id, method, profile.emailAddress || profile.mail || profile.userPrincipalName, encrypt({ refresh_token: tokens.refresh_token, senders: saved.senders })]);
  });
}
function gmailBody(part) {
  if (part.mimeType === 'text/plain' && part.body?.data) return Buffer.from(part.body.data, 'base64url').toString('utf8');
  const children = (part.parts || []).map(gmailBody).filter(Boolean);
  if (children.length) return children.join('\n');
  return part.body?.data ? Buffer.from(part.body.data, 'base64url').toString('utf8').replace(/<[^>]+>/g,' ') : '';
}
const syncing = new Set();
async function sync(userId, method, service) {
  const syncKey = userId + ':' + method;
  if (syncing.has(syncKey)) throw error('Email sync is already running.', 409);
  syncing.add(syncKey);
  try {
    const access = await db.assertMethod(userId, method);
    const { rows } = await db.query('SELECT * FROM transaction_capture_mailboxes WHERE user_id=$1 AND method=$2', [userId, method]);
    const row = rows[0];
    if (!row) throw error('Connect your email account first.');
    const saved = decrypt(row.token_encrypted);
    const tokens = await exchange(method, { grant_type: 'refresh_token', refresh_token: saved.refresh_token });
    if (tokens.refresh_token) await db.query('UPDATE transaction_capture_mailboxes SET token_encrypted=$3 WHERE user_id=$1 AND method=$2', [userId, method, encrypt({ ...saved, refresh_token: tokens.refresh_token })]);
    const headers = { Authorization: 'Bearer ' + tokens.access_token };
    let messages = [], nextCursor = null;
    if (method === 'email_gmail') {
      const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
      url.search = new URLSearchParams({ maxResults: '50', q: 'newer_than:30d {' + saved.senders.map(s => 'from:' + s).join(' ') + '}', ...(row.cursor_value ? { pageToken: row.cursor_value } : {}) });
      const list = await request(url, { headers });
      nextCursor = list.nextPageToken || null;
      for (const item of list.messages || []) {
        const mail = await request('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + encodeURIComponent(item.id) + '?format=full', { headers });
        const from = mail.payload?.headers?.find(h => h.name.toLowerCase() === 'from')?.value || '';
        const sender = (from.match(/<([^>]+)>/)?.[1] || from).trim().toLowerCase();
        if(!saved.senders.includes(sender)) continue;
        const subject = mail.payload?.headers?.find(h => h.name.toLowerCase() === 'subject')?.value || '';
        messages.push({ id: mail.id, text: subject + '\n' + gmailBody(mail.payload || {}) });
      }
    } else {
      const url = new URL('https://graph.microsoft.com/v1.0/me/messages');
      const since = new Date(Date.now() - 30*86400000).toISOString();
      const senderFilter = saved.senders.map(sender => `from/emailAddress/address eq '${sender.replace(/'/g,"''")}'`).join(' or ');
      url.search = new URLSearchParams({ '$top': '50', '$select': 'id,subject,body,from,receivedDateTime', '$orderby': 'receivedDateTime desc', '$filter': `receivedDateTime ge ${since} and (${senderFilter})` });
      const target = row.cursor_value || url.toString();
      // A stored provider pagination URL must stay on Microsoft Graph.
      if (new URL(target).origin !== 'https://graph.microsoft.com') throw error('Invalid email cursor.');
      const result = await request(target, { headers: { ...headers, Prefer: 'outlook.body-content-type="text"' } });
      nextCursor = result['@odata.nextLink'] || null;
      messages = (result.value || []).filter(m => saved.senders.includes(String(m.from?.emailAddress?.address || '').toLowerCase())).map(m => ({ id: m.id, text: m.subject + '\n' + m.body?.content }));
    }
    let imported = 0, skipped = 0;
    for (const mail of messages) {
      try {
        const item = await service.ingest(userId, method, mail.text.slice(0,40000), { externalId: mail.id, ai: access.permissions.ai_read && access.preferences.ai_read });
        if (!item.duplicate) imported++;
      } catch (e) { if (e.statusCode === 422) skipped++; else throw e; }
    }
    await db.query('UPDATE transaction_capture_mailboxes SET last_sync_at=NOW(),last_error=NULL,cursor_value=$3 WHERE user_id=$1 AND method=$2', [userId, method, nextCursor]);
    return { imported, skipped, has_more: !!nextCursor };
  } catch(e) {
    await db.query('UPDATE transaction_capture_mailboxes SET last_error=$3 WHERE user_id=$1 AND method=$2', [userId, method, e.message]).catch(() => {});
    throw e;
  } finally { syncing.delete(syncKey); }
}
function startWorker(service) {
  if (process.env.CAPTURE_EMAIL_WORKER_ENABLED !== 'true') return;
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await db.ensureSchema();
      const { rows } = await db.query('SELECT user_id,method FROM transaction_capture_mailboxes ORDER BY last_sync_at NULLS FIRST LIMIT 100');
      for (const row of rows) await sync(row.user_id, row.method, service).catch(() => {});
    } catch(e) { console.error('[capture-email] Sync cycle failed:', e.message); }
    finally { busy = false; }
  }, 120000);
  timer.unref();
}
module.exports = { start, callback, sync, startWorker, config, encrypt, decrypt, gmailBody };

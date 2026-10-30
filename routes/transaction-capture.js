const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const db = require('../db/transaction-capture');
const email = require('../utils/capture-email');
const { METHODS, error, parseText, validDate } = require('../utils/capture-policy');
const { createService, serialize, hash } = require('../utils/transaction-capture');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { adminRateLimiter } = require('../middleware/security');
const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
module.exports = function captureRouter(dependencies) {
  const router = express.Router(), service = createService(dependencies);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10*1024*1024, files: 1 } });
  const buckets = new Map();
  const limit = (req,res,next) => {
    const key = String(req.session?.userId || req.ip), now = Date.now();
    if (buckets.size > 10000) for (const [k,v] of buckets) if (v.until < now) buckets.delete(k);
    const bucket = buckets.get(key);
    if (bucket && bucket.until > now && bucket.count >= 120) return res.status(429).json({ error: 'Capture limit reached. Try again later.' });
    buckets.set(key, bucket && bucket.until > now ? { ...bucket, count: bucket.count+1 } : { count: 1, until: now+3600000 });
    next();
  };
  async function tokenUser(token, method) {
    if (!token || String(token).length > 200) throw error('Invalid capture token.', 401);
    await db.ensureSchema();
    const { rows } = await db.query('SELECT user_id FROM transaction_capture_tokens WHERE token_hash=$1 AND method=$2', [hash(token), method]);
    if (!rows[0]) throw error('Capture token has expired or was revoked.', 401);
    await db.assertMethod(rows[0].user_id, method);
    return rows[0].user_id;
  }
  router.get('/email/callback/:method', wrap(async (req,res) => {
    await email.callback(req.params.method, req.query.state, req.query.code);
    res.type('html').send('<!doctype html><meta name="viewport" content="width=device-width"><title>Email connected</title><h1>Email connected</h1><p>Return to Expense Lite AI and sync your transaction emails.</p>');
  }));
  router.post('/shortcut', limit, wrap(async (req,res) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer /i,'');
    const userId = await tokenUser(token, 'ios_shortcut');
    const item = await service.ingest(userId, 'ios_shortcut', req.body?.text, { externalId: req.body?.event_id, ai: req.body?.ai === true });
    res.json({ success: true, item });
  }));
  router.post('/device', limit, wrap(async (req,res) => {
    const method = req.body?.method;
    if (!['android_notification','android_sms'].includes(method)) throw error('Invalid device method.');
    const userId = await tokenUser(String(req.headers.authorization || '').replace(/^Bearer /i,''), method);
    const access = await db.access(userId);
    const item = await service.ingest(userId,method,req.body?.text,{ externalId:req.body?.external_id, ai:access.permissions.ai_read && access.preferences.ai_read });
    res.json({success:true,item});
  }));
  router.post('/email/inbound', limit, wrap(async (req,res) => {
    const expected = process.env.CAPTURE_INBOUND_WEBHOOK_SECRET || '';
    const supplied = String(req.headers.authorization || '').replace(/^Bearer /i,'');
    if (expected.length < 32 || !crypto.timingSafeEqual(Buffer.from(hash(expected)), Buffer.from(hash(supplied)))) throw error('Inbound email gateway authentication failed.', 401);
    const local = String(req.body?.recipient || '').split('@')[0];
    const userId = await tokenUser(local.replace(/^capture\+/,''), 'email_forward');
    const access = await db.access(userId);
    const item = await service.ingest(userId, 'email_forward', String(req.body?.subject || '')+'\n'+String(req.body?.text || ''),
      { externalId: req.body?.message_id, ai: access.permissions.ai_read && access.preferences.ai_read });
    res.json({ success: true, item });
  }));
  router.use(requireAuth);
  router.get('/access', wrap(async (req,res) => res.json(await require('../utils/capture-availability').readAvailability(req.session.userId))));
  router.get('/methods', wrap(async (req,res) => {
    const access = await db.access(req.session.userId);
    const mailboxes = await db.query('SELECT method,email,last_sync_at,last_error FROM transaction_capture_mailboxes WHERE user_id=$1', [req.session.userId]);
    res.json({ ...access, methods: METHODS, mailboxes: mailboxes.rows, configured: {
      email_gmail: !!(process.env.CAPTURE_GOOGLE_CLIENT_ID && process.env.CAPTURE_GOOGLE_CLIENT_SECRET && process.env.CAPTURE_TOKEN_ENCRYPTION_KEY && process.env.APP_BASE_URL),
      email_outlook: !!(process.env.CAPTURE_MICROSOFT_CLIENT_ID && process.env.CAPTURE_MICROSOFT_CLIENT_SECRET && process.env.CAPTURE_TOKEN_ENCRYPTION_KEY && process.env.APP_BASE_URL),
      email_forward: !!(process.env.CAPTURE_INBOUND_DOMAIN && process.env.CAPTURE_INBOUND_WEBHOOK_SECRET?.length >= 32),
      ai_read: !!process.env.OPENAI_API_KEY,
    } });
  }));
  router.put('/preferences', wrap(async (req,res) => res.json(await db.setPreferences(req.session.userId, req.body?.preferences))));
  router.get('/admin/users/:id', adminRateLimiter, requireAdmin, wrap(async (req,res) => res.json({ ...(await db.access(req.params.id)), methods: METHODS })));
  router.put('/admin/users/:id', adminRateLimiter, requireAdmin, wrap(async (req,res) => res.json(await db.setPermissions(req.params.id, req.body?.permissions, req.session.userId))));
  router.get('/items', wrap(async (req,res) => {
    const access = await db.access(req.session.userId);
    const enabled = Object.keys(access.permissions).filter(k => access.permissions[k]);
    const { rows } = await db.query('SELECT * FROM transaction_capture_items WHERE user_id=$1 AND method=ANY($2::text[]) ORDER BY created_at DESC LIMIT 500', [req.session.userId, enabled]);
    res.json({ items: rows.map(serialize) });
  }));
  router.post('/items', limit, wrap(async (req,res) => {
    const method = req.body?.method;
    if (!['manual','clipboard','android_notification','android_sms','ios_shortcut'].includes(method)) throw error('Use the dedicated import endpoint for this method.');
    res.json({ item: await service.ingest(req.session.userId, method, req.body?.text, { ai: req.body?.ai === true, externalId: req.body?.external_id }) });
  }));
  router.post('/items/:id/confirm', wrap(async (req,res) => res.json({ success: true, ...(await service.confirm(req.session.userId,req.params.id,req.body || {})) })));
  router.patch('/items/:id', wrap(async (req,res) => {
    await db.ensureSchema();
    if (req.body?.status !== 'ignored') throw error('Only Ignore is supported; use Confirm to add an expense.');
    const { rows } = await db.query('SELECT method FROM transaction_capture_items WHERE user_id=$1 AND id=$2', [req.session.userId, req.params.id]);
    if (!rows[0]) throw error('Capture not found.',404);
    await db.assertMethod(req.session.userId,rows[0].method,false);
    await db.query("UPDATE transaction_capture_items SET status='ignored',updated_at=NOW() WHERE user_id=$1 AND id=$2 AND status='pending'", [req.session.userId,req.params.id]);
    res.json({ success:true });
  }));
  router.delete('/items/:id', wrap(async (req,res) => {
    await db.ensureSchema();
    await db.query('DELETE FROM transaction_capture_items WHERE user_id=$1 AND id=$2', [req.session.userId, req.params.id]);
    res.json({ success: true });
  }));
  router.post('/tokens/:method', wrap(async (req,res) => {
    const method = req.params.method;
    if (!['ios_shortcut','email_forward','android_notification','android_sms'].includes(method)) throw error('Unsupported token method.');
    await db.assertMethod(req.session.userId,method);
    if (!/^https:\/\//.test(process.env.APP_BASE_URL || '')) throw error('Configure an HTTPS APP_BASE_URL before generating capture tokens.',503);
    if (method === 'email_forward' && !process.env.CAPTURE_INBOUND_DOMAIN) throw error('Inbound email domain is not configured.',503);
    const token = crypto.randomBytes(32).toString('hex');
    await db.query(`INSERT INTO transaction_capture_tokens(user_id,method,token_hash) VALUES($1,$2,$3)
      ON CONFLICT(user_id,method) DO UPDATE SET token_hash=$3,created_at=NOW()`, [req.session.userId,method,hash(token)]);
    res.json(method === 'email_forward' ? { address: 'capture+'+token+'@'+process.env.CAPTURE_INBOUND_DOMAIN } : { token, endpoint: String(process.env.APP_BASE_URL || '').replace(/\/$/,'')+'/api/capture/'+(method === 'ios_shortcut' ? 'shortcut' : 'device') });
  }));
  router.delete('/tokens/:method', wrap(async (req,res) => {
    await db.ensureSchema();
    await db.query('DELETE FROM transaction_capture_tokens WHERE user_id=$1 AND method=$2',[req.session.userId,req.params.method]);
    res.json({ success:true });
  }));
  router.post('/email/:method/connect', limit, wrap(async (req,res) => res.json({ url: await email.start(req.session.userId,req.params.method,req.body?.senders) })));
  router.post('/email/:method/sync', limit, wrap(async (req,res) => res.json(await email.sync(req.session.userId,req.params.method,service))));
  router.delete('/email/:method', wrap(async (req,res) => {
    if(!['email_gmail','email_outlook'].includes(req.params.method)) throw error('Unsupported email provider.');
    await db.setPreferences(req.session.userId,{[req.params.method]:false});
    await db.ensureSchema();
    await db.query('DELETE FROM transaction_capture_mailboxes WHERE user_id=$1 AND method=$2',[req.session.userId,req.params.method]);
    res.json({ success:true });
  }));
  router.post('/import/:method', limit, wrap(async (req,res,next) => {
    if (!['receipt_image','statement_import','voice'].includes(req.params.method)) throw error('Unsupported file import method.');
    await db.assertMethod(req.session.userId,req.params.method);
    next();
  }), upload.single('file'), wrap(async (req,res) => {
    const method = req.params.method, userId = req.session.userId, file = req.file;
    if (!file) throw error('File is required.');
    const ai = req.body?.ai === 'true';
    if (ai || method === 'voice') await db.assertMethod(userId,'ai_read');
    let texts = [];
    if (method === 'voice') {
      if (!/\.(mp3|mp4|m4a|wav|webm|ogg)$/i.test(file.originalname)) throw error('Unsupported audio format.');
      texts = [await dependencies.transcribe(file)];
    } else if (method === 'receipt_image') {
      if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype)) throw error('Upload a receipt image.');
      if (ai) {
        const { draft } = await dependencies.scanReceipt(file);
        const amount = Number(draft.total_amount || draft.items?.reduce((sum,row) => sum+Number(row.amount || 0),0));
        texts = [`Paid INR ${amount} at ${draft.merchant || 'Receipt'}${validDate(draft.purchase_date) ? ' on '+draft.purchase_date : ''}`];
      } else {
        const result = await require('tesseract.js').recognize(file.buffer,'eng');
        const text = result.data.text;
        const total = text.match(/(?:grand total|total paid|amount paid|total amount|total)\s*[:=-]?\s*(?:Rs\.?|INR|₹)?\s*([\d,]+\.\d{2})/i);
        texts = total ? [`Paid INR ${total[1]} at Receipt\n${text}`] : [text];
      }
    } else if (/\.pdf$/i.test(file.originalname)) {
      const pages = await dependencies.pdfText(file.buffer,req.body?.password || '');
      texts = pages.flatMap(p => p.text.split(/(?=\b\d{2}[-/]\d{2}[-/]20\d{2}\b|\b20\d{2}[-/]\d{2}[-/]\d{2}\b)/)).filter(t => t.trim());
    } else if (/\.(csv|xlsx|xls)$/i.test(file.originalname)) {
      const XLSX = require('xlsx'), workbook = XLSX.read(file.buffer,{type:'buffer',cellDates:true,sheetRows:202});
      const rows = workbook.SheetNames.flatMap(name => XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval:'' }));
      texts = rows.map(row => {
        const values = Object.fromEntries(Object.entries(row).map(([k,v]) => [k.toLowerCase().replace(/[^a-z]/g,''),v]));
        const debit = Number(String(values.debit || values.withdrawal || values.withdrawals || '').replace(/,/g,''));
        const credit = Number(String(values.credit || values.deposit || values.deposits || '').replace(/,/g,''));
        const amount = debit || credit || Number(String(values.amount || '').replace(/,/g,''));
        const rawDate = values.date || values.transactiondate || values.valuedate;
        const date = rawDate instanceof Date ? rawDate.toISOString().slice(0,10) : String(rawDate || '');
        const direction = credit > 0 || /credit|^cr$/i.test(String(values.type || values.direction || '')) ? 'Credited'
          : debit > 0 || /debit|expense|^dr$/i.test(String(values.type || values.direction || '')) ? 'Paid' : 'Transaction';
        const merchant = String(values.description || values.narration || values.merchant || values.particulars || 'Statement transaction').replace(/[\r\n]/g,' ');
        const currency = /^[A-Z]{3}$/.test(String(values.currency || '')) ? String(values.currency) : 'INR';
        return `${direction} ${currency} ${Math.abs(amount)} at ${merchant} on ${date}${values.reference || values.utr ? ' ref '+(values.reference || values.utr) : ''}`;
      });
    } else throw error('Use CSV, Excel or a text-based PDF statement.');
    if (texts.length > 200) throw error('Import at most 200 transaction rows per file.');
    const items = [], skipped = [];
    for (let i=0;i<texts.length;i++) {
      try { items.push(await service.ingest(userId,method,texts[i],{ ai: ai || method === 'voice', externalId: hash(file.buffer.toString('base64'))+':'+i })); }
      catch(e) { if(e.statusCode === 422) skipped.push({row:i+1,error:e.message}); else throw e; }
    }
    res.json({ items, skipped });
  }));
  email.startWorker(service);
  router.use((err,req,res,next) => { if(res.headersSent) return next(err); res.status(err.statusCode || (err instanceof multer.MulterError ? 400 : 500)).json({ error: err.message || 'Capture failed.' }); });
  return router;
};

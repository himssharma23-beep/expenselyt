const METHODS = Object.freeze({
  manual: 'Typed transaction text', clipboard: 'Clipboard / shared text',
  android_notification: 'Android payment notifications', android_sms: 'Android bank SMS',
  ios_shortcut: 'iPhone Shortcuts (messages, notifications, Wallet)',
  email_gmail: 'Gmail connection', email_outlook: 'Outlook connection',
  email_forward: 'Forwarded transaction emails', receipt_image: 'Receipt / screenshot OCR',
  statement_import: 'CSV, Excel and PDF statements', voice: 'Voice transaction capture',
  ai_read: 'AI extraction and categorisation', auto_save: 'Automatic expense saving',
});
function error(message, statusCode = 400) { return Object.assign(new Error(message), { statusCode }); }
function validatePermissions(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw error('Permissions must be an object.');
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(METHODS, key) || typeof value !== 'boolean') throw error('Unknown method or invalid permission: ' + key);
  }
  return input;
}
function redact(text) {
  return String(text || '').replace(/\b\d{12,19}\b/g, '[account redacted]')
    .replace(/\b(?:otp|one.time password|verification code)\s*(?:is|:|-)?\s*\d{4,8}\b/gi, '[OTP redacted]');
}
function classify(text) {
  if (/\b(failed|declined|pending|unsuccessful|payment request|collect request)\b/i.test(text)) return 'pending';
  if (/\b(refund|reversal|reversed|cashback)\b/i.test(text)) return 'refund';
  if (/\b(own account|self transfer|credit card (?:bill|repayment)|card bill payment)\b/i.test(text)) return 'transfer';
  if (/\b(credited|received|salary|deposit)\b/i.test(text)) return 'credit';
  if (/\b(debited|spent|paid|withdrawn|purchase|payment successful)\b/i.test(text)) return 'debit';
  return 'unknown';
}
function validDate(value) {
  const s = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const date = new Date(s + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === s;
}
function parseText(raw, receivedAt) {
  const text = redact(raw).replace(/\s+/g, ' ').trim();
  if (!text || text.length > 40000) throw error('Transaction text must contain 1–40,000 characters.');
  // Prefer the transaction amount to a later available balance or reference number.
  const patterns = [
    /(?:debited|credited|spent|paid|received|withdrawn)(?:\s+(?:by|with|for|of))?\s*[:=-]?\s*(?:INR|Rs\.?|₹|USD|\$|GBP|£|EUR|€)\s*([\d,]+(?:\.\d{1,2})?)/i,
    /(?:INR|Rs\.?|₹|USD|\$|GBP|£|EUR|€)\s*([\d,]+(?:\.\d{1,2})?)\s*(?:(?:has been|was|is)\s*)?(?:debited|credited|spent|paid|received|withdrawn)/i,
    /(?:INR|Rs\.?|₹|USD|\$|GBP|£|EUR|€)\s*([\d,]+(?:\.\d{1,2})?)/i,
  ];
  const match = patterns.map(p => text.match(p)).find(Boolean);
  const amount = match ? Number(match[1].replace(/,/g, '')) : 0;
  const iso = text.match(/\b(20\d{2})[-/](\d{2})[-/](\d{2})\b/);
  const dmy = text.match(/\b(\d{2})[-/](\d{2})[-/](20\d{2})\b/);
  const date = iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : '';
  const merchant = text.match(/\b(?:at|paid to|sent to|merchant[: ]+)\s*([^.;\n]{2,80})/i)?.[1]?.split(/\s+(?:on|using|via|from|ref|available)\b/i)[0]?.trim() || '';
  // Retain references for deduplication without exposing them in the text sent to AI.
  const reference = String(raw || '').match(/\b(?:UTR|RRN|ref(?:erence)?|txn(?:\s*id)?|transaction\s*id)\s*[:#.-]?\s*([a-z0-9-]{6,40})\b/i)?.[1] || '';
  const last4 = text.match(/(?:xx|\*\*|ending\s*)(\d{4})/i)?.[1] || '';
  const direction = classify(text);
  const currency = /USD|\$/i.test(text) ? 'USD' : /GBP|£/i.test(text) ? 'GBP' : /EUR|€/i.test(text) ? 'EUR' : 'INR';
  return { raw_text: text, parsed_text: text, amount, currency, merchant, item_name: merchant || 'Payment',
    purchase_date: validDate(date) ? date : new Date(receivedAt || Date.now()).toISOString().slice(0, 10),
    date_inferred: !validDate(date), transaction_direction: direction, reference, account_last4: last4,
    confidence: amount > 0 && merchant && validDate(date) && direction === 'debit' ? 90 : 50,
    category: '', bank_account_id: null, card_id: null, detected_type: 'bank' };
}
function canAutoSave(suggestion, allowed, preferences) {
  return allowed.auto_save === true && preferences.auto_save === true && suggestion.transaction_direction === 'debit'
    && suggestion.amount > 0 && suggestion.confidence >= 95 && !suggestion.date_inferred
    && !!suggestion.reference && !!suggestion.bank_account_id && !suggestion.card_id;
}
module.exports = { METHODS, error, validatePermissions, redact, classify, validDate, parseText, canAutoSave };

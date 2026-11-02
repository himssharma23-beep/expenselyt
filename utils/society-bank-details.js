function normalizeSocietyBankDetails(value, current = {}) {
  if (value === undefined) return current || {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('Invalid society bank details'), {statusCode:400});
  const result = {};
  for (const [key, max] of [['bank_name',120],['account_number',80],['customer_number',80],['established_date',10],['qr_image_path',240]]) {
    if (value[key] != null && typeof value[key] !== 'string') throw Object.assign(new Error('Bank details must be text'), {statusCode:400});
    const text = String(value[key] || '').trim();
    if (text.length > max) throw Object.assign(new Error(`${key.replace(/_/g,' ')} is too long`), {statusCode:400});
    result[key] = text;
  }
  const date = result.established_date;
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date)) throw Object.assign(new Error('Invalid date of establishment'), {statusCode:400});
  if (result.qr_image_path && !/^\/uploads\/societies\/[a-zA-Z0-9_-]+\.(png|jpg|webp)$/.test(result.qr_image_path)) throw Object.assign(new Error('Invalid QR image path'), {statusCode:400});
  return result;
}
function societyQrImageExtension(file) {
  const b = file?.buffer;
  if (!b || b.length > 5*1024*1024) throw Object.assign(new Error('QR image must be at most 5 MB'), {statusCode:400});
  if (b.length >= 8 && b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return '.png';
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return '.jpg';
  if (b.length >= 12 && b.toString('ascii',0,4) === 'RIFF' && b.toString('ascii',8,12) === 'WEBP') return '.webp';
  throw Object.assign(new Error('Upload a PNG, JPEG or WebP QR image'), {statusCode:400});
}
module.exports = {normalizeSocietyBankDetails, societyQrImageExtension};

function isSmsEnabled() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
}

function normalizePhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const cleaned = raw.replace(/[^\d+]/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('+')) {
    const digits = cleaned.slice(1).replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) return '';
    return `+${digits}`;
  }
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return '';
  return `+${digits}`;
}

let twilioClient = null;
function getTwilioClient() {
  if (!isSmsEnabled()) return null;
  if (twilioClient) return twilioClient;
  // Lazy require so app still runs when twilio package/env is absent.
  // eslint-disable-next-line global-require
  const twilio = require('twilio');
  twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return twilioClient;
}

async function sendSms({ to, body }) {
  const client = getTwilioClient();
  if (!client) return { sent: false, reason: 'sms_not_configured' };
  const normalizedTo = normalizePhone(to);
  if (!normalizedTo) throw new Error('Invalid phone number');
  const message = await client.messages.create({
    from: process.env.TWILIO_FROM_NUMBER,
    to: normalizedTo,
    body: String(body || '').trim(),
  });
  return { sent: true, sid: message?.sid || null };
}

module.exports = {
  isSmsEnabled,
  normalizePhone,
  sendSms,
};


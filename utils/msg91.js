function isMsg91OtpEnabled() {
  return !!(process.env.MSG91_AUTH_KEY && process.env.MSG91_WIDGET_ID);
}

function isMsg91WidgetSdkEnabled() {
  return !!(process.env.MSG91_AUTH_KEY && process.env.MSG91_WIDGET_ID && process.env.MSG91_TOKEN_AUTH);
}

function isMsg91FlowSmsEnabled() {
  return !!(process.env.MSG91_AUTH_KEY && process.env.MSG91_SMS_FLOW_ID);
}

function normalizeIndianMobile(value) {
  const digits = String(value || '').replace(/\D+/g, '').trim();
  if (!digits) return '';
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  return '';
}

function maskIndianMobile(value) {
  const normalized = normalizeIndianMobile(value);
  if (!normalized) return '';
  const local = normalized.slice(-10);
  return `+91 ${local.slice(0, 2)}${'x'.repeat(6)}${local.slice(-2)}`;
}

async function parseMsg91Response(response) {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) return response.json();
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (_err) {
    return { message: text };
  }
}

async function sendMsg91Otp({ phone }) {
  if (!isMsg91OtpEnabled()) throw new Error('MSG91 OTP is not configured on the server');
  const mobile = normalizeIndianMobile(phone);
  if (!mobile) throw new Error('Enter a valid 10-digit Indian mobile number');
  const response = await fetch('https://api.msg91.com/api/v5/widget/sendOtp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authkey: process.env.MSG91_AUTH_KEY,
    },
    body: JSON.stringify({
      widgetId: process.env.MSG91_WIDGET_ID,
      identifier: mobile,
    }),
  });
  const data = await parseMsg91Response(response);
  if (!response.ok || String(data?.type || '').toLowerCase() === 'error') {
    throw new Error(String(data?.message || data?.error || 'Could not send OTP'));
  }
  const requestId = String(
    data?.reqId
    || data?.request_id
    || data?.requestId
    || data?.message
    || ''
  ).trim();
  return {
    requestId,
    mobile,
    maskedMobile: maskIndianMobile(mobile),
    raw: data,
  };
}

async function sendMsg91FlowSms({ phone, variables = {}, senderId = '' }) {
  if (!isMsg91FlowSmsEnabled()) throw new Error('MSG91 SMS flow is not configured on the server');
  const mobile = normalizeIndianMobile(phone);
  if (!mobile) throw new Error('Enter a valid 10-digit Indian mobile number');
  const recipient = { mobiles: mobile };
  Object.entries(variables || {}).forEach(([key, value]) => {
    const nextKey = String(key || '').trim();
    if (!nextKey) return;
    recipient[nextKey] = String(value ?? '').trim();
  });
  const payload = {
    flow_id: String(process.env.MSG91_SMS_FLOW_ID || '').trim(),
    recipients: [recipient],
  };
  const sender = String(senderId || process.env.MSG91_SMS_SENDER_ID || '').trim();
  if (sender) payload.sender = sender;
  const response = await fetch('https://api.msg91.com/api/v5/flow/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authkey: process.env.MSG91_AUTH_KEY,
    },
    body: JSON.stringify(payload),
  });
  const data = await parseMsg91Response(response);
  if (!response.ok || String(data?.type || '').toLowerCase() === 'error') {
    throw new Error(String(data?.message || data?.error || 'Could not send SMS'));
  }
  return {
    requestId: String(data?.message || data?.request_id || data?.requestId || '').trim(),
    mobile,
    maskedMobile: maskIndianMobile(mobile),
    raw: data,
  };
}

async function verifyMsg91Otp({ requestId, otp }) {
  if (!isMsg91OtpEnabled()) throw new Error('MSG91 OTP is not configured on the server');
  const reqId = String(requestId || '').trim();
  const code = String(otp || '').replace(/\D+/g, '').slice(0, 6);
  const widgetId = String(process.env.MSG91_WIDGET_ID || '').trim();
  if (!reqId) throw new Error('Missing OTP request id');
  if (!widgetId) throw new Error('Missing MSG91 widget id');
  if (!code || code.length < 4) throw new Error('Enter the OTP');
  const response = await fetch('https://api.msg91.com/api/v5/widget/verifyOtp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authkey: process.env.MSG91_AUTH_KEY,
    },
    body: JSON.stringify({
      widgetId,
      reqId,
      otp: code,
    }),
  });
  const data = await parseMsg91Response(response);
  if (!response.ok || String(data?.type || '').toLowerCase() === 'error') {
    throw new Error(String(data?.message || data?.error || 'OTP verification failed'));
  }
  return {
    success: true,
    raw: data,
  };
}

async function verifyMsg91AccessToken({ accessToken }) {
  if (!process.env.MSG91_AUTH_KEY) throw new Error('MSG91 auth key is not configured on the server');
  const token = String(accessToken || '').trim();
  if (!token) throw new Error('Missing MSG91 access token');
  const response = await fetch('https://control.msg91.com/api/v5/widget/verifyAccessToken', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      authkey: process.env.MSG91_AUTH_KEY,
      'access-token': token,
    }),
  });
  const data = await parseMsg91Response(response);
  if (!response.ok || String(data?.type || '').toLowerCase() === 'error') {
    throw new Error(String(data?.message || data?.error || 'MSG91 access token verification failed'));
  }
  return {
    success: true,
    raw: data,
  };
}

module.exports = {
  isMsg91OtpEnabled,
  isMsg91WidgetSdkEnabled,
  isMsg91FlowSmsEnabled,
  normalizeIndianMobile,
  maskIndianMobile,
  sendMsg91FlowSms,
  sendMsg91Otp,
  verifyMsg91Otp,
  verifyMsg91AccessToken,
};

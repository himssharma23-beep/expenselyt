async function verifyRecaptcha(token, remoteIp) {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!process.env.RECAPTCHA_SITE_KEY || !secret) {
    return { enabled: false, success: true };
  }
  if (!token) return { enabled: true, success: false, error: 'Captcha verification is required.' };

  const params = new URLSearchParams();
  params.set('secret', secret);
  params.set('response', token);
  if (remoteIp) params.set('remoteip', remoteIp);

  const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = await res.json();
  return {
    enabled: true,
    success: !!data.success,
    error: data['error-codes']?.join(', ') || null,
  };
}

module.exports = { verifyRecaptcha };

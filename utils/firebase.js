let _app = null;

function getFirebaseApp() {
  if (_app) return _app;
  const admin = require('firebase-admin');

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');

  let serviceAccount;
  try {
    // Support both raw JSON string and base64-encoded JSON
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    serviceAccount = JSON.parse(decoded);
  } catch (_) {
    try {
      serviceAccount = JSON.parse(raw);
    } catch (err) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT must be valid JSON or base64-encoded JSON');
    }
  }

  _app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  return _app;
}

function getMessaging() {
  const admin = require('firebase-admin');
  getFirebaseApp();
  return admin.messaging();
}

module.exports = { getMessaging };

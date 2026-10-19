const express = require('express');

const router = express.Router();

function platformConfig(env, platform) {
  const prefix = platform.toUpperCase();
  const latestVersion = String(env[`LATEST_${prefix}_APP_VERSION`] || '').trim().slice(0, 40);
  const defaultUrl = platform === 'android'
    ? 'https://play.google.com/store/apps/details?id=com.expenselyt.app'
    : 'https://apps.apple.com/us/app/expenselyt/id6761451207';
  return {
    latest_version: latestVersion || null,
    // The native checker expects force_update, rather than the web banner's force field.
    force_update: /^(1|true|yes|on)$/i.test(String(env[`${prefix}_UPDATE_FORCE`] || '').trim()),
    message: String(env[`${prefix}_UPDATE_MESSAGE`] || '').trim() || null,
    store_url: String(env[platform === 'android' ? 'ANDROID_PLAY_STORE_URL' : 'IOS_APP_STORE_URL'] || defaultUrl).trim(),
  };
}

// Called by the native startup gate without an auth token. The device compares
// its own installed version, independently of push registration or login state.
router.get('/api/mobile/version', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    android: platformConfig(process.env, 'android'),
    ios: platformConfig(process.env, 'ios'),
  });
});

module.exports = router;

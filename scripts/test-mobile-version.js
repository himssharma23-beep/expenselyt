const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

test('native startup can fetch update settings without authentication', async (t) => {
  const keys = [
    'LATEST_ANDROID_APP_VERSION', 'ANDROID_UPDATE_FORCE', 'ANDROID_UPDATE_MESSAGE',
    'ANDROID_PLAY_STORE_URL', 'LATEST_IOS_APP_VERSION', 'IOS_UPDATE_FORCE',
  ];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
  process.env.LATEST_ANDROID_APP_VERSION = '1.6';
  process.env.ANDROID_UPDATE_FORCE = 'false';
  process.env.ANDROID_UPDATE_MESSAGE = 'Version 1.6 is now available on Google Play.';
  delete process.env.ANDROID_PLAY_STORE_URL;
  process.env.LATEST_IOS_APP_VERSION = '1.3';
  process.env.IOS_UPDATE_FORCE = 'true';

  const app = express();
  app.use(require('../routes/mobile-version'));
  app.use((_req, res) => res.sendStatus(401));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/mobile/version?platform=android&version=1.5&build=15`;
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const payload = await response.json();
  assert.deepEqual(payload.android, {
    latest_version: '1.6',
    force_update: false,
    message: 'Version 1.6 is now available on Google Play.',
    store_url: 'https://play.google.com/store/apps/details?id=com.expenselyt.app',
  });
  assert.equal(payload.ios.latest_version, '1.3');
  assert.equal(payload.ios.force_update, true);

  process.env.ANDROID_UPDATE_FORCE = 'true';
  const forced = await (await fetch(url)).json();
  assert.equal(forced.android.force_update, true);

  delete process.env.LATEST_ANDROID_APP_VERSION;
  const disabled = await (await fetch(url)).json();
  assert.equal(disabled.android.latest_version, null);
});

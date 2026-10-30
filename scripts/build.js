const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

const filesToCheck = [
  'public/js/trip-detail-model.js',
  'public/js/own-trip-detail.js',
  'public/js/own-trips-list.js',
  'public/js/trip-checklist-identity.js',
  'public/js/trip-expense-currency.js',
  'routes/trip-checklist.js',
  'db/trip-checklist.js',
  'utils/trip-checklist.js',
  'utils/trip-checklist-reminders.js',
  'public/js/trip-checklist.js',
  'server.js',
  'routes/auth.js',
  'routes/mobile-version.js',
  'routes/api.js',
  'routes/transaction-capture.js',
  'utils/transaction-capture.js',
  'utils/capture-email.js',
  'utils/capture-policy.js',
  'utils/capture-availability.js',
  'db/transaction-capture.js',
  'public/js/transaction-capture.js',
  'db/postgres-auth.js',
  'db/postgres-core.js',
  'db/postgres-ops.js',
  'db/postgres-billing.js',
  'db/postgres-finance.js',
  'public/js/app.js',
  'public/js/pdf.js',
];

const dirsToEnsure = [
  'data',
  'public/uploads/profile',
];

function checkFile(file) {
  const fullPath = path.join(root, file);
  const result = spawnSync(process.execPath, ['--check', fullPath], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function ensureDir(dir) {
  fs.mkdirSync(path.join(root, dir), { recursive: true });
}

console.log('Building Expense Lite AI...');

dirsToEnsure.forEach(ensureDir);
filesToCheck.forEach(checkFile);

console.log('Build complete.');
console.log('This project does not bundle frontend assets; the build step validates server/app files and prepares runtime folders.');

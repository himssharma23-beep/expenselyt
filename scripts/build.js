const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

const filesToCheck = [
  'server.js',
  'routes/auth.js',
  'routes/api.js',
  'db/database.js',
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

#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${1:-}"
APP_DIR="${APP_DIR:-/var/www/expense-lite-ai}"
APP_NAME="${APP_NAME:-expense-lite-ai}"
LIVE_DIR="$APP_DIR/app"
SHARED_DIR="$APP_DIR/shared"
INCOMING_DIR="$APP_DIR/incoming"
ADMIN_RESET_EMAIL="${ADMIN_RESET_EMAIL:-}"
ADMIN_RESET_PASSWORD="${ADMIN_RESET_PASSWORD:-}"

if [[ -z "$SOURCE_DIR" ]]; then
  echo "Usage: APP_DIR=/var/www/expense-lite-ai APP_NAME=expense-lite-ai bash scripts/deploy-hostinger.sh /path/to/source"
  exit 1
fi

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Source directory does not exist: $SOURCE_DIR"
  exit 1
fi

echo "📁 Preparing directories..."
mkdir -p "$LIVE_DIR"
mkdir -p "$SHARED_DIR/data"
mkdir -p "$SHARED_DIR/public/uploads/profile"
mkdir -p "$INCOMING_DIR"

# Check dependencies
command -v rsync >/dev/null 2>&1 || { echo "❌ rsync not installed"; exit 1; }
command -v pm2 >/dev/null 2>&1 || { echo "❌ pm2 not installed"; exit 1; }

echo "🔄 Syncing files..."
rsync -a --delete \
  --exclude ".git" \
  --exclude ".github" \
  --exclude "node_modules" \
  --exclude "data" \
  --exclude ".env" \
  --exclude "public/uploads/profile" \
  "$SOURCE_DIR"/ "$LIVE_DIR"/

echo "🔗 Linking shared folders..."
ln -sfn "$SHARED_DIR/data" "$LIVE_DIR/data"
mkdir -p "$LIVE_DIR/public/uploads"
ln -sfn "$SHARED_DIR/public/uploads/profile" "$LIVE_DIR/public/uploads/profile"

if [[ -f "$SHARED_DIR/.env" ]]; then
  ln -sfn "$SHARED_DIR/.env" "$LIVE_DIR/.env"
else
  echo "⚠️ Warning: .env file not found in shared directory"
fi

cd "$LIVE_DIR"

echo "📦 Installing dependencies..."
rm -rf node_modules
npm ci --omit=dev

# OPTIONAL: enable if you later add build script
# echo "🏗️ Building app..."
# npm run build

# Optional admin password reset
if [[ -n "$ADMIN_RESET_EMAIL" && -n "$ADMIN_RESET_PASSWORD" ]]; then
  echo "🔐 Resetting admin password..."
  ADMIN_RESET_EMAIL="$ADMIN_RESET_EMAIL" ADMIN_RESET_PASSWORD="$ADMIN_RESET_PASSWORD" node -e "
    const bcrypt = require('bcryptjs');
    const db = require('./db/database').getDb();
    const email = String(process.env.ADMIN_RESET_EMAIL || '').toLowerCase().trim();
    const password = String(process.env.ADMIN_RESET_PASSWORD || '');
    if (!email || !password) throw new Error('Missing credentials');
    const user = db.prepare('SELECT id, email, role FROM users WHERE lower(email)=?').get(email);
    if (!user) throw new Error('User not found');
    db.prepare('UPDATE users SET password_hash=? WHERE id=?')
      .run(bcrypt.hashSync(password, 10), user.id);
    console.log('✅ Password reset for:', user.email);
  "
fi

echo "🛑 Stopping existing app (if any)..."
pm2 delete "$APP_NAME" || true

# Kill anything using port 3000 (safety)
echo "🧹 Cleaning port 3000..."
fuser -k 3000/tcp || true

echo "🚀 Starting application..."
pm2 start ecosystem.config.cjs --only "$APP_NAME" --update-env

pm2 save

echo "✅ Deployment successful!"
echo "🌐 Health check: curl http://127.0.0.1:${PORT:-3000}/health"
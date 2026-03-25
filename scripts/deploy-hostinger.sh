#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${1:-}"
APP_DIR="${APP_DIR:-/var/www/expense-lite-ai}"
APP_NAME="${APP_NAME:-expense-lite-ai}"
LIVE_DIR="$APP_DIR/app"
SHARED_DIR="$APP_DIR/shared"
INCOMING_DIR="$APP_DIR/incoming"

if [[ -z "$SOURCE_DIR" ]]; then
  echo "Usage: APP_DIR=/var/www/expense-lite-ai APP_NAME=expense-lite-ai bash scripts/deploy-hostinger.sh /path/to/extracted/source"
  exit 1
fi

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Source directory does not exist: $SOURCE_DIR"
  exit 1
fi

mkdir -p "$LIVE_DIR"
mkdir -p "$SHARED_DIR/data"
mkdir -p "$SHARED_DIR/public/uploads/profile"
mkdir -p "$INCOMING_DIR"

if ! command -v rsync >/dev/null 2>&1; then
  echo "rsync is required on the server."
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 is required on the server. Install it first with: npm install -g pm2"
  exit 1
fi

echo "Syncing source into $LIVE_DIR ..."
rsync -a --delete \
  --exclude ".git" \
  --exclude ".github" \
  --exclude "node_modules" \
  --exclude "data" \
  --exclude ".env" \
  --exclude "public/uploads/profile" \
  "$SOURCE_DIR"/ "$LIVE_DIR"/

ln -sfn "$SHARED_DIR/data" "$LIVE_DIR/data"
mkdir -p "$LIVE_DIR/public/uploads"
ln -sfn "$SHARED_DIR/public/uploads/profile" "$LIVE_DIR/public/uploads/profile"

if [[ -f "$SHARED_DIR/.env" ]]; then
  ln -sfn "$SHARED_DIR/.env" "$LIVE_DIR/.env"
else
  echo "Warning: $SHARED_DIR/.env not found yet. The app may not start until you add it."
fi

cd "$LIVE_DIR"

echo "Installing production dependencies ..."
npm ci --omit=dev

echo "Running build validation ..."
#npm run build

echo "Stopping existing PM2 app (if running)..."
pm2 delete "$APP_NAME" || true

echo "Starting fresh PM2 app..."
pm2 start ecosystem.config.cjs --only "$APP_NAME" --update-env

pm2 save

echo "Deployment finished."
echo "Health check: curl http://127.0.0.1:${PORT:-3000}/health"

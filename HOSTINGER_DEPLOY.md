# Hostinger VPS Auto Deploy

This project now includes a production deployment path for a Hostinger VPS with SSH access.

## What is included

- GitHub Actions workflow: `.github/workflows/deploy-hostinger.yml`
- Server deploy script: `scripts/deploy-hostinger.sh`
- PM2 config: `ecosystem.config.cjs`
- Health endpoint: `GET /health`

## 1. One-time VPS setup

Run these commands on your Hostinger VPS:

```bash
sudo apt update
sudo apt install -y nginx rsync curl git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
sudo mkdir -p /var/www/expense-lite-ai/shared/data
sudo mkdir -p /var/www/expense-lite-ai/shared/public/uploads/profile
sudo chown -R $USER:$USER /var/www/expense-lite-ai
```

## 2. Add production environment file

Create this file on the server:

`/var/www/expense-lite-ai/shared/.env`

Typical values:

```env
PORT=3000
SESSION_SECRET=replace-with-a-long-random-secret
ANTHROPIC_API_KEY=your-key-if-you-use-ai
```

## 3. Nginx reverse proxy

Create `/etc/nginx/sites-available/expense-lite-ai`:

```nginx
server {
    server_name your-domain.com www.your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable it:

```bash
sudo ln -s /etc/nginx/sites-available/expense-lite-ai /etc/nginx/sites-enabled/expense-lite-ai
sudo nginx -t
sudo systemctl reload nginx
```

Then add SSL:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

## 4. GitHub repository secrets and vars

Add these GitHub Actions secrets:

- `HOSTINGER_HOST`: your VPS IP or host
- `HOSTINGER_SSH_USER`: SSH username
- `HOSTINGER_SSH_KEY`: private SSH key used for deployment

Add these GitHub Actions variables:

- `HOSTINGER_APP_DIR`: `/var/www/expense-lite-ai`
- `HOSTINGER_APP_NAME`: `expense-lite-ai`
- `HOSTINGER_SSH_PORT`: `22`

If your provider uses a custom SSH port (for example `65002`), set `HOSTINGER_SSH_PORT` accordingly.
The workflow now auto-probes `22` and `65002` if no port is configured, but explicit config is recommended.

## 5. How deploys work

On every push to `main`, GitHub Actions will:

1. package the repo
2. upload it to the VPS over SSH
3. sync code into `/var/www/expense-lite-ai/app`
4. preserve shared environment files and uploaded profile pictures
5. run `npm ci --omit=dev`
6. run `npm run build`
7. restart or reload the app with PM2

## 6. Useful server commands

```bash
pm2 status
pm2 logs expense-lite-ai
pm2 restart expense-lite-ai
curl http://127.0.0.1:3000/health
```

## PostgreSQL enablement

Add Postgres env vars into:

`/var/www/expense-lite-ai/shared/.env`

Example:

```env
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/expense_lite_ai
PGSSL=require
```

Or:

```env
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=postgres
PGPASSWORD=your-password
PGDATABASE=expense_lite_ai
PGSSL=require
```

Then on the server:

```bash
cd /var/www/expense-lite-ai/app
npm install
npm run check:postgres
npm run migrate:postgres
pm2 restart expense-lite-ai --update-env
curl http://127.0.0.1:3000/health
```

If `/health` shows `"db_provider":"postgres"`, the live app is running in Postgres mode.

## 7. Optional live admin password reset during deploy

If you need to reset the live admin password, the deploy script supports it with env vars:

```bash
ADMIN_RESET_EMAIL=hims.sharma23@gmail.com \
ADMIN_RESET_PASSWORD='Admin@12345' \
APP_DIR=/var/www/expense-lite-ai \
APP_NAME=expense-lite-ai \
bash scripts/deploy-hostinger.sh /path/to/source
```

This only runs when both `ADMIN_RESET_EMAIL` and `ADMIN_RESET_PASSWORD` are provided.

## Notes

- PostgreSQL data lives in your configured Postgres server/database
- Profile uploads are stored in `/var/www/expense-lite-ai/shared/public/uploads/profile`
- The workflow assumes your production branch is `main`

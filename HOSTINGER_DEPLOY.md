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

## 5. How deploys work

On every push to `main`, GitHub Actions will:

1. package the repo
2. upload it to the VPS over SSH
3. sync code into `/var/www/expense-lite-ai/app`
4. preserve shared SQLite data and uploaded profile pictures
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

## Notes

- SQLite data is stored in `/var/www/expense-lite-ai/shared/data`
- Profile uploads are stored in `/var/www/expense-lite-ai/shared/public/uploads/profile`
- The workflow assumes your production branch is `main`

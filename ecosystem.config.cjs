module.exports = {
  apps: [
    {
      name: process.env.APP_NAME || 'expense-lite-ai',
      script: 'server.js',
      cwd: process.cwd(),
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3000,
        PUPPETEER_CACHE_DIR: process.env.PUPPETEER_CACHE_DIR || '/var/www/expense-lite-ai/shared/.cache/puppeteer',
      },
    },
  ],
};

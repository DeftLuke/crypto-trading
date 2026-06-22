const path = require('path');

const root = path.resolve(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'research-api',
      script: path.join(root, 'scripts/research-api-run.sh'),
      interpreter: 'bash',
      cwd: root,
      autorestart: true,
      watch: false,
      max_restarts: 100,
      min_uptime: '15s',
      restart_delay: 5000,
      kill_timeout: 15000,
      max_memory_restart: '3G',
      merge_logs: true,
      time: true,
      out_file: path.join(root, 'research-platform/data/pm2-research-api.log'),
      error_file: path.join(root, 'research-platform/data/pm2-research-api.log'),
      env: {
        NODE_ENV: 'production',
        SCHEDULER_ENABLED: 'false',
        MEMORY_ENABLED: 'false',
        AGENT_ENABLED: 'false',
        DATABASE_REQUIRED: 'false',
        POLARS_MAX_THREADS: '2',
        MARKET_DATA_REFRESH_INTERVAL_SEC: '45',
        UVICORN_WORKERS: '1',
        UVICORN_LIMIT_CONCURRENCY: '24',
        UVICORN_LIMIT_MAX_REQUESTS: '5000',
      },
    },
  ],
};

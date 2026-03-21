module.exports = {
  apps: [
    {
      name: 'flowkyn-api',
      script: 'dist/index.js',
      instances: 'max',        // Use all CPU cores
      exec_mode: 'cluster',    // Cluster mode for load balancing
      env: {
        NODE_ENV: 'production',
      },
      // Auto-restart on crash
      max_memory_restart: '512M',
      // Logging
      error_file: './logs/error.log',
      out_file: './logs/output.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      // Graceful restart
      kill_timeout: 30000,
      listen_timeout: 10000,
      // Watch (disable in production)
      watch: false,
    },
    // Performance optimization: Refresh admin stats cache every 5 minutes
    {
      name: 'refresh-admin-stats',
      script: 'dist/jobs/refreshAdminStats.js',
      instances: 1,
      cron_time: '*/5 * * * *', // Every 5 minutes
      autorestart: true,
      max_memory_restart: '256M',
      error_file: './logs/refresh-admin-stats-error.log',
      out_file: './logs/refresh-admin-stats.log',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};

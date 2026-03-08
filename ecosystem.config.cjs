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
  ],
};

module.exports = {
  apps: [
    {
      name: 'flowkyn-api',
      script: 'dist/index.js',
      instances: 1,             // Single instance — Socket.IO requires Redis adapter for multi-worker
      exec_mode: 'fork',        // Fork mode (no cluster) — avoids cross-worker Socket.IO issues
      env: {
        NODE_ENV: 'production',
        NODE_OPTIONS: '--no-deprecation',
      },
      
      // ═══════════════════════════════════════════════════════════════
      // Graceful Shutdown Settings (Zero-Downtime Deployment)
      // ═══════════════════════════════════════════════════════════════
      
      // Time to wait for app to handle SIGTERM before force killing
      kill_timeout: 30000,           // 30 seconds
      
      // Time to wait for app to be ready after restart
      listen_timeout: 10000,         // 10 seconds
      
      // Wait for app to emit 'ready' event (optional)
      wait_ready: false,             // Set to true if app emits ready signal
      
      // Send SIGTERM instead of SIGKILL on restart
      shutdown_with_message: true,
      
      // ═══════════════════════════════════════════════════════════════
      // Memory Management
      // ═══════════════════════════════════════════════════════════════
      
      // Restart if memory exceeds 512MB
      max_memory_restart: '512M',
      
      // Monitor memory usage
      instance_var: 'INSTANCE_ID',
      
      // ═══════════════════════════════════════════════════════════════
      // Logging
      // ═══════════════════════════════════════════════════════════════
      
      error_file: './logs/error.log',
      out_file: './logs/output.log',
      log_file: './logs/combined.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      
      // ═══════════════════════════════════════════════════════════════
      // Auto Restart
      // ═══════════════════════════════════════════════════════════════
      
      // Auto restart if app crashes
      autorestart: true,
      
      // Max restarts before giving up (limit runaway restarts)
      max_restarts: 10,
      
      // Time window for max_restarts (1 minute)
      min_uptime: '60s',
      
      // ═══════════════════════════════════════════════════════════════
      // Monitoring & Health Checks
      // ═══════════════════════════════════════════════════════════════
      
      // Monitor CPU usage
      max_memory: 1024,   // MB
      
      // Node args (for debugging)
      node_args: [],
      
      // ═══════════════════════════════════════════════════════════════
      // Do NOT enable in production - slows down restart
      // ═══════════════════════════════════════════════════════════════
      watch: false,  // Set to ['src'] only for development
    },
    
    // ═════════════════════════════════════════════════════════════════
    // Background Job: Refresh Admin Stats Cache
    // ═════════════════════════════════════════════════════════════════
    {
      name: 'refresh-admin-stats',
      script: 'dist/jobs/refreshAdminStats.js',
      instances: 1,
      exec_mode: 'fork',
      
      // Run every 5 minutes
      cron_time: '*/5 * * * *',
      autorestart: true,
      
      max_memory_restart: '256M',
      error_file: './logs/refresh-admin-stats-error.log',
      out_file: './logs/refresh-admin-stats.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      
      env: {
        NODE_ENV: 'production',
        NODE_OPTIONS: '--no-deprecation',
      },
    },
  ],

  // ═════════════════════════════════════════════════════════════════
  // Deployment Configuration
  // ═════════════════════════════════════════════════════════════════
  deploy: {
    production: {
      user: 'deployuser',
      host: 'api.flowkyn.com',
      ref: 'origin/main',
      repo: 'git@github.com:ihebchebbi1998tn/flowkyn_backend.git',
      path: '/var/www/flowkyn-backend',
      'post-deploy': 'npm ci && npm run build && (pm2 delete flowkyn-api || true) && (pm2 delete refresh-admin-stats || true) && pm2 start ecosystem.config.cjs --update-env && pm2 save',
      'pre-deploy-local': 'echo "Deploying to production"',
    },
    staging: {
      user: 'deployuser',
      host: 'staging-api.flowkyn.com',
      ref: 'origin/develop',
      repo: 'git@github.com:ihebchebbi1998tn/flowkyn_backend.git',
      path: '/var/www/flowkyn-backend-staging',
      'post-deploy': 'npm ci && npm run build && (pm2 delete flowkyn-api || true) && (pm2 delete refresh-admin-stats || true) && pm2 start ecosystem.config.cjs --update-env && pm2 save',
    },
  },
};


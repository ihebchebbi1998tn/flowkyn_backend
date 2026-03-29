import { createServer } from 'http';
import { app } from './app';
import { env } from './config/env';
import { initializeSocket } from './socket';
import { pool, checkConnection, stopPoolMonitor } from './config/database';
import { runMigrations } from './config/migrate';
import { startCleanupCron, stopCleanupCron } from './services/cleanup.service';
import { scheduleDiscussionTimer } from './jobs/discussionTimer';
import { seedSuperAdmin } from './config/seedAdmin';

async function bootstrap() {
  // 1. Verify database connectivity
  const dbOk = await checkConnection();
  if (!dbOk) {
    console.error('❌ Cannot connect to database. Exiting.');
    process.exit(1);
  }

  // 2. Run auto-migrations (always — idempotent, skips already-applied versions)
  await runMigrations();

  // 3. Seed super admin (always — no-op if account already exists)
  await seedSuperAdmin();

  // 4. Create HTTP server & attach Socket.io
  const server = createServer(app);
  initializeSocket(server);

  // 5. Configure server for high concurrency
  server.maxConnections = 10000;
  server.keepAliveTimeout = 65000; // Slightly above ALB/Nginx default (60s)
  server.headersTimeout = 66000;

  // 6. Start cleanup cron (every 30 min)
  startCleanupCron();

  // 6b. Start discussion timer job (every 60 seconds)
  // This auto-closes expired discussions and transitions to debrief phase
  const discussionTimerInterval = scheduleDiscussionTimer();

  // 7. Start listening
  server.listen(env.port, () => {});

  // Graceful shutdown — wait for in-flight requests
  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return; // Prevent double shutdown
    isShuttingDown = true;

    stopPoolMonitor();

    stopCleanupCron();

    // Stop discussion timer job
    clearInterval(discussionTimerInterval);

    // Stop accepting new connections, wait for existing to finish (max 30s)
    const forceTimeout = setTimeout(() => {
      console.error('  ⚠️ Force shutdown after 30s timeout');
      process.exit(1);
    }, 30000);

    server.close(() => {
      clearTimeout(forceTimeout);
    });

    await pool.end();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Catch unhandled errors
  process.on('unhandledRejection', (reason) => {
    console.error('⚠️  Unhandled rejection:', reason);
  });

  process.on('uncaughtException', (err) => {
    console.error('⚠️  Uncaught exception:', err);
    shutdown('UNCAUGHT_EXCEPTION');
  });
}

bootstrap().catch((err) => {
  console.error('❌ Fatal startup error:', err);
  process.exit(1);
});

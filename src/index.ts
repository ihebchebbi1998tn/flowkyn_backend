import { createServer } from 'http';
import { app } from './app';
import { env } from './config/env';
import { initializeSocket } from './socket';
import { pool, checkConnection } from './config/database';
import { runMigrations } from './config/migrate';
import { startCleanupCron, stopCleanupCron } from './services/cleanup.service';

async function bootstrap() {
  // 1. Verify database connectivity
  const dbOk = await checkConnection();
  if (!dbOk) {
    console.error('❌ Cannot connect to database. Exiting.');
    process.exit(1);
  }
  console.log('✅ Database connected');

  // 2. Run auto-migrations (creates tables if not exists)
  await runMigrations();

  // 3. Create HTTP server & attach Socket.io
  const server = createServer(app);
  initializeSocket(server);

  // 4. Start cleanup cron (every 30 min)
  startCleanupCron();

  // 5. Start listening
  server.listen(env.port, () => {
    console.log(`🚀 Flowkyn API running on port ${env.port} [${env.nodeEnv}]`);
    console.log(`   Health:  http://localhost:${env.port}/health`);
    console.log(`   API:     http://localhost:${env.port}/v1`);
    console.log(`   Monitor: http://localhost:${env.port}/monitor`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n⏳ ${signal} received — shutting down gracefully...`);

    stopCleanupCron();
    console.log('  ✅ Cleanup cron stopped');

    server.close(() => {
      console.log('  ✅ HTTP server closed');
    });

    await pool.end();
    console.log('  ✅ Database pool closed');
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
    process.exit(1);
  });
}

bootstrap().catch((err) => {
  console.error('❌ Fatal startup error:', err);
  process.exit(1);
});

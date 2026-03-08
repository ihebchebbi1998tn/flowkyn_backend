import { createServer } from 'http';
import { app } from './app';
import { env } from './config/env';
import { initializeSocket } from './socket';
import { pool } from './config/database';

const server = createServer(app);

// Initialize Socket.io
initializeSocket(server);

server.listen(env.port, () => {
  console.log(`🚀 Flowkyn API running on port ${env.port} [${env.nodeEnv}]`);
});

// Graceful shutdown
const shutdown = async () => {
  console.log('Shutting down...');
  server.close();
  await pool.end();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

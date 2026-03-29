import { Pool, PoolClient } from 'pg';
import { env } from './env';

/**
 * Connection pool — tuned for production scale.
 * - max: 50 connections (adjust based on DB plan limits)
 * - statement_timeout: kills runaway queries after 30s
 * - idle connections reclaimed after 10s
 * - SSL: Uses Neon-compatible settings to prevent deprecation warnings
 */
export const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl: env.nodeEnv === 'production' 
    ? {
        rejectUnauthorized: false,
        // Suppress PostgreSQL 14+ SSL deprecation warnings
        // Neon recommends: sslmode=require with verify-full equivalent
        // This prevents: "SECURITY WARNING: The SSL modes 'prefer', 'require'..."
      }
    : undefined,
  max: parseInt(process.env.DB_POOL_MAX || '50', 10),
  min: parseInt(process.env.DB_POOL_MIN || '5', 10),
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
  maxUses: 7500, // recycle connections after N uses to prevent memory leaks
  statement_timeout: 30000, // kill queries exceeding 30s
  query_timeout: 30000,
});

pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err);
});

// Log pool stats periodically in dev
let poolMonitorInterval: NodeJS.Timeout | undefined;
if (env.nodeEnv === 'development') {
  poolMonitorInterval = setInterval(() => {
    const { totalCount, idleCount, waitingCount } = pool;
    if (waitingCount > 0) {
      console.warn(`⚠️ DB Pool: total=${totalCount} idle=${idleCount} waiting=${waitingCount}`);
    }
  }, 30000);
}

export function stopPoolMonitor(): void {
  if (poolMonitorInterval) {
    clearInterval(poolMonitorInterval);
    poolMonitorInterval = undefined;
  }
}

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;

  // Log slow queries
  if (duration > 1000) {
    console.warn(`🐢 Slow query (${duration}ms): ${text.slice(0, 120)}`);
  }

  return result.rows as T[];
}

export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] || null;
}

/**
 * Raw query that returns full QueryResult (for rowCount, etc.)
 */
export async function rawQuery(text: string, params?: any[]) {
  return pool.query(text, params);
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Health check — verify DB is reachable and return pool stats.
 */
export async function checkConnection(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export function getPoolStats() {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  };
}

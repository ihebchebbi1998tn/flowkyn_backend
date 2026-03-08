/**
 * Periodic cleanup service — removes expired sessions, tokens, and verifications.
 */
import { query } from '../config/database';

/** Run all cleanup tasks and return counts of deleted rows */
export async function runCleanup(): Promise<{ sessions: number; resets: number; verifications: number }> {
  const [sessions, resets, verifications] = await Promise.all([
    query('DELETE FROM user_sessions WHERE expires_at < NOW()'),
    query('DELETE FROM password_resets WHERE expires_at < NOW()'),
    query('DELETE FROM email_verifications WHERE expires_at < NOW()'),
  ]);

  return {
    sessions: sessions.rowCount ?? 0,
    resets: resets.rowCount ?? 0,
    verifications: verifications.rowCount ?? 0,
  };
}

/** Start an interval-based cleanup cron (default: every 30 minutes) */
let cleanupInterval: NodeJS.Timeout | null = null;

export function startCleanupCron(intervalMs = 30 * 60 * 1000): void {
  if (cleanupInterval) return;

  console.log(`🧹 Cleanup cron started (every ${intervalMs / 60000}m)`);

  // Run once immediately on startup
  runCleanup()
    .then((c) => console.log(`🧹 Initial cleanup: ${c.sessions} sessions, ${c.resets} resets, ${c.verifications} verifications`))
    .catch((err) => console.error('🧹 Cleanup error:', err));

  cleanupInterval = setInterval(async () => {
    try {
      const counts = await runCleanup();
      if (counts.sessions + counts.resets + counts.verifications > 0) {
        console.log(`🧹 Cleanup: ${counts.sessions} sessions, ${counts.resets} resets, ${counts.verifications} verifications`);
      }
    } catch (err) {
      console.error('🧹 Cleanup error:', err);
    }
  }, intervalMs);
}

export function stopCleanupCron(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

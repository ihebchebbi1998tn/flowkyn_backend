/**
 * Periodic cleanup service — removes expired sessions, tokens, verifications,
 * invitations, old analytics/audit data, and purges soft-deleted users beyond retention.
 */
import { rawQuery } from '../config/database';

/** Run all cleanup tasks and return counts of deleted rows */
export async function runCleanup(): Promise<{
  sessions: number;
  resets: number;
  verifications: number;
  orgInvitations: number;
  eventInvitations: number;
  analytics: number;
  auditLogs: number;
  notifications: number;
  deletedUsers: number;
}> {
  const [
    sessions,
    resets,
    verifications,
    orgInvitations,
    eventInvitations,
    analytics,
    auditLogs,
    notifications,
    deletedUsers,
  ] = await Promise.all([
    rawQuery('DELETE FROM user_sessions WHERE expires_at < NOW()'),
    rawQuery('DELETE FROM password_resets WHERE expires_at < NOW()'),
    rawQuery('DELETE FROM email_verifications WHERE expires_at < NOW()'),
    rawQuery("DELETE FROM organization_invitations WHERE expires_at < NOW() AND status = 'pending'"),
    rawQuery("DELETE FROM event_invitations WHERE expires_at < NOW() AND status = 'pending'"),
    rawQuery("DELETE FROM analytics_events WHERE created_at < NOW() - INTERVAL '90 days'"),
    rawQuery("DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '180 days'"),
    rawQuery("DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < NOW() - INTERVAL '60 days'"),
    // Purge soft-deleted users after 30 days
    rawQuery("DELETE FROM users WHERE status = 'deleted' AND updated_at < NOW() - INTERVAL '30 days'"),
  ]);

  return {
    sessions: sessions.rowCount ?? 0,
    resets: resets.rowCount ?? 0,
    verifications: verifications.rowCount ?? 0,
    orgInvitations: orgInvitations.rowCount ?? 0,
    eventInvitations: eventInvitations.rowCount ?? 0,
    analytics: analytics.rowCount ?? 0,
    auditLogs: auditLogs.rowCount ?? 0,
    notifications: notifications.rowCount ?? 0,
    deletedUsers: deletedUsers.rowCount ?? 0,
  };
}

/** Start an interval-based cleanup cron (default: every 30 minutes) */
let cleanupInterval: NodeJS.Timeout | null = null;

export function startCleanupCron(intervalMs = 30 * 60 * 1000): void {
  if (cleanupInterval) return;

  runCleanup()
    .then((c) => {
      void c;
    })
    .catch((err) => console.error('🧹 Cleanup error:', err));

  cleanupInterval = setInterval(async () => {
    try {
      const c = await runCleanup();
      const total = Object.values(c).reduce((a, b) => a + b, 0);
      if (total > 0) void c;
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

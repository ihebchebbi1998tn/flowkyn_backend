import { query } from '../../config/database';

/**
 * Log action to audit_logs table for investigation and dispute resolution
 * Non-blocking: logs asynchronously, errors are caught and logged
 */
export async function logAuditEvent(data: {
  eventId: string;
  gameSessionId?: string;
  participantId?: string;
  userId?: string | null;
  action: string;
  details?: any;
  ipAddress?: string;
  status?: 'success' | 'error' | 'retry';
}): Promise<void> {
  try {
    // Sanitize userId: guest user IDs (e.g. "guest:uuid") are not valid UUIDs.
    // Store null for user_id when the actor is a guest (participantId is already recorded).
    let safeUserId = data.userId || null;
    if (safeUserId && safeUserId.startsWith('guest:')) {
      safeUserId = null;
    }

    await query(
      `INSERT INTO audit_logs (event_id, game_session_id, participant_id, user_id, action, details, ip_address, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        data.eventId,
        data.gameSessionId || null,
        data.participantId || null,
        safeUserId,
        data.action,
        data.details ? JSON.stringify(data.details) : null,
        data.ipAddress || null,
        data.status || 'success',
      ]
    );
  } catch (err: any) {
    console.error('[Audit] Failed to log event:', {
      action: data.action,
      error: err?.message,
      timestamp: new Date().toISOString(),
    });
  }
}

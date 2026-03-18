/**
 * Strategic Escape Game - Discussion Timer Job
 * 
 * Runs every 60 seconds to check for discussions that have expired.
 * When a discussion expires, automatically transitions to debrief phase.
 * 
 * This solves the critical issue: "Discussions run indefinitely"
 */

import { query, queryOne } from '../config/database';
import { emitGameUpdate } from '../socket/emitter';
import { env } from '../config/env';

/**
 * Check all active discussions and auto-close expired ones
 */
export async function enforceDiscussionTimeouts() {
  try {
    // Find all sessions in discussion phase where discussion_ends_at has passed
    const expiredSessions = await query<{
      id: string;
      event_id: string;
      discussion_ends_at: string;
    }>(
      `SELECT id, event_id, discussion_ends_at
       FROM game_sessions
       WHERE status = 'active'
         AND discussion_ends_at IS NOT NULL
         AND discussion_ends_at < NOW()
         AND (phase IS NULL OR phase != 'debrief')  -- Don't re-process debrief sessions
       LIMIT 100`,  // Process max 100 per run to avoid timeout
      []
    );

    if (expiredSessions.length === 0) {
      return;  // Nothing to do
    }

    console.log(`[DiscussionTimer] Found ${expiredSessions.length} expired discussions`);

    // Process each expired session
    for (const session of expiredSessions) {
      try {
        await transitionToDebrief(session.id, session.event_id);
      } catch (error) {
        console.error(`[DiscussionTimer] Error transitioning session ${session.id}:`, error);
      }
    }
  } catch (error) {
    console.error('[DiscussionTimer] Unexpected error:', error);
  }
}

/**
 * Transition a session from discussion to debrief phase
 */
async function transitionToDebrief(sessionId: string, eventId: string) {
  try {
    // Get the latest snapshot
    const snapshot = await queryOne<{
      id: string;
      state: any;
    }>(
      `SELECT id, state FROM game_state_snapshots
       WHERE game_session_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [sessionId]
    );

    if (!snapshot) {
      console.warn(`[DiscussionTimer] No snapshot found for session ${sessionId}`);
      return;
    }

    // Update snapshot to debrief phase
    const state = typeof snapshot.state === 'string' ? JSON.parse(snapshot.state) : snapshot.state;
    const newState = {
      ...state,
      phase: 'debrief',
      debrief_started_at: new Date().toISOString(),
    };

    // Insert new snapshot for debrief phase
    await query(
      `INSERT INTO game_state_snapshots (id, game_session_id, state, created_at)
       VALUES (uuid_generate_v4(), $1, $2, NOW())`,
      [sessionId, JSON.stringify(newState)]
    );

    // Update session phase metadata
    await query(
      `UPDATE game_sessions 
       SET debrief_sent_at = NOW()
       WHERE id = $1`,
      [sessionId]
    );

    console.log(`[DiscussionTimer] Transitioned session ${sessionId} to debrief phase`);

    // Emit socket event to all participants in this event
    // This tells clients to update their UI to debrief phase
    emitGameUpdate(sessionId, 'strategic:debrief_started', {
      phase: 'debrief',
      state: newState,
    });

  } catch (error) {
    console.error(`[DiscussionTimer] Error in transitionToDebrief:`, error);
    throw error;
  }
}

/**
 * Schedule the discussion timer to run every 60 seconds
 */
export function scheduleDiscussionTimer() {
  const intervalMs = 60000;  // Every 60 seconds

  const interval = setInterval(() => {
    enforceDiscussionTimeouts().catch(err => {
      console.error('[DiscussionTimer] Interval job failed:', err);
    });
  }, intervalMs);

  // Allow graceful shutdown
  if (global.gc) {
    // If process has reference to interval, it will be cleaned up on shutdown
  }

  return interval;
}

/**
 * Strategic Escape Game - Discussion Timer Job
 * 
 * Runs every 30 seconds to check for discussions that have expired.
 * When a discussion expires, automatically:
 * 1. Calculates debrief results using GamesService
 * 2. Transitions to debrief phase
 * 3. Emits real-time WebSocket notifications
 * 4. Closes the session
 * 
 * This enables hands-off game flow without manual admin intervention.
 */

import { query } from '../config/database';
import { emitGameUpdate } from '../socket/emitter';
import { GamesService } from '../services/games.service';

const gamesService = new GamesService();

/**
 * CRITICAL: Check all active discussions and auto-close expired ones.
 * Called every 30 seconds to find discussions that have timed out.
 * 
 * For each expired discussion:
 * 1. Calculate debrief results (rankings, action counts, etc.)
 * 2. Update session status to 'finished'
 * 3. Update snapshot with debrief phase
 * 4. Emit WebSocket event to all clients
 * 5. Record debrief_sent_at timestamp
 */
export async function enforceDiscussionTimeouts() {
  try {
    // Find sessions with expired discussion_ends_at timestamp
    // Only process sessions that are currently active (not already debriefed)
    const expiredSessions = await query<{
      id: string;
      event_id: string;
      discussion_ends_at: string;
      started_at: string;
    }>(
      `SELECT id, event_id, discussion_ends_at, started_at
       FROM game_sessions
       WHERE status = 'active'
         AND discussion_ends_at IS NOT NULL
         AND discussion_ends_at <= NOW()
         AND debrief_sent_at IS NULL
       ORDER BY discussion_ends_at ASC
       LIMIT 100`,  // Process max 100 per run to avoid timeout
      []
    );

    if (expiredSessions.length === 0) {
      return {
        processed: 0,
        debriefs_triggered: 0,
      };
    }


    let debriefs_triggered = 0;

    // Process each expired session
    for (const session of expiredSessions) {
      try {
        await transitionToDebriefAuto(session.id, session.event_id);
        debriefs_triggered++;
      } catch (error) {
        console.error(
          `[DiscussionTimer] Error transitioning session ${session.id}:`,
          error
        );
        // Continue to next session on error
      }
    }

    return {
      processed: expiredSessions.length,
      debriefs_triggered,
    };
  } catch (error) {
    console.error('[DiscussionTimer] Unexpected error in enforceDiscussionTimeouts:', error);
    return {
      processed: 0,
      debriefs_triggered: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * End any active sessions that reached their authoritative deadline.
 */
export async function enforceSessionDeadlines() {
  const expired = await query<{ id: string }>(
    `SELECT id
     FROM game_sessions
     WHERE status = 'active'
       AND session_deadline_at IS NOT NULL
       AND session_deadline_at <= NOW()
     ORDER BY session_deadline_at ASC
     LIMIT 100`,
    []
  );

  let ended = 0;
  for (const row of expired) {
    try {
      const result = await gamesService.finishSession(row.id);
      emitGameUpdate(row.id, 'game:ended', {
        sessionId: row.id,
        reason: 'session_deadline_reached',
        results: result.results,
        timestamp: new Date().toISOString(),
      });
      ended++;
    } catch (err) {
      // Session may already be finished by another worker/request.
      console.warn('[TimingJob] enforceSessionDeadlines failed', {
        sessionId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { processed: expired.length, ended };
}

/**
 * Auto-complete active Coffee Roulette chatting phase when chatEndsAt expires.
 */
export async function enforceCoffeeChatTimeouts() {
  const candidates = await query<{ session_id: string; state: any }>(
    `SELECT gs.id as session_id, latest.state
     FROM game_sessions gs
     JOIN game_types gt ON gt.id = gs.game_type_id
     JOIN LATERAL (
       SELECT gss.state
       FROM game_state_snapshots gss
       WHERE gss.game_session_id = gs.id
       ORDER BY gss.created_at DESC
       LIMIT 1
     ) latest ON TRUE
     WHERE gs.status = 'active'
       AND gt.key = 'coffee-roulette'
     LIMIT 100`,
    []
  );

  let completed = 0;
  for (const row of candidates) {
    const state = row.state as any;
    if (!state || state.kind !== 'coffee-roulette' || state.phase !== 'chatting' || !state.chatEndsAt) continue;
    const endsAt = new Date(state.chatEndsAt).getTime();
    if (!Number.isFinite(endsAt) || endsAt > Date.now()) continue;

    try {
      const next = { ...state, phase: 'complete', gameStatus: 'finished' };
      const snapshot = await gamesService.saveSnapshot(row.session_id, next);
      emitGameUpdate(row.session_id, 'game:data', {
        sessionId: row.session_id,
        gameData: next,
        snapshotRevisionId: snapshot?.id || null,
        snapshotCreatedAt: snapshot?.created_at || null,
      });
      completed++;
    } catch (err) {
      console.warn('[TimingJob] enforceCoffeeChatTimeouts failed', {
        sessionId: row.session_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { processed: candidates.length, completed };
}

/**
 * Two Truths no longer uses server timer-driven phase changes.
 *
 * All transitions go through socket `game:action` + `reduceTwoTruthsState`, which applies
 * `sanitizeTwoTruthsStateForPublic` on emits. submitEndsAt / voteEndsAt are client hints only.
 *
 * (Historically this job auto-advanced phases and could desync the state machine or leak
 * correctLieId via unsanitized `emitGameUpdate` payloads.)
 */
export async function enforceTwoTruthsPhaseTimeouts() {
  return { processed: 0, advanced: 0 };
}

/**
 * CRITICAL: Auto-transition session from discussion to debrief phase.
 * Uses GamesService to calculate results and manage state.
 * 
 * This is called automatically when discussion_ends_at timeout is reached.
 */
async function transitionToDebriefAuto(sessionId: string, eventId: string) {
  try {
    // Use GamesService to calculate debrief results and transition state
    const debriefResult = await gamesService.startDebrief(sessionId);

    if (!debriefResult) {
      throw new Error('Failed to start debrief');
    }

    // Update session status to 'finished' now that debrief is triggered
    await query(
      `UPDATE game_sessions 
       SET status = 'finished', 
           ended_at = NOW()
       WHERE id = $1`,
      [sessionId]
    );


    // Emit socket event to notify all participants in real-time
    // This tells all connected clients to update their UI to debrief phase
    emitGameUpdate(sessionId, 'game:discussion_ended_auto', {
      sessionId,
      phase: 'debrief',
      reason: 'discussion_timeout_reached',
      resultsCount: debriefResult.results?.rankings?.length || 0,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      `[DiscussionTimer] Error in transitionToDebriefAuto for session ${sessionId}:`,
      error
    );
    throw error;
  }
}

/**
 * Schedule the discussion timer to run every 30 seconds.
 * Call this once during app initialization in src/index.ts
 * 
 * Returns the interval ID so it can be cleared during graceful shutdown.
 */
export function scheduleDiscussionTimer(intervalMs = 30000) {

  const interval = setInterval(async () => {
    try {
      const result = await enforceDiscussionTimeouts();
      const sessionResult = await enforceSessionDeadlines();
      const coffeeResult = await enforceCoffeeChatTimeouts();
      const twoTruthsResult = await enforceTwoTruthsPhaseTimeouts();

      void result;
      void sessionResult;
      void coffeeResult;
      void twoTruthsResult;
    } catch (err) {
      console.error('[DiscussionTimer] Interval job failed:', err);
    }
  }, intervalMs);

  return interval;
}

/**
 * Stop the discussion timer job (for graceful shutdown)
 */
export function stopDiscussionTimer(intervalId: NodeJS.Timeout) {
  clearInterval(intervalId);
}

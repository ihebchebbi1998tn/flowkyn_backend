/**
 * @fileoverview Session Details Service
 *
 * Comprehensive service for retrieving, analyzing, and managing game session details
 * including participants, messages, actions, and session data export capabilities.
 */

import { query, queryOne } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export interface SessionParticipant {
  id: string;
  participant_id: string;
  display_name: string;
  avatar_url: string | null;
  participant_type: 'member' | 'guest';
  joined_at: string;
  left_at: string | null;
  is_active: boolean;
  interaction_count: number;
  message_count: number;
  action_count: number;
}

export interface SessionMessage {
  id: string;
  participant_id: string;
  participant_name: string;
  avatar_url: string | null;
  message: string;
  message_type: string;
  created_at: string;
  timestamp_minutes: number;
}

export interface SessionAction {
  id: string;
  participant_id: string;
  participant_name: string;
  round_number: number;
  action_type: string;
  payload: Record<string, unknown>;
  created_at: string;
  timestamp_minutes: number;
}

export interface SessionTimeline {
  timestamp: string;
  event_type: 'participant_joined' | 'participant_left' | 'round_started' | 'round_ended' | 'action';
  participant_name?: string;
  round_number?: number;
  action_type?: string;
}

export interface SessionDetails {
  id: string;
  event_id: string;
  event_title: string;
  game_type_id: string;
  game_name: string;
  game_key: string;
  status: 'active' | 'paused' | 'finished';
  current_round: number;
  total_rounds: number;
  game_duration_minutes: number;
  started_at: string;
  ended_at: string | null;
  session_deadline_at: string | null;
  total_participants: number;
  active_participants: number;
  completed_participants: number;
  total_messages: number;
  total_actions: number;
  total_rounds_completed: number;
  created_at: string;
  updated_at: string;
  participants: SessionParticipant[];
  messages: SessionMessage[];
  actions: SessionAction[];
  timeline: SessionTimeline[];
}

export interface ExportData {
  session: Omit<SessionDetails, 'participants' | 'messages' | 'actions' | 'timeline'>;
  participants: SessionParticipant[];
  messages: SessionMessage[];
  actions: SessionAction[];
  timeline: SessionTimeline[];
  exportedAt: string;
}

export class SessionDetailsService {
  /**
   * Get comprehensive details for a game session
   * Includes participants, messages, actions, and timeline
   */
  async getSessionDetails(sessionId: string): Promise<SessionDetails> {
    try {
      console.log(`[SessionDetailsService.getSessionDetails] Starting for session: ${sessionId}`);
      
      // Fetch main session details
      console.log('[SessionDetailsService] Fetching main session details...');
      const sessionRows = await query<any>(
        `
        SELECT
          gs.id,
          gs.event_id,
          e.title as event_title,
          gs.game_type_id,
          gt.name as game_name,
          gt.key as game_key,
          gs.status,
          gs.current_round,
          gs.total_rounds,
          gs.game_duration_minutes,
          gs.started_at,
          gs.ended_at,
          gs.session_deadline_at,
          e.created_at,
          e.updated_at,
          COUNT(DISTINCT CASE WHEN p.id IS NOT NULL THEN p.id END) as total_participants,
          COUNT(DISTINCT CASE WHEN p.id IS NOT NULL AND p.left_at IS NULL THEN p.id END) as active_participants,
          COUNT(DISTINCT CASE WHEN p.id IS NOT NULL AND p.left_at IS NOT NULL THEN p.id END) as completed_participants,
          COUNT(DISTINCT em.id) as total_messages,
          COUNT(DISTINCT ga.id) as total_actions,
          COUNT(DISTINCT CASE WHEN gr.status = 'finished' THEN gr.id END) as total_rounds_completed
        FROM game_sessions gs
        LEFT JOIN events e ON gs.event_id = e.id
        LEFT JOIN game_types gt ON gs.game_type_id = gt.id
        LEFT JOIN participants p ON gs.event_id = p.event_id
        LEFT JOIN event_messages em ON gs.event_id = em.event_id
        LEFT JOIN game_actions ga ON gs.id = ga.game_session_id
        LEFT JOIN game_rounds gr ON gs.id = gr.game_session_id
        WHERE gs.id = $1
        GROUP BY gs.id, gs.event_id, e.title, gs.game_type_id, gt.name, gt.key, gs.status, 
                 gs.current_round, gs.total_rounds, gs.game_duration_minutes, gs.started_at, 
                 gs.ended_at, gs.session_deadline_at, e.created_at, e.updated_at
        `,
        [sessionId]
      );

      if (sessionRows.length === 0) {
        throw new AppError('Session not found', 404, 'NOT_FOUND');
      }

      const sessionRow = sessionRows[0];
      console.log('[SessionDetailsService] Main session details fetched successfully');

      // Fetch participants with interaction counts
      // Note: event_profiles table may not exist yet, so we use COALESCE with fallbacks
      console.log('[SessionDetailsService] Fetching participants...');
      const participantsRows = await query<SessionParticipant>(
        `
        SELECT
          om.id,
          p.id as participant_id,
          COALESCE(u.name, p.guest_name) as display_name,
          COALESCE(u.avatar_url, p.guest_avatar) as avatar_url,
          p.participant_type,
          p.joined_at,
          p.left_at,
          CASE WHEN p.left_at IS NULL THEN true ELSE false END as is_active,
          COUNT(DISTINCT ga.id) as action_count,
          COUNT(DISTINCT em.id) as message_count,
          COUNT(DISTINCT CASE WHEN ga.id IS NOT NULL OR em.id IS NOT NULL THEN 1 END) as interaction_count
        FROM participants p
        LEFT JOIN organization_members om ON p.organization_member_id = om.id
        LEFT JOIN users u ON om.user_id = u.id
        LEFT JOIN game_actions ga ON p.id = ga.participant_id AND ga.game_session_id = $1
        LEFT JOIN event_messages em ON p.id = em.participant_id AND em.event_id = $2
        WHERE p.event_id = $2
        GROUP BY om.id, p.id, u.name, u.avatar_url, 
                 p.guest_name, p.guest_avatar, p.participant_type, p.joined_at, p.left_at
        ORDER BY p.joined_at ASC
        `,
        [sessionId, sessionRow.event_id]
      );
      console.log(`[SessionDetailsService] Participants fetched: ${participantsRows.length}`);

      // Fetch messages with participant info
      console.log('[SessionDetailsService] Fetching messages...');
      const messagesRows = await query<SessionMessage>(
        `
        SELECT
          em.id,
          em.participant_id,
          COALESCE(u.name, p.guest_name) as participant_name,
          COALESCE(u.avatar_url, p.guest_avatar) as avatar_url,
          em.message,
          em.message_type,
          em.created_at,
          EXTRACT(EPOCH FROM (em.created_at - $3::timestamp)) / 60 as timestamp_minutes
        FROM event_messages em
        JOIN participants p ON em.participant_id = p.id
        LEFT JOIN organization_members om ON p.organization_member_id = om.id
        LEFT JOIN users u ON om.user_id = u.id
        WHERE em.event_id = $1
        ORDER BY em.created_at ASC
        `,
        [sessionRow.event_id, sessionId, sessionRow.started_at]
      );
      console.log(`[SessionDetailsService] Messages fetched: ${messagesRows.length}`);

      // Fetch actions with participant info
      console.log('[SessionDetailsService] Fetching actions...');
      const actionsRows = await query<SessionAction>(
        `
        SELECT
          ga.id,
          ga.participant_id,
          COALESCE(u.name, p.guest_name) as participant_name,
          gr.round_number,
          ga.action_type,
          ga.payload,
          ga.created_at,
          EXTRACT(EPOCH FROM (ga.created_at - $2::timestamp)) / 60 as timestamp_minutes
        FROM game_actions ga
        JOIN participants p ON ga.participant_id = p.id
        JOIN game_rounds gr ON ga.round_id = gr.id
        LEFT JOIN organization_members om ON p.organization_member_id = om.id
        LEFT JOIN users u ON om.user_id = u.id
        WHERE ga.game_session_id = $1
        ORDER BY ga.created_at ASC
        `,
        [sessionId, sessionRow.started_at]
      );
      console.log(`[SessionDetailsService] Actions fetched: ${actionsRows.length}`);

      // Build timeline
      const timelineEvents: SessionTimeline[] = [];

      // Add participant joined/left events
      for (const p of participantsRows) {
        if (p.joined_at) {
          timelineEvents.push({
            timestamp: p.joined_at,
            event_type: 'participant_joined',
            participant_name: p.display_name,
          });
        }
        if (p.left_at) {
          timelineEvents.push({
            timestamp: p.left_at,
            event_type: 'participant_left',
            participant_name: p.display_name,
          });
        }
      }

      // Add round events
      const roundsRows = await query<any>(
        `
        SELECT id, round_number, started_at, ended_at
        FROM game_rounds
        WHERE game_session_id = $1
        ORDER BY round_number ASC
        `,
        [sessionId]
      );

      for (const round of roundsRows) {
        if (round.started_at) {
          timelineEvents.push({
            timestamp: round.started_at,
            event_type: 'round_started',
            round_number: round.round_number,
          });
        }
        if (round.ended_at) {
          timelineEvents.push({
            timestamp: round.ended_at,
            event_type: 'round_ended',
            round_number: round.round_number,
          });
        }
      }

      // Add action events
      for (const action of actionsRows) {
        timelineEvents.push({
          timestamp: action.created_at,
          event_type: 'action',
          participant_name: action.participant_name,
          action_type: action.action_type,
        });
      }

      // Sort timeline by timestamp
      timelineEvents.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      return {
        id: sessionRow.id,
        event_id: sessionRow.event_id,
        event_title: sessionRow.event_title,
        game_type_id: sessionRow.game_type_id,
        game_name: sessionRow.game_name,
        game_key: sessionRow.game_key,
        status: sessionRow.status,
        current_round: sessionRow.current_round,
        total_rounds: sessionRow.total_rounds,
        game_duration_minutes: sessionRow.game_duration_minutes,
        started_at: sessionRow.started_at,
        ended_at: sessionRow.ended_at,
        session_deadline_at: sessionRow.session_deadline_at,
        total_participants: parseInt(sessionRow.total_participants),
        active_participants: parseInt(sessionRow.active_participants),
        completed_participants: parseInt(sessionRow.completed_participants),
        total_messages: parseInt(sessionRow.total_messages),
        total_actions: parseInt(sessionRow.total_actions),
        total_rounds_completed: parseInt(sessionRow.total_rounds_completed),
        created_at: sessionRow.created_at,
        updated_at: sessionRow.updated_at,
        participants: participantsRows,
        messages: messagesRows,
        actions: actionsRows,
        timeline: timelineEvents,
      };
    } catch (error) {
      // Log detailed error for debugging
      console.error('[SessionDetailsService.getSessionDetails] Error:', {
        sessionId,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  /**
   * Get paginated messages for a session
   */
  async getSessionMessages(sessionId: string, limit: number = 50, offset: number = 0): Promise<{ messages: SessionMessage[]; total: number }> {
    const countRows = await query<any>(
      `
      SELECT COUNT(DISTINCT em.id) as total
      FROM event_messages em
      JOIN game_sessions gs ON em.event_id = gs.event_id
      WHERE gs.id = $1
      `,
      [sessionId]
    );

    const messagesRows = await query<SessionMessage>(
      `
      SELECT
        em.id,
        em.participant_id,
        COALESCE(ep.display_name, COALESCE(om.name, p.guest_name)) as participant_name,
        COALESCE(ep.avatar_url, om.avatar_url, p.guest_avatar) as avatar_url,
        em.message,
        em.message_type,
        em.created_at,
        EXTRACT(EPOCH FROM (em.created_at - gs.started_at)) / 60 as timestamp_minutes
      FROM event_messages em
      JOIN participants p ON em.participant_id = p.id
      LEFT JOIN organization_members om ON p.organization_member_id = om.id
      LEFT JOIN event_profiles ep ON em.event_id = ep.event_id AND em.participant_id = ep.participant_id
      LEFT JOIN game_sessions gs ON em.event_id = gs.event_id
      WHERE gs.id = $1
      ORDER BY em.created_at DESC
      LIMIT $2 OFFSET $3
      `,
      [sessionId, limit, offset]
    );

    return {
      messages: messagesRows.reverse(),
      total: parseInt(countRows[0].total),
    };
  }

  /**
   * Export complete session data
   */
  async exportSessionData(sessionId: string): Promise<ExportData> {
    const details = await this.getSessionDetails(sessionId);

    const sessionData = {
      id: details.id,
      event_id: details.event_id,
      event_title: details.event_title,
      game_type_id: details.game_type_id,
      game_name: details.game_name,
      game_key: details.game_key,
      status: details.status,
      current_round: details.current_round,
      total_rounds: details.total_rounds,
      game_duration_minutes: details.game_duration_minutes,
      started_at: details.started_at,
      ended_at: details.ended_at,
      session_deadline_at: details.session_deadline_at,
      total_participants: details.total_participants,
      active_participants: details.active_participants,
      completed_participants: details.completed_participants,
      total_messages: details.total_messages,
      total_actions: details.total_actions,
      total_rounds_completed: details.total_rounds_completed,
      created_at: details.created_at,
      updated_at: details.updated_at,
    };

    return {
      session: sessionData,
      participants: details.participants,
      messages: details.messages,
      actions: details.actions,
      timeline: details.timeline,
      exportedAt: new Date().toISOString(),
    };
  }

  /**
   * Close/finish a session
   */
  async closeSession(sessionId: string): Promise<void> {
    const result = await query<any>(
      `
      UPDATE game_sessions
      SET status = 'finished', ended_at = NOW()
      WHERE id = $1 AND status != 'finished'
      RETURNING id
      `,
      [sessionId]
    );

    if (result.length === 0) {
      throw new AppError('Session already finished or not found', 400, 'CONFLICT');
    }
  }

  /**
   * Delete a session (soft delete via status)
   */
  async deleteSession(sessionId: string): Promise<void> {
    // Instead of hard delete, we mark as archived by setting status to a special value
    // Or we can keep the logic as moving to archived state
    await query(
      `
      UPDATE game_sessions
      SET status = 'finished'
      WHERE id = $1
      `,
      [sessionId]
    );

    // Optionally anonymize participant data
    await query(
      `
      UPDATE event_messages
      SET message = '[deleted]'
      WHERE event_id IN (
        SELECT event_id FROM game_sessions WHERE id = $1
      )
      `,
      [sessionId]
    );
  }

  /**
   * Get active sessions for an event
   */
  async getActiveSessionsForEvent(eventId: string): Promise<Array<{
    id: string;
    game_name: string;
    game_key: string;
    status: string;
    current_round: number;
    total_rounds: number;
    participant_count: number;
    started_at: string;
  }>> {
    const result = await query<any>(
      `
      SELECT
        gs.id,
        gt.name as game_name,
        gt.key as game_key,
        gs.status,
        gs.current_round,
        gs.total_rounds,
        COUNT(DISTINCT p.id) as participant_count,
        gs.started_at
      FROM game_sessions gs
      LEFT JOIN game_types gt ON gs.game_type_id = gt.id
      LEFT JOIN participants p ON gs.event_id = p.event_id AND p.left_at IS NULL
      WHERE gs.event_id = $1 AND gs.status IN ('active', 'paused')
      GROUP BY gs.id, gt.name, gt.key, gs.status, gs.current_round, gs.total_rounds, gs.started_at
      ORDER BY gs.started_at DESC
      `,
      [eventId]
    );

    return result;
  }
}

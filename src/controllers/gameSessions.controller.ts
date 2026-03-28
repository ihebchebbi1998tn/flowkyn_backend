/**
 * @fileoverview Game Session Details Controller
 *
 * Handles HTTP requests for viewing and managing game session details,
 * including retrieval, export, and action operations.
 * All endpoints require authenticated users with admin/moderator roles.
 */

import { Response, NextFunction } from 'express';
import { SessionDetailsService, ExportData } from '../services/sessionDetails.service';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { assertCanViewSessionAdmin, assertCanControlGameSession, allowParticipantGameControlForEvent } from './helpers/gamesAccess';
import { queryOne } from '../config/database';

const sessionDetailsService = new SessionDetailsService();

/** Resolve the event_id for a given game session. */
async function getSessionEventId(sessionId: string): Promise<string> {
  const row = await queryOne<{ event_id: string }>(
    'SELECT event_id FROM game_sessions WHERE id = $1',
    [sessionId]
  );
  if (!row) throw new AppError('Session not found', 404, 'NOT_FOUND');
  return row.event_id;
}

export class GameSessionsController {
  /**
   * GET /game-sessions/:sessionId/details
   * Retrieve comprehensive details for a game session
   */
  async getSessionDetails(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { sessionId } = req.params;
      if (!sessionId) throw new AppError('Session ID is required', 400, 'VALIDATION_FAILED');
      if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');

      const eventId = await getSessionEventId(sessionId);
      await assertCanViewSessionAdmin(eventId, req.user.userId);

      const details = await sessionDetailsService.getSessionDetails(sessionId);
      res.json(details);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /game-sessions/:sessionId/messages
   * Get paginated messages for a session
   */
  async getSessionMessages(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { sessionId } = req.params;
      if (!sessionId) throw new AppError('Session ID is required', 400, 'VALIDATION_FAILED');
      if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');

      const eventId = await getSessionEventId(sessionId);
      await assertCanViewSessionAdmin(eventId, req.user.userId);

      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;
      const result = await sessionDetailsService.getSessionMessages(sessionId, limit, offset);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /game-sessions/:sessionId/export
   * Export session data as JSON or CSV
   */
  async exportSessionData(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { sessionId } = req.params;
      if (!sessionId) throw new AppError('Session ID is required', 400, 'VALIDATION_FAILED');
      if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');

      const eventId = await getSessionEventId(sessionId);
      await assertCanViewSessionAdmin(eventId, req.user.userId);

      const format = (req.query.format as string) || 'json';
      if (!['json', 'csv'].includes(format)) {
        throw new AppError('Invalid format. Use "json" or "csv"', 400, 'VALIDATION_FAILED');
      }

      const exportData = await sessionDetailsService.exportSessionData(sessionId);

      if (format === 'csv') {
        const csv = this.convertToCSV(exportData);
        const filename = `session-${sessionId}-${new Date().toISOString().split('T')[0]}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
      } else {
        const filename = `session-${sessionId}-${new Date().toISOString().split('T')[0]}.json`;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.json(exportData);
      }
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /game-sessions/:sessionId/close
   * Close/finish a session
   */
  async closeSession(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { sessionId } = req.params;
      if (!sessionId) throw new AppError('Session ID is required', 400, 'VALIDATION_FAILED');
      if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');

      const eventId = await getSessionEventId(sessionId);
      const allow = await allowParticipantGameControlForEvent(eventId);
      await assertCanControlGameSession(eventId, req.user.userId, allow);

      await sessionDetailsService.closeSession(sessionId);
      res.json({ success: true, message: 'Session closed successfully' });
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /game-sessions/:sessionId
   * Delete a session (soft delete)
   */
  async deleteSession(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { sessionId } = req.params;
      if (!sessionId) throw new AppError('Session ID is required', 400, 'VALIDATION_FAILED');
      if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');

      const eventId = await getSessionEventId(sessionId);
      await assertCanViewSessionAdmin(eventId, req.user.userId);

      await sessionDetailsService.deleteSession(sessionId);
      res.json({ success: true, message: 'Session deleted successfully' });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /events/:eventId/game-sessions/active
   * Get all active sessions for an event
   */
  async getActiveSessionsForEvent(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { eventId } = req.params;

      if (!eventId) {
        throw new AppError('Event ID is required', 400, 'VALIDATION_FAILED');
      }

      const activeSessions = await sessionDetailsService.getActiveSessionsForEvent(eventId);

      res.json(activeSessions);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Convert export data to CSV format
   */
  private convertToCSV(data: ExportData): string {
    const lines: string[] = [];

    // Session header
    lines.push('=== SESSION DETAILS ===');
    lines.push(`Session ID,${data.session.id}`);
    lines.push(`Event,${data.session.event_title}`);
    lines.push(`Game,${data.session.game_name}`);
    lines.push(`Status,${data.session.status}`);
    lines.push(`Duration,${data.session.game_duration_minutes} minutes`);
    lines.push(`Round,${data.session.current_round}/${data.session.total_rounds}`);
    lines.push(`Started,${data.session.started_at}`);
    lines.push(`Ended,${data.session.ended_at || 'Active'}`);
    lines.push(`Participants,${data.session.total_participants}`);
    lines.push(`Messages,${data.session.total_messages}`);
    lines.push(`Actions,${data.session.total_actions}`);
    lines.push(`Exported,${data.exportedAt}`);
    lines.push('');

    // Participants section
    lines.push('=== PARTICIPANTS ===');
    lines.push('Name,Type,Joined,Left,Status,Messages,Actions,Interactions');
    for (const p of data.participants) {
      const leftStatus = p.left_at ? `Left at ${p.left_at}` : 'Active';
      lines.push(
        `"${p.display_name}",${p.participant_type},${p.joined_at || 'N/A'},${p.left_at || 'N/A'},${leftStatus},${p.message_count},${p.action_count},${p.interaction_count}`
      );
    }
    lines.push('');

    // Messages section
    lines.push('=== MESSAGES ===');
    lines.push('Timestamp (min),Participant,Message,Type');
    for (const m of data.messages) {
      const message = m.message.replace(/"/g, '""');
      lines.push(
        `${m.timestamp_minutes},"${m.participant_name}","${message}",${m.message_type}`
      );
    }
    lines.push('');

    // Actions section
    lines.push('=== ACTIONS ===');
    lines.push('Timestamp (min),Round,Participant,Action,Payload');
    for (const a of data.actions) {
      const payload = JSON.stringify(a.payload).replace(/"/g, '""');
      lines.push(
        `${a.timestamp_minutes},${a.round_number},"${a.participant_name}",${a.action_type},"${payload}"`
      );
    }
    lines.push('');

    // Timeline section
    lines.push('=== TIMELINE ===');
    lines.push('Timestamp,Event Type,Details');
    for (const t of data.timeline) {
      const details = [
        t.participant_name ? `Participant: ${t.participant_name}` : '',
        t.round_number !== undefined ? `Round: ${t.round_number}` : '',
        t.action_type ? `Action: ${t.action_type}` : '',
      ]
        .filter(Boolean)
        .join(' | ');

      lines.push(`${t.timestamp},${t.event_type},"${details}"`);
    }

    return lines.join('\n');
  }
}

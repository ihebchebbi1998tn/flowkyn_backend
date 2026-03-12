/**
 * Game namespace handlers — sessions, rounds, actions with DB persistence.
 */
import { Namespace } from 'socket.io';
import { AuthenticatedSocket } from './types';
import { checkRateLimit } from './index';
import { GamesService } from '../services/games.service';
import { queryOne } from '../config/database';

const gamesService = new GamesService();

function validateFields(data: any, fields: string[]): boolean {
  if (!data || typeof data !== 'object') return false;
  return fields.every(f => typeof data[f] === 'string' && data[f].length > 0);
}

/** Verify the user is a participant in the game session's event and return their participant ID */
async function verifyGameParticipant(sessionId: string, userId: string, socket?: AuthenticatedSocket): Promise<{ participantId: string } | null> {
  // If this is a guest socket, use the guest payload directly
  if (socket?.isGuest && socket.guestPayload) {
    const guestRow = await queryOne<{ id: string }>(
      `SELECT p.id FROM participants p
       JOIN game_sessions gs ON gs.event_id = p.event_id
       WHERE gs.id = $1 AND p.id = $2 AND p.participant_type = 'guest' AND p.left_at IS NULL`,
      [sessionId, socket.guestPayload.participantId]
    );
    return guestRow ? { participantId: guestRow.id } : null;
  }

  // Authenticated user: match via organization_members
  const row = await queryOne<{ id: string }>(
    `SELECT p.id FROM participants p
     JOIN organization_members om ON om.id = p.organization_member_id
     JOIN game_sessions gs ON gs.event_id = p.event_id
     WHERE gs.id = $1 AND om.user_id = $2 AND p.left_at IS NULL`,
    [sessionId, userId]
  );
  return row ? { participantId: row.id } : null;
}

/** Check if user has admin/moderator role in the event's org */
async function isEventAdmin(sessionId: string, userId: string): Promise<boolean> {
  const row = await queryOne(
    `SELECT r.name FROM organization_members om
     JOIN roles r ON r.id = om.role_id
     JOIN events e ON e.organization_id = om.organization_id
     JOIN game_sessions gs ON gs.event_id = e.id
     WHERE gs.id = $1 AND om.user_id = $2 AND om.status = 'active'`,
    [sessionId, userId]
  );
  return row && ['owner', 'admin', 'moderator'].includes(row.name);
}

export function setupGameHandlers(gamesNs: Namespace) {
  gamesNs.on('connection', (rawSocket) => {
    const socket = rawSocket as unknown as AuthenticatedSocket;
    const user = socket.user;
    console.log(`[Games] User ${user.userId} connected`);

    const joinedSessions = new Set<string>();

    // ─── Join game session room ───
    socket.on('game:join', async (data: { sessionId: string }, ack) => {
      if (!validateFields(data, ['sessionId'])) {
        socket.emit('error', { message: 'Invalid session ID', code: 'VALIDATION' });
        return;
      }

      try {
        // BUG FIX: Verify user is a participant in the event before joining
        const participant = await verifyGameParticipant(data.sessionId, user.userId, socket);
        if (!participant) {
          socket.emit('error', { message: 'You are not a participant in this game', code: 'FORBIDDEN' });
          ack?.({ ok: false, error: 'Not a participant' });
          return;
        }

        const session = await gamesService.getSession(data.sessionId);
        const roomId = `game:${data.sessionId}`;
        socket.join(roomId);
        joinedSessions.add(data.sessionId);

        // Notify others
        socket.to(roomId).emit('game:player_joined', {
          userId: user.userId,
          participantId: participant.participantId,
          sessionId: data.sessionId,
          timestamp: new Date().toISOString(),
        });

        ack?.({ ok: true, data: { status: session.status, currentRound: session.current_round, participantId: participant.participantId } });
      } catch (err: any) {
        console.error(`[Games] game:join error:`, err.message);
        socket.emit('error', { message: err.message, code: 'JOIN_ERROR' });
        ack?.({ ok: false, error: err.message });
      }
    });

    // ─── Leave game session ───
    socket.on('game:leave', (data: { sessionId: string }) => {
      if (!validateFields(data, ['sessionId'])) return;
      const roomId = `game:${data.sessionId}`;
      socket.leave(roomId);
      joinedSessions.delete(data.sessionId);

      socket.to(roomId).emit('game:player_left', {
        userId: user.userId,
        sessionId: data.sessionId,
        timestamp: new Date().toISOString(),
      });
    });

    // ─── Start game (only admins/moderators) ───
    socket.on('game:start', async (data: { sessionId: string }) => {
      if (!validateFields(data, ['sessionId'])) return;

      try {
        // BUG FIX: Only org admins/moderators can start games
        const admin = await isEventAdmin(data.sessionId, user.userId);
        if (!admin) {
          socket.emit('error', { message: 'Only event administrators can start games', code: 'FORBIDDEN' });
          return;
        }

        const round = await gamesService.startRound(data.sessionId);

        gamesNs.to(`game:${data.sessionId}`).emit('game:started', {
          sessionId: data.sessionId,
          timestamp: new Date().toISOString(),
        });

        gamesNs.to(`game:${data.sessionId}`).emit('game:round_started', {
          sessionId: data.sessionId,
          roundId: round.id,
          roundNumber: round.round_number,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        console.error(`[Games] game:start error:`, err.message);
        socket.emit('error', { message: err.message, code: 'START_ERROR' });
      }
    });

    // ─── Start next round (only admins/moderators) ───
    socket.on('game:round_start', async (data: { sessionId: string; roundNumber: number }) => {
      if (!validateFields(data, ['sessionId'])) return;
      if (typeof data.roundNumber !== 'number' || data.roundNumber < 1) {
        socket.emit('error', { message: 'Invalid round number', code: 'VALIDATION' });
        return;
      }

      try {
        // BUG FIX: Only admins can start rounds
        const admin = await isEventAdmin(data.sessionId, user.userId);
        if (!admin) {
          socket.emit('error', { message: 'Only event administrators can start rounds', code: 'FORBIDDEN' });
          return;
        }

        const round = await gamesService.startRound(data.sessionId);

        gamesNs.to(`game:${data.sessionId}`).emit('game:round_started', {
          sessionId: data.sessionId,
          roundId: round.id,
          roundNumber: round.round_number,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        socket.emit('error', { message: err.message, code: 'ROUND_ERROR' });
      }
    });

    // ─── Player action (persisted to DB, broadcast) ───
    socket.on('game:action', async (data: { sessionId: string; roundId: string; actionType: string; payload: any }) => {
      if (!validateFields(data, ['sessionId', 'roundId', 'actionType'])) {
        socket.emit('error', { message: 'Invalid action data', code: 'VALIDATION' });
        return;
      }
      if (!checkRateLimit(socket, 'game:action')) return;

      try {
        // BUG FIX: Resolve participant ID from authenticated user instead of trusting client
        const participant = await verifyGameParticipant(data.sessionId, user.userId, socket);
        if (!participant) {
          socket.emit('error', { message: 'You are not a participant in this game', code: 'FORBIDDEN' });
          return;
        }

        // Limit payload size
        const payloadStr = JSON.stringify(data.payload || {});
        if (payloadStr.length > 10000) {
          socket.emit('error', { message: 'Payload too large', code: 'VALIDATION' });
          return;
        }

        // Persist action to DB using server-resolved participant ID
        const action = await gamesService.submitAction(
          data.sessionId, data.roundId, participant.participantId, data.actionType, data.payload || {}
        );

        // Broadcast to all players in session
        gamesNs.to(`game:${data.sessionId}`).emit('game:action', {
          userId: user.userId,
          participantId: participant.participantId,
          actionType: data.actionType,
          payload: data.payload,
          timestamp: action.created_at,
        });
      } catch (err: any) {
        console.error(`[Games] game:action error:`, err.message);
        socket.emit('error', { message: err.message, code: 'ACTION_ERROR' });
      }
    });

    // ─── End round (persisted to DB) ───
    socket.on('game:round_end', async (data: { sessionId: string; roundId: string }) => {
      if (!validateFields(data, ['sessionId', 'roundId'])) return;

      try {
        // BUG FIX: Only admins can end rounds, and persist to DB
        const admin = await isEventAdmin(data.sessionId, user.userId);
        if (!admin) {
          socket.emit('error', { message: 'Only event administrators can end rounds', code: 'FORBIDDEN' });
          return;
        }

        // BUG FIX: Actually persist round end to DB (was previously broadcast-only)
        await queryOne(
          `UPDATE game_rounds SET status = 'finished', ended_at = NOW()
           WHERE id = $1 AND game_session_id = $2 AND status = 'active' RETURNING id`,
          [data.roundId, data.sessionId]
        );

        gamesNs.to(`game:${data.sessionId}`).emit('game:round_ended', {
          sessionId: data.sessionId,
          roundId: data.roundId,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        socket.emit('error', { message: err.message, code: 'ROUND_END_ERROR' });
      }
    });

    // ─── End game (only admins, persisted — calculates results) ───
    socket.on('game:end', async (data: { sessionId: string }) => {
      if (!validateFields(data, ['sessionId'])) return;

      try {
        // BUG FIX: Only admins can end games
        const admin = await isEventAdmin(data.sessionId, user.userId);
        if (!admin) {
          socket.emit('error', { message: 'Only event administrators can end games', code: 'FORBIDDEN' });
          return;
        }

        const { results } = await gamesService.finishSession(data.sessionId);

        gamesNs.to(`game:${data.sessionId}`).emit('game:ended', {
          sessionId: data.sessionId,
          results,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        console.error(`[Games] game:end error:`, err.message);
        socket.emit('error', { message: err.message, code: 'END_ERROR' });
      }
    });

    // ─── Request current game state (snapshot) ───
    socket.on('game:state_sync', async (data: { sessionId: string }) => {
      if (!validateFields(data, ['sessionId'])) return;

      try {
        // Verify user is a participant before sharing state
        const participant = await verifyGameParticipant(data.sessionId, user.userId, socket);
        if (!participant) {
          socket.emit('error', { message: 'Not a participant', code: 'FORBIDDEN' });
          return;
        }

        const session = await gamesService.getSession(data.sessionId);
        socket.emit('game:state', {
          sessionId: data.sessionId,
          state: {
            status: session.status,
            currentRound: session.current_round,
            startedAt: session.started_at,
            endedAt: session.ended_at,
          },
        });
      } catch (err: any) {
        socket.emit('error', { message: err.message, code: 'STATE_ERROR' });
      }
    });

    // ─── Disconnect cleanup ───
    socket.on('disconnect', (reason) => {
      console.log(`[Games] User ${user.userId} disconnected: ${reason}`);

      for (const sessionId of joinedSessions) {
        socket.to(`game:${sessionId}`).emit('game:player_left', {
          userId: user.userId,
          sessionId,
          timestamp: new Date().toISOString(),
        });
      }
      joinedSessions.clear();
    });
  });
}

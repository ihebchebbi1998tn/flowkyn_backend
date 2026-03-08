/**
 * Game namespace handlers — sessions, rounds, actions with DB persistence.
 */
import { Namespace } from 'socket.io';
import { AuthenticatedSocket } from './types';
import { checkRateLimit } from './index';
import { GamesService } from '../services/games.service';

const gamesService = new GamesService();

function validateFields(data: any, fields: string[]): boolean {
  if (!data || typeof data !== 'object') return false;
  return fields.every(f => typeof data[f] === 'string' && data[f].length > 0);
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
        // Verify session exists
        const session = await gamesService.getSession(data.sessionId);
        const roomId = `game:${data.sessionId}`;
        socket.join(roomId);
        joinedSessions.add(data.sessionId);

        // Notify others
        socket.to(roomId).emit('game:player_joined', {
          userId: user.userId,
          sessionId: data.sessionId,
          timestamp: new Date().toISOString(),
        });

        ack?.({ ok: true, data: { status: session.status, currentRound: session.current_round } });
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

    // ─── Start game (triggers DB update via service, broadcasts) ───
    socket.on('game:start', async (data: { sessionId: string }) => {
      if (!validateFields(data, ['sessionId'])) return;

      try {
        // Start first round in DB
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

    // ─── Start next round (persisted) ───
    socket.on('game:round_start', async (data: { sessionId: string; roundNumber: number }) => {
      if (!validateFields(data, ['sessionId'])) return;
      if (typeof data.roundNumber !== 'number' || data.roundNumber < 1) {
        socket.emit('error', { message: 'Invalid round number', code: 'VALIDATION' });
        return;
      }

      try {
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
    socket.on('game:action', async (data: { sessionId: string; roundId: string; participantId: string; actionType: string; payload: any }) => {
      if (!validateFields(data, ['sessionId', 'roundId', 'participantId', 'actionType'])) {
        socket.emit('error', { message: 'Invalid action data', code: 'VALIDATION' });
        return;
      }
      if (!checkRateLimit(socket, 'game:action')) return;

      try {
        // Persist action to DB (service validates session/round are active)
        const action = await gamesService.submitAction(
          data.sessionId, data.roundId, data.participantId, data.actionType, data.payload || {}
        );

        // Broadcast to all players in session
        gamesNs.to(`game:${data.sessionId}`).emit('game:action', {
          userId: user.userId,
          participantId: data.participantId,
          actionType: data.actionType,
          payload: data.payload,
          timestamp: action.created_at,
        });
      } catch (err: any) {
        console.error(`[Games] game:action error:`, err.message);
        socket.emit('error', { message: err.message, code: 'ACTION_ERROR' });
      }
    });

    // ─── End round ───
    socket.on('game:round_end', (data: { sessionId: string; roundNumber: number }) => {
      if (!validateFields(data, ['sessionId'])) return;
      if (typeof data.roundNumber !== 'number' || data.roundNumber < 1) return;

      gamesNs.to(`game:${data.sessionId}`).emit('game:round_ended', {
        sessionId: data.sessionId,
        roundNumber: data.roundNumber,
        timestamp: new Date().toISOString(),
      });
    });

    // ─── End game (persisted — calculates results) ───
    socket.on('game:end', async (data: { sessionId: string }) => {
      if (!validateFields(data, ['sessionId'])) return;

      try {
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

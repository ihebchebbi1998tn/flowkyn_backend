import type { Namespace } from 'socket.io';
import type { AuthenticatedSocket } from '../types';
import type { VoiceCaches } from './handlerContext';

interface PendingSocketEvent {
  event: string;
  payload: unknown;
  createdAt: number;
}

export function emitToRoomAndActor(
  gamesNs: Namespace,
  actorSocket: AuthenticatedSocket,
  roomId: string,
  event: string,
  payload: unknown,
): void {
  const roomSockets = gamesNs.adapter?.rooms?.get(roomId);
  const roomSize = roomSockets?.size || 0;
  const actorInRoom = roomSockets?.has(actorSocket.id) || false;

  if (process.env.NODE_ENV !== 'production') {
    console.log('[ReliableEmit] emitToRoomAndActor', {
      roomId,
      event,
      roomSize,
      actorInRoom,
      actionType: (payload as any)?.actionType || 'N/A',
      phase: (payload as any)?.gameData?.phase || 'N/A',
    });
  }

  gamesNs.to(roomId).emit(event, payload);
  // Also emit directly to actor in case they haven't joined the room yet
  if (!actorInRoom) {
    actorSocket.emit(event, payload);
  }
}

export function emitToParticipantOrQueue(args: {
  gamesNs: Namespace;
  voiceCaches: VoiceCaches;
  sessionId: string;
  participantId: string;
  event: string;
  payload: unknown;
}): { delivered: boolean; socketId: string | null } {
  const { gamesNs, voiceCaches, sessionId, participantId, event, payload } = args;
  const socketKey = `${sessionId}:${participantId}`;
  const socketId = voiceCaches.voiceSocketByKey.get(socketKey) || null;

  if (socketId) {
    gamesNs.to(socketId).emit(event, payload);
    return { delivered: true, socketId };
  }

  const pendingKey = `${sessionId}:${participantId}`;
  const pending = voiceCaches.pendingVoiceSignals.get(pendingKey) ?? [];
  pending.push({ event, payload, createdAt: Date.now() });
  voiceCaches.pendingVoiceSignals.set(pendingKey, pending.slice(-25));

  return { delivered: false, socketId: null };
}

export function flushPendingSignalsForParticipant(args: {
  socket: AuthenticatedSocket;
  voiceCaches: VoiceCaches;
  sessionId: string;
  participantId: string;
}): number {
  const { socket, voiceCaches, sessionId, participantId } = args;
  const pendingKey = `${sessionId}:${participantId}`;
  const pending = voiceCaches.pendingVoiceSignals.get(pendingKey);

  if (!pending?.length) return 0;

  const cutoff = Date.now() - voiceCaches.COFFEE_VOICE_OFFER_TTL_MS;
  const fresh = pending.filter((entry: PendingSocketEvent) => entry.createdAt >= cutoff);

  for (const entry of fresh) {
    socket.emit(entry.event, entry.payload);
  }

  voiceCaches.pendingVoiceSignals.delete(pendingKey);
  return fresh.length;
}

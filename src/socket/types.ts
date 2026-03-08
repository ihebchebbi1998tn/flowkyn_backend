/**
 * Socket.io type definitions for all namespaces.
 */
import { Socket } from 'socket.io';
import { AuthPayload } from '../types';

// ─── Authenticated socket ───
export interface AuthenticatedSocket extends Socket {
  user: AuthPayload;
}

// ─── Events Namespace ───
export interface EventsClientToServer {
  'event:join': (data: { eventId: string }, ack?: (res: SocketAck) => void) => void;
  'event:leave': (data: { eventId: string }) => void;
  // SECURITY: participantId removed from client interface — server resolves from auth
  'chat:message': (data: { eventId: string; message: string }) => void;
  'chat:typing': (data: { eventId: string; isTyping: boolean }) => void;
  'event:presence': (data: { eventId: string }) => void;
}

export interface EventsServerToClient {
  'event:user_joined': (data: { userId: string; timestamp: string }) => void;
  'event:user_left': (data: { userId: string; timestamp: string }) => void;
  'chat:message': (data: { id: string; participantId: string; message: string; userId: string; timestamp: string }) => void;
  'chat:typing': (data: { userId: string; isTyping: boolean }) => void;
  'event:presence': (data: { eventId: string; onlineUserIds: string[] }) => void;
  'event:updated': (data: { eventId: string; changes: Record<string, any> }) => void;
  'event:notification': (data: { type: string; payload: any }) => void;
  'error': (data: { message: string; code?: string }) => void;
}

// ─── Games Namespace ───
export interface GamesClientToServer {
  'game:join': (data: { sessionId: string }, ack?: (res: SocketAck) => void) => void;
  'game:leave': (data: { sessionId: string }) => void;
  'game:start': (data: { sessionId: string }) => void;
  'game:round_start': (data: { sessionId: string; roundNumber: number }) => void;
  // SECURITY: participantId removed — server resolves from auth
  'game:action': (data: { sessionId: string; roundId: string; actionType: string; payload: any }) => void;
  'game:round_end': (data: { sessionId: string; roundId: string }) => void;
  'game:end': (data: { sessionId: string }) => void;
  'game:state_sync': (data: { sessionId: string }) => void;
}

export interface GamesServerToClient {
  'game:started': (data: { sessionId: string; timestamp: string }) => void;
  'game:round_started': (data: { sessionId: string; roundId: string; roundNumber: number; timestamp: string }) => void;
  'game:action': (data: { userId: string; participantId: string; actionType: string; payload: any; timestamp: string }) => void;
  'game:round_ended': (data: { sessionId: string; roundId: string; timestamp: string }) => void;
  'game:ended': (data: { sessionId: string; results: any; timestamp: string }) => void;
  'game:player_joined': (data: { userId: string; participantId: string; sessionId: string; timestamp: string }) => void;
  'game:player_left': (data: { userId: string; sessionId: string; timestamp: string }) => void;
  'game:state': (data: { sessionId: string; state: any }) => void;
  'error': (data: { message: string; code?: string }) => void;
}

// ─── Notifications Namespace ───
export interface NotificationsServerToClient {
  'notification:new': (data: { id: string; type: string; data: any; created_at: string }) => void;
  'notification:count': (data: { unread: number }) => void;
}

// ─── Common ───
export interface SocketAck {
  ok: boolean;
  error?: string;
  data?: any;
}

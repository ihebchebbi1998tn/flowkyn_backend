/**
 * Shared context and types used by all game sub-handlers.
 * Keeps the handler signatures consistent and avoids circular imports.
 */
import { Namespace } from 'socket.io';
import { AuthenticatedSocket } from '../types';
import { GamesService } from '../../services/games.service';

/** Per-socket state tracked across all handlers */
export interface PerSocketState {
  joinedSessions: Set<string>;
  joinedParticipantBySessionId: Map<string, string>;
}

/** Voice signaling caches shared across all connections */
export interface VoiceCaches {
  /** key: `${sessionId}:${participantId}` → socket.id */
  voiceSocketByKey: Map<string, string>;
  /** socket.id → Set<key> */
  voiceKeysBySocket: Map<string, Set<string>>;
  /** key: `${sessionId}:${pairId}` → cached SDP offer */
  coffeeVoiceOfferCache: Map<string, { sdp: string; fromParticipantId: string; createdAt: number }>;
  /** Pending modal-based call requests for reconnect delivery */
  pendingVoiceCallRequests: Map<string, {
    modal: VoiceCallReceiverModal;
    createdAt: number;
  }>;
  COFFEE_VOICE_OFFER_TTL_MS: number;
  COFFEE_VOICE_CALL_REQUEST_TTL_MS: number;
}

export interface VoiceCallReceiverModal {
  type: 'receiver';
  sessionId: string;
  pairId: string;
  initiatorParticipantId: string;
  initiatorName?: string;
  initiatorAvatar?: string;
  message: string;
  toParticipantId: string;
}

/** Per-session action serialization queues */
export interface ActionQueues {
  coffeeActionQueue: Map<string, Promise<void>>;
  twoTruthsActionQueue: Map<string, Promise<void>>;
  strategicActionQueue: Map<string, Promise<void>>;
}

/** All shared dependencies passed to sub-handlers */
export interface GameHandlerContext {
  gamesNs: Namespace;
  socket: AuthenticatedSocket;
  user: AuthenticatedSocket['user'];
  gamesService: GamesService;
  perSocket: PerSocketState;
  voiceCaches: VoiceCaches;
  actionQueues: ActionQueues;
}

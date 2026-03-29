import { queryOne } from '../../config/database';

/**
 * Enrich Coffee Roulette snapshot for late joiners (pair context + unpaired reason).
 */
export async function enrichCoffeeSnapshotForLateJoiner(
  snapshot: any,
  sessionId: string,
  participantId: string,
  _eventId: string
): Promise<any> {
  if (!snapshot || snapshot.kind !== 'coffee-roulette') {
    return snapshot;
  }

  const pair = (snapshot.pairs || []).find(
    (p: any) => p.person1.participantId === participantId || p.person2.participantId === participantId
  );

  let unpairedStatus: string | null = null;
  if (!pair && (snapshot.phase === 'chatting' || snapshot.phase === 'matching')) {
    try {
      const unpaired = await queryOne<{ reason: string; resolved_at: string | null }>(
        `SELECT reason, resolved_at FROM coffee_roulette_unpaired
         WHERE game_session_id = $1 AND participant_id = $2`,
        [sessionId, participantId]
      );

      if (unpaired && !unpaired.resolved_at) {
        unpairedStatus = unpaired.reason;
      }
    } catch (err) {
      console.warn('[CoffeeRoulette] Failed to check unpaired status for late joiner', {
        sessionId,
        participantId,
        error: err,
      });
    }
  }

  return {
    ...snapshot,
    _currentUserParticipantId: participantId,
    _currentUserPair: pair || null,
    _currentUserUnpairedReason: unpairedStatus,
    _currentUserPhase: snapshot.phase,
    _snapshotIsEnrichedForLateJoiner: true,
  };
}

import { queryOne } from '../../config/database';

const sessionGameKeyCache = new Map<string, string>();

export async function getSessionGameKey(sessionId: string): Promise<string | null> {
  const cached = sessionGameKeyCache.get(sessionId);
  if (cached) return cached;
  const row = await queryOne<{ key: string }>(
    `SELECT gt.key
     FROM game_sessions gs
     JOIN game_types gt ON gt.id = gs.game_type_id
     WHERE gs.id = $1`,
    [sessionId]
  );
  const key = row?.key || null;
  if (key) sessionGameKeyCache.set(sessionId, key);
  return key;
}

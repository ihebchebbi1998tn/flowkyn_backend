import crypto from 'crypto';
import { query, queryOne } from '../../config/database';
import { CoffeeRouletteConfigService } from '../../services/coffeeRouletteConfig.service';

const coffeeService = new CoffeeRouletteConfigService();

/** Default chat duration when no event setting overrides it. */
const DEFAULT_COFFEE_CHAT_DURATION_MINUTES = 30;
/** Max prompts before "continue or end?" decision. */
const DEFAULT_MAX_PROMPTS = 6;

export type CoffeeState = {
  kind: 'coffee-roulette';
  phase: 'waiting' | 'matching' | 'chatting' | 'complete';
  gameStatus?: 'waiting' | 'in_progress' | 'finished';
  configId?: string;
  pairs: Array<{
    id: string;
    person1: { participantId: string; name: string; avatar: string; avatarUrl?: string | null };
    person2: { participantId: string; name: string; avatar: string; avatarUrl?: string | null };
    topic: string;
    topicKey?: string;
    topicId?: string;
    sessionId?: string;
  }>;
  startedChatAt: string | null;
  chatEndsAt?: string;
  chatDurationMinutes?: number;
  promptsUsed: number;
  decisionRequired: boolean;
  usedQuestionIndices?: number[];
  unpairedParticipantIds?: string[];
};

async function getDynamicTopic(eventId: string): Promise<{ text: string; id?: string }> {
  try {
    const config = await queryOne('SELECT id FROM coffee_roulette_config WHERE event_id = $1', [eventId]);

    if (config) {
      const selectedTopic = await coffeeService.selectTopic((config as { id: string }).id);
      if (selectedTopic) {
        return {
          text: selectedTopic.title || 'gamePlay.coffeeRoulette.defaultTopic',
          id: selectedTopic.id,
        };
      }
    }
  } catch (error) {
    console.error('Error selecting dynamic topic:', error);
  }

  const FALLBACK_TOPIC_KEYS = [
    'gamePlay.coffeeRoulette.fallbackTopics.t1',
    'gamePlay.coffeeRoulette.fallbackTopics.t2',
    'gamePlay.coffeeRoulette.fallbackTopics.t3',
    'gamePlay.coffeeRoulette.fallbackTopics.t4',
    'gamePlay.coffeeRoulette.fallbackTopics.t5',
    'gamePlay.coffeeRoulette.fallbackTopics.t6',
    'gamePlay.coffeeRoulette.fallbackTopics.t7',
    'gamePlay.coffeeRoulette.fallbackTopics.t8',
    'gamePlay.coffeeRoulette.fallbackTopics.t9',
    'gamePlay.coffeeRoulette.fallbackTopics.t10',
    'gamePlay.coffeeRoulette.fallbackTopics.t11',
    'gamePlay.coffeeRoulette.fallbackTopics.t12',
    'gamePlay.coffeeRoulette.fallbackTopics.t13',
    'gamePlay.coffeeRoulette.fallbackTopics.t14',
    'gamePlay.coffeeRoulette.fallbackTopics.t15',
    'gamePlay.coffeeRoulette.fallbackTopics.t16',
    'gamePlay.coffeeRoulette.fallbackTopics.t17',
    'gamePlay.coffeeRoulette.fallbackTopics.t18',
    'gamePlay.coffeeRoulette.fallbackTopics.t19',
    'gamePlay.coffeeRoulette.fallbackTopics.t20',
    'gamePlay.coffeeRoulette.fallbackTopics.t21',
    'gamePlay.coffeeRoulette.fallbackTopics.t22',
    'gamePlay.coffeeRoulette.fallbackTopics.t23',
    'gamePlay.coffeeRoulette.fallbackTopics.t24',
    'gamePlay.coffeeRoulette.fallbackTopics.t25',
  ];

  const randomKey = FALLBACK_TOPIC_KEYS[Math.floor(Math.random() * FALLBACK_TOPIC_KEYS.length)];
  return { text: randomKey, id: undefined };
}

export async function reduceCoffeeState(args: {
  eventId: string;
  actionType: string;
  payload: any;
  prev: CoffeeState | null;
  session?: any;
}): Promise<CoffeeState> {
  const { eventId, actionType, payload, prev, session } = args;

  const base: CoffeeState = prev || {
    kind: 'coffee-roulette',
    phase: 'waiting',
    gameStatus: 'waiting',
    pairs: [],
    startedChatAt: null,
    chatDurationMinutes: Math.max(1, Number(session?.resolved_timing?.coffeeRoulette?.chatDurationMinutes || DEFAULT_COFFEE_CHAT_DURATION_MINUTES)),
    promptsUsed: 0,
    decisionRequired: false,
  };

  if (actionType === 'coffee:shuffle') {
    let configRow: { id: string } | null = null;
    try {
      configRow = await queryOne('SELECT id FROM coffee_roulette_config WHERE event_id = $1', [eventId]);
    } catch (err: any) {
      console.error('[CoffeeRoulette] Missing coffee_roulette_config table or failed query.', {
        eventId,
        error: err?.message || err,
      });
      configRow = null;
    }

    const participants = await query<{ id: string; name: string; avatar: string | null }>(
      `SELECT p.id,
              COALESCE(ep.display_name, u.name, p.guest_name, 'Unknown') AS name,
              COALESCE(ep.avatar_url, u.avatar_url, p.guest_avatar) AS avatar
       FROM participants p
       LEFT JOIN event_profiles ep ON ep.event_id = p.event_id AND ep.participant_id = p.id
       LEFT JOIN organization_members om ON om.id = p.organization_member_id
       LEFT JOIN users u ON u.id = om.user_id
       WHERE p.event_id = $1 AND p.left_at IS NULL
       ORDER BY p.created_at ASC`,
      [eventId]
    );

    const uniqueParticipants = participants;

    if (uniqueParticipants.length < 2) {
      return { ...base, phase: 'waiting', pairs: [], startedChatAt: null };
    }

    const shuffled = [...uniqueParticipants];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Get distinct topics for each pair
    const pairCount = Math.floor(shuffled.length / 2);
    const topics: Array<{ text: string; id?: string }> = [];
    const usedTopicIds = new Set<string>();
    for (let i = 0; i < pairCount; i++) {
      let topicData = await getDynamicTopic(eventId);
      // Try to avoid duplicate topics (best effort — fallback topics may repeat)
      let attempts = 0;
      while (topicData.id && usedTopicIds.has(topicData.id) && attempts < 3) {
        topicData = await getDynamicTopic(eventId);
        attempts++;
      }
      if (topicData.id) usedTopicIds.add(topicData.id);
      topics.push(topicData);
    }

    const pairs: CoffeeState['pairs'] = [];
    const unpairedParticipants: string[] = [];

    for (let i = 0; i < shuffled.length; i += 2) {
      if (i + 1 >= shuffled.length) {
        unpairedParticipants.push(shuffled[i].id);
        break;
      }
      const p1 = shuffled[i];
      const p2 = shuffled[i + 1];
      const pairId = crypto.randomUUID();

      const topicData = topics[Math.floor(i / 2)] || topics[0];
      const topicKey = topicData.text.startsWith('gamePlay.coffeeRoulette.') ? topicData.text : undefined;

      pairs.push({
        id: pairId,
        person1: {
          participantId: p1.id,
          name: p1.name,
          avatar: (p1.name || '??').slice(0, 2).toUpperCase(),
          avatarUrl: p1.avatar || null,
        },
        person2: {
          participantId: p2.id,
          name: p2.name,
          avatar: (p2.name || '??').slice(0, 2).toUpperCase(),
          avatarUrl: p2.avatar || null,
        },
        topic: topicData.text,
        topicKey,
        topicId: topicData.id,
      });
    }

    if (unpairedParticipants.length > 0 && session?.id) {
      try {
        for (const participantId of unpairedParticipants) {
          await query(
            `INSERT INTO coffee_roulette_unpaired (game_session_id, participant_id, reason)
             VALUES ($1, $2, 'odd_count')
             ON CONFLICT (game_session_id, participant_id) DO UPDATE
             SET resolved_at = NULL`,
            [session.id, participantId]
          );
        }
      } catch (err) {
        console.warn('[CoffeeRoulette] Failed to record unpaired participants', { eventId, error: err });
      }
    } else if (unpairedParticipants.length > 0 && !session?.id) {
      console.warn('[CoffeeRoulette] Skipping unpaired DB insert — no session.id available', {
        eventId,
        unpairedCount: unpairedParticipants.length,
      });
    }

    return {
      ...base,
      configId: configRow?.id,
      phase: 'matching',
      gameStatus: 'in_progress',
      pairs,
      startedChatAt: null,
      chatDurationMinutes: Math.max(
        1,
        Number(session?.resolved_timing?.coffeeRoulette?.chatDurationMinutes || base.chatDurationMinutes || DEFAULT_COFFEE_CHAT_DURATION_MINUTES)
      ),
      promptsUsed: 0,
      decisionRequired: false,
      unpairedParticipantIds: unpairedParticipants.length > 0 ? unpairedParticipants : undefined,
    };
  }

  if (actionType === 'coffee:start_chat') {
    if (base.startedChatAt) return base;
    if (!Array.isArray(base.pairs) || base.pairs.length === 0) {
      console.warn('[CoffeeRoulette] Ignoring coffee:start_chat without pairs', {
        eventId,
        phase: base.phase,
      });
      return { ...base, phase: 'waiting', startedChatAt: null };
    }
    const chatDurationMinutes = Math.max(1, Number(session?.resolved_timing?.coffeeRoulette?.chatDurationMinutes ?? DEFAULT_COFFEE_CHAT_DURATION_MINUTES));
    return {
      ...base,
      phase: 'chatting',
      gameStatus: 'in_progress',
      startedChatAt: new Date().toISOString(),
      chatDurationMinutes,
      chatEndsAt: new Date(Date.now() + chatDurationMinutes * 60000).toISOString(),
      promptsUsed: Math.max(1, base.promptsUsed ?? 0),
      decisionRequired: false,
    };
  }

  if (actionType === 'coffee:next_prompt') {
    if (base.phase !== 'chatting') return base;

    const expectedPromptsUsed = payload?.expectedPromptsUsed;
    if (typeof expectedPromptsUsed === 'number' && expectedPromptsUsed !== base.promptsUsed) {
      console.warn('[CoffeeRoulette] Ignoring stale coffee:next_prompt', {
        eventId,
        expectedPromptsUsed,
        serverPromptsUsed: base.promptsUsed,
        phase: base.phase,
      });
      return base;
    }

    const nextPromptsUsed = (base.promptsUsed || 0) + 1;
    const shouldAsk = nextPromptsUsed >= DEFAULT_MAX_PROMPTS;

    const nextTopicData = await getDynamicTopic(eventId);
    const nextTopicKey = nextTopicData.text.startsWith('gamePlay.coffeeRoulette.') ? nextTopicData.text : undefined;
    const updatedPairs = (base.pairs || []).map((pair) => ({
      ...pair,
      topic: nextTopicData.text,
      topicKey: nextTopicKey,
      topicId: nextTopicData.id,
    }));

    return {
      ...base,
      pairs: updatedPairs,
      promptsUsed: nextPromptsUsed,
      decisionRequired: shouldAsk,
    };
  }

  if (actionType === 'coffee:continue') {
    if (base.phase !== 'chatting') return base;

    const expectedPromptsUsed = payload?.expectedPromptsUsed;
    if (typeof expectedPromptsUsed === 'number' && expectedPromptsUsed !== base.promptsUsed) {
      console.warn('[CoffeeRoulette] Ignoring stale coffee:continue', {
        eventId,
        expectedPromptsUsed,
        serverPromptsUsed: base.promptsUsed,
        phase: base.phase,
      });
      return base;
    }

    return {
      ...base,
      promptsUsed: 0,
      decisionRequired: false,
    };
  }

  if (actionType === 'coffee:end' || actionType === 'coffee:end_and_finish') {
    return { ...base, phase: 'complete', gameStatus: 'finished' };
  }

  if (actionType === 'coffee:reset') {
    // Mark as finished so the session doesn't stay active in the DB
    return {
      kind: 'coffee-roulette',
      phase: 'waiting',
      gameStatus: 'finished',
      pairs: [],
      startedChatAt: null,
      promptsUsed: 0,
      decisionRequired: false,
    };
  }

  return base;
}

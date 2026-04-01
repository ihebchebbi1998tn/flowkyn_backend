export type StrategicState = {
  kind: 'strategic-escape';
  phase: 'setup' | 'roles_assignment' | 'discussion' | 'debrief';
  industryKey: string | null;
  crisisKey: string | null;
  difficultyKey: 'easy' | 'medium' | 'hard';
  industryLabel: string;
  crisisLabel: string;
  difficultyLabel: string;
  rolesAssigned: boolean;
  discussionDurationMinutes?: number;
  discussionEndsAt?: string;
  gameStatus?: 'waiting' | 'in_progress' | 'finished';
};

export async function reduceStrategicState(args: {
  eventId: string;
  actionType: string;
  payload: any;
  prev: StrategicState | null;
  session?: any;
}): Promise<StrategicState> {
  const { actionType, payload, prev, session } = args;
  console.log('[Strategic][Reducer] Processing', { actionType, prevPhase: prev?.phase || 'null', hasPrev: !!prev });
  const base: StrategicState = prev || {
    kind: 'strategic-escape',
    phase: 'setup',
    industryKey: payload?.industryKey || null,
    crisisKey: payload?.crisisKey || null,
    difficultyKey: payload?.difficultyKey || payload?.difficulty || 'medium',
    industryLabel: payload?.industryLabel || payload?.industry || 'General',
    crisisLabel: payload?.crisisLabel || payload?.crisisType || 'Scenario',
    difficultyLabel: payload?.difficultyLabel || payload?.difficulty || 'medium',
    rolesAssigned: false,
    discussionDurationMinutes: Math.max(
      1,
      Number(session?.resolved_timing?.strategicEscape?.discussionDurationMinutes ?? 45)
    ),
    gameStatus: 'waiting',
  };

  if (actionType === 'strategic:configure') {
    if (base.phase !== 'setup') return base;
    return {
      ...base,
      industryKey: payload?.industryKey ?? payload?.industry ?? base.industryKey,
      crisisKey: payload?.crisisKey ?? payload?.crisis ?? base.crisisKey,
      difficultyKey: payload?.difficultyKey || payload?.difficulty || base.difficultyKey,
      industryLabel: payload?.industryLabel || payload?.industry || base.industryLabel,
      crisisLabel: payload?.crisisLabel || payload?.crisis || payload?.crisisType || base.crisisLabel,
      difficultyLabel: payload?.difficultyLabel || payload?.difficulty || base.difficultyLabel,
      phase: 'setup',
      gameStatus: 'waiting',
    };
  }

  if (actionType === 'strategic:assign_roles') {
    console.log('[Strategic][Reducer] assign_roles check', {
      phase: base.phase,
      rolesAssigned: base.rolesAssigned,
      allowed: base.phase === 'setup' || (base.phase === 'roles_assignment' && !base.rolesAssigned),
    });
    if (base.phase !== 'setup' && base.phase !== 'roles_assignment') return base;
    if (base.rolesAssigned && base.phase === 'roles_assignment') return base;
    return {
      ...base,
      rolesAssigned: true,
      phase: 'roles_assignment',
      gameStatus: 'in_progress',
    };
  }

  if (actionType === 'strategic:start_discussion') {
    if (base.phase !== 'roles_assignment') {
      if (base.phase === 'discussion' && base.discussionEndsAt) return base;
      if (base.phase !== 'discussion') return base;
    }
    const rawMinutes =
      typeof payload?.durationMinutes === 'number'
        ? payload.durationMinutes
        : Number(session?.resolved_timing?.strategicEscape?.discussionDurationMinutes ?? 45);
    const minutes = Number.isFinite(rawMinutes) ? rawMinutes : (base.discussionDurationMinutes ?? 45);
    const safeDuration = Math.max(1, minutes);
    return {
      ...base,
      phase: 'discussion',
      discussionDurationMinutes: safeDuration,
      discussionEndsAt: new Date(Date.now() + safeDuration * 60000).toISOString(),
      gameStatus: 'in_progress',
    };
  }

  if (actionType === 'strategic:end_discussion') {
    console.log('[Strategic][Reducer] end_discussion check', { phase: base.phase });
    if (base.phase === 'debrief') return base;
    return {
      ...base,
      phase: 'debrief',
      gameStatus: 'finished',
    };
  }

  return base;
}

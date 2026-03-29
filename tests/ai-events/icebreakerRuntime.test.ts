import '../setup';

import { icebreakerRuntime } from '../../src/ai-events/runtime/activities/icebreaker.runtime';
import type { AiTemplateActivity } from '../../src/ai-events/types/template.types';

describe('AI Events - icebreaker runtime', () => {
  const activity: AiTemplateActivity = {
    id: 'a0',
    type: 'icebreaker',
    title: 'Prompt',
    timingSeconds: 60,
    config: { prompt: 'What did you learn?' },
  };

  it('sanitizes responses until reveal', () => {
    icebreakerRuntime.validateConfig(activity.config);
    const instanceId = 'inst-1';
    const state0 = icebreakerRuntime.initState(activity, {
      instanceId,
      eventId: null,
      actorParticipantId: null,
      nowIso: new Date().toISOString(),
    }) as any;

    const state1 = icebreakerRuntime.reduce(
      state0,
      'icebreaker:submit',
      { text: 'My answer' },
      { instanceId, eventId: null, actorParticipantId: 'p1', nowIso: new Date().toISOString() }
    ) as any;

    const publicBeforeReveal = icebreakerRuntime.sanitizePublic(state1);
    expect((publicBeforeReveal as any).phase).toBe('responses');
    expect((publicBeforeReveal as any).responses.p1).toBe('[hidden]');

    const state2 = icebreakerRuntime.reduce(
      state1,
      'icebreaker:reveal',
      {},
      { instanceId, eventId: null, actorParticipantId: 'p1', nowIso: new Date().toISOString() }
    ) as any;

    const publicAfterReveal = icebreakerRuntime.sanitizePublic(state2);
    expect((publicAfterReveal as any).phase).toBe('reveal');
    expect((publicAfterReveal as any).responses.p1).toBe('My answer');
  });

  it('projects private response for the viewer', () => {
    const instanceId = 'inst-2';
    const state0 = icebreakerRuntime.initState(activity, {
      instanceId,
      eventId: null,
      actorParticipantId: null,
      nowIso: new Date().toISOString(),
    }) as any;

    const state1 = icebreakerRuntime.reduce(
      state0,
      'icebreaker:submit',
      { text: 'Secret' },
      { instanceId, eventId: null, actorParticipantId: 'p1', nowIso: new Date().toISOString() }
    ) as any;

    const privateForP1 = icebreakerRuntime.projectPrivate!(state1, 'p1');
    expect(privateForP1).toEqual({ myResponse: 'Secret' });
    const privateForP2 = icebreakerRuntime.projectPrivate!(state1, 'p2');
    expect(privateForP2).toEqual({ myResponse: null });
  });
});


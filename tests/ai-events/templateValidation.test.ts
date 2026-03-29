import '../setup';

import { TemplateValidationService } from '../../src/ai-events/services/templateValidation.service';

describe('AI Events - TemplateValidationService', () => {
  it('accepts a valid icebreaker template', () => {
    const svc = new TemplateValidationService();
    const dsl = {
      dslVersion: 1,
      meta: {
        title: 'Team Icebreaker',
        objective: 'Help the team share context',
        durationMinutes: 10,
        language: 'en',
      },
      permissions: {
        canStart: 'all',
        canAdvance: 'all',
        canReveal: 'all',
      },
      safety: {
        maxParticipants: 50,
      },
      activities: [
        {
          id: 'a0',
          type: 'icebreaker',
          title: 'Prompt',
          timingSeconds: 60,
          config: { prompt: 'What is one lesson you learned this month?' },
        },
      ],
    };

    const out = svc.validateDsl(dsl);
    expect(out.valid).toBe(true);
    expect(out.dsl.activities[0].type).toBe('icebreaker');
  });

  it('rejects blocked terms using content safety policy', () => {
    const svc = new TemplateValidationService();
    const dsl = {
      dslVersion: 1,
      meta: {
        title: 'Unsafe Template',
        objective: 'Should fail',
        durationMinutes: 10,
      },
      permissions: {
        canStart: 'all',
        canAdvance: 'all',
        canReveal: 'all',
      },
      activities: [
        {
          id: 'a0',
          type: 'icebreaker',
          title: 'Prompt',
          timingSeconds: 60,
          config: { prompt: 'Discuss hate speech policies' },
        },
      ],
    };

    expect(() => svc.validateDsl(dsl)).toThrow();
  });
});


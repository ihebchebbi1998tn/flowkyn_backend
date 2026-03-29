import { NextFunction, Response } from 'express';
import { AuthRequest } from '../../types';
import { AppError } from '../../middleware/errorHandler';
import { query, queryOne } from '../../config/database';
import { InstanceOrchestratorService } from '../services/instanceOrchestrator.service';
import { resolveCallerParticipantId, verifyParticipantOwnership } from '../../controllers/helpers/gamesAccess';

const orchestrator = new InstanceOrchestratorService();

export class AiEventInstancesController {
  async start(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_MISSING_TOKEN');
      const { templateId, eventId, participantIds, runtimeConfig } = req.body;

      const callerParticipantId = await resolveCallerParticipantId(eventId, req);
      if (!callerParticipantId) throw new AppError('Not a participant', 403, 'FORBIDDEN');

      // Ensure caller is included in the participant list.
      if (!participantIds.includes(callerParticipantId)) {
        throw new AppError('participantIds must include the caller', 400, 'VALIDATION_FAILED');
      }

      // Validate that all participantIds belong to the event and are active.
      const participantRows = await query<{ id: string }>(
        `SELECT id
         FROM participants
         WHERE event_id = $1
           AND id = ANY($2)
           AND left_at IS NULL`,
        [eventId, participantIds]
      );
      if (participantRows.length !== participantIds.length) {
        throw new AppError('One or more participants are invalid for this event', 400, 'VALIDATION_FAILED');
      }
      const template = await queryOne<{ id: string; template_version: number }>(
        `SELECT id, template_version FROM ai_event_templates WHERE id = $1`,
        [templateId]
      );
      if (!template) throw new AppError('Template not found', 404, 'NOT_FOUND');
      const version = await queryOne<{ id: string }>(
        `SELECT id FROM ai_event_template_versions
         WHERE template_id = $1 AND version_number = $2`,
        [templateId, template.template_version]
      );
      if (!version) throw new AppError('Template version not found', 404, 'NOT_FOUND');
      const result = await orchestrator.startInstance({
        templateId,
        templateVersionId: version.id,
        eventId,
        participantIds,
        startedByParticipantId: callerParticipantId,
        runtimeConfig,
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  async action(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const instance = await queryOne<{ event_id: string | null }>(
        `SELECT event_id
         FROM ai_event_instances
         WHERE id = $1`,
        [req.params.id]
      );
      if (!instance) throw new AppError('Instance not found', 404, 'NOT_FOUND');

      let actorParticipantId: string | null = null;
      if (instance.event_id) {
        actorParticipantId = await resolveCallerParticipantId(instance.event_id, req);
      }

      // Fallback: if instance is not tied to an event, trust only a verified participantId from the request.
      if (!actorParticipantId && req.body.participantId) {
        verifyParticipantOwnership(req.body.participantId, req);
        actorParticipantId = req.body.participantId;
      }

      if (!actorParticipantId) throw new AppError('Not a participant', 403, 'FORBIDDEN');

      const result = await orchestrator.applyAction({
        instanceId: req.params.id,
        actionType: req.body.actionType,
        payload: req.body.payload || {},
        participantId: actorParticipantId,
      });

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  async getState(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const instance = await queryOne<{ event_id: string | null }>(
        `SELECT event_id
         FROM ai_event_instances
         WHERE id = $1`,
        [req.params.id]
      );
      if (!instance) throw new AppError('Instance not found', 404, 'NOT_FOUND');

      const actorParticipantId = instance.event_id
        ? await resolveCallerParticipantId(instance.event_id, req)
        : null;

      if (instance.event_id && !actorParticipantId) {
        throw new AppError('Not a participant', 403, 'FORBIDDEN');
      }

      const state = await orchestrator.getLatestState(req.params.id, actorParticipantId);
      res.json(state);
    } catch (err) {
      next(err);
    }
  }

  async end(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await orchestrator.endInstance(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
}

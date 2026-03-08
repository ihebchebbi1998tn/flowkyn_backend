import { Router } from 'express';
import { OrganizationsController } from '../controllers/organizations.controller';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createOrgSchema, inviteMemberSchema, acceptInvitationSchema } from '../validators/organizations.validator';

const router = Router();
const ctrl = new OrganizationsController();

router.post('/', authenticate, validate(createOrgSchema), ctrl.create);
router.get('/:orgId', authenticate, ctrl.getById);
router.get('/:orgId/members', authenticate, ctrl.listMembers);
router.post('/:orgId/invitations', authenticate, validate(inviteMemberSchema), ctrl.inviteMember);
router.post('/invitations/accept', authenticate, validate(acceptInvitationSchema), ctrl.acceptInvitation);

export { router as organizationsRoutes };

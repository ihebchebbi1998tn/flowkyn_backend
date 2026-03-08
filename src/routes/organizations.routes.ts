import { Router } from 'express';
import { OrganizationsController } from '../controllers/organizations.controller';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createOrgSchema, inviteMemberSchema, acceptInvitationSchema } from '../validators/organizations.validator';
import { upload } from '../config/multer';

const router = Router();
const ctrl = new OrganizationsController();

router.post('/', authenticate, validate(createOrgSchema), ctrl.create);
router.get('/:orgId', authenticate, ctrl.getById);
router.patch('/:orgId', authenticate, ctrl.update);
router.get('/:orgId/members', authenticate, ctrl.listMembers);
router.delete('/:orgId/members/:memberId', authenticate, ctrl.removeMember);
router.post('/:orgId/logo', authenticate, upload.single('logo'), ctrl.uploadLogo);
router.post('/:orgId/invitations', authenticate, validate(inviteMemberSchema), ctrl.inviteMember);
router.post('/invitations/accept', authenticate, validate(acceptInvitationSchema), ctrl.acceptInvitation);

export { router as organizationsRoutes };

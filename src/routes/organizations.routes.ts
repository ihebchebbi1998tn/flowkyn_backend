/**
 * @fileoverview Organizations Routes
 *
 * POST   /organizations                          — Create organization
 * GET    /organizations/current                  — Get current user's org
 * GET    /organizations/:orgId                   — Get org details
 * PATCH  /organizations/:orgId                   — Update org
 * GET    /organizations/:orgId/members           — List members
 * GET    /organizations/:orgId/invitations       — List invitations
 * GET    /organizations/:orgId/people            — List members and pending invitations
 * GET    /organizations/:orgId/departments       — List departments
 * POST   /organizations/:orgId/departments       — Create department
 * DELETE /organizations/:orgId/departments/:departmentId — Delete department
 * DELETE /organizations/:orgId/members/:memberId — Remove member
 * POST   /organizations/:orgId/logo              — Upload org logo
 * POST   /organizations/:orgId/invitations       — Send invitation
 * POST   /organizations/invitations/accept       — Accept invitation
 */

import { Router } from 'express';
import { OrganizationsController } from '../controllers/organizations.controller';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createOrgSchema, updateOrgSchema, inviteMemberSchema, acceptInvitationSchema, departmentCreateSchema, departmentUpdateSchema, departmentIdParam } from '../validators/organizations.validator';
import { orgIdParam, orgMemberParams } from '../validators/common.validator';
import { upload } from '../config/multer';

const router = Router();
const ctrl = new OrganizationsController();

router.post('/', authenticate, validate(createOrgSchema), ctrl.create);
router.get('/current', authenticate, ctrl.getCurrentForUser);
router.get('/:orgId', authenticate, validate(orgIdParam, 'params'), ctrl.getById);
router.patch('/:orgId', authenticate, validate(orgIdParam, 'params'), validate(updateOrgSchema), ctrl.update);
router.get('/:orgId/members', authenticate, validate(orgIdParam, 'params'), ctrl.listMembers);
router.get('/:orgId/invitations', authenticate, validate(orgIdParam, 'params'), ctrl.listInvitations);
router.get('/:orgId/people', authenticate, validate(orgIdParam, 'params'), ctrl.listPeople);
router.get('/:orgId/departments', authenticate, validate(orgIdParam, 'params'), ctrl.listDepartments);
router.post('/:orgId/departments', authenticate, validate(orgIdParam, 'params'), validate(departmentCreateSchema), ctrl.createDepartment);
router.patch('/:orgId/departments/:departmentId', authenticate, validate(orgIdParam, 'params'), validate(departmentIdParam, 'params'), validate(departmentUpdateSchema), ctrl.updateDepartment);
router.delete('/:orgId/departments/:departmentId', authenticate, validate(orgIdParam, 'params'), validate(departmentIdParam, 'params'), ctrl.deleteDepartment);
router.delete('/:orgId/members/:memberId', authenticate, validate(orgMemberParams, 'params'), ctrl.removeMember);
router.post('/:orgId/logo', authenticate, validate(orgIdParam, 'params'), upload.single('logo'), ctrl.uploadLogo);
router.post('/:orgId/invitations', authenticate, validate(orgIdParam, 'params'), validate(inviteMemberSchema), ctrl.inviteMember);
router.post('/invitations/accept', authenticate, validate(acceptInvitationSchema), ctrl.acceptInvitation);
router.post('/:orgId/pulse-survey', authenticate, validate(orgIdParam, 'params'), ctrl.savePulseSurvey);

export { router as organizationsRoutes };

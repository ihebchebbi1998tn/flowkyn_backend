/**
 * Events Controller — Facade
 *
 * Preserves the original EventsController class API by composing
 * from focused sub-controllers: CrudController, ParticipationController, MessagesController.
 */
import { EventsCrudController } from './crud.controller';
import { EventsParticipationController } from './participation.controller';
import { EventsMessagesController } from './messages.controller';

const crud = new EventsCrudController();
const participation = new EventsParticipationController();
const messages = new EventsMessagesController();

export class EventsController {
  // CRUD
  create = crud.create;
  list = crud.list;
  getById = crud.getById;
  update = crud.update;
  delete = crud.delete;
  getPublicInfo = crud.getPublicInfo;

  // Participation
  validateToken = participation.validateToken;
  joinAsGuest = participation.joinAsGuest;
  getParticipants = participation.getParticipants;
  getPinnedMessage = participation.getPinnedMessage;
  acceptInvitation = participation.acceptInvitation;
  invite = participation.invite;
  join = participation.join;
  pinMessage = participation.pinMessage;
  unpinMessage = participation.unpinMessage;
  leave = participation.leave;
  getMyParticipant = participation.getMyParticipant;
  getMyProfile = participation.getMyProfile;
  upsertMyProfile = participation.upsertMyProfile;

  // Messages & Posts
  sendMessage = messages.sendMessage;
  getMessages = messages.getMessages;
  getPosts = messages.getPosts;
  createPost = messages.createPost;
  reactToPost = messages.reactToPost;
}

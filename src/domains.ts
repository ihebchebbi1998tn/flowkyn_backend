/**
 * Backend Domain Module Index
 * 
 * Each domain groups its controller, service, routes, and validator.
 * This file serves as documentation and a central reference.
 * 
 * Structure:
 * ├── config/          — Database, env, CORS, multer, migrations
 * ├── controllers/     — Request handlers (thin layer, delegates to services)
 * ├── emails/          — Email templates & i18n
 * ├── middleware/       — Auth, validation, rate limiting, error handling
 * ├── routes/          — Express route definitions
 * ├── services/        — Business logic & database queries
 * ├── socket/          — WebSocket event/game/notification handlers
 * ├── types/           — Shared TypeScript types
 * ├── utils/           — Hash, JWT, pagination, slug, upload helpers
 * └── validators/      — Zod request schemas
 * 
 * Domain modules:
 * ┌──────────────┬──────────────────────┬──────────────────────┬──────────────────────┬──────────────────────┐
 * │ Domain       │ Controller           │ Service              │ Route                │ Validator            │
 * ├──────────────┼──────────────────────┼──────────────────────┼──────────────────────┼──────────────────────┤
 * │ Auth         │ auth.controller      │ auth.service         │ auth.routes          │ auth.validator       │
 * │ Users        │ users.controller     │ users.service        │ users.routes         │ users.validator      │
 * │ Organizations│ organizations.ctrl   │ organizations.svc    │ organizations.routes │ organizations.val    │
 * │ Events       │ events.controller    │ events.service       │ events.routes        │ events.validator     │
 * │ Games        │ games.controller     │ games.service        │ games.routes         │ games.validator      │
 * │ Leaderboards │ leaderboards.ctrl    │ leaderboards.svc     │ leaderboards.routes  │ —                    │
 * │ Notifications│ notifications.ctrl   │ notifications.svc    │ notifications.routes │ —                    │
 * │ Files        │ files.controller     │ files.service        │ files.routes         │ —                    │
 * │ Analytics    │ analytics.controller │ analytics.service    │ analytics.routes     │ —                    │
 * │ Audit Logs   │ auditLogs.controller │ auditLogs.service    │ auditLogs.routes     │ —                    │
 * └──────────────┴──────────────────────┴──────────────────────┴──────────────────────┴──────────────────────┘
 * 
 * Shared services:
 * - email.service    — Transactional email sending
 * - cleanup.service  — Scheduled data cleanup
 */

// Controllers
export { AuthController } from './controllers/auth.controller';
export { UsersController } from './controllers/users.controller';
export { OrganizationsController } from './controllers/organizations.controller';
export { EventsController } from './controllers/events.controller';
export { GamesController } from './controllers/games.controller';
export { LeaderboardsController } from './controllers/leaderboards.controller';
export { NotificationsController } from './controllers/notifications.controller';
export { FilesController } from './controllers/files.controller';
export { AnalyticsController } from './controllers/analytics.controller';
export { AuditLogsController } from './controllers/auditLogs.controller';

// Services
export { AuthService } from './services/auth.service';
export { UsersService } from './services/users.service';
export { OrganizationsService } from './services/organizations.service';
export { EventsService } from './services/events.service';
export { GamesService } from './services/games.service';
export { LeaderboardsService } from './services/leaderboards.service';
export { NotificationsService } from './services/notifications.service';
export { FilesService } from './services/files.service';
export { AnalyticsService } from './services/analytics.service';
export { AuditLogsService } from './services/auditLogs.service';

// Routes
export { routes } from './routes';

# Flowkyn Backend API

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy environment variables
cp .env.example .env
# Edit .env with your database URL, JWT secrets, SMTP credentials

# 3. Run database migrations
npm run db:migrate

# 4. Start dev server
npm run dev
```

## Project Structure

```
NodejsBackend/
├── database/
│   └── schema.sql              # Full PostgreSQL schema
├── src/
│   ├── index.ts                # Server entry point
│   ├── app.ts                  # Express app setup
│   ├── config/
│   │   ├── cors.ts             # CORS configuration
│   │   ├── database.ts         # PostgreSQL pool + query helpers
│   │   └── env.ts              # Environment variables
│   ├── middleware/
│   │   ├── auth.ts             # JWT authentication
│   │   ├── errorHandler.ts     # Global error handler
│   │   ├── rateLimiter.ts      # Rate limiting
│   │   └── validate.ts         # Zod validation middleware
│   ├── routes/                 # Express route definitions
│   ├── controllers/            # Request handlers
│   ├── services/               # Business logic layer
│   ├── validators/             # Zod schemas
│   ├── socket/                 # Socket.io handlers
│   ├── types/                  # TypeScript interfaces
│   └── utils/                  # JWT, hashing, pagination
├── .env.example
├── package.json
└── tsconfig.json
```

## Functional Overview

### Domains & Features

- **Auth**: Registration, login, email verification, password reset, JWT, sessions
- **Users**: Profile, avatar upload, onboarding, notification preferences, team invites
- **Organizations**: Creation, info, members, invitations, logo upload, onboarding
- **Events**: Creation, management, invitations, joining, leaving, messaging, posts
- **Games**: Game sessions, rounds, scoring, analytics
- **Leaderboards**: Rankings, scores, stats
- **Notifications**: Real-time and email notifications
- **Files**: Uploads, avatars, logos
- **Analytics**: Participation, engagement, activity stats
- **Audit Logs**: Change tracking, security logs

### Folder Mapping

| Domain         | Controller           | Service              | Route                | Validator            |
|---------------|----------------------|----------------------|----------------------|----------------------|
| Auth          | controllers/auth.controller.ts      | services/auth.service.ts         | routes/auth.routes.ts          | validators/auth.validator.ts       |
| Users         | controllers/users.controller.ts     | services/users.service.ts        | routes/users.routes.ts         | validators/users.validator.ts      |
| Organizations | controllers/organizations.controller.ts   | services/organizations.service.ts    | routes/organizations.routes.ts | validators/organizations.validator.ts    |
| Events        | controllers/events.controller.ts    | services/events.service.ts       | routes/events.routes.ts        | validators/events.validator.ts     |
| Games         | controllers/games.controller.ts     | services/games.service.ts        | routes/games.routes.ts         | validators/games.validator.ts      |
| Leaderboards  | controllers/leaderboards.controller.ts    | services/leaderboards.service.ts     | routes/leaderboards.routes.ts  | -                    |
| Notifications | controllers/notifications.controller.ts   | services/notifications.service.ts    | routes/notifications.routes.ts | -                    |
| Files         | controllers/files.controller.ts     | services/files.service.ts        | routes/files.routes.ts         | -                    |
| Analytics     | controllers/analytics.controller.ts | services/analytics.service.ts    | routes/analytics.routes.ts     | -                    |
| Audit Logs    | controllers/auditLogs.controller.ts | services/auditLogs.service.ts    | routes/auditLogs.routes.ts     | -                    |

### Shared Services

- **email.service.ts**: Transactional email sending
- **cleanup.service.ts**: Scheduled data cleanup

### Real-Time

- **socket/**: WebSocket event/game/notification handlers

### Monitoring

- **monitor/**: Dashboard, middleware, store

### Utilities

- **utils/**: Hash, JWT, pagination, slug, upload helpers

### Validation

- **validators/**: Zod request schemas

### Types

- **types/**: Shared TypeScript types

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/v1/auth/register` | Register new user |
| POST | `/v1/auth/verify-email` | Verify email token |
| POST | `/v1/auth/login` | Login |
| POST | `/v1/auth/refresh` | Refresh access token |
| POST | `/v1/auth/logout` | Logout |
| POST | `/v1/auth/forgot-password` | Request password reset |
| POST | `/v1/auth/reset-password` | Reset password |
| GET | `/v1/users/me` | Get profile |
| PATCH | `/v1/users/me` | Update profile |
| POST | `/v1/users/avatar` | Upload avatar |
| POST | `/v1/organizations` | Create organization |
| GET | `/v1/organizations/:orgId` | Get organization |
| GET | `/v1/organizations/:orgId/members` | List members |
| POST | `/v1/organizations/:orgId/invitations` | Invite member |
| POST | `/v1/organizations/invitations/accept` | Accept invite |
| POST | `/v1/events` | Create event |
| GET | `/v1/events/:eventId` | Get event |
| POST | `/v1/events/:eventId/invitations` | Invite participant |
| POST | `/v1/events/:eventId/join` | Join event |
| POST | `/v1/events/:eventId/leave` | Leave event |
| POST | `/v1/events/:eventId/messages` | Send message |
| GET | `/v1/events/:eventId/messages` | Get messages |
| POST | `/v1/events/:eventId/posts` | Create activity post |
| POST | `/v1/posts/:postId/reactions` | React to post |
| GET | `/v1/game-types` | List game types |
| POST | `/v1/events/:eventId/game-sessions` | Start game session |
| POST | `/v1/game-sessions/:id/rounds` | Start round |
| POST | `/v1/game-sessions/:id/finish` | Finish game |
| POST | `/v1/game-actions` | Submit game action |
| GET | `/v1/leaderboards/:id` | Get leaderboard |
| GET | `/v1/leaderboards/:id/entries` | Get rankings |
| POST | `/v1/files` | Upload file |
| GET | `/v1/notifications` | List notifications |
| PATCH | `/v1/notifications/:id` | Mark as read |
| POST | `/v1/analytics` | Track event |
| POST | `/v1/audit-logs` | Create audit log |
| GET | `/v1/audit-logs/organizations/:orgId` | List audit logs |

## WebSocket Namespaces

- `/events` — event:join, event:leave, chat:message
- `/games` — game:start, game:round_start, game:action, game:round_end, game:end

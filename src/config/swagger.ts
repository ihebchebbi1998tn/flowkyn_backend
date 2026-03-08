import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Flowkyn API',
      version: '1.2.0',
      description: `
# Flowkyn API Documentation

Flowkyn is a **team engagement and gamification platform** for modern distributed organizations. It enables companies to create interactive events, run real-time games, track engagement analytics, and manage team building activities — all from one platform.

---

## 🔑 Authentication

All authenticated endpoints require a **Bearer token** in the \`Authorization\` header:

\`\`\`
Authorization: Bearer <access_token>
\`\`\`

### Token Lifecycle
| Step | Action | Result |
|------|--------|--------|
| 1 | \`POST /auth/register\` | Account created → verification email sent |
| 2 | \`POST /auth/verify-email\` | Account activated (\`pending\` → \`active\`) |
| 3 | \`POST /auth/login\` | Returns \`access_token\` (15 min) + \`refresh_token\` (7 days) |
| 4 | Use \`access_token\` in headers | Authenticate API requests |
| 5 | \`POST /auth/refresh\` | Get new \`access_token\` when expired |
| 6 | \`POST /auth/logout\` | Invalidate current session |

### Session Management
- Maximum **10 concurrent sessions** per user (oldest evicted automatically)
- Refresh tokens use **rotation** — each refresh invalidates the previous token
- Sessions track IP address and user agent for security auditing

---

## 🚀 Onboarding Flow

New users go through a 4-step onboarding wizard after registration:

1. **Organization Name & Description** — Create the workspace
2. **Industry & Company Size** — Personalize the experience
3. **Goals** — Select objectives (team bonding, icebreakers, engagement, etc.)
4. **Language & Branding** — Set preferred language and upload logo

After completion, call \`POST /users/complete-onboarding\` to mark the flag.

---

## 🎮 Event & Game Flow

### Creating and Running Events
1. Create an organization → \`POST /organizations\`
2. Create an event → \`POST /events\`
3. Invite participants → \`POST /events/:id/invitations\`
4. Participants join → \`POST /events/:id/join\` (members) or \`POST /events/:id/join-guest\` (guests)
5. Start a game → \`POST /events/:id/game-sessions\`
6. Play rounds → \`POST /game-sessions/:id/rounds\`
7. Submit actions → \`POST /game-actions\`
8. Finish → \`POST /game-sessions/:id/finish\`

### Guest Access (No Auth Required)
Guests can join public events without an account:
- \`GET /events/:id/public\` — View event info on lobby screen
- \`GET /events/:id/validate-token\` — Check invitation token validity
- \`POST /events/:id/join-guest\` — Join with a display name and avatar
- \`GET /events/:id/participants\` — See who's in the event

---

## 🛡️ Rate Limiting

All endpoints are rate-limited per IP address:

| Endpoint Type | Window | Max Requests | HTTP Status |
|---|---|---|---|
| General API | 15 min | 200 | 429 |
| Auth (login/register) | 15 min | 10 | 429 |
| File uploads | 15 min | 20 | 429 |
| Contact form | 15 min | 5 | 429 |

Exceeding the limit returns a \`429 Too Many Requests\` response with a \`Retry-After\` header.

---

## 🔌 WebSocket Events (Socket.IO)

Real-time features use **Socket.IO** at the same server URL. Authenticate with the access token.

### Event Lifecycle
| Event | Direction | Description |
|-------|-----------|-------------|
| \`event:created\` | Server → Client | New event created in your org |
| \`event:updated\` | Server → Client | Event data changed |
| \`event:deleted\` | Server → Client | Event removed |

### Participant Flow
| Event | Direction | Description |
|-------|-----------|-------------|
| \`participant:joined\` | Server → Client | Someone joined the event |
| \`participant:left\` | Server → Client | Someone left the event |

### Game Play
| Event | Direction | Description |
|-------|-----------|-------------|
| \`game:session_created\` | Server → Client | New game started |
| \`game:round_started\` | Server → Client | Round began with prompt data |
| \`game:action\` | Bidirectional | Player submitted an action |
| \`game:ended\` | Server → Client | Game finished with results |

### Notifications
| Event | Direction | Description |
|-------|-----------|-------------|
| \`notification:new\` | Server → Client | New in-app notification |

---

## ❌ Error Handling

All errors return a consistent JSON format:

\`\`\`json
{
  "error": "Human-readable error message"
}
\`\`\`

**Validation errors** include field-level details:
\`\`\`json
{
  "error": "Validation failed",
  "details": [
    { "field": "email", "message": "Invalid email format" },
    { "field": "password", "message": "Must be at least 8 characters" }
  ]
}
\`\`\`

### Common HTTP Status Codes
| Code | Meaning | When |
|------|---------|------|
| 200 | OK | Successful read/update |
| 201 | Created | Resource created successfully |
| 204 | No Content | Successful deletion |
| 400 | Bad Request | Invalid input or business rule violation |
| 401 | Unauthorized | Missing or expired token |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Duplicate resource (e.g. email taken) |
| 422 | Unprocessable | Validation failed |
| 429 | Rate Limited | Too many requests |
| 500 | Server Error | Unexpected internal error |

---

## 📊 Pagination

All list endpoints support pagination with query parameters:

| Parameter | Type | Default | Max | Description |
|-----------|------|---------|-----|-------------|
| \`page\` | integer | 1 | — | Page number (1-indexed) |
| \`limit\` | integer | 20 | 100 | Items per page |

Response format:
\`\`\`json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
\`\`\`

---

## 🔐 Role-Based Access Control (RBAC)

Organizations use a hierarchical role system:

| Role | Permissions |
|------|-------------|
| **Owner** | Full access, can delete org, manage all members including admins |
| **Admin** | Manage events, members (except owner/admins), settings |
| **Moderator** | Create/manage events, moderate content |
| **Member** | Join events, participate in games |

---

## 🧹 Data Retention

| Data Type | Retention Period | Action |
|-----------|-----------------|--------|
| Analytics logs | 90 days | Auto-purged |
| Audit logs | 180 days | Auto-purged |
| User sessions | 7 days (refresh token expiry) | Auto-expired |
| Invitation tokens | 7 days | Auto-expired |
      `,
      contact: {
        name: 'Flowkyn Team',
        url: 'https://flowkyn.com',
        email: 'support@flowkyn.com',
      },
      license: {
        name: 'Proprietary',
        url: 'https://flowkyn.com/terms',
      },
    },
    externalDocs: {
      description: 'Flowkyn Platform Documentation',
      url: 'https://docs.flowkyn.com',
    },
    servers: [
      { url: 'https://api.flowkyn.com/v1', description: '🟢 Production' },
      { url: 'https://staging-api.flowkyn.com/v1', description: '🟡 Staging' },
      { url: 'http://localhost:3000/v1', description: '🔵 Local Development' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT access token obtained from `/auth/login`. Expires in 15 minutes.',
        },
      },
      schemas: {
        // ─── Common ───
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string', description: 'Human-readable error message', example: 'Not found' },
          },
          required: ['error'],
        },
        ValidationError: {
          type: 'object',
          properties: {
            error: { type: 'string', example: 'Validation failed' },
            details: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string', example: 'email' },
                  message: { type: 'string', example: 'Invalid email' },
                },
              },
            },
          },
        },
        Pagination: {
          type: 'object',
          description: 'Pagination metadata included in list responses',
          properties: {
            page: { type: 'integer', example: 1 },
            limit: { type: 'integer', example: 20 },
            total: { type: 'integer', example: 150 },
            totalPages: { type: 'integer', example: 8 },
          },
        },
        PaginatedResponse: {
          type: 'object',
          properties: {
            data: { type: 'array', items: {} },
            pagination: { $ref: '#/components/schemas/Pagination' },
          },
        },

        // ─── User ───
        User: {
          type: 'object',
          description: 'A Flowkyn user account',
          properties: {
            id: { type: 'string', format: 'uuid', example: '550e8400-e29b-41d4-a716-446655440000' },
            email: { type: 'string', format: 'email', example: 'john@example.com' },
            name: { type: 'string', example: 'John Doe', maxLength: 100 },
            avatar_url: { type: 'string', nullable: true, example: '/uploads/avatars/abc123.jpg' },
            language: { type: 'string', enum: ['en', 'fr', 'de'], example: 'en' },
            status: { type: 'string', enum: ['pending', 'active', 'suspended'], example: 'active' },
            onboarding_completed: { type: 'boolean', description: 'Whether the user has completed the onboarding wizard', example: false },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        UserPublic: {
          type: 'object',
          description: 'Public user fields (no email or sensitive data)',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string', example: 'John Doe' },
            avatar_url: { type: 'string', nullable: true },
            language: { type: 'string', enum: ['en', 'fr', 'de'] },
            status: { type: 'string' },
            onboarding_completed: { type: 'boolean' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },

        // ─── Auth ───
        RegisterRequest: {
          type: 'object',
          required: ['email', 'password', 'name'],
          properties: {
            email: { type: 'string', format: 'email', example: 'john@example.com', maxLength: 255 },
            password: {
              type: 'string',
              minLength: 8,
              maxLength: 128,
              example: 'MyStr0ngP@ss',
              description: 'Must contain at least: 1 lowercase, 1 uppercase, 1 number',
            },
            name: { type: 'string', example: 'John Doe', minLength: 1, maxLength: 100 },
            lang: { type: 'string', enum: ['en', 'fr', 'de'], default: 'en', description: 'Language for verification email' },
          },
        },
        LoginRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email', example: 'john@example.com' },
            password: { type: 'string', example: 'MyStr0ngP@ss' },
          },
        },
        LoginResponse: {
          type: 'object',
          properties: {
            access_token: { type: 'string', description: 'JWT access token (15 min expiry)', example: 'eyJhbGciOiJIUzI1NiIs...' },
            refresh_token: { type: 'string', description: 'Refresh token (7 day expiry)', example: 'dGhpcyBpcyBhIHJlZnJl...' },
          },
        },
        TokenResponse: {
          type: 'object',
          properties: {
            access_token: { type: 'string', description: 'New JWT access token' },
          },
        },

        // ─── Organization ───
        Organization: {
          type: 'object',
          description: 'An organization (team/company) on Flowkyn',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string', example: 'Acme Corp' },
            slug: { type: 'string', example: 'acme-corp', description: 'URL-safe slug auto-generated from name' },
            description: { type: 'string', example: 'A leading tech company', description: 'Organization description' },
            industry: { type: 'string', enum: ['technology', 'healthcare', 'education', 'finance', 'consulting', 'startup', 'nonprofit', 'other'], nullable: true, example: 'technology' },
            company_size: { type: 'string', enum: ['1-10', '11-50', '51-200', '201-500', '500+'], nullable: true, example: '11-50' },
            goals: { type: 'array', items: { type: 'string' }, description: 'Platform usage goals', example: ['team_bonding', 'engagement'] },
            logo_url: { type: 'string', nullable: true },
            owner_user_id: { type: 'string', format: 'uuid' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        CreateOrganizationRequest: {
          type: 'object',
          required: ['name'],
          description: 'Request body for creating an organization (used during onboarding)',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100, example: 'Acme Corp' },
            description: { type: 'string', maxLength: 500, example: 'A leading tech company' },
            industry: { type: 'string', enum: ['technology', 'healthcare', 'education', 'finance', 'consulting', 'startup', 'nonprofit', 'other'] },
            company_size: { type: 'string', enum: ['1-10', '11-50', '51-200', '201-500', '500+'] },
            goals: { type: 'array', items: { type: 'string' }, example: ['team_bonding', 'remote_culture'] },
          },
        },
        OrganizationMember: {
          type: 'object',
          description: 'A member of an organization with their role',
          properties: {
            id: { type: 'string', format: 'uuid', description: 'Member ID (not user ID)' },
            organization_id: { type: 'string', format: 'uuid' },
            user_id: { type: 'string', format: 'uuid' },
            role_id: { type: 'string', format: 'uuid' },
            role_name: { type: 'string', enum: ['owner', 'admin', 'moderator', 'member'], description: 'Role within the organization' },
            is_subscription_manager: { type: 'boolean' },
            status: { type: 'string', enum: ['active', 'inactive'] },
            joined_at: { type: 'string', format: 'date-time' },
          },
        },
        // ─── Participant ───
        Participant: {
          type: 'object',
          description: 'An event participant (member or guest)',
          properties: {
            id: { type: 'string', format: 'uuid' },
            event_id: { type: 'string', format: 'uuid' },
            organization_member_id: { type: 'string', format: 'uuid', nullable: true },
            guest_name: { type: 'string', nullable: true, example: 'Guest User' },
            guest_avatar: { type: 'string', nullable: true },
            participant_type: { type: 'string', enum: ['member', 'guest'] },
            joined_at: { type: 'string', format: 'date-time', nullable: true },
            left_at: { type: 'string', format: 'date-time', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        GuestJoinRequest: {
          type: 'object',
          required: ['guest_name'],
          description: 'Join an event as a guest (no authentication required)',
          properties: {
            guest_name: { type: 'string', minLength: 1, maxLength: 100, example: 'John Guest' },
            guest_avatar: { type: 'string', maxLength: 255, example: 'avatar-seed-123' },
          },
        },
        EventPublicInfo: {
          type: 'object',
          description: 'Public event info visible without authentication (for lobby screen)',
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string', example: 'Team Building Friday' },
            description: { type: 'string' },
            event_mode: { type: 'string', enum: ['sync', 'async'] },
            visibility: { type: 'string', enum: ['public', 'private'] },
            max_participants: { type: 'integer' },
            start_time: { type: 'string', format: 'date-time' },
            status: { type: 'string' },
            organization_name: { type: 'string', example: 'Acme Corp' },
            organization_logo: { type: 'string', nullable: true },
            participant_count: { type: 'integer', example: 12 },
            allow_guests: { type: 'boolean' },
          },
        },

        // ─── Event ───
        Event: {
          type: 'object',
          description: 'An event created within an organization',
          properties: {
            id: { type: 'string', format: 'uuid' },
            organization_id: { type: 'string', format: 'uuid' },
            created_by_member_id: { type: 'string', format: 'uuid' },
            title: { type: 'string', example: 'Team Building Friday' },
            description: { type: 'string', example: 'Weekly team bonding event' },
            event_mode: { type: 'string', enum: ['sync', 'async'], description: 'sync = real-time, async = play anytime' },
            visibility: { type: 'string', enum: ['public', 'private'] },
            max_participants: { type: 'integer', minimum: 2, maximum: 500 },
            start_time: { type: 'string', format: 'date-time' },
            end_time: { type: 'string', format: 'date-time' },
            expires_at: { type: 'string', format: 'date-time' },
            status: { type: 'string', enum: ['draft', 'active', 'completed', 'cancelled'] },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        CreateEventRequest: {
          type: 'object',
          required: ['organization_id', 'title'],
          properties: {
            organization_id: { type: 'string', format: 'uuid' },
            title: { type: 'string', minLength: 1, maxLength: 200, example: 'Team Building Friday' },
            description: { type: 'string', maxLength: 10000, example: 'Fun activities for the team' },
            event_mode: { type: 'string', enum: ['sync', 'async'], default: 'sync' },
            visibility: { type: 'string', enum: ['public', 'private'], default: 'public' },
            max_participants: { type: 'integer', minimum: 2, maximum: 500, example: 50 },
            start_time: { type: 'string', format: 'date-time' },
            end_time: { type: 'string', format: 'date-time' },
          },
        },
        UpdateEventRequest: {
          type: 'object',
          description: 'At least one field is required',
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200 },
            description: { type: 'string', maxLength: 10000 },
            event_mode: { type: 'string', enum: ['sync', 'async'] },
            visibility: { type: 'string', enum: ['public', 'private'] },
            max_participants: { type: 'integer', minimum: 2, maximum: 500 },
            start_time: { type: 'string', format: 'date-time' },
            end_time: { type: 'string', format: 'date-time' },
            status: { type: 'string', enum: ['draft', 'active', 'completed', 'cancelled'] },
          },
        },
        EventMessage: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            event_id: { type: 'string', format: 'uuid' },
            participant_id: { type: 'string', format: 'uuid' },
            message: { type: 'string' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        EventPost: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            event_id: { type: 'string', format: 'uuid' },
            participant_id: { type: 'string', format: 'uuid' },
            content: { type: 'string' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },

        // ─── Game ───
        GameType: {
          type: 'object',
          description: 'A type of game available on the platform',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string', example: 'Quiz' },
            description: { type: 'string' },
            min_players: { type: 'integer' },
            max_players: { type: 'integer' },
            default_duration_minutes: { type: 'integer' },
          },
        },
        GameSession: {
          type: 'object',
          description: 'An active or completed game session within an event',
          properties: {
            id: { type: 'string', format: 'uuid' },
            event_id: { type: 'string', format: 'uuid' },
            game_type_id: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['waiting', 'active', 'paused', 'completed'] },
            current_round: { type: 'integer' },
            game_duration_minutes: { type: 'integer' },
            expires_at: { type: 'string', format: 'date-time' },
            metadata: { type: 'object', description: 'Game-specific configuration' },
            started_at: { type: 'string', format: 'date-time' },
            ended_at: { type: 'string', format: 'date-time', nullable: true },
          },
        },
        GameRound: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            game_session_id: { type: 'string', format: 'uuid' },
            round_number: { type: 'integer' },
            round_duration_seconds: { type: 'integer' },
            status: { type: 'string', enum: ['active', 'completed'] },
            metadata: { type: 'object' },
            started_at: { type: 'string', format: 'date-time' },
            ended_at: { type: 'string', format: 'date-time', nullable: true },
          },
        },
        GameAction: {
          type: 'object',
          description: 'A player action submitted during a game round',
          properties: {
            id: { type: 'string', format: 'uuid' },
            game_session_id: { type: 'string', format: 'uuid' },
            round_id: { type: 'string', format: 'uuid' },
            participant_id: { type: 'string', format: 'uuid' },
            action_type: { type: 'string', example: 'answer', description: 'Alphanumeric with _ and -' },
            payload: { type: 'object', description: 'Action data (max 10KB JSON)' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        SubmitActionRequest: {
          type: 'object',
          required: ['game_session_id', 'round_id', 'participant_id', 'action_type', 'payload'],
          properties: {
            game_session_id: { type: 'string', format: 'uuid' },
            round_id: { type: 'string', format: 'uuid' },
            participant_id: { type: 'string', format: 'uuid', description: 'Must belong to the authenticated user' },
            action_type: { type: 'string', pattern: '^[a-zA-Z0-9_-]+$', maxLength: 50, example: 'answer' },
            payload: { type: 'object', description: 'Arbitrary game data (max 10KB)', example: { answer: 'B', time_ms: 3200 } },
          },
        },

        // ─── Leaderboard ───
        Leaderboard: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            game_session_id: { type: 'string', format: 'uuid' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        LeaderboardEntry: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            leaderboard_id: { type: 'string', format: 'uuid' },
            participant_id: { type: 'string', format: 'uuid' },
            score: { type: 'number' },
            rank: { type: 'integer' },
            metadata: { type: 'object' },
          },
        },

        // ─── Notification ───
        Notification: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            user_id: { type: 'string', format: 'uuid' },
            type: { type: 'string', example: 'event_invitation', description: 'Notification category' },
            data: { type: 'object', description: 'Notification payload' },
            read_at: { type: 'string', format: 'date-time', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
          },
        },

        // ─── File ───
        FileUpload: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            url: { type: 'string', example: '/uploads/files/abc123.pdf' },
            file_type: { type: 'string', example: 'application/pdf' },
            size: { type: 'integer', description: 'File size in bytes', example: 204800 },
          },
        },

        // ─── Contact ───
        ContactSubmission: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string', example: 'Jane Smith' },
            email: { type: 'string', format: 'email' },
            subject: { type: 'string', example: 'Partnership inquiry' },
            message: { type: 'string', example: 'I would like to discuss...' },
            status: { type: 'string', enum: ['new', 'read', 'replied', 'archived'] },
            ip_address: { type: 'string' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        ContactSubmitRequest: {
          type: 'object',
          required: ['name', 'email', 'message'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100, example: 'Jane Smith' },
            email: { type: 'string', format: 'email', maxLength: 255, example: 'jane@example.com' },
            subject: { type: 'string', maxLength: 200, example: 'Partnership inquiry' },
            message: { type: 'string', minLength: 1, maxLength: 2000, example: 'I would like to discuss a potential partnership.' },
          },
        },

        // ─── Audit Log ───
        AuditLog: {
          type: 'object',
          description: 'An immutable record of a significant action',
          properties: {
            id: { type: 'string', format: 'uuid' },
            organization_id: { type: 'string', format: 'uuid', nullable: true },
            user_id: { type: 'string', format: 'uuid' },
            action: {
              type: 'string',
              example: 'EVENT_CREATE',
              description: 'Action code (e.g. AUTH_LOGIN, ORG_CREATE, EVENT_DELETE, GAME_START_SESSION)',
            },
            metadata: { type: 'object', description: 'Additional context for the action' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },

        // ─── Admin Stats ───
        AdminStats: {
          type: 'object',
          properties: {
            total_users: { type: 'integer' },
            active_users: { type: 'integer' },
            total_organizations: { type: 'integer' },
            total_events: { type: 'integer' },
            total_game_sessions: { type: 'integer' },
            total_contact_submissions: { type: 'integer' },
          },
        },
      },
      parameters: {
        PageParam: {
          name: 'page',
          in: 'query',
          description: 'Page number (1-indexed)',
          schema: { type: 'integer', minimum: 1, default: 1 },
        },
        LimitParam: {
          name: 'limit',
          in: 'query',
          description: 'Items per page (max 100)',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
        SearchParam: {
          name: 'search',
          in: 'query',
          description: 'Search query string',
          schema: { type: 'string' },
        },
        UuidPathParam: {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Resource UUID',
          schema: { type: 'string', format: 'uuid' },
        },
      },
      responses: {
        Unauthorized: {
          description: 'Missing or invalid authentication token',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: 'Unauthorized' } } },
        },
        Forbidden: {
          description: 'Insufficient permissions for this action',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: 'Insufficient permissions' } } },
        },
        NotFound: {
          description: 'Resource not found',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: 'Not found' } } },
        },
        ValidationFailed: {
          description: 'Request validation failed',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } },
        },
        RateLimited: {
          description: 'Too many requests — rate limit exceeded',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: 'Too many requests, please try again later' } } },
        },
      },
    },
    tags: [
      { name: 'Auth', description: 'Authentication, registration, email verification, password reset, and session management.' },
      { name: 'Users', description: 'User profile management, avatar uploads, onboarding completion, and user directory.' },
      { name: 'Organizations', description: 'Create and manage organizations with industry/size/goals metadata, invite members, assign roles, and upload logos.' },
      { name: 'Events', description: 'Create, manage, and participate in events. Includes public lobby endpoints for guest access, invitation validation, real-time messaging and post/reaction features.' },
      { name: 'Games', description: 'Game types, game sessions, rounds, and player actions. Real-time via WebSocket.' },
      { name: 'Leaderboards', description: 'View leaderboards and ranked player entries for game sessions.' },
      { name: 'Notifications', description: 'In-app notifications with read/unread status. Real-time delivery via WebSocket.' },
      { name: 'Files', description: 'Upload and manage files. Supports images (JPEG, PNG, GIF, WebP) and documents (PDF).' },
      { name: 'Analytics', description: 'Track custom analytics events for usage metrics.' },
      { name: 'Audit Logs', description: 'Immutable records of significant actions within organizations. Read-only via API.' },
      { name: 'Contact', description: 'Public contact form submissions and admin management.' },
      { name: 'Admin', description: 'Super admin operations: user management, organization oversight, system statistics. Requires super-admin role.' },
    ],
    paths: {},
  },
  apis: [],
};

// ─────────────────────────────────────────────────
// PATHS — Full endpoint documentation
// ─────────────────────────────────────────────────

const paths: Record<string, any> = {

  // ═══════════════════════════════════════════════
  // AUTH
  // ═══════════════════════════════════════════════

  '/auth/register': {
    post: {
      tags: ['Auth'],
      summary: 'Register a new account',
      description: 'Creates a new user account and sends a verification email with an OTP code. The account remains in `pending` status until email verification is completed. Password must contain at least 1 lowercase letter, 1 uppercase letter, and 1 number.',
      operationId: 'register',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/RegisterRequest' },
            example: { email: 'john@example.com', password: 'MyStr0ngP@ss1', name: 'John Doe', lang: 'en' },
          },
        },
      },
      responses: {
        201: {
          description: 'Account created — verification email sent',
          content: {
            'application/json': {
              schema: { type: 'object', properties: { message: { type: 'string' } } },
              example: { message: 'Account created. Please check your email for verification.' },
            },
          },
        },
        409: {
          description: 'Email already in use',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: 'Email already registered' } } },
        },
        422: { $ref: '#/components/responses/ValidationFailed' },
        429: { $ref: '#/components/responses/RateLimited' },
      },
    },
  },

  '/auth/verify-email': {
    post: {
      tags: ['Auth'],
      summary: 'Verify email address',
      description: 'Activates the user account using the verification token received by email. After verification, the user can login.',
      operationId: 'verifyEmail',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['token'],
              properties: { token: { type: 'string', description: 'Verification token from email', example: 'abc123def456' } },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Email verified successfully — account is now active',
          content: { 'application/json': { example: { message: 'Email verified successfully' } } },
        },
        400: {
          description: 'Invalid or expired token',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: 'Invalid or expired verification token' } } },
        },
      },
    },
  },

  '/auth/login': {
    post: {
      tags: ['Auth'],
      summary: 'Login with credentials',
      description: 'Authenticates with email and password. Returns a short-lived access token (15 min) and a long-lived refresh token (7 days). A new user session is created tracking IP and user agent.',
      operationId: 'login',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/LoginRequest' },
            example: { email: 'john@example.com', password: 'MyStr0ngP@ss1' },
          },
        },
      },
      responses: {
        200: {
          description: 'Login successful',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LoginResponse' },
              example: { access_token: 'eyJhbGciOiJIUzI1NiIs...', refresh_token: 'dGhpcyBpcyBhIHJlZnJl...' },
            },
          },
        },
        401: {
          description: 'Invalid email or password, or account not verified',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: 'Invalid email or password' } } },
        },
        429: { $ref: '#/components/responses/RateLimited' },
      },
    },
  },

  '/auth/refresh': {
    post: {
      tags: ['Auth'],
      summary: 'Refresh access token',
      description: 'Exchanges a valid refresh token for a new access token. Use this when the access token expires (HTTP 401).',
      operationId: 'refreshToken',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { type: 'object', required: ['refresh_token'], properties: { refresh_token: { type: 'string' } } },
            example: { refresh_token: 'dGhpcyBpcyBhIHJlZnJl...' },
          },
        },
      },
      responses: {
        200: {
          description: 'New access token issued',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/TokenResponse' } } },
        },
        401: {
          description: 'Invalid or expired refresh token',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    },
  },

  '/auth/logout': {
    post: {
      tags: ['Auth'],
      summary: 'Logout current session',
      description: 'Invalidates the current session\'s refresh token. Other sessions remain active. Pass the refresh_token in the body to invalidate only that specific session.',
      operationId: 'logout',
      security: [{ bearerAuth: [] }],
      requestBody: {
        content: {
          'application/json': {
            schema: { type: 'object', properties: { refresh_token: { type: 'string', description: 'The refresh token to invalidate' } } },
          },
        },
      },
      responses: {
        200: { description: 'Logged out successfully', content: { 'application/json': { example: { message: 'Logged out' } } } },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },

  '/auth/me': {
    get: {
      tags: ['Auth'],
      summary: 'Get current user',
      description: 'Returns the full profile of the currently authenticated user including email, name, avatar, language, and account status.',
      operationId: 'getMe',
      security: [{ bearerAuth: [] }],
      responses: {
        200: {
          description: 'Current user profile',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },

  '/auth/forgot-password': {
    post: {
      tags: ['Auth'],
      summary: 'Request password reset',
      description: 'Sends a password reset email with a token if the email exists. Always returns 200 to prevent email enumeration.',
      operationId: 'forgotPassword',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email'],
              properties: {
                email: { type: 'string', format: 'email', example: 'john@example.com' },
                lang: { type: 'string', maxLength: 10, description: 'Language for the reset email', example: 'en' },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Reset email sent (if account exists)',
          content: { 'application/json': { example: { message: 'If an account exists, a reset email has been sent' } } },
        },
        429: { $ref: '#/components/responses/RateLimited' },
      },
    },
  },

  '/auth/reset-password': {
    post: {
      tags: ['Auth'],
      summary: 'Reset password with token',
      description: 'Sets a new password using the token received by email. The token expires after a limited time. Same password requirements as registration apply.',
      operationId: 'resetPassword',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['token', 'password'],
              properties: {
                token: { type: 'string', example: 'reset-token-abc123' },
                password: { type: 'string', minLength: 8, maxLength: 128, description: 'New password (same rules as registration)', example: 'NewStr0ngP@ss' },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Password reset successfully', content: { 'application/json': { example: { message: 'Password reset successfully' } } } },
        400: { description: 'Invalid or expired reset token', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    },
  },

  // ═══════════════════════════════════════════════
  // USERS
  // ═══════════════════════════════════════════════

  '/users/me': {
    get: {
      tags: ['Users'],
      summary: 'Get my profile',
      description: 'Returns the authenticated user\'s profile with all fields including email.',
      operationId: 'getMyProfile',
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: 'User profile', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
    patch: {
      tags: ['Users'],
      summary: 'Update my profile',
      description: 'Updates the authenticated user\'s profile. Only provided fields are updated. Creates an audit log entry.',
      operationId: 'updateMyProfile',
      security: [{ bearerAuth: [] }],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                name: { type: 'string', minLength: 1, maxLength: 100, example: 'John Smith' },
                language: { type: 'string', enum: ['en', 'fr', 'de'], example: 'fr' },
              },
            },
            example: { name: 'John Smith', language: 'fr' },
          },
        },
      },
      responses: {
        200: { description: 'Updated profile', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
        401: { $ref: '#/components/responses/Unauthorized' },
        422: { $ref: '#/components/responses/ValidationFailed' },
      },
    },
  },

  '/users/avatar': {
    post: {
      tags: ['Users'],
      summary: 'Upload avatar',
      description: 'Uploads a new avatar image for the authenticated user. Accepted formats: JPEG, PNG, GIF, WebP. Max file size defined by server config.',
      operationId: 'uploadAvatar',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['avatar'],
              properties: { avatar: { type: 'string', format: 'binary', description: 'Image file (JPEG, PNG, GIF, WebP)' } },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Avatar uploaded — returns new avatar URL',
          content: { 'application/json': { example: { avatar_url: '/uploads/avatars/550e8400-abc.jpg' } } },
        },
        400: {
          description: 'No file provided or invalid file type',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: 'Only image files are allowed' } } },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },

  '/users/complete-onboarding': {
    post: {
      tags: ['Users'],
      summary: 'Complete onboarding',
      description: 'Marks the authenticated user\'s `onboarding_completed` flag as `true`. Called after the onboarding wizard is finished. Creates an audit log entry. Idempotent — calling multiple times has no side effects.',
      operationId: 'completeOnboarding',
      security: [{ bearerAuth: [] }],
      responses: {
        200: {
          description: 'Onboarding marked as complete — returns updated user',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },

  '/users': {
    get: {
      tags: ['Users'],
      summary: 'List active users',
      description: 'Returns a paginated list of all active users. Only public fields are returned (no email for other users).',
      operationId: 'listUsers',
      security: [{ bearerAuth: [] }],
      parameters: [
        { $ref: '#/components/parameters/PageParam' },
        { $ref: '#/components/parameters/LimitParam' },
      ],
      responses: {
        200: {
          description: 'Paginated user list',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { type: 'array', items: { $ref: '#/components/schemas/UserPublic' } },
                  pagination: { $ref: '#/components/schemas/Pagination' },
                },
              },
            },
          },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },

  '/users/{id}': {
    get: {
      tags: ['Users'],
      summary: 'Get user by ID',
      description: 'Returns public profile information for a specific user.',
      operationId: 'getUserById',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, description: 'User UUID', schema: { type: 'string', format: 'uuid' } }],
      responses: {
        200: { description: 'User data', content: { 'application/json': { schema: { $ref: '#/components/schemas/UserPublic' } } } },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },

  // ═══════════════════════════════════════════════
  // ORGANIZATIONS
  // ═══════════════════════════════════════════════

  '/organizations': {
    post: {
      tags: ['Organizations'],
      summary: 'Create an organization',
      description: 'Creates a new organization with optional onboarding metadata (industry, size, goals). The authenticated user automatically becomes the **owner** with full permissions. A URL slug is auto-generated from the name. Typically called during the onboarding wizard.',
      operationId: 'createOrganization',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreateOrganizationRequest' },
            example: { name: 'Acme Corp', description: 'Leading tech company', industry: 'technology', company_size: '11-50', goals: ['team_bonding', 'engagement'] },
          },
        },
      },
      responses: {
        201: { description: 'Organization created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Organization' } } } },
        401: { $ref: '#/components/responses/Unauthorized' },
        422: { $ref: '#/components/responses/ValidationFailed' },
      },
    },
  },

  '/organizations/{orgId}': {
    get: {
      tags: ['Organizations'],
      summary: 'Get organization details',
      description: 'Returns organization details. **Requires membership** — only members of the organization can view it.',
      operationId: 'getOrganization',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        200: { description: 'Organization data', content: { 'application/json': { schema: { $ref: '#/components/schemas/Organization' } } } },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    },
    patch: {
      tags: ['Organizations'],
      summary: 'Update organization',
      description: 'Updates organization details. **Requires owner or admin role.**',
      operationId: 'updateOrganization',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        content: {
          'application/json': {
            schema: { type: 'object', properties: { name: { type: 'string', maxLength: 100 } } },
          },
        },
      },
      responses: {
        200: { description: 'Updated organization', content: { 'application/json': { schema: { $ref: '#/components/schemas/Organization' } } } },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { description: 'Not an admin/owner of this organization', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    },
  },

  '/organizations/{orgId}/members': {
    get: {
      tags: ['Organizations'],
      summary: 'List organization members',
      description: 'Returns all members with their roles. **Requires membership.**',
      operationId: 'listOrgMembers',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        200: {
          description: 'Members list with roles',
          content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/OrganizationMember' } } } },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    },
  },

  '/organizations/{orgId}/members/{memberId}': {
    delete: {
      tags: ['Organizations'],
      summary: 'Remove a member',
      description: 'Removes a member from the organization. **Security rules:**\n- Only **owner** or **admin** can remove members\n- The **owner** cannot be removed\n- Only the **owner** can remove other admins\n- Admins can only remove moderators and regular members',
      operationId: 'removeOrgMember',
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'memberId', in: 'path', required: true, description: 'Member ID (not user ID)', schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        204: { description: 'Member removed successfully' },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { description: 'Insufficient permissions or cannot remove owner', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },

  '/organizations/{orgId}/logo': {
    post: {
      tags: ['Organizations'],
      summary: 'Upload organization logo',
      description: 'Uploads a logo image for the organization. **Requires owner or admin role.** Accepted formats: JPEG, PNG, GIF, WebP.',
      operationId: 'uploadOrgLogo',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: { type: 'object', required: ['logo'], properties: { logo: { type: 'string', format: 'binary' } } },
          },
        },
      },
      responses: {
        200: { description: 'Logo uploaded', content: { 'application/json': { schema: { $ref: '#/components/schemas/Organization' } } } },
        400: { description: 'Invalid file type', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    },
  },

  '/organizations/{orgId}/invitations': {
    post: {
      tags: ['Organizations'],
      summary: 'Invite member to organization',
      description: 'Sends an invitation email to join the organization with a specific role. **Requires owner or admin role.** The invited user receives an email with an acceptance link/token.',
      operationId: 'inviteOrgMember',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email', 'role_id'],
              properties: {
                email: { type: 'string', format: 'email', example: 'newmember@example.com' },
                role_id: { type: 'string', format: 'uuid', description: 'Role to assign to the invited member' },
                lang: { type: 'string', maxLength: 10, description: 'Language for invitation email', example: 'en' },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Invitation sent', content: { 'application/json': { example: { message: 'Invitation sent' } } } },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        422: { $ref: '#/components/responses/ValidationFailed' },
      },
    },
  },

  '/organizations/invitations/accept': {
    post: {
      tags: ['Organizations'],
      summary: 'Accept organization invitation',
      description: 'Accepts a pending invitation using the token from the invitation email. The authenticated user is added to the organization with the role specified in the invitation.',
      operationId: 'acceptOrgInvitation',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { type: 'object', required: ['token'], properties: { token: { type: 'string', description: 'Invitation token from email' } } },
          },
        },
      },
      responses: {
        200: { description: 'Invitation accepted — user is now a member', content: { 'application/json': { example: { message: 'Invitation accepted' } } } },
        400: { description: 'Invalid or expired invitation token', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },

  // ═══════════════════════════════════════════════
  // EVENTS — Public (no auth)
  // ═══════════════════════════════════════════════

  '/events/{eventId}/public': {
    get: {
      tags: ['Events'],
      summary: 'Get public event info',
      description: 'Returns publicly visible event information for the lobby screen. **No authentication required.** Includes organization name/logo, participant count, and guest settings. Used by the join/lobby page before a user logs in or joins as guest.',
      operationId: 'getEventPublicInfo',
      parameters: [{ name: 'eventId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        200: { description: 'Public event info', content: { 'application/json': { schema: { $ref: '#/components/schemas/EventPublicInfo' } } } },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },

  '/events/{eventId}/validate-token': {
    get: {
      tags: ['Events'],
      summary: 'Validate invitation token',
      description: 'Validates an event invitation token without consuming it. Returns the invitation status (valid, expired, already accepted). **No authentication required.** Used by the lobby page to check if the user was invited.',
      operationId: 'validateEventToken',
      parameters: [
        { name: 'eventId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'token', in: 'query', required: true, description: 'Invitation token from email', schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Token validation result',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  valid: { type: 'boolean', example: true },
                  status: { type: 'string', enum: ['valid', 'expired', 'accepted', 'invalid'], example: 'valid' },
                  email: { type: 'string', description: 'Email the invitation was sent to (only if valid)' },
                },
              },
            },
          },
        },
        400: { description: 'Token query parameter missing', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    },
  },

  '/events/{eventId}/join-guest': {
    post: {
      tags: ['Events'],
      summary: 'Join event as guest',
      description: 'Allows an unauthenticated user to join an event as a guest. **No authentication required.** The event must have `allow_guests` enabled and not be at max capacity. Returns the created participant record. Emits `participant:joined` WebSocket event.',
      operationId: 'joinEventAsGuest',
      parameters: [{ name: 'eventId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/GuestJoinRequest' },
            example: { guest_name: 'John Guest', guest_avatar: 'avatar-seed-123' },
          },
        },
      },
      responses: {
        201: { description: 'Guest joined successfully', content: { 'application/json': { schema: { $ref: '#/components/schemas/Participant' } } } },
        400: { description: 'Guests not allowed or event is full', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        404: { $ref: '#/components/responses/NotFound' },
        422: { $ref: '#/components/responses/ValidationFailed' },
      },
    },
  },

  '/events/{eventId}/accept-invitation': {
    post: {
      tags: ['Events'],
      summary: 'Accept event invitation',
      description: 'Accepts an event invitation using the token from the invitation email. The authenticated user is added as a participant. The invitation is marked as accepted. Emits `participant:joined` WebSocket event.',
      operationId: 'acceptEventInvitation',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'eventId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['token'],
              properties: { token: { type: 'string', description: 'Invitation token from email', example: 'inv-token-abc123' } },
            },
          },
        },
      },
      responses: {
        200: { description: 'Invitation accepted — user joined as participant', content: { 'application/json': { schema: { $ref: '#/components/schemas/Participant' } } } },
        400: { description: 'Invalid or expired invitation token', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },

  '/events/{eventId}/participants': {
    get: {
      tags: ['Events'],
      summary: 'List event participants',
      description: 'Returns all active participants in an event including both members and guests. **No authentication required** (public data for lobby screen). Supports pagination. Guest participants include `guest_name` and `guest_avatar`; member participants include resolved user `name` and `avatar_url`.',
      operationId: 'listEventParticipants',
      parameters: [
        { name: 'eventId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        { $ref: '#/components/parameters/PageParam' },
        { $ref: '#/components/parameters/LimitParam' },
      ],
      responses: {
        200: {
          description: 'Paginated participant list',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { type: 'array', items: { $ref: '#/components/schemas/Participant' } },
                  pagination: { $ref: '#/components/schemas/Pagination' },
                },
              },
            },
          },
        },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },

  // ═══════════════════════════════════════════════
  // EVENTS — Authenticated
  // ═══════════════════════════════════════════════

  '/events': {
    get: {
      tags: ['Events'],
      summary: 'List events',
      description: 'Returns paginated events scoped to the user\'s organizations. Optionally filter by a specific organization.',
      operationId: 'listEvents',
      security: [{ bearerAuth: [] }],
      parameters: [
        { $ref: '#/components/parameters/PageParam' },
        { $ref: '#/components/parameters/LimitParam' },
        { name: 'organization_id', in: 'query', description: 'Filter by organization', schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        200: {
          description: 'Paginated event list',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { type: 'array', items: { $ref: '#/components/schemas/Event' } },
                  pagination: { $ref: '#/components/schemas/Pagination' },
                },
              },
            },
          },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    },
    post: {
      tags: ['Events'],
      summary: 'Create an event',
      description: 'Creates a new event in an organization. **Requires owner, admin, or moderator role** in the organization. Emits `event:created` WebSocket notification.',
      operationId: 'createEvent',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateEventRequest' } } },
      },
      responses: {
        201: { description: 'Event created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Event' } } } },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { description: 'Insufficient permissions to create events', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        422: { $ref: '#/components/responses/ValidationFailed' },
      },
    },
  },

  '/events/{eventId}': {
    get: {
      tags: ['Events'],
      summary: 'Get event details',
      description: 'Returns full event data. **Public events** are viewable by any authenticated user. **Private events** require organization membership.',
      operationId: 'getEvent',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'eventId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        200: { description: 'Event data', content: { 'application/json': { schema: { $ref: '#/components/schemas/Event' } } } },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
    put: {
      tags: ['Events'],
      summary: 'Update event',
      description: 'Updates event fields. **Requires owner/admin/moderator role**, or the event creator. Emits `event:updated` WebSocket event to all participants.',
      operationId: 'updateEvent',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'eventId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateEventRequest' } } },
      },
      responses: {
        200: { description: 'Updated event', content: { 'application/json': { schema: { $ref: '#/components/schemas/Event' } } } },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        422: { $ref: '#/components/responses/ValidationFailed' },
      },
    },
    delete: {
      tags: ['Events'],
      summary: 'Delete event',
      description: 'Permanently deletes an event and all associated data. **Requires owner or admin role.** Emits `event:deleted` WebSocket notification before deletion.',
      operationId: 'deleteEvent',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'eventId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        200: { description: 'Event deleted', content: { 'application/json': { example: { message: 'Event deleted' } } } },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { description: 'Only owner/admin can delete events', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },

  '/events/{eventId}/invitations': {
    post: {
      tags: ['Events'],
      summary: 'Invite participant to event',
      description: 'Sends an invitation email to participate in the event. **Requires owner/admin/moderator role** in the event\'s organization.',
      operationId: 'inviteToEvent',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'eventId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email'],
              properties: {
                email: { type: 'string', format: 'email', maxLength: 255, example: 'participant@example.com' },
                lang: { type: 'string', maxLength: 10, example: 'en' },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Invitation sent' },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    },
  },

  '/events/{eventId}/join': {
    post: {
      tags: ['Events'],
      summary: 'Join an event',
      description: 'Joins the event as a participant. The user must be a member of the event\'s organization. Emits `participant:joined` WebSocket event.',
      operationId: 'joinEvent',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'eventId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        200: {
          description: 'Joined successfully',
          content: { 'application/json': { example: { message: 'Joined event', participant_id: '550e8400-...' } } },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { description: 'Not a member of the organization', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    },
  },

  '/events/{eventId}/leave': {
    post: {
      tags: ['Events'],
      summary: 'Leave an event',
      description: 'Leaves the event. Sets `left_at` timestamp on the participant record. Emits `participant:left` WebSocket event.',
      operationId: 'leaveEvent',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'eventId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        200: { description: 'Left event successfully' },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    },
  },

  '/events/{eventId}/messages': {
    get: {
      tags: ['Events'],
      summary: 'Get event messages',
      description: 'Returns chat messages for an event. **Requires organization membership.**',
      operationId: 'getEventMessages',
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'eventId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        { $ref: '#/components/parameters/PageParam' },
        { $ref: '#/components/parameters/LimitParam' },
      ],
      responses: {
        200: {
          description: 'Messages list',
          content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/EventMessage' } }, pagination: { $ref: '#/components/schemas/Pagination' } } } } },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    },
    post: {
      tags: ['Events'],
      summary: 'Send message in event',
      description: 'Sends a chat message in the event. The `participant_id` must belong to the authenticated user (verified server-side).',
      operationId: 'sendEventMessage',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'eventId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['message', 'participant_id'],
              properties: {
                message: { type: 'string', minLength: 1, maxLength: 2000, example: 'Hello everyone!' },
                participant_id: { type: 'string', format: 'uuid', description: 'Your participant ID in this event' },
              },
            },
          },
        },
      },
      responses: {
        201: { description: 'Message sent', content: { 'application/json': { schema: { $ref: '#/components/schemas/EventMessage' } } } },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { description: 'You do not own this participant', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    },
  },

  '/events/{eventId}/posts': {
    post: {
      tags: ['Events'],
      summary: 'Create a post in event',
      description: 'Creates an activity post in the event. The `participant_id` must belong to the authenticated user. Emits `post:created` WebSocket event.',
      operationId: 'createEventPost',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'eventId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['content', 'participant_id'],
              properties: {
                content: { type: 'string', minLength: 1, maxLength: 5000, example: 'Great game everyone! 🎉' },
                participant_id: { type: 'string', format: 'uuid' },
              },
            },
          },
        },
      },
      responses: {
        201: { description: 'Post created', content: { 'application/json': { schema: { $ref: '#/components/schemas/EventPost' } } } },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    },
  },

  '/posts/{postId}/reactions': {
    post: {
      tags: ['Events'],
      summary: 'React to a post',
      description: 'Adds a reaction to an event post. `reaction_type` must be alphanumeric (e.g. `like`, `love`, `laugh`). The `participant_id` must belong to the authenticated user.',
      operationId: 'reactToPost',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'postId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['reaction_type', 'participant_id'],
              properties: {
                reaction_type: { type: 'string', pattern: '^[a-zA-Z0-9_-]+$', maxLength: 50, example: 'like' },
                participant_id: { type: 'string', format: 'uuid' },
              },
            },
          },
        },
      },
      responses: {
        201: { description: 'Reaction added' },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    },
  },

  // ═══════════════════════════════════════════════
  // GAMES
  // ═══════════════════════════════════════════════

  '/game-types': {
    get: {
      tags: ['Games'],
      summary: 'List available game types',
      description: 'Returns all game types available on the platform (e.g. Quiz, Drawing, Word Games). Each type includes player limits and default duration.',
      operationId: 'listGameTypes',
      security: [{ bearerAuth: [] }],
      responses: {
        200: {
          description: 'Game types list',
          content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/GameType' } } } },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },

  '/events/{eventId}/game-sessions': {
    post: {
      tags: ['Games'],
      summary: 'Start a game session',
      description: 'Starts a new game session for an event. Emits `game:session_created` WebSocket event to all event participants.',
      operationId: 'startGameSession',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'eventId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['game_type_id'],
              properties: { game_type_id: { type: 'string', format: 'uuid', description: 'ID of the game type to play' } },
            },
            example: { game_type_id: '550e8400-e29b-41d4-a716-446655440000' },
          },
        },
      },
      responses: {
        201: { description: 'Game session started', content: { 'application/json': { schema: { $ref: '#/components/schemas/GameSession' } } } },
        401: { $ref: '#/components/responses/Unauthorized' },
        422: { $ref: '#/components/responses/ValidationFailed' },
      },
    },
  },

  '/game-sessions/{id}/rounds': {
    post: {
      tags: ['Games'],
      summary: 'Start a new round',
      description: 'Starts the next round in a game session. Emits `game:round_started` WebSocket event with round details.',
      operationId: 'startGameRound',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, description: 'Game session ID', schema: { type: 'string', format: 'uuid' } }],
      responses: {
        201: { description: 'Round started', content: { 'application/json': { schema: { $ref: '#/components/schemas/GameRound' } } } },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },

  '/game-sessions/{id}/finish': {
    post: {
      tags: ['Games'],
      summary: 'Finish a game session',
      description: 'Ends the game session and calculates results. Emits `game:ended` WebSocket event with final results and leaderboard.',
      operationId: 'finishGameSession',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, description: 'Game session ID', schema: { type: 'string', format: 'uuid' } }],
      responses: {
        200: {
          description: 'Session finished with results',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                  results: { type: 'object', description: 'Game results and scores' },
                },
              },
            },
          },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },

  '/game-actions': {
    post: {
      tags: ['Games'],
      summary: 'Submit a game action',
      description: 'Submits a player action during an active game round (e.g. answering a question, drawing, making a move). The `participant_id` is verified to belong to the authenticated user. Payload is limited to 10KB. Emits `game:action` WebSocket event.',
      operationId: 'submitGameAction',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/SubmitActionRequest' },
            example: {
              game_session_id: '550e8400-...',
              round_id: '660e8400-...',
              participant_id: '770e8400-...',
              action_type: 'answer',
              payload: { answer: 'B', time_ms: 3200 },
            },
          },
        },
      },
      responses: {
        201: { description: 'Action submitted', content: { 'application/json': { schema: { $ref: '#/components/schemas/GameAction' } } } },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { description: 'You do not own this participant', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        422: { $ref: '#/components/responses/ValidationFailed' },
      },
    },
  },

  // ═══════════════════════════════════════════════
  // LEADERBOARDS
  // ═══════════════════════════════════════════════

  '/leaderboards/{id}': {
    get: {
      tags: ['Leaderboards'],
      summary: 'Get leaderboard',
      description: 'Returns leaderboard metadata for a game session.',
      operationId: 'getLeaderboard',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        200: { description: 'Leaderboard data', content: { 'application/json': { schema: { $ref: '#/components/schemas/Leaderboard' } } } },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },

  '/leaderboards/{id}/entries': {
    get: {
      tags: ['Leaderboards'],
      summary: 'Get leaderboard entries',
      description: 'Returns ranked entries (players and scores) for a leaderboard, ordered by score descending.',
      operationId: 'getLeaderboardEntries',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        200: {
          description: 'Ranked entries',
          content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/LeaderboardEntry' } } } },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },

  // ═══════════════════════════════════════════════
  // NOTIFICATIONS
  // ═══════════════════════════════════════════════

  '/notifications': {
    get: {
      tags: ['Notifications'],
      summary: 'List my notifications',
      description: 'Returns the authenticated user\'s notifications ordered by newest first. Includes read/unread status.',
      operationId: 'listNotifications',
      security: [{ bearerAuth: [] }],
      parameters: [
        { $ref: '#/components/parameters/PageParam' },
        { $ref: '#/components/parameters/LimitParam' },
      ],
      responses: {
        200: {
          description: 'Notifications list',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { type: 'array', items: { $ref: '#/components/schemas/Notification' } },
                  pagination: { $ref: '#/components/schemas/Pagination' },
                },
              },
            },
          },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },

  '/notifications/{id}': {
    patch: {
      tags: ['Notifications'],
      summary: 'Mark notification as read',
      description: 'Sets the `read_at` timestamp on a notification. Only the notification owner can mark it as read.',
      operationId: 'markNotificationRead',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        200: { description: 'Marked as read', content: { 'application/json': { schema: { $ref: '#/components/schemas/Notification' } } } },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },

  // ═══════════════════════════════════════════════
  // FILES
  // ═══════════════════════════════════════════════

  '/files': {
    post: {
      tags: ['Files'],
      summary: 'Upload a file',
      description: 'Uploads a file to the server. Allowed types: images (JPEG, PNG, GIF, WebP) and documents (PDF). Files are stored locally and served via `/uploads/` static path. Rate limited to 20 uploads per 15 minutes.',
      operationId: 'uploadFile',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['file'],
              properties: { file: { type: 'string', format: 'binary', description: 'File to upload' } },
            },
          },
        },
      },
      responses: {
        201: { description: 'File uploaded', content: { 'application/json': { schema: { $ref: '#/components/schemas/FileUpload' } } } },
        400: { description: 'No file or invalid type', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: 'File type not allowed' } } } },
        401: { $ref: '#/components/responses/Unauthorized' },
        429: { $ref: '#/components/responses/RateLimited' },
      },
    },
  },

  '/files/me': {
    get: {
      tags: ['Files'],
      summary: 'List my uploaded files',
      description: 'Returns all files uploaded by the authenticated user.',
      operationId: 'listMyFiles',
      security: [{ bearerAuth: [] }],
      responses: {
        200: {
          description: 'Files list',
          content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/FileUpload' } } } },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },

  // ═══════════════════════════════════════════════
  // ANALYTICS
  // ═══════════════════════════════════════════════

  '/analytics': {
    post: {
      tags: ['Analytics'],
      summary: 'Track analytics event',
      description: 'Records a custom analytics event with optional properties for tracking user behavior and feature usage.',
      operationId: 'trackEvent',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['event_name'],
              properties: {
                event_name: { type: 'string', example: 'button_click', description: 'Name of the event to track' },
                properties: { type: 'object', description: 'Additional event properties', example: { button: 'start_game', page: '/events/123' } },
              },
            },
          },
        },
      },
      responses: {
        201: { description: 'Event tracked' },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },

  // ═══════════════════════════════════════════════
  // AUDIT LOGS
  // ═══════════════════════════════════════════════

  '/audit-logs/organizations/{orgId}': {
    get: {
      tags: ['Audit Logs'],
      summary: 'List organization audit logs',
      description: 'Returns audit logs for a specific organization. Only accessible by authenticated organization members. Audit logs are **immutable** — they cannot be created, updated, or deleted via the API.',
      operationId: 'listOrgAuditLogs',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'orgId', in: 'path', required: true, description: 'Organization UUID', schema: { type: 'string', format: 'uuid' } }],
      responses: {
        200: {
          description: 'Audit logs list',
          content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/AuditLog' } } } },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    },
  },

  // ═══════════════════════════════════════════════
  // CONTACT
  // ═══════════════════════════════════════════════

  '/contact': {
    post: {
      tags: ['Contact'],
      summary: 'Submit contact form',
      description: 'Public endpoint — no authentication required. Submits a contact form message. Rate limited to 5 requests per 15 minutes per IP. The sender\'s IP is recorded.',
      operationId: 'submitContact',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ContactSubmitRequest' },
            example: { name: 'Jane Smith', email: 'jane@example.com', subject: 'Partnership inquiry', message: 'I would like to discuss a potential partnership.' },
          },
        },
      },
      responses: {
        201: {
          description: 'Submission received',
          content: { 'application/json': { example: { message: 'Message sent successfully', id: '550e8400-...' } } },
        },
        422: { $ref: '#/components/responses/ValidationFailed' },
        429: { $ref: '#/components/responses/RateLimited' },
      },
    },
  },

  // ═══════════════════════════════════════════════
  // ADMIN (Super Admin only)
  // ═══════════════════════════════════════════════

  '/admin/stats': {
    get: {
      tags: ['Admin'],
      summary: 'Get dashboard statistics',
      description: 'Returns platform-wide statistics. **Requires super-admin role.**',
      operationId: 'adminGetStats',
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: 'Dashboard stats', content: { 'application/json': { schema: { $ref: '#/components/schemas/AdminStats' } } } },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    },
  },

  '/admin/users': {
    get: {
      tags: ['Admin'],
      summary: 'List all users',
      description: 'Returns all users with full details including email and status. Supports search and pagination. **Requires super-admin role.**',
      operationId: 'adminListUsers',
      security: [{ bearerAuth: [] }],
      parameters: [
        { $ref: '#/components/parameters/PageParam' },
        { $ref: '#/components/parameters/LimitParam' },
        { $ref: '#/components/parameters/SearchParam' },
      ],
      responses: {
        200: {
          description: 'Paginated user list',
          content: {
            'application/json': {
              schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/User' } }, pagination: { $ref: '#/components/schemas/Pagination' } } },
            },
          },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    },
  },

  '/admin/users/{id}': {
    get: {
      tags: ['Admin'],
      summary: 'Get user details (admin)',
      description: 'Returns full user data. **Requires super-admin role.**',
      operationId: 'adminGetUser',
      security: [{ bearerAuth: [] }],
      parameters: [{ $ref: '#/components/parameters/UuidPathParam' }],
      responses: {
        200: { description: 'User data', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
    patch: {
      tags: ['Admin'],
      summary: 'Update user (admin)',
      description: 'Updates user fields (name, language, etc). Creates an audit log. **Requires super-admin role.**',
      operationId: 'adminUpdateUser',
      security: [{ bearerAuth: [] }],
      parameters: [{ $ref: '#/components/parameters/UuidPathParam' }],
      requestBody: {
        content: {
          'application/json': {
            schema: { type: 'object', properties: { name: { type: 'string' }, language: { type: 'string' } } },
          },
        },
      },
      responses: {
        200: { description: 'Updated user', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
    delete: {
      tags: ['Admin'],
      summary: 'Delete user (admin)',
      description: 'Permanently deletes a user and all associated data. **Irreversible. Requires super-admin role.**',
      operationId: 'adminDeleteUser',
      security: [{ bearerAuth: [] }],
      parameters: [{ $ref: '#/components/parameters/UuidPathParam' }],
      responses: {
        204: { description: 'User deleted' },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },

  '/admin/users/{id}/suspend': {
    post: {
      tags: ['Admin'],
      summary: 'Suspend user',
      description: 'Sets user status to `suspended`, preventing login. **Requires super-admin role.**',
      operationId: 'adminSuspendUser',
      security: [{ bearerAuth: [] }],
      parameters: [{ $ref: '#/components/parameters/UuidPathParam' }],
      responses: {
        200: { description: 'User suspended', content: { 'application/json': { example: { message: 'User suspended' } } } },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    },
  },

  '/admin/users/{id}/unsuspend': {
    post: {
      tags: ['Admin'],
      summary: 'Unsuspend user',
      description: 'Restores user status to `active`, allowing login again. **Requires super-admin role.**',
      operationId: 'adminUnsuspendUser',
      security: [{ bearerAuth: [] }],
      parameters: [{ $ref: '#/components/parameters/UuidPathParam' }],
      responses: {
        200: { description: 'User unsuspended', content: { 'application/json': { example: { message: 'User unsuspended' } } } },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    },
  },

  '/admin/organizations': {
    get: {
      tags: ['Admin'],
      summary: 'List all organizations',
      description: 'Returns all organizations with search and pagination. **Requires super-admin role.**',
      operationId: 'adminListOrganizations',
      security: [{ bearerAuth: [] }],
      parameters: [
        { $ref: '#/components/parameters/PageParam' },
        { $ref: '#/components/parameters/LimitParam' },
        { $ref: '#/components/parameters/SearchParam' },
      ],
      responses: {
        200: {
          description: 'Organizations list',
          content: {
            'application/json': {
              schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Organization' } }, pagination: { $ref: '#/components/schemas/Pagination' } } },
            },
          },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    },
  },

  '/admin/organizations/{id}': {
    delete: {
      tags: ['Admin'],
      summary: 'Delete organization (admin)',
      description: 'Permanently deletes an organization and all associated members, events, and data. **Irreversible. Requires super-admin role.**',
      operationId: 'adminDeleteOrganization',
      security: [{ bearerAuth: [] }],
      parameters: [{ $ref: '#/components/parameters/UuidPathParam' }],
      responses: {
        204: { description: 'Organization deleted' },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    },
  },

  '/admin/game-sessions': {
    get: {
      tags: ['Admin'],
      summary: 'List all game sessions',
      description: 'Returns all game sessions across the platform with pagination. **Requires super-admin role.**',
      operationId: 'adminListGameSessions',
      security: [{ bearerAuth: [] }],
      parameters: [
        { $ref: '#/components/parameters/PageParam' },
        { $ref: '#/components/parameters/LimitParam' },
      ],
      responses: {
        200: {
          description: 'Game sessions list',
          content: {
            'application/json': {
              schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/GameSession' } }, pagination: { $ref: '#/components/schemas/Pagination' } } },
            },
          },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    },
  },

  '/admin/audit-logs': {
    get: {
      tags: ['Admin'],
      summary: 'List all audit logs',
      description: 'Returns all audit logs across the platform. Supports filtering by user_id and action type. **Requires super-admin role.**',
      operationId: 'adminListAuditLogs',
      security: [{ bearerAuth: [] }],
      parameters: [
        { $ref: '#/components/parameters/PageParam' },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 100 } },
        { name: 'user_id', in: 'query', description: 'Filter by user ID', schema: { type: 'string', format: 'uuid' } },
        { name: 'action', in: 'query', description: 'Filter by action type (e.g. AUTH_LOGIN, EVENT_CREATE)', schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Audit logs list',
          content: {
            'application/json': {
              schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/AuditLog' } }, pagination: { $ref: '#/components/schemas/Pagination' } } },
            },
          },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    },
  },

  '/admin/contact': {
    get: {
      tags: ['Admin'],
      summary: 'List contact submissions',
      description: 'Returns contact form submissions with pagination and status filter. **Requires super-admin role.**',
      operationId: 'adminListContacts',
      security: [{ bearerAuth: [] }],
      parameters: [
        { $ref: '#/components/parameters/PageParam' },
        { $ref: '#/components/parameters/LimitParam' },
        { name: 'status', in: 'query', description: 'Filter by status', schema: { type: 'string', enum: ['new', 'read', 'replied', 'archived'] } },
      ],
      responses: {
        200: {
          description: 'Contact submissions',
          content: {
            'application/json': {
              schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/ContactSubmission' } }, pagination: { $ref: '#/components/schemas/Pagination' } } },
            },
          },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    },
  },

  '/admin/contact/{id}': {
    get: {
      tags: ['Admin'],
      summary: 'Get contact submission',
      description: 'Returns a single contact submission with all details. **Requires super-admin role.**',
      operationId: 'adminGetContact',
      security: [{ bearerAuth: [] }],
      parameters: [{ $ref: '#/components/parameters/UuidPathParam' }],
      responses: {
        200: { description: 'Submission data', content: { 'application/json': { schema: { $ref: '#/components/schemas/ContactSubmission' } } } },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
    patch: {
      tags: ['Admin'],
      summary: 'Update contact status',
      description: 'Updates the status of a contact submission (new → read → replied → archived). **Requires super-admin role.**',
      operationId: 'adminUpdateContactStatus',
      security: [{ bearerAuth: [] }],
      parameters: [{ $ref: '#/components/parameters/UuidPathParam' }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['status'],
              properties: { status: { type: 'string', enum: ['new', 'read', 'replied', 'archived'] } },
            },
          },
        },
      },
      responses: {
        200: { description: 'Updated submission', content: { 'application/json': { schema: { $ref: '#/components/schemas/ContactSubmission' } } } },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
    delete: {
      tags: ['Admin'],
      summary: 'Delete contact submission',
      description: 'Permanently deletes a contact submission. **Requires super-admin role.**',
      operationId: 'adminDeleteContact',
      security: [{ bearerAuth: [] }],
      parameters: [{ $ref: '#/components/parameters/UuidPathParam' }],
      responses: {
        204: { description: 'Submission deleted' },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },
};

options.definition!.paths = paths;

export const swaggerSpec = swaggerJsdoc(options);

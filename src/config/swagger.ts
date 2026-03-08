import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Flowkyn API',
      version: '1.0.0',
      description: 'Flowkyn Backend API — Event management, games, organizations & more.',
      contact: {
        name: 'Flowkyn Team',
        url: 'https://flowkyn.com',
      },
    },
    servers: [
      { url: 'https://api.flowkyn.com/v1', description: 'Production' },
      { url: 'http://localhost:3000/v1', description: 'Development' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your access token',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
        Pagination: {
          type: 'object',
          properties: {
            page: { type: 'integer' },
            limit: { type: 'integer' },
            total: { type: 'integer' },
            totalPages: { type: 'integer' },
          },
        },
      },
    },
    tags: [
      { name: 'Auth', description: 'Authentication & sessions' },
      { name: 'Users', description: 'User profile & management' },
      { name: 'Organizations', description: 'Organization management & members' },
      { name: 'Events', description: 'Event CRUD, invitations & messaging' },
      { name: 'Games', description: 'Game types, sessions & actions' },
      { name: 'Leaderboards', description: 'Leaderboard data' },
      { name: 'Notifications', description: 'User notifications' },
      { name: 'Files', description: 'File uploads' },
      { name: 'Analytics', description: 'Event tracking' },
      { name: 'Audit Logs', description: 'Organization audit logs' },
      { name: 'Contact', description: 'Contact form submissions' },
      { name: 'Admin', description: 'Super admin operations' },
    ],
  },
  apis: [], // We define paths inline below
};

// Build full paths spec inline (no JSDoc comments needed in route files)
const paths: Record<string, any> = {
  // ─── Auth ───
  '/auth/register': {
    post: {
      tags: ['Auth'],
      summary: 'Register a new account',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email', 'password', 'name'],
              properties: {
                email: { type: 'string', format: 'email' },
                password: { type: 'string', minLength: 8 },
                name: { type: 'string' },
                language: { type: 'string', default: 'en' },
              },
            },
          },
        },
      },
      responses: {
        201: { description: 'Account created — verification email sent' },
        409: { description: 'Email already in use' },
      },
    },
  },
  '/auth/verify-email': {
    post: {
      tags: ['Auth'],
      summary: 'Verify email with OTP code',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email', 'code'],
              properties: {
                email: { type: 'string', format: 'email' },
                code: { type: 'string' },
              },
            },
          },
        },
      },
      responses: { 200: { description: 'Email verified' } },
    },
  },
  '/auth/login': {
    post: {
      tags: ['Auth'],
      summary: 'Login with email & password',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email', 'password'],
              properties: {
                email: { type: 'string', format: 'email' },
                password: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Login successful',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  access_token: { type: 'string' },
                  refresh_token: { type: 'string' },
                },
              },
            },
          },
        },
        401: { description: 'Invalid credentials' },
      },
    },
  },
  '/auth/refresh': {
    post: {
      tags: ['Auth'],
      summary: 'Refresh access token',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['refresh_token'],
              properties: { refresh_token: { type: 'string' } },
            },
          },
        },
      },
      responses: { 200: { description: 'New access token' } },
    },
  },
  '/auth/logout': {
    post: {
      tags: ['Auth'],
      summary: 'Logout (invalidate session)',
      security: [{ bearerAuth: [] }],
      responses: { 200: { description: 'Logged out' } },
    },
  },
  '/auth/me': {
    get: {
      tags: ['Auth'],
      summary: 'Get current authenticated user',
      security: [{ bearerAuth: [] }],
      responses: { 200: { description: 'Current user data' } },
    },
  },
  '/auth/forgot-password': {
    post: {
      tags: ['Auth'],
      summary: 'Request password reset email',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email'],
              properties: { email: { type: 'string', format: 'email' } },
            },
          },
        },
      },
      responses: { 200: { description: 'Reset email sent if account exists' } },
    },
  },
  '/auth/reset-password': {
    post: {
      tags: ['Auth'],
      summary: 'Reset password with token',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['token', 'password'],
              properties: {
                token: { type: 'string' },
                password: { type: 'string', minLength: 8 },
              },
            },
          },
        },
      },
      responses: { 200: { description: 'Password reset' } },
    },
  },

  // ─── Users ───
  '/users/me': {
    get: {
      tags: ['Users'],
      summary: 'Get my profile',
      security: [{ bearerAuth: [] }],
      responses: { 200: { description: 'User profile' } },
    },
    patch: {
      tags: ['Users'],
      summary: 'Update my profile',
      security: [{ bearerAuth: [] }],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                language: { type: 'string' },
              },
            },
          },
        },
      },
      responses: { 200: { description: 'Updated profile' } },
    },
  },
  '/users/avatar': {
    post: {
      tags: ['Users'],
      summary: 'Upload avatar',
      security: [{ bearerAuth: [] }],
      requestBody: {
        content: { 'multipart/form-data': { schema: { type: 'object', properties: { avatar: { type: 'string', format: 'binary' } } } } },
      },
      responses: { 200: { description: 'Avatar URL' } },
    },
  },
  '/users': {
    get: {
      tags: ['Users'],
      summary: 'List users',
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer' } },
        { name: 'limit', in: 'query', schema: { type: 'integer' } },
      ],
      responses: { 200: { description: 'Paginated user list' } },
    },
  },
  '/users/{id}': {
    get: {
      tags: ['Users'],
      summary: 'Get user by ID',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: { description: 'User data' } },
    },
  },

  // ─── Organizations ───
  '/organizations': {
    post: {
      tags: ['Organizations'],
      summary: 'Create an organization',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['name'],
              properties: { name: { type: 'string' } },
            },
          },
        },
      },
      responses: { 201: { description: 'Organization created' } },
    },
  },
  '/organizations/{orgId}': {
    get: {
      tags: ['Organizations'],
      summary: 'Get organization by ID',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: { description: 'Organization data' } },
    },
    patch: {
      tags: ['Organizations'],
      summary: 'Update organization',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: { description: 'Updated' } },
    },
  },
  '/organizations/{orgId}/members': {
    get: {
      tags: ['Organizations'],
      summary: 'List organization members',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: { description: 'Members list' } },
    },
  },
  '/organizations/{orgId}/members/{memberId}': {
    delete: {
      tags: ['Organizations'],
      summary: 'Remove a member',
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'memberId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: { 200: { description: 'Member removed' } },
    },
  },
  '/organizations/{orgId}/logo': {
    post: {
      tags: ['Organizations'],
      summary: 'Upload organization logo',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        content: { 'multipart/form-data': { schema: { type: 'object', properties: { logo: { type: 'string', format: 'binary' } } } } },
      },
      responses: { 200: { description: 'Logo URL' } },
    },
  },
  '/organizations/{orgId}/invitations': {
    post: {
      tags: ['Organizations'],
      summary: 'Invite member to organization',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email'],
              properties: {
                email: { type: 'string', format: 'email' },
                role_id: { type: 'string' },
              },
            },
          },
        },
      },
      responses: { 201: { description: 'Invitation sent' } },
    },
  },
  '/organizations/invitations/accept': {
    post: {
      tags: ['Organizations'],
      summary: 'Accept organization invitation',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['token'],
              properties: { token: { type: 'string' } },
            },
          },
        },
      },
      responses: { 200: { description: 'Invitation accepted' } },
    },
  },

  // ─── Events ───
  '/events': {
    get: {
      tags: ['Events'],
      summary: 'List events',
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer' } },
        { name: 'limit', in: 'query', schema: { type: 'integer' } },
      ],
      responses: { 200: { description: 'Paginated event list' } },
    },
    post: {
      tags: ['Events'],
      summary: 'Create an event',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['title', 'organization_id', 'event_mode', 'start_time', 'end_time'],
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
                organization_id: { type: 'string', format: 'uuid' },
                event_mode: { type: 'string', enum: ['sync', 'async'] },
                visibility: { type: 'string', enum: ['public', 'private'] },
                max_participants: { type: 'integer' },
                start_time: { type: 'string', format: 'date-time' },
                end_time: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
      },
      responses: { 201: { description: 'Event created' } },
    },
  },
  '/events/{eventId}': {
    get: {
      tags: ['Events'],
      summary: 'Get event by ID',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'eventId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: { description: 'Event data' } },
    },
    put: {
      tags: ['Events'],
      summary: 'Update event',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'eventId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: { description: 'Updated' } },
    },
    delete: {
      tags: ['Events'],
      summary: 'Delete event',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'eventId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: { description: 'Deleted' } },
    },
  },
  '/events/{eventId}/invitations': {
    post: {
      tags: ['Events'],
      summary: 'Invite participant to event',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'eventId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 201: { description: 'Invitation sent' } },
    },
  },
  '/events/{eventId}/join': {
    post: {
      tags: ['Events'],
      summary: 'Join an event',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'eventId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: { description: 'Joined' } },
    },
  },
  '/events/{eventId}/leave': {
    post: {
      tags: ['Events'],
      summary: 'Leave an event',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'eventId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: { description: 'Left event' } },
    },
  },
  '/events/{eventId}/messages': {
    get: {
      tags: ['Events'],
      summary: 'Get event messages',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'eventId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: { description: 'Messages list' } },
    },
    post: {
      tags: ['Events'],
      summary: 'Send message in event',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'eventId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 201: { description: 'Message sent' } },
    },
  },
  '/events/{eventId}/posts': {
    post: {
      tags: ['Events'],
      summary: 'Create a post in event',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'eventId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 201: { description: 'Post created' } },
    },
  },
  '/posts/{postId}/reactions': {
    post: {
      tags: ['Events'],
      summary: 'React to a post',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'postId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: { description: 'Reaction added' } },
    },
  },

  // ─── Games ───
  '/game-types': {
    get: {
      tags: ['Games'],
      summary: 'List available game types',
      security: [{ bearerAuth: [] }],
      responses: { 200: { description: 'Game types list' } },
    },
  },
  '/events/{eventId}/game-sessions': {
    post: {
      tags: ['Games'],
      summary: 'Start a game session',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'eventId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 201: { description: 'Session started' } },
    },
  },
  '/game-sessions/{id}/rounds': {
    post: {
      tags: ['Games'],
      summary: 'Start a new round',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 201: { description: 'Round started' } },
    },
  },
  '/game-sessions/{id}/finish': {
    post: {
      tags: ['Games'],
      summary: 'Finish a game session',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: { description: 'Session finished' } },
    },
  },
  '/game-actions': {
    post: {
      tags: ['Games'],
      summary: 'Submit a game action',
      security: [{ bearerAuth: [] }],
      responses: { 201: { description: 'Action submitted' } },
    },
  },

  // ─── Leaderboards ───
  '/leaderboards/{id}': {
    get: {
      tags: ['Leaderboards'],
      summary: 'Get leaderboard by ID',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: { description: 'Leaderboard data' } },
    },
  },
  '/leaderboards/{id}/entries': {
    get: {
      tags: ['Leaderboards'],
      summary: 'Get leaderboard entries',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: { description: 'Entries list' } },
    },
  },

  // ─── Notifications ───
  '/notifications': {
    get: {
      tags: ['Notifications'],
      summary: 'List my notifications',
      security: [{ bearerAuth: [] }],
      responses: { 200: { description: 'Notifications list' } },
    },
  },
  '/notifications/{id}': {
    patch: {
      tags: ['Notifications'],
      summary: 'Mark notification as read',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: { description: 'Marked as read' } },
    },
  },

  // ─── Files ───
  '/files': {
    post: {
      tags: ['Files'],
      summary: 'Upload a file',
      security: [{ bearerAuth: [] }],
      requestBody: {
        content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } } },
      },
      responses: { 201: { description: 'File uploaded' } },
    },
  },
  '/files/me': {
    get: {
      tags: ['Files'],
      summary: 'List my uploaded files',
      security: [{ bearerAuth: [] }],
      responses: { 200: { description: 'Files list' } },
    },
  },

  // ─── Analytics ───
  '/analytics': {
    post: {
      tags: ['Analytics'],
      summary: 'Track an analytics event',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['event_name'],
              properties: {
                event_name: { type: 'string' },
                properties: { type: 'object' },
              },
            },
          },
        },
      },
      responses: { 201: { description: 'Event tracked' } },
    },
  },

  // ─── Audit Logs ───
  '/audit-logs/organizations/{orgId}': {
    get: {
      tags: ['Audit Logs'],
      summary: 'List audit logs for organization',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: { description: 'Audit logs list' } },
    },
  },

  // ─── Contact ───
  '/contact': {
    post: {
      tags: ['Contact'],
      summary: 'Submit contact form',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['name', 'email', 'message'],
              properties: {
                name: { type: 'string' },
                email: { type: 'string', format: 'email' },
                subject: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
      },
      responses: { 201: { description: 'Submission received' } },
    },
  },

  // ─── Admin ───
  '/admin/stats': {
    get: {
      tags: ['Admin'],
      summary: 'Get dashboard statistics',
      security: [{ bearerAuth: [] }],
      responses: { 200: { description: 'Stats data' } },
    },
  },
  '/admin/users': {
    get: {
      tags: ['Admin'],
      summary: 'List all users (admin)',
      security: [{ bearerAuth: [] }],
      responses: { 200: { description: 'Users list' } },
    },
  },
  '/admin/users/{id}': {
    get: {
      tags: ['Admin'],
      summary: 'Get user by ID (admin)',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: { description: 'User data' } },
    },
    patch: {
      tags: ['Admin'],
      summary: 'Update user (admin)',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: { description: 'Updated' } },
    },
    delete: {
      tags: ['Admin'],
      summary: 'Delete user (admin)',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: { description: 'Deleted' } },
    },
  },
  '/admin/users/{id}/suspend': {
    post: {
      tags: ['Admin'],
      summary: 'Suspend user',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: { description: 'Suspended' } },
    },
  },
  '/admin/users/{id}/unsuspend': {
    post: {
      tags: ['Admin'],
      summary: 'Unsuspend user',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: { description: 'Unsuspended' } },
    },
  },
  '/admin/organizations': {
    get: {
      tags: ['Admin'],
      summary: 'List all organizations (admin)',
      security: [{ bearerAuth: [] }],
      responses: { 200: { description: 'Organizations list' } },
    },
  },
  '/admin/organizations/{id}': {
    delete: {
      tags: ['Admin'],
      summary: 'Delete organization (admin)',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: { description: 'Deleted' } },
    },
  },
  '/admin/game-sessions': {
    get: {
      tags: ['Admin'],
      summary: 'List all game sessions (admin)',
      security: [{ bearerAuth: [] }],
      responses: { 200: { description: 'Game sessions list' } },
    },
  },
  '/admin/audit-logs': {
    get: {
      tags: ['Admin'],
      summary: 'List all audit logs (admin)',
      security: [{ bearerAuth: [] }],
      responses: { 200: { description: 'Audit logs list' } },
    },
  },
  '/admin/contact': {
    get: {
      tags: ['Admin'],
      summary: 'List contact submissions (admin)',
      security: [{ bearerAuth: [] }],
      responses: { 200: { description: 'Contact submissions' } },
    },
  },
  '/admin/contact/{id}': {
    get: {
      tags: ['Admin'],
      summary: 'Get contact submission (admin)',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: { description: 'Submission data' } },
    },
    patch: {
      tags: ['Admin'],
      summary: 'Update contact status (admin)',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: { description: 'Updated' } },
    },
    delete: {
      tags: ['Admin'],
      summary: 'Delete contact submission (admin)',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: { description: 'Deleted' } },
    },
  },
};

options.definition!.paths = paths;

export const swaggerSpec = swaggerJsdoc(options);

# Strategic Escape Challenge — Quick Reference Guide

**Last Updated**: 2025-03-18  
**Implementation Status**: Phases 2.3 & 2.5 Complete ✅ | Phase 2.4 Ready ⏳

---

## What Was Built This Session

### Phase 2.3: Automatic Discussion Timeout
- Discussions auto-close after 30 minutes
- Debrief triggers automatically without admin action
- Job runs every 30 seconds checking for expired discussions
- WebSocket events notify clients in real-time

**Files Modified**:
- `src/jobs/discussionTimer.ts` (+45 lines)
- `src/services/games.service.ts` (+8 lines)

### Phase 2.5: Security & Validation
- Rate limiting: 10 requests per minute per user
- Session state validation: Prevents invalid debrief calls
- Type safety: Full TypeScript coverage
- Error handling: Structured error codes

**Files Modified**:
- `src/middleware/rateLimiter.ts` (+32 lines)
- `src/routes/games.routes.ts` (+2 lines)
- `src/controllers/games.controller.ts` (+8 lines)
- `src/types/index.ts` (+3 lines)

---

## API Endpoints

### Get Debrief Results
```
GET /v1/strategic-sessions/{sessionId}/debrief-results
Headers:
  - Authorization: Bearer {token}
Rate Limited: ✅ Yes (10 req/min per user)
Auth Required: ✅ Yes (admin/moderator)
Response: { rankings[], participantCount, totalActions, ... }
```

### Start Debrief
```
POST /v1/strategic-sessions/{sessionId}/start-debrief
Headers:
  - Authorization: Bearer {token}
Rate Limited: ✅ Yes (10 req/min per user)
Auth Required: ✅ Yes (admin/moderator)
Response: { results: { rankings[], ... }, timestamp }
```

---

## Error Codes

| Code | Status | When |
|------|--------|------|
| `SESSION_NOT_ACTIVE` | 400 | Session not in `in_progress` status |
| `SESSION_ALREADY_FINISHED` | 400 | Debrief already sent |
| `NOT_A_MEMBER` | 403 | User not in organization |
| `INSUFFICIENT_PERMISSIONS` | 403 | User not admin/moderator |
| `FORBIDDEN` | 403 | Authentication failed |
| `RATE_LIMITED` | 429 | 10 req/min exceeded |

---

## Environment Configuration

### Rate Limiting
```bash
# Disable rate limiting (development only)
DISABLE_RATE_LIMIT=true

# Active only in production
NODE_ENV=production
```

### Discussion Timeout
```typescript
// Default: 30 minutes
// Set at: Session creation time
// Configurable per session:
await gamesService.createStrategicSession(data, 45); // 45 minutes
```

### Job Scheduler
```typescript
// Runs every 30 seconds (in src/index.ts)
scheduleDiscussionTimer(30000);

// Gracefully stops on shutdown
stopDiscussionTimer();
```

---

## WebSocket Events

### When Discussion Expires
```json
{
  "event": "game:discussion_ended_auto",
  "data": {
    "sessionId": "uuid",
    "phase": "debrief",
    "resultsCount": 42,
    "timestamp": "2025-03-18T14:30:00Z"
  }
}
```

### When Debrief Starts
```json
{
  "event": "game:debrief_started",
  "data": {
    "sessionId": "uuid",
    "phase": "debrief",
    "resultsCount": 42,
    "timestamp": "2025-03-18T14:30:00Z"
  }
}
```

---

## Database Schema Changes (Phase 2.4)

### New Columns
```sql
-- When discussion expires (auto-set by timer)
ALTER TABLE game_sessions ADD COLUMN discussion_ends_at TIMESTAMP NULL;

-- When debrief is sent to clients
ALTER TABLE game_sessions ADD COLUMN debrief_sent_at TIMESTAMP NULL;

-- When role assignment completes (future use)
ALTER TABLE game_sessions ADD COLUMN role_assignment_completed_at TIMESTAMP NULL;
```

### New Indices
```sql
-- For periodic job queries
CREATE INDEX idx_game_sessions_discussion_ends_at ON game_sessions(discussion_ends_at);
CREATE INDEX idx_game_sessions_debrief_sent_at ON game_sessions(debrief_sent_at);
-- + 5 more for performance
```

---

## Type Definitions

### GameSessionRow (Updated)
```typescript
interface GameSessionRow {
  id: string;
  event_id: string;
  game_type_id: string;
  status: string;                        // in_progress, waiting, finished, etc.
  
  // NEW in Phase 2.3/2.4:
  discussion_ends_at?: Date | null;      // When discussion times out
  debrief_sent_at?: Date | null;         // When debrief was sent
  role_assignment_completed_at?: Date | null; // When roles assigned
}
```

---

## Rate Limiting Details

### Per User
```typescript
const userId = req.user?.id; // User ID from JWT token
// 10 requests per 60 seconds per user ID
```

### Response When Limited
```json
{
  "error": "Too many requests — please slow down",
  "code": "RATE_LIMITED",
  "statusCode": 429,
  "requestId": "req-abc123",
  "timestamp": "2025-03-18T14:30:00Z"
}
```

### Disable (Dev Only)
```bash
DISABLE_RATE_LIMIT=true npm run dev
```

---

## Validation Logic

### Session State Check
```typescript
// MUST be true to start debrief:
if (session.status !== 'in_progress') {
  throw new AppError(..., 'SESSION_NOT_ACTIVE');
}

// MUST be null to start debrief:
if (session.debrief_sent_at !== null) {
  throw new AppError(..., 'SESSION_ALREADY_FINISHED');
}
```

### Authorization Check
```typescript
// User MUST be:
const member = await queryOne(
  `SELECT r.name as role_name
   FROM organization_members om
   JOIN roles r ON r.id = om.role_id
   WHERE om.organization_id = $1 AND om.user_id = $2`,
  [organizationId, userId]
);

// Role MUST be one of:
if (!['owner', 'admin', 'moderator'].includes(member.role_name)) {
  throw new AppError(..., 'INSUFFICIENT_PERMISSIONS');
}
```

---

## Monitoring

### Logs to Watch
```bash
# Job running
[DiscussionTimer] Found 3 expired discussions to auto-close

# Auto-debrief triggered
[DiscussionTimer] Auto-transitioning session {id} to debrief

# Rate limiting
# (Silently tracked, visible in error responses)

# Errors
[DiscussionTimer] Failed to auto-debrief session {id}
```

### Metrics to Track
- Count of 429 rate limit responses
- Count of auto-debriefs triggered per hour
- Job execution time (should be < 100ms)
- WebSocket event delivery rate

---

## Testing Quick Start

### Test Rate Limiting
```bash
# Request 1-10: Success
curl -H "Authorization: Bearer {token}" \
  https://api.example.com/v1/strategic-sessions/{id}/debrief-results

# Request 11: Rate Limited
# Response: 429 RATE_LIMITED
```

### Test Session State Validation
```bash
# Setup: Create session with status 'waiting_for_participants'

# Try to debrief: FAIL
curl -X POST -H "Authorization: Bearer {token}" \
  https://api.example.com/v1/strategic-sessions/{id}/start-debrief
# Response: 400 SESSION_NOT_ACTIVE

# Move to in_progress and try again: SUCCESS
# Response: 200 OK with debrief results
```

### Test Auto-Debrief
```bash
# Setup: Create session with 1 minute discussion timeout
# Wait: 61+ seconds

# Observe: Job auto-closes discussion
# Check logs: "[DiscussionTimer] Triggered 1 auto-debriefs"
```

---

## Known Limitations

1. **Rate Limiting**: In-memory (resets on server restart)
   - Solution: Use Redis for distributed rate limiting

2. **Job Polling**: Simple interval (not event-driven)
   - Solution: Use PostgreSQL LISTEN/NOTIFY

3. **Debrief Caching**: Not cached (expensive calculation)
   - Solution: Cache with TTL for repeated requests

4. **Error Recovery**: No retry logic for failed debriefs
   - Solution: Add exponential backoff

---

## Phase 2.4 Execution

When ready to apply database migration:

```bash
# Backup database (recommended)
pg_dump -U postgres flowkyn_dev > backup.sql

# Run migration
psql -U postgres -d flowkyn_dev -f database/migrations/20260318_strategic_escape_critical_fix.sql

# Verify
psql -U postgres -d flowkyn_dev -c "\d game_sessions" # Check columns
psql -U postgres -d flowkyn_dev -c "\di" # Check indices
```

---

## Deployment Checklist

- [ ] Verify zero TypeScript errors: `npm run build`
- [ ] Run unit tests: `npm run test`
- [ ] Deploy code to staging
- [ ] Execute Phase 2.4 migration
- [ ] Monitor startup logs for job initialization
- [ ] Test rate limiting with concurrent requests
- [ ] Verify discussion timeout after 30 minutes
- [ ] Check WebSocket events emit correctly
- [ ] Load test with 100+ concurrent users
- [ ] Monitor debrief endpoint latency
- [ ] Review error logs for any issues
- [ ] Deploy to production with rollback plan

---

## Support & Troubleshooting

### No Auto-Debrief Triggering?
1. Check job logs: `[DiscussionTimer] Job scheduled`
2. Verify `discussion_ends_at` column exists (Phase 2.4)
3. Check if `debrief_sent_at` already set (idempotency guard)
4. Review error logs for exceptions

### Rate Limit Errors?
1. Set `DISABLE_RATE_LIMIT=true` to disable (development)
2. Increase max: Edit `max: 10` in rateLimiter.ts
3. Change window: Edit `windowMs: 60 * 1000` in rateLimiter.ts

### Session State Errors?
1. Verify session status is `in_progress`
2. Check `debrief_sent_at` is NULL
3. Verify user is admin/moderator

---

## Success Indicators

✅ Discussion auto-closes after 30 minutes  
✅ Debrief auto-triggers without admin action  
✅ Rate limiting prevents API abuse  
✅ Session state validation prevents invalid calls  
✅ Full type safety in TypeScript  
✅ Zero compilation errors  
✅ Proper error codes returned  
✅ WebSocket events emit in real-time  


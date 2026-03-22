# Critical Game Fixes - Implementation Plan

**Status:** Ready for immediate implementation  
**Estimated Time:** 4-6 hours  
**Risk Level:** Low (non-breaking changes)

---

## FIX #1: Two Truths Vote Race Condition

### File
`src/socket/gameHandlers.ts` lines 311-330

### Current Code
```typescript
if (actionType === 'two_truths:vote') {
  if (base.phase !== 'vote') return base;
  const choice = payload?.statementId;
  if (!['s0', 's1', 's2'].includes(choice)) return base;
  if (base.presenterParticipantId && participantId === base.presenterParticipantId) return base;
  
  try {
    await query(
      `INSERT INTO game_votes (...) ON CONFLICT (...) DO UPDATE SET ...`,
      [session?.id, participantId, choice]
    );
  } catch (err) {
    console.warn('[TwoTruths] Failed to record vote atomically');
    // PROBLEM: Still falls back to in-memory
    return { ...base, votes: { ...base.votes, [participantId]: choice } };
  }
}
```

### Fix Applied
```typescript
if (actionType === 'two_truths:vote') {
  if (base.phase !== 'vote') return base;
  const choice = payload?.statementId;
  if (!['s0', 's1', 's2'].includes(choice)) return base;
  if (base.presenterParticipantId && participantId === base.presenterParticipantId) return base;
  
  try {
    // Atomic database write - only way to record vote
    const voteResult = await query(
      `INSERT INTO game_votes (game_session_id, participant_id, statement_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (game_session_id, participant_id) 
       DO UPDATE SET statement_id = EXCLUDED.statement_id, voted_at = NOW()
       RETURNING statement_id`,
      [session?.id, participantId, choice]
    );
    
    if (!voteResult?.[0]) {
      throw new Error('Vote insertion returned no result');
    }
    
    console.log('[TwoTruths] Atomic vote recorded', { 
      sessionId: session?.id, 
      participantId, 
      choice,
      dbConfirmed: true 
    });
  } catch (err: any) {
    console.error('[TwoTruths] CRITICAL: Failed to record vote atomically', { 
      sessionId: session?.id,
      participantId, 
      choice,
      error: err?.message,
      stack: err?.stack 
    });
    
    // Emit error to user and reject the action
    // Don't fall back to in-memory state
    throw new AppError(
      'Failed to record your vote. Please try voting again.',
      400
    );
  }
  
  // Update in-memory state with database-confirmed vote
  return { ...base, votes: { ...base.votes, [participantId]: choice } };
}
```

### Verification
- [ ] Test rapid consecutive votes from same participant
- [ ] Verify database has ON CONFLICT constraint on (game_session_id, participant_id)
- [ ] Verify error is propagated to client
- [ ] Verify vote is counted exactly once

---

## FIX #2: Coffee Roulette Late Joiner Desync

### File
`src/socket/gameHandlers.ts` lines 1100-1180 (game:join handler)

### Implementation

#### Step 1: Add Helper Function (before game:join handler)
```typescript
/**
 * Enrich Coffee Roulette snapshot for late joiners.
 * Ensures the joining participant knows:
 * - If they're already paired (and with whom)
 * - What the conversation topic is
 * - What phase they're joining in
 */
async function enrichCoffeeSnapshotForLateJoiner(
  snapshot: any,
  sessionId: string,
  participantId: string,
  eventId: string
): Promise<any> {
  if (!snapshot || snapshot.kind !== 'coffee-roulette') {
    return snapshot;
  }

  // Find this participant in the current pair list
  const pair = (snapshot.pairs || []).find(
    p => p.person1.participantId === participantId || p.person2.participantId === participantId
  );

  // If they should be paired but aren't, check if they're marked as unpaired
  let unpairedStatus: string | null = null;
  if (!pair && (snapshot.phase === 'chatting' || snapshot.phase === 'matching')) {
    const unpaired = await queryOne<{ reason: string; resolved_at: string | null }>(
      `SELECT reason, resolved_at FROM coffee_roulette_unpaired
       WHERE game_session_id = $1 AND participant_id = $2`,
      [sessionId, participantId]
    );
    
    if (unpaired && !unpaired.resolved_at) {
      unpairedStatus = unpaired.reason; // 'odd_count', 'disconnect', etc.
    }
  }

  return {
    ...snapshot,
    // Add metadata for this specific participant
    _currentUserParticipantId: participantId,
    _currentUserPair: pair || null,
    _currentUserUnpairedReason: unpairedStatus,
    _currentUserPhase: snapshot.phase,
    _snapshotIsEnrichedForLateJoiner: true,
  };
}
```

#### Step 2: Update game:join Handler
Find this section around line 1160:
```typescript
// OLD CODE:
// FIX #1: Enrich snapshot with current pair info for late joiners
const enrichedSnapshot = snapshot?.state;
if (enrichedSnapshot && (enrichedSnapshot as any).kind === 'coffee-roulette' && (enrichedSnapshot as any).pairs) {
  const pairs = (enrichedSnapshot as any).pairs;
  (enrichedSnapshot as any).pairs = pairs.map((p: any) => ({
    id: p.id,
    person1: p.person1,
    person2: p.person2,
    topic: p.topic,
    topicKey: p.topicKey,
    topicId: p.topicId,
  }));
}
```

Replace with:
```typescript
// NEW CODE: Comprehensive late joiner enrichment
let enrichedSnapshot = snapshot?.state;
if (enrichedSnapshot && (enrichedSnapshot as any).kind === 'coffee-roulette') {
  try {
    enrichedSnapshot = await enrichCoffeeSnapshotForLateJoiner(
      enrichedSnapshot,
      data.sessionId,
      participant.participantId,
      session.event_id
    );
  } catch (err) {
    console.warn('[CoffeeRoulette] Failed to enrich snapshot for late joiner', {
      sessionId: data.sessionId,
      participantId: participant.participantId,
      error: err
    });
    // Continue without enrichment rather than failing
  }
}
```

### Verification
- [ ] Test user joins, gets paired, then disconnects/reconnects
- [ ] Verify enriched snapshot shows their pair
- [ ] Verify unpaired participants see `_currentUserUnpairedReason`
- [ ] Test with odd number of participants

---

## FIX #3: Action Payload Validation Schemas

### File
`src/socket/gameHandlers.ts` lines 200-220 (add after existing schemas)

### Add Validation Schemas
```typescript
// ============================================
// PAYLOAD VALIDATION SCHEMAS
// ============================================

// Two Truths
const twoTruthsSubmitSchema = z.object({
  statements: z.array(
    z.string()
      .trim()
      .min(3, 'Each statement must be at least 3 characters')
      .max(300, 'Each statement must be at most 300 characters')
  ).length(3, 'You must provide exactly 3 statements'),
  lieIndex: z.number().int().min(0).max(2).optional().default(2),
});

const twoTruthsVoteSchema = z.object({
  statementId: z.enum(['s0', 's1', 's2'], {
    errorMap: () => ({ message: 'Invalid statement ID' })
  }),
});

const twoTruthsRevealSchema = z.object({
  lieId: z.enum(['s0', 's1', 's2']).optional(),
});

// Coffee Roulette
const coffeeNextPromptSchema = z.object({
  expectedPromptsUsed: z.number().int().min(0),
});

const coffeeContinueSchema = z.object({
  expectedPromptsUsed: z.number().int().min(0),
});

// Strategic Escape
const strategicConfigureSchema = z.object({
  industryKey: z.string().optional(),
  crisisKey: z.string().optional(),
  difficultyKey: z.enum(['easy', 'medium', 'hard']).optional(),
  industryLabel: z.string().optional(),
  crisisLabel: z.string().optional(),
});

const strategicAssignRolesSchema = z.object({
  roles: z.record(z.string(), z.string()), // { participantId: roleKey }
});
```

### Update game:action Handler
Find the game action processing section (around line 1400). Update each game branch:

```typescript
if (gameKey === 'two-truths' && isTwoTruthsAction(data.actionType)) {
  // ... existing permission check ...

  // ADD PAYLOAD VALIDATION
  if (data.actionType === 'two_truths:submit') {
    const payloadValidation = twoTruthsSubmitSchema.safeParse(data.payload);
    if (!payloadValidation.success) {
      socket.emit('error', { 
        message: 'Invalid submission',
        code: 'VALIDATION',
        issues: payloadValidation.error.issues.map(i => ({ path: i.path, message: i.message }))
      });
      return;
    }
    data.payload = payloadValidation.data; // Use validated data
  }

  if (data.actionType === 'two_truths:vote') {
    const payloadValidation = twoTruthsVoteSchema.safeParse(data.payload);
    if (!payloadValidation.success) {
      socket.emit('error', { 
        message: 'Invalid vote',
        code: 'VALIDATION',
        issues: payloadValidation.error.issues
      });
      return;
    }
    data.payload = payloadValidation.data;
  }

  if (data.actionType === 'two_truths:reveal') {
    const payloadValidation = twoTruthsRevealSchema.safeParse(data.payload);
    if (!payloadValidation.success) {
      socket.emit('error', { 
        message: 'Invalid reveal',
        code: 'VALIDATION'
      });
      return;
    }
    data.payload = payloadValidation.data;
  }

  // ... rest of reducer call ...
}

if (gameKey === 'coffee-roulette' && isCoffeeAction(data.actionType)) {
  // ADD PAYLOAD VALIDATION for coffee actions
  if (data.actionType === 'coffee:next_prompt') {
    const payloadValidation = coffeeNextPromptSchema.safeParse(data.payload);
    if (!payloadValidation.success) {
      socket.emit('error', { 
        message: 'Invalid prompt request',
        code: 'VALIDATION'
      });
      return;
    }
    data.payload = payloadValidation.data;
  }

  if (data.actionType === 'coffee:continue') {
    const payloadValidation = coffeeContinueSchema.safeParse(data.payload);
    if (!payloadValidation.success) {
      socket.emit('error', { 
        message: 'Invalid continue request',
        code: 'VALIDATION'
      });
      return;
    }
    data.payload = payloadValidation.data;
  }

  // ... rest of reducer call ...
}
```

### Verification
- [ ] Try submitting statements with XSS payload (should be rejected)
- [ ] Try voting with invalid statement ID (should be rejected)
- [ ] Try submitting < 3 statements (should show clear error)
- [ ] Verify error messages are user-friendly

---

## FIX #4: Strategic Escape Role Assignment Security

### File
`src/socket/gameHandlers.ts` lines 783-820 (reduceStrategicState)

### Current Code Problem
```typescript
if (actionType === 'strategic:assign_roles') {
  if (base.rolesAssigned) return base;
  return {
    ...base,
    rolesAssigned: true,
    phase: 'roles_assignment',
    gameStatus: 'in_progress',
  };
}
```

**Issues:**
1. No permission check
2. No role storage
3. No secret role reveal

### Implementation

#### Step 1: Create Migration
Create `src/database/migrations/20250322_add_strategic_escape_roles_table.sql`:

```sql
CREATE TABLE IF NOT EXISTS strategic_escape_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  role_key varchar(100) NOT NULL,
  assigned_at timestamp DEFAULT NOW(),
  revealed_at timestamp,
  UNIQUE(game_session_id, participant_id),
  CHECK (role_key IN ('director', 'manager', 'technician', 'observer'))
);

CREATE INDEX idx_strategic_roles_session ON strategic_escape_roles(game_session_id);
CREATE INDEX idx_strategic_roles_participant ON strategic_escape_roles(game_session_id, participant_id);
```

#### Step 2: Update Reducer
In `src/socket/gameHandlers.ts`, replace the strategic:assign_roles handler:

```typescript
if (actionType === 'strategic:assign_roles') {
  // Idempotent: don't re-run assignment
  if (base.rolesAssigned) {
    console.log('[StrategicEscape] Roles already assigned', { sessionId });
    return base;
  }

  // Validate roles assignment payload
  const roleAssignments = payload?.roles; // { participantId: roleKey, ... }
  if (!roleAssignments || typeof roleAssignments !== 'object' || Object.keys(roleAssignments).length === 0) {
    console.warn('[StrategicEscape] Invalid role assignment payload', { sessionId, roleAssignments });
    return base;
  }

  // Validate all roles are valid
  const validRoles = new Set(['director', 'manager', 'technician', 'observer']);
  for (const [pId, role] of Object.entries(roleAssignments)) {
    if (!validRoles.has(String(role))) {
      console.warn('[StrategicEscape] Invalid role', { sessionId, participantId: pId, role });
      return base;
    }
  }

  // Persist roles to database (secured, not in snapshot)
  try {
    for (const [participantId, roleKey] of Object.entries(roleAssignments)) {
      await query(
        `INSERT INTO strategic_escape_roles 
         (game_session_id, participant_id, role_key, assigned_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (game_session_id, participant_id)
         DO UPDATE SET role_key = EXCLUDED.role_key, assigned_at = NOW()`,
        [sessionId, participantId, roleKey]
      );
    }
    console.log('[StrategicEscape] Roles persisted to database', { 
      sessionId,
      roleCount: Object.keys(roleAssignments).length 
    });
  } catch (err: any) {
    console.error('[StrategicEscape] Failed to save role assignments', { sessionId, error: err?.message });
    throw new AppError('Failed to assign roles. Please try again.', 500);
  }

  // Update state (but don't store actual role assignments in snapshot for privacy)
  return {
    ...base,
    rolesAssigned: true,
    phase: 'roles_assignment',
    gameStatus: 'in_progress',
    // DO NOT store roleAssignments in snapshot - keep them database-only
  };
}
```

#### Step 3: Add Private Role Reveal Handler
Add new socket handler in setupGameHandlers:

```typescript
// Emit private role to participant only (not broadcast)
gamesNs.on('game:request_my_role', async (data: { sessionId: string }, ack) => {
  const validation = gameRoundSchema.safeParse(data);
  if (!validation.success) {
    ack?.({ ok: false, error: 'Invalid session ID' });
    return;
  }

  try {
    const participant = await verifyGameParticipant(data.sessionId, user.userId, rawSocket as any);
    if (!participant) {
      ack?.({ ok: false, error: 'Not a participant' });
      return;
    }

    // Fetch role from database (never from broadcast snapshot)
    const roleRow = await queryOne<{ role_key: string; revealed_at: string | null }>(
      `SELECT role_key, revealed_at FROM strategic_escape_roles
       WHERE game_session_id = $1 AND participant_id = $2`,
      [data.sessionId, participant.participantId]
    );

    if (!roleRow) {
      ack?.({ ok: false, error: 'Roles not assigned yet' });
      return;
    }

    // Only send role to the requesting participant (via their socket, not broadcast)
    // Emit to THIS socket only
    rawSocket.emit('game:my_role', {
      role: roleRow.role_key,
      assignedAt: new Date().toISOString(),
    });

    ack?.({ ok: true });
  } catch (err: any) {
    console.error('[StrategicEscape] Error fetching participant role', err);
    ack?.({ ok: false, error: 'Failed to retrieve role' });
  }
});
```

### Verification
- [ ] Roles are stored in database, not in broadcast snapshot
- [ ] Only participant with matching ID receives their role
- [ ] `game:my_role` event does NOT broadcast to other users
- [ ] Attempt to manually emit game:my_role for different participant fails
- [ ] Role reveal stays hidden until discussion phase

---

## Rollout Plan

### Step 1: Preparation (30 mins)
- [ ] Create database migration
- [ ] Review each fix with team
- [ ] Set up testing environment

### Step 2: Implementation (2 hours)
- [ ] Apply FIX #1 (vote race condition)
- [ ] Apply FIX #2 (late joiner desync)
- [ ] Apply FIX #3 (payload validation)
- [ ] Apply FIX #4 (role security)

### Step 3: Testing (1.5 hours)
- [ ] Run unit tests for each fix
- [ ] Manual testing for each game
- [ ] Load testing with concurrent players

### Step 4: Deployment (30 mins)
- [ ] Run migration
- [ ] Deploy with new handlers
- [ ] Verify in production

### Step 5: Monitoring (Ongoing)
- [ ] Watch error logs for vote failures
- [ ] Monitor game completion rates
- [ ] Check for late joiner issues

---

## Rollback Plan

If critical issues arise:

```bash
# Revert to previous version
git revert <commit-hash>
npm run build
pm2 reload ecosystem.config.cjs

# Downgrade database (if migration was applied)
psql $DATABASE_URL < database/migrations/20250322_rollback.sql
```

---

## Success Criteria

✅ All fixes implemented
✅ No new errors in game handlers
✅ Concurrent actions handled safely (no race conditions)
✅ Late joiners sync correctly
✅ Invalid actions rejected with clear errors
✅ Strategic Escape roles kept secret until revealed
✅ Production deployment successful

---

## Next Steps After Critical Fixes

1. **High Priority (1 week):**
   - Implement unpaired participant UX (Coffee Roulette)
   - Add action audit logging

2. **Medium Priority (2 weeks):**
   - Optimize presenter cycling (Two Truths)
   - Improve topic randomness (Coffee Roulette)
   - Add Strategic Escape progress tracking

3. **Low Priority (1 month):**
   - Batch snapshot persistence
   - Distributed action queue (Redis)
   - Analytics dashboard

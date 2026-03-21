# Session Details 500 Error - Debugging Guide

## ✅ CRITICAL FIX APPLIED - Commit 531d917

**Root Cause Identified:** Missing `users` table JOIN
- **Issue:** All three queries (participants, messages, actions) were trying to access `om.name` and `om.avatar_url`
- **Problem:** The `organization_members` table does NOT have `name` and `avatar_url` columns!
- **Result:** Query execution failed, throwing "unknown column" error → 500 response
- **Solution:** Added `LEFT JOIN users u ON om.user_id = u.id` and updated all COALESCE statements
- **Fixed Queries:** 3 queries in sessionDetails.service.ts
  - Participants query
  - Messages query  
  - Actions query
- **Status:** ✅ FIXED and PUSHED to remote

## Latest Changes
- Added comprehensive error handling with try-catch and console logging
- Controller now logs when fetching starts and completes
- Service logs detailed error info with sessionId and stack traces
- All query parameters are now validated

## If You Still Get 500 Errors

### Step 1: Check Backend Logs
When the error occurs, you should see detailed logs like:
```
[GameSessionsController.getSessionDetails] Fetching details for session: <sessionId>
[SessionDetailsService.getSessionDetails] Error: {
  sessionId: "<sessionId>",
  errorMessage: "...",
  errorStack: "..."
}
```

### Step 2: Identify the Failing Query
The logs will tell you which SQL query is failing. The service has 4 main queries:

1. **Session Details Query** (Line 103-138)
   - Gets basic session info, event details, participant/message/action counts
   - Most likely to fail if: session doesn't exist, event doesn't exist
   
2. **Participants Query** (Line 142-165)
   - Gets all participants in the event with their interaction counts
   - Most likely to fail if: participant data is corrupted, missing JOINs
   
3. **Messages Query** (Line 168-185)
   - Gets all messages sent during the session
   - ✅ Fixed in commit 5f42586 - removed bad game_sessions join
   
4. **Actions Query** (Line 187-202)
   - Gets all game actions taken during the session
   - ✅ Fixed in commit 5f42586 - fixed join condition

### Step 3: Manual Testing

Run these queries directly in your PostgreSQL database to test:

```sql
-- Test 1: Does the session exist?
SELECT id, event_id, status, started_at 
FROM game_sessions 
WHERE id = '<YOUR_SESSION_ID>';
-- Should return exactly 1 row

-- Test 2: Does the event exist?
SELECT id, title 
FROM events 
WHERE id = '<EVENT_ID_FROM_ABOVE>';
-- Should return exactly 1 row

-- Test 3: Participants for the event
SELECT COUNT(*) as participant_count
FROM participants 
WHERE event_id = '<EVENT_ID>';
-- Should return a number >= 0

-- Test 4: Messages for the event
SELECT COUNT(*) as message_count
FROM event_messages 
WHERE event_id = '<EVENT_ID>';
-- Should return a number >= 0

-- Test 5: Actions for the session
SELECT COUNT(*) as action_count
FROM game_actions 
WHERE game_session_id = '<SESSION_ID>';
-- Should return a number >= 0
```

### Step 4: Check Database Schema

Verify these tables and columns exist:
```sql
-- Core tables
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name IN ('game_sessions', 'events', 'participants', 'event_messages', 'game_actions', 'game_rounds', 'organization_members', 'event_profiles')
ORDER BY table_name, ordinal_position;
```

### Step 5: Common Issues & Solutions

#### Issue: "type error: Cannot read property of null"
**Cause:** A JOIN returned NULL when we expected data
**Fix Check:**
- In Participants query: Missing organization_members or event_profiles?
- In Messages query: Missing organization_members or event_profiles?
- In Actions query: Missing game_rounds or organization_members or event_profiles?

**Solution:** Check if LEFT JOINs are needed instead of INNER JOINs

#### Issue: "Aggregation error" or "GROUP BY error"
**Cause:** Column isn't in GROUP BY clause
**Fix Check:**
- In Session Details: All non-aggregated columns must be in GROUP BY
- Currently: gs.id, gs.event_id, e.title, gs.game_type_id, gt.name, gt.key, gs.status, gs.current_round, gs.total_rounds, gs.game_duration_minutes, gs.started_at, gs.ended_at, gs.session_deadline_at, gs.created_at, gs.updated_at

#### Issue: "Unknown column" error
**Cause:** Column name typo or column doesn't exist
**Fix Check:**
- Verify all column names in the error message exist in the database
- Check for case sensitivity issues (PostgreSQL is case-sensitive for quoted names)

### Step 6: Enable Query Logging

In `src/config/database.ts`, add query logging:

```typescript
async function query<T>(sql: string, params: any[] = []): Promise<T[]> {
  try {
    console.log('[DB Query]', { sql, params });
    const result = await pool.query(sql, params);
    return result.rows;
  } catch (error) {
    console.error('[DB Error]', { sql, params, error });
    throw error;
  }
}
```

### Step 7: Test in Isolation

Create a test script `test-session-details.ts`:

```typescript
import { SessionDetailsService } from './src/services/sessionDetails.service';
import { pool } from './src/config/database';

async function test() {
  const sessionId = process.argv[2]; // Pass as: npm run test -- <sessionId>
  
  if (!sessionId) {
    console.error('Usage: npm run test -- <sessionId>');
    process.exit(1);
  }

  try {
    const service = new SessionDetailsService();
    const details = await service.getSessionDetails(sessionId);
    console.log('✅ Success!', JSON.stringify(details, null, 2));
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

test();
```

Then run: `npx ts-node test-session-details.ts <SESSION_ID>`

## Recent Fixes Applied

### Commit 91e0763: Parameter Validation Fix
- **Issue:** Routes used wrong validator (uuidParam instead of sessionIdParam)
- **Impact:** "Validation failed — id: Required" error
- **Fix:** Updated 5 routes to use correct validator

### Commit 5f42586: SQL JOIN Bugs
- **Issue #1:** Messages query joined game_sessions by event_id (matches ALL sessions)
- **Issue #2:** Actions query used wrong join condition: `ga.game_session_id = ep.event_id` (type mismatch)
- **Fix:** Removed bad joins, passed timestamps as parameters

### Commit cd16f77: Frontend Error Handling
- Added detailed error messages in SessionDetailsPanel
- Added retry logic with conditional retries for transient errors
- Added HTTP error logging

### Commit 89cb8d5: Error Handling & Logging (Latest)
- Added try-catch with detailed error logging to service
- Added request logging to controller
- Validates sessionId presence
- All errors logged with full context

## Next Steps if 500 Error Persists

1. **Check the console logs** when calling the endpoint
2. **Copy the exact error message** and error stack
3. **Run the manual SQL tests** to identify which query is failing
4. **Check the database schema** to ensure all columns exist
5. **Run the isolation test** to reproduce the error outside of HTTP
6. **Review the error stack** to see which line is throwing

## Success Indicators

When the fix works, you should see:
1. Frontend: Session details modal shows all data
2. Backend logs: "Successfully fetched details with X participants"
3. No 500 error in response
4. All session data displays: participants, messages, actions, timeline

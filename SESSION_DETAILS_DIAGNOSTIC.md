# Session Details 500 Error - Diagnostic Guide

## Status
🔴 **Issue Still Occurring** - The production database hasn't run migrations yet

## Root Cause Analysis

The session details endpoint is still failing with HTTP 500 because:

### Primary Cause: Missing Database Tables/Columns
The production database doesn't have the required tables that the code is trying to query:

1. **`event_profiles` table** (Migration 22)
   - Used in all 3 sub-queries (participants, messages, actions)
   - If this table doesn't exist, all queries will fail
   - Status: Added to migrations, but NOT YET RUN on production

2. **`organizations.status` and `organizations.ban_reason` columns** (Migration 21)
   - Not directly used in session details, but may affect authentication flow
   - Status: Added to migrations, but NOT YET RUN on production

### Secondary Cause: Migration Lag
- Code was pushed to production with references to tables that don't exist yet
- Migrations are set to auto-run on server startup, but only if:
  - Database connection is successful
  - No existing migrations are blocking
  - The `_migrations` table hasn't already recorded these versions

## Solution Steps

### For Immediate Fix (Next Deployment):

1. **Restart Backend Server**
   - This triggers `runMigrations()` automatically in `src/index.ts`
   - Migrations will create all missing tables

2. **Verify Migrations Ran**
   - Check the `_migrations` table for versions 21, 22, 23
   - Look for log output showing migration execution

3. **Test Session Details**
   - Try loading a game session again
   - Should now work if migrations succeeded

### If Still Failing After Restart:

Check the backend logs for one of these error patterns:

#### Pattern 1: Missing Table Error
```
ERROR: relation "event_profiles" does not exist
```
**Action:** Ensure migration 22 ran successfully

#### Pattern 2: Missing Column Error
```
ERROR: column "status" of relation "organizations" does not exist
```
**Action:** Ensure migration 21 ran successfully

#### Pattern 3: Database Connection Error
```
ERROR: Connection timeout
ERROR: Connection pool exhausted
```
**Action:** Check database connection and pool settings

### Enhanced Logging

The session details service now includes detailed logging at each step:

1. **Starting session fetch**
   ```
   [SessionDetailsService.getSessionDetails] Starting for session: {sessionId}
   ```

2. **Main session details**
   ```
   [SessionDetailsService] Fetching main session details...
   [SessionDetailsService] Main session details fetched successfully
   ```

3. **Participants**
   ```
   [SessionDetailsService] Fetching participants...
   [SessionDetailsService] Participants fetched: {count}
   ```

4. **Messages**
   ```
   [SessionDetailsService] Fetching messages...
   [SessionDetailsService] Messages fetched: {count}
   ```

5. **Actions**
   ```
   [SessionDetailsService] Fetching actions...
   [SessionDetailsService] Actions fetched: {count}
   ```

6. **Errors**
   ```
   [SessionDetailsService.getSessionDetails] Error: {
     sessionId,
     errorMessage,
     errorStack
   }
   ```

This will help identify exactly which query is failing.

## Query Dependency Chain

```
getSessionDetails(sessionId)
  ├── Query 1: Main session details (uses game_sessions, events, game_types, participants, event_messages, game_actions, game_rounds)
  │   └── If fails: Session won't load at all → 404 or missing data
  │
  ├── Query 2: Participants (uses participants, organization_members, users, event_profiles, game_actions, event_messages)
  │   └── If fails: → LEFT JOIN on event_profiles fails → 500 error
  │   └── Log point: "Participants fetched: {count}"
  │
  ├── Query 3: Messages (uses event_messages, participants, organization_members, users, event_profiles)
  │   └── If fails: → LEFT JOIN on event_profiles fails → 500 error
  │   └── Log point: "Messages fetched: {count}"
  │
  └── Query 4: Actions (uses game_actions, participants, game_rounds, organization_members, users, event_profiles)
      └── If fails: → LEFT JOIN on event_profiles fails → 500 error
      └── Log point: "Actions fetched: {count}"
```

**Most likely culprit:** Missing `event_profiles` table

## Fixes Applied

| Commit | Fix | Status |
|--------|-----|--------|
| 4de5ff9 | Added Migration 21 (organizations.status, ban_reason) | ✅ Deployed |
| 042cd58 | Added Migration 22 (event_profiles table) | ✅ Deployed |
| f05c7e2 | Added Migration 23 (bug reporting tables) | ✅ Deployed |
| 9cfcae4 | Fixed SQL JOIN condition in actions query | ✅ Deployed |
| 3cffe6e | Added diagnostic logging to all queries | ✅ Deployed |

## Files to Monitor

When backend logs are available, check:
- `src/services/sessionDetails.service.ts` - Main service with all logging
- `src/config/migrate.ts` - Migration execution logs
- Backend application logs - For SQL error messages

## Next Actions

1. **After next deployment:** Check server logs for migration execution
2. **If migrations succeeded:** Session details should work
3. **If migrations failed:** Look at specific SQL error in logs
4. **If still failing:** Review the log output from each query stage to identify which specific query is breaking

## Prevention

For future issues like this:

1. **Before deploying code that references new tables:**
   - Ensure migrations exist
   - Test migrations locally
   - Verify table creation before code deployment

2. **Use LEFT JOIN for optional tables:**
   - Done in event_profiles usage
   - Allows graceful degradation if table is missing

3. **Add logging at each step:**
   - Done in this fix
   - Makes troubleshooting production issues much easier

4. **Test in staging first:**
   - Run code + migrations on staging
   - Verify session details endpoint works
   - Then promote to production

---

**Last Updated:** March 22, 2026  
**Deployed Commits:** 4de5ff9, 042cd58, f05c7e2, 9cfcae4, 3cffe6e

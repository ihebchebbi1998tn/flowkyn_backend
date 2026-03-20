# Database Queries for Guest Reload Diagnostics

Copy-paste these queries to diagnose the issue.

---

## Query 1: Check If Guest Participant Exists

```sql
-- Check participant table for the guest
SELECT 
  p.id,
  p.event_id,
  p.guest_identity_key,
  p.guest_name,
  p.participant_type,
  p.left_at,
  p.joined_at,
  p.created_at
FROM participants p
WHERE p.event_id = 'be26248b-69f5-40ed-b672-ccf4c31d576f'
  AND p.participant_type = 'guest'
ORDER BY p.joined_at DESC;
```

**Look for**:
- ✅ Guest3 should appear
- ✅ `left_at` should be NULL
- ✅ `guest_identity_key` should have a value (like `3675cd40...`)

---

## Query 2: Check Specific Guest by Identity Key

```sql
-- Find guest by the identity key from browser storage
SELECT 
  p.id,
  p.guest_identity_key,
  p.guest_name,
  p.left_at,
  p.joined_at,
  e.title as event_name
FROM participants p
JOIN events e ON e.id = p.event_id
WHERE p.guest_identity_key = '3675cd40989d4f9194c0e8fba3b9b8d8'
  AND p.participant_type = 'guest';
```

**Replace** `3675cd40989d4f9194c0e8fba3b9b8d8` with the actual identity key from browser storage.

**Look for**:
- ✅ Should return exactly one row
- ✅ `left_at` should be NULL
- ✅ Event name should match

---

## Query 3: Count All Guests in Event

```sql
-- See all guests in the event
SELECT 
  p.id,
  p.guest_name,
  p.participant_type,
  p.left_at,
  CASE 
    WHEN p.left_at IS NULL THEN 'ACTIVE'
    ELSE 'LEFT'
  END as status,
  p.joined_at
FROM participants p
WHERE p.event_id = 'be26248b-69f5-40ed-b672-ccf4c31d576f'
ORDER BY p.created_at DESC;
```

**Look for**:
- Number of active guests (left_at IS NULL)
- Guest3 should be in the list

---

## Query 4: Check Guest's Participant ID

```sql
-- Get the exact participant ID for Guest3
SELECT 
  p.id as participant_id,
  p.guest_name,
  p.guest_identity_key,
  p.event_id
FROM participants p
WHERE p.event_id = 'be26248b-69f5-40ed-b672-ccf4c31d576f'
  AND p.guest_name = 'Guest3'
  AND p.left_at IS NULL
LIMIT 1;
```

**Output should be something like**:
```
participant_id          | guest_name | guest_identity_key                   | event_id
------------------------+------------+--------------------------------------+---
40aa178b-86d3-446c-8fc7-03c3adb8fce2 | Guest3     | 3675cd40989d4f9194c0e8fba3b9b8d8  | be26248b-...
```

---

## Query 5: Check If Participant Was Soft-Deleted

```sql
-- Check if Guest3 has left_at set (soft-deleted)
SELECT 
  p.id,
  p.guest_name,
  p.left_at,
  p.joined_at,
  p.created_at,
  CASE 
    WHEN p.left_at IS NULL THEN 'STILL ACTIVE'
    WHEN p.left_at < NOW() - INTERVAL '1 minute' THEN 'LEFT LONG AGO'
    ELSE 'LEFT RECENTLY'
  END as when_left
FROM participants p
WHERE p.event_id = 'be26248b-69f5-40ed-b672-ccf4c31d576f'
  AND p.guest_name = 'Guest3'
ORDER BY p.created_at DESC;
```

**What it means**:
- `STILL ACTIVE` → Good! Guest should work
- `LEFT RECENTLY` → Someone marked guest as left during reload
- `LEFT LONG AGO` → Guest left earlier (not reload issue)

---

## Query 6: Check Event Details

```sql
-- Verify event exists and is running
SELECT 
  e.id,
  e.title,
  e.status,
  e.created_by_member_id,
  e.created_at,
  COUNT(DISTINCT p.id) as total_participants,
  COUNT(DISTINCT CASE WHEN p.left_at IS NULL THEN p.id END) as active_participants
FROM events e
LEFT JOIN participants p ON p.event_id = e.id
WHERE e.id = 'be26248b-69f5-40ed-b672-ccf4c31d576f'
GROUP BY e.id, e.title, e.status, e.created_by_member_id, e.created_at;
```

**Look for**:
- ✅ Event exists
- ✅ Status is something like 'active' or 'in_progress'
- ✅ Active participants includes your guest

---

## Query 7: Compare Token ParticipantId vs DB ParticipantId

```sql
-- Get the ACTUAL participant ID currently in database
SELECT p.id FROM participants p
WHERE p.event_id = 'be26248b-69f5-40ed-b672-ccf4c31d576f'
  AND p.guest_identity_key = '3675cd40989d4f9194c0e8fba3b9b8d8'
  AND p.participant_type = 'guest'
  AND p.left_at IS NULL;
```

**Compare with**:
- From error message: `userId: "guest:40aa178b-86d3-446c-8fc7-03c3adb8fce2"`
- Extract participantId: `40aa178b-86d3-446c-8fc7-03c3adb8fce2`

**If they match**: Token is correct, recovery should work  
**If they DON'T match**: Token has old participantId, recovery should update it  
**If query returns nothing**: Guest not in database (serious problem)

---

## Query 8: Full Diagnostic Query (Run This First!)

```sql
-- One query that shows everything you need
SELECT 
  'PARTICIPANT' as check_type,
  CASE 
    WHEN p.id IS NULL THEN '❌ NOT FOUND'
    WHEN p.left_at IS NOT NULL THEN '⚠️ SOFT-DELETED'
    ELSE '✅ ACTIVE'
  END as status,
  p.id,
  p.guest_name,
  p.guest_identity_key,
  p.left_at,
  p.joined_at,
  e.title as event_title
FROM (
  SELECT 'be26248b-69f5-40ed-b672-ccf4c31d576f'::uuid as event_id
) x
LEFT JOIN events e ON e.id = x.event_id
LEFT JOIN participants p ON p.event_id = x.event_id 
  AND p.guest_identity_key = '3675cd40989d4f9194c0e8fba3b9b8d8'
  AND p.participant_type = 'guest'
UNION ALL
SELECT 
  'EVENT',
  CASE WHEN e.id IS NULL THEN '❌ NOT FOUND' ELSE '✅ EXISTS' END,
  e.id,
  e.title,
  e.status,
  NULL,
  e.created_at,
  NULL
FROM events e
WHERE e.id = 'be26248b-69f5-40ed-b672-ccf4c31d576f';
```

---

## 🎯 QUICK DIAGNOSIS FLOW

1. **Run Query 8** (Full Diagnostic)
   - See overall status ✓

2. **Run Query 1** (All Guests)
   - Verify Guest3 exists ✓

3. **If Guest3 not found**, run Query 4
   - Find the actual guest record ✓

4. **If left_at is NOT NULL**, investigate why:
   - Run Query 5 (When Left)
   - Check logs for leave events

5. **If everything looks good**, issue is likely:
   - Frontend not sending identity key
   - Token validation issue
   - Recovery logic timing issue

---

## 📋 SAMPLE OUTPUT SCENARIOS

### Scenario A: ✅ Everything Good
```
Event: EXISTS ✅
Participant: ACTIVE ✅
left_at: NULL
guest_identity_key: 3675cd40989d4f9194c0e8fba3b9b8d8
```
→ Database is fine, issue is elsewhere

### Scenario B: ⚠️ Participant Soft-Deleted
```
Event: EXISTS ✅
Participant: SOFT-DELETED ⚠️
left_at: 2026-03-20 20:47:00
guest_identity_key: 3675cd40989d4f9194c0e8fba3b9b8d8
```
→ Guest was marked as left, check join logic

### Scenario C: ❌ Participant Not Found
```
Event: EXISTS ✅
Participant: NOT FOUND ❌
```
→ Guest never inserted into DB, check POST endpoint

---

## 🔗 Related Files

- Frontend token storage: `src/lib/guestTokenPersistence.ts`
- Guest join endpoint: `src/controllers/events.controller.ts` (joinAsGuest)
- Guest join service: `src/services/events-invitations.service.ts` (joinAsGuest)
- Socket verification: `src/socket/eventHandlers.ts` (verifyParticipant)
- Game verification: `src/socket/gameHandlers.ts` (verifyGameParticipant)

---

## 💡 TIPS

1. **Save query results** as you run them
2. **Compare participantId** from error vs from database
3. **Check timestamps** - when was guest joined vs when did error happen
4. **Look for patterns** - does it happen to ALL guests or just one?

---

## 🎓 COMMON FINDINGS

| Finding | Cause | Fix |
|---------|-------|-----|
| Participant NOT in DB | Guest never inserted | Check join endpoint |
| Participant left_at IS NOT NULL | Guest marked as left | Check leave logic |
| Identity key mismatch | Token/storage mismatch | Frontend bug in persistence |
| All data looks good | Recovery should work | Check backend logs |


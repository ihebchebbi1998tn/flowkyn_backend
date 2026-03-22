# ⚡ Quick Start: Next Sprint (4-Hour Implementation Plan)

## 🎯 Sprint Overview

**Timeframe:** 4 hours  
**Issues:** 4 High-Priority  
**Files Modified:** 4 main files  
**Breaking Changes:** 0  
**Difficulty:** Medium  

---

## 📋 Pre-Sprint Checklist (5 minutes)

- [ ] Read `SPRINT_PRIORITIES_VISUAL.txt` (overview)
- [ ] Read `NEXT_SPRINT_PRIORITIES.md` (detailed specs)
- [ ] Create branch: `git checkout -b feature/high-priority-fixes`
- [ ] Pull latest: `git pull origin main`
- [ ] Open `src/socket/gameHandlers.ts` in editor
- [ ] Terminal ready: `cd flowkyn_backend`

---

## ⏱️ Time-Boxed Implementation Schedule

### Phase 1: Setup (5 min) - 00:00-00:05
- [ ] Create branch and pull latest
- [ ] Open all necessary files
- [ ] Have migration SQL ready

### Phase 2: Issue #4 (Audit Trail) (35 min) - 00:05-00:40
**This creates the foundation for the other fixes**

Steps:
1. [ ] Create `audit_logs` table (5 min)
   ```sql
   CREATE TABLE IF NOT EXISTS audit_logs (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     event_id uuid NOT NULL,
     game_session_id uuid REFERENCES game_sessions(id),
     participant_id uuid REFERENCES participants(id),
     user_id uuid REFERENCES users(id),
     action varchar(100) NOT NULL,
     details jsonb,
     ip_address inet,
     status varchar(20) DEFAULT 'success',
     created_at timestamp DEFAULT NOW(),
     INDEX (game_session_id),
     INDEX (action)
   );
   ```

2. [ ] Add vote success logging (8 min)
   - Find: Two Truths vote handler (around line 407-445)
   - Add logging after successful vote insert

3. [ ] Add vote failure logging (10 min)
   - In catch block, log failed vote with error details

4. [ ] Create admin endpoint (10 min)
   - File: `src/controllers/auditLogs.ts` (new)
   - Endpoint: `GET /api/admin/games/:id/audit-logs`

5. [ ] Test locally (2 min)
   - Cast a vote, check database
   - Query audit endpoint

### Phase 3: Issue #2 (Role Security) (70 min) - 00:40-01:50

**Most critical security issue**

Steps:
1. [ ] Create `strategic_escape_roles` table (5 min)
2. [ ] Add permission check (10 min)
   - Only host/admin can assign roles
   - Emit error if non-host tries
3. [ ] Add Zod validation schema (10 min)
4. [ ] Implement role storage (15 min)
5. [ ] Private role reveal (15 min)
6. [ ] Add audit logging (10 min)
7. [ ] Test all scenarios (5 min)

### Phase 4: Issue #1 (Unpaired UX) (50 min) - 01:50-02:40

**Frontend improvement**

Steps:
1. [ ] Update game state type (5 min)
   - Add `unpairedParticipantIds?: string[]`
2. [ ] Update socket emitter (5 min)
   - Include unpaired IDs in game:snapshot
3. [ ] Create frontend alert component (25 min)
   - Show when user is unpaired
   - Display "waiting for next round" message
4. [ ] Test with odd participants (10 min)
5. [ ] Update types/documentation (5 min)

### Phase 5: Issue #3 (Null Safety) (50 min) - 02:40-03:30

**Refactoring pass**

Steps:
1. [ ] Add session validation (10 min)
   - Every game:action validates session exists
2. [ ] Update Two Truths reducer (15 min)
   - Consistent null safety for totalRounds
3. [ ] Add Zod state schema (10 min)
4. [ ] Apply to other games (10 min)
5. [ ] Test boundary conditions (5 min)

### Phase 6: Final Review (30 min) - 03:30-04:00

- [ ] TypeScript compilation: `npx tsc --noEmit`
- [ ] Run tests: `npm test`
- [ ] Code review of all changes
- [ ] Verify no console errors
- [ ] Check database migrations
- [ ] Prepare commit message

---

## 🔧 Implementation Quick Reference

### File 1: src/socket/gameHandlers.ts
**Changes needed across:**
- Lines 164-248: Validation schemas (already exist from previous sprint)
- Lines 407-445: Vote handler → Add audit logging
- Lines 769-850: Strategic roles → Add permission check + validation + storage
- Lines 1253-1283: Late joiner → Update emitter with unpaired IDs
- Throughout: Update totalRounds null safety

### File 2: src/pages/GamePlay.tsx (or game modal)
**Changes needed:**
- Add unpaired participant alert
- Show when `unpairedParticipantIds?.includes(currentUserId)`
- Display round/estimated pairing time

### File 3: src/controllers/auditLogs.ts (NEW)
**Create new file for:**
- Admin endpoint to query audit logs
- Filter by game_session_id, action, status
- Return vote history with breakdown

### File 4: src/socket/auditHandlers.ts (NEW)
**Create new file for:**
- Logging utility functions
- Centralized audit logging helpers
- Used by other handlers

---

## 🧪 Testing Checklist

### Issue #1 (Unpaired UX)
- [ ] Join game with even number → all paired
- [ ] Add 1 more participant → new one sees "unpaired" message
- [ ] Wait for next round → message disappears
- [ ] Check no console errors

### Issue #2 (Role Security)
- [ ] Non-host tries to assign roles → permission error
- [ ] Host assigns invalid roles (missing role) → validation error
- [ ] Host assigns valid roles → each participant gets private message
- [ ] Check roles in database, not in snapshot
- [ ] Verify audit log has role assignment entry

### Issue #3 (Null Safety)
- [ ] Create game with totalRounds=2
- [ ] Advance through 2 rounds → phase transitions to 'results'
- [ ] Check logs for no undefined warnings
- [ ] Verify state schema passes all validations

### Issue #4 (Audit Trail)
- [ ] Cast vote → new entry in audit_logs
- [ ] Simulate vote failure → error entry logged
- [ ] Query admin endpoint → see vote history
- [ ] Verify IP address and timestamp captured

---

## 🐛 Common Pitfalls & Solutions

| Issue | Solution |
|-------|----------|
| TypeScript errors on audit schema | Use `jsonb` for details column, cast properly |
| Permission check not working | Remember to check `socket.data.userId` |
| Frontend not receiving unpaired IDs | Emit in correct socket event, check namespace |
| Null safety still triggering | Add fallback in reducer initialization |
| Audit logging slowing game down | Use async logging, don't await |

---

## 📊 Progress Tracking

Use this to track your progress:

```
Sprint Start: ___________  (HH:MM)
Phase 1 Done: ___________  (5 min elapsed)
Phase 2 Done: ___________  (40 min elapsed)
Phase 3 Done: ___________  (110 min elapsed)
Phase 4 Done: ___________  (160 min elapsed)
Phase 5 Done: ___________  (210 min elapsed)
Phase 6 Done: ___________  (240 min elapsed)
Sprint End:   ___________  (TOTAL TIME)
```

---

## ✅ Sprint Completion Checklist

- [ ] All 4 issues implemented
- [ ] TypeScript compilation passes
- [ ] No console errors in logs
- [ ] All tests pass
- [ ] Manual testing complete
- [ ] Code reviewed
- [ ] Migration created (if needed)
- [ ] Commit message clear and detailed
- [ ] PR created with description
- [ ] Documentation updated

---

## 🚀 Deployment Readiness

When sprint is done:

```bash
# Verify everything
npm run build
npm test

# Create commit
git add .
git commit -m "feat: implement high-priority fixes (unpaired UX, role security, null safety, audit trail)"

# Push and create PR
git push origin feature/high-priority-fixes
```

---

## 📚 Resources

- **Detailed Specs:** `NEXT_SPRINT_PRIORITIES.md`
- **Visual Summary:** `SPRINT_PRIORITIES_VISUAL.txt`
- **Code Examples:** See detailed specs for each issue
- **Previous Work:** `CODE_CHANGES_VISUAL_SUMMARY.md`
- **Database:** `database/schema.sql`

---

## 💡 Pro Tips

1. **Start with Issue #4** - Creates foundation, simplest implementation
2. **Test after each issue** - Don't wait until the end
3. **TypeScript early** - Run `npx tsc --noEmit` after Issue #2
4. **Commit often** - After each issue is working
5. **Take breaks** - 4 hours is a sprint, pace yourself
6. **Ask for help** - These are guidelines, not gospel

---

## 🎯 Success Criteria

After 4 hours, you should have:

✅ Audit trail logging for all votes  
✅ Role security hardened with permissions  
✅ Unpaired participants get UX feedback  
✅ Null safety for totalRounds throughout  
✅ Zero breaking changes  
✅ All tests passing  
✅ Ready for staging deployment  

---

**Ready?** Open `NEXT_SPRINT_PRIORITIES.md` and start with Issue #4! 🚀

*Last Updated: March 22, 2026*

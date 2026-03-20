# ✅ READY TO DEPLOY - CHECKLIST

---

## 🎯 PRE-DEPLOYMENT CHECKLIST

- [ ] Read `DEPLOYMENT_READY.md`
- [ ] Verified code compiles (`npm run build` succeeds)
- [ ] Backend terminal ready
- [ ] Logs terminal ready
- [ ] Browser ready to test

---

## 🚀 DEPLOYMENT STEPS

### Terminal 1: Build & Start
```bash
cd c:\Users\ihebc\OneDrive\Desktop\fullapp\flowkyn_backend
npm run build
npm start
```
**Wait for**: `Server running on port 3000` or similar ✓

### Terminal 2: Watch Logs
```bash
tail -f logs/server.log | grep -E "Guest socket|verification|recovery"
```
**Or simply**:
```bash
tail -f logs/server.log
```

### Browser: Test Guest Reload
1. Open event page
2. Join as guest
3. Press F5
4. Watch Terminal 2 for logs

---

## 📊 LOGS CHECKLIST

Look for these patterns in Terminal 2:

### ✅ Pattern 1: Direct Success
```
[Events] Guest socket detected
[Events] Direct participant verification SUCCESS
```
- [ ] Do you see these logs?
- [ ] Can guest send chat? Yes/No
- [ ] Any FORBIDDEN errors? Yes/No

### ✅ Pattern 2: Recovery Works
```
[Events] Guest socket detected
[Events] Direct participant verification FAILED
[Events] Fallback recovery SUCCESS
```
- [ ] Do you see these logs?
- [ ] Can guest send chat? Yes/No
- [ ] Any FORBIDDEN errors? Yes/No

### 🔴 Pattern 3: Both Failed
```
[Events] Guest socket detected
[Events] Direct participant verification FAILED
[Events] Fallback recovery FAILED
```
- [ ] Do you see these logs?
- [ ] Can guest send chat? Yes/No
- [ ] What was the error message?

---

## 🎯 SUCCESS CRITERIA

All of the following must be true:

- [ ] Guest can join event
- [ ] Guest can reload page (F5)
- [ ] Logs show recovery attempt
- [ ] Guest does NOT get FORBIDDEN
- [ ] Guest can see other participants
- [ ] Guest can send chat message
- [ ] Guest can see game updates (if in game)
- [ ] No errors in browser console (F12)

**All ✅ → ISSUE IS FIXED**

---

## 🆘 IF LOGS SHOW "FAILED"

Run this SQL in database terminal:

```sql
SELECT p.id, p.guest_name, p.guest_identity_key, p.left_at, p.joined_at
FROM participants p
WHERE p.event_id = 'be26248b-69f5-40ed-b672-ccf4c31d576f'
AND p.participant_type = 'guest'
ORDER BY p.joined_at DESC;
```

Check:
- [ ] Do you see Guest3 in the list?
- [ ] Is `left_at` NULL or a timestamp?
- [ ] Does `guest_identity_key` have a value?

---

## 📋 DATA TO COLLECT

If logs show SUCCESS:
- [ ] Copy the log message
- [ ] Screenshot showing no FORBIDDEN

If logs show FAILED:
- [ ] Copy the log message
- [ ] SQL query result
- [ ] Browser console screenshot
- [ ] Guest name you used
- [ ] Event ID

---

## 📞 SUPPORT TEMPLATE

If you need help, provide:

```
# Coffee Roulette Guest Reload Issue

## Logs
[Paste the recovery logs here]

## Database Query Result
[Paste SQL results here]

## Browser State
[Screenshot of storage or console]

## Observations
- Guest can/cannot join: 
- Guest can/cannot reload: 
- Error message: 
```

---

## ✨ NEXT STEPS

### If SUCCESS (Pattern 1 or 2):
✅ Issue is resolved!
- Guest can reload without FORBIDDEN
- No further action needed
- Celebrate! 🎉

### If FAILED (Pattern 3):
1. Run SQL query above
2. Collect logs + SQL results
3. Share with support
4. Get Phase 2 fix

---

## ⏱️ TIMELINE

| Time | Action | Status |
|------|--------|--------|
| 0:00 | Read instructions | - |
| 0:02 | Deploy code | Start Terminal 1 |
| 0:04 | Start logs | Start Terminal 2 |
| 0:05 | Test reload | Browser action |
| 0:10 | Check results | Verify in Terminal 2 |
| **Total** | **10 minutes** | Complete |

---

## 🎓 WHAT TO LOOK FOR

### In Terminal 2 (Logs)

Search for text: `Guest socket`

- **Found?** → Logging is working ✓
- **Not found?** → Try: `tail -f logs/server.log` (all logs)

Look for text: `SUCCESS`

- **Found?** → Guest recovery working ✅
- **Not found?** → Guest recovery failing 🔴

Look for text: `FAILED`

- **Found?** → Check database ↓
- **Not found?** → Issue may be elsewhere

---

## 🔍 FINAL VERIFICATION

Before declaring success:

- [ ] Guest joins event initially ✓
- [ ] Guest sees other participants ✓
- [ ] Guest presses F5 (reload) ✓
- [ ] Socket reconnects ✓
- [ ] Logs show recovery attempt ✓
- [ ] Guest gets SUCCESS (or recovery SUCCESS) ✓
- [ ] No FORBIDDEN in browser console ✓
- [ ] Guest can send chat message ✓
- [ ] Chat message appears to others ✓
- [ ] No errors in game display ✓

**All checked? ISSUE IS FIXED** ✅

---

## 💾 SAVE THESE COMMANDS

```bash
# Watch logs while testing
tail -f logs/server.log | grep "Guest socket"

# See full logs
tail -f logs/server.log

# Check last 100 lines
tail -100 logs/server.log

# Save logs to file
tail -100 logs/server.log > guest_reload_logs.txt

# Check Node processes
ps aux | grep node
```

---

## 🎯 QUICK REFERENCE

| Need | Command |
|------|---------|
| Start server | `npm start` |
| Build code | `npm run build` |
| Watch logs | `tail -f logs/server.log` |
| Filter logs | `grep "Guest socket" logs/server.log` |
| Save logs | `tail -100 logs/server.log > logs.txt` |
| Kill server | Ctrl+C |

---

## 📱 BROWSER CHECKS

Open DevTools (F12) and:

1. **Console tab**: Look for errors
2. **Storage tab**: Check guest_token and guest_identity_key
3. **Network tab**: Check WebSocket status

---

## 🎉 YOU'RE READY!

Everything is set up.  
All docs are in place.  
Time to deploy!

**Go**: Terminal 1, run: `npm run build && npm start` 🚀


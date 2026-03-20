# ☕ IMMEDIATE ACTION STEPS

**Print this out and follow exactly**

---

## ✅ STEP 1: Deploy Backend (2 minutes)

Open terminal and run:
```bash
cd c:\Users\ihebc\OneDrive\Desktop\fullapp\flowkyn_backend
npm run build
npm start
```

Wait for: `Server running on port 3000` or similar ✓

---

## 📊 STEP 2: Watch Logs (In Another Terminal)

```bash
# Windows PowerShell
Get-Content -Path .\logs\server.log -Tail 20 -Wait | Select-String -Pattern "recovery|Guest socket|verification"
```

Or if you have `tail` installed:
```bash
tail -f logs/server.log | grep -E "recovery|Guest socket|verification"
```

---

## 🧪 STEP 3: Reproduce the Issue

1. **Open browser** and go to your event page
2. **Join as guest** (Guest3 or whichever guest)
3. **Open DevTools** (F12) → Console tab
4. **Reload page** (F5)
5. **Watch terminal** for recovery logs

---

## 🔍 STEP 4: Check What You See

### ✅ If you see this:
```
[Events] Guest socket detected, attempting verification
[Events] Direct participant verification SUCCESS
[Events] Fallback recovery SUCCESS
```
→ **ISSUE IS FIXED!** Guest can now reload ✓

### ❌ If you see this:
```
[Events] Guest socket detected, attempting verification
[Events] Direct participant verification FAILED
[Events] Fallback recovery FAILED
```
→ **Need to investigate** (see "Troubleshooting" below)

---

## 🚨 TROUBLESHOOTING

### Problem 1: See "Direct verification FAILED" + "Fallback recovery FAILED"

Check database:
```sql
SELECT p.id, p.guest_name, p.guest_identity_key, p.left_at
FROM participants p
WHERE p.event_id = 'be26248b-69f5-40ed-b672-ccf4c31d576f'
ORDER BY p.joined_at DESC;
```

**If you DON'T see Guest3**:
- Guest was never inserted into database
- Check POST endpoint that creates guest

**If you see Guest3 BUT `left_at IS NOT NULL`**:
- Guest was marked as left
- Need to check why guest left logic is triggering

**If you see Guest3 with `left_at IS NULL`**:
- Database has the record
- Identity key mismatch issue
- Run: `SELECT guest_identity_key FROM participants WHERE id = 'guest-uuid'`
- Compare with browser storage: `localStorage.getItem('guest_identity_key_be26248b...')`

---

## 📱 STEP 5: Browser Check

In browser console, paste:
```javascript
const eventId = 'be26248b-69f5-40ed-b672-ccf4c31d576f';
console.log({
  guestToken: !!localStorage.getItem(`guest_token_${eventId}`),
  identityKey: localStorage.getItem(`guest_identity_key_${eventId}`),
});
```

Should show:
```
{
  guestToken: true,
  identityKey: "3675cd40-..."  ← Long UUID
}
```

If `identityKey: null` → Frontend not storing the key!

---

## ✨ SUCCESS CRITERIA

After all steps, guest should be able to:

- [ ] Join event → No error ✓
- [ ] Reload page → No FORBIDDEN ✓
- [ ] See other participants ✓
- [ ] Send chat message ✓
- [ ] See game updates (if in game) ✓
- [ ] No "Not a participant" errors ✓

---

## 📋 DATA TO SAVE

Before closing, save this data (may need for support):

1. **Server logs** from reload moment:
   ```bash
   # Save last 100 lines
   Get-Content -Path .\logs\server.log -Tail 100 > logs_backup.txt
   ```

2. **Database state**:
   ```sql
   -- Run and save output
   SELECT p.id, p.guest_name, p.guest_identity_key, p.left_at, p.joined_at
   FROM participants p
   WHERE p.event_id = 'be26248b-69f5-40ed-b672-ccf4c31d576f'
   ORDER BY p.created_at DESC;
   ```

3. **Browser storage**:
   - F12 → Storage → Local Storage
   - Screenshot showing `guest_token_*` and `guest_identity_key_*` entries

---

## 🎯 EXPECTED TIMELINE

- Deploy: 2 minutes
- Setup logs: 1 minute
- Reproduce issue: 2 minutes
- See logs: 10 seconds
- **Total: 5 minutes to diagnosis** ✓

---

## ⚠️ IF SOMETHING BREAKS

1. **Kill backend**: Ctrl+C in terminal
2. **Check git status**: `git status`
3. **Revert if needed**: `git restore src/socket/eventHandlers.ts src/socket/gameHandlers.ts`
4. **Restart**: `npm start`

(The changes are just logging, shouldn't break anything)

---

## 📞 NEXT STEPS

After you run the test:

1. **Tell me what you see in logs**
   - Copy the recovery messages exactly
   - Or screenshot them

2. **Tell me if FORBIDDEN errors are gone**
   - Yes? → Issue fixed ✓
   - No? → Send me the logs

3. **Share database state**
   - Run the SQL query above
   - Show me participant records

Then I can tell you if issue is fully resolved or if next fix is needed.

---

## 🎓 WHAT CHANGED

- **File 1**: `src/socket/eventHandlers.ts` - Added diagnostic logs
- **File 2**: `src/socket/gameHandlers.ts` - Added diagnostic logs

**Nothing else changed** - same recovery logic, just now visible.

---

**Done?** Reply with what you see in the logs! 👀


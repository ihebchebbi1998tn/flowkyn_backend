# Deep Analysis: Games, Chat & Sync — Identity & Matching

This document analyzes the full architecture for games, chat, voice, and matching across all game types. It answers: **Should we introduce "guest login" so all users have a stable ID for events/games?** and proposes the optimal solution.

---

## 1. Current Architecture Overview

### Identity Model

| User Type | Identity Source | How participantId is obtained |
|-----------|-----------------|-------------------------------|
| **Authenticated** | JWT `access_token` (userId) | DB: `participants` table via `organization_member_id` → `user_id` |
| **Guest** | JWT `guest_token` (participantId, eventId, guestName) | Created on `POST /events/:id/join-guest`, stored in `localStorage.guest_token_${eventId}` |

### Flow Summary

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ENTRY POINTS                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│ EventLobby / GamePlay                                                        │
│   ├─ Member: joinEvent() or acceptInvitation() → participant created/found   │
│   └─ Guest:  joinAsGuest() → participant created, guest_token returned       │
│              → localStorage.setItem('guest_token_${eventId}', token)         │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        SOCKET CONNECTIONS (2 separate namespaces)            │
├─────────────────────────────────────────────────────────────────────────────┤
│ /events namespace          │  /games namespace                               │
│ • Auth: same token         │  • Auth: same token                             │
│ • event:join → room        │  • game:join → room + voiceSocketByKey          │
│ • chat:message             │  • game:action, game:data broadcasts            │
│ • Receives: event:notification (game:session_created, participant:joined)   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        BACKEND IDENTITY RESOLUTION                           │
├─────────────────────────────────────────────────────────────────────────────┤
│ verifyParticipant(eventId, userId, socket)     [events namespace]            │
│   • Guest: socket.guestPayload.participantId → DB lookup                     │
│   • Member: userId → organization_members → participants                     │
│   • Auto-insert: org member who bypassed lobby → create participant          │
│                                                                              │
│ verifyGameParticipant(sessionId, userId, socket) [games namespace]           │
│   • Guest: socket.guestPayload.participantId → must be in session's event    │
│   • Member: userId → participants JOIN game_sessions                         │
│   • Auto-insert: org member → create participant for event                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Game Types & Participant Usage

| Game | Sync Mode | Uses participantId for | Pairing Logic |
|------|-----------|------------------------|---------------|
| **Coffee Roulette** | sync | Pairs (person1, person2), voice (partner lookup), topics | Backend: `participants WHERE event_id AND left_at IS NULL` → shuffle → pairs |
| **Two Truths** | sync | Votes, presenter, round state | Single session, no 1:1 pairs |
| **Wins of Week** | async | Posts, reactions | No real-time pairing |
| **Strategic Escape** | async | Role assignment | No real-time pairing |
| **Chat** | — | Sender identity, room = event | All in `event:${eventId}` |

---

## 2. Where Things Go Wrong

### A. Identity Fragmentation (Guest-Specific)

**Scenario:** Same physical person, two browsers or incognito tabs.

- **Browser 1:** joinAsGuest → participantId `A`, token in localStorage
- **Browser 2 (incognito):** joinAsGuest → participantId `B` (new), new token
- **Result:** Two participant records for "same" person. Coffee Roulette sees 2 people, can pair them. Chat shows 2 different senders. Voice: they’re different participants, so partner lookup works if they’re in the same pair. **This is actually correct behavior** — they’re treated as two distinct participants.

**Scenario:** Same browser, tab refresh before token in localStorage.

- Guest token lost → must re-join → NEW participantId
- Old participantId still in DB, new one created
- **Result:** "Duplicate" participant for same device. Can cause confusion.

### B. Timing & Room Join Order

**Scenario:** User B misses `game:session_created` or joins late.

1. User A creates session → backend emits `game:session_created` to `event:${eventId}`
2. User B must be in event room to receive it
3. User B gets sessionId from: (a) socket event, or (b) polling `getActiveSession` every 2–5s
4. Once sessionId is set, `game:join` runs
5. Only after `game:join` is User B in `game:${sessionId}` and in `voiceSocketByKey`

**Fixes already applied:**
- Session polling: 5s → 2s
- Any paired participant can emit `coffee:start_chat`
- First click creates session AND emits action
- Faster periodic state sync (8s → 4s)
- Stale watchdog (9s → 6s)
- `setInitialSnapshot` on `game:data` for consistency

### C. State Sync & Revision Logic

**Scenario:** User B receives `game:data` but rejects it as "stale."

- Backend sends `snapshotCreatedAt` (timestamp)
- Frontend compares with `lastSnapshotRevisionTimeRef`
- If server timestamp is missing or in wrong format, `parseRevisionTime` returns 0 → can reject valid updates

**Fixes already applied:**
- `parseRevisionTime` handles Date, number, string
- Backend `toSnapshotCreatedAt()` normalizes timestamps to ISO strings

### D. Incognito & Storage

- Incognito: isolated localStorage and cookies
- Each incognito window = fresh storage
- Token not shared across incognito sessions
- **Conclusion:** Incognito will always create new guest identity per window. This is expected.

---

## 3. Is "Guest Login" the Solution?

### What "Guest Login" Could Mean

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **A. Email/phone required** | Guest must enter email to get persistent ID | One identity per person across devices | Friction, privacy concerns |
| **B. Device fingerprint** | Browser fingerprint + optional recovery | No extra input | Unreliable, privacy issues |
| **C. Cookie backup** | Store participantId in httpOnly cookie | Same-browser persistence across tabs | Doesn’t help incognito or cross-device |

### Assessment

**The main sync problems are not from identity fragmentation.**

1. **"Finding your match" vs chat:** User B not receiving phase update → timing/room join and state sync. **Fixed by prior sync improvements.**
2. **Topics not synced:** Same cause — `game:data` not applied on one client. **Fixed.**
3. **Voice not connecting:** Partner socket not in `voiceSocketByKey` (late `game:join`) or wrong pair. **Mitigated by faster session discovery and sync.**

**Identity fragmentation** mainly matters when:
- Same person uses two browsers without logging in → treated as two participants (acceptable)
- Same browser loses token (e.g. clearing storage) → must re-join, gets new participant (acceptable)

**Recommendation: Do NOT add mandatory "guest login" (email/phone).**

- Adds friction
- Current model works when: one device = one token = one participant
- Sync issues are primarily timing/state, not identity

---

## 4. Optional: Lightweight Guest Persistence

If you want better persistence for same browser:

### Cookie Backup (Optional)

1. On first guest join: set `flowkyn_guest_${eventId}` cookie with `participantId` (httpOnly, secure, 7d).
2. On load: if no `guest_token_${eventId}` in localStorage but cookie exists, call new endpoint `POST /events/:id/restore-guest` with cookie value → return new guest_token for that participant.
3. Store token in localStorage and proceed as normal.

**Effect:** Tab close / refresh with cookie still present → can restore session without re-join. Does not help incognito or cross-device.

---

## 5. Perfect Solution Checklist

### Already Implemented

1. ✅ **Unified participant resolution** — `verifyParticipant` and `verifyGameParticipant` use same source (guest token or user)
2. ✅ **Guest token idempotency** — Valid token in join request returns existing participant
3. ✅ **Faster session discovery** — Polling 2s, `game:session_created` on create
4. ✅ **Any paired participant can start chat** — No single point of failure
5. ✅ **First-click creates + executes** — Session creation and first action in one step
6. ✅ **Aggressive state sync** — 4s periodic, 6s stale watchdog, follow-up on chatting
7. ✅ **Timestamp normalization** — Backend sends ISO strings; frontend parses robustly
8. ✅ **setInitialSnapshot on game:data** — Keeps snapshot sources consistent

### Recommended (No Code Changes Required)

1. **Test with two normal browsers** — Avoid incognito when validating sync; use different display names for the two participants.
2. **Ensure both join event first** — Both must complete `event:join` (and thus have `participantId`) before game flows.
3. **Stable network** — Flaky connections can delay room join and broadcasts.

### Optional Enhancements

1. **Cookie backup for guest token** — Improves same-browser recovery (see §4).
2. **Explicit "reconnecting" state** — Show UI when socket is reconnecting so users don’t think the app is stuck.
3. **Session polling with gameKey** — Pass `game_key=coffee-roulette` when resolving session for Coffee Roulette to avoid cross-game mix-ups (only relevant if multiple game types can be active).

---

## 6. Summary

| Question | Answer |
|----------|--------|
| **Do we need "guest login" for matching/chat/voice to work?** | No. Sync issues come from timing and state propagation, not identity. |
| **Will guests always have an ID for events/games?** | Yes. `joinAsGuest` creates a participant and returns a guest token with `participantId`. Same browser keeps the same ID via localStorage. |
| **Why does incognito cause problems?** | Isolated storage → new participant per incognito window. Use normal browsers for reliable testing. |
| **What’s the main fix for sync?** | Faster discovery, any-participant start, and stronger state sync. These are already in place. |

**Bottom line:** The architecture is sound. The recent fixes target the real causes (timing and state sync). Guest login is not required for correct matching, chat, and voice; optional cookie backup can improve same-browser persistence if desired.

# Voice Call Modal Implementation for Coffee Roulette

## Overview
Implemented a comprehensive voice call modal system that ensures both participants see modals and can coordinate voice chat initiation in Coffee Roulette.

## Architecture

### Backend Changes (`src/socket/gameHandlers.ts`)

Added two new Socket.io event handlers:

#### 1. `coffee:voice_call_request`
When a participant clicks "Open Voice", this handler:
- Verifies both participants are in an active coffee chat pair
- Emits a **confirmation modal** to the initiator with partner info
- Emits an **incoming call modal** to the partner (if connected)
- Logs the request for debugging

**Data Flow:**
```
Client clicks "Open Voice Call"
    ↓
Emits: coffee:voice_call_request
    ↓
Backend verifies pair + session
    ↓
Emits: coffee:voice_call_modal (type: 'initiator') → Initiator socket
Emits: coffee:voice_call_modal (type: 'receiver') → Partner socket
```

#### 2. `coffee:voice_call_response`
When a participant responds to the modal, this handler:
- Verifies the responder is in the correct pair
- If accepted: Emits `coffee:voice_call_accepted` to both sides
- If declined: Emits `coffee:voice_call_declined` to both sides
- Auto-closes modals on both clients

**Data Flow:**
```
Partner clicks Accept/Decline
    ↓
Emits: coffee:voice_call_response { accepted: true/false }
    ↓
Backend verifies pair
    ↓
If accepted:
  Emits: coffee:voice_call_accepted → Both clients
  Frontend auto-closes both modals + starts voice
    
If declined:
  Emits: coffee:voice_call_declined → Both clients
  Frontend auto-closes both modals
```

### Frontend Changes

#### Component: `VoiceCallModal.tsx`
New modal component handling two variants:

**Initiator Variant:**
- Shows partner's avatar and name
- Message: "Ready to start a voice call?"
- Button states:
  - "Open Voice" (waiting for partner response)
  - Shows spinner + "Waiting for response" during negotiation
- Auto-closes when `coffee:voice_call_accepted` or `coffee:voice_call_declined` received
- Never auto-declines (unlike receiver)

**Receiver Variant:**
- Shows initiator's avatar and name
- Message: "wants to start a voice call with you"
- Button states:
  - "Decline" (red) and "Accept" (green) buttons
  - Both buttons disabled during submission
- Auto-declines after 30 seconds of inactivity
- Shows timeout warning at 25 seconds
- Visually distinct styling (green border for incoming call vibe)

#### Integration: `MeetingRoom.tsx`
Updated to:
1. Import and render `<VoiceCallModal>`
2. Manage modal state: `isVoiceCallModalOpen` and `voiceCallModalData`
3. Add Socket.io listeners for three events:
   - `coffee:voice_call_modal` → Opens modal with correct data
   - `coffee:voice_call_accepted` → Closes modal, starts voice
   - `coffee:voice_call_declined` → Closes modal silently
4. Replace direct `startVoice()` call with modal request flow:
   ```typescript
   // OLD: onClick={() => await startVoice()}
   
   // NEW: onclick={() => {
   //   gamesSocket.emit('coffee:voice_call_request', {
   //     sessionId, pairId
   //   });
   //   // Show initiator modal with partner info
   // }}
   ```

## User Flow

### Scenario: Initiator Opens Voice Call

1. **Initiator clicks "Open Voice Call"** button
2. Frontend emits `coffee:voice_call_request` to backend
3. Backend validates pair and sends modals:
   - Initiator receives: `coffee:voice_call_modal` (type: 'initiator')
   - Partner receives: `coffee:voice_call_modal` (type: 'receiver')
4. **Modals appear on both sides simultaneously**
5. **Partner sees incoming call modal** with Decline/Accept buttons
   - Timeout: Auto-declines after 30 seconds
   - Warning: Shows "5 seconds left" at 25 seconds
6. **Partner clicks Accept**
7. Backend emits `coffee:voice_call_accepted` to both
8. **Both modals close automatically**
9. Frontend automatically calls `startVoice()` for WebRTC negotiation

### Scenario: Partner Declines

1-5. Same as above
6. **Partner clicks Decline**
7. Backend emits `coffee:voice_call_declined` to both
8. **Both modals close silently**
9. **No voice connection attempt**
10. Users can try again by repeating step 1

## Event Specifications

### `coffee:voice_call_modal`
Emitted by backend to client when modal should open.

**Payload:**
```typescript
{
  type: 'initiator' | 'receiver',
  sessionId: string (uuid),
  pairId: string (uuid),
  initiatorParticipantId?: string,    // Present when type='receiver'
  partnerParticipantId?: string,      // Present when type='initiator'
  initiatorName?: string,              // Present when type='receiver'
  partnerName?: string,                // Present when type='initiator'
  initiatorAvatar?: string,            // Present when type='receiver'
  partnerAvatar?: string,              // Present when type='initiator'
  message: string                      // Display message to user
}
```

### `coffee:voice_call_response`
Emitted by client to backend when user responds to modal.

**Payload:**
```typescript
{
  sessionId: string (uuid),
  pairId: string (uuid),
  accepted: boolean
}
```

### `coffee:voice_call_accepted`
Emitted by backend when both participants agree to voice call.

**Payload:**
```typescript
{
  sessionId: string (uuid),
  pairId: string (uuid)
}
```

**Frontend Action:** Close modals, call `startVoice()`

### `coffee:voice_call_declined`
Emitted by backend when either participant declines.

**Payload:**
```typescript
{
  sessionId: string (uuid),
  pairId: string (uuid)
}
```

**Frontend Action:** Close modals silently, stay in chat view

## Translation Keys Needed

Add to `src/i18n/[en|de|fr|es].json` under `gamePlay.coffeeRoulette.voiceCall`:

```json
{
  "voiceCall": {
    "initiating": "Initiating Voice Call",
    "incoming": "Incoming Voice Call",
    "readyToCall": "Ready to start a voice call?",
    "openVoice": "Open Voice",
    "waiting": "Waiting...",
    "waitingForResponse": "Waiting for your partner to respond...",
    "accept": "Accept",
    "decline": "Decline",
    "expiringIn": "This request will expire in {{seconds}} seconds",
    "timeout": "Request expired"
  }
}
```

## Security Considerations

✅ **Verified:**
- Participant validation: Both participants must be in the session
- Pair validation: Participants must be paired together
- Session validation: Session must be in 'chatting' phase
- State consistency: Rejects requests if game state changed

⚠️ **Still todo:**
- Add rate limiting to prevent spam voice requests
- Add cooldown between consecutive requests (3-5 seconds)
- Log all voice request attempts for audit trail

## Testing Checklist

- [ ] **Initiator side:**
  - [ ] Click "Open Voice" button
  - [ ] See modal with partner info
  - [ ] Modal shows "Waiting for response..."
  - [ ] Accept button starts voice when partner accepts
  - [ ] Decline button closes modal

- [ ] **Receiver side:**
  - [ ] Receive modal automatically
  - [ ] See initiator's name/avatar
  - [ ] Accept button responds positively
  - [ ] Decline button responds negatively
  - [ ] 30-second timeout works
  - [ ] 25-second warning appears

- [ ] **Both sides:**
  - [ ] Both modals close after accept/decline
  - [ ] Voice starts automatically on accept
  - [ ] No voice attempts on decline
  - [ ] Socket events logged correctly

## Known Limitations

1. **No auto-fallback for disconnected partner:**
   - If initiator's partner closes browser/disconnects, initiator's modal shows "Waiting for response" indefinitely
   - Solution: Add 60-second timeout to initiator modal

2. **No visual feedback of partner's modal state:**
   - Initiator doesn't know if partner saw the modal
   - Solution: Could emit `voice_call_modal_shown` event from partner

3. **No re-request after decline:**
   - If declined, user must close modal and click button again
   - Solution: Could auto-reopen request UI after decline

## Future Enhancements

1. **Group voice calls (3+ people):**
   - Extend to support meetings beyond pairs
   - Could use for team games in future

2. **Video call support:**
   - Add camera toggle alongside microphone
   - Reuse same modal infrastructure

3. **Call history:**
   - Track initiated/accepted/declined calls
   - Show call duration analytics

4. **Accessibility:**
   - Screen reader support for modal announcements
   - Keyboard navigation for accept/decline buttons
   - High contrast mode for modal

## Debugging

Enable Socket.io debug logging in browser console:

```javascript
// In Chrome DevTools:
localStorage.debug = '*';

// Watch for these events:
gamesSocket.on('coffee:voice_call_modal', (data) => {
  console.log('[VoiceCall] Modal data:', data);
});

gamesSocket.on('coffee:voice_call_accepted', () => {
  console.log('[VoiceCall] Both sides accepted!');
});

gamesSocket.on('coffee:voice_call_declined', () => {
  console.log('[VoiceCall] Call declined');
});
```

## Code References

- **Backend:** `src/socket/gameHandlers.ts` (lines ~1846-2000)
- **Frontend Modal:** `src/features/app/components/game/coffee-roulette/modals/VoiceCallModal.tsx`
- **Frontend Integration:** `src/features/app/components/game/coffee-roulette/phases/MeetingRoom.tsx`

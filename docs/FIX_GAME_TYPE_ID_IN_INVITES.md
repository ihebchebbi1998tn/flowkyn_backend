# Fix: Game Type ID in Event Invitation Links

## Issue
Event invitation emails were including the full event UUID instead of the game type key in the join link:
- **Incorrect:** `https://app.flowkyn.com/play/7c922d87-c4f8-401d-ab8f-204cffb5d1a8`
- **Correct:** `https://app.flowkyn.com/play/7c922d87-c4f8-401d-ab8f-204cffb5d1a8?game=2`

The `game` parameter should contain the **game type key** (like "2" for Coffee Roulette), not a UUID.

## Root Cause
The invite endpoint was only looking for an explicitly passed `game_id` in the request body, but not automatically fetching the game type from the active game session.

## Solution
Updated `src/controllers/events.controller.ts` to:
1. Check if `game_id` is explicitly provided in request body
2. If not, query for the active game session on the event
3. Extract the game type **key** from the game session
4. Pass the game type key to the email service

## Code Changes

### Before
```typescript
async invite(req: AuthRequest, res: Response, next: NextFunction) {
  const result = await invitationsService.inviteParticipant(
    req.params.eventId,
    member.id,
    req.body.email,
    event.title,
    event.max_participants,
    req.body.lang,
    req.body.game_id,  // ❌ Only uses explicitly provided ID
    ...
  );
}
```

### After
```typescript
async invite(req: AuthRequest, res: Response, next: NextFunction) {
  // Get the game type key if there's an active game session for this event
  let gameTypeKey: string | undefined;
  if (!req.body.game_id) {
    const gameSession = await queryOne<{ key: string }>(
      `SELECT gt.key FROM game_sessions gs
       JOIN game_types gt ON gs.game_type_id = gt.id
       WHERE gs.event_id = $1 AND gs.status != 'finished'
       ORDER BY gs.created_at DESC LIMIT 1`,
      [req.params.eventId]
    );
    gameTypeKey = gameSession?.key;
  }
  
  const result = await invitationsService.inviteParticipant(
    req.params.eventId,
    member.id,
    req.body.email,
    event.title,
    event.max_participants,
    req.body.lang,
    req.body.game_id || gameTypeKey,  // ✅ Uses explicit ID or fetched key
    ...
  );
}
```

## Email Link Construction
The email service already properly constructs the link:

```typescript
link: `${env.frontendUrl}/join/${eventId}?token=${rawToken}${gameId ? `&game=${gameId}` : ''}`
```

**Result Links:**
- Coffee Roulette (key=2): `https://app.flowkyn.com/play/event-uuid?game=2&token=abc123`
- Two Truths (key=1): `https://app.flowkyn.com/play/event-uuid?game=1&token=abc123`

## Files Modified
- `src/controllers/events.controller.ts` - Updated `invite()` method to auto-detect game type

## Testing

### Test Case 1: Auto-detect game type
1. Create an event with a Coffee Roulette game session
2. Send invite without `game_id` in body: `POST /events/{eventId}/invitations` with `{"email": "user@example.com"}`
3. Check email link includes `?game=2`

### Test Case 2: Explicit game type override
1. Create an event with one game type
2. Send invite WITH `game_id`: `POST /events/{eventId}/invitations` with `{"email": "user@example.com", "game_id": "1"}`
3. Check email link includes `?game=1` (uses provided value, not auto-detected)

### Test Case 3: No active game session
1. Create an event without starting a game
2. Send invite without `game_id`
3. Check email link has no `game` parameter (graceful fallback)

## Impact
✅ Invitation links now properly include the game type context  
✅ Frontend can auto-load correct game based on URL parameter  
✅ Backward compatible - works with or without explicit game_id  
✅ Automatically uses current game session if available

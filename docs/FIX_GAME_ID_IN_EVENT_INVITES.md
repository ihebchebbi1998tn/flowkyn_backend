# Fix: Game ID in Event Invitation Emails

## Issue
Event invitation emails were not including the `game_id` parameter in the join link, even though the code attempted to pass it.

## Root Cause
The `inviteParticipantSchema` validator in `src/validators/events.validator.ts` didn't accept the `game_id` field, so it was being stripped from the request body before reaching the service.

## What Was Happening
```typescript
// In events.controller.ts invite() method:
const result = await invitationsService.inviteParticipant(
  req.params.eventId,
  member.id,
  req.body.email,
  event.title,
  event.max_participants,
  req.body.lang,
  req.body.game_id,  // ❌ This was undefined because validator rejected it
  event.start_time ? String(event.start_time) : undefined,
  event.end_time ? String(event.end_time) : undefined
);
```

## Solution
Added `game_id` as an optional field to the validator schema:

```typescript
export const inviteParticipantSchema = z.object({
  email: z.string().trim().email().max(255),
  lang: z.string().max(10).optional(),
  game_id: z.string().uuid().optional(),  // ✅ ADDED
});
```

## Email Link Construction
The email service already had proper support for including the game_id:

```typescript
// In events-invitations.service.ts inviteParticipant():
link: `${env.frontendUrl}/join/${eventId}?token=${rawToken}${gameId ? `&game=${gameId}` : ''}`
```

**Before Fix:**
```
https://app.flowkyn.com/join/event-uuid-123?token=abc123xyz
```

**After Fix:**
```
https://app.flowkyn.com/join/event-uuid-123?token=abc123xyz&game=game-uuid-456
```

## Files Modified
- `src/validators/events.validator.ts` - Added `game_id` to `inviteParticipantSchema`

## Testing
To verify the fix works:

1. Create an event with a game_id
2. Send an event invitation with the game_id included in the request body:
   ```json
   {
     "email": "user@example.com",
     "game_id": "550e8400-e29b-41d4-a716-446655440000"
   }
   ```
3. Check the received email - the join link should now include `&game=550e8400-e29b-41d4-a716-446655440000`
4. Clicking the link should properly redirect to the game page with the correct game context

## Impact
- ✅ Game context is now preserved in event invitation emails
- ✅ Users clicking the invite link will automatically be routed to the correct game
- ✅ No breaking changes - field is optional

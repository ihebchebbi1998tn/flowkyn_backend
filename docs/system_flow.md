# Flowkyn System Architecture & Application Flow

Version: 1.0

This document explains the **complete functional flow of the Flowkyn
platform**, from frontend user actions to backend processing, database
interactions, and realtime systems.

The goal is to describe clearly how the system operates so engineers,
architects, and stakeholders understand the architecture.

------------------------------------------------------------------------

# 1. System Overview

Flowkyn is a **multi-tenant SaaS platform** that allows organizations to
host **interactive online events powered by real‑time multiplayer games
and social engagement tools**.

The platform consists of the following major components:

Frontend - Web application (React / Next.js)

Backend - Node.js API server - WebSocket server (Socket.io)

Database - PostgreSQL (Neon)

Storage - Object storage (images, avatars, event assets)

External Services - SMTP Email service - CDN for file delivery

------------------------------------------------------------------------

# 2. Core System Modules

The backend is divided into several logical modules.

## Authentication Module

Responsible for: - User registration - Login - Email verification -
Password reset - Session management

Tables used:

users\
user_sessions\
email_verifications\
password_resets

------------------------------------------------------------------------

## Organization Module

Handles multi‑tenant SaaS structure.

Responsibilities: - Organization creation - Team member management -
Roles and permissions - Subscription plans

Tables used:

organizations\
subscriptions\
organization_members\
organization_invitations\
roles\
permissions\
role_permissions

------------------------------------------------------------------------

## Event Module

Responsible for hosting events.

Capabilities: - Create events - Configure event settings - Invite
participants - Manage participants

Tables used:

events\
event_settings\
event_invitations\
participants

------------------------------------------------------------------------

## Social Interaction Module

Provides communication and activity feed features.

Tables:

event_messages\
activity_posts\
post_reactions

------------------------------------------------------------------------

## Game Engine Module

Handles the multiplayer game logic.

Tables:

game_types\
prompts\
game_sessions\
game_rounds\
game_actions\
game_state_snapshots\
game_results

------------------------------------------------------------------------

## Leaderboard Module

Stores competitive rankings.

Tables:

leaderboards\
leaderboard_entries

------------------------------------------------------------------------

## Media Module

Handles file uploads such as avatars and images.

Tables:

files

------------------------------------------------------------------------

## Notification Module

Responsible for system notifications.

Tables:

notifications

------------------------------------------------------------------------

## Analytics & Monitoring Module

Used for product analytics and security tracking.

Tables:

analytics_events\
audit_logs

------------------------------------------------------------------------

# 3. User Registration Flow

Step 1 --- User opens signup page

Frontend collects:

-   name
-   email
-   password

Frontend sends request:

POST /auth/register

------------------------------------------------------------------------

Step 2 --- Backend validation

Backend validates:

-   email format
-   password length
-   duplicate users

------------------------------------------------------------------------

Step 3 --- Password hashing

Password is hashed using bcrypt before storage.

------------------------------------------------------------------------

Step 4 --- User creation

New record inserted into the users table.

User status is set to:

pending_verification

------------------------------------------------------------------------

Step 5 --- Verification token creation

A record is inserted into email_verifications with:

user_id\
verification_token\
expiration timestamp

------------------------------------------------------------------------

Step 6 --- Verification email sent

Email contains verification link:

https://app.flowkyn.com/verify?token=XXXX

------------------------------------------------------------------------

Step 7 --- User clicks verification link

Frontend sends:

POST /auth/verify-email

Backend validates the token and activates the account.

User status becomes:

active

------------------------------------------------------------------------

# 4. Login Flow

User submits login form.

POST /auth/login

------------------------------------------------------------------------

Backend performs:

1.  Locate user by email
2.  Compare password with bcrypt
3.  Generate JWT access token
4.  Generate refresh token

------------------------------------------------------------------------

Session record inserted into:

user_sessions

Fields stored:

user_id\
refresh_token\
ip_address\
user_agent\
expires_at

------------------------------------------------------------------------

Backend returns:

access_token\
refresh_token

------------------------------------------------------------------------

# 5. Organization Creation Flow

After login, a user may create an organization.

Frontend request:

POST /organizations

Body:

name

------------------------------------------------------------------------

Backend processing:

1.  Insert record into organizations
2.  Create organization_members entry for owner
3.  Create default subscription

------------------------------------------------------------------------

Tables affected:

organizations\
organization_members\
subscriptions

------------------------------------------------------------------------

# 6. Organization Invitation Flow

Admin invites users.

POST /organizations/{orgId}/invitations

Body:

email\
role_id

------------------------------------------------------------------------

Backend:

1.  Create invitation token
2.  Insert into organization_invitations
3.  Send email invitation

------------------------------------------------------------------------

User accepts invitation.

POST /organizations/invitations/accept

Backend creates membership in:

organization_members

------------------------------------------------------------------------

# 7. Event Creation Flow

Organizer creates an event.

POST /events

Body includes:

title\
description\
start_time\
end_time\
visibility\
max_participants

------------------------------------------------------------------------

Backend processing:

1.  Insert into events
2.  Insert configuration into event_settings

------------------------------------------------------------------------

# 8. Event Participation Flow

Participants join event.

POST /events/{eventId}/join

Backend inserts record into:

participants

If the user is an organization member:

organization_member_id stored.

If guest:

guest_name\
guest_avatar stored.

------------------------------------------------------------------------

# 9. Real‑Time Connection

When a user enters an event page:

Frontend connects via WebSocket.

Socket joins room:

event:{eventId}

This allows broadcasting messages and game updates to all participants.

------------------------------------------------------------------------

# 10. Chat Messaging Flow

User sends message via WebSocket.

chat:message event emitted.

Backend:

1.  Stores message in event_messages
2.  Broadcasts message to all clients in event room

------------------------------------------------------------------------

# 11. Game Session Flow

Organizer starts a game.

POST /events/{eventId}/game-sessions

Backend creates record in:

game_sessions

Status set to:

active

------------------------------------------------------------------------

# 12. Game Round Flow

Each game session contains rounds.

Backend creates round record in:

game_rounds

Fields:

round_number\
round_duration_seconds

Server emits event:

game:round_start

------------------------------------------------------------------------

# 13. Player Action Flow

Players submit actions (answers, votes).

WebSocket event:

game:action

Backend stores action in:

game_actions

Payload stored as JSON.

------------------------------------------------------------------------

# 14. Game State Snapshots

Periodically the backend stores game state.

Stored in:

game_state_snapshots

This allows:

-   recovery after crashes
-   replay functionality

------------------------------------------------------------------------

# 15. Game Result Calculation

After the game ends:

Backend calculates scores and rankings.

Inserted into:

game_results

Fields:

participant_id\
score\
rank

------------------------------------------------------------------------

# 16. Leaderboard Updates

Leaderboard entries updated.

Tables:

leaderboards\
leaderboard_entries

These track seasonal or organizational rankings.

------------------------------------------------------------------------

# 17. Activity Feed Flow

Participants can post updates.

POST /events/{eventId}/posts

Creates record in:

activity_posts

Users react to posts.

POST /posts/{postId}/reactions

Stored in:

post_reactions

------------------------------------------------------------------------

# 18. Avatar & Image Upload Flow

Users upload avatars or images.

POST /users/avatar

File uploaded to object storage.

Backend stores metadata in:

files

User record updated with:

avatar_url

------------------------------------------------------------------------

# 19. Notification System

System events generate notifications.

Examples:

-   invitation received
-   event starting
-   game results

Notifications stored in:

notifications

Users retrieve notifications via:

GET /notifications

------------------------------------------------------------------------

# 20. Analytics Tracking

Frontend sends product usage events.

Example:

POST /analytics

Body:

event_name\
properties

Stored in:

analytics_events

------------------------------------------------------------------------

# 21. Audit Logging

Important actions are logged for security and compliance.

Examples:

-   user removed
-   role changed
-   event deleted

Stored in:

audit_logs

------------------------------------------------------------------------

# 22. Full User Journey Summary

Typical lifecycle:

1.  User registers
2.  Email verified
3.  User logs in
4.  Creates organization
5.  Invites members
6.  Creates event
7.  Participants join event
8.  Chat and social interaction
9.  Multiplayer games played
10. Results and leaderboards displayed
11. Analytics recorded

------------------------------------------------------------------------

# 23. Scalability Considerations

Future scaling improvements:

-   Redis for caching
-   Message queue for emails
-   CDN for file delivery
-   Horizontal scaling of API servers
-   Game state distributed via Redis pub/sub

------------------------------------------------------------------------

# 24. Security Practices

Recommended practices:

-   bcrypt password hashing
-   JWT authentication
-   role-based access control
-   rate limiting
-   input validation
-   secure file uploads
-   audit logging

------------------------------------------------------------------------

# End of Document

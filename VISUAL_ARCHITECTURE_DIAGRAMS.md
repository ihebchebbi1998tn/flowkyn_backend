# 🎨 Visual Architecture Diagrams

## Two Truths & a Lie: Batch Scheduling

### Current Sequential Model ❌
```
Timeline (Minutes):
0         30        60        90        120       150       180+

Batch 1:  ┌─────┬─────┬─────┬─────┐
          │ P1  │ P2  │ P3  │ P4  │ (4 presenters × 30 min = 2 hours per batch)
          └─────┴─────┴─────┴─────┘

Batch 2:                          ┌─────┬─────┬─────┬─────┐
                                  │ P5  │ P6  │ P7  │ P8  │
                                  └─────┴─────┴─────┴─────┘

Batch 3:                                                    ┌─────┬─────┬─────┬─────┐
                                                            │ P9  │ P10 │ P11 │ P12 │
                                                            └─────┴─────┴─────┴─────┘

Total: 100 players → 100 batches → 100 × 2 hours = 200 hours 🚀
        Plus network delays → 1,200+ hours 😱

SOCKET DEPENDENCY: ❌ Real-time required
                     (Player offline = everyone waits)
```

### New Batch Mode ✅
```
Timeline (Minutes):
0         30        60        90        120

Batch 1:  ┌─────┬─────┬─────┬─────┐
          │ P1  │ P2  │ P3  │ P4  │
          └─────┴─────┴─────┴─────┘

Batch 2:  ┌─────┬─────┬─────┬─────┐ (Runs parallel!)
          │ P11 │ P12 │ P13 │ P14 │
          └─────┴─────┴─────┴─────┘

Batch 3:  ┌─────┬─────┬─────┬─────┐ (Runs parallel!)
          │ P21 │ P22 │ P23 │ P24 │
          └─────┴─────┴─────┴─────┘

Batch 10: ┌─────┬─────┬─────┬─────┐ (Runs parallel!)
          │ P91 │ P92 │ P93 │ P94 │
          └─────┴─────┴─────┴─────┘

Total: 100 players → 10 batches → 10 × 4 rounds × 30 min = 40 hours ✅
       100x improvement!

SOCKET DEPENDENCY: ❌ Deadline-based advancement
                     (No real-time required)
```

---

## Strategic Escape: Parallel Teams

### Current Single Team ⚠️
```
Crisis: "Supply Chain Disruption"

100 Players → 1 Team:
├─ 20 Leaders (talking over each other!)
├─ 20 Analysts (20 different analyses!)
├─ 20 Innovators (20 ideas competing!)
├─ 20 Voice actors (who's speaking?)
└─ 20 Mediators (who mediates the mediators?!)

Result: Information overload, unclear roles, poor engagement 😕
Time: 8+ hours (too many cooks in the kitchen)
Feasibility: Questionable (role redundancy breaks down)
```

### New Parallel Teams ✅
```
Crisis: "Supply Chain Disruption"

100 Players → 20 Teams of 5:

TEAM 1:              TEAM 2:              TEAM 3:          ... TEAM 20:
├─ Leader            ├─ Leader            ├─ Leader             ├─ Leader
├─ Analyst           ├─ Analyst           ├─ Analyst            ├─ Analyst
├─ Innovator         ├─ Innovator         ├─ Innovator          ├─ Innovator
├─ Voice             ├─ Voice             ├─ Voice              ├─ Voice
└─ Mediator          └─ Mediator          └─ Mediator           └─ Mediator

Discussion Channel: Discussion Channel:   Discussion Channel:    Discussion Channel:
"team-1"           "team-2"              "team-3"              "team-20"

Each team solves independently:
Solution: "Customer-first"
Effectiveness: 8/10
Creativity: 9/10

Result: Clear roles, focused discussions, high engagement ✅
Time: 2-3 hours (small group efficiency)
Feasibility: Perfect (each team fully independent)

AT END: Compare solutions across teams
├─ Which approach was most effective?
├─ Which was most creative?
├─ How did different teams solve the same crisis?
└─ Learning from 20 different approaches!
```

---

## Batch Assignment Map (25 Players, 10 Players/Batch)

```
                   BATCH ASSIGNMENTS TABLE
┌─────────────────────────────────────────────────────┐
│ game_session_id │ batch_number │ participant_id  │ index │
├─────────────────┼──────────────┼─────────────────┼───────┤
│ session-123     │ 1            │ player-1        │ 0     │
│ session-123     │ 1            │ player-2        │ 1     │
│ session-123     │ 1            │ player-3        │ 2     │
│ session-123     │ 1            │ player-4        │ 3     │
│ session-123     │ 1            │ player-5        │ 4     │
│ session-123     │ 1            │ player-6        │ 5     │
│ session-123     │ 1            │ player-7        │ 6     │
│ session-123     │ 1            │ player-8        │ 7     │
│ session-123     │ 1            │ player-9        │ 8     │
│ session-123     │ 1            │ player-10       │ 9     │
│─────────────────┼──────────────┼─────────────────┼───────┤
│ session-123     │ 2            │ player-11       │ 0     │
│ session-123     │ 2            │ player-12       │ 1     │
│ ... (players 13-20 continue) ...
│─────────────────┼──────────────┼─────────────────┼───────┤
│ session-123     │ 3            │ player-21       │ 0     │
│ session-123     │ 3            │ player-22       │ 1     │
│ session-123     │ 3            │ player-23       │ 2     │
│ session-123     │ 3            │ player-24       │ 3     │
│ session-123     │ 3            │ player-25       │ 4     │
└─────────────────────────────────────────────────────┘

PRESENTER SELECTION LOGIC:
├─ Current Batch: 2 (from game_sessions.current_batch)
├─ Current Round: 1 (from game_rounds.round_number)
├─ Query: WHERE batch_number = 2 AND presenter_index = 1
└─ Result: player-12 is presenting now!
```

---

## Team Assignment Map (23 Players, 5 Players/Team)

```
                   STRATEGIC ROLES TABLE (with team info)
┌──────────────┬──────────┬────────────┬─────────────┬────────────────┐
│ participant  │ role_key │ team_id    │ team_number │ ready_at       │
├──────────────┼──────────┼────────────┼─────────────┼────────────────┤
│ player-1     │ leader   │ team-1     │ 1           │ 2026-03-21 10:15│
│ player-2     │ analyst  │ team-1     │ 1           │ 2026-03-21 10:20│
│ player-3     │ innovator│ team-1     │ 1           │ NULL           │
│ player-4     │ voice    │ team-1     │ 1           │ 2026-03-21 10:18│
│ player-5     │ mediator │ team-1     │ 1           │ 2026-03-21 10:22│
├──────────────┼──────────┼────────────┼─────────────┼────────────────┤
│ player-6     │ leader   │ team-2     │ 2           │ 2026-03-21 10:14│
│ player-7     │ analyst  │ team-2     │ 2           │ 2026-03-21 10:16│
│ ... (team-2 continues) ...
├──────────────┼──────────┼────────────┼─────────────┼────────────────┤
│ player-21    │ leader   │ team-5     │ 5           │ 2026-03-21 10:13│
│ player-22    │ analyst  │ team-5     │ 5           │ 2026-03-21 10:17│
│ player-23    │ innovator│ team-5     │ 5           │ NULL           │
└──────────────┴──────────┴────────────┴─────────────┴────────────────┘

TEAM QUERIES:
├─ Get team members: WHERE team_id = 'team-1'
│  └─ Result: 5 participants with balanced roles
├─ Get team ready status: WHERE team_id = 'team-1' AND ready_at IS NOT NULL
│  └─ Result: 4 of 5 ready (player-3 still needs to acknowledge)
└─ All teams ready?: COUNT(ready_at) == COUNT(*) for all team_id
   └─ Result: Check before advancing to discussion phase
```

---

## Data Flow: Game Snapshot (Batch Mode)

```
FRONTEND REQUEST:
  GET /games/session-123/snapshot

DATABASE QUERY:
  SELECT * FROM game_sessions WHERE id = 'session-123'
  SELECT * FROM batch_assignments 
    WHERE game_session_id = 'session-123'
      AND batch_number = current_batch

SNAPSHOT RESPONSE:
{
  "kind": "two_truths",
  "phase": "submit",
  "round": 1,
  "totalRounds": 4,
  "statements": null,
  
  ✨ NEW BATCH FIELDS:
  "executionMode": "batch",        ← Shows batch mode enabled
  "batchNumber": 2,                ← Current batch (out of 10)
  "totalBatches": 10,              ← Total batches
  "batchSize": 10,                 ← Players per batch
  "myBatchNumber": 2,              ← Which batch is the current user in?
  "presenterId": "player-12",      ← Current presenter from batch 2
  "batchProgress": 50,             ← 5 of 10 batches done (%)
  
  "votes": {},
  "revealedLie": null,
  "scores": {}
}

FRONTEND RENDERING:
  ├─ Show batch indicator: "Batch 2 of 10"
  ├─ Show batch progress: ████░░░░░░ 50%
  ├─ Show presenter: "Player 12 is presenting"
  ├─ Show countdown: "30 minutes to submit"
  └─ Show instructions: "Your batch is active! Submit now."
```

---

## Data Flow: Game Snapshot (Team Mode)

```
FRONTEND REQUEST:
  GET /games/session-123/snapshot?teamId=team-5

DATABASE QUERY:
  SELECT * FROM game_sessions WHERE id = 'session-123'
  SELECT * FROM strategic_roles 
    WHERE game_session_id = 'session-123'
      AND team_id = 'team-5'
  SELECT * FROM strategic_notes
    WHERE game_session_id = 'session-123'
      AND team_id = 'team-5'

SNAPSHOT RESPONSE:
{
  "kind": "strategic_escape",
  "phase": "discussion",
  "crisis": "Supply Chain Disruption",
  "difficulty": "hard",
  
  ✨ NEW TEAM FIELDS:
  "teamMode": "parallel",          ← Parallel teams enabled
  "myTeamId": "team-5",            ← Which team is the user in?
  "myTeamNumber": 5,               ← Team number (5 of 20)
  "totalTeams": 20,                ← Total teams
  "teamSize": 5,                   ← Players per team
  
  "teamMembers": [
    { participantId: "p21", name: "Alice", role: "leader", ready: true },
    { participantId: "p22", name: "Bob", role: "analyst", ready: true },
    { participantId: "p23", name: "Carol", role: "innovator", ready: false },
    { participantId: "p24", name: "Dave", role: "voice", ready: true },
    { participantId: "p25", name: "Eve", role: "mediator", ready: true }
  ],
  
  "teamNotes": [
    { participant: "p21", content: "Customer-first approach..." },
    { participant: "p22", content: "Supply chain assessment..." }
  ],
  
  "promptState": {
    "promptIndex": 2,
    "promptText": "How would you handle regional variations?"
  }
}

FRONTEND RENDERING:
  ├─ Team header: "Team 5 of 20"
  ├─ Team members list with roles and ready status
  ├─ Team-specific notes section
  ├─ Discussion channel for this team only
  ├─ Next phase button (once all ready)
  └─ At end: Show results comparison view
```

---

## Phase Advancement: Socket vs Deadline

### Socket-Based (Current - Real-time Dependent) ❌
```
Player 1                  Player 2                    Server
   │                         │                           │
   ├──────── submit ─────────────────────────────────────→
   │                         │                         [record]
   │                         │                           │
   │                         ├──────── submit ───────────→
   │                         │                         [record]
   │                                                      │
   │                    (waiting for socket...)           │
   │                                                      │
   │                         ← socket: phase_change ─ ← emit to all
   │
   ├─ Receive socket event
   │
   └─ Update local state
   
⚠️ PROBLEM: If Player 2 is offline → whole game stalls!
⚠️ PROBLEM: Network latency → uneven phase transitions
⚠️ PROBLEM: Doesn't scale async (requires real-time)
```

### Deadline-Based (New - Async Friendly) ✅
```
Player 1                  Player 2                    Server              Background Job
   │                         │                           │                     │
   ├──────── submit ─────────────────────────────────────→                     │
   │                         │                         [record]               │
   │                         │                           │                     │
   │                         ├──────── submit ───────────→                     │
   │                         │                         [record]               │
   │                                                      │                     │
   │                    (can close app)                  │  [polling]         │
   │                                                      │ ←──────────────────┤
   │                                                      │ Check deadline     │
   │                                                      │ reached? YES       │
   │                                                      │ Update phase       │
   │                                                      │
   │                         ← API: check snapshot ──────→  (poll every 5s)
   │ Update local state       │ (Player 2 polling too)   │
   │
   └─ No socket dependency!

✅ SOLUTION: Player 2 can be offline indefinitely
✅ SOLUTION: No real-time requirement
✅ SOLUTION: Scales perfectly async!
```

---

## Scaling Scenarios

### Small Event (20 Players)
```
RECOMMENDED CONFIG:
  Two Truths: Sequential mode (simple)
  Strategic Escape: Single team (perfect!)
  Coffee Roulette: Pairs (cozy)

WHY: Small group works great with simple model
TIME: 2-3 hours per game
EFFORT: Minimal (no special handling needed)
```

### Medium Event (50 Players)
```
RECOMMENDED CONFIG:
  Two Truths: Batch mode with batch_size=10
                → 5 batches × 4 rounds = ~10 hours
  Strategic Escape: Parallel teams with team_size=5
                    → 10 teams (perfect squad size)
  Coffee Roulette: Pairs or groups (both work)

WHY: Batch mode helps with async, teams prevent redundancy
TIME: 10-15 hours per game
EFFORT: Moderate (batch/team logic needed)
```

### Large Event (100+ Players)
```
RECOMMENDED CONFIG:
  Two Truths: Batch mode with batch_size=10-20
                → 5-10 batches × 4 rounds = ~20-40 hours
  Strategic Escape: Parallel teams with team_size=5
                    → 20 teams (maximum engagement)
  Coffee Roulette: Groups with group_size=5
                   → 20 groups (~10 hours)

WHY: Only way to scale truly async
TIME: 20-40 hours per game
EFFORT: Full implementation (all features)
```

---

## Database Relationships

```
GAME SESSIONS
├─ execution_mode: 'sequential' | 'batch'
├─ batch_size: 10
├─ current_batch: 2
│
├─ team_mode: 'single' | 'parallel'
├─ team_size: 5
├─ total_teams: 20
│
└─ phase_transition_type: 'manual' | 'deadline-based' | 'instant'

    ├─── BATCH_ASSIGNMENTS (if execution_mode = 'batch')
    │    ├─ batch_number: 1, 2, 3, ..., 10
    │    ├─ presenter_index: 0, 1, 2, ..., 9
    │    └─ participant_id: player-X
    │
    ├─── GAME_TEAMS (if team_mode = 'parallel')
    │    ├─ team_id: 'team-1', 'team-2', ..., 'team-20'
    │    ├─ team_number: 1, 2, ..., 20
    │    └─ participant_count: 5
    │
    ├─── GAME_TEAM_RESULTS (at end of game)
    │    ├─ team_id: 'team-1'
    │    ├─ solution_summary: "..."
    │    ├─ effectiveness_score: 8
    │    └─ creativity_score: 9
    │
    ├─── STRATEGIC_ROLES (if Strategic Escape)
    │    ├─ team_id: 'team-1' (NULL if single team)
    │    ├─ team_number: 1 (NULL if single team)
    │    ├─ role_key: 'leader'
    │    └─ ready_at: timestamp
    │
    └─── COFFEE_GROUPS (if Coffee Roulette with groups)
         ├─ group_id: 'group-1', 'group-2', ..., 'group-20'
         ├─ group_number: 1, 2, ..., 20
         └─ participant_count: 5
```

---

## Performance Impact

```
                            QUERY PERFORMANCE
┌─────────────────────────────────────────────────────────────┐
│ Operation               │ Complexity  │ Index Used          │
├─────────────────────────┼─────────────┼─────────────────────┤
│ Get current batch       │ O(1)        │ batch_assignments   │
│ Get team members        │ O(n)        │ strategic_roles     │
│ Get batch progress      │ O(1)        │ game_sessions       │
│ Check deadline          │ O(1)        │ game_rounds         │
│ Compare teams           │ O(n)        │ game_team_results   │
│ Advance batch           │ O(1)        │ game_sessions       │
│ Complete team           │ O(1)        │ game_teams          │
└─────────────────────────────────────────────────────────────┘

EXPECTED IMPACT:
├─ Batch queries: < 5ms per request
├─ Team queries: < 10ms per request  
├─ Scaling: O(1) for most operations
└─ Database load: Minimal with proper indexing
```

---

That's it! You now have complete visual understanding of how everything works together. 🎨✨

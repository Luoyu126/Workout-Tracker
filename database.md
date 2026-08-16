# V1 Database Design — Team Management App

## 1. Design Principles

The database should support the initial single-team MVP while preserving a clean path toward:

* Multiple teams
* Multiple organizations
* Users belonging to multiple teams
* Team-specific roles
* Event signup and attendance tracking
* Match records
* Configurable coin rewards
* Auditable coin transactions
* Team-specific stores
* Mobile notifications

Core principle:

> **Design the data model for tomorrow; build the infrastructure for today.**

The database should remain relational, explicit, and easy to reason about.

---

# 2. Complete Domain Model

```text
Organization
│
└── Team
    │
    ├── TeamMembership ───────────── User
    │
    ├── Event
    │   ├── EventSignup ──────────── User
    │   ├── Attendance ───────────── User
    │   └── MatchDetails
    │   └── MatchLogEntry ────────── User
    │
    ├── CoinRule
    ├── CoinTransaction ──────────── User
    │
    ├── StoreItem
    │   └── Redemption ───────────── User
    │
    └── Notification ─────────────── User

User
└── DeviceToken
```

The V1 database contains 15 primary entities:

1. `User`
2. `Organization`
3. `Team`
4. `TeamMembership`
5. `Event`
6. `EventSignup`
7. `Attendance`
8. `MatchDetails`
9. `MatchLogEntry`
10. `CoinRule`
11. `CoinTransaction`
12. `StoreItem`
13. `Redemption`
14. `Notification`
15. `DeviceToken`

---

# 3. User

Represents one application account.

A user exists independently of any team.

```text
User
├── id                  UUID, PK
├── auth_id             UUID, UNIQUE
├── name                string
├── student_id          string, nullable
├── email               string, UNIQUE
├── avatar_url          string, nullable
├── status              enum
├── created_at          timestamp
└── updated_at          timestamp
```

### Status

```text
active
disabled
```

### Important Rules

`id` is the internal application identity.

`student_id` must never be used as the primary key.

A user may exist without a student ID because future users may include coaches, alumni, external members, or users from other types of organizations.

---

# 4. Organization

Represents a university, club, or other organization containing teams.

```text
Organization
├── id                  UUID, PK
├── name                string
├── slug                string, UNIQUE
├── logo_url            string, nullable
├── created_at          timestamp
└── updated_at          timestamp
```

Relationship:

```text
Organization 1 ─── N Team
```

---

# 5. Team

Represents the primary organizational unit of the product.

```text
Team
├── id                  UUID, PK
├── organization_id     UUID, FK → Organization
├── name                string
├── description         text, nullable
├── logo_url            string, nullable
├── status              enum
├── created_at          timestamp
└── updated_at          timestamp
```

### Status

```text
active
archived
```

Roles such as captain or admin must not be stored directly on `Team`.

---

# 6. TeamMembership

Represents:

```text
User × Team
```

```text
TeamMembership
├── id                  UUID, PK
├── team_id             UUID, FK → Team
├── user_id             UUID, FK → User
├── role                enum
├── jersey_number       string, nullable
├── position            string, nullable
├── status              enum
├── joined_at           timestamp
├── left_at             timestamp, nullable
├── created_at          timestamp
└── updated_at          timestamp
```

### Role

```text
member
captain
admin
```

### Status

```text
active
inactive
pending
```

### Constraint

```text
UNIQUE(team_id, user_id)
```

A user can belong to multiple teams, but only once to each team.

Team-specific properties belong here.

For example:

```text
User: Yunyi Chen

Football Team
├── role = captain
├── jersey_number = 10
└── position = midfielder

Basketball Team
├── role = member
├── jersey_number = 23
└── position = guard
```

---

# 7. Event

Represents any team activity.

```text
Event
├── id                  UUID, PK
├── team_id             UUID, FK → Team
├── type                enum
├── title               string
├── description         text, nullable
├── location            string, nullable
├── start_time          timestamp
├── end_time            timestamp, nullable
├── signup_deadline     timestamp, nullable
├── status              enum
├── created_by          UUID, FK → User
├── created_at          timestamp
└── updated_at          timestamp
```

### Type

```text
training
match
other
```

### Status

```text
draft
published
completed
cancelled
```

Training and match should not initially be modeled as completely independent event systems.

---

# 8. EventSignup

Represents:

> **Does this user intend to attend this event?**

```text
EventSignup
├── id                  UUID, PK
├── event_id            UUID, FK → Event
├── user_id             UUID, FK → User
├── status              enum
├── note                text, nullable
├── created_at          timestamp
└── updated_at          timestamp
```

### Status

```text
going
not_going
maybe
```

### Constraint

```text
UNIQUE(event_id, user_id)
```

Conceptually:

```text
EventSignup = planned participation
```

---

# 9. Attendance

Represents:

> **Did this user actually attend this event?**

```text
Attendance
├── id                  UUID, PK
├── event_id            UUID, FK → Event
├── user_id             UUID, FK → User
├── status              enum
├── recorded_by         UUID, FK → User
├── recorded_at         timestamp
├── note                text, nullable
├── created_at          timestamp
└── updated_at          timestamp
```

### Status

```text
present
late
absent
excused
```

### Constraint

```text
UNIQUE(event_id, user_id)
```

`EventSignup` and `Attendance` must remain separate.

For example:

```text
User      Signup       Attendance
----------------------------------
Alice     going        present
Bob       going        absent
Carol     maybe        present
David     not_going    absent
```

This distinction is especially important because coin rewards should normally depend on actual attendance rather than signup intent.

---

# 10. MatchDetails

Contains additional information specific to a match.

It exists only when:

```text
Event.type = match
```

```text
MatchDetails
├── id                  UUID, PK
├── event_id            UUID, FK → Event, UNIQUE
├── opponent            string
├── team_score          integer, nullable
├── opponent_score      integer, nullable
├── result              enum, nullable
├── notes               text, nullable
├── created_at          timestamp
└── updated_at          timestamp
```

### Result

```text
win
draw
loss
```

Conceptually:

```text
Event
│
├── training
│
└── match
     └── MatchDetails
```

`MatchDetails` represents match-level metadata and results.

`MatchLogEntry` is required in V1 because the product explicitly supports live match recording for goals, cards, and substitutions.

---

# 11. MatchLogEntry

Represents live play-by-play records during a match.

```text
MatchLogEntry
├── id                  UUID, PK
├── event_id            UUID, FK → Event
├── entry_type          enum
├── minute              integer, nullable
├── player_name         string, nullable
├── player_number       string, nullable
├── sub_out_player_name string, nullable
├── sub_out_player_number string, nullable
├── sub_in_player_name  string, nullable
├── sub_in_player_number string, nullable
├── created_by          UUID, FK → User
├── created_at          timestamp
└── updated_at          timestamp
```

### Entry Type

```text
goal
yellow_card
red_card
substitution
```

`MatchLogEntry` is a one-to-many child of `Event` and supports the live match recording feature required by the MVP.

`minute` must be a non-negative integer.

---

# 12. CoinRule

Represents configurable rules determining when coins should be awarded.

```text
CoinRule
├── id                  UUID, PK
├── team_id             UUID, FK → Team
├── name                string
├── trigger_type        enum
├── amount              integer
├── config              JSON, nullable
├── is_active           boolean
├── created_by          UUID, FK → User
├── created_at          timestamp
└── updated_at          timestamp
```

### Initial Trigger Types

```text
training_attendance
match_attendance
late_attendance
manual
```

Example:

```text
Training present → +10
Training late    → +5
Match present    → +20
```

Conceptually:

```text
CoinRule
=
Condition → Reward
```

Reward amounts should not be hardcoded in the mobile frontend.

The backend evaluates the applicable rule.

---

# 13. CoinTransaction

Represents every actual change to a user's coin balance.

This is the authoritative coin ledger.

```text
CoinTransaction
├── id                  UUID, PK
├── team_id             UUID, FK → Team
├── user_id             UUID, FK → User
├── amount              integer
├── type                enum
├── reason              string, nullable
├── reference_type      string, nullable
├── reference_id        UUID, nullable
├── created_by          UUID, FK → User, nullable
├── metadata            JSON, nullable
└── created_at          timestamp
```

### Type

```text
attendance_reward
redemption
admin_adjustment
other_reward
refund
```

Example:

```text
+10   Training attendance
+10   Training attendance
+20   Match attendance
-30   Store redemption
--------------------------------
Balance = 10
```

The authoritative balance is:

```text
Balance(user, team)
=
SUM(CoinTransaction.amount)
```

Coins belong conceptually to:

```text
User × Team
```

Therefore:

```text
Yunyi
├── Football Team    120 coins
└── Basketball Team   40 coins
```

The V1 model does **not** treat coins as a global user balance.

An `attendance_reward` for the same `(team_id, user_id, event)` must be unique.

A `refund` for the same `(team_id, user_id, redemption)` must be unique.

Do not store an authoritative mutable `coin_balance` on `User`.

A cached balance can be introduced later if performance requirements justify it.

---

# 14. StoreItem

Represents something that users can redeem using team coins.

```text
StoreItem
├── id                  UUID, PK
├── team_id             UUID, FK → Team
├── name                string
├── description         text, nullable
├── image_url           string, nullable
├── price               integer
├── stock               integer, nullable
├── is_active           boolean
├── created_by          UUID, FK → User
├── created_at          timestamp
└── updated_at          timestamp
```

Example:

```text
Team Jersey       500 coins
Sports Drink       30 coins
Team Sticker       20 coins
```

`stock = NULL` may represent unlimited inventory.

`price` must be positive.

`stock`, when present, must be non-negative.

---

# 15. Redemption

Represents an actual redemption transaction initiated by a user.

```text
Redemption
├── id                  UUID, PK
├── team_id             UUID, FK → Team
├── user_id             UUID, FK → User
├── store_item_id       UUID, FK → StoreItem
├── quantity            integer
├── unit_price          integer
├── total_price         integer
├── status              enum
├── fulfilled_by        UUID, FK → User, nullable
├── fulfilled_at        timestamp, nullable
├── created_at          timestamp
└── updated_at          timestamp
```

### Status

```text
pending
fulfilled
cancelled
refunded
```

Historical purchase prices must be preserved.

`quantity`, `unit_price`, and `total_price` must be positive.

Example:

```text
StoreItem.price = 50

User redeems item
→ Redemption.unit_price = 50

Later:
StoreItem.price = 100

Historical Redemption.unit_price remains 50
```

A successful redemption normally creates:

```text
Redemption
        +
CoinTransaction(-total_price)
        +
Inventory deduction
```

These operations must occur inside a database transaction:

```text
ALL succeed
     OR
ALL fail
```

---

# 16. Notification

Represents an in-app notification delivered to one user.

```text
Notification
├── id                  UUID, PK
├── user_id             UUID, FK → User
├── team_id             UUID, FK → Team, nullable
├── type                enum
├── title               string
├── body                text
├── reference_type      string, nullable
├── reference_id        UUID, nullable
├── read_at             timestamp, nullable
├── created_at          timestamp
└── expires_at          timestamp, nullable
```

Possible types:

```text
new_event
event_reminder
coin_earned
redemption_completed
team_announcement
```

Notifications belong to individual users so read/unread state can be tracked independently.

---

# 17. DeviceToken

Represents a mobile device capable of receiving push notifications.

```text
DeviceToken
├── id                  UUID, PK
├── user_id             UUID, FK → User
├── token               string, UNIQUE
├── platform            enum
├── is_active           boolean
├── last_seen_at        timestamp
├── created_at          timestamp
└── updated_at          timestamp
```

### Platform

```text
ios
android
```

One user may have multiple devices.

Therefore, push tokens should not be stored directly as a single field on `User`.

---

# 18. Complete Relationship Model

```text
Organization 1 ───── N Team


User N ───────────── N Team
        TeamMembership


Team 1 ───────────── N Event


User N ───────────── N Event
        EventSignup


User N ───────────── N Event
        Attendance


Event 1 ─────────── 0..1 MatchDetails
Event 1 ─────────── N MatchLogEntry


Team 1 ───────────── N CoinRule


User 1 ───────────── N CoinTransaction
Team 1 ───────────── N CoinTransaction


Team 1 ───────────── N StoreItem


User 1 ───────────── N Redemption
StoreItem 1 ──────── N Redemption


User 1 ───────────── N Notification


User 1 ───────────── N DeviceToken
```

---

# 19. Core Product Flow

The primary application loop is:

```text
Team
 │
 ▼
Event
 │
 ├──── EventSignup
 │
 ▼
Attendance
 │
 │ evaluate
 ▼
CoinRule
 │
 ▼
CoinTransaction (+)
 │
 ▼
Coin Balance
 │
 ▼
StoreItem
 │
 ▼
Redemption
 │
 ▼
CoinTransaction (-)
```

This represents the central product loop:

```text
Participate
    ↓
Record behavior
    ↓
Earn rewards
    ↓
Accumulate coins
    ↓
Redeem rewards
    ↓
Encourage participation
```

---

# 20. Core Domain Backbone

The most architecturally important entities are:

```text
User
Organization
Team
TeamMembership
Event
EventSignup
Attendance
CoinRule
CoinTransaction
StoreItem
Redemption
```

`MatchDetails`, `MatchLogEntry`, `Notification`, and `DeviceToken` are supporting extensions around this core.

---

# 21. Important Database Invariants

## Identity

* `User.id` is the internal identity.
* `student_id` is external profile information.
* Users exist independently of teams.

## Membership

* Users may belong to multiple teams.
* A user has at most one membership per team.
* Roles are team-specific.
* Authorization depends on `TeamMembership`.

## Events

* Every event belongs to one team.
* Signup and attendance are separate.
* One user has at most one signup per event.
* One user has at most one attendance record per event.
* `MatchDetails` exists only for match events.
* `MatchLogEntry` belongs only to match events.

## Coins

* Coins belong to `(user, team)`.
* Every balance change creates a `CoinTransaction`.
* The backend determines reward amounts.
* The frontend must never submit an authoritative coin amount.
* Historical transactions should not be silently edited.
* Duplicate attendance must not create duplicate rewards.
* Duplicate redemption refund compensation must not create duplicate refunds.

## Store

* Store items belong to teams.
* Redemption prices preserve historical values.
* Coin deduction, inventory deduction, and redemption creation must be transactional.
* Duplicate requests must not produce duplicate purchases.
* Cancellation and refund compensation must be transactional and idempotent.

## Security

The frontend is never authoritative for:

```text
roles
permissions
attendance validity
coin reward amounts
coin balances
inventory
redemption eligibility
```

All must be validated by FastAPI.

---

# 22. V1 Entity List

The final V1 baseline contains:

```text
01. User
02. Organization
03. Team
04. TeamMembership

05. Event
06. EventSignup
07. Attendance
08. MatchDetails
09. MatchLogEntry
10. CoinRule
11. CoinTransaction

12. StoreItem
13. Redemption

14. Notification
15. DeviceToken
```

This model should be treated as the current **V1 database baseline**.

Codex should not introduce additional entities, major abstractions, or infrastructure without a concrete product requirement or explicit architectural decision.

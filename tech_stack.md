# Technical Stack & Architecture

## 1. Architecture Baseline

Build a mobile-first team management MVP with a frontend/backend separated, modular-monolith architecture.

The domain model in [database.md](database.md) is authoritative. Application code, API schemas, migrations, tests, and shared enums must use its 15 entities and exact enum values.

Core rules:

- The mobile app is never authoritative for permissions, attendance, coin amounts, balances, inventory, or state transitions.
- User identity and TeamMembership authorization are separate.
- Signup intent and actual attendance are separate.
- Coins are an immutable CoinTransaction ledger scoped to (user, team).
- Match-only data uses MatchDetails and MatchLogEntry.
- Redemption creation, coin deduction, and inventory deduction are atomic.

## 2. Recommended Stack

### Mobile

- React Native
- Expo
- TypeScript
- Expo Router
- TanStack Query for server state
- React Hook Form with schema validation

### Backend

- FastAPI
- Python 3.12+
- Pydantic
- SQLAlchemy 2.x
- Alembic

### Data and managed services

- PostgreSQL
- Supabase Auth or an equivalent managed authentication service
- Supabase Storage or equivalent object storage
- Expo Notifications for push delivery

### Testing and quality

- Pytest for backend unit and integration tests
- Testcontainers or a dedicated PostgreSQL test database
- Vitest and React Native Testing Library for mobile tests
- Maestro for the mobile end-to-end happy path
- Ruff and mypy for Python checks
- ESLint and TypeScript for mobile checks

## 3. Runtime Architecture

~~~text
React Native + Expo
        │
        │ Supabase access token
        │ HTTPS / REST
        ▼
FastAPI modular monolith
        │
        ├── PostgreSQL
        ├── Object storage
        └── Expo push service
~~~

The mobile app authenticates with the managed auth provider. FastAPI verifies the access token, resolves User.auth_id, and applies team authorization through an active TeamMembership.

The application database never stores passwords or password hashes.

## 4. Domain Modules

The backend is split by business capability while sharing one process and one PostgreSQL database:

- users: User, authentication identity synchronization, profile and device tokens.
- organizations: Organization.
- teams: Team, TeamMembership and team authorization.
- events: Event, EventSignup, MatchDetails, MatchLogEntry, event lifecycle, publishing, modification, and deletion.
- attendance: Attendance recording, correction, event completion attendance backfill, and reward/correction coordination.
- coins: CoinRule, CoinTransaction and derived balance queries.
- store: StoreItem, Redemption.
- notifications: Notification and push delivery integration.

No module may introduce a replacement entity or alternate enum for a database concept. Application code and generated clients use the canonical names listed below.

## 5. Database Baseline

The V1 database contains exactly:

1. User
2. Organization
3. Team
4. TeamMembership
5. Event
6. EventSignup
7. Attendance
8. MatchDetails
9. MatchLogEntry
10. CoinRule
11. CoinTransaction
12. StoreItem
13. Redemption
14. Notification
15. DeviceToken

### Canonical enums

- Membership role: member | captain | admin
- Membership status: active | inactive | pending
- Team status: active | archived
- Event type: training | match | other
- Event status: draft | published | completed | cancelled
- Signup status: going | not_going | maybe
- Attendance status: present | late | absent | excused
- Match entry type: goal | yellow_card | red_card | substitution
- Match result: win | draw | loss
- Redemption status: pending | fulfilled | cancelled | refunded
- Device platform: ios | android

## 6. Transaction and Retry Strategy

Event and match creation accept client-generated Event UUIDs. Retrying the same
create-event request with the same id, team, creator, and identical payload
returns the existing Event without creating a duplicate draft or notification.
The match-create endpoint applies the same rule to the nested event id and also
requires identical MatchDetails; a reused id with different details returns a
conflict.

Store item creation also accepts a client-generated StoreItem UUID. Retrying the
same create-item request with identical team, creator, and payload returns the
existing StoreItem; reusing the id with different item details returns a
conflict so captains do not duplicate catalog entries during mobile retries.

Coin rule creation accepts a client-generated CoinRule UUID. Retrying the same
create-rule request with identical team, creator, trigger, amount, config, and
active flag returns the existing CoinRule; reusing the id with different rule
details returns a conflict so reward settings do not accumulate duplicates
during mobile retries.

Team announcement creation accepts a client-generated announcement UUID and
stores it on the resulting team_announcement notifications as reference_id.
Retrying the same announcement id with identical title/body returns the existing
notification batch without creating duplicate Inbox rows or push attempts;
reusing the id with different content returns a conflict.

Team membership creation is idempotent on the existing unique (team_id, user_id)
membership key. Retrying the same add-member request with identical role,
jersey number, position, and status returns the existing TeamMembership; trying
to add the same user with different membership details returns a duplicate
membership conflict.

Publishing an event locks the Event row, transitions draft -> published once,
creates one published-event notification batch, and treats repeated publishing
of an already published event as idempotent: return the current Event without
creating duplicate notifications.

Updating an event locks the Event row and only creates an event-updated
notification batch when at least one event or match-details field actually
changes. Retrying the same update payload against the already-updated Event
returns the current Event without creating duplicate notifications.

Deleting an uncompleted event also locks the Event row before deciding whether
to create the event-deleted notification batch and hard-delete child records, so
concurrent delete attempts cannot race notification creation against physical
deletion.

Match log creation accepts a client-generated UUID id. Retrying the same live
match-log create request with the same id and identical payload returns the
existing MatchLogEntry; reusing the id for a different event, creator, or payload
returns a conflict so live-board retries do not duplicate goals, cards, or
substitutions.

### 6.1 Event completion

Completing an event must run in one database transaction:

1. Lock the event row.
2. Verify the event is published.
3. Auto-create missing Attendance rows as absent for members who were eligible at `event.start_time`: `joined_at <= event.start_time` and either still active or `left_at >= event.start_time`.
4. Validate final attendance and match details.
5. Insert missing attendance reward CoinTransaction rows for present or late attendance according to active team CoinRule settings.
6. Insert coin_earned notifications.
7. Set the event to completed.
7. Commit.

Repeated completion requests return the already completed result and must not issue duplicate rewards. Enforce one attendance reward per (team_id, user_id, event reference) with a unique partial index over existing CoinTransaction columns.

Attendance upsert requires the target user to be an active team member for
published events and for creating a new Attendance row. For completed events,
captains/admins may still correct an existing Attendance row after the member
later becomes inactive, so historical reward clawback/grant reconciliation
remains possible without allowing new inactive-member attendance rows.

### 6.2 Redemption

The client generates the redemption UUID and submits it as id. Retrying the same logical request reuses the same ID.

In one transaction the backend must:

1. Return the existing redemption only when the same ID already exists for the same
   logical request: same user, team, store item, and quantity. Reusing the ID with
   different request details must return a conflict and must not charge coins or
   change stock.
2. Lock the target StoreItem.
3. Calculate the user's team balance from CoinTransaction.
4. Validate active membership, positive quantity, active item, balance, and stock.
5. Insert Redemption with the current unit and total price.
6. Insert a negative CoinTransaction of type redemption.
7. Decrement finite inventory.
8. Commit.

This prevents duplicate retries, insufficient-balance redemptions, partial orders, and stock overselling without adding an entity outside the database baseline.

### 6.3 Fulfillment

Fulfilling a redemption atomically:

- locks the redemption;
- allows only pending -> fulfilled for the first successful fulfillment;
- sets fulfilled_by and fulfilled_at;
- creates one redemption_completed notification;
- treats a repeated fulfillment of an already fulfilled redemption as idempotent:
  return the current Redemption without creating a second fulfillment
  notification.

### 6.4 Refund

Refunding a redemption atomically:

- locks the redemption;
- inserts a positive CoinTransaction of type refund;
- restores finite inventory when applicable;
- changes the redemption to refunded.
- treats a repeated refund of an already refunded redemption as idempotent: return
  the current Redemption without creating a second refund transaction or restoring
  inventory twice.

Historical coin transactions are never edited in place.

### 6.5 Notifications

In-app Notification rows may be created in the same transaction as the business action. External push delivery happens after commit and is non-authoritative; a push failure must not undo a successful event, reward, or redemption.

## 7. Project Directory

~~~text
Workout-Tracker/
├── apps/
│   └── mobile/
│       ├── app/                    # Expo Router screens
│       ├── src/
│       │   ├── components/
│       │   ├── features/
│       │   ├── lib/
│       │   ├── providers/
│       │   └── theme/
│       ├── tests/
│       ├── app.config.ts
│       └── package.json
├── backend/
│   ├── app/
│   │   ├── users/
│   │   ├── organizations/
│   │   ├── teams/
│   │   ├── events/
│   │   ├── attendance/
│   │   ├── coins/
│   │   ├── store/
│   │   ├── notifications/
│   │   ├── common/
│   │   └── main.py
│   ├── migrations/
│   ├── tests/
│   │   ├── unit/
│   │   ├── integration/
│   │   └── contract/
│   ├── scripts/
│   └── pyproject.toml
├── packages/
│   └── api-client/                # generated from OpenAPI
├── e2e/
│   └── maestro/
├── docs/
├── infra/
├── .github/
│   └── workflows/
└── README.md
~~~

packages/api-client exports generated endpoint metadata from the FastAPI OpenAPI document. Run `npm run api-client:generate` after API changes; `npm run verify` checks that `openapi.json` and the generated metadata are current. It is not a second hand-maintained source of domain types.

## 8. Development Phases

### Phase 0 — Scaffold and users

Deliver:

- Expo and FastAPI applications start locally.
- PostgreSQL migrations create the 15 baseline entities.
- Supabase token verification and User.auth_id synchronization work.
- Health check and environment validation work.
- A bootstrap script creates the initial organization, team, user, and admin membership.

Test:

- Backend startup and migration smoke tests.
- Invalid, expired, and valid token tests.
- User synchronization and disabled-user tests.

### Phase 1 — Teams and authorization

Deliver:

- Organization and team reads.
- Team create/update/archive.
- Membership create/update/deactivate.
- Team-scoped member/captain/admin authorization.
- Team homepage aggregate.

Test:

- Cross-team isolation tests.
- Role permission matrix tests.
- Duplicate membership constraint tests.
- Archived team and inactive membership tests.

### Phase 2 — Events, signup and Inbox

Deliver:

- Training and match draft creation.
- MatchDetails validation.
- Publish transition, update published events, and hard-delete uncompleted events.
- Immediate notifications for publishing, modifying, and deleting published events.
- Signup upsert and deadline enforcement.
- Notification list and read state.

Test:

- Event state transition tests.
- Match-only relationship tests.
- not_going note validation.
- Signup uniqueness and deadline tests.
- Publish, update, and delete notification integration tests.
- Hard-delete cascade and orphan-reference tests.

### Phase 3 — Match logs, attendance and completion

Deliver:

- Four match log entry types.
- Polling-based live board.
- Client-generated match log ids with idempotent retry handling.
- Attendance management as an independent backend domain.
- Atomic event completion, missing-attendance absent backfill, and reward generation.
- Attendance correction after completion with coin grant or clawback; balances may become negative.
- Event summary and attendance board.

Test:

- Conditional match log field validation.
- Match log create idempotency and conflicting-id tests.
- Non-match and completed-event rejection tests.
- Attendance uniqueness tests.
- Completion rollback, absent backfill, correction, clawback, and duplicate reward tests.
- Concurrent completion tests.

### Phase 4 — Coins and store

Deliver:

- Coin rules, ledger and balance.
- Store item management.
- Atomic redemption.
- Fulfillment, cancellation and refund.

Test:

- Ledger-derived balance tests.
- Insufficient balance and stock tests.
- Concurrent stock oversell tests.
- Same-redemption-ID retry tests.
- Transaction rollback and idempotent double-refund tests.
- Historical price preservation tests.

### Phase 5 — Mobile end-to-end and release

Deliver:

- Complete mobile navigation and all MVP screens.
- Device token registration and in-app notification flows; remote push delivery integration can be enabled with Expo Notifications, FCM, or APNs credentials after provider setup.
- Loading, empty, retry and offline-recovery states.
- CI checks and release configuration.

Test:

- Register → membership → publish event → signup → log match → attendance → complete → redeem.
- iOS and Android physical-device smoke tests.
- Permission and transaction regression suites.
- Basic load tests for team home, Inbox and live board.

## 9. Test Gates

Every phase must pass:

- formatting, linting and static type checks;
- unit tests for changed business rules;
- PostgreSQL integration tests for changed write paths;
- OpenAPI contract generation without a diff caused by undocumented changes;
- at least one automated smoke test for the phase's primary user flow.

Release candidates additionally require:

- no critical permission failure;
- no duplicate event reward under retry or concurrency;
- no duplicate reward, insufficient-balance redemption, or inventory oversell;
- successful iOS and Android smoke runs;
- a clean migration from an empty database.

## 10. Deployment Guidance

- Deploy FastAPI as one managed container or PaaS service.
- Use managed PostgreSQL in the same region and enable backups.
- Use managed object storage for avatars, logos, and product images.
- Keep secrets in the deployment platform, never in the mobile bundle or repository.
- Start with one backend instance if necessary, but keep all correctness guarantees in PostgreSQL transactions so horizontal scaling remains safe.

Do not introduce microservices, Kubernetes, Kafka, event sourcing, self-managed authentication, self-managed PostgreSQL, or multi-region infrastructure for the MVP.

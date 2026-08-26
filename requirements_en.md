# Mobile Team Management App MVP Requirements Document

## 1. Document Baseline

This document describes the MVP product scope for the mobile team management app.

Data entities, fields, enums, and relationships use database.md as the single source of truth.

## 2. Product Goals

- Users can register and log in with email, and maintain their personal profiles.
- Users can search by name for teams they have not joined and submit join requests. After submission, the system creates a membership with `pending` status.
- Team administrators maintain membership relationships within the current team.
- Team administrators create, modify, and delete training or match events.
- Members receive notifications in Inbox and must choose whether they are going, not going, or maybe going.
- During matches, team administrators record goals, yellow cards, red cards, and substitutions, and members can view this information in real time.
- When an event is completed, the system settles rewards based on `going` signups and grants members coins for the team they belong to.
- Members use coins from their team to redeem team merchandise.


## 3. Roles and Permissions

### 3.1 Accounts and Team Roles

`User` is an application account independent of any team. A user's role within a team can be one of two types:

- `member`: regular team member.
- `admin`: team administrator.

The same user can have different roles in different teams. New membership relationships default to the `member` role.

Note: In business terms, a real team captain still uses the `member` account logic: they can sign up for training or matches, appear in statistics, and receive rewards. `admin` is a back-office management account for managing events, members, coins, and the store. It cannot sign up for events it manages, and it does not appear in signup rankings or receive event rewards.

### 3.2 Regular Members

- View information, members, and events for teams they belong to.
- View Inbox notifications and maintain their own event signup status.
- View real-time match records, signup status, team coins, and redemption records; the real-time match dashboard is read-only for regular members.
- Use coins from their team to redeem merchandise from that team and submit orders.

### 3.3 Team Administrators

Team administrators do not inherit member signup or reward capabilities. The administrator account is used to manage the current team and can:

- Update team profile information.
- Create, edit, and delete training or matches.
- View signup status and settle coins based on signups when completing events. Note that when an event is completed, the administrator account should receive an Inbox reminder about coin settlement.
- Add or delete real-time match records during a match, while preserving the operator identity in each record.
- Manage coin rules and merchandise for the team.
- Confirm or cancel redemption orders.
- Review join requests for the team with `pending` status, and approve or reject them.
- Manage membership relationships for users who have joined the team.
- Change members to `member` or `admin`.
- Deactivate membership relationships or archive the current team.


## 5. Organizations, Teams, and Memberships

### 5.1 Organizations

An organization contains one or more teams and includes a name, a unique slug, and a logo.
> For example, Xinya College can have a men's football team and a women's football team.

### 5.2 Teams

A team must belong to an organization and includes a name, description, logo, and status:

- `active`
- `archived`

> Information displayed on the team homepage is aggregated from existing entities, including member count, recent events, attendance overview (`signup_summary`: `going` / `maybe` / `not_going` / `total`), and coin overview. Duplicate statistical fields are not stored on `Team`.

### 5.3 Membership Relationships

`TeamMembership` represents the unique membership relationship between a user and a team:

- Role: `member`, `admin`.
- Status: `active`, `inactive`, `pending`.
- TeamMembership attributes: jersey number, player name, join time, and leave time.

When a user has not joined the target team, they can search for a team by team name and submit a join request. If the user does not currently have any `TeamMembership` with `active` status, the no-team empty state after login must provide an entry point for team search and join request submission. After successful submission, the system creates a `TeamMembership` for the user and team with role `member` and status `pending`.

A `pending` membership relationship only represents a join request and cannot be used to view private team content or participate in team events. After a team administrator approves the request, the system updates its status to `active`; after rejection, the system updates its status to `inactive`. Only a membership relationship with `active` status means the user has joined the team.

The same user and team can only have one `TeamMembership`. If a `pending` or `active` membership relationship already exists, duplicate requests are not allowed. If an `inactive` membership relationship already exists, a new request should reuse that record and update it to `pending`; the system must not create a second record. Duplicate approvals must idempotently return the current membership relationship status.

## 6. Events, Signups, and Completion Settlement

### 6.1 Events

Training, matches, and other activities all use `Event`:

- Type: `training`, `match`, `other`.
- Status: `draft`, `published`, `completed`.
- Common fields: title, description, location, start time, and end time.
- Time relationship: if an end time is provided, it must be later than the start time.

> The MVP mobile app provides entry points for creating training and matches; `other` is reserved as a data model extension capability.

### 6.2 Match Details

Matches use a one-to-one `MatchDetails` record to store the opponent, both teams' scores, match result, and notes. Training and other activities must not create `MatchDetails`.

The match opponent must be filled in before publishing. Scores and the result can be confirmed before the match is completed; both teams' scores must be provided as a pair, and the win/draw/loss result must be consistent with the scores.

### 6.3 Event Status Rules

- `draft`: only team administrators can view and edit.
- `published`: active team members can view and sign up; matches can record real-time events after the match start time; repeated publishing must idempotently return and must not create duplicate notifications.
- `completed`: signups and match records stop being editable, and final signups, rewards, and summaries can be viewed.


Allowed primary flows:

```text
draft -> published -> completed

draft/published -> hard delete
```

### 6.4 Signups

`EventSignup` represents participation intent, with the following statuses:

- `going`
- `not_going`
- `maybe`

The default status is `maybe`. When selecting `not_going`, a reason must be provided in `note`. Each user can have at most one signup record for the same event.

Members can modify their own signups only before the signup deadline and only when the event is `published`. Signups cannot be modified after the event is `completed`.

### 6.5 Completing Events and Reward Settlement

The MVP does not maintain a separate attendance/check-in entity. When completing an event, the team administrator changes the event from `published` to `completed` and settles coins based on signup status:

- The active member scope is determined by member eligibility at the event start time: `role=member`, `joined_at <= event.start_time`, and currently still active.
- Members without signup records are treated as `maybe`; the system does not automatically write absent records.
- Only `going` signups receive `signup_reward` based on active team rules (`training_signup` for training and `match_signup` for matches).
- The same event and user can receive the signup reward only once.
- After an event is completed, the event schedule cannot be modified or deleted, and rewards cannot be corrected through an attendance API.

## 7. Real-Time Match Records

### 7.1 Record Types

- `goal`
- `yellow_card`
- `red_card`
- `substitution`

> This is currently mainly used to record friendly match status.

### 7.2 Field Rules

- Goals and cards require match minute, player name, and jersey number.
- Substitutions require match minute, outgoing player name and jersey number, and incoming player name and jersey number.
- All records save the event ID, creator, and creation time.
- Only team administrators can add or delete real-time match records.
- Records can be added only for events with `type=match` and `status=published`.
- After an event is completed, records are read-only to avoid silent post-match data overwrites.
- The client submits a UUID `id` for each new record, such as a red card or substitution. Retries with the same `id` and exactly the same payload must idempotently return the existing record; the same `id` with different content must return a conflict to avoid duplicate records.

The real-time dashboard uses short polling in the MVP stage.

## 8. Coins and Rewards

### 8.1 Reward Rules

`CoinRule` belongs to a team and supports the following trigger types:

- `training_signup`
- `match_signup`
- `manual`

The reward amount is calculated by the backend according to active team rules. The mobile app must not submit reward amounts. Training and match signup reward amounts are configured by the team administrator in team settings, and can be set to 0.

> The contract here is that the user side only provides signup information, and the backend distributes rewards uniformly based on attendance status. Otherwise, users could cheat by directly submitting reward amounts.

### 8.2 Coin Transactions

Every balance change must create a new `CoinTransaction`, with one of the following types:

- `signup_reward`
- `redemption`
- `admin_adjustment`
- `other_reward`
- `refund`

Coins belong to `(user, team)`, and the authoritative balance is the sum of all transaction amounts for that user in that team. A mutable balance on `User` must not be used as the authoritative source, and historical transactions must not be silently modified.

> The balance the system truly recognizes is not a User.balance field, but the sum of all CoinTransaction.amount values for the user in the team.

The signup reward for the same event and user can be issued only once.
When creating a coin rule, the client submits a UUID `id`. A retry with the same `id` and same payload must idempotently return the existing rule; reusing the same `id` with different rule content must return a conflict to avoid duplicate creation of training/match signup reward configurations.

## 9. Store and Redemptions

### 9.1 Merchandise

`StoreItem` belongs to a team and includes a name, description, image, coin price, stock, listing status, and creator.

- `is_active=true` means it can be redeemed.
- `stock=NULL` means unlimited stock.
- Price and stock are maintained by the team administrator.
- When creating merchandise, the client submits a UUID `id`. A retry with the same `id` and same payload must idempotently return the existing item; reusing the same `id` with different merchandise content must return a conflict to avoid duplicate listings.

### 9.2 Redemptions

`Redemption` stores the user, team, item, quantity, transaction unit price, transaction total price, and status:

- `pending`
- `fulfilled`
- `cancelled`
- `refunded`

During redemption, balance validation, stock validation, order creation, coin deduction, and stock deduction must be completed in the same database transaction. The order stores the transaction-time price, and later price changes to the merchandise do not affect historical orders.

`pending` orders already deduct coins and reserve finite stock when created. After successful fulfillment, they enter `fulfilled`; repeated fulfillment should idempotently return and must not create duplicate notifications. When a pending order is cancelled, it enters `cancelled`, and the system creates a `refund` coin transaction and restores stock. When a fulfilled order is refunded, it enters `refunded` and also uses a compensating `refund` transaction without modifying the original deduction transaction.

## 10. Inbox and Mobile Notifications

`Notification` is the authoritative data source for Inbox. Each notification belongs to one user and independently stores read status. When an event is created, the backend immediately creates notifications for active team members. Publishing, modifying, and deleting events no longer create additional event notifications. The MVP uses the following types:

- `new_event`
- `coin_earned`
- `redemption_completed`
- `team_announcement`

`DeviceToken` stores iOS or Android push tokens; one user can have multiple devices. Push failures must not roll back successful core business transactions, and users can still view notifications in Inbox.

## 11. Page Scope

### 11.1 Common and Member Pages

- Login / registration
- Home and team switching
- No-team empty state, team name search, and join request status
- Team homepage and member list
- Inbox
- Event list and details
- Real-time match dashboard and record page
- Signup rankings
- Coin balance and transactions
- Merchandise list, details, and redemption records
- Personal profile and device notification settings

### 11.2 Team Administrator Pages

- Team profile management
- Join request review
- Member and role management
- Create and edit training / matches
- Event signup viewing and event completion settlement
- Match details and summaries
- Coin rule management
- Merchandise and redemption order management

## 12. Core Flows

### 12.1 Joining a Team

1. The user registers through the authentication service.
2. The backend creates or syncs `User` using the authenticated identity.
3. When the user has not joined the target team, they search by team name and submit a join request.
4. The backend creates a `TeamMembership` with role `member` and status `pending`; at this point, the user has not obtained team access or event participation permissions.
5. The target team's administrator reviews the request: on approval, the membership relationship is updated to `active`; on rejection, it is updated to `inactive`.
6. The administrator can change active members' roles to `member` or `admin`.

### 12.2 Events

1. The team administrator creates and publishes an event, automatically creating `new_event` notifications for active team members. The client submits an event UUID; duplicate submissions with the same `id` and same payload must idempotently return and must not create duplicate notifications.
2. A match also creates `MatchDetails`; match creation also uses nested `event.id` idempotency, and duplicate submissions must not create duplicate match details or notifications.
3. Members enter the event details through the Inbox notification received when the event is published or through the event list.
4. When the team administrator actually modifies a published event, no additional event notification is created, but the system syncs the details in the previously sent notification according to the modified content. Repeated submission of the same update must idempotently return the current event.
5. When the team administrator deletes an incomplete event, the backend first locks the target event, then physically deletes the event and its dependent records. Deletion does not create an additional event notification, but it revokes the notification previously created when the event was published.
6. Members submit or modify `EventSignup`.
7. Event completion: based on historical active member eligibility at the event start time, issue `signup_reward` for `going` signups and create notifications; the response includes `going_count`.

### 12.3 Announcements

When a team administrator publishes a team announcement, the client submits an announcement UUID `id`. The backend creates `team_announcement` notifications for active team members and saves that `id` as the notification `reference_id`. Duplicate submissions with the same `id` and same content must idempotently return the existing notifications and must not create duplicate Inbox or Push notifications; reusing the same `id` with different announcement content must return a conflict.

### 12.4 Redemptions

1. The member selects active merchandise from this team.
2. The backend validates team membership, balance, and stock inside a transaction.
3. The backend creates `Redemption`, writes a negative `CoinTransaction`, and deducts stock.
4. After the team administrator completes the order, the status changes to `fulfilled` and the user is notified.

## 13. Acceptance Criteria

- After registration, users can search for teams by name and submit join requests; after submission, a `TeamMembership` with `pending` status is generated.
- Users can enter a team only after an administrator approves and updates the membership relationship to `active`; `pending` and `inactive` statuses cannot access private team content or participate in events.
- The same user cannot create duplicate membership relationships for the same team, and repeated approval does not duplicate or incorrectly change membership relationships.
- The same user can have different roles and jersey numbers in different teams.
- Team administrators can create, publish, modify, and delete incomplete training or matches, and complete published events.
- Team administrators cannot sign up for events, appear in signup statistics, or receive event signup rewards; real team captains use `member` account logic.
- `not_going` signups must include a reason.
- Event completion settles based on `going` signups, does not maintain separate attendance records, and does not automatically fill absent records.
- After completion, members cannot modify signups, and event arrangements cannot be modified or deleted.
- Published matches can record four types of match events, and become read-only after completion.
- Signup rewards cannot be issued repeatedly, and coin balances must match transaction summaries; manual adjustments may make balances negative.
- Redemption cannot oversell stock or deduct repeatedly; redemptions must not be created when the balance is insufficient.
- Historical orders retain their transaction prices.
- Data and coins are strictly isolated between teams.
- iOS and Android physical devices can complete the core loop.

## 14. Pre-Implementation Configuration Items

The following items are deployment configuration and do not change the database model:

- Initial organization, team, and administrator account.
- Default training and match signup coin reward amounts; afterward, these are adjusted by team administrators in team settings.
- Offline fulfillment instructions after merchandise redemption.

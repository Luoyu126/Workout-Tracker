# Workout Tracker

Mobile-first team management MVP for events, signup-based completion rewards, coin rewards, store redemptions, and notifications.

The current implementation follows the product and architecture baseline in:

- [database.md](database.md)
- [requirements.md](requirements.md)
- [api-spec.md](api-spec.md)
- [tech_stack.md](tech_stack.md)

## Local development

Install dependencies:

```bash
npm install
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cd ..
cp .env.example .env
```

Start local Postgres:

```bash
npm run db:up
npm run db:logs
npm run db:down
```

Set the required bootstrap environment variables before running the first
bootstrap:

```bash
export BOOTSTRAP_ADMIN_AUTH_ID=<supabase-user-uuid>
export BOOTSTRAP_ADMIN_EMAIL=<admin-email>
export BOOTSTRAP_ADMIN_NAME=<admin-name>
```

Then run the database migration and bootstrap:

```bash
npm run backend:migrate
npm run backend:bootstrap
```

The bootstrap script is idempotent: it creates the initial organization, team,
admin user, active admin membership, and default non-negative coin rules when
they are missing. Existing team coin rule amounts are preserved.

For release-candidate device smoke testing, create or identify a second
Supabase Auth user for the member tester, then seed persistent smoke data:

```bash
export DEVICE_SMOKE_MEMBER_AUTH_ID=<supabase-member-user-uuid>
export DEVICE_SMOKE_MEMBER_EMAIL=<member-email>
export DEVICE_SMOKE_MEMBER_NAME=<member-name>
npm run backend:seed-device-smoke
```

The device smoke seed is idempotent. It reuses the bootstrapped team/admin,
ensures the member tester has an active team membership, keeps training, match,
and late reward rules active, creates or updates one published training, one
published match, one active store item, and a member balance adjustment for
store redemption testing. If earlier device smoke attempts spent the member's
coins, rerunning the seed tops the member balance back up to 200 coins without
creating duplicate seed-adjustment rows. If earlier smoke attempts completed
the seeded training or match, rerunning the seed creates fresh published events
while preserving the historical completed rows.

Run the backend:

```bash
npm run dev:backend
```

Mobile:

```bash
npm run dev:mobile
```

### Mobile API URL

The mobile app reads:

```bash
EXPO_PUBLIC_API_BASE_URL=http://localhost:8000
EXPO_PUBLIC_SUPABASE_URL=<your-supabase-project-url>
EXPO_PUBLIC_SUPABASE_ANON_KEY=<your-supabase-anon-key>
EXPO_PUBLIC_EAS_PROJECT_ID=<your-eas-project-uuid-for-native-push>
CORS_ALLOWED_ORIGINS=http://localhost:8081,http://localhost:19006,http://127.0.0.1:8081,http://127.0.0.1:19006
```

Use `http://localhost:8000` for iOS Simulator and local web. For Android
Emulator, use `http://10.0.2.2:8000`. For a physical phone, run the backend on
your LAN and point the app at your computer IP:

```bash
npm run dev:backend:lan
EXPO_PUBLIC_API_BASE_URL=http://<your-computer-lan-ip>:8000 npm run dev:mobile
```

Native iOS and Android requests do not require browser CORS, but Expo web and
browser-based previews do. Set `CORS_ALLOWED_ORIGINS` to the comma-separated
web origins allowed to call the API. Production startup rejects `*`; use exact
HTTPS preview or production origins instead.

Supabase Auth must be configured with the same project used by
`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`. The backend
validates Supabase access tokens using either `SUPABASE_JWT_JWKS_URL` or
`SUPABASE_JWT_SECRET` from `.env`; production startup fails if neither JWT
verification setting is configured.

For production or production-like previews, set `APP_ENV=production`. This
disables FastAPI docs routes and requires `SUPABASE_JWT_SECRET` or
`SUPABASE_JWT_JWKS_URL` during startup.

Before deploying or smoke-testing a release-like backend, run:

```bash
npm run backend:release-env:check -- production
```

This offline check verifies that `APP_ENV=production`, that `DATABASE_URL is not a local database host`, Supabase JWT verification is configured, and
does not use documentation placeholder values, and `CORS_ALLOWED_ORIGINS`
contains exact HTTPS origins without `*`.

Useful checks:

```bash
npm run backend:lint
npm run backend:typecheck
npm run backend:test
npm run backend:demo-flow
npm run api-client:generate
npm run api-client:check
npm run backend:load-check
npm run backend:smoke
npm run backend:migration:sql
npm run backend:release-env:check -- production
npm run deps:check
npm run backend:seed-device-smoke
npm run mobile:lint
npm run mobile:typecheck
npm run mobile:smoke
npm run mobile:test
npm run mobile:release-env:check -- preview
npm run release:check:preview
npm run release:check:production
npm run e2e:maestro:check
npm run e2e:device-report:create -- rc1
npm run verify
npm run security:audit
npm run clean
```

`npm run verify` runs an offline npm production dependency-tree check, backend
lint/typecheck, backend tests, a backend demo business flow, a lightweight
backend load check for team home, Inbox, and live board reads, starts the
FastAPI app with Uvicorn and checks `/health`, renders Alembic SQL, checks that
the generated OpenAPI client metadata is current, and then runs mobile lint,
mobile typecheck, mobile route/i18n smoke checks, API client/feature endpoint
contract tests, and mobile tests.

Current automated baseline: 180 backend tests and 120 mobile tests pass as part
of the full verification suite.

Run `npm run clean` after local verification if you want to remove Python
tooling caches such as `.pytest_cache`, `.ruff_cache`, `.mypy_cache`,
`__pycache__`, and generated `*.egg-info` directories.

GitHub Actions runs the same `npm run verify` suite for pull requests and pushes
to `main`, so local and CI quality gates stay aligned.

`npm run security:audit` calls `npm audit --omit=dev --audit-level=critical`.
It is intentionally separate from offline `npm run verify` because it contacts
the npm registry and sends dependency metadata for advisory matching. Run it
only in an environment where that external metadata disclosure is acceptable.
`npm run deps:check` is the offline companion check; it verifies the installed
production dependency tree resolves locally without contacting the registry.

Remote Expo push delivery is disabled by default for local development. Enable
it in a deployed or preview backend with:

```bash
PUSH_NOTIFICATIONS_ENABLED=true
EXPO_PUSH_ENDPOINT=https://exp.host/--/api/v2/push/send
EXPO_PUSH_TIMEOUT_SECONDS=5
```

### Backend container image

`backend/Dockerfile` builds a production-style FastAPI image. Build it from the
repository root:

```bash
docker build -f backend/Dockerfile -t workout-tracker-api backend
```

Run it with the same environment variables documented in `.env.example`:

```bash
docker run --rm -p 8000:8000 --env-file .env workout-tracker-api
```

The image exposes `PORT`, starts Uvicorn with proxy-header support for common
container reverse-proxy deployments, and includes a Docker `HEALTHCHECK` that
reads `/health` inside the container using the configured port.

If `python3 -m venv` fails on Debian/Ubuntu, install the system package that provides
`ensurepip`, usually `python3-venv`, then recreate the virtual environment.

### Mobile release builds

`apps/mobile/eas.json` defines EAS build profiles for development, preview, and production releases.
The development profile creates an internal development
client, the preview profile creates an internal Android APK for quick device
testing, and the production profile enables app version auto-incrementing.

Run the release env checks from the repository root, then run EAS builds from
`apps/mobile` after configuring Expo/EAS credentials:

```bash
npm run mobile:release-env:check -- preview
cd apps/mobile
npx eas build --profile development
npx eas build --profile preview
cd ../..
npm run mobile:release-env:check -- production
cd apps/mobile
npx eas build --profile production
```

`npm run mobile:release-env:check -- preview` and `-- production` verify that
release-like builds have `EXPO_PUBLIC_API_BASE_URL`,
`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and
`EXPO_PUBLIC_EAS_PROJECT_ID` configured. `EXPO_PUBLIC_API_BASE_URL` must be a
valid HTTP(S) URL, and production builds must use HTTPS. Preview and production
builds must not point `EXPO_PUBLIC_API_BASE_URL` at localhost, `127.0.0.1`,
`0.0.0.0`, the Android emulator host `10.0.2.2`, or a documentation placeholder
value; use a reachable LAN, preview, or production backend URL.
`EXPO_PUBLIC_SUPABASE_URL` must be a valid HTTPS URL,
`EXPO_PUBLIC_SUPABASE_ANON_KEY` must not be the development placeholder key or a
documentation placeholder value, and
`EXPO_PUBLIC_EAS_PROJECT_ID` must be a valid EAS project UUID and must not use a
documentation placeholder value.

Release-candidate gate:

1. Run `npm run release:check:preview` or `npm run release:check:production` against the target release environment. These commands run `npm run verify`, `npm run backend:release-env:check -- production`, and the matching mobile release env check.
2. If you cannot run the combined command, run `npm run verify`, `npm run backend:release-env:check -- production`, and `npm run mobile:release-env:check -- preview` or `-- production` separately.
3. Run `npm run security:audit` only in an environment where npm registry dependency metadata disclosure is approved.
4. Install an EAS development, preview, or production build on at least one iOS device and one Android device.
5. Run `npm run e2e:maestro:check`, then `npm run e2e:maestro` where supported, or manually execute the same smoke path documented in [e2e/maestro/README.md](e2e/maestro/README.md).
6. For the final MVP release, complete [e2e/maestro/device-smoke-checklist.md](e2e/maestro/device-smoke-checklist.md) on both platforms and run `npm run e2e:device-report:create -- <candidate>` to create a gitignored report from [e2e/maestro/device-smoke-report-template.md](e2e/maestro/device-smoke-report-template.md) for the release record, confirming that login/sign-up, default Chinese UI, language switching, team navigation, Inbox, push permission/token registration, event signup, captain/admin match logging, member read-only live board access, event completion with signup rewards, coin balance, and store redemption surfaces open and behave correctly against the target backend.
7. After filling the report, run `npm run e2e:device-report:check -- e2e/maestro/device-smoke-report-YYYYMMDD-<candidate>.md` to catch missing platform pass rows for iOS/Android, final decision checkboxes, automated gate evidence, and core smoke-path notes before tagging.

`npm run verify` proves the automated contract and business-rule baseline; the
iOS and Android device smoke runs prove store-build/runtime integration.

## MVP status

Implemented slices:

- Supabase email sign-up/sign-in/sign-out, backend user sync, and profile read/update APIs/UI.
- Team membership, team-scoped roles, organization/team/member reads, active/archived team filters for reactivation, admin member-candidate search, real team-home aggregates, and captain/admin member management.
- Mobile team-home screen for member count, upcoming events, captains, signup summary, coin summary, team logo editing, and team-scoped Inbox entry.
- Events, matches, signup, list filters, captain-side create/publish/update/hard-delete flows, and create/publish/update/delete event notifications.
- Event completion that settles `signup_reward` coins for `going` signups, team signup board, and configurable training/match signup coin rules.
- Match logs with captain/admin-only goals/cards/substitutions, polling live board, member read-only live board access, log deletion, and match summary with signups.
- Captain-side coin reward rule setup for training and match signup, plus admin manual coin adjustments with member quick-select and retry-safe client transaction IDs.
- Store items with image URL preview/editing, captain-side item management, retry-safe client redemption IDs, redemptions, fulfillment, cancellation, refunds, and inventory restoration.
- Inbox notifications, notification-tap deep links, event quick-signup actions, team-scoped unread filtering/counts, captain/admin team announcements, native Expo push token permission/registration, app-start/foreground token refresh, best-effort Expo remote push delivery, and device token deactivation.
- Mobile-first Expo UI with default Simplified Chinese, keyboard-aware form layout, persisted language switching, persisted Supabase sessions, route coverage, EAS build profiles, media URL preview/editing, and form/input validation across auth/profile, teams/members, events, signup, coins, store, announcements, and device-token setup.
- Mobile API client handling for empty 204 responses, FastAPI structured/string/validation error details, and network-failure/offline recovery prompts with retry actions.

Push notification note:

The mobile app can request notification permission, fetch a native Expo Push
Token with `expo-notifications`, register it with the backend, and still allows
manual token entry as a development fallback. Set `EXPO_PUBLIC_EAS_PROJECT_ID`
for native builds so Expo push token requests can include the EAS project id.
When `PUSH_NOTIFICATIONS_ENABLED` is true, the backend queues best-effort Expo
remote push messages and sends them only after the database transaction commits,
while still persisting Inbox notifications. Push messages are chunked into
batches of at most 100 messages per Expo Push API request. Tapping an Expo push
notification opens the relevant event, team, coins, store, or Inbox screen based
on the notification payload. The MVP persists device tokens and creates in-app notifications when events are
created, published, updated, or deleted, when coin rewards/redemption completion
occur, and when captains/admins publish team announcements. Draft creation
notifications are stored as event snapshots without a detail link because draft
events remain captain/admin-only; published-event notifications link to the
event detail.
Native store builds still need the normal Expo/EAS push credential setup for
FCM/APNs delivery.

Backend demo flow:

`npm run backend:demo-flow` exercises the main server-side MVP path with an
in-memory database. It seeds team/users/media URLs, creates and publishes a
training event, notifies the team, updates and hard-deletes a published event
with event-updated and event-deleted notifications, creates and publishes a
match, submits signup, logs and deletes match live-board entries, reads the live
board, completes the match with a final score and signup rewards, completes
training with signup rewards, redeems a store item with an image URL,
fulfills, refunds and restores inventory, then publishes a team announcement.

Demo milestones: seed team/users/media URLs; submit signup; log a match goal; read the live board; complete a match with final score; publish a team announcement.

Backend load check:

`npm run backend:load-check` seeds an in-memory team with members, completed and
upcoming events, Inbox notifications, and match logs. It repeatedly reads team
home, team-scoped Inbox, unread count, and live board data to catch obvious
regressions in the MVP's hottest read surfaces.

Load check surfaces: team home, Inbox, and live board reads.

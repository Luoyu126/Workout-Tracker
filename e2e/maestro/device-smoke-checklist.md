# Device Smoke Checklist

Use this checklist for the release-candidate device gate when validating an EAS
development, preview, or production build against the target backend.

Run this on at least one iOS device or simulator and one Android device or
emulator. Record the build profile, app version, backend URL, tester, date, and
result for each platform. Copy
[device-smoke-report-template.md](device-smoke-report-template.md) for the
release candidate so the final iOS and Android evidence is kept with the
release record.

## Setup

- [ ] `npm run verify` is green locally or in GitHub Actions for the exact source state being tested.
- [ ] The backend is reachable from the device.
  - iOS Simulator/local web can use `http://localhost:8000`.
  - Android Emulator should use `http://10.0.2.2:8000`.
  - Physical devices should use the computer or deployed backend LAN/HTTPS URL.
- [ ] `EXPO_PUBLIC_API_BASE_URL` points at the target backend.
- [ ] Supabase Auth is configured for the same project used by the build.
- [ ] The test data includes at least one active team, one captain/admin account, one member account, one published match, coin rules, and one active store item.
- [ ] For native push validation, `EXPO_PUBLIC_EAS_PROJECT_ID` is set to a real EAS project id, does not use a documentation placeholder value, and the build has the normal Expo/EAS APNs or FCM credentials.

## Test data preparation

Use a production-like backend database for device smoke testing. `npm run
backend:demo-flow` proves the business path in an in-memory database, but it
does not seed persistent Supabase Auth users for a device build.

Before starting the device smoke path:

- [ ] Create or identify a Supabase Auth user for the captain/admin tester.
- [ ] Export bootstrap variables for that admin user:

  ```bash
  export BOOTSTRAP_ADMIN_AUTH_ID=<supabase-admin-user-uuid>
  export BOOTSTRAP_ADMIN_EMAIL=<admin-email>
  export BOOTSTRAP_ADMIN_NAME=<admin-name>
  ```

- [ ] Run database migrations and the idempotent bootstrap:

  ```bash
  npm run backend:migrate
  npm run backend:bootstrap
  ```

- [ ] Start the target backend with Supabase JWT verification configured.
- [ ] Sign in on the device as the captain/admin and confirm the bootstrapped team appears.
- [ ] Create or identify a second Supabase Auth user for the member tester.
- [ ] Sign in once as the member tester so `/auth/sync` creates the app `User`.
- [ ] Export member smoke variables:

  ```bash
  export DEVICE_SMOKE_MEMBER_AUTH_ID=<supabase-member-user-uuid>
  export DEVICE_SMOKE_MEMBER_EMAIL=<member-email>
  export DEVICE_SMOKE_MEMBER_NAME=<member-name>
  ```

- [ ] Run the idempotent persistent smoke seed:

  ```bash
  npm run backend:seed-device-smoke
  ```

- [ ] Sign back in as captain/admin and confirm the member is active on the team.
- [ ] As captain/admin, verify the smoke data:
  - [ ] training, match, and late coin reward rules are active.
  - [ ] one fresh published training or match event is available for signup, even after rerunning the seed following a completed smoke event.
  - [ ] one fresh published match is available for live logging, even after rerunning the seed following a completed smoke match.
  - [ ] one active store item exists with a positive price and enough finite or unlimited stock.
  - [ ] the member has at least 200 coins after rerunning the seed, enough to redeem the store item even if earlier smoke attempts spent coins.

## Platform record

| Field | iOS | Android |
| --- | --- | --- |
| Device/simulator |  |  |
| OS version |  |  |
| Build profile |  |  |
| App version/build |  |  |
| Backend URL |  |  |
| Tester/date |  |  |
| Result |  |  |

## Smoke path

- [ ] Launch the app from a clean install or after clearing app data.
- [ ] Confirm the default UI language is Simplified Chinese and the home screen shows `球队首页`.
- [ ] Switch display language to English and confirm primary navigation labels update.
- [ ] Switch back to Chinese before continuing the authenticated MVP path.
- [ ] Sign up or sign in with Supabase email/password.
- [ ] If prompted, sync the user profile and confirm name, student ID, and avatar URL fields can be saved.
- [ ] Open `我的球队` and confirm the expected active team is visible.
- [ ] Open the team home and confirm member count, captains, upcoming events, signup summary, coin summary, and team logo/image surfaces render without crashing.
- [ ] Open team Inbox and confirm unread count/list load.
- [ ] Register a native Expo Push Token or use the manual token fallback, then confirm the token appears saved.
- [ ] As a captain/admin, publish a team announcement and confirm active team members receive an Inbox notification.
- [ ] Open a published training or match event.
- [ ] Complete event signup by submitting `参加`, `待定`, and `不参加` states; confirm `不参加` requires a reason.
- [ ] Confirm signup is read-only after the effective signup deadline or once the event is completed.
- [ ] As captain/admin, open a published match live board and add a goal, card, and substitution record.
- [ ] Confirm the live board refreshes and shows localized match log labels.
- [ ] As captain/admin, delete a match log and confirm the destructive confirmation dialog appears before deletion.
- [ ] As a member, reopen the same live board and confirm match logs are read-only.
- [ ] As captain/admin, complete the published event and confirm signup rewards for `going` members; missing signups are treated as `maybe` and are not rewarded.
- [ ] Confirm completed events cannot be edited or deleted from the event detail page.
- [ ] Confirm there is no post-completion attendance correction path; use manual coin adjustment when negative balances are allowed.
- [ ] Open the signup board and confirm completed-event rows and date filters load.
- [ ] Open the coins screen and confirm balance, ledger, reward rules, member quick-select, and admin adjustment surfaces load.
- [ ] As captain/admin, update training and match signup reward rule amounts.
- [ ] Open the store and confirm active items, item images, quantity input, and redemption history load.
- [ ] Redeem an active item as a member and confirm coins are deducted and finite stock is reduced.
- [ ] As captain/admin, fulfill the redemption and confirm the member receives a `redemption_completed` Inbox notification.
- [ ] Refund a fulfilled redemption and confirm coins are restored and finite stock is restored.
- [ ] Kill and relaunch the app; confirm the persisted Supabase session and persisted language preference are restored.
- [ ] Tap at least one actionable notification and confirm it deep-links to the expected event, team, coins, store, or Inbox screen.

## Failure notes

For each failure, record:

- Platform and build profile.
- Screenshot or screen recording.
- Backend URL and approximate timestamp.
- User account and team used.
- Whether the issue reproduces after relaunching the app.
- Related backend or device logs, if available.

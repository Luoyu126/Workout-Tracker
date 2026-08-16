# Device Smoke Report

Copy this file for every release-candidate device gate as
`device-smoke-report-YYYYMMDD-<candidate>.md`. Keep the completed copy with the
release record; do not edit this template with one-off release evidence.

## Release candidate

| Field | Value |
| --- | --- |
| Source commit |  |
| Release candidate tag/build |  |
| Build profile | development / preview / production |
| App version/build number |  |
| Backend URL |  |
| Supabase project |  |
| Tester(s) |  |
| Test date |  |

## Automated gate evidence

Record command output links, local log filenames, CI run URLs, or concise pasted
summaries. If a gate was intentionally not run, include the explicit not-run
reason and owner for follow-up.

| Gate | Evidence / result |
| --- | --- |
| `npm run verify` evidence |  |
| `npm run backend:release-env:check -- production` evidence |  |
| `npm run mobile:release-env:check -- <preview|production>` evidence |  |
| `npm run security:audit` evidence or explicit not-run reason |  |
| Device smoke data seed evidence |  |

## Device smoke data

| Field | Value |
| --- | --- |
| Captain/admin account |  |
| Member account |  |
| Bootstrapped team |  |
| Published training/match event |  |
| Published match live board |  |
| Active store item |  |
| Reward rules verified | training / match / late |
| Push setup | Native Expo Push Token / manual token fallback |

## Platform results

| Platform | Device/simulator | OS version | Build profile | Backend URL | Result | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| iOS |  |  |  |  | pass / fail / blocked |  |
| Android |  |  |  |  | pass / fail / blocked |  |

## Smoke path evidence

For each item, record pass/fail, platform coverage, and the best available
evidence such as screenshot, screen recording, Maestro output, backend log
timestamp, or tester note.

| Smoke path item | iOS | Android | Evidence / notes |
| --- | --- | --- | --- |
| Default Simplified Chinese UI |  |  |  |
| Language switching and persisted language preference |  |  |  |
| Supabase sign-up/sign-in and persisted session |  |  |  |
| Profile sync with name, student ID, and avatar URL |  |  |  |
| Team navigation and team home aggregates |  |  |  |
| Inbox load and unread state |  |  |  |
| Native push token registration or manual fallback |  |  |  |
| Team announcement notification |  |  |  |
| Event signup states: going / maybe / not going with reason |  |  |  |
| Signup read-only after deadline or completion |  |  |  |
| Captain/admin match live logging: goal, card, substitution |  |  |  |
| Match log delete confirmation |  |  |  |
| Member read-only live board access |  |  |  |
| Attendance completion with missing members marked absent |  |  |  |
| Completed event edit/delete blocked |  |  |  |
| Attendance correction coin clawback and negative-balance allowance |  |  |  |
| Attendance board filters and rows |  |  |  |
| Coin balance, ledger, reward rule editing, and manual adjustment |  |  |  |
| Store item redemption and finite-stock deduction |  |  |  |
| Fulfillment notification |  |  |  |
| Refund and finite-stock restoration |  |  |  |
| Notification deep-link behavior |  |  |  |

## Failures and follow-up

| ID | Platform | Step | Severity | Observed behavior | Expected behavior | Evidence | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |  |  |

## Final release decision

- [ ] iOS pass
- [ ] Android pass
- [ ] All critical failures resolved or explicitly accepted
- [ ] Release owner approved

Decision / notes:

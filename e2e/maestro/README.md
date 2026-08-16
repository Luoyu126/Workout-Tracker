# Maestro E2E

This folder contains optional device/simulator E2E checks for the Expo mobile
app. These checks are intentionally not part of `npm run verify` because they
need a built app plus a running simulator or device.

## Prerequisites

1. Install Maestro locally.
2. Build/install the Expo app on an emulator, simulator, or device using the
   configured app id:
   - iOS bundle id: `com.chenyy.workouttracker`
   - Android package: `com.chenyy.workouttracker`

## Run

```bash
npm run e2e:maestro:check
npm run e2e:maestro
```

## Release-candidate device gate

Before tagging a mobile MVP release candidate, run the automated verification
suite plus device smoke checks:

1. Confirm `npm run verify` is green locally or in GitHub Actions.
2. Install the same EAS build profile intended for release on one iOS device and one Android device.
3. Run `npm run e2e:maestro:check`, then `npm run e2e:maestro` on each platform where Maestro can drive the installed build.
4. If Maestro is unavailable for a device, manually follow `app-smoke.yaml` and record the result.
5. Against the target backend, manually confirm the authenticated core path at least once: login/sign-up -> team navigation -> Inbox -> event signup -> captain/admin match log write -> member read-only live board -> attendance completion -> coin balance -> store redemption.
6. Use [device-smoke-checklist.md](device-smoke-checklist.md), then run `npm run e2e:device-report:create -- <candidate>` to create a gitignored report from [device-smoke-report-template.md](device-smoke-report-template.md) for the iOS and Android platform results, build profile, backend URL, evidence, and any failure notes.
7. After filling the report, run `npm run e2e:device-report:check -- e2e/maestro/device-smoke-report-YYYYMMDD-<candidate>.md` to catch missing platform pass rows, final decision checkboxes, automated gate evidence, and core smoke-path notes.

The checked-in Maestro smoke is intentionally lightweight so it can run without
seeded backend data. The backend transactional business path is covered by
`npm run backend:demo-flow`; the device gate proves the native runtime,
navigation, language defaults, and installed-build configuration.

## Current flow

`app-smoke.yaml` verifies the first device-level MVP surface without requiring
seeded backend data:

home launch -> default Chinese UI -> language switch to English -> switch back
to Chinese -> login -> profile with avatar URL field -> teams -> inbox
navigation with team announcement controls.

The full backend business path is covered in `npm run backend:demo-flow`:

publish event -> notify team -> create/publish match -> signup -> captain logs match goal
-> member reads live board -> complete attendance -> auto-absent -> reward coins -> claw
back reward after correction -> redeem item -> fulfill -> refund and restore
inventory -> publish team announcement. The demo seed also exercises avatar,
team logo, and store item image URL persistence.

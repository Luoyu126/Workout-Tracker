import json
import os
import re
import subprocess
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[3]


def completed_device_smoke_report() -> str:
    smoke_rows = "\n".join(
        f"| {label} | pass | pass | screenshot-{index} |"
        for index, label in enumerate(
            (
                "Default Simplified Chinese UI",
                "Language switching and persisted language preference",
                "Supabase sign-up/sign-in and persisted session",
                "Profile sync with name, student ID, and avatar URL",
                "Team navigation and team home aggregates",
                "Inbox load and unread state",
                "Native push token registration or manual fallback",
                "Team announcement notification",
                "Event signup states: going / maybe / not going with reason",
                "Signup read-only after deadline or completion",
                "Captain/admin match live logging: goal, card, substitution",
                "Match log delete confirmation",
                "Member read-only live board access",
                "Event completion with signup rewards for going members",
                "Completed event edit/delete blocked",
                "Manual coin adjustment allows negative balances",
                "Signup board filters and rows",
                "Coin balance, ledger, reward rule editing, and manual adjustment",
                "Store item redemption and finite-stock deduction",
                "Fulfillment notification",
                "Refund and finite-stock restoration",
                "Notification deep-link behavior",
            ),
            start=1,
        )
    )
    return f"""# Device Smoke Report

## Release candidate

| Field | Value |
| --- | --- |
| Source commit | abc1234 |
| Release candidate tag/build | rc-complete |
| Build profile | preview |
| App version/build number | 0.1.0/42 |
| Backend URL | https://api.example.test |
| Supabase project | workout-tracker-preview |
| Tester(s) | QA |
| Test date | 2099-01-04 |

## Automated gate evidence

| Gate | Evidence / result |
| --- | --- |
| `npm run verify` evidence | verify-log.txt |
| `npm run backend:release-env:check -- production` evidence | backend-release-log.txt |
| `npm run mobile:release-env:check -- <preview|production>` evidence | mobile-release-log.txt |
| `npm run security:audit` evidence or explicit not-run reason | audit-log.txt |
| Device smoke data seed evidence | seed-log.txt |

## Platform results

| Platform | Device/simulator | OS version | Build profile | Backend URL | Result | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| iOS | iPhone 15 | iOS 18 | preview | https://api.example.test | pass | ios-video.mov |
| Android | Pixel 8 | Android 15 | preview | https://api.example.test | pass | android-video.mp4 |

## Smoke path evidence

| Smoke path item | iOS | Android | Evidence / notes |
| --- | --- | --- | --- |
{smoke_rows}

## Final release decision

- [x] iOS pass
- [x] Android pass
- [x] All critical failures resolved or explicitly accepted
- [x] Release owner approved
"""


def test_readme_npm_scripts_exist() -> None:
    package_json = json.loads((ROOT_DIR / "package.json").read_text(encoding="utf-8"))
    scripts = package_json["scripts"]
    readme = (ROOT_DIR / "README.md").read_text(encoding="utf-8")

    referenced_scripts = set(re.findall(r"npm run ([a-z0-9:.-]+)", readme))

    missing_scripts = sorted(script for script in referenced_scripts if script not in scripts)
    assert missing_scripts == []


def test_local_postgres_compose_matches_default_database_url() -> None:
    env_example = (ROOT_DIR / ".env.example").read_text(encoding="utf-8")
    compose = (ROOT_DIR / "docker-compose.yml").read_text(encoding="utf-8")

    assert (
        "DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/workout_tracker"
        in env_example
    )
    assert "POSTGRES_DB: workout_tracker" in compose
    assert "POSTGRES_USER: postgres" in compose
    assert "POSTGRES_PASSWORD: postgres" in compose
    assert '"5432:5432"' in compose


def test_gitignore_excludes_local_secrets_build_artifacts_and_smoke_reports() -> None:
    gitignore = (ROOT_DIR / ".gitignore").read_text(encoding="utf-8")

    for pattern in (
        ".env",
        ".env.*",
        "!.env.example",
        "*.log",
        "*.pem",
        "*.key",
        "*.p12",
        "*.mobileprovision",
        "*.apk",
        "*.aab",
        "*.ipa",
        "node_modules/",
        "backend/.venv/",
        "apps/mobile/.expo/",
        "apps/mobile/web-build/",
        "e2e/maestro/device-smoke-report-*.md",
    ):
        assert pattern in gitignore


def test_env_example_documents_mobile_and_supabase_configuration() -> None:
    env_example = (ROOT_DIR / ".env.example").read_text(encoding="utf-8")
    readme = (ROOT_DIR / "README.md").read_text(encoding="utf-8")
    root_package_json = json.loads((ROOT_DIR / "package.json").read_text(encoding="utf-8"))
    mobile_package_json = json.loads(
        (ROOT_DIR / "apps" / "mobile" / "package.json").read_text(encoding="utf-8")
    )
    release_env_check = (
        ROOT_DIR / "apps" / "mobile" / "scripts" / "check-release-env.mjs"
    ).read_text(encoding="utf-8")
    backend_release_env_check = (ROOT_DIR / "backend" / "scripts" / "check_release_env.py").read_text(
        encoding="utf-8"
    )
    backend_runtime_config = (ROOT_DIR / "backend" / "app" / "config.py").read_text(encoding="utf-8")

    for name in (
        "EXPO_PUBLIC_API_BASE_URL",
        "EXPO_PUBLIC_SUPABASE_URL",
        "EXPO_PUBLIC_SUPABASE_ANON_KEY",
        "EXPO_PUBLIC_EAS_PROJECT_ID",
        "CORS_ALLOWED_ORIGINS",
        "APP_ENV",
        "SUPABASE_JWT_JWKS_URL",
        "SUPABASE_JWT_SECRET",
        "DEVICE_SMOKE_MEMBER_AUTH_ID",
        "DEVICE_SMOKE_MEMBER_EMAIL",
        "DEVICE_SMOKE_MEMBER_NAME",
    ):
        assert f"{name}=" in env_example
        assert name in readme

    assert "http://10.0.2.2:8000" in readme
    assert "dev:backend:lan" in readme
    assert "Production startup rejects `*`" in readme
    assert root_package_json["scripts"]["backend:release-env:check"] == (
        "cd backend && python3 -m scripts.check_release_env"
    )
    assert root_package_json["scripts"]["release:check:preview"] == (
        "npm run verify && npm run backend:release-env:check -- production && "
        "npm run mobile:release-env:check -- preview"
    )
    assert root_package_json["scripts"]["release:check:production"] == (
        "npm run verify && npm run backend:release-env:check -- production && "
        "npm run mobile:release-env:check -- production"
    )
    assert "npm run backend:release-env:check -- production" in readme
    assert "npm run backend:release-env:check\n" not in readme
    assert "npm run release:check:preview" in readme
    assert "npm run release:check:production" in readme
    assert "DATABASE_URL is not a local database host" in readme
    assert "exact HTTPS origins without `*`" in readme
    assert "does not use documentation placeholder values" in readme
    assert root_package_json["scripts"]["mobile:release-env:check"] == (
        "npm --workspace apps/mobile run release-env:check"
    )
    assert mobile_package_json["scripts"]["release-env:check"] == "node scripts/check-release-env.mjs"
    assert "npm run mobile:release-env:check -- preview" in readme
    assert "npm run mobile:release-env:check -- production" in readme
    assert "npm run mobile:release-env:check\n" not in readme
    assert "valid HTTP(S) URL" in readme
    assert "production builds must use HTTPS" in readme
    assert "valid HTTPS URL" in readme
    assert "valid EAS project UUID" in readme
    assert "development placeholder key" in readme
    assert "documentation placeholder value" in readme
    assert root_package_json["scripts"]["backend:seed-device-smoke"] == (
        "cd backend && python3 -m scripts.seed_device_smoke"
    )
    assert "npm run backend:seed-device-smoke" in readme
    assert "tops the member balance back up to 200 coins" in readme
    assert "without\ncreating duplicate seed-adjustment rows" in readme
    assert "creates fresh published events" in readme
    assert "preserving the historical completed rows" in readme
    assert "EXPO_PUBLIC_API_BASE_URL" in release_env_check
    assert "EXPO_PUBLIC_SUPABASE_URL" in release_env_check
    assert "EXPO_PUBLIC_SUPABASE_ANON_KEY" in release_env_check
    assert "EXPO_PUBLIC_EAS_PROJECT_ID" in release_env_check
    assert "EXPO_PUBLIC_API_BASE_URL must be a valid HTTP(S) URL" in release_env_check
    assert "EXPO_PUBLIC_API_BASE_URL must use HTTPS for production builds" in release_env_check
    assert "EXPO_PUBLIC_API_BASE_URL must not use a documentation placeholder value" in release_env_check
    assert "EXPO_PUBLIC_SUPABASE_URL must be a valid HTTPS URL" in release_env_check
    assert "EXPO_PUBLIC_SUPABASE_URL must not use a documentation placeholder value" in release_env_check
    assert "EXPO_PUBLIC_SUPABASE_ANON_KEY must not use the development placeholder key" in release_env_check
    assert "EXPO_PUBLIC_SUPABASE_ANON_KEY must not use a documentation placeholder value" in release_env_check
    assert "EXPO_PUBLIC_EAS_PROJECT_ID must not use a documentation placeholder value" in release_env_check
    assert "EXPO_PUBLIC_EAS_PROJECT_ID must be a valid EAS project UUID" in release_env_check
    assert "DATABASE_URL must not use a documentation placeholder value" in backend_release_env_check
    assert "CORS_ALLOWED_ORIGINS must not use documentation placeholder values" in backend_release_env_check
    assert "SUPABASE_JWT_SECRET must not use a documentation placeholder value" in backend_release_env_check
    assert "SUPABASE_JWT_JWKS_URL must not use a documentation placeholder value" in backend_release_env_check
    assert "Production SUPABASE_JWT_SECRET must not use a documentation placeholder value" in backend_runtime_config
    assert "Production SUPABASE_JWT_JWKS_URL must not use a documentation placeholder value" in backend_runtime_config
    for host in ("localhost", "127.0.0.1", "0.0.0.0", "10.0.2.2"):
        assert host in release_env_check


def test_product_and_api_specs_align_match_log_write_permissions() -> None:
    requirements = (ROOT_DIR / "requirements.md").read_text(encoding="utf-8")
    api_spec = (ROOT_DIR / "api-spec.md").read_text(encoding="utf-8")
    readme = (ROOT_DIR / "README.md").read_text(encoding="utf-8")
    match_service = (
        ROOT_DIR / "backend" / "app" / "events" / "match_service.py"
    ).read_text(encoding="utf-8")

    for phrase in (
        "普通队员的比赛实时看板为只读",
        "只有球队管理员可以新增或删除比赛实时记录",
    ):
        assert phrase in requirements

    for phrase in (
        "member：队员账号，读取球队内容、维护自己的报名、只读查看比赛实时看板、兑换商品",
        "仅 admin 可用",
        "普通 member 可以读取实时看板，但不能新增比赛实时记录",
    ):
        assert phrase in api_spec

    assert "admin-only goals/cards/substitutions" in readme
    assert "member read-only live board access" in readme
    assert "admin 可在 published match 新增或删除实时记录" in api_spec
    assert "member 只能只读查看实时看板" in api_spec
    assert "admin match log write" in (
        ROOT_DIR / "e2e" / "maestro" / "README.md"
    ).read_text(encoding="utf-8")
    assert "member read-only live board" in (
        ROOT_DIR / "e2e" / "maestro" / "README.md"
    ).read_text(encoding="utf-8")
    assert "MembershipRole.admin" in match_service


def test_match_log_creation_is_documented_and_implemented_as_idempotent() -> None:
    requirements = (ROOT_DIR / "requirements.md").read_text(encoding="utf-8")
    api_spec = (ROOT_DIR / "api-spec.md").read_text(encoding="utf-8")
    tech_stack = (ROOT_DIR / "tech_stack.md").read_text(encoding="utf-8")
    match_schemas = (
        ROOT_DIR / "backend" / "app" / "events" / "match_schemas.py"
    ).read_text(encoding="utf-8")
    match_service = (
        ROOT_DIR / "backend" / "app" / "events" / "match_service.py"
    ).read_text(encoding="utf-8")
    match_repository = (
        ROOT_DIR / "backend" / "app" / "events" / "match_repository.py"
    ).read_text(encoding="utf-8")
    match_api = (
        ROOT_DIR / "apps" / "mobile" / "src" / "features" / "events" / "matchApi.ts"
    ).read_text(encoding="utf-8")

    assert "id: UUID | None = None" in match_schemas
    assert "MatchLogConflictError" in match_service
    assert "existing = match_repository.get_log(session, payload.id)" in match_service
    assert "return session.get(MatchLogEntry, log_id)" in match_repository
    assert "existing.event_id != event_id or existing.created_by != user.id" in match_service
    assert "if any(getattr(existing, field) != value for field, value in create_data.items()):" in match_service
    assert "id: input.id ?? generateClientUuid()" in match_api

    for phrase in (
        "客户端应为每条实时记录生成 UUID `id`",
        "重复提交相同 `id` 且 payload 完全一致",
        "相同 `id` 但 event、创建人或 payload 不一致时返回 409",
    ):
        assert phrase in api_spec
    assert "相同 `id` 和完全一致 payload 的重试必须幂等返回已有记录" in requirements
    assert "Match log creation accepts a client-generated UUID id" in tech_stack
    assert "do not duplicate goals, cards, or" in tech_stack
    assert "Match log create idempotency and conflicting-id tests" in tech_stack


def test_github_actions_runs_the_full_verification_suite() -> None:
    workflow = (ROOT_DIR / ".github" / "workflows" / "verify.yml").read_text(encoding="utf-8")
    readme = (ROOT_DIR / "README.md").read_text(encoding="utf-8")

    for phrase in (
        "pull_request:",
        "push:",
        "actions/setup-node@v4",
        'node-version: "22"',
        "actions/setup-python@v5",
        'python-version: "3.12"',
        "npm ci",
        'python -m pip install -e ".[dev]"',
        "npm run verify",
    ):
        assert phrase in workflow

    assert "GitHub Actions" in readme
    assert "npm run verify" in readme


def test_readme_documents_bootstrap_environment_before_bootstrap_commands() -> None:
    readme = (ROOT_DIR / "README.md").read_text(encoding="utf-8")

    env_index = readme.index("Set the required bootstrap environment variables")
    command_index = readme.index("npm run backend:bootstrap")

    assert env_index < command_index
    for phrase in (
        "export BOOTSTRAP_ADMIN_AUTH_ID=<supabase-user-uuid>",
        "export BOOTSTRAP_ADMIN_EMAIL=<admin-email>",
        "export BOOTSTRAP_ADMIN_NAME=<admin-name>",
        "npm run backend:migrate",
        "npm run backend:bootstrap",
    ):
        assert phrase in readme


def test_verify_runs_mobile_lint() -> None:
    package_json = json.loads((ROOT_DIR / "package.json").read_text(encoding="utf-8"))
    scripts = package_json["scripts"]
    readme = (ROOT_DIR / "README.md").read_text(encoding="utf-8")

    assert scripts["mobile:lint"] == "npm --workspace apps/mobile run lint"
    assert "npm run mobile:lint" in scripts["verify"]
    assert "mobile lint" in readme


def test_verify_script_covers_required_quality_gates_in_order() -> None:
    package_json = json.loads((ROOT_DIR / "package.json").read_text(encoding="utf-8"))
    readme = (ROOT_DIR / "README.md").read_text(encoding="utf-8")
    verify_steps = package_json["scripts"]["verify"].split(" && ")

    assert verify_steps == [
        "npm run deps:check",
        "npm run backend:lint",
        "npm run backend:typecheck",
        "npm run backend:test",
        "npm run backend:demo-flow",
        "npm run backend:load-check",
        "npm run backend:smoke",
        "npm run backend:migration:sql",
        "npm run api-client:check",
        "npm run mobile:lint",
        "npm run mobile:typecheck",
        "npm run mobile:smoke",
        "npm run mobile:test",
    ]
    for step in verify_steps:
        assert step in readme


def test_security_audit_is_scripted_but_not_part_of_offline_verify() -> None:
    package_json = json.loads((ROOT_DIR / "package.json").read_text(encoding="utf-8"))
    scripts = package_json["scripts"]
    readme = (ROOT_DIR / "README.md").read_text(encoding="utf-8")

    assert scripts["security:audit"] == "npm audit --omit=dev --audit-level=critical"
    assert "npm run security:audit" in readme
    assert "security:audit" not in scripts["verify"]
    assert "contacts" in readme
    assert "npm registry" in readme
    assert "sends dependency metadata" in readme
    assert "external metadata disclosure" in readme


def test_offline_dependency_tree_check_is_part_of_verify() -> None:
    package_json = json.loads((ROOT_DIR / "package.json").read_text(encoding="utf-8"))
    scripts = package_json["scripts"]
    readme = (ROOT_DIR / "README.md").read_text(encoding="utf-8")

    assert "npm ls --omit=dev --all --silent" in scripts["deps:check"]
    assert "/tmp/workout-tracker-npm-ls.log" in scripts["deps:check"]
    assert "npm run deps:check" in scripts["verify"]
    assert "npm run deps:check" in readme
    assert "offline npm production dependency-tree check" in readme
    assert "without contacting the registry" in readme


def test_backend_dev_dependencies_avoid_unused_httpx2_package() -> None:
    pyproject = (ROOT_DIR / "backend" / "pyproject.toml").read_text(encoding="utf-8")

    assert "httpx2" not in pyproject


def test_clean_script_removes_python_tooling_caches() -> None:
    package_json = json.loads((ROOT_DIR / "package.json").read_text(encoding="utf-8"))
    scripts = package_json["scripts"]
    readme = (ROOT_DIR / "README.md").read_text(encoding="utf-8")

    assert scripts["clean"] == "npm run clean:python"
    assert "find backend -type d" in scripts["clean:python"]
    for phrase in ("__pycache__", ".pytest_cache", ".ruff_cache", ".mypy_cache", "*.egg-info"):
        assert phrase in scripts["clean:python"]
        assert phrase in readme
    assert "npm run clean" in readme


def test_backend_dockerfile_documents_production_startup() -> None:
    dockerfile = (ROOT_DIR / "backend" / "Dockerfile").read_text(encoding="utf-8")
    dockerignore = (ROOT_DIR / "backend" / ".dockerignore").read_text(encoding="utf-8")
    readme = (ROOT_DIR / "README.md").read_text(encoding="utf-8")

    for phrase in (
        "FROM python:3.12-slim",
        "python -m pip install --no-cache-dir .",
        "EXPOSE 8000",
        "HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3",
        "urllib.request.urlopen",
        "/health",
        "python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers",
    ):
        assert phrase in dockerfile

    for phrase in (".venv/", "__pycache__/", "*.egg-info/"):
        assert phrase in dockerignore

    assert "backend/Dockerfile" in readme
    assert "docker build -f backend/Dockerfile -t workout-tracker-api backend" in readme
    assert "proxy-header support" in readme
    assert "Docker `HEALTHCHECK`" in readme
    assert "`/health` inside the container" in readme


def test_readme_mvp_status_tracks_recent_mobile_and_notification_flows() -> None:
    readme = (ROOT_DIR / "README.md").read_text(encoding="utf-8")
    demo_flow = (ROOT_DIR / "backend" / "scripts" / "demo_flow.py").read_text(encoding="utf-8")

    for phrase in (
        "list filters",
        "create/publish/update/delete event notifications",
        "Events, matches, signup",
        "member quick-select",
        "created, published, updated, or deleted",
        "active/archived team filters for reactivation",
        "180 backend tests and 120 mobile tests",
        "EAS build profiles",
        "development, preview, and production",
        "team-scoped Inbox entry",
        "admin member-candidate search",
        "notification-tap deep links",
        "image URL preview/editing",
        "team announcements",
        "native Expo push token permission/registration",
        "app-start/foreground token refresh",
        "best-effort Expo remote push delivery",
        "only after the database transaction commits",
        "batches of at most 100 messages",
        "PUSH_NOTIFICATIONS_ENABLED",
        "EXPO_PUBLIC_EAS_PROJECT_ID",
        "EAS project id",
        "documentation placeholder value",
        "expo-notifications",
        "media URL preview/editing",
        "keyboard-aware form layout",
        "persisted Supabase sessions",
        "production startup fails",
        "seed team/users/media URLs",
        "updates and hard-deletes a published event",
        "event-updated and event-deleted notifications",
        "publish a team announcement",
        "submit signup",
        "logs and deletes match live-board entries",
        "polling live board",
        "read the live board",
        "captain/admin-only goals/cards/substitutions",
        "member read-only live board access",
        "backend:load-check",
        "team home, Inbox, and live board reads",
        "hottest read surfaces",
        "network-failure/offline recovery prompts",
    ):
        assert phrase in readme
    assert "delete_event(session, temporary_event.id, admin)" in demo_flow
    assert "publish_event" not in demo_flow
    assert "delete_match_log(session, yellow_card.id, admin)" in demo_flow
    assert 'match_board["counts"]["yellow_card"] == 0' in demo_flow


def test_completion_service_locks_event_before_settlement() -> None:
    events_service = (ROOT_DIR / "backend" / "app" / "events" / "service.py").read_text(
        encoding="utf-8"
    )
    api_spec = (ROOT_DIR / "api-spec.md").read_text(encoding="utf-8")
    events_repository = (ROOT_DIR / "backend/app/events/repository.py").read_text(encoding="utf-8")
    complete_body = events_service.split("def complete_event(", maxsplit=1)[1].split(
        "\n\ndef ",
        maxsplit=1,
    )[0]

    assert "_get_event_for_update" in events_service
    assert "with_for_update()" in events_repository
    assert "event = _get_event_for_update(session, event_id)" in complete_body
    assert "锁定 Event" in api_spec


def test_completion_docs_reject_post_completion_attendance_correction() -> None:
    api_spec = (ROOT_DIR / "api-spec.md").read_text(encoding="utf-8")
    requirements = (ROOT_DIR / "requirements.md").read_text(encoding="utf-8")
    tech_stack = (ROOT_DIR / "tech_stack.md").read_text(encoding="utf-8")

    assert "不提供赛后出勤修正接口" in api_spec
    assert "MVP 不再维护独立 Attendance 实体或出勤 API" in api_spec
    assert "不维护独立出勤记录，也不自动补 absent" in requirements
    assert "There is no Attendance upsert or post-completion attendance correction path" in tech_stack
    assert "coin clawback for rewards is not driven by attendance edits" in tech_stack


def test_publish_endpoint_is_removed_and_events_are_created_published() -> None:
    events_service = (ROOT_DIR / "backend/app/events/service.py").read_text(encoding="utf-8")
    events_router = (ROOT_DIR / "backend/app/events/router.py").read_text(encoding="utf-8")
    openapi = json.loads((ROOT_DIR / "packages/api-client/openapi.json").read_text(encoding="utf-8"))
    api_spec = (ROOT_DIR / "api-spec.md").read_text(encoding="utf-8")
    assert "status=EventStatus.published" in events_service
    assert "publish_event" not in events_service
    assert "/publish" not in events_router
    assert "/api/v1/events/{event_id}/publish" not in openapi["paths"]
    assert "POST /api/v1/events/{event_id}/publish" not in api_spec


def test_delete_event_locks_event_before_notification_and_hard_delete() -> None:
    events_service = (ROOT_DIR / "backend" / "app" / "events" / "service.py").read_text(
        encoding="utf-8"
    )
    api_spec = (ROOT_DIR / "api-spec.md").read_text(encoding="utf-8")
    requirements = (ROOT_DIR / "requirements.md").read_text(encoding="utf-8")
    tech_stack = (ROOT_DIR / "tech_stack.md").read_text(encoding="utf-8")
    events_repository = (ROOT_DIR / "backend/app/events/repository.py").read_text(encoding="utf-8")
    delete_body_match = re.search(
        r"def delete_event\(.*?\n\n\ndef get_my_signup",
        events_service,
        flags=re.DOTALL,
    )

    assert delete_body_match is not None
    delete_body = delete_body_match.group(0)
    assert "event = _get_event_for_update(session, event_id)" in delete_body
    assert delete_body.index("event = _get_event_for_update(session, event_id)") < delete_body.index(
        "delete_event_notifications("
    )
    assert "repository.delete_event_graph(session, event)" in delete_body
    assert "session.delete(event)" in events_repository

    assert "删除前后端锁定 Event 行" in api_spec
    assert "删除对应的 new_event Notification" in api_spec
    assert "后端先锁定目标活动" in requirements
    assert "Deleting an uncompleted event also locks the Event row" in tech_stack


def test_event_creation_is_documented_and_implemented_as_idempotent() -> None:
    events_schemas = (
        ROOT_DIR / "backend" / "app" / "events" / "schemas.py"
    ).read_text(encoding="utf-8")
    events_service = (
        ROOT_DIR / "backend" / "app" / "events" / "service.py"
    ).read_text(encoding="utf-8")
    events_api = (
        ROOT_DIR / "apps" / "mobile" / "src" / "features" / "events" / "api.ts"
    ).read_text(encoding="utf-8")
    api_spec = (ROOT_DIR / "api-spec.md").read_text(encoding="utf-8")
    requirements = (ROOT_DIR / "requirements.md").read_text(encoding="utf-8")
    tech_stack = (ROOT_DIR / "tech_stack.md").read_text(encoding="utf-8")

    assert "id: UUID | None = None" in events_schemas
    assert "EventConflictError" in events_service
    assert "_event_matches_create_request" in events_service
    assert "existing = repository.get_event(session, payload.id)" in events_service
    assert "existing = repository.get_event(session, event_payload.id)" in events_service
    assert "details.opponent != payload.match_details.opponent" in events_service
    assert "Use /teams/{team_id}/matches to create matches" in events_service
    assert "id: input.id ?? generateClientUuid()" in events_api
    assert "id: input.event.id ?? generateClientUuid()" in events_api

    for phrase in (
        "客户端可生成 UUID `id` 并随请求提交",
        "不重复创建活动或通知",
        "相同 `event.id` 被不同请求复用时返回 409",
    ):
        assert phrase in api_spec
    assert "重复提交相同 `id` 和相同 payload 必须幂等返回且不重复通知" in requirements
    assert "创建比赛同样使用嵌套 `event.id` 幂等" in requirements
    assert "Event and match creation accept client-generated Event UUIDs" in tech_stack
    assert "requires identical MatchDetails" in tech_stack


def test_update_event_is_documented_and_implemented_as_noop_idempotent() -> None:
    events_service = (ROOT_DIR / "backend" / "app" / "events" / "service.py").read_text(
        encoding="utf-8"
    )
    api_spec = (ROOT_DIR / "api-spec.md").read_text(encoding="utf-8")
    requirements = (ROOT_DIR / "requirements.md").read_text(encoding="utf-8")
    tech_stack = (ROOT_DIR / "tech_stack.md").read_text(encoding="utf-8")
    update_body = re.search(
        r"def update_event\(.*?\n\n\ndef delete_event",
        events_service,
        flags=re.DOTALL,
    )

    assert update_body is not None
    assert "event = _get_event_for_update(session, event_id)" in update_body.group(0)
    assert "has_changes = False" in update_body.group(0)
    assert "if getattr(event, field) != value:" in update_body.group(0)
    assert "if getattr(details, field) != value:" in update_body.group(0)
    assert "if has_changes:" in update_body.group(0)
    assert "sync_event_notifications(session, event)" in update_body.group(0)

    for phrase in (
        "重复提交与当前状态完全一致的更新请求幂等返回当前 Event",
        "原有 new_event Notification 原地更新",
    ):
        assert phrase in api_spec
    assert "重复提交相同更新必须幂等返回当前活动" in requirements
    assert "Updating an event locks the Event row" in tech_stack
    assert "Retrying the same update payload" in tech_stack


def test_api_spec_documents_user_summaries_on_mobile_member_lists() -> None:
    api_spec = (ROOT_DIR / "api-spec.md").read_text(encoding="utf-8")

    for phrase in (
        "user                # nullable UserSummary",
        "报名列表和我的报名响应可由后端按 user_id 附带 UserSummary",
        "响应包含 `user` 摘要，移动端可直接展示姓名/邮箱",
        "响应中每条 EventSignup 包含 `user` 摘要",
        "附带每名队员的 `user` 摘要用于移动端排行榜展示",
    ):
        assert phrase in api_spec


def test_release_candidate_docs_require_automated_and_device_smoke_gates() -> None:
    package_json = json.loads((ROOT_DIR / "package.json").read_text(encoding="utf-8"))
    scripts = package_json["scripts"]
    readme = (ROOT_DIR / "README.md").read_text(encoding="utf-8")
    maestro_readme = (ROOT_DIR / "e2e" / "maestro" / "README.md").read_text(encoding="utf-8")
    device_checklist = (ROOT_DIR / "e2e" / "maestro" / "device-smoke-checklist.md").read_text(
        encoding="utf-8"
    )
    device_report_template = (
        ROOT_DIR / "e2e" / "maestro" / "device-smoke-report-template.md"
    ).read_text(encoding="utf-8")
    maestro_flow = (ROOT_DIR / "e2e" / "maestro" / "app-smoke.yaml").read_text(encoding="utf-8")

    assert scripts["e2e:maestro"] == "maestro test e2e/maestro"
    assert "command -v maestro" in scripts["e2e:maestro:check"]
    assert scripts["e2e:device-report:create"] == (
        "node e2e/maestro/create-device-smoke-report.mjs"
    )
    assert scripts["e2e:device-report:check"] == (
        "node e2e/maestro/check-device-smoke-report.mjs"
    )
    assert "e2e:device-report:check" not in scripts["verify"]
    assert "e2e:maestro:check" not in scripts["verify"]
    assert "npm run e2e:maestro:check" in readme
    assert "npm run e2e:maestro:check" in maestro_readme
    assert "npm run e2e:device-report:create -- rc1" in readme
    assert "npm run e2e:device-report:create -- <candidate>" in readme
    assert "npm run e2e:device-report:create -- <candidate>" in maestro_readme
    assert "npm run e2e:device-report:check -- e2e/maestro/device-smoke-report-YYYYMMDD-<candidate>.md" in readme
    assert "npm run e2e:device-report:check -- e2e/maestro/device-smoke-report-YYYYMMDD-<candidate>.md" in maestro_readme
    assert "Run the release env checks from the repository root" in readme
    assert "cd apps/mobile" in readme
    assert "npx eas build --profile production" in readme
    report_creator = (
        ROOT_DIR / "e2e" / "maestro" / "create-device-smoke-report.mjs"
    ).read_text(encoding="utf-8")
    for phrase in (
        "device-smoke-report-template.md",
        "device-smoke-report-YYYYMMDD-<candidate>.md",
        "DEVICE_SMOKE_REPORT_DATE",
        "Generated by `npm run e2e:device-report:create`",
        "Report date",
        "Source template",
        "Report already exists",
        "choose a different candidate",
        'flag: "wx"',
        "--dry-run",
    ):
        assert phrase in report_creator
    report_checker = (
        ROOT_DIR / "e2e" / "maestro" / "check-device-smoke-report.mjs"
    ).read_text(encoding="utf-8")
    for phrase in (
        "Usage: npm run e2e:device-report:check -- <report-file>",
        "Release candidate field is missing",
        "Release candidate Backend URL must be a valid HTTP(S) URL",
        "Platform results must include an iOS pass row with evidence",
        "Platform results must include an Android pass row with evidence",
        "Final release decision must include checked item",
        "Automated gate evidence is missing",
        "Smoke path evidence is incomplete",
    ):
        assert phrase in report_checker
    for document in (readme, maestro_readme):
        for phrase in (
            "Release-candidate",
            "npm run verify",
            "npm run e2e:maestro",
            "iOS device",
            "Android device",
            "login/sign-up",
            "team navigation",
            "Inbox",
            "event signup",
            "match",
            "event completion with signup rewards",
            "coin balance",
            "store redemption",
            "missing platform pass rows",
            "automated gate evidence",
        ):
            assert phrase in document

    assert "device-smoke-checklist.md" in readme
    assert "device-smoke-checklist.md" in maestro_readme
    assert "device-smoke-report-template.md" in readme
    assert "device-smoke-report-template.md" in maestro_readme
    assert "device-smoke-report-template.md" in device_checklist
    for phrase in (
        "iOS",
        "Android",
        "Build profile",
        "Backend URL",
        "Simplified Chinese",
        "language",
        "Supabase",
        "Test data preparation",
        "npm run backend:migrate",
        "npm run backend:bootstrap",
        "npm run backend:seed-device-smoke",
        "BOOTSTRAP_ADMIN_AUTH_ID",
        "DEVICE_SMOKE_MEMBER_AUTH_ID",
        "Supabase JWT verification",
        "`/auth/sync` creates the app `User`",
        "confirm the member is active on the team",
        "positive price",
        "enough finite or unlimited stock",
        "fresh published training or match event",
        "fresh published match",
        "at least 200 coins after rerunning the seed",
        "Expo Push Token",
        "real EAS project id",
        "documentation placeholder value",
        "team announcement",
        "event signup",
        "match live board",
        "As captain/admin",
        "As a member",
        "match logs are read-only",
        "destructive confirmation dialog",
        "signup rewards for `going`",
        "signup board",
        "reward rule amounts",
        "finite stock is reduced",
        "finite stock is restored",
        "persisted Supabase session",
        "deep-links",
        "Screenshot or screen recording",
    ):
        assert phrase in device_checklist

    for phrase in (
        "Source commit",
        "Build profile",
        "Backend URL",
        "Supabase project",
        "`npm run verify` evidence",
        "`npm run backend:release-env:check -- production` evidence",
        "`npm run mobile:release-env:check -- <preview|production>` evidence",
        "`npm run security:audit` evidence",
        "explicit not-run reason",
        "Device smoke data seed evidence",
        "Platform results",
        "Smoke path evidence",
        "Default Simplified Chinese UI",
        "Native push token registration",
        "Event signup states: going / maybe / not going with reason",
        "Captain/admin match live logging",
        "Member read-only live board access",
        "Event completion with signup rewards",
        "Signup board filters and rows",
        "Store item redemption",
        "Notification deep-link behavior",
        "Failures and follow-up",
    ):
        assert phrase in device_report_template
    assert "Event signup states: present / maybe / not going with reason" not in device_report_template

    for phrase in (
        "球队首页",
        "下一场活动",
        "显示语言: zh-CN",
        "Display language: en",
        "tapOn: \"Display language: en\"",
        "登录",
        "姓名",
        "学号",
        "邮箱 / 学号",
        "密码",
        "立即注册",
        "个人资料",
        "头像 URL，可留空",
        "收件箱",
        "球队活动",
        "球队商店",
    ):
        assert phrase in maestro_flow


def test_device_smoke_report_creator_dry_run_is_deterministic() -> None:
    target = ROOT_DIR / "e2e" / "maestro" / "device-smoke-report-20990101-rc-1.md"
    existed_before = target.exists()
    env = os.environ.copy()
    env["DEVICE_SMOKE_REPORT_DATE"] = "20990101"

    result = subprocess.run(
        [
            "node",
            "e2e/maestro/create-device-smoke-report.mjs",
            "RC 1",
            "--dry-run",
        ],
        cwd=ROOT_DIR,
        check=True,
        capture_output=True,
        text=True,
        env=env,
    )

    assert result.stdout.strip() == str(target)
    assert target.exists() is existed_before


def test_device_smoke_report_creator_sanitizes_candidate_names() -> None:
    target = ROOT_DIR / "e2e" / "maestro" / "device-smoke-report-20990101-rc-1-preview.md"
    existed_before = target.exists()
    env = os.environ.copy()
    env["DEVICE_SMOKE_REPORT_DATE"] = "20990101"

    result = subprocess.run(
        [
            "node",
            "e2e/maestro/create-device-smoke-report.mjs",
            " RC 1 Preview! ",
            "--dry-run",
        ],
        cwd=ROOT_DIR,
        check=True,
        capture_output=True,
        text=True,
        env=env,
    )

    assert result.stdout.strip() == str(target)
    assert target.exists() is existed_before


def test_device_smoke_report_creator_writes_candidate_metadata() -> None:
    target = ROOT_DIR / "e2e" / "maestro" / "device-smoke-report-20990102-rc-metadata.md"
    env = os.environ.copy()
    env["DEVICE_SMOKE_REPORT_DATE"] = "20990102"
    target.unlink(missing_ok=True)

    try:
        result = subprocess.run(
            [
                "node",
                "e2e/maestro/create-device-smoke-report.mjs",
                "RC Metadata",
            ],
            cwd=ROOT_DIR,
            check=True,
            capture_output=True,
            text=True,
            env=env,
        )
        report = target.read_text(encoding="utf-8")

        assert result.stdout.strip() == str(target)
        assert "> Generated by `npm run e2e:device-report:create`." in report
        assert "> Candidate: `rc-metadata`." in report
        assert "> Report date: `20990102`." in report
        assert "> Source template: `device-smoke-report-template.md`." in report
        assert "| Source commit |" in report
        assert "| Platform | Device/simulator | OS version | Build profile | Backend URL | Result | Evidence |" in report
    finally:
        target.unlink(missing_ok=True)


def test_device_smoke_report_creator_refuses_to_overwrite_existing_report() -> None:
    target = ROOT_DIR / "e2e" / "maestro" / "device-smoke-report-20990103-rc-existing.md"
    env = os.environ.copy()
    env["DEVICE_SMOKE_REPORT_DATE"] = "20990103"
    target.write_text("existing release evidence", encoding="utf-8")

    try:
        result = subprocess.run(
            [
                "node",
                "e2e/maestro/create-device-smoke-report.mjs",
                "RC Existing",
            ],
            cwd=ROOT_DIR,
            check=False,
            capture_output=True,
            text=True,
            env=env,
        )

        assert result.returncode == 1
        assert "Report already exists: device-smoke-report-20990103-rc-existing.md" in result.stderr
        assert "choose a different candidate" in result.stderr
        assert target.read_text(encoding="utf-8") == "existing release evidence"
    finally:
        target.unlink(missing_ok=True)


def test_device_smoke_report_checker_accepts_completed_report() -> None:
    target = ROOT_DIR / "e2e" / "maestro" / "device-smoke-report-20990104-rc-complete.md"
    target.write_text(completed_device_smoke_report(), encoding="utf-8")

    try:
        result = subprocess.run(
            [
                "node",
                "e2e/maestro/check-device-smoke-report.mjs",
                str(target),
            ],
            cwd=ROOT_DIR,
            check=True,
            capture_output=True,
            text=True,
        )

        assert "Device smoke report check passed" in result.stdout
    finally:
        target.unlink(missing_ok=True)


def test_device_smoke_report_checker_rejects_missing_evidence() -> None:
    target = ROOT_DIR / "e2e" / "maestro" / "device-smoke-report-20990104-rc-incomplete.md"
    target.write_text(
        completed_device_smoke_report()
        .replace("| Source commit | abc1234 |", "| Source commit |  |")
        .replace("| Backend URL | https://api.example.test |", "| Backend URL | not-a-url |")
        .replace("| Android | Pixel 8 | Android 15 | preview | https://api.example.test | pass | android-video.mp4 |\n", "")
        .replace("- [x] Release owner approved", "- [ ] Release owner approved")
        .replace("| Device smoke data seed evidence | seed-log.txt |", "| Device smoke data seed evidence |  |"),
        encoding="utf-8",
    )

    try:
        result = subprocess.run(
            [
                "node",
                "e2e/maestro/check-device-smoke-report.mjs",
                str(target),
            ],
            cwd=ROOT_DIR,
            check=False,
            capture_output=True,
            text=True,
        )

        assert result.returncode == 1
        assert "Release candidate field is missing: Source commit" in result.stderr
        assert "Release candidate Backend URL must be a valid HTTP(S) URL" in result.stderr
        assert "Platform results must include an Android pass row with evidence" in result.stderr
        assert "Final release decision must include checked item: - [x] Release owner approved" in result.stderr
        assert "Automated gate evidence is missing for: Device smoke data seed evidence" in result.stderr
    finally:
        target.unlink(missing_ok=True)


def test_device_smoke_report_checker_tracks_every_template_smoke_path_item() -> None:
    template = (
        ROOT_DIR / "e2e" / "maestro" / "device-smoke-report-template.md"
    ).read_text(encoding="utf-8")
    checker = (
        ROOT_DIR / "e2e" / "maestro" / "check-device-smoke-report.mjs"
    ).read_text(encoding="utf-8")
    template_items = re.findall(
        r"^\| ([^|]+?) \|  \|  \|  \|$",
        template,
        flags=re.MULTILINE,
    )

    assert len(template_items) == 22
    for item in template_items:
        assert item in checker


def test_api_spec_documents_recent_visibility_boundaries() -> None:
    api_spec = (ROOT_DIR / "api-spec.md").read_text(encoding="utf-8")

    for phrase in (
        "仅 active 的 role=member 可读取自己的报名状态",
        "current_membership",
        "当前用户在该球队的 active TeamMembership",
        "active 球队成员均可读取 published 或 completed match 的实时记录",
        "即使显式传 is_active=false 也不会返回下架商品",
        "new_event Notification 原地更新",
        "删除对应的 new_event Notification",
    ):
        assert phrase in api_spec


def test_api_spec_documents_event_completion_match_details_boundaries() -> None:
    api_spec = (ROOT_DIR / "api-spec.md").read_text(encoding="utf-8")

    completion_section = api_spec.split("### 8.7 完成活动", maxsplit=1)[1].split("## 9. 报名 API", maxsplit=1)[0]

    for phrase in (
        "仅 admin 可用",
        "published → completed",
        "比赛活动的请求可包含最终比赛数据",
        "训练或其他活动不得提交 match_details",
        '"match_details"',
        '"team_score": 2',
        '"opponent_score": 1',
        '"result": "win"',
        "重复调用已 completed 的活动时返回现有结果（`reward_count` 为 0），不重复发币",
        "`going_count`",
        "`reward_count`",
    ):
        assert phrase in completion_section


def test_event_completion_rewards_only_current_active_members() -> None:
    events_service = (ROOT_DIR / "backend" / "app" / "events" / "service.py").read_text(
        encoding="utf-8"
    )
    api_spec = (ROOT_DIR / "api-spec.md").read_text(encoding="utf-8")
    requirements = (ROOT_DIR / "requirements.md").read_text(encoding="utf-8")
    tech_stack = (ROOT_DIR / "tech_stack.md").read_text(encoding="utf-8")
    eligibility = (ROOT_DIR / "backend/app/teams/eligibility.py").read_text(encoding="utf-8")
    complete_body = events_service.split("def complete_event(", maxsplit=1)[1].split(
        "\n\ndef ",
        maxsplit=1,
    )[0]
    eligible_body = events_service.split("def _eligible_member_ids_for_event(", maxsplit=1)[1].split(
        "\n\ndef ",
        maxsplit=1,
    )[0]

    assert "is_membership_eligible_for_event(membership, event)" in eligible_body
    for phrase in (
        "_as_utc(membership.joined_at) <= _as_utc(at)",
        "membership.status == MembershipStatus.active",
        "membership.role == MembershipRole.member",
    ):
        assert phrase in eligibility

    for phrase in (
        "SignupStatus.maybe",
        "SignupStatus.going",
        "issue_signup_reward",
        "_eligible_member_ids_for_event",
    ):
        assert phrase in complete_body

    assert "joined_at <= event.start_time" in api_spec
    assert "当前 active 的 `role=member`" in api_spec

    assert "无报名记录的队员按 `maybe` 处理；不自动创建 absent 或其他出勤记录" in api_spec
    assert "不维护独立出勤记录，也不自动补 absent" in requirements
    assert "treat missing signup as `maybe`" in tech_stack


def test_api_spec_documents_idempotent_redemption_compensation() -> None:
    api_spec = (ROOT_DIR / "api-spec.md").read_text(encoding="utf-8")

    cancel_section = api_spec.split(
        "### 13.9 取消待处理兑换",
        maxsplit=1,
    )[1].split("### 13.10 退款已履约兑换", maxsplit=1)[0]
    refund_section = api_spec.split(
        "### 13.10 退款已履约兑换",
        maxsplit=1,
    )[1].split("## 14. 通知与设备 API", maxsplit=1)[0]
    lifecycle_section = api_spec.split(
        "### 15.2 Redemption",
        maxsplit=1,
    )[1].split("### 15.3 Consistency rules", maxsplit=1)[0]

    for phrase in (
        "重复取消已 cancelled 的兑换单必须幂等返回当前 Redemption",
        "不得创建第二笔 refund 或重复恢复库存",
    ):
        assert phrase in cancel_section
    for phrase in (
        "重复退款已 refunded 的兑换单必须幂等返回当前 Redemption",
        "已履约商品不恢复库存",
        "对非对应终态的跨状态错误操作仍返回冲突",
    ):
        assert phrase in refund_section
    for phrase in (
        "重复取消幂等返回，不重复补偿",
        "重复退款幂等返回，不重复补偿",
    ):
        assert phrase in lifecycle_section


def test_api_spec_documents_manual_coin_transaction_idempotency_payload_match() -> None:
    api_spec = (ROOT_DIR / "api-spec.md").read_text(encoding="utf-8")
    manual_coin_section = api_spec.split("### 12.7 手工金币调整", maxsplit=1)[1].split(
        "## 13. 商店与兑换 API",
        maxsplit=1,
    )[0]

    for phrase in (
        "同一个 transaction id",
        "team_id、user_id、amount、type、reason 和 metadata",
        "完全一致时幂等返回已有",
        "任一字段不同必须返回 409 冲突",
    ):
        assert phrase in manual_coin_section


def test_coin_rule_creation_is_documented_and_implemented_as_idempotent() -> None:
    coin_schemas = (ROOT_DIR / "backend/app/coins/schemas.py").read_text(encoding="utf-8")
    coin_service = (ROOT_DIR / "backend/app/coins/service.py").read_text(encoding="utf-8")
    coin_api = (ROOT_DIR / "apps/mobile/src/features/coins/api.ts").read_text(encoding="utf-8")
    api_spec = (ROOT_DIR / "api-spec.md").read_text(encoding="utf-8")
    requirements = (ROOT_DIR / "requirements.md").read_text(encoding="utf-8")
    tech_stack = (ROOT_DIR / "tech_stack.md").read_text(encoding="utf-8")

    assert "id: UUID | None = None" in coin_schemas
    assert "CoinRuleConflictError" in coin_service
    assert "existing = repository.get_rule(session, payload.id)" in coin_service
    assert "enum_value(existing.trigger_type) != enum_value(payload.trigger_type)" in coin_service
    assert "existing.amount != payload.amount" in coin_service
    assert "existing.config != payload.config" in coin_service
    assert "id: input.id ?? generateClientUuid()" in coin_api

    for phrase in (
        "amount 必须非负",
        "不能创建第二条相同 trigger_type 的 active 训练或比赛报名规则",
        "COIN_RULE_CONFLICT",
    ):
        assert phrase in api_spec
    assert "创建金币规则由客户端提交 UUID `id`" in requirements
    assert "相同 `id` 被不同规则内容复用必须返回冲突" in requirements
    assert "Coin rule creation accepts a client-generated CoinRule UUID" in tech_stack
    assert "reward settings do not accumulate duplicates" in tech_stack


def test_team_announcement_creation_is_documented_and_implemented_as_idempotent() -> None:
    notification_schemas = (ROOT_DIR / "backend/app/notifications/schemas.py").read_text(encoding="utf-8")
    notification_service = (ROOT_DIR / "backend/app/notifications/service.py").read_text(encoding="utf-8")
    notification_repository = (
        ROOT_DIR / "backend/app/notifications/repository.py"
    ).read_text(encoding="utf-8")
    notification_api = (ROOT_DIR / "apps/mobile/src/features/notifications/api.ts").read_text(encoding="utf-8")
    notification_navigation = (
        ROOT_DIR / "apps/mobile/src/features/notifications/navigation.ts"
    ).read_text(encoding="utf-8")
    api_spec = (ROOT_DIR / "api-spec.md").read_text(encoding="utf-8")
    requirements = (ROOT_DIR / "requirements.md").read_text(encoding="utf-8")
    tech_stack = (ROOT_DIR / "tech_stack.md").read_text(encoding="utf-8")

    assert "id: UUID" in notification_schemas
    assert "TeamAnnouncementConflictError" in notification_service
    assert 'Notification.reference_type == "team_announcement"' in notification_repository
    assert "Notification.reference_id == announcement_id" in notification_repository
    assert 'reference_type="team_announcement"' in notification_service
    assert "reference_id=announcement_id" in notification_service
    assert "id: input.id ?? generateClientUuid()" in notification_api
    assert 'referenceType === "team_announcement"' in notification_navigation

    for phrase in (
        "客户端应生成公告 UUID `id` 并随请求提交",
        "`reference_type=team_announcement`",
        "不重复创建 Inbox 或 Push",
        "相同 `id` 被不同公告内容复用时返回 409",
    ):
        assert phrase in api_spec
    assert "客户端提交公告 UUID `id`" in requirements
    assert "不重复创建 Inbox 或 Push" in requirements
    assert "Team announcement creation accepts a client-generated announcement UUID" in tech_stack
    assert "without creating duplicate Inbox rows or push attempts" in tech_stack


def test_api_spec_documents_generated_mvp_endpoints() -> None:
    api_spec = (ROOT_DIR / "api-spec.md").read_text(encoding="utf-8")
    generated_client = (ROOT_DIR / "packages/api-client/src/generated.ts").read_text(encoding="utf-8")
    generated_endpoint_blocks = re.findall(
        r'\{\n    "operationId":.*?\n  \}',
        generated_client,
        flags=re.DOTALL,
    )

    critical_endpoints = (
        "POST /api/v1/auth/sync",
        "PATCH /api/v1/users/me",
        "GET /api/v1/teams/{team_id}",
        "PATCH /api/v1/teams/{team_id}",
        "POST /api/v1/teams/{team_id}/events",
        "POST /api/v1/teams/{team_id}/matches",
        "PATCH /api/v1/events/{event_id}",
        "DELETE /api/v1/events/{event_id}",
        "POST /api/v1/events/{event_id}/complete",
        "GET /api/v1/events/{event_id}/signup",
        "PUT /api/v1/events/{event_id}/signup",
        "GET /api/v1/events/{event_id}/signups",
        "GET /api/v1/teams/{team_id}/signup-board",
        "GET /api/v1/events/{event_id}/summary",
        "GET /api/v1/teams/{team_id}/coin-rules",
        "POST /api/v1/teams/{team_id}/redemptions",
        "POST /api/v1/redemptions/{redemption_id}/fulfill",
        "POST /api/v1/redemptions/{redemption_id}/cancel",
        "POST /api/v1/redemptions/{redemption_id}/refund",
        "GET /api/v1/notifications",
        "POST /api/v1/teams/{team_id}/announcements",
        "PUT /api/v1/device-tokens",
    )

    for endpoint in critical_endpoints:
        method, path = endpoint.split(" ", maxsplit=1)
        assert any(
            f'"method": "{method}"' in endpoint_block and f'"path": "{path}"' in endpoint_block
            for endpoint_block in generated_endpoint_blocks
        ), endpoint
        assert endpoint in api_spec


def test_mvp_does_not_expose_public_team_creation_endpoint() -> None:
    api_spec = (ROOT_DIR / "api-spec.md").read_text(encoding="utf-8")
    teams_router = (ROOT_DIR / "backend/app/teams/router.py").read_text(encoding="utf-8")
    generated_openapi = json.loads((ROOT_DIR / "packages/api-client/openapi.json").read_text(encoding="utf-8"))

    assert "MVP 不提供公开创建球队 API" in api_spec
    assert "当前移动端和 OpenAPI 客户端不应依赖 `POST /api/v1/organizations/{organization_id}/teams`" in api_spec
    assert '@router.post("/teams"' not in teams_router
    assert "/api/v1/teams" not in {
        path
        for path, methods in generated_openapi["paths"].items()
        if "post" in methods
    }
    assert "/api/v1/organizations/{organization_id}/teams" not in generated_openapi["paths"]


def test_api_spec_public_endpoint_list_matches_generated_client() -> None:
    api_spec = (ROOT_DIR / "api-spec.md").read_text(encoding="utf-8")
    generated_client = (ROOT_DIR / "packages/api-client/src/generated.ts").read_text(encoding="utf-8")
    generated_api_endpoints = {
        (method, path)
        for method, path in re.findall(r'"method": "([A-Z]+)",\n    "path": "([^"]+)"', generated_client)
        if path.startswith("/api/v1/")
    }
    documented_endpoints = set(
        re.findall(r"^(GET|POST|PUT|PATCH|DELETE) (/api/v1/\S+)$", api_spec, flags=re.MULTILINE)
    )

    assert documented_endpoints - generated_api_endpoints == set()
    assert generated_api_endpoints - documented_endpoints == set()


def test_tech_stack_documents_strict_redemption_idempotency() -> None:
    tech_stack = (ROOT_DIR / "tech_stack.md").read_text(encoding="utf-8")
    api_spec = (ROOT_DIR / "api-spec.md").read_text(encoding="utf-8")

    for phrase in (
        "same user, team, store item, and quantity",
        "Reusing the ID with",
        "different request details must return a conflict",
        "must not charge coins or",
        "change stock",
        "repeated refund",
        "idempotent",
        "without creating a second refund transaction",
        "or restoring",
        "inventory twice",
        "repeated fulfillment",
        "already fulfilled redemption as idempotent",
        "without creating a second fulfillment",
        "notification",
        "idempotent double-refund tests",
    ):
        assert phrase in tech_stack
    assert "rejects a second refund" not in tech_stack

    for phrase in (
        "同一用户、同一球队",
        "同一商品且数量一致",
        "同一 id 被不同请求内容复用",
        "返回冲突",
        "不得扣金币或修改库存",
        "重复履约已 fulfilled 的兑换单必须幂等返回",
        "不得重复创建 redemption_completed Notification",
        "重复退款已 refunded 的兑换单必须幂等返回",
        "不得创建第二笔 refund 或重复恢复库存",
    ):
        assert phrase in api_spec


def test_store_item_creation_is_documented_and_implemented_as_idempotent() -> None:
    store_schemas = (ROOT_DIR / "backend/app/store/schemas.py").read_text(encoding="utf-8")
    store_service = (ROOT_DIR / "backend/app/store/service.py").read_text(encoding="utf-8")
    store_api = (ROOT_DIR / "apps/mobile/src/features/store/api.ts").read_text(encoding="utf-8")
    api_spec = (ROOT_DIR / "api-spec.md").read_text(encoding="utf-8")
    requirements = (ROOT_DIR / "requirements.md").read_text(encoding="utf-8")
    tech_stack = (ROOT_DIR / "tech_stack.md").read_text(encoding="utf-8")

    assert "id: UUID | None = None" in store_schemas
    assert "existing = repository.get_store_item(session, payload.id)" in store_service
    assert "Store item id already belongs to another request" in store_service
    assert "existing.price != payload.price" in store_service
    assert "existing.stock != payload.stock" in store_service
    assert "id: input.id ?? generateClientUuid()" in store_api

    for phrase in (
        "客户端应生成 StoreItem UUID `id` 并随请求提交",
        "幂等返回已有 StoreItem",
        "避免网络重试重复上架同一商品",
    ):
        assert phrase in api_spec
    assert "创建商品由客户端提交 UUID `id`" in requirements
    assert "相同 `id` 被不同商品内容复用必须返回冲突" in requirements
    assert "Store item creation also accepts a client-generated StoreItem UUID" in tech_stack
    assert "do not duplicate catalog entries during mobile retries" in tech_stack


def test_store_redemption_source_locks_inventory_and_user_coin_ledger_before_balance_check() -> None:
    store_service = (ROOT_DIR / "backend/app/store/service.py").read_text(encoding="utf-8")
    create_redemption_body = store_service.split("def create_redemption(", maxsplit=1)[1].split(
        "\ndef list_my_redemptions(",
        maxsplit=1,
    )[0]

    assert "repository.get_store_item_for_update(session, payload.store_item_id)" in create_redemption_body
    assert "repository.lock_user_coin_ledger(session, user.id)" in create_redemption_body
    assert create_redemption_body.index("repository.lock_user_coin_ledger(session, user.id)") < create_redemption_body.index(
        "coin_repository.sum_balance(session, team_id, user.id)"
    )


def test_team_member_creation_is_documented_and_implemented_as_idempotent_on_team_user() -> None:
    team_service = (ROOT_DIR / "backend/app/teams/service.py").read_text(encoding="utf-8")
    api_spec = (ROOT_DIR / "api-spec.md").read_text(encoding="utf-8")
    requirements = (ROOT_DIR / "requirements.md").read_text(encoding="utf-8")
    tech_stack = (ROOT_DIR / "tech_stack.md").read_text(encoding="utf-8")

    assert "_membership_matches_create_request" in team_service
    assert "enum_value(membership.role) == enum_value(payload.role)" in team_service
    assert "membership.jersey_number == payload.jersey_number" in team_service
    assert "membership.player_name == payload.player_name" in team_service
    assert "enum_value(membership.status) == enum_value(payload.status)" in team_service
    assert "existing = repository.find_membership(session, team_id, payload.user_id)" in team_service
    assert "if not _membership_matches_create_request(existing, payload):" in team_service
    assert "raise DuplicateMembershipError()" in team_service

    for phrase in (
        "`TeamMembership` 以 `(team_id, user_id)` 唯一",
        "幂等返回已有 TeamMembership",
        "同一用户被不同成员内容重复添加时返回 409",
    ):
        assert phrase in api_spec
    assert "同一用户与同一球队只能存在一条 `TeamMembership`" in requirements
    assert "Team membership creation is idempotent on the existing unique (team_id, user_id)" in tech_stack
    assert "returns the existing TeamMembership" in tech_stack
    assert "duplicate" in tech_stack
    assert "membership conflict" in tech_stack


def test_team_member_update_locks_active_admins_before_last_admin_count() -> None:
    team_service = (ROOT_DIR / "backend/app/teams/service.py").read_text(encoding="utf-8")
    update_member_body = team_service.split("def update_member(", maxsplit=1)[1].split(
        "\ndef count_active_admins(",
        maxsplit=1,
    )[0]
    team_repository = (ROOT_DIR / "backend/app/teams/repository.py").read_text(encoding="utf-8")
    lock_helper_body = team_repository.split("def lock_active_admin_memberships(", maxsplit=1)[1].split(
        "\ndef add_membership(", maxsplit=1
    )[0]

    assert "if would_remove_active_admin:" in update_member_body
    assert "repository.lock_active_admin_memberships(session, team_id)" in update_member_body
    assert update_member_body.index("repository.lock_active_admin_memberships(session, team_id)") < update_member_body.index(
        "repository.count_active_admins(session, team_id) <= 1"
    )
    assert "TeamMembership.role == MembershipRole.admin" in lock_helper_body
    assert "TeamMembership.status == MembershipStatus.active" in lock_helper_body
    assert ".with_for_update()" in lock_helper_body

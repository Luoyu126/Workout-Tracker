import json
from asyncio import run
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from sqlalchemy import create_engine, event
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.coins.schemas import CoinTransactionCreateRequest
from app.coins.service import create_manual_coin_transaction
from app.common.database import Base
from app.common.enums import (
    CoinTransactionType,
    EventStatus,
    EventType,
    MembershipRole,
    MembershipStatus,
)
from app.common.errors import AppError, ConflictError, PermissionDeniedError, ResourceNotFoundError
from app.common.exception_handlers import (
    handle_app_error,
    handle_unexpected_error,
    handle_validation_error,
    register_exception_handlers,
)
from app.common.logging import configure_logging
from app.common.request_context import RequestContextMiddleware
from app.config import Settings
from app.events import repository as event_repository
from app.models import CoinTransaction, Event, Organization, Team, TeamMembership, User
from app.store import repository as store_repository
from app.teams import repository as team_repository
from app.teams.queries import load_signup_board_data


@pytest.fixture()
def session() -> Iterator[Session]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with SessionLocal() as db:
        yield db
    Base.metadata.drop_all(engine)
    engine.dispose()


def _seed_team(session: Session) -> tuple[Team, User, User]:
    organization = Organization(name="Phase 3 Org", slug=f"phase3-{uuid4()}")
    admin = User(auth_id=uuid4(), name="Admin", email=f"admin-{uuid4()}@example.test")
    member = User(auth_id=uuid4(), name="Member", email=f"member-{uuid4()}@example.test")
    session.add_all([organization, admin, member])
    session.flush()
    team = Team(organization_id=organization.id, name="Phase 3 Team")
    session.add(team)
    session.flush()
    joined_at = datetime.now(UTC) - timedelta(days=10)
    session.add_all(
        [
            TeamMembership(
                team_id=team.id,
                user_id=admin.id,
                role=MembershipRole.admin,
                status=MembershipStatus.active,
                joined_at=joined_at,
            ),
            TeamMembership(
                team_id=team.id,
                user_id=member.id,
                role=MembershipRole.member,
                status=MembershipStatus.active,
                joined_at=joined_at,
            ),
        ]
    )
    session.commit()
    return team, admin, member


def test_signup_board_query_uses_exactly_four_database_round_trips(session: Session) -> None:
    team, admin, _ = _seed_team(session)
    for offset in (2, 1):
        session.add(
            Event(
                team_id=team.id,
                type=EventType.training,
                title=f"Completed {offset}",
                start_time=datetime.now(UTC) - timedelta(days=offset),
                end_time=datetime.now(UTC) - timedelta(days=offset) + timedelta(hours=1),
                status=EventStatus.completed,
                created_by=admin.id,
            )
        )
    session.commit()
    query_count = 0

    def count_query(*_args: object) -> None:
        nonlocal query_count
        query_count += 1

    event.listen(session.get_bind(), "before_cursor_execute", count_query)
    try:
        data = load_signup_board_data(
            session,
            team_id=team.id,
            starts_after=None,
            starts_before=None,
        )
    finally:
        event.remove(session.get_bind(), "before_cursor_execute", count_query)

    assert len(data.events) == 2
    assert query_count == 4


def test_repositories_preserve_active_filters_and_for_update_locks(session: Session) -> None:
    team, admin, member = _seed_team(session)
    inactive = User(auth_id=uuid4(), name="Inactive", email=f"inactive-{uuid4()}@example.test")
    session.add(inactive)
    session.flush()
    session.add(
        TeamMembership(
            team_id=team.id,
            user_id=inactive.id,
            role=MembershipRole.member,
            status=MembershipStatus.inactive,
            joined_at=datetime.now(UTC) - timedelta(days=2),
        )
    )
    session.commit()
    assert set(team_repository.list_active_user_ids(session, team.id)) == {admin.id, member.id}

    mocked_session = MagicMock(spec=Session)
    event_repository.get_event_for_update(mocked_session, uuid4())
    event_statement = mocked_session.scalar.call_args.args[0]
    assert "FOR UPDATE" in str(event_statement.compile(dialect=postgresql.dialect()))

    mocked_session.reset_mock()
    store_repository.get_store_item_for_update(mocked_session, uuid4())
    store_statement = mocked_session.scalar.call_args.args[0]
    assert "FOR UPDATE" in str(store_statement.compile(dialect=postgresql.dialect()))


def test_application_service_rolls_back_when_domain_helper_fails(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    team, admin, member = _seed_team(session)

    def fail_notification(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("notification write failed")

    monkeypatch.setattr("app.coins.service.create_user_notification", fail_notification)
    payload = CoinTransactionCreateRequest(
        id=uuid4(),
        user_id=member.id,
        amount=15,
        type=CoinTransactionType.admin_adjustment,
        reason="Atomicity test",
    )

    with pytest.raises(RuntimeError, match="notification write failed"):
        create_manual_coin_transaction(session, team.id, admin, payload)

    assert session.get(CoinTransaction, payload.id) is None


def test_global_error_handlers_request_ids_and_safe_local_logs(tmp_path: Path) -> None:
    configure_logging(Settings(LOG_DIR=str(tmp_path), LOG_MAX_BYTES=1_048_576, LOG_BACKUP_COUNT=2))
    app = FastAPI()
    register_exception_handlers(app)
    assert AppError in app.exception_handlers
    cases = (
        (
            PermissionDeniedError(
                "Forbidden",
                code="TEST_FORBIDDEN",
                operation="tests.forbidden",
                context={"team_id": "safe-team"},
            ),
            403,
            "TEST_FORBIDDEN",
        ),
        (
            ResourceNotFoundError(
                code="TEST_NOT_FOUND",
                message="Missing",
                operation="tests.missing",
            ),
            404,
            "TEST_NOT_FOUND",
        ),
        (
            ConflictError(
                code="TEST_CONFLICT",
                message="Conflict",
                operation="tests.conflict",
            ),
            409,
            "TEST_CONFLICT",
        ),
    )
    for error, expected_status, expected_code in cases:
        request = Request(
            {
                "type": "http",
                "method": "GET",
                "path": f"/{expected_code.lower()}",
                "headers": [(b"authorization", b"Bearer secret")],
                "query_string": b"",
                "state": {"request_id": f"request-{expected_status}"},
            }
        )
        response = run(handle_app_error(request, error))
        assert response.status_code == expected_status
        assert json.loads(response.body)["detail"]["code"] == expected_code

    validation_request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/validated",
            "headers": [],
            "query_string": b"",
            "state": {"request_id": "request-422"},
        }
    )
    validation_response = run(handle_validation_error(validation_request, RequestValidationError([])))
    assert validation_response.status_code == 422
    assert json.loads(validation_response.body)["detail"]["code"] == "VALIDATION_ERROR"

    unexpected_request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/unexpected",
            "headers": [],
            "query_string": b"",
            "state": {"request_id": "request-500"},
        }
    )
    unexpected_response = run(
        handle_unexpected_error(unexpected_request, RuntimeError("private database detail"))
    )
    assert unexpected_response.status_code == 500
    assert json.loads(unexpected_response.body) == {
        "detail": {"code": "INTERNAL_ERROR", "message": "Unexpected error"}
    }

    sent_messages: list[dict[str, object]] = []

    async def downstream(_scope: object, _receive: object, send: object) -> None:
        await send({"type": "http.response.start", "status": 204, "headers": []})  # type: ignore[operator]
        await send({"type": "http.response.body", "body": b""})  # type: ignore[operator]

    async def receive() -> dict[str, object]:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: dict[str, object]) -> None:
        sent_messages.append(message)

    middleware = RequestContextMiddleware(downstream)  # type: ignore[arg-type]
    run(
        middleware(
            {
                "type": "http",
                "method": "GET",
                "path": "/request-id",
                "headers": [(b"x-request-id", b"client-request-id")],
            },
            receive,  # type: ignore[arg-type]
            send,  # type: ignore[arg-type]
        )
    )
    response_headers = dict(sent_messages[0]["headers"])  # type: ignore[arg-type]
    assert response_headers[b"x-request-id"] == b"client-request-id"

    log_text = (tmp_path / "app.log").read_text(encoding="utf-8")
    records = [json.loads(line) for line in log_text.splitlines()]
    assert {record["error_code"] for record in records} >= {
        "TEST_FORBIDDEN",
        "TEST_NOT_FOUND",
        "TEST_CONFLICT",
        "VALIDATION_ERROR",
        "INTERNAL_ERROR",
    }
    assert all(record.get("request_id") for record in records)
    assert all(record.get("http_method") == "GET" for record in records)
    assert "Bearer secret" not in log_text
    assert any("stack_trace" in record for record in records if record["error_code"] == "INTERNAL_ERROR")

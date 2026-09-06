from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.common.database import Base
from app.common.enums import (
    EventStatus,
    EventType,
    MembershipRole,
    MembershipStatus,
    NotificationType,
    SignupStatus,
)
from app.events.router import (
    delete_event_route,
    patch_event,
    post_complete_event,
    post_event,
    put_my_signup,
    read_event,
    read_signups,
)
from app.events.schemas import (
    EventCreateRequest,
    EventSignupRead,
    EventSignupUpsertRequest,
    EventUpdateRequest,
)
from app.main import create_app
from app.models import (
    CoinRule,
    CoinTransaction,
    Event,
    EventSignup,
    Notification,
    Organization,
    Team,
    TeamMembership,
    User,
)


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


def _user(name: str) -> User:
    return User(auth_id=uuid4(), name=name, email=f"{name.lower()}-{uuid4()}@example.test")


def _seed_team(session: Session) -> tuple[Team, User, User]:
    organization = Organization(name="Event Org", slug=f"event-{uuid4()}")
    admin = _user("Admin")
    member = _user("Member")
    session.add_all([organization, admin, member])
    session.flush()
    team = Team(organization_id=organization.id, name="Event Team")
    session.add(team)
    session.flush()
    joined_at = datetime.now(UTC) - timedelta(days=1)
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


def _payload(title: str = "训练", *, starts_in: timedelta = timedelta(days=1)) -> EventCreateRequest:
    start = datetime.now(UTC) + starts_in
    return EventCreateRequest(
        type=EventType.training,
        title=title,
        start_time=start,
        end_time=start + timedelta(hours=2),
    )


def test_event_is_created_published_without_deadline_or_publish_route(session: Session) -> None:
    team, admin, member = _seed_team(session)
    event = post_event(team.id, _payload(), admin, session)
    response = read_event(event.id, member, session)

    assert event.status == EventStatus.published
    assert "signup_deadline" not in response
    assert "/api/v1/events/{event_id}/publish" not in create_app().openapi()["paths"]


def test_only_admin_can_create_or_edit_events(session: Session) -> None:
    team, admin, member = _seed_team(session)
    with pytest.raises(HTTPException) as create_error:
        post_event(team.id, _payload(), member, session)
    assert create_error.value.status_code == 403

    event = post_event(team.id, _payload(), admin, session)
    with pytest.raises(HTTPException) as update_error:
        patch_event(event.id, EventUpdateRequest(title="无权修改"), member, session)
    assert update_error.value.status_code == 403


def test_member_signup_uses_start_time_as_cutoff_and_admin_is_rejected(session: Session) -> None:
    team, admin, member = _seed_team(session)
    event = post_event(team.id, _payload(), admin, session)
    signup = put_my_signup(
        event.id,
        EventSignupUpsertRequest(status=SignupStatus.going),
        member,
        session,
    )
    assert signup.status == SignupStatus.going

    with pytest.raises(HTTPException) as admin_error:
        put_my_signup(
            event.id,
            EventSignupUpsertRequest(status=SignupStatus.going),
            admin,
            session,
        )
    assert admin_error.value.status_code == 403

    past_event = Event(
        team_id=team.id,
        type=EventType.training,
        title="已开始",
        start_time=datetime.now(UTC) - timedelta(hours=2),
        end_time=datetime.now(UTC) - timedelta(hours=1),
        status=EventStatus.published,
        created_by=admin.id,
    )
    session.add(past_event)
    session.commit()
    with pytest.raises(HTTPException) as cutoff_error:
        put_my_signup(
            past_event.id,
            EventSignupUpsertRequest(status=SignupStatus.going),
            member,
            session,
        )
    assert cutoff_error.value.status_code == 409


def test_event_notification_is_updated_in_place_and_deleted_with_event(session: Session) -> None:
    team, admin, member = _seed_team(session)
    event = post_event(team.id, _payload("原活动"), admin, session)
    notification = session.scalar(
        select(Notification).where(
            Notification.user_id == member.id,
            Notification.type == NotificationType.new_event,
            Notification.reference_id == event.id,
        )
    )
    assert notification is not None
    assert notification.body == "原活动 已发布，请尽快确认是否参加。"
    original_id = notification.id
    original_updated_at = notification.updated_at

    patch_event(event.id, EventUpdateRequest(title="更新活动"), admin, session)
    updated = session.get(Notification, original_id)
    assert updated is not None
    assert updated.body == "更新活动 已发布，请尽快确认是否参加。"
    assert updated.updated_at.replace(tzinfo=None) >= original_updated_at.replace(tzinfo=None)
    assert session.scalars(select(Notification).where(Notification.reference_id == event.id)).all() == [updated]

    delete_event_route(event.id, admin, session)
    assert session.get(Event, event.id) is None
    assert session.scalars(select(Notification).where(Notification.reference_id == event.id)).all() == []


def test_event_notifications_exclude_admin_inactive_and_not_yet_joined_members(
    session: Session,
) -> None:
    team, admin, member = _seed_team(session)
    inactive = _user("Inactive")
    future_member = _user("Future")
    session.add_all([inactive, future_member])
    session.flush()
    session.add_all(
        [
            TeamMembership(
                team_id=team.id,
                user_id=inactive.id,
                role=MembershipRole.member,
                status=MembershipStatus.inactive,
                joined_at=datetime.now(UTC) - timedelta(days=2),
            ),
            TeamMembership(
                team_id=team.id,
                user_id=future_member.id,
                role=MembershipRole.member,
                status=MembershipStatus.active,
                joined_at=datetime.now(UTC) + timedelta(days=1),
            ),
        ]
    )
    session.commit()

    event = post_event(team.id, _payload(), admin, session)
    recipients = set(
        session.scalars(
            select(Notification.user_id).where(
                Notification.type == NotificationType.new_event,
                Notification.reference_id == event.id,
            )
        ).all()
    )
    assert recipients == {member.id}


def test_completed_events_are_immutable_and_completion_is_idempotent(session: Session) -> None:
    team, admin, member = _seed_team(session)
    session.add(
        CoinRule(
            team_id=team.id,
            name="训练报名",
            trigger_type="training_signup",
            amount=10,
            is_active=True,
            created_by=admin.id,
        )
    )
    session.commit()
    event = post_event(team.id, _payload(), admin, session)
    put_my_signup(
        event.id,
        EventSignupUpsertRequest(status=SignupStatus.going),
        member,
        session,
    )

    first = post_complete_event(event.id, admin, session)
    second = post_complete_event(event.id, admin, session)
    assert first["reward_count"] == 1
    assert second["reward_count"] == 0
    assert session.query(CoinTransaction).count() == 1

    with pytest.raises(HTTPException) as edit_error:
        patch_event(event.id, EventUpdateRequest(title="不可修改"), admin, session)
    assert edit_error.value.status_code == 409
    with pytest.raises(HTTPException) as delete_error:
        delete_event_route(event.id, admin, session)
    assert delete_error.value.status_code == 409


@pytest.mark.parametrize("seconds_before_end", [1, 0, -1])
@pytest.mark.parametrize("existing_signup", [False, True])
def test_signup_end_boundary_after_start(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
    seconds_before_end: int,
    existing_signup: bool,
) -> None:
    team, admin, member = _seed_team(session)
    event = post_event(team.id, _payload(), admin, session)
    if existing_signup:
        put_my_signup(
            event.id, EventSignupUpsertRequest(status=SignupStatus.maybe), member, session
        )
    now = datetime.now(UTC)
    event.start_time = now - timedelta(hours=1)
    event.end_time = now + timedelta(seconds=seconds_before_end)
    session.commit()
    monkeypatch.setattr(
        "app.events.service._now_for",
        lambda value: now if value.tzinfo else now.replace(tzinfo=None),
    )
    payload = EventSignupUpsertRequest(status=SignupStatus.going)
    if seconds_before_end > 0:
        signup = put_my_signup(event.id, payload, member, session)
        session.expire_all()
        assert session.get(type(signup), signup.id).status == SignupStatus.going
    else:
        with pytest.raises(HTTPException) as error:
            put_my_signup(event.id, payload, member, session)
        assert error.value.status_code == 409


@pytest.mark.parametrize("event_status", [EventStatus.published, EventStatus.completed])
def test_signup_list_includes_current_members_without_writing_defaults(session: Session, event_status: EventStatus) -> None:
    team, admin, member = _seed_team(session)
    event = post_event(team.id, _payload(), admin, session)
    event.start_time = datetime.now(UTC) - timedelta(hours=2)
    event.end_time = datetime.now(UTC) + timedelta(hours=1)
    event.status = event_status
    users = {}
    for name, status in [
        ("Leave", MembershipStatus.active), ("Maybe", MembershipStatus.active),
        ("Unconfirmed", MembershipStatus.active), ("Pending", MembershipStatus.pending),
        ("Inactive", MembershipStatus.inactive),
    ]:
        user = _user(name)
        session.add(user)
        session.flush()
        session.add(TeamMembership(
            team_id=team.id, user_id=user.id, role=MembershipRole.member, status=status,
            joined_at=datetime.now(UTC) - timedelta(hours=1) if status == MembershipStatus.active else None,
        ))
        users[name] = user
    session.add_all([
        EventSignup(event_id=event.id, user_id=member.id, status=SignupStatus.going),
        EventSignup(event_id=event.id, user_id=users["Leave"].id, status=SignupStatus.not_going, note="有事请假"),
        EventSignup(event_id=event.id, user_id=users["Maybe"].id, status=SignupStatus.maybe),
        EventSignup(event_id=event.id, user_id=users["Inactive"].id, status=SignupStatus.going),
    ])
    other_event = post_event(team.id, _payload("Other event"), admin, session)
    session.add(EventSignup(event_id=other_event.id, user_id=users["Unconfirmed"].id, status=SignupStatus.going))
    _seed_team(session)
    session.commit()
    before = len(session.scalars(select(EventSignup)).all())
    rows = read_signups(event.id, None, admin, session)
    by_user = {row["user_id"]: row for row in rows}
    assert set(by_user) == {member.id, users["Leave"].id, users["Maybe"].id, users["Unconfirmed"].id}
    assert by_user[member.id]["status"] == SignupStatus.going
    assert by_user[users["Leave"].id]["note"] == "有事请假"
    missing = by_user[users["Unconfirmed"].id]
    assert missing["status"] == SignupStatus.maybe
    assert all(missing[key] is None for key in ["id", "note", "created_at", "updated_at"])
    parsed = [EventSignupRead.model_validate(row) for row in rows]
    names = [row.user.name for row in parsed if row.user]
    assert names == sorted(names)
    for status in SignupStatus:
        assert read_signups(event.id, status, admin, session) == [row for row in rows if row["status"] == status]
    assert len(session.scalars(select(EventSignup)).all()) == before
    assert not session.new and not session.dirty


def test_signup_list_rejects_members_outsiders_and_inactive_admins(session: Session) -> None:
    team, admin, member = _seed_team(session)
    event = post_event(team.id, _payload(), admin, session)
    _, other_admin, _ = _seed_team(session)
    for actor in [member, other_admin]:
        with pytest.raises(HTTPException) as error:
            read_signups(event.id, None, actor, session)
        assert error.value.status_code == 403
    membership = session.scalar(select(TeamMembership).where(
        TeamMembership.team_id == team.id, TeamMembership.user_id == admin.id,
    ))
    assert membership is not None
    membership.status = MembershipStatus.inactive
    session.commit()
    with pytest.raises(HTTPException) as error:
        read_signups(event.id, None, admin, session)
    assert error.value.status_code == 403

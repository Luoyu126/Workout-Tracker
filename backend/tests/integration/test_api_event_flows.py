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
)
from app.events.schemas import EventCreateRequest, EventSignupUpsertRequest, EventUpdateRequest
from app.main import create_app
from app.models import (
    CoinRule,
    CoinTransaction,
    Event,
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
    original_id = notification.id
    original_updated_at = notification.updated_at

    patch_event(event.id, EventUpdateRequest(title="更新活动"), admin, session)
    updated = session.get(Notification, original_id)
    assert updated is not None
    assert "更新活动" in updated.body
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

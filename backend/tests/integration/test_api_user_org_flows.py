from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.common.auth import AuthClaims
from app.common.database import Base
from app.common.enums import (
    CoinTransactionType,
    EventStatus,
    EventType,
    MembershipRole,
    MembershipStatus,
    SignupStatus,
    TeamStatus,
    UserStatus,
)
from app.models import CoinTransaction, Event, EventSignup, Organization, Team, TeamMembership, User
from app.organizations.router import read_my_organizations
from app.teams.router import read_team_home
from app.users.router import current_user, read_current_user, sync_current_user, update_current_user
from app.users.schemas import UserSyncRequest, UserUpdateRequest


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


def test_auth_sync_creates_updates_and_current_user_reads_profile(session: Session) -> None:
    auth_id = uuid4()
    claims = AuthClaims(auth_id=auth_id, email="player@example.com")

    created = sync_current_user(
        UserSyncRequest(name="小陈", student_id="9", avatar_url="https://example.test/a.png"),
        claims,
        session,
    )
    assert created.auth_id == auth_id
    assert created.email == "player@example.com"
    assert created.status == UserStatus.active

    synced = sync_current_user(
        UserSyncRequest(name="陈同学", student_id="10"),
        AuthClaims(auth_id=auth_id, email="new@example.com"),
        session,
    )
    assert synced.id == created.id
    assert synced.name == "陈同学"
    assert synced.email == "new@example.com"
    assert synced.avatar_url is None

    loaded = current_user(AuthClaims(auth_id=auth_id, email="ignored@example.com"), session)
    assert read_current_user(loaded).id == created.id

    updated = update_current_user(UserUpdateRequest(name="队长陈"), loaded, session)
    assert updated.name == "队长陈"


def test_disabled_user_is_rejected_by_sync_and_current_user(session: Session) -> None:
    auth_id = uuid4()
    user = User(
        auth_id=auth_id,
        name="禁用用户",
        email="disabled@example.com",
        status=UserStatus.disabled,
    )
    session.add(user)
    session.commit()

    with pytest.raises(HTTPException) as current_exc:
        current_user(AuthClaims(auth_id=auth_id, email="disabled@example.com"), session)
    assert current_exc.value.status_code == 403
    assert current_exc.value.detail["code"] == "USER_DISABLED"

    with pytest.raises(HTTPException) as sync_exc:
        sync_current_user(
            UserSyncRequest(name="仍然禁用"),
            AuthClaims(auth_id=auth_id, email="disabled@example.com"),
            session,
        )
    assert sync_exc.value.status_code == 403
    assert sync_exc.value.detail["code"] == "USER_DISABLED"


def test_organizations_router_lists_only_active_membership_active_team_orgs(session: Session) -> None:
    user = User(auth_id=uuid4(), name="组织用户", email="org-user@example.com")
    active_org = Organization(name="Active Org", slug="active-org")
    inactive_membership_org = Organization(name="Inactive Membership Org", slug="inactive-membership-org")
    archived_team_org = Organization(name="Archived Team Org", slug="archived-team-org")
    session.add_all([user, active_org, inactive_membership_org, archived_team_org])
    session.flush()

    active_team = Team(organization_id=active_org.id, name="Active Team", status=TeamStatus.active)
    inactive_membership_team = Team(
        organization_id=inactive_membership_org.id,
        name="Inactive Membership Team",
        status=TeamStatus.active,
    )
    archived_team = Team(
        organization_id=archived_team_org.id,
        name="Archived Team",
        status=TeamStatus.archived,
    )
    session.add_all([active_team, inactive_membership_team, archived_team])
    session.flush()
    session.add_all(
        [
            TeamMembership(
                team_id=active_team.id,
                user_id=user.id,
                role=MembershipRole.member,
                status=MembershipStatus.active,
            ),
            TeamMembership(
                team_id=inactive_membership_team.id,
                user_id=user.id,
                role=MembershipRole.member,
                status=MembershipStatus.inactive,
            ),
            TeamMembership(
                team_id=archived_team.id,
                user_id=user.id,
                role=MembershipRole.member,
                status=MembershipStatus.active,
            ),
        ]
    )
    session.commit()

    organizations = read_my_organizations(user, session)

    assert organizations == [active_org]


def test_team_home_returns_real_upcoming_signup_and_coin_aggregates(session: Session) -> None:
    user = User(auth_id=uuid4(), name="首页用户", email="home-user@example.com")
    admin = User(auth_id=uuid4(), name="首页队长", email="home-admin@example.com")
    organization = Organization(name="Home Org", slug=f"home-org-{uuid4().hex[:8]}")
    session.add_all([user, admin, organization])
    session.flush()

    team = Team(organization_id=organization.id, name="Home Team")
    session.add(team)
    session.flush()
    session.add_all(
        [
            TeamMembership(
                team_id=team.id,
                user_id=user.id,
                role=MembershipRole.member,
                status=MembershipStatus.active,
            ),
            TeamMembership(
                team_id=team.id,
                user_id=admin.id,
                role=MembershipRole.admin,
                status=MembershipStatus.active,
            ),
        ]
    )
    session.flush()

    now = datetime.now(UTC)
    upcoming = Event(
        team_id=team.id,
        type=EventType.training,
        title="明天训练",
        start_time=now + timedelta(days=1),
        end_time=now + timedelta(days=1) + timedelta(hours=2),
        status=EventStatus.published,
        created_by=admin.id,
    )
    completed = Event(
        team_id=team.id,
        type=EventType.training,
        title="昨天训练",
        start_time=now - timedelta(days=1),
        end_time=now - timedelta(days=1) + timedelta(hours=2),
        status=EventStatus.completed,
        created_by=admin.id,
    )
    session.add_all([upcoming, completed])
    session.flush()
    session.add_all(
        [
            EventSignup(
                event_id=completed.id,
                user_id=user.id,
                status=SignupStatus.going,
            ),
            EventSignup(
                event_id=completed.id,
                user_id=admin.id,
                status=SignupStatus.maybe,
            ),
            CoinTransaction(
                team_id=team.id,
                user_id=user.id,
                amount=15,
                type=CoinTransactionType.admin_adjustment,
                reason="Seed user balance",
                created_by=admin.id,
            ),
            CoinTransaction(
                team_id=team.id,
                user_id=admin.id,
                amount=20,
                type=CoinTransactionType.admin_adjustment,
                reason="Seed admin balance",
                created_by=admin.id,
            ),
        ]
    )
    session.commit()

    home = read_team_home(team.id, user, session)

    assert home["current_membership"].user_id == user.id
    assert home["current_membership"].role == MembershipRole.member
    assert home["member_count"] == 2
    assert [event["title"] for event in home["upcoming_events"]] == ["明天训练"]
    assert home["signup_summary"] == {
        "going": 1,
        "maybe": 0,
        "not_going": 0,
        "total": 1,
    }
    assert home["coin_summary"] == {"balance": 15, "team_ledger_total": 35}

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.common.database import Base
from app.common.enums import MembershipRole, MembershipStatus, TeamStatus
from app.models import Organization, Team, TeamMembership, User
from app.teams.router import post_join_request, read_team, read_team_search


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
    return User(
        auth_id=uuid4(),
        name=name,
        email=f"{name.lower().replace(' ', '.')}-{uuid4().hex[:8]}@example.com",
    )


def test_team_search_returns_active_matches_with_current_membership_status(
    session: Session,
) -> None:
    user = _user("Search User")
    organization = Organization(name="University Club", slug=f"club-{uuid4().hex[:8]}")
    session.add_all([user, organization])
    session.flush()
    available = Team(
        organization_id=organization.id,
        name="Falcons Football",
        description="Open training team",
        logo_url="https://example.test/falcons.png",
    )
    pending = Team(organization_id=organization.id, name="Falcons Futsal")
    joined = Team(organization_id=organization.id, name="Falcons Alumni")
    former = Team(organization_id=organization.id, name="Falcons Reserves")
    archived = Team(
        organization_id=organization.id,
        name="Falcons Archived",
        status=TeamStatus.archived,
    )
    unrelated = Team(organization_id=organization.id, name="Tigers")
    session.add_all([available, pending, joined, former, archived, unrelated])
    session.flush()
    session.add_all(
        [
            TeamMembership(
                team_id=pending.id,
                user_id=user.id,
                role=MembershipRole.member,
                status=MembershipStatus.pending,
            ),
            TeamMembership(
                team_id=joined.id,
                user_id=user.id,
                role=MembershipRole.member,
                status=MembershipStatus.active,
            ),
            TeamMembership(
                team_id=former.id,
                user_id=user.id,
                role=MembershipRole.member,
                status=MembershipStatus.inactive,
            ),
        ]
    )
    session.commit()

    results = read_team_search("  fALCons  ", 20, user, session)

    assert [(result.name, result.membership_status) for result in results] == [
        ("Falcons Alumni", MembershipStatus.active),
        ("Falcons Football", None),
        ("Falcons Futsal", MembershipStatus.pending),
        ("Falcons Reserves", MembershipStatus.inactive),
    ]
    assert results[1].model_dump() == {
        "id": available.id,
        "name": "Falcons Football",
        "description": "Open training team",
        "logo_url": "https://example.test/falcons.png",
        "organization_name": "University Club",
        "membership_status": None,
    }
    assert read_team_search("f", 20, user, session) == []
    assert read_team_search("%_", 20, user, session) == []


def test_join_request_creates_one_pending_membership_and_blocks_private_access(
    session: Session,
) -> None:
    user = _user("Applicant")
    organization = Organization(name="Join Org", slug=f"join-{uuid4().hex[:8]}")
    session.add_all([user, organization])
    session.flush()
    team = Team(organization_id=organization.id, name="Joinable Team")
    session.add(team)
    session.commit()

    membership = post_join_request(team.id, user, session)

    assert membership.user_id == user.id
    assert membership.team_id == team.id
    assert membership.role == MembershipRole.member
    assert membership.status == MembershipStatus.pending
    assert membership.joined_at is None
    assert membership.left_at is None
    assert session.scalar(
        select(func.count()).select_from(TeamMembership).where(
            TeamMembership.team_id == team.id,
            TeamMembership.user_id == user.id,
        )
    ) == 1

    with pytest.raises(HTTPException) as pending_access_exc:
        read_team(team.id, user, session)
    assert pending_access_exc.value.status_code == 403
    assert pending_access_exc.value.detail["code"] == "TEAM_PERMISSION_DENIED"

    with pytest.raises(HTTPException) as repeated_exc:
        post_join_request(team.id, user, session)
    assert repeated_exc.value.status_code == 409
    assert repeated_exc.value.detail["code"] == "JOIN_REQUEST_PENDING"
    assert session.scalar(
        select(func.count()).select_from(TeamMembership).where(
            TeamMembership.team_id == team.id,
            TeamMembership.user_id == user.id,
        )
    ) == 1


def test_inactive_membership_is_reused_and_active_or_archived_teams_are_rejected(
    session: Session,
) -> None:
    user = _user("Returning Applicant")
    organization = Organization(name="Return Org", slug=f"return-{uuid4().hex[:8]}")
    session.add_all([user, organization])
    session.flush()
    team = Team(organization_id=organization.id, name="Return Team")
    archived_team = Team(
        organization_id=organization.id,
        name="Archived Team",
        status=TeamStatus.archived,
    )
    session.add_all([team, archived_team])
    session.flush()
    original_joined_at = datetime.now(UTC) - timedelta(days=30)
    membership = TeamMembership(
        team_id=team.id,
        user_id=user.id,
        role=MembershipRole.admin,
        status=MembershipStatus.inactive,
        joined_at=original_joined_at,
        left_at=datetime.now(UTC) - timedelta(days=1),
    )
    session.add(membership)
    session.commit()
    membership_id = membership.id

    reapplied = post_join_request(team.id, user, session)

    assert reapplied.id == membership_id
    assert reapplied.role == MembershipRole.member
    assert reapplied.status == MembershipStatus.pending
    assert reapplied.joined_at is None
    assert reapplied.left_at is None

    reapplied.status = MembershipStatus.active
    session.commit()
    with pytest.raises(HTTPException) as active_exc:
        post_join_request(team.id, user, session)
    assert active_exc.value.status_code == 409
    assert active_exc.value.detail["code"] == "ALREADY_TEAM_MEMBER"

    with pytest.raises(HTTPException) as archived_exc:
        post_join_request(archived_team.id, user, session)
    assert archived_exc.value.status_code == 404
    assert archived_exc.value.detail["code"] == "TEAM_RESOURCE_NOT_FOUND"

    with pytest.raises(HTTPException) as missing_exc:
        post_join_request(uuid4(), user, session)
    assert missing_exc.value.status_code == 404
    assert missing_exc.value.detail["code"] == "TEAM_RESOURCE_NOT_FOUND"

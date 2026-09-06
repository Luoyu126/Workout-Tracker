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
from app.teams.router import post_join_request, read_join_requests, read_team, read_team_search
from app.teams.schemas import MembershipRead, MembershipUpdateRequest
from app.teams.service import update_member


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
    assert membership.request_submitted_at is not None
    submitted_at = membership.request_submitted_at
    assert MembershipRead.model_validate(membership).request_submitted_at == submitted_at
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
    session.refresh(membership)
    assert membership.request_submitted_at is not None
    assert membership.request_submitted_at.replace(tzinfo=UTC) == submitted_at.replace(tzinfo=UTC)
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
    assert reapplied.request_submitted_at is not None

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


def test_pending_inbox_uses_latest_submission_and_enforces_team_admin(session: Session) -> None:
    admin, first, second, outsider = [_user(name) for name in ["Admin", "First", "Second", "Outsider"]]
    organization = Organization(name="Inbox Org", slug=f"inbox-{uuid4().hex[:8]}")
    session.add_all([admin, first, second, outsider, organization])
    session.flush()
    team = Team(organization_id=organization.id, name="Inbox Team")
    other_team = Team(organization_id=organization.id, name="Other Team")
    session.add_all([team, other_team])
    session.flush()
    session.add(TeamMembership(team_id=team.id, user_id=admin.id,
                               role=MembershipRole.admin, status=MembershipStatus.active))
    session.commit()
    first_request = post_join_request(team.id, first, session)
    second_request = post_join_request(team.id, second, session)
    post_join_request(other_team.id, outsider, session)
    old = datetime.now(UTC) - timedelta(days=2)
    first_request.request_submitted_at = old
    second_request.request_submitted_at = old + timedelta(days=1)
    session.commit()
    assert [row.user_id for row in read_join_requests(team.id, admin, session)] == [first.id, second.id]
    original_id = first_request.id
    original_time = first_request.request_submitted_at
    update_member(session, team.id, first.id, admin, MembershipUpdateRequest(player_name="Edited"))
    assert first_request.request_submitted_at.replace(tzinfo=UTC) == original_time.replace(tzinfo=UTC)
    update_member(session, team.id, first.id, admin, MembershipUpdateRequest(status=MembershipStatus.inactive))
    assert [row.user_id for row in read_join_requests(team.id, admin, session)] == [second.id]
    reapplied = post_join_request(team.id, first, session)
    assert reapplied.id == original_id
    assert reapplied.request_submitted_at is not None
    assert reapplied.request_submitted_at.replace(tzinfo=UTC) > old + timedelta(days=1)
    assert [row.user_id for row in read_join_requests(team.id, admin, session)] == [second.id, first.id]
    update_member(session, team.id, second.id, admin, MembershipUpdateRequest(status=MembershipStatus.active))
    assert [row.user_id for row in read_join_requests(team.id, admin, session)] == [first.id]
    for target_team, user in [(team, first), (team, second), (team, outsider), (other_team, admin)]:
        with pytest.raises(HTTPException) as denied:
            read_join_requests(target_team.id, user, session)
        assert denied.value.status_code == 403
    # Historical unknown times remain null; the deterministic fallback is creation time.
    first_request.request_submitted_at = None
    session.commit()
    assert read_join_requests(team.id, admin, session)[0].request_submitted_at is None

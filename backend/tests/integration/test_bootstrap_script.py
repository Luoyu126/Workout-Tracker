from collections.abc import Iterator
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker

from app.common.enums import (
    CoinRuleTrigger,
    CoinTransactionType,
    EventStatus,
    EventType,
    MembershipRole,
    MembershipStatus,
    UserStatus,
)
from app.config import get_settings
from app.models import (
    Base,
    CoinRule,
    CoinTransaction,
    Event,
    MatchDetails,
    Organization,
    StoreItem,
    Team,
    TeamMembership,
    User,
)
from scripts.bootstrap import bootstrap
from scripts.seed_device_smoke import DeviceSmokeSeedResult, seed_device_smoke


@pytest.fixture
def session() -> Iterator[Session]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with SessionLocal() as db:
        yield db
    Base.metadata.drop_all(engine)


def test_bootstrap_creates_initial_team_admin_and_default_coin_rules(session: Session) -> None:
    admin_auth_id = uuid4()

    result = bootstrap(
        session,
        organization_name="Campus Club",
        organization_slug="campus-club",
        team_name="Campus FC",
        admin_auth_id=admin_auth_id,
        admin_email="admin@example.com",
        admin_name="Admin",
        training_reward=10,
        match_reward=20,
    )

    organization = session.get(Organization, result.organization_id)
    team = session.get(Team, result.team_id)
    admin = session.get(User, result.admin_id)
    membership = session.scalar(
        select(TeamMembership).where(TeamMembership.team_id == result.team_id, TeamMembership.user_id == result.admin_id)
    )
    rules = session.scalars(select(CoinRule).where(CoinRule.team_id == result.team_id)).all()

    assert organization is not None
    assert organization.slug == "campus-club"
    assert team is not None
    assert team.name == "Campus FC"
    assert admin is not None
    assert admin.auth_id == admin_auth_id
    assert admin.email == "admin@example.com"
    assert admin.status == UserStatus.active
    assert membership is not None
    assert membership.role == MembershipRole.admin
    assert membership.status == MembershipStatus.active
    assert {rule.trigger_type: rule.amount for rule in rules} == {
        CoinRuleTrigger.training_signup: 10,
        CoinRuleTrigger.match_signup: 20,
    }


def test_bootstrap_strips_required_text_fields(session: Session) -> None:
    result = bootstrap(
        session,
        organization_name="  Campus Club  ",
        organization_slug="  campus-club  ",
        team_name="  Campus FC  ",
        admin_auth_id=uuid4(),
        admin_email="  admin@example.com  ",
        admin_name="  Admin  ",
        training_reward=10,
        match_reward=20,
    )

    organization = session.get(Organization, result.organization_id)
    team = session.get(Team, result.team_id)
    admin = session.get(User, result.admin_id)

    assert organization is not None
    assert organization.name == "Campus Club"
    assert organization.slug == "campus-club"
    assert team is not None
    assert team.name == "Campus FC"
    assert admin is not None
    assert admin.email == "admin@example.com"
    assert admin.name == "Admin"


def test_bootstrap_rejects_blank_required_text_fields(session: Session) -> None:
    with pytest.raises(RuntimeError, match="BOOTSTRAP_ORG_SLUG"):
        bootstrap(
            session,
            organization_name="Campus Club",
            organization_slug="   ",
            team_name="Campus FC",
            admin_auth_id=uuid4(),
            admin_email="admin@example.com",
            admin_name="Admin",
            training_reward=10,
            match_reward=20,
        )


def test_bootstrap_is_idempotent_and_preserves_existing_coin_rules(session: Session) -> None:
    admin_auth_id = uuid4()
    first = bootstrap(
        session,
        organization_name="Campus Club",
        organization_slug="campus-club",
        team_name="Campus FC",
        admin_auth_id=admin_auth_id,
        admin_email="old@example.com",
        admin_name="Old Admin",
        training_reward=10,
        match_reward=20,
    )
    training_rule = session.scalar(
        select(CoinRule).where(
            CoinRule.team_id == first.team_id,
            CoinRule.trigger_type == CoinRuleTrigger.training_signup,
        )
    )
    assert training_rule is not None
    training_rule.amount = 99
    session.commit()

    second = bootstrap(
        session,
        organization_name="Campus Club Renamed",
        organization_slug="campus-club",
        team_name="Campus FC",
        admin_auth_id=admin_auth_id,
        admin_email="new@example.com",
        admin_name="New Admin",
        training_reward=1,
        match_reward=2,
    )

    assert second == first
    assert _count(session, Organization) == 1
    assert _count(session, Team) == 1
    assert _count(session, User) == 1
    assert _count(session, TeamMembership) == 1
    assert _count(session, CoinRule) == 2
    assert training_rule.amount == 99
    admin = session.get(User, first.admin_id)
    assert admin is not None
    assert admin.email == "new@example.com"
    assert admin.name == "New Admin"


def test_bootstrap_reactivates_and_promotes_existing_admin_membership(session: Session) -> None:
    admin_auth_id = uuid4()
    organization = Organization(name="Campus Club", slug="campus-club")
    admin = User(
        auth_id=admin_auth_id,
        email="inactive@example.com",
        name="Inactive Admin",
        status=UserStatus.disabled,
    )
    session.add_all([organization, admin])
    session.flush()
    team = Team(organization_id=organization.id, name="Campus FC")
    session.add(team)
    session.flush()
    membership = TeamMembership(
        team_id=team.id,
        user_id=admin.id,
        role=MembershipRole.member,
        status=MembershipStatus.inactive,
    )
    session.add(membership)
    session.commit()

    result = bootstrap(
        session,
        organization_name="Campus Club",
        organization_slug="campus-club",
        team_name="Campus FC",
        admin_auth_id=admin_auth_id,
        admin_email="admin@example.com",
        admin_name="Admin",
        training_reward=10,
        match_reward=20,
    )

    assert result.organization_id == organization.id
    assert result.team_id == team.id
    assert result.admin_id == admin.id
    assert admin.email == "admin@example.com"
    assert admin.name == "Admin"
    assert admin.status == UserStatus.active
    assert membership.role == MembershipRole.admin
    assert membership.status == MembershipStatus.active
    assert _count(session, Organization) == 1
    assert _count(session, Team) == 1
    assert _count(session, User) == 1
    assert _count(session, TeamMembership) == 1
    assert _count(session, CoinRule) == 2


def test_bootstrap_rejects_negative_default_rewards(session: Session) -> None:
    with pytest.raises(RuntimeError, match="BOOTSTRAP_TRAINING_REWARD must be non-negative"):
        bootstrap(
            session,
            organization_name="Campus Club",
            organization_slug="campus-club",
            team_name="Campus FC",
            admin_auth_id=uuid4(),
            admin_email="admin@example.com",
            admin_name="Admin",
            training_reward=-1,
            match_reward=20,
        )


def test_device_smoke_seed_creates_persistent_idempotent_smoke_data(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    admin_auth_id = uuid4()
    member_auth_id = uuid4()
    monkeypatch.setenv("BOOTSTRAP_ORG_NAME", "Device Smoke Org")
    monkeypatch.setenv("BOOTSTRAP_ORG_SLUG", "device-smoke-org")
    monkeypatch.setenv("BOOTSTRAP_TEAM_NAME", "Device Smoke FC")
    monkeypatch.setenv("BOOTSTRAP_ADMIN_AUTH_ID", str(admin_auth_id))
    monkeypatch.setenv("BOOTSTRAP_ADMIN_EMAIL", "admin-smoke@example.com")
    monkeypatch.setenv("BOOTSTRAP_ADMIN_NAME", "Smoke Admin")
    monkeypatch.setenv("BOOTSTRAP_TRAINING_REWARD", "11")
    monkeypatch.setenv("BOOTSTRAP_MATCH_REWARD", "22")
    monkeypatch.setenv("DEVICE_SMOKE_MEMBER_AUTH_ID", str(member_auth_id))
    monkeypatch.setenv("DEVICE_SMOKE_MEMBER_EMAIL", "member-smoke@example.com")
    monkeypatch.setenv("DEVICE_SMOKE_MEMBER_NAME", "Smoke Member")
    get_settings.cache_clear()

    first = seed_device_smoke(session)
    second = seed_device_smoke(session)

    assert second == first
    assert _count(session, Organization) == 1
    assert _count(session, Team) == 1
    assert _count(session, User) == 2
    assert _count(session, TeamMembership) == 2
    assert _count(session, Event) == 2
    assert _count(session, StoreItem) == 1
    assert _count(session, MatchDetails) == 1
    assert _count(session, CoinTransaction) == 1

    member = session.get(User, first.member_id)
    assert member is not None
    assert member.auth_id == member_auth_id
    membership = session.scalar(
        select(TeamMembership).where(TeamMembership.team_id == first.team_id, TeamMembership.user_id == first.member_id)
    )
    assert membership is not None
    assert membership.role == MembershipRole.member
    assert membership.status == MembershipStatus.active

    rules = session.scalars(select(CoinRule).where(CoinRule.team_id == first.team_id)).all()
    assert {rule.trigger_type: rule.amount for rule in rules} == {
        CoinRuleTrigger.training_signup: 11,
        CoinRuleTrigger.match_signup: 22,
    }

    training = session.get(Event, first.training_event_id)
    match = session.get(Event, first.match_event_id)
    assert training is not None
    assert training.type == EventType.training
    assert training.status == EventStatus.published
    assert training.end_time > training.start_time
    assert match is not None
    assert match.type == EventType.match
    assert match.status == EventStatus.published
    assert match.end_time > match.start_time

    item = session.get(StoreItem, first.store_item_id)
    assert item is not None
    assert item.is_active is True
    assert item.price == 15
    assert item.stock == 10

    transaction = session.scalar(select(CoinTransaction).where(CoinTransaction.user_id == first.member_id))
    assert transaction is not None
    assert transaction.amount == 200
    assert transaction.type == CoinTransactionType.admin_adjustment
    assert transaction.reference_type == "device_smoke_seed"

    get_settings.cache_clear()


def test_device_smoke_seed_preserves_existing_unlimited_store_stock(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    admin_auth_id = uuid4()
    member_auth_id = uuid4()
    monkeypatch.setenv("BOOTSTRAP_ORG_NAME", "Device Smoke Unlimited Org")
    monkeypatch.setenv("BOOTSTRAP_ORG_SLUG", "device-smoke-unlimited-org")
    monkeypatch.setenv("BOOTSTRAP_TEAM_NAME", "Device Smoke Unlimited FC")
    monkeypatch.setenv("BOOTSTRAP_ADMIN_AUTH_ID", str(admin_auth_id))
    monkeypatch.setenv("BOOTSTRAP_ADMIN_EMAIL", "admin-unlimited-smoke@example.com")
    monkeypatch.setenv("BOOTSTRAP_ADMIN_NAME", "Smoke Admin")
    monkeypatch.setenv("DEVICE_SMOKE_MEMBER_AUTH_ID", str(member_auth_id))
    monkeypatch.setenv("DEVICE_SMOKE_MEMBER_EMAIL", "member-unlimited-smoke@example.com")
    monkeypatch.setenv("DEVICE_SMOKE_MEMBER_NAME", "Smoke Member")
    get_settings.cache_clear()

    first = seed_device_smoke(session)
    item = session.get(StoreItem, first.store_item_id)
    assert item is not None
    item.stock = None
    session.commit()

    second = seed_device_smoke(session)

    assert second == first
    session.refresh(item)
    assert item.stock is None
    assert item.is_active is True
    assert item.price == 15
    assert _count(session, StoreItem) == 1

    get_settings.cache_clear()


def test_device_smoke_seed_tops_up_member_balance_without_duplicate_seed_transactions(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    admin_auth_id = uuid4()
    member_auth_id = uuid4()
    monkeypatch.setenv("BOOTSTRAP_ORG_NAME", "Device Smoke Top Up Org")
    monkeypatch.setenv("BOOTSTRAP_ORG_SLUG", "device-smoke-top-up-org")
    monkeypatch.setenv("BOOTSTRAP_TEAM_NAME", "Device Smoke Top Up FC")
    monkeypatch.setenv("BOOTSTRAP_ADMIN_AUTH_ID", str(admin_auth_id))
    monkeypatch.setenv("BOOTSTRAP_ADMIN_EMAIL", "admin-top-up-smoke@example.com")
    monkeypatch.setenv("BOOTSTRAP_ADMIN_NAME", "Smoke Admin")
    monkeypatch.setenv("DEVICE_SMOKE_MEMBER_AUTH_ID", str(member_auth_id))
    monkeypatch.setenv("DEVICE_SMOKE_MEMBER_EMAIL", "member-top-up-smoke@example.com")
    monkeypatch.setenv("DEVICE_SMOKE_MEMBER_NAME", "Smoke Member")
    get_settings.cache_clear()

    first = seed_device_smoke(session)
    session.add(
        CoinTransaction(
            team_id=first.team_id,
            user_id=first.member_id,
            amount=-190,
            type=CoinTransactionType.redemption,
            reason="Simulated previous device smoke redemption",
            reference_type="device_smoke_test",
            reference_id=first.store_item_id,
            created_by=first.member_id,
        )
    )
    session.commit()

    second = seed_device_smoke(session)

    seed_transactions = session.scalars(
        select(CoinTransaction).where(
            CoinTransaction.team_id == first.team_id,
            CoinTransaction.user_id == first.member_id,
            CoinTransaction.type == CoinTransactionType.admin_adjustment,
            CoinTransaction.reason == "Device smoke seed balance",
        )
    ).all()
    member_balance = session.scalar(
        select(func.coalesce(func.sum(CoinTransaction.amount), 0)).where(
            CoinTransaction.team_id == first.team_id,
            CoinTransaction.user_id == first.member_id,
        )
    )

    assert second == DeviceSmokeSeedResult(
        team_id=first.team_id,
        admin_id=first.admin_id,
        member_id=first.member_id,
        training_event_id=first.training_event_id,
        match_event_id=first.match_event_id,
        store_item_id=first.store_item_id,
        member_balance_seeded=390,
    )
    assert len(seed_transactions) == 1
    assert seed_transactions[0].amount == 390
    assert member_balance == 200

    get_settings.cache_clear()


def test_device_smoke_seed_creates_fresh_published_events_when_previous_smoke_events_completed(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    admin_auth_id = uuid4()
    member_auth_id = uuid4()
    monkeypatch.setenv("BOOTSTRAP_ORG_NAME", "Device Smoke Fresh Events Org")
    monkeypatch.setenv("BOOTSTRAP_ORG_SLUG", "device-smoke-fresh-events-org")
    monkeypatch.setenv("BOOTSTRAP_TEAM_NAME", "Device Smoke Fresh Events FC")
    monkeypatch.setenv("BOOTSTRAP_ADMIN_AUTH_ID", str(admin_auth_id))
    monkeypatch.setenv("BOOTSTRAP_ADMIN_EMAIL", "admin-fresh-events-smoke@example.com")
    monkeypatch.setenv("BOOTSTRAP_ADMIN_NAME", "Smoke Admin")
    monkeypatch.setenv("DEVICE_SMOKE_MEMBER_AUTH_ID", str(member_auth_id))
    monkeypatch.setenv("DEVICE_SMOKE_MEMBER_EMAIL", "member-fresh-events-smoke@example.com")
    monkeypatch.setenv("DEVICE_SMOKE_MEMBER_NAME", "Smoke Member")
    get_settings.cache_clear()

    first = seed_device_smoke(session)
    first_training = session.get(Event, first.training_event_id)
    first_match = session.get(Event, first.match_event_id)
    assert first_training is not None
    assert first_match is not None
    first_training.status = EventStatus.completed
    first_match.status = EventStatus.completed
    session.commit()

    second = seed_device_smoke(session)

    second_training = session.get(Event, second.training_event_id)
    second_match = session.get(Event, second.match_event_id)
    assert second.training_event_id != first.training_event_id
    assert second.match_event_id != first.match_event_id
    assert second_training is not None
    assert second_training.title == "Device Smoke Training"
    assert second_training.status == EventStatus.published
    assert second_training.end_time > second_training.start_time
    start_time = second_training.start_time
    if start_time.tzinfo is None:
        start_time = start_time.replace(tzinfo=UTC)
    assert start_time > datetime.now(UTC)
    assert second_match is not None
    assert second_match.title == "Device Smoke Match"
    assert second_match.status == EventStatus.published
    assert session.scalar(select(MatchDetails).where(MatchDetails.event_id == second_match.id)) is not None
    assert first_training.status == EventStatus.completed
    assert first_match.status == EventStatus.completed
    assert _count(session, Event) == 4

    get_settings.cache_clear()


def _count(session: Session, model: type[object]) -> int:
    return session.scalar(select(func.count()).select_from(model)) or 0

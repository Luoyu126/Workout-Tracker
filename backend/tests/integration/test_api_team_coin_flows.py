from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.coins.router import (
    patch_coin_rule,
    post_coin_rule,
    post_coin_transaction,
    read_member_coin_transactions,
    read_my_coin_transactions,
)
from app.coins.schemas import (
    CoinRuleCreateRequest,
    CoinRuleUpdateRequest,
    CoinTransactionCreateRequest,
)
from app.common.database import Base
from app.common.enums import (
    CoinRuleTrigger,
    CoinTransactionType,
    MembershipRole,
    MembershipStatus,
    NotificationType,
    TeamStatus,
    UserStatus,
)
from app.models import (
    CoinRule,
    CoinTransaction,
    Notification,
    Organization,
    Team,
    TeamMembership,
    User,
)
from app.teams.router import (
    patch_member,
    patch_team,
    post_member,
    read_member_candidates,
    read_members,
    read_team,
    read_team_home,
)
from app.teams.schemas import MembershipCreateRequest, MembershipUpdateRequest, TeamUpdateRequest


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
    normalized = name.lower().replace(" ", ".")
    return User(auth_id=uuid4(), name=name, email=f"{normalized}-{uuid4().hex[:8]}@example.com")


def _seed_two_teams(session: Session) -> tuple[Team, Team, User, User, User, User]:
    organization = Organization(name="Team API Org", slug=f"team-api-{uuid4().hex[:8]}")
    team_a_admin = _user("Team A Admin")
    team_a_member = _user("Team A Member")
    team_b_admin = _user("Team B Admin")
    new_player = _user("New Player")
    session.add_all([organization, team_a_admin, team_a_member, team_b_admin, new_player])
    session.flush()

    team_a = Team(organization_id=organization.id, name="Team A")
    team_b = Team(organization_id=organization.id, name="Team B")
    session.add_all([team_a, team_b])
    session.flush()
    session.add_all(
        [
            TeamMembership(
                team_id=team_a.id,
                user_id=team_a_admin.id,
                role=MembershipRole.admin,
                status=MembershipStatus.active,
            ),
            TeamMembership(
                team_id=team_a.id,
                user_id=team_a_member.id,
                role=MembershipRole.member,
                status=MembershipStatus.active,
            ),
            TeamMembership(
                team_id=team_b.id,
                user_id=team_b_admin.id,
                role=MembershipRole.admin,
                status=MembershipStatus.active,
            ),
        ]
    )
    session.commit()
    return team_a, team_b, team_a_admin, team_a_member, team_b_admin, new_player


def test_team_router_enforces_current_team_admin_scope_and_last_admin_guard(
    session: Session,
) -> None:
    team_a, team_b, team_a_admin, team_a_member, _, new_player = _seed_two_teams(session)

    renamed_team = patch_team(
        team_a.id,
        TeamUpdateRequest(name="Team A Renamed"),
        team_a_admin,
        session,
    )
    assert renamed_team.name == "Team A Renamed"

    with pytest.raises(HTTPException) as cross_team_exc:
        patch_team(team_b.id, TeamUpdateRequest(name="非法跨队修改"), team_a_admin, session)
    assert cross_team_exc.value.status_code == 403
    assert cross_team_exc.value.detail["code"] == "TEAM_PERMISSION_DENIED"

    with pytest.raises(HTTPException) as member_archive_exc:
        patch_team(team_a.id, TeamUpdateRequest(status=TeamStatus.archived), team_a_member, session)
    assert member_archive_exc.value.status_code == 403

    added = post_member(
        team_a.id,
        MembershipCreateRequest(user_id=new_player.id, role=MembershipRole.member),
        team_a_admin,
        session,
    )
    assert added.user_id == new_player.id
    repeated_add = post_member(
        team_a.id,
        MembershipCreateRequest(user_id=new_player.id, role=MembershipRole.member),
        team_a_admin,
        session,
    )
    assert repeated_add.id == added.id
    with pytest.raises(HTTPException) as duplicate_mismatch_exc:
        post_member(
            team_a.id,
            MembershipCreateRequest(user_id=new_player.id, role=MembershipRole.captain),
            team_a_admin,
            session,
        )
    assert duplicate_mismatch_exc.value.status_code == 409
    assert duplicate_mismatch_exc.value.detail["code"] == "DUPLICATE_MEMBERSHIP"
    assert len(read_members(team_a.id, None, MembershipStatus.active, team_a_admin, session)) == 3

    promoted = patch_member(
        team_a.id,
        new_player.id,
        MembershipUpdateRequest(role=MembershipRole.captain),
        team_a_admin,
        session,
    )
    assert promoted.role == MembershipRole.captain

    inactive_member = patch_member(
        team_a.id,
        team_a_member.id,
        MembershipUpdateRequest(status=MembershipStatus.inactive),
        team_a_admin,
        session,
    )
    assert inactive_member.status == MembershipStatus.inactive
    assert inactive_member.left_at is not None

    reactivated_member = patch_member(
        team_a.id,
        team_a_member.id,
        MembershipUpdateRequest(status=MembershipStatus.active),
        team_a_admin,
        session,
    )
    assert reactivated_member.status == MembershipStatus.active
    assert reactivated_member.left_at is None

    manual_left_at = datetime.now(UTC) - timedelta(days=7)
    manually_inactivated_member = patch_member(
        team_a.id,
        team_a_member.id,
        MembershipUpdateRequest(status=MembershipStatus.inactive, left_at=manual_left_at),
        team_a_admin,
        session,
    )
    assert manually_inactivated_member.status == MembershipStatus.inactive
    assert manually_inactivated_member.left_at == manual_left_at.replace(tzinfo=None)

    with pytest.raises(HTTPException) as last_admin_exc:
        patch_member(
            team_a.id,
            team_a_admin.id,
            MembershipUpdateRequest(role=MembershipRole.member),
            team_a_admin,
            session,
        )
    assert last_admin_exc.value.status_code == 409
    assert last_admin_exc.value.detail["code"] == "LAST_ADMIN_REQUIRED"

    with pytest.raises(HTTPException) as inactive_last_admin_exc:
        patch_member(
            team_a.id,
            team_a_admin.id,
            MembershipUpdateRequest(status=MembershipStatus.inactive),
            team_a_admin,
            session,
        )
    assert inactive_last_admin_exc.value.status_code == 409
    assert inactive_last_admin_exc.value.detail["code"] == "LAST_ADMIN_REQUIRED"

    active_admins = read_members(team_a.id, MembershipRole.admin, MembershipStatus.active, team_a_admin, session)
    assert [membership.user_id for membership in active_admins] == [team_a_admin.id]


def test_team_read_endpoint_requires_active_membership_and_active_team(session: Session) -> None:
    team_a, team_b, team_a_admin, team_a_member, team_b_admin, _ = _seed_two_teams(session)

    assert read_team(team_a.id, team_a_member, session).id == team_a.id

    with pytest.raises(HTTPException) as cross_team_exc:
        read_team(team_b.id, team_a_admin, session)
    assert cross_team_exc.value.status_code == 403
    assert cross_team_exc.value.detail["code"] == "TEAM_PERMISSION_DENIED"

    archived_team = patch_team(
        team_b.id,
        TeamUpdateRequest(status=TeamStatus.archived),
        team_b_admin,
        session,
    )
    assert archived_team.status == TeamStatus.archived

    with pytest.raises(HTTPException) as archived_exc:
        read_team(team_b.id, team_b_admin, session)
    assert archived_exc.value.status_code == 403
    assert archived_exc.value.detail["code"] == "TEAM_PERMISSION_DENIED"


def test_team_member_candidate_search_is_admin_scoped_and_excludes_existing_members(
    session: Session,
) -> None:
    team_a, _, team_a_admin, team_a_member, _, new_player = _seed_two_teams(session)
    new_player.student_id = "S-2026"
    disabled_candidate = _user("New Disabled")
    disabled_candidate.status = UserStatus.disabled
    session.add(disabled_candidate)
    session.commit()

    candidates = read_member_candidates(team_a.id, "new", 10, team_a_admin, session)

    assert [candidate.id for candidate in candidates] == [new_player.id]
    assert candidates[0].student_id == "S-2026"

    student_id_candidates = read_member_candidates(team_a.id, "2026", 10, team_a_admin, session)
    assert [candidate.id for candidate in student_id_candidates] == [new_player.id]

    with pytest.raises(HTTPException) as disabled_add_exc:
        post_member(
            team_a.id,
            MembershipCreateRequest(user_id=disabled_candidate.id, role=MembershipRole.member),
            team_a_admin,
            session,
        )
    assert disabled_add_exc.value.status_code == 409
    assert disabled_add_exc.value.detail["code"] == "MEMBER_NOT_ELIGIBLE"

    assert read_member_candidates(team_a.id, "n", 10, team_a_admin, session) == []

    post_member(
        team_a.id,
        MembershipCreateRequest(user_id=new_player.id, role=MembershipRole.member),
        team_a_admin,
        session,
    )
    assert read_member_candidates(team_a.id, "new", 10, team_a_admin, session) == []

    with pytest.raises(HTTPException) as member_search_exc:
        read_member_candidates(team_a.id, "new", 10, team_a_member, session)
    assert member_search_exc.value.status_code == 403
    assert member_search_exc.value.detail["code"] == "TEAM_PERMISSION_DENIED"


def test_archived_team_blocks_resource_reads_until_admin_reactivates(session: Session) -> None:
    team_a, _, team_a_admin, team_a_member, _, _ = _seed_two_teams(session)

    archived_team = patch_team(
        team_a.id,
        TeamUpdateRequest(status=TeamStatus.archived),
        team_a_admin,
        session,
    )
    assert archived_team.status == TeamStatus.archived

    with pytest.raises(HTTPException) as home_exc:
        read_team_home(team_a.id, team_a_member, session)
    assert home_exc.value.status_code == 403
    assert home_exc.value.detail["code"] == "TEAM_PERMISSION_DENIED"

    with pytest.raises(HTTPException) as members_exc:
        read_members(team_a.id, None, MembershipStatus.active, team_a_admin, session)
    assert members_exc.value.status_code == 403
    assert members_exc.value.detail["code"] == "TEAM_PERMISSION_DENIED"

    with pytest.raises(HTTPException) as rename_exc:
        patch_team(team_a.id, TeamUpdateRequest(name="归档后不能改名"), team_a_admin, session)
    assert rename_exc.value.status_code == 403
    assert rename_exc.value.detail["code"] == "TEAM_PERMISSION_DENIED"

    restored_team = patch_team(
        team_a.id,
        TeamUpdateRequest(status=TeamStatus.active),
        team_a_admin,
        session,
    )
    assert restored_team.status == TeamStatus.active
    assert read_team_home(team_a.id, team_a_member, session)["team"].id == team_a.id


def test_coin_router_limits_rules_and_member_transaction_reads_to_team_roles(
    session: Session,
) -> None:
    team_a, _, team_a_admin, team_a_member, _, _ = _seed_two_teams(session)
    session.add(
        CoinTransaction(
            team_id=team_a.id,
            user_id=team_a_member.id,
            amount=12,
            type=CoinTransactionType.admin_adjustment,
            reason="Seed coins",
            created_by=team_a_admin.id,
        )
    )
    session.commit()

    with pytest.raises(HTTPException) as member_rule_exc:
        post_coin_rule(
            team_a.id,
            CoinRuleCreateRequest(
                name="成员非法配置",
                trigger_type=CoinRuleTrigger.training_signup,
                amount=1,
            ),
            team_a_member,
            session,
        )
    assert member_rule_exc.value.status_code == 403
    assert member_rule_exc.value.detail["code"] == "COIN_PERMISSION_DENIED"

    rule = post_coin_rule(
        team_a.id,
        CoinRuleCreateRequest(
            name="训练奖励",
            trigger_type=CoinRuleTrigger.training_signup,
            amount=10,
        ),
        team_a_admin,
        session,
    )
    assert rule.amount == 10

    updated_rule = patch_coin_rule(
        rule.id,
        CoinRuleUpdateRequest(amount=15, is_active=False),
        team_a_admin,
        session,
    )
    assert updated_rule.amount == 15
    assert updated_rule.is_active is False

    transactions = read_member_coin_transactions(team_a.id, team_a_member.id, team_a_admin, session)
    assert [transaction.amount for transaction in transactions] == [12]

    with pytest.raises(HTTPException) as member_read_exc:
        read_member_coin_transactions(team_a.id, team_a_admin.id, team_a_member, session)
    assert member_read_exc.value.status_code == 403
    assert member_read_exc.value.detail["code"] == "COIN_PERMISSION_DENIED"


def test_coin_rule_creation_is_idempotent_by_client_rule_id(session: Session) -> None:
    team_a, _, team_a_admin, _, _, _ = _seed_two_teams(session)
    rule_id = uuid4()
    payload = CoinRuleCreateRequest(
        id=rule_id,
        name="幂等训练奖励",
        trigger_type=CoinRuleTrigger.training_signup,
        amount=10,
        config={"source": "captain-setting"},
        is_active=True,
    )

    rule = post_coin_rule(team_a.id, payload, team_a_admin, session)
    repeated_rule = post_coin_rule(team_a.id, payload, team_a_admin, session)

    assert repeated_rule.id == rule.id == rule_id
    assert session.scalars(select(CoinRule).where(CoinRule.id == rule_id)).all() == [rule]

    with pytest.raises(HTTPException) as mismatch_exc:
        post_coin_rule(
            team_a.id,
            CoinRuleCreateRequest(
                id=rule_id,
                name="幂等训练奖励",
                trigger_type=CoinRuleTrigger.training_signup,
                amount=12,
                config={"source": "captain-setting"},
                is_active=True,
            ),
            team_a_admin,
            session,
        )
    assert mismatch_exc.value.status_code == 409
    assert mismatch_exc.value.detail["code"] == "COIN_RULE_CONFLICT"
    assert session.get(CoinRule, rule_id).amount == 10


def test_admin_manual_coin_adjustment_is_idempotent_and_team_scoped(session: Session) -> None:
    team_a, _, team_a_admin, team_a_member, _, _ = _seed_two_teams(session)
    transaction_id = uuid4()
    payload = CoinTransactionCreateRequest(
        id=transaction_id,
        user_id=team_a_member.id,
        amount=25,
        reason="训练补贴",
        metadata={"source": "manual-test"},
    )

    transaction = post_coin_transaction(team_a.id, payload, team_a_admin, session)
    assert transaction.id == transaction_id
    assert transaction.amount == 25
    assert transaction.type == CoinTransactionType.admin_adjustment

    retried_transaction = post_coin_transaction(team_a.id, payload, team_a_admin, session)
    assert retried_transaction.id == transaction.id
    assert len(read_member_coin_transactions(team_a.id, team_a_member.id, team_a_admin, session)) == 1
    notifications = session.query(Notification).filter(Notification.user_id == team_a_member.id).all()
    assert len(notifications) == 1
    assert notifications[0].type == NotificationType.coin_earned
    assert notifications[0].reference_type == "coin_transaction"
    assert notifications[0].reference_id == transaction.id

    with pytest.raises(HTTPException) as member_adjust_exc:
        post_coin_transaction(
            team_a.id,
            CoinTransactionCreateRequest(
                id=uuid4(),
                user_id=team_a_admin.id,
                amount=10,
                reason="成员非法调整",
            ),
            team_a_member,
            session,
        )
    assert member_adjust_exc.value.status_code == 403

    with pytest.raises(HTTPException) as conflict_exc:
        post_coin_transaction(
            team_a.id,
            CoinTransactionCreateRequest(
                id=transaction_id,
                user_id=team_a_member.id,
                amount=30,
                reason="冲突调整",
            ),
            team_a_admin,
            session,
        )
    assert conflict_exc.value.status_code == 409
    assert conflict_exc.value.detail["code"] == "COIN_TRANSACTION_CONFLICT"

    with pytest.raises(HTTPException) as reason_conflict_exc:
        post_coin_transaction(
            team_a.id,
            CoinTransactionCreateRequest(
                id=transaction_id,
                user_id=team_a_member.id,
                amount=25,
                reason="同金额但原因不同",
                metadata={"source": "manual-test"},
            ),
            team_a_admin,
            session,
        )
    assert reason_conflict_exc.value.status_code == 409
    assert reason_conflict_exc.value.detail["code"] == "COIN_TRANSACTION_CONFLICT"

    with pytest.raises(HTTPException) as metadata_conflict_exc:
        post_coin_transaction(
            team_a.id,
            CoinTransactionCreateRequest(
                id=transaction_id,
                user_id=team_a_member.id,
                amount=25,
                reason="训练补贴",
                metadata={"source": "different-client-action"},
            ),
            team_a_admin,
            session,
        )
    assert metadata_conflict_exc.value.status_code == 409
    assert metadata_conflict_exc.value.detail["code"] == "COIN_TRANSACTION_CONFLICT"


def test_admin_manual_coin_endpoint_accepts_other_reward_type(session: Session) -> None:
    team_a, _, team_a_admin, team_a_member, _, _ = _seed_two_teams(session)
    payload = CoinTransactionCreateRequest(
        id=uuid4(),
        user_id=team_a_member.id,
        amount=8,
        type=CoinTransactionType.other_reward,
        reason="队内贡献奖励",
        metadata={"source": "other-reward-test"},
    )

    transaction = post_coin_transaction(team_a.id, payload, team_a_admin, session)

    assert transaction.type == CoinTransactionType.other_reward
    assert transaction.reference_type == "other_reward"
    assert transaction.amount == 8


def test_coin_transaction_lists_support_type_and_created_at_filters(session: Session) -> None:
    team_a, _, team_a_admin, team_a_member, _, _ = _seed_two_teams(session)
    old_time = datetime.now(UTC) - timedelta(days=3)
    recent_time = datetime.now(UTC) - timedelta(hours=2)
    future_time = datetime.now(UTC) + timedelta(hours=2)
    old_adjustment = CoinTransaction(
        team_id=team_a.id,
        user_id=team_a_member.id,
        amount=10,
        type=CoinTransactionType.admin_adjustment,
        reason="旧调整",
        created_by=team_a_admin.id,
        created_at=old_time,
    )
    recent_reward = CoinTransaction(
        team_id=team_a.id,
        user_id=team_a_member.id,
        amount=5,
        type=CoinTransactionType.other_reward,
        reason="近期奖励",
        created_by=team_a_admin.id,
        created_at=recent_time,
    )
    session.add_all([old_adjustment, recent_reward])
    session.commit()

    my_other_rewards = read_my_coin_transactions(
        team_a.id,
        team_a_member,
        session,
        CoinTransactionType.other_reward,
        old_time + timedelta(days=1),
        future_time,
    )
    member_recent_rewards = read_member_coin_transactions(
        team_a.id,
        team_a_member.id,
        team_a_admin,
        session,
        CoinTransactionType.other_reward,
        old_time + timedelta(days=1),
        future_time,
    )

    assert [transaction.id for transaction in my_other_rewards] == [recent_reward.id]
    assert [transaction.id for transaction in member_recent_rewards] == [recent_reward.id]
    assert (
        read_my_coin_transactions(
            team_a.id,
            team_a_member,
            session,
            CoinTransactionType.other_reward,
            future_time,
            None,
        )
        == []
    )


def test_coin_router_rejects_cross_team_admin_access_to_rules_transactions_and_member_ledgers(
    session: Session,
) -> None:
    team_a, _, team_a_admin, team_a_member, team_b_admin, _ = _seed_two_teams(session)
    rule = post_coin_rule(
        team_a.id,
        CoinRuleCreateRequest(
            name="A 队训练奖励",
            trigger_type=CoinRuleTrigger.training_signup,
            amount=10,
        ),
        team_a_admin,
        session,
    )
    session.add(
        CoinTransaction(
            team_id=team_a.id,
            user_id=team_a_member.id,
            amount=18,
            type=CoinTransactionType.admin_adjustment,
            reason="A team seed",
            created_by=team_a_admin.id,
        )
    )
    session.commit()

    with pytest.raises(HTTPException) as patch_rule_exc:
        patch_coin_rule(rule.id, CoinRuleUpdateRequest(amount=99), team_b_admin, session)
    assert patch_rule_exc.value.status_code == 403
    assert patch_rule_exc.value.detail["code"] == "COIN_PERMISSION_DENIED"

    with pytest.raises(HTTPException) as read_ledger_exc:
        read_member_coin_transactions(team_a.id, team_a_member.id, team_b_admin, session)
    assert read_ledger_exc.value.status_code == 403
    assert read_ledger_exc.value.detail["code"] == "COIN_PERMISSION_DENIED"

    with pytest.raises(HTTPException) as manual_adjust_exc:
        post_coin_transaction(
            team_a.id,
            CoinTransactionCreateRequest(
                id=uuid4(),
                user_id=team_a_member.id,
                amount=5,
                reason="跨队非法调整",
            ),
            team_b_admin,
            session,
        )
    assert manual_adjust_exc.value.status_code == 403
    assert manual_adjust_exc.value.detail["code"] == "COIN_PERMISSION_DENIED"

    session.refresh(rule)
    assert rule.amount == 10
    assert [transaction.amount for transaction in read_member_coin_transactions(team_a.id, team_a_member.id, team_a_admin, session)] == [
        18
    ]

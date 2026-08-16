from collections.abc import Iterator
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.coins.router import read_coin_balance
from app.common.database import Base
from app.common.enums import (
    CoinTransactionType,
    MembershipRole,
    MembershipStatus,
    NotificationType,
    RedemptionStatus,
)
from app.models import (
    CoinTransaction,
    Notification,
    Organization,
    Redemption,
    StoreItem,
    Team,
    TeamMembership,
    User,
)
from app.store.router import (
    patch_store_item,
    post_cancel_redemption,
    post_fulfill_redemption,
    post_redemption,
    post_refund_redemption,
    post_store_item,
    read_my_redemptions,
    read_store_items,
    read_team_redemptions,
)
from app.store.schemas import (
    RedemptionCreateRequest,
    StoreItemCreateRequest,
    StoreItemUpdateRequest,
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
    normalized = name.lower().replace(" ", ".")
    return User(auth_id=uuid4(), name=name, email=f"{normalized}@example.com")


def _seed_team(session: Session, player_balance: int = 50) -> tuple[Team, User, User]:
    organization = Organization(name="Store API Test Org", slug=f"store-api-{uuid4().hex[:8]}")
    captain = _user("Store Captain")
    player = _user("Store Player")
    session.add_all([organization, captain, player])
    session.flush()

    team = Team(organization_id=organization.id, name="Store MVP Team")
    session.add(team)
    session.flush()
    session.add_all(
        [
            TeamMembership(
                team_id=team.id,
                user_id=captain.id,
                role=MembershipRole.captain,
                status=MembershipStatus.active,
            ),
            TeamMembership(
                team_id=team.id,
                user_id=player.id,
                role=MembershipRole.member,
                status=MembershipStatus.active,
            ),
            CoinTransaction(
                team_id=team.id,
                user_id=player.id,
                amount=player_balance,
                type=CoinTransactionType.admin_adjustment,
                reason="Seed balance",
                created_by=captain.id,
            ),
        ]
    )
    session.commit()
    return team, captain, player


def _seed_second_team(session: Session) -> tuple[Team, User]:
    organization = Organization(name="Other Store Org", slug=f"other-store-{uuid4().hex[:8]}")
    captain = _user("Other Store Captain")
    session.add_all([organization, captain])
    session.flush()
    team = Team(organization_id=organization.id, name="Other Store Team")
    session.add(team)
    session.flush()
    session.add(
        TeamMembership(
            team_id=team.id,
            user_id=captain.id,
            role=MembershipRole.captain,
            status=MembershipStatus.active,
        )
    )
    session.commit()
    return team, captain


def test_store_item_creation_is_idempotent_by_client_item_id(session: Session) -> None:
    team, captain, _ = _seed_team(session)
    item_id = uuid4()
    payload = StoreItemCreateRequest(
        id=item_id,
        name="幂等队服",
        description="主场款",
        image_url=None,
        price=50,
        stock=10,
        is_active=True,
    )

    item = post_store_item(team.id, payload, captain, session)
    repeated_item = post_store_item(team.id, payload, captain, session)

    assert repeated_item.id == item.id == item_id
    assert session.scalars(select(StoreItem).where(StoreItem.id == item_id)).all() == [item]

    with pytest.raises(HTTPException) as mismatch_exc:
        post_store_item(
            team.id,
            StoreItemCreateRequest(
                id=item_id,
                name="幂等队服",
                price=60,
                stock=10,
                is_active=True,
            ),
            captain,
            session,
        )
    assert mismatch_exc.value.status_code == 409
    assert mismatch_exc.value.detail["code"] == "STORE_RULE_CONFLICT"
    assert session.get(StoreItem, item_id).price == 50


def test_store_router_redemption_fulfillment_and_refund_restore_balance_and_stock(
    session: Session,
) -> None:
    team, captain, player = _seed_team(session)

    item = post_store_item(
        team.id,
        StoreItemCreateRequest(name="队袜", price=15, stock=2, is_active=True),
        captain,
        session,
    )
    redemption = post_redemption(
        team.id,
        RedemptionCreateRequest(id=uuid4(), store_item_id=item.id, quantity=1),
        player,
        session,
    )

    assert redemption.status == RedemptionStatus.pending
    assert read_coin_balance(team.id, player, session)["balance"] == 35
    assert session.get(StoreItem, item.id).stock == 1

    fulfilled = post_fulfill_redemption(redemption.id, captain, session)
    assert fulfilled.status == RedemptionStatus.fulfilled

    refunded = post_refund_redemption(redemption.id, captain, session)
    assert refunded.status == RedemptionStatus.refunded
    assert read_coin_balance(team.id, player, session)["balance"] == 50
    assert session.get(StoreItem, item.id).stock == 2


def test_store_router_fulfillment_notifies_redeeming_user_once(session: Session) -> None:
    team, captain, player = _seed_team(session)
    item = post_store_item(
        team.id,
        StoreItemCreateRequest(name="通知测试队帽", price=10, stock=2, is_active=True),
        captain,
        session,
    )
    redemption = post_redemption(
        team.id,
        RedemptionCreateRequest(id=uuid4(), store_item_id=item.id, quantity=1),
        player,
        session,
    )

    fulfilled = post_fulfill_redemption(redemption.id, captain, session)

    assert fulfilled.status == RedemptionStatus.fulfilled
    notifications = session.scalars(
        select(Notification).where(Notification.type == NotificationType.redemption_completed)
    ).all()
    assert len(notifications) == 1
    assert notifications[0].user_id == player.id
    assert notifications[0].team_id == team.id
    assert notifications[0].reference_type == "redemption"
    assert notifications[0].reference_id == redemption.id
    assert "兑换订单已完成" in notifications[0].body

    repeat_fulfill = post_fulfill_redemption(redemption.id, captain, session)

    assert repeat_fulfill.status == RedemptionStatus.fulfilled
    assert session.scalars(select(Notification).where(Notification.type == NotificationType.redemption_completed)).all() == notifications


def test_store_router_unlimited_stock_stays_unlimited_through_refund(session: Session) -> None:
    team, captain, player = _seed_team(session)

    item = post_store_item(
        team.id,
        StoreItemCreateRequest(name="不限量贴纸", price=10, stock=None, is_active=True),
        captain,
        session,
    )
    redemption = post_redemption(
        team.id,
        RedemptionCreateRequest(id=uuid4(), store_item_id=item.id, quantity=3),
        player,
        session,
    )

    assert redemption.total_price == 30
    assert read_coin_balance(team.id, player, session)["balance"] == 20
    assert session.get(StoreItem, item.id).stock is None

    post_fulfill_redemption(redemption.id, captain, session)
    refunded = post_refund_redemption(redemption.id, captain, session)

    assert refunded.status == RedemptionStatus.refunded
    assert read_coin_balance(team.id, player, session)["balance"] == 50
    assert session.get(StoreItem, item.id).stock is None


def test_store_router_returns_conflict_when_player_balance_is_insufficient(session: Session) -> None:
    team, captain, player = _seed_team(session, player_balance=10)
    item = post_store_item(
        team.id,
        StoreItemCreateRequest(name="训练背心", price=30, stock=1, is_active=True),
        captain,
        session,
    )

    with pytest.raises(HTTPException) as exc_info:
        post_redemption(
            team.id,
            RedemptionCreateRequest(id=uuid4(), store_item_id=item.id, quantity=1),
            player,
            session,
        )

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "STORE_RULE_CONFLICT"
    assert session.get(StoreItem, item.id).stock == 1
    assert read_coin_balance(team.id, player, session)["balance"] == 10


def test_store_router_returns_conflict_when_stock_is_insufficient_without_charging_coins(
    session: Session,
) -> None:
    team, captain, player = _seed_team(session, player_balance=100)
    item = post_store_item(
        team.id,
        StoreItemCreateRequest(name="限量队章", price=20, stock=1, is_active=True),
        captain,
        session,
    )

    first_redemption = post_redemption(
        team.id,
        RedemptionCreateRequest(id=uuid4(), store_item_id=item.id, quantity=1),
        player,
        session,
    )
    assert first_redemption.status == RedemptionStatus.pending
    assert session.get(StoreItem, item.id).stock == 0
    assert read_coin_balance(team.id, player, session)["balance"] == 80

    with pytest.raises(HTTPException) as stock_exc:
        post_redemption(
            team.id,
            RedemptionCreateRequest(id=uuid4(), store_item_id=item.id, quantity=1),
            player,
            session,
        )

    assert stock_exc.value.status_code == 409
    assert stock_exc.value.detail["code"] == "STORE_RULE_CONFLICT"
    assert session.get(StoreItem, item.id).stock == 0
    assert read_coin_balance(team.id, player, session)["balance"] == 80
    redemption_transactions = [
        transaction
        for transaction in session.query(CoinTransaction).all()
        if transaction.type == CoinTransactionType.redemption
    ]
    assert len(redemption_transactions) == 1


def test_store_router_preserves_redemption_historical_price_after_item_price_change(
    session: Session,
) -> None:
    team, captain, player = _seed_team(session, player_balance=100)
    item = post_store_item(
        team.id,
        StoreItemCreateRequest(name="训练水壶", price=20, stock=5, is_active=True),
        captain,
        session,
    )

    redemption = post_redemption(
        team.id,
        RedemptionCreateRequest(id=uuid4(), store_item_id=item.id, quantity=2),
        player,
        session,
    )
    patch_store_item(item.id, StoreItemUpdateRequest(price=35), captain, session)

    assert redemption.unit_price == 20
    assert redemption.total_price == 40
    assert read_coin_balance(team.id, player, session)["balance"] == 60
    assert session.get(StoreItem, item.id).price == 35


def test_store_router_pending_redemption_survives_item_deactivation_and_price_change(
    session: Session,
) -> None:
    team, captain, player = _seed_team(session, player_balance=100)
    item = post_store_item(
        team.id,
        StoreItemCreateRequest(name="赛后补给", price=20, stock=2, is_active=True),
        captain,
        session,
    )
    redemption = post_redemption(
        team.id,
        RedemptionCreateRequest(id=uuid4(), store_item_id=item.id, quantity=1),
        player,
        session,
    )
    patch_store_item(item.id, StoreItemUpdateRequest(price=99, is_active=False), captain, session)

    fulfilled = post_fulfill_redemption(redemption.id, captain, session)
    assert fulfilled.status == RedemptionStatus.fulfilled

    refunded = post_refund_redemption(redemption.id, captain, session)

    updated_item = session.get(StoreItem, item.id)
    assert updated_item is not None
    assert refunded.status == RedemptionStatus.refunded
    assert refunded.unit_price == 20
    assert refunded.total_price == 20
    assert read_coin_balance(team.id, player, session)["balance"] == 100
    assert updated_item.price == 99
    assert updated_item.is_active is False
    assert updated_item.stock == 2


def test_inactive_member_cannot_list_or_redeem_store_items(session: Session) -> None:
    team, captain, _ = _seed_team(session, player_balance=100)
    inactive_player = _user("Inactive Store Player")
    session.add(inactive_player)
    session.flush()
    session.add_all(
        [
            TeamMembership(
                team_id=team.id,
                user_id=inactive_player.id,
                role=MembershipRole.member,
                status=MembershipStatus.inactive,
            ),
            CoinTransaction(
                team_id=team.id,
                user_id=inactive_player.id,
                amount=100,
                type=CoinTransactionType.admin_adjustment,
                reason="Inactive seed balance",
                created_by=captain.id,
            ),
        ]
    )
    item = post_store_item(
        team.id,
        StoreItemCreateRequest(name="非活跃不可兑商品", price=20, stock=2, is_active=True),
        captain,
        session,
    )

    with pytest.raises(HTTPException) as list_exc:
        read_store_items(team.id, inactive_player, session)
    assert list_exc.value.status_code == 403
    assert list_exc.value.detail["code"] == "STORE_PERMISSION_DENIED"

    with pytest.raises(HTTPException) as redeem_exc:
        post_redemption(
            team.id,
            RedemptionCreateRequest(id=uuid4(), store_item_id=item.id, quantity=1),
            inactive_player,
            session,
        )
    assert redeem_exc.value.status_code == 403
    assert redeem_exc.value.detail["code"] == "STORE_PERMISSION_DENIED"
    assert session.get(StoreItem, item.id).stock == 2
    inactive_transactions = session.scalars(
        select(CoinTransaction).where(CoinTransaction.user_id == inactive_player.id)
    ).all()
    assert [(transaction.type, transaction.amount) for transaction in inactive_transactions] == [
        (CoinTransactionType.admin_adjustment, 100)
    ]


def test_member_cannot_redeem_store_item_from_another_team(session: Session) -> None:
    team, _, player = _seed_team(session, player_balance=100)
    other_team, other_captain = _seed_second_team(session)
    other_item = post_store_item(
        other_team.id,
        StoreItemCreateRequest(name="别队商品", price=20, stock=3, is_active=True),
        other_captain,
        session,
    )

    with pytest.raises(HTTPException) as redeem_exc:
        post_redemption(
            team.id,
            RedemptionCreateRequest(id=uuid4(), store_item_id=other_item.id, quantity=1),
            player,
            session,
        )
    assert redeem_exc.value.status_code == 409
    assert redeem_exc.value.detail["code"] == "STORE_RULE_CONFLICT"
    assert session.get(StoreItem, other_item.id).stock == 3
    assert read_coin_balance(team.id, player, session)["balance"] == 100
    player_redemptions = session.scalars(
        select(CoinTransaction).where(
            CoinTransaction.user_id == player.id,
            CoinTransaction.type == CoinTransactionType.redemption,
        )
    ).all()
    assert player_redemptions == []


def test_store_router_redeem_idempotency_rejects_payload_mismatch(session: Session) -> None:
    team, captain, player = _seed_team(session, player_balance=100)
    first_item = post_store_item(
        team.id,
        StoreItemCreateRequest(name="第一件商品", price=10, stock=5, is_active=True),
        captain,
        session,
    )
    second_item = post_store_item(
        team.id,
        StoreItemCreateRequest(name="第二件商品", price=10, stock=5, is_active=True),
        captain,
        session,
    )
    redemption_id = uuid4()

    first_redemption = post_redemption(
        team.id,
        RedemptionCreateRequest(id=redemption_id, store_item_id=first_item.id, quantity=1),
        player,
        session,
    )
    retry_redemption = post_redemption(
        team.id,
        RedemptionCreateRequest(id=redemption_id, store_item_id=first_item.id, quantity=1),
        player,
        session,
    )

    assert retry_redemption.id == first_redemption.id
    assert read_coin_balance(team.id, player, session)["balance"] == 90
    assert session.get(StoreItem, first_item.id).stock == 4
    redemption_transactions = session.scalars(
        select(CoinTransaction).where(
            CoinTransaction.team_id == team.id,
            CoinTransaction.user_id == player.id,
            CoinTransaction.type == CoinTransactionType.redemption,
            CoinTransaction.reference_id == redemption_id,
        )
    ).all()
    assert len(redemption_transactions) == 1
    assert redemption_transactions[0].amount == -10

    with pytest.raises(HTTPException) as quantity_mismatch_exc:
        post_redemption(
            team.id,
            RedemptionCreateRequest(id=redemption_id, store_item_id=first_item.id, quantity=2),
            player,
            session,
        )

    assert quantity_mismatch_exc.value.status_code == 409
    assert read_coin_balance(team.id, player, session)["balance"] == 90
    assert session.get(StoreItem, first_item.id).stock == 4
    assert session.scalars(
        select(CoinTransaction).where(
            CoinTransaction.team_id == team.id,
            CoinTransaction.user_id == player.id,
            CoinTransaction.type == CoinTransactionType.redemption,
            CoinTransaction.reference_id == redemption_id,
        )
    ).all() == redemption_transactions

    with pytest.raises(HTTPException) as item_mismatch_exc:
        post_redemption(
            team.id,
            RedemptionCreateRequest(id=redemption_id, store_item_id=second_item.id, quantity=1),
            player,
            session,
        )

    assert item_mismatch_exc.value.status_code == 409
    assert read_coin_balance(team.id, player, session)["balance"] == 90
    assert session.get(StoreItem, second_item.id).stock == 5
    assert session.scalars(
        select(CoinTransaction).where(
            CoinTransaction.team_id == team.id,
            CoinTransaction.user_id == player.id,
            CoinTransaction.type == CoinTransactionType.redemption,
            CoinTransaction.reference_id == redemption_id,
        )
    ).all() == redemption_transactions


def test_store_router_cancel_pending_redemption_restores_stock_once(session: Session) -> None:
    team, captain, player = _seed_team(session)
    item = post_store_item(
        team.id,
        StoreItemCreateRequest(name="能量胶", price=10, stock=2, is_active=True),
        captain,
        session,
    )
    redemption = post_redemption(
        team.id,
        RedemptionCreateRequest(id=uuid4(), store_item_id=item.id, quantity=1),
        player,
        session,
    )

    cancelled = post_cancel_redemption(redemption.id, captain, session)

    assert cancelled.status == RedemptionStatus.cancelled
    assert read_coin_balance(team.id, player, session)["balance"] == 50
    assert session.get(StoreItem, item.id).stock == 2
    refunds = [
        transaction
        for transaction in session.query(CoinTransaction).all()
        if transaction.type == CoinTransactionType.refund and transaction.reference_id == redemption.id
    ]
    assert len(refunds) == 1

    second_cancel = post_cancel_redemption(redemption.id, captain, session)

    assert second_cancel.status == RedemptionStatus.cancelled
    assert read_coin_balance(team.id, player, session)["balance"] == 50
    assert session.get(StoreItem, item.id).stock == 2
    refunds_after_retry = [
        transaction
        for transaction in session.query(CoinTransaction).all()
        if transaction.type == CoinTransactionType.refund and transaction.reference_id == redemption.id
    ]
    assert len(refunds_after_retry) == 1


def test_store_router_rejects_invalid_redemption_status_transitions_without_side_effects(
    session: Session,
) -> None:
    team, captain, player = _seed_team(session, player_balance=100)
    item = post_store_item(
        team.id,
        StoreItemCreateRequest(name="状态机商品", price=10, stock=3, is_active=True),
        captain,
        session,
    )
    pending_redemption = post_redemption(
        team.id,
        RedemptionCreateRequest(id=uuid4(), store_item_id=item.id, quantity=1),
        player,
        session,
    )

    with pytest.raises(HTTPException) as pending_refund_exc:
        post_refund_redemption(pending_redemption.id, captain, session)
    assert pending_refund_exc.value.status_code == 409
    assert pending_refund_exc.value.detail["code"] == "STORE_RULE_CONFLICT"
    assert session.get(Redemption, pending_redemption.id).status == RedemptionStatus.pending
    assert session.get(StoreItem, item.id).stock == 2
    assert read_coin_balance(team.id, player, session)["balance"] == 90

    fulfilled_redemption = post_fulfill_redemption(pending_redemption.id, captain, session)
    assert fulfilled_redemption.status == RedemptionStatus.fulfilled
    with pytest.raises(HTTPException) as fulfilled_cancel_exc:
        post_cancel_redemption(pending_redemption.id, captain, session)
    assert fulfilled_cancel_exc.value.status_code == 409
    assert fulfilled_cancel_exc.value.detail["code"] == "STORE_RULE_CONFLICT"
    assert session.get(Redemption, pending_redemption.id).status == RedemptionStatus.fulfilled
    assert session.get(StoreItem, item.id).stock == 2
    assert read_coin_balance(team.id, player, session)["balance"] == 90

    cancelled_redemption = post_redemption(
        team.id,
        RedemptionCreateRequest(id=uuid4(), store_item_id=item.id, quantity=1),
        player,
        session,
    )
    post_cancel_redemption(cancelled_redemption.id, captain, session)
    with pytest.raises(HTTPException) as cancelled_refund_exc:
        post_refund_redemption(cancelled_redemption.id, captain, session)
    assert cancelled_refund_exc.value.status_code == 409
    assert cancelled_refund_exc.value.detail["code"] == "STORE_RULE_CONFLICT"
    assert session.get(Redemption, cancelled_redemption.id).status == RedemptionStatus.cancelled
    assert session.get(StoreItem, item.id).stock == 2
    assert read_coin_balance(team.id, player, session)["balance"] == 90
    refunds = [
        transaction
        for transaction in session.scalars(select(CoinTransaction).where(CoinTransaction.team_id == team.id)).all()
        if transaction.type == CoinTransactionType.refund
    ]
    assert len(refunds) == 1


def test_store_router_second_refund_is_idempotent_without_second_refund_transaction(
    session: Session,
) -> None:
    team, captain, player = _seed_team(session)
    item = post_store_item(
        team.id,
        StoreItemCreateRequest(name="队徽贴纸", price=15, stock=2, is_active=True),
        captain,
        session,
    )
    redemption = post_redemption(
        team.id,
        RedemptionCreateRequest(id=uuid4(), store_item_id=item.id, quantity=1),
        player,
        session,
    )
    post_fulfill_redemption(redemption.id, captain, session)
    first_refund = post_refund_redemption(redemption.id, captain, session)

    second_refund = post_refund_redemption(redemption.id, captain, session)

    assert first_refund.status == RedemptionStatus.refunded
    assert second_refund.status == RedemptionStatus.refunded
    assert read_coin_balance(team.id, player, session)["balance"] == 50
    assert session.get(StoreItem, item.id).stock == 2
    refunds = [
        transaction
        for transaction in session.query(CoinTransaction).all()
        if transaction.type == CoinTransactionType.refund and transaction.reference_id == redemption.id
    ]
    assert len(refunds) == 1


def test_store_router_lists_support_item_and_redemption_status_filters(session: Session) -> None:
    team, captain, player = _seed_team(session, player_balance=100)
    active_item = post_store_item(
        team.id,
        StoreItemCreateRequest(name="可兑换护腕", price=10, stock=2, is_active=True),
        captain,
        session,
    )
    inactive_item = post_store_item(
        team.id,
        StoreItemCreateRequest(name="下架徽章", price=10, stock=2, is_active=False),
        captain,
        session,
    )
    pending_redemption = post_redemption(
        team.id,
        RedemptionCreateRequest(id=uuid4(), store_item_id=active_item.id, quantity=1),
        player,
        session,
    )
    fulfilled_redemption = post_redemption(
        team.id,
        RedemptionCreateRequest(id=uuid4(), store_item_id=active_item.id, quantity=1),
        player,
        session,
    )
    post_fulfill_redemption(fulfilled_redemption.id, captain, session)

    assert [item.id for item in read_store_items(team.id, captain, session, True)] == [active_item.id]
    assert [item.id for item in read_store_items(team.id, captain, session, False)] == [inactive_item.id]
    assert [item.id for item in read_store_items(team.id, player, session, None)] == [active_item.id]
    assert [item.id for item in read_store_items(team.id, player, session, True)] == [active_item.id]
    assert read_store_items(team.id, player, session, False) == []
    my_redemptions = read_my_redemptions(team.id, player, session, RedemptionStatus.pending)
    assert [redemption["id"] for redemption in my_redemptions] == [pending_redemption.id]
    assert my_redemptions[0]["user"]["name"] == player.name
    assert my_redemptions[0]["user"]["email"] == player.email

    managed_redemptions = read_team_redemptions(team.id, captain, session, RedemptionStatus.fulfilled)
    assert [redemption["id"] for redemption in managed_redemptions] == [fulfilled_redemption.id]
    assert managed_redemptions[0]["user"]["name"] == player.name
    assert managed_redemptions[0]["user"]["email"] == player.email


def test_store_router_rejects_cross_team_captain_item_and_redemption_management(
    session: Session,
) -> None:
    team, captain, player = _seed_team(session, player_balance=100)
    _, other_captain = _seed_second_team(session)
    item = post_store_item(
        team.id,
        StoreItemCreateRequest(name="跨队测试商品", price=20, stock=2, is_active=True),
        captain,
        session,
    )
    redemption = post_redemption(
        team.id,
        RedemptionCreateRequest(id=uuid4(), store_item_id=item.id, quantity=1),
        player,
        session,
    )

    with pytest.raises(HTTPException) as patch_item_exc:
        patch_store_item(item.id, StoreItemUpdateRequest(price=1), other_captain, session)
    assert patch_item_exc.value.status_code == 403
    assert patch_item_exc.value.detail["code"] == "STORE_PERMISSION_DENIED"

    with pytest.raises(HTTPException) as manage_redemptions_exc:
        read_team_redemptions(team.id, other_captain, session)
    assert manage_redemptions_exc.value.status_code == 403
    assert manage_redemptions_exc.value.detail["code"] == "STORE_PERMISSION_DENIED"

    with pytest.raises(HTTPException) as fulfill_exc:
        post_fulfill_redemption(redemption.id, other_captain, session)
    assert fulfill_exc.value.status_code == 403
    assert fulfill_exc.value.detail["code"] == "STORE_PERMISSION_DENIED"

    session.refresh(item)
    session.refresh(redemption)
    assert item.price == 20
    assert item.stock == 1
    assert redemption.status == RedemptionStatus.pending


def test_store_refund_transactions_are_database_unique_per_redemption(session: Session) -> None:
    team, captain, player = _seed_team(session)
    item = post_store_item(
        team.id,
        StoreItemCreateRequest(name="数据库唯一退款", price=10, stock=2, is_active=True),
        captain,
        session,
    )
    redemption = post_redemption(
        team.id,
        RedemptionCreateRequest(id=uuid4(), store_item_id=item.id, quantity=1),
        player,
        session,
    )
    post_fulfill_redemption(redemption.id, captain, session)
    post_refund_redemption(redemption.id, captain, session)

    session.add(
        CoinTransaction(
            team_id=team.id,
            user_id=player.id,
            amount=redemption.total_price,
            type=CoinTransactionType.refund,
            reason="Duplicate refund should be rejected by DB",
            reference_type="redemption",
            reference_id=redemption.id,
            created_by=captain.id,
        )
    )
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()

    refunds = [
        transaction
        for transaction in session.query(CoinTransaction).all()
        if transaction.type == CoinTransactionType.refund and transaction.reference_id == redemption.id
    ]
    assert len(refunds) == 1

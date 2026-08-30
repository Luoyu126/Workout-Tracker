from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.coins.service import coin_balance
from app.common.enums import (
    CoinTransactionType,
    MembershipRole,
    NotificationType,
    RedemptionStatus,
    enum_value,
)
from app.common.permissions import PermissionDeniedError
from app.models import CoinTransaction, Redemption, StoreItem, User
from app.notifications.service import create_user_notification
from app.store.schemas import (
    RedemptionCreateRequest,
    StoreItemCreateRequest,
    StoreItemUpdateRequest,
)
from app.teams.service import get_active_membership, require_team_role


class StoreItemNotFoundError(Exception):
    pass


class RedemptionNotFoundError(Exception):
    pass


class StoreRuleError(Exception):
    pass


def _lock_user_coin_ledger(session: Session, user_id: UUID) -> None:
    session.scalar(select(User.id).where(User.id == user_id).with_for_update())


def _user_summary(user: User | None) -> dict[str, object] | None:
    if user is None:
        return None
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "avatar_url": user.avatar_url,
    }


def _redemption_read(redemption: Redemption, redemption_user: User | None) -> dict[str, object]:
    return {
        "id": redemption.id,
        "team_id": redemption.team_id,
        "user_id": redemption.user_id,
        "user": _user_summary(redemption_user),
        "store_item_id": redemption.store_item_id,
        "quantity": redemption.quantity,
        "unit_price": redemption.unit_price,
        "total_price": redemption.total_price,
        "status": redemption.status,
        "fulfilled_by": redemption.fulfilled_by,
        "fulfilled_at": redemption.fulfilled_at,
        "cancelled_by": redemption.cancelled_by,
        "cancelled_at": redemption.cancelled_at,
        "refunded_by": redemption.refunded_by,
        "refunded_at": redemption.refunded_at,
        "created_at": redemption.created_at,
        "updated_at": redemption.updated_at,
    }


def _get_store_item(session: Session, item_id: UUID) -> StoreItem:
    item = session.get(StoreItem, item_id)
    if item is None:
        raise StoreItemNotFoundError("Store item not found")
    return item


def list_store_items(
    session: Session,
    team_id: UUID,
    user: User,
    is_active: bool | None = None,
) -> list[StoreItem]:
    membership = get_active_membership(session, team_id, user.id)
    stmt = select(StoreItem).where(StoreItem.team_id == team_id).order_by(StoreItem.created_at.desc())
    if membership.role == MembershipRole.member:
        stmt = stmt.where(StoreItem.is_active.is_(True))
        if is_active is False:
            stmt = stmt.where(StoreItem.is_active.is_(False))
    elif is_active is not None:
        stmt = stmt.where(StoreItem.is_active.is_(is_active))
    return list(session.scalars(stmt))


def get_store_item(session: Session, item_id: UUID, user: User) -> StoreItem:
    item = _get_store_item(session, item_id)
    get_active_membership(session, item.team_id, user.id)
    if not item.is_active:
        membership = get_active_membership(session, item.team_id, user.id)
        if membership.role == MembershipRole.member:
            raise StoreItemNotFoundError("Store item not found")
    return item


def create_store_item(
    session: Session,
    team_id: UUID,
    user: User,
    payload: StoreItemCreateRequest,
) -> StoreItem:
    require_team_role(session, team_id, user.id, MembershipRole.admin)
    if payload.id is not None:
        existing = session.get(StoreItem, payload.id)
        if existing is not None:
            if (
                existing.team_id != team_id
                or existing.created_by != user.id
                or existing.name != payload.name
                or existing.description != payload.description
                or existing.image_url != payload.image_url
                or existing.price != payload.price
                or existing.stock != payload.stock
                or existing.is_active != payload.is_active
            ):
                raise StoreRuleError("Store item id already belongs to another request")
            return existing
    item = StoreItem(team_id=team_id, created_by=user.id, **payload.model_dump())
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


def update_store_item(
    session: Session,
    item_id: UUID,
    user: User,
    payload: StoreItemUpdateRequest,
) -> StoreItem:
    item = _get_store_item(session, item_id)
    require_team_role(session, item.team_id, user.id, MembershipRole.admin)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    session.commit()
    session.refresh(item)
    return item


def create_redemption(
    session: Session,
    team_id: UUID,
    user: User,
    payload: RedemptionCreateRequest,
) -> Redemption:
    membership = get_active_membership(session, team_id, user.id)
    if membership.role != MembershipRole.member:
        raise PermissionDeniedError("Only members can create redemptions")
    existing = session.get(Redemption, payload.id)
    if existing is not None:
        if (
            existing.user_id != user.id
            or existing.team_id != team_id
            or existing.store_item_id != payload.store_item_id
            or existing.quantity != payload.quantity
        ):
            raise StoreRuleError("Redemption id already belongs to another request")
        return existing

    item = session.scalar(
        select(StoreItem).where(StoreItem.id == payload.store_item_id).with_for_update()
    )
    if item is None:
        raise StoreItemNotFoundError("Store item not found")
    if item.team_id != team_id or not item.is_active:
        raise StoreRuleError("Store item is not available")
    if item.stock is not None and item.stock < payload.quantity:
        raise StoreRuleError("Insufficient stock")

    total_price = item.price * payload.quantity
    _lock_user_coin_ledger(session, user.id)
    if coin_balance(session, team_id, user) < total_price:
        raise StoreRuleError("Insufficient coin balance")

    redemption = Redemption(
        id=payload.id,
        team_id=team_id,
        user_id=user.id,
        store_item_id=item.id,
        quantity=payload.quantity,
        unit_price=item.price,
        total_price=total_price,
        status=RedemptionStatus.pending,
    )
    session.add(redemption)
    session.add(
        CoinTransaction(
            team_id=team_id,
            user_id=user.id,
            amount=-total_price,
            type=CoinTransactionType.redemption,
            reason=f"Redeemed {item.name}",
            reference_type="redemption",
            reference_id=redemption.id,
            created_by=user.id,
            metadata_={"store_item_id": str(item.id), "quantity": payload.quantity},
        )
    )
    if item.stock is not None:
        item.stock -= payload.quantity
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        existing = session.get(Redemption, payload.id)
        if (
            existing is not None
            and existing.user_id == user.id
            and existing.team_id == team_id
            and existing.store_item_id == payload.store_item_id
            and existing.quantity == payload.quantity
        ):
            return existing
        raise StoreRuleError("Redemption transaction already exists") from exc
    session.refresh(redemption)
    return redemption


def list_my_redemptions(
    session: Session,
    team_id: UUID,
    user: User,
    status: RedemptionStatus | None = None,
) -> list[dict[str, object]]:
    get_active_membership(session, team_id, user.id)
    stmt = (
        select(Redemption, User)
        .join(User, User.id == Redemption.user_id)
        .where(Redemption.team_id == team_id, Redemption.user_id == user.id)
        .order_by(Redemption.created_at.desc())
    )
    if status is not None:
        stmt = stmt.where(Redemption.status == status)
    return [_redemption_read(redemption, redemption_user) for redemption, redemption_user in session.execute(stmt).all()]


def list_team_redemptions(
    session: Session,
    team_id: UUID,
    user: User,
    status: RedemptionStatus | None = None,
) -> list[dict[str, object]]:
    require_team_role(session, team_id, user.id, MembershipRole.admin)
    stmt = (
        select(Redemption, User)
        .join(User, User.id == Redemption.user_id)
        .where(Redemption.team_id == team_id)
        .order_by(Redemption.created_at.desc())
    )
    if status is not None:
        stmt = stmt.where(Redemption.status == status)
    return [_redemption_read(redemption, redemption_user) for redemption, redemption_user in session.execute(stmt).all()]


def fulfill_redemption(session: Session, redemption_id: UUID, user: User) -> Redemption:
    redemption = session.scalar(
        select(Redemption).where(Redemption.id == redemption_id).with_for_update()
    )
    if redemption is None:
        raise RedemptionNotFoundError("Redemption not found")
    require_team_role(session, redemption.team_id, user.id, MembershipRole.admin)
    if redemption.status == RedemptionStatus.fulfilled:
        return redemption
    if redemption.status != RedemptionStatus.pending:
        raise StoreRuleError("Only pending redemptions can be fulfilled")
    redemption.status = RedemptionStatus.fulfilled
    redemption.fulfilled_by = user.id
    redemption.fulfilled_at = datetime.now(UTC)
    create_user_notification(
        session,
        redemption.user_id,
        redemption.team_id,
        NotificationType.redemption_completed,
        title="兑换已完成",
        body="你的兑换订单已完成。",
        reference_type="redemption",
        reference_id=redemption.id,
    )
    session.commit()
    session.refresh(redemption)
    return redemption


def _refund_redemption(
    session: Session,
    redemption: Redemption,
    user: User,
    next_status: RedemptionStatus,
    *,
    restore_stock: bool,
) -> None:
    existing_refund = session.scalar(
        select(CoinTransaction).where(
            CoinTransaction.team_id == redemption.team_id,
            CoinTransaction.user_id == redemption.user_id,
            CoinTransaction.type == CoinTransactionType.refund,
            CoinTransaction.reference_type == "redemption",
            CoinTransaction.reference_id == redemption.id,
        )
    )
    if existing_refund is not None:
        if redemption.status == next_status:
            return
        raise StoreRuleError("Redemption has already been refunded")

    session.add(
        CoinTransaction(
            team_id=redemption.team_id,
            user_id=redemption.user_id,
            amount=redemption.total_price,
            type=CoinTransactionType.refund,
            reason="Redemption refund",
            reference_type="redemption",
            reference_id=redemption.id,
            created_by=user.id,
            metadata_={"next_status": enum_value(next_status)},
        )
    )
    if restore_stock:
        item = session.scalar(
            select(StoreItem).where(StoreItem.id == redemption.store_item_id).with_for_update()
        )
        if item is not None and item.stock is not None:
            item.stock += redemption.quantity
    redemption.status = next_status
    now = datetime.now(UTC)
    if next_status == RedemptionStatus.cancelled:
        redemption.cancelled_by = user.id
        redemption.cancelled_at = now
    else:
        redemption.refunded_by = user.id
        redemption.refunded_at = now


def cancel_redemption(session: Session, redemption_id: UUID, user: User) -> Redemption:
    redemption = session.scalar(
        select(Redemption).where(Redemption.id == redemption_id).with_for_update()
    )
    if redemption is None:
        raise RedemptionNotFoundError("Redemption not found")
    require_team_role(session, redemption.team_id, user.id, MembershipRole.admin)
    if redemption.status == RedemptionStatus.cancelled:
        return redemption
    if redemption.status != RedemptionStatus.pending:
        raise StoreRuleError("Only pending redemptions can be cancelled")
    _refund_redemption(
        session,
        redemption,
        user,
        RedemptionStatus.cancelled,
        restore_stock=True,
    )
    session.commit()
    session.refresh(redemption)
    return redemption


def refund_redemption(session: Session, redemption_id: UUID, user: User) -> Redemption:
    redemption = session.scalar(
        select(Redemption).where(Redemption.id == redemption_id).with_for_update()
    )
    if redemption is None:
        raise RedemptionNotFoundError("Redemption not found")
    require_team_role(session, redemption.team_id, user.id, MembershipRole.admin)
    if redemption.status == RedemptionStatus.refunded:
        return redemption
    if redemption.status != RedemptionStatus.fulfilled:
        raise StoreRuleError("Only fulfilled redemptions can be refunded")
    _refund_redemption(
        session,
        redemption,
        user,
        RedemptionStatus.refunded,
        restore_stock=False,
    )
    session.commit()
    session.refresh(redemption)
    return redemption

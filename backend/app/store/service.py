from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.coins import repository as coin_repository
from app.common.enums import (
    CoinTransactionType,
    MembershipRole,
    NotificationType,
    RedemptionStatus,
    enum_value,
)
from app.common.permissions import PermissionDeniedError
from app.common.transactions import transaction_boundary
from app.models import CoinTransaction, Redemption, StoreItem, TeamMembership, User
from app.notifications.service import create_user_notification
from app.store import repository
from app.store.errors import RedemptionNotFoundError, StoreItemNotFoundError, StoreRuleError
from app.store.schemas import (
    RedemptionCreateRequest,
    StoreItemCreateRequest,
    StoreItemUpdateRequest,
)
from app.teams.service import get_active_membership, require_team_role


def _store_membership(session: Session, team_id: UUID, user_id: UUID) -> TeamMembership:
    return get_active_membership(
        session,
        team_id,
        user_id,
        permission_code="STORE_PERMISSION_DENIED",
        operation="store.require_membership",
    )


def _store_admin(session: Session, team_id: UUID, user_id: UUID, operation: str) -> None:
    require_team_role(
        session,
        team_id,
        user_id,
        MembershipRole.admin,
        permission_code="STORE_PERMISSION_DENIED",
        operation=operation,
    )


def _user_summary(user: User | None) -> dict[str, object] | None:
    if user is None:
        return None
    return {"id": user.id, "name": user.name, "email": user.email, "avatar_url": user.avatar_url}


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
    item = repository.get_store_item(session, item_id)
    if item is None:
        raise StoreItemNotFoundError()
    return item


def list_store_items(
    session: Session,
    team_id: UUID,
    user: User,
    is_active: bool | None = None,
) -> list[StoreItem]:
    membership = _store_membership(session, team_id, user.id)
    effective_filter = is_active
    if membership.role == MembershipRole.member:
        if is_active is False:
            return []
        effective_filter = True
    return repository.list_store_items(session, team_id, effective_filter)


def get_store_item(session: Session, item_id: UUID, user: User) -> StoreItem:
    item = _get_store_item(session, item_id)
    membership = _store_membership(session, item.team_id, user.id)
    if not item.is_active and membership.role == MembershipRole.member:
        raise StoreItemNotFoundError()
    return item


def create_store_item(
    session: Session,
    team_id: UUID,
    user: User,
    payload: StoreItemCreateRequest,
) -> StoreItem:
    with transaction_boundary(session):
        _store_admin(session, team_id, user.id, "store.create_item")
        existing = repository.get_store_item(session, payload.id) if payload.id is not None else None
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
            item = existing
        else:
            item = StoreItem(team_id=team_id, created_by=user.id, **payload.model_dump())
            repository.add(session, item)
    repository.refresh(session, item)
    return item


def update_store_item(
    session: Session,
    item_id: UUID,
    user: User,
    payload: StoreItemUpdateRequest,
) -> StoreItem:
    with transaction_boundary(session):
        item = _get_store_item(session, item_id)
        _store_admin(session, item.team_id, user.id, "store.update_item")
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(item, field, value)
    repository.refresh(session, item)
    return item


def create_redemption(
    session: Session,
    team_id: UUID,
    user: User,
    payload: RedemptionCreateRequest,
) -> Redemption:
    try:
        with transaction_boundary(session):
            membership = _store_membership(session, team_id, user.id)
            if membership.role != MembershipRole.member:
                raise PermissionDeniedError(
                    "Only members can create redemptions",
                    code="STORE_PERMISSION_DENIED",
                    operation="store.create_redemption",
                )
            existing = repository.get_redemption(session, payload.id)
            if existing is not None:
                if (
                    existing.user_id != user.id
                    or existing.team_id != team_id
                    or existing.store_item_id != payload.store_item_id
                    or existing.quantity != payload.quantity
                ):
                    raise StoreRuleError("Redemption id already belongs to another request")
                redemption = existing
            else:
                item = repository.get_store_item_for_update(session, payload.store_item_id)
                if item is None:
                    raise StoreItemNotFoundError()
                if item.team_id != team_id or not item.is_active:
                    raise StoreRuleError("Store item is not available")
                if item.stock is not None and item.stock < payload.quantity:
                    raise StoreRuleError("Insufficient stock")
                total_price = item.price * payload.quantity
                repository.lock_user_coin_ledger(session, user.id)
                if coin_repository.sum_balance(session, team_id, user.id) < total_price:
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
                repository.add(session, redemption)
                coin_repository.add(
                    session,
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
                    ),
                )
                if item.stock is not None:
                    item.stock -= payload.quantity
    except IntegrityError as exc:
        existing = repository.get_redemption(session, payload.id)
        if (
            existing is not None
            and existing.user_id == user.id
            and existing.team_id == team_id
            and existing.store_item_id == payload.store_item_id
            and existing.quantity == payload.quantity
        ):
            return existing
        raise StoreRuleError("Redemption transaction already exists") from exc
    repository.refresh(session, redemption)
    return redemption


def list_my_redemptions(
    session: Session,
    team_id: UUID,
    user: User,
    status: RedemptionStatus | None = None,
) -> list[dict[str, object]]:
    _store_membership(session, team_id, user.id)
    return [
        _redemption_read(redemption, redemption_user)
        for redemption, redemption_user in repository.list_redemptions_with_users(
            session,
            team_id,
            user_id=user.id,
            status=status,
        )
    ]


def list_team_redemptions(
    session: Session,
    team_id: UUID,
    user: User,
    status: RedemptionStatus | None = None,
) -> list[dict[str, object]]:
    _store_admin(session, team_id, user.id, "store.list_team_redemptions")
    return [
        _redemption_read(redemption, redemption_user)
        for redemption, redemption_user in repository.list_redemptions_with_users(
            session,
            team_id,
            user_id=None,
            status=status,
        )
    ]


def fulfill_redemption(session: Session, redemption_id: UUID, user: User) -> Redemption:
    with transaction_boundary(session):
        redemption = repository.get_redemption_for_update(session, redemption_id)
        if redemption is None:
            raise RedemptionNotFoundError()
        _store_admin(session, redemption.team_id, user.id, "store.fulfill_redemption")
        if redemption.status != RedemptionStatus.fulfilled:
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
    repository.refresh(session, redemption)
    return redemption


def _refund_redemption(
    session: Session,
    redemption: Redemption,
    user: User,
    next_status: RedemptionStatus,
    *,
    restore_stock: bool,
) -> None:
    """Domain helper: apply a refund without committing the caller's transaction."""

    existing_refund = coin_repository.find_refund_transaction(
        session,
        redemption.team_id,
        redemption.user_id,
        redemption.id,
    )
    if existing_refund is not None:
        if redemption.status == next_status:
            return
        raise StoreRuleError("Redemption has already been refunded")
    coin_repository.add(
        session,
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
        ),
    )
    if restore_stock:
        item = repository.get_store_item_for_update(session, redemption.store_item_id)
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
    with transaction_boundary(session):
        redemption = repository.get_redemption_for_update(session, redemption_id)
        if redemption is None:
            raise RedemptionNotFoundError()
        _store_admin(session, redemption.team_id, user.id, "store.cancel_redemption")
        if redemption.status != RedemptionStatus.cancelled:
            if redemption.status != RedemptionStatus.pending:
                raise StoreRuleError("Only pending redemptions can be cancelled")
            _refund_redemption(
                session,
                redemption,
                user,
                RedemptionStatus.cancelled,
                restore_stock=True,
            )
    repository.refresh(session, redemption)
    return redemption


def refund_redemption(session: Session, redemption_id: UUID, user: User) -> Redemption:
    with transaction_boundary(session):
        redemption = repository.get_redemption_for_update(session, redemption_id)
        if redemption is None:
            raise RedemptionNotFoundError()
        _store_admin(session, redemption.team_id, user.id, "store.refund_redemption")
        if redemption.status != RedemptionStatus.refunded:
            if redemption.status != RedemptionStatus.fulfilled:
                raise StoreRuleError("Only fulfilled redemptions can be refunded")
            _refund_redemption(
                session,
                redemption,
                user,
                RedemptionStatus.refunded,
                restore_stock=False,
            )
    repository.refresh(session, redemption)
    return redemption

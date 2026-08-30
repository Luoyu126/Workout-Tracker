from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.enums import RedemptionStatus
from app.models import Redemption, StoreItem, User


def get_store_item(session: Session, item_id: UUID) -> StoreItem | None:
    return session.get(StoreItem, item_id)


def get_store_item_for_update(session: Session, item_id: UUID) -> StoreItem | None:
    return session.scalar(select(StoreItem).where(StoreItem.id == item_id).with_for_update())


def list_store_items(session: Session, team_id: UUID, is_active: bool | None) -> list[StoreItem]:
    stmt = select(StoreItem).where(StoreItem.team_id == team_id).order_by(StoreItem.created_at.desc())
    if is_active is not None:
        stmt = stmt.where(StoreItem.is_active.is_(is_active))
    return list(session.scalars(stmt))


def get_redemption(session: Session, redemption_id: UUID) -> Redemption | None:
    return session.get(Redemption, redemption_id)


def get_redemption_for_update(session: Session, redemption_id: UUID) -> Redemption | None:
    return session.scalar(select(Redemption).where(Redemption.id == redemption_id).with_for_update())


def list_redemptions_with_users(
    session: Session,
    team_id: UUID,
    *,
    user_id: UUID | None,
    status: RedemptionStatus | None,
) -> list[tuple[Redemption, User]]:
    stmt = (
        select(Redemption, User)
        .join(User, User.id == Redemption.user_id)
        .where(Redemption.team_id == team_id)
        .order_by(Redemption.created_at.desc())
    )
    if user_id is not None:
        stmt = stmt.where(Redemption.user_id == user_id)
    if status is not None:
        stmt = stmt.where(Redemption.status == status)
    return [(redemption, user) for redemption, user in session.execute(stmt).all()]


def lock_user_coin_ledger(session: Session, user_id: UUID) -> None:
    session.scalar(select(User.id).where(User.id == user_id).with_for_update())


def add(session: Session, value: object) -> None:
    session.add(value)


def refresh(session: Session, value: object) -> None:
    session.refresh(value)

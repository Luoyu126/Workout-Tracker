from datetime import datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.common.enums import CoinRuleTrigger, CoinTransactionType
from app.models import CoinRule, CoinTransaction


def get_rule(session: Session, rule_id: UUID) -> CoinRule | None:
    return session.get(CoinRule, rule_id)


def find_active_rule(
    session: Session,
    team_id: UUID,
    trigger_type: CoinRuleTrigger,
    *,
    exclude_rule_id: UUID | None = None,
) -> CoinRule | None:
    stmt = select(CoinRule).where(
        CoinRule.team_id == team_id,
        CoinRule.trigger_type == trigger_type,
        CoinRule.is_active.is_(True),
    )
    if exclude_rule_id is not None:
        stmt = stmt.where(CoinRule.id != exclude_rule_id)
    return session.scalar(stmt.order_by(CoinRule.updated_at.desc(), CoinRule.created_at.desc()).limit(1))


def list_rules(session: Session, team_id: UUID) -> list[CoinRule]:
    return list(
        session.scalars(
            select(CoinRule)
            .where(CoinRule.team_id == team_id)
            .order_by(CoinRule.trigger_type, CoinRule.name)
        )
    )


def get_transaction(session: Session, transaction_id: UUID) -> CoinTransaction | None:
    return session.get(CoinTransaction, transaction_id)


def list_transactions(
    session: Session,
    team_id: UUID,
    user_id: UUID,
    *,
    transaction_type: CoinTransactionType | None,
    created_after: datetime | None,
    created_before: datetime | None,
) -> list[CoinTransaction]:
    stmt = select(CoinTransaction).where(
        CoinTransaction.team_id == team_id,
        CoinTransaction.user_id == user_id,
    )
    if transaction_type is not None:
        stmt = stmt.where(CoinTransaction.type == transaction_type)
    if created_after is not None:
        stmt = stmt.where(CoinTransaction.created_at >= created_after)
    if created_before is not None:
        stmt = stmt.where(CoinTransaction.created_at <= created_before)
    return list(session.scalars(stmt.order_by(CoinTransaction.created_at.desc())))


def sum_balance(session: Session, team_id: UUID, user_id: UUID) -> int:
    return session.scalar(
        select(func.coalesce(func.sum(CoinTransaction.amount), 0)).where(
            CoinTransaction.team_id == team_id,
            CoinTransaction.user_id == user_id,
        )
    ) or 0


def find_signup_reward_transaction(
    session: Session,
    team_id: UUID,
    user_id: UUID,
    event_id: UUID,
) -> CoinTransaction | None:
    return session.scalar(
        select(CoinTransaction).where(
            CoinTransaction.team_id == team_id,
            CoinTransaction.user_id == user_id,
            CoinTransaction.type == CoinTransactionType.signup_reward,
            CoinTransaction.reference_type == "event",
            CoinTransaction.reference_id == event_id,
        )
    )


def find_refund_transaction(
    session: Session,
    team_id: UUID,
    user_id: UUID,
    redemption_id: UUID,
) -> CoinTransaction | None:
    return session.scalar(
        select(CoinTransaction).where(
            CoinTransaction.team_id == team_id,
            CoinTransaction.user_id == user_id,
            CoinTransaction.type == CoinTransactionType.refund,
            CoinTransaction.reference_type == "redemption",
            CoinTransaction.reference_id == redemption_id,
        )
    )


def add(session: Session, value: object) -> None:
    session.add(value)


def flush(session: Session) -> None:
    session.flush()


def refresh(session: Session, value: object) -> None:
    session.refresh(value)

from datetime import datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.coins.schemas import (
    CoinRuleCreateRequest,
    CoinRuleUpdateRequest,
    CoinTransactionCreateRequest,
)
from app.common.enums import (
    CoinRuleTrigger,
    CoinTransactionType,
    EventType,
    MembershipRole,
    MembershipStatus,
    NotificationType,
    SignupStatus,
    enum_value,
)
from app.models import CoinRule, CoinTransaction, Event, TeamMembership, User
from app.notifications.service import create_user_notification
from app.teams.service import get_active_membership, require_team_role


class CoinRuleNotFoundError(Exception):
    pass


class CoinRuleConflictError(Exception):
    pass


class CoinTransactionConflictError(Exception):
    pass


SIGNUP_RULE_TRIGGERS = {
    CoinRuleTrigger.training_signup,
    CoinRuleTrigger.match_signup,
}


def _ensure_active_signup_rule_available(
    session: Session,
    team_id: UUID,
    trigger_type: CoinRuleTrigger,
    *,
    exclude_rule_id: UUID | None = None,
) -> None:
    if trigger_type not in SIGNUP_RULE_TRIGGERS:
        return
    stmt = select(CoinRule.id).where(
        CoinRule.team_id == team_id,
        CoinRule.trigger_type == trigger_type,
        CoinRule.is_active.is_(True),
    )
    if exclude_rule_id is not None:
        stmt = stmt.where(CoinRule.id != exclude_rule_id)
    if session.scalar(stmt) is not None:
        raise CoinRuleConflictError(f"An active {trigger_type.value} rule already exists")


def reward_amount_for_signup(session: Session, event: Event, signup_status: SignupStatus) -> int:
    trigger_type: CoinRuleTrigger | None = None
    if signup_status == SignupStatus.going and event.type == EventType.training:
        trigger_type = CoinRuleTrigger.training_signup
    elif signup_status == SignupStatus.going and event.type == EventType.match:
        trigger_type = CoinRuleTrigger.match_signup

    if trigger_type is None:
        return 0

    amount = session.scalar(
        select(CoinRule.amount)
        .where(
            CoinRule.team_id == event.team_id,
            CoinRule.trigger_type == trigger_type,
            CoinRule.is_active.is_(True),
        )
        .order_by(CoinRule.updated_at.desc(), CoinRule.created_at.desc())
        .limit(1)
    )
    return amount or 0


def list_coin_rules(session: Session, team_id: UUID, user: User) -> list[CoinRule]:
    get_active_membership(session, team_id, user.id)
    return list(
        session.scalars(
            select(CoinRule).where(CoinRule.team_id == team_id).order_by(CoinRule.trigger_type, CoinRule.name)
        )
    )


def create_coin_rule(
    session: Session,
    team_id: UUID,
    user: User,
    payload: CoinRuleCreateRequest,
) -> CoinRule:
    require_team_role(session, team_id, user.id, MembershipRole.admin)
    if payload.id is not None:
        existing = session.get(CoinRule, payload.id)
        if existing is not None:
            if (
                existing.team_id != team_id
                or existing.created_by != user.id
                or existing.name != payload.name
                or enum_value(existing.trigger_type) != enum_value(payload.trigger_type)
                or existing.amount != payload.amount
                or existing.config != payload.config
                or existing.is_active != payload.is_active
            ):
                raise CoinRuleConflictError("Coin rule id already belongs to another request")
            return existing
    if payload.is_active:
        _ensure_active_signup_rule_available(session, team_id, payload.trigger_type)
    rule = CoinRule(team_id=team_id, created_by=user.id, **payload.model_dump())
    session.add(rule)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise CoinRuleConflictError("An active signup rule already exists") from exc
    session.refresh(rule)
    return rule


def update_coin_rule(
    session: Session,
    rule_id: UUID,
    user: User,
    payload: CoinRuleUpdateRequest,
) -> CoinRule:
    rule = session.get(CoinRule, rule_id)
    if rule is None:
        raise CoinRuleNotFoundError("Coin rule not found")
    require_team_role(session, rule.team_id, user.id, MembershipRole.admin)
    update_data = payload.model_dump(exclude_unset=True)
    if update_data.get("is_active") is True and not rule.is_active:
        _ensure_active_signup_rule_available(
            session,
            rule.team_id,
            rule.trigger_type,
            exclude_rule_id=rule.id,
        )
    for field, value in update_data.items():
        setattr(rule, field, value)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise CoinRuleConflictError("An active signup rule already exists") from exc
    session.refresh(rule)
    return rule


def coin_balance(session: Session, team_id: UUID, user: User, target_user_id: UUID | None = None) -> int:
    get_active_membership(session, team_id, user.id)
    user_id = target_user_id or user.id
    if target_user_id is not None and target_user_id != user.id:
        require_team_role(session, team_id, user.id, MembershipRole.admin)
    return session.scalar(
        select(func.coalesce(func.sum(CoinTransaction.amount), 0)).where(
            CoinTransaction.team_id == team_id,
            CoinTransaction.user_id == user_id,
        )
    ) or 0


def list_coin_transactions(
    session: Session,
    team_id: UUID,
    user: User,
    target_user_id: UUID | None = None,
    transaction_type: CoinTransactionType | None = None,
    created_after: datetime | None = None,
    created_before: datetime | None = None,
) -> list[CoinTransaction]:
    get_active_membership(session, team_id, user.id)
    user_id = target_user_id or user.id
    if target_user_id is not None and target_user_id != user.id:
        require_team_role(session, team_id, user.id, MembershipRole.admin)
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
    return list(
        session.scalars(
            stmt.order_by(CoinTransaction.created_at.desc())
        )
    )


def create_manual_coin_transaction(
    session: Session,
    team_id: UUID,
    user: User,
    payload: CoinTransactionCreateRequest,
) -> CoinTransaction:
    require_team_role(session, team_id, user.id, MembershipRole.admin)
    get_active_membership(session, team_id, payload.user_id)

    existing = session.get(CoinTransaction, payload.id)
    if existing is not None:
        if (
            existing.team_id != team_id
            or existing.user_id != payload.user_id
            or existing.amount != payload.amount
            or existing.type != payload.type
            or existing.reason != payload.reason
            or existing.metadata_ != payload.metadata
        ):
            raise CoinTransactionConflictError("Coin transaction id already belongs to another request")
        return existing

    transaction = CoinTransaction(
        id=payload.id,
        team_id=team_id,
        user_id=payload.user_id,
        amount=payload.amount,
        type=payload.type,
        reason=payload.reason,
        reference_type="manual_adjustment" if payload.type == CoinTransactionType.admin_adjustment else "other_reward",
        reference_id=payload.id,
        created_by=user.id,
        metadata_=payload.metadata,
    )
    session.add(transaction)
    session.flush()
    create_user_notification(
        session,
        payload.user_id,
        team_id,
        NotificationType.coin_earned,
        title="金币已调整" if payload.type == CoinTransactionType.admin_adjustment else "金币奖励",
        body=(
            f"管理员调整 {payload.amount} 金币。"
            if payload.type == CoinTransactionType.admin_adjustment
            else f"获得额外奖励 {payload.amount} 金币。"
        ),
        reference_type="coin_transaction",
        reference_id=transaction.id,
    )
    session.commit()
    session.refresh(transaction)
    return transaction


def issue_signup_reward(
    session: Session,
    event: Event,
    user_id: UUID,
    signup_status: SignupStatus,
    created_by: UUID,
) -> CoinTransaction | None:
    if signup_status != SignupStatus.going:
        return None
    eligible_membership = session.scalar(
        select(TeamMembership.id).where(
            TeamMembership.team_id == event.team_id,
            TeamMembership.user_id == user_id,
            TeamMembership.role == MembershipRole.member,
            TeamMembership.status == MembershipStatus.active,
            TeamMembership.joined_at.is_not(None),
            TeamMembership.joined_at <= event.start_time,
        )
    )
    if eligible_membership is None:
        return None
    amount = reward_amount_for_signup(session, event, signup_status)
    if amount == 0:
        return None

    existing = session.scalar(
        select(CoinTransaction).where(
            CoinTransaction.team_id == event.team_id,
            CoinTransaction.user_id == user_id,
            CoinTransaction.type == CoinTransactionType.signup_reward,
            CoinTransaction.reference_type == "event",
            CoinTransaction.reference_id == event.id,
        )
    )
    if existing is not None:
        return existing

    transaction = CoinTransaction(
        team_id=event.team_id,
        user_id=user_id,
        amount=amount,
        type=CoinTransactionType.signup_reward,
        reason=f"Signup reward for {event.title}",
        reference_type="event",
        reference_id=event.id,
        created_by=created_by,
        metadata_={"status": enum_value(signup_status)},
    )
    session.add(transaction)
    session.flush()
    create_user_notification(
        session,
        user_id,
        event.team_id,
        NotificationType.coin_earned,
        title="金币已到账",
        body=f"{event.title} 报名奖励 {amount} 金币。",
        reference_type="coin_transaction",
        reference_id=transaction.id,
    )
    return transaction

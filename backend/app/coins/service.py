from datetime import datetime
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.coins import repository
from app.coins.errors import (
    CoinRuleConflictError,
    CoinRuleNotFoundError,
    CoinTransactionConflictError,
)
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
    NotificationType,
    SignupStatus,
    enum_value,
)
from app.common.transactions import transaction_boundary
from app.models import CoinRule, CoinTransaction, Event, TeamMembership, User
from app.notifications.service import create_user_notification
from app.teams import repository as team_repository
from app.teams.eligibility import is_membership_eligible_for_event
from app.teams.service import get_active_membership, require_team_role

SIGNUP_RULE_TRIGGERS = {CoinRuleTrigger.training_signup, CoinRuleTrigger.match_signup}


def _ensure_active_signup_rule_available(
    session: Session,
    team_id: UUID,
    trigger_type: CoinRuleTrigger,
    *,
    exclude_rule_id: UUID | None = None,
) -> None:
    if trigger_type in SIGNUP_RULE_TRIGGERS and repository.find_active_rule(
        session,
        team_id,
        trigger_type,
        exclude_rule_id=exclude_rule_id,
    ) is not None:
        raise CoinRuleConflictError(f"An active {trigger_type.value} rule already exists")


def reward_amount_for_signup(session: Session, event: Event, signup_status: SignupStatus) -> int:
    trigger_type: CoinRuleTrigger | None = None
    if signup_status == SignupStatus.going and event.type == EventType.training:
        trigger_type = CoinRuleTrigger.training_signup
    elif signup_status == SignupStatus.going and event.type == EventType.match:
        trigger_type = CoinRuleTrigger.match_signup
    if trigger_type is None:
        return 0
    rule = repository.find_active_rule(session, event.team_id, trigger_type)
    return rule.amount if rule is not None else 0


def _coin_permission(session: Session, team_id: UUID, user_id: UUID) -> None:
    get_active_membership(
        session,
        team_id,
        user_id,
        permission_code="COIN_PERMISSION_DENIED",
        operation="coins.require_membership",
    )


def _coin_admin(session: Session, team_id: UUID, user_id: UUID, operation: str) -> None:
    require_team_role(
        session,
        team_id,
        user_id,
        MembershipRole.admin,
        permission_code="COIN_PERMISSION_DENIED",
        operation=operation,
    )


def list_coin_rules(session: Session, team_id: UUID, user: User) -> list[CoinRule]:
    _coin_permission(session, team_id, user.id)
    return repository.list_rules(session, team_id)


def create_coin_rule(
    session: Session,
    team_id: UUID,
    user: User,
    payload: CoinRuleCreateRequest,
) -> CoinRule:
    try:
        with transaction_boundary(session):
            _coin_admin(session, team_id, user.id, "coins.create_rule")
            existing = repository.get_rule(session, payload.id) if payload.id is not None else None
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
                rule = existing
            else:
                if payload.is_active:
                    _ensure_active_signup_rule_available(session, team_id, payload.trigger_type)
                rule = CoinRule(team_id=team_id, created_by=user.id, **payload.model_dump())
                repository.add(session, rule)
    except IntegrityError as exc:
        raise CoinRuleConflictError("An active signup rule already exists") from exc
    repository.refresh(session, rule)
    return rule


def update_coin_rule(
    session: Session,
    rule_id: UUID,
    user: User,
    payload: CoinRuleUpdateRequest,
) -> CoinRule:
    try:
        with transaction_boundary(session):
            rule = repository.get_rule(session, rule_id)
            if rule is None:
                raise CoinRuleNotFoundError()
            _coin_admin(session, rule.team_id, user.id, "coins.update_rule")
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
    except IntegrityError as exc:
        raise CoinRuleConflictError("An active signup rule already exists") from exc
    repository.refresh(session, rule)
    return rule


def coin_balance(session: Session, team_id: UUID, user: User, target_user_id: UUID | None = None) -> int:
    _coin_permission(session, team_id, user.id)
    user_id = target_user_id or user.id
    if target_user_id is not None and target_user_id != user.id:
        _coin_admin(session, team_id, user.id, "coins.read_member_balance")
    return repository.sum_balance(session, team_id, user_id)


def list_coin_transactions(
    session: Session,
    team_id: UUID,
    user: User,
    target_user_id: UUID | None = None,
    transaction_type: CoinTransactionType | None = None,
    created_after: datetime | None = None,
    created_before: datetime | None = None,
) -> list[CoinTransaction]:
    _coin_permission(session, team_id, user.id)
    user_id = target_user_id or user.id
    if target_user_id is not None and target_user_id != user.id:
        _coin_admin(session, team_id, user.id, "coins.list_member_transactions")
    return repository.list_transactions(
        session,
        team_id,
        user_id,
        transaction_type=transaction_type,
        created_after=created_after,
        created_before=created_before,
    )


def create_manual_coin_transaction(
    session: Session,
    team_id: UUID,
    user: User,
    payload: CoinTransactionCreateRequest,
) -> CoinTransaction:
    with transaction_boundary(session):
        _coin_admin(session, team_id, user.id, "coins.create_manual_transaction")
        get_active_membership(
            session,
            team_id,
            payload.user_id,
            permission_code="COIN_PERMISSION_DENIED",
            operation="coins.create_manual_transaction",
        )
        existing = repository.get_transaction(session, payload.id)
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
            transaction = existing
        else:
            transaction = CoinTransaction(
                id=payload.id,
                team_id=team_id,
                user_id=payload.user_id,
                amount=payload.amount,
                type=payload.type,
                reason=payload.reason,
                reference_type=(
                    "manual_adjustment"
                    if payload.type == CoinTransactionType.admin_adjustment
                    else "other_reward"
                ),
                reference_id=payload.id,
                created_by=user.id,
                metadata_=payload.metadata,
            )
            repository.add(session, transaction)
            repository.flush(session)
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
    repository.refresh(session, transaction)
    return transaction


def issue_signup_reward(
    session: Session,
    event: Event,
    user_id: UUID,
    signup_status: SignupStatus,
    created_by: UUID,
    *,
    membership: TeamMembership | None = None,
) -> CoinTransaction | None:
    """Domain helper: add a signup reward without committing the caller's transaction."""

    if signup_status != SignupStatus.going:
        return None
    if membership is None:
        membership = team_repository.find_membership(session, event.team_id, user_id)
    if membership is None or not is_membership_eligible_for_event(membership, event):
        return None
    amount = reward_amount_for_signup(session, event, signup_status)
    if amount == 0:
        return None
    existing = repository.find_signup_reward_transaction(session, event.team_id, user_id, event.id)
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
    repository.add(session, transaction)
    repository.flush(session)
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

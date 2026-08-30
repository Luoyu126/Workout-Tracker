from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.coins.schemas import (
    CoinBalanceRead,
    CoinRuleCreateRequest,
    CoinRuleRead,
    CoinRuleUpdateRequest,
    CoinTransactionCreateRequest,
    CoinTransactionRead,
)
from app.coins.service import (
    coin_balance,
    create_coin_rule,
    create_manual_coin_transaction,
    list_coin_rules,
    list_coin_transactions,
    update_coin_rule,
)
from app.common.database import get_db
from app.common.dependencies import current_user
from app.common.enums import CoinTransactionType
from app.models import CoinRule, CoinTransaction, User

router = APIRouter(prefix="/api/v1", tags=["coins"])


@router.get("/teams/{team_id}/coins/balance", response_model=CoinBalanceRead)
def read_coin_balance(
    team_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> dict[str, object]:
    return {"team_id": team_id, "user_id": user.id, "balance": coin_balance(session, team_id, user)}


@router.get("/teams/{team_id}/coins/transactions", response_model=list[CoinTransactionRead])
def read_my_coin_transactions(
    team_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
    transaction_type: Annotated[CoinTransactionType | None, Query(alias="type")] = None,
    created_after: datetime | None = None,
    created_before: datetime | None = None,
) -> list[CoinTransaction]:
    return list_coin_transactions(session, team_id, user, None, transaction_type, created_after, created_before)


@router.get("/teams/{team_id}/members/{user_id}/coin-transactions", response_model=list[CoinTransactionRead])
def read_member_coin_transactions(
    team_id: UUID,
    user_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
    transaction_type: Annotated[CoinTransactionType | None, Query(alias="type")] = None,
    created_after: datetime | None = None,
    created_before: datetime | None = None,
) -> list[CoinTransaction]:
    return list_coin_transactions(session, team_id, user, user_id, transaction_type, created_after, created_before)


@router.post(
    "/teams/{team_id}/coin-transactions",
    response_model=CoinTransactionRead,
    status_code=status.HTTP_201_CREATED,
)
def post_coin_transaction(
    team_id: UUID,
    payload: CoinTransactionCreateRequest,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> CoinTransaction:
    return create_manual_coin_transaction(session, team_id, user, payload)


@router.get("/teams/{team_id}/coin-rules", response_model=list[CoinRuleRead])
def read_coin_rules(
    team_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> list[CoinRule]:
    return list_coin_rules(session, team_id, user)


@router.post("/teams/{team_id}/coin-rules", response_model=CoinRuleRead, status_code=status.HTTP_201_CREATED)
def post_coin_rule(
    team_id: UUID,
    payload: CoinRuleCreateRequest,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> CoinRule:
    return create_coin_rule(session, team_id, user, payload)


@router.patch("/coin-rules/{coin_rule_id}", response_model=CoinRuleRead)
def patch_coin_rule(
    coin_rule_id: UUID,
    payload: CoinRuleUpdateRequest,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> CoinRule:
    return update_coin_rule(session, coin_rule_id, user, payload)

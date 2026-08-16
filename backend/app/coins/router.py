from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
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
    CoinRuleConflictError,
    CoinRuleNotFoundError,
    CoinTransactionConflictError,
    coin_balance,
    create_coin_rule,
    create_manual_coin_transaction,
    list_coin_rules,
    list_coin_transactions,
    update_coin_rule,
)
from app.common.database import get_db
from app.common.enums import CoinTransactionType
from app.common.permissions import PermissionDeniedError
from app.models import CoinRule, CoinTransaction, User
from app.users.router import current_user

router = APIRouter(prefix="/api/v1", tags=["coins"])


def _to_http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, PermissionDeniedError):
        return HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "COIN_PERMISSION_DENIED", "message": "Coin permission denied"},
        )
    if isinstance(exc, CoinRuleNotFoundError):
        return HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "COIN_RULE_NOT_FOUND", "message": "Coin rule not found"},
        )
    if isinstance(exc, CoinRuleConflictError):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "COIN_RULE_CONFLICT", "message": str(exc)},
        )
    if isinstance(exc, CoinTransactionConflictError):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "COIN_TRANSACTION_CONFLICT", "message": str(exc)},
        )
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail={"code": "INTERNAL_ERROR", "message": "Unexpected error"},
    )


@router.get("/teams/{team_id}/coins/balance", response_model=CoinBalanceRead)
def read_coin_balance(
    team_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> dict[str, object]:
    try:
        return {"team_id": team_id, "user_id": user.id, "balance": coin_balance(session, team_id, user)}
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.get("/teams/{team_id}/coins/transactions", response_model=list[CoinTransactionRead])
def read_my_coin_transactions(
    team_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
    transaction_type: Annotated[CoinTransactionType | None, Query(alias="type")] = None,
    created_after: datetime | None = None,
    created_before: datetime | None = None,
) -> list[CoinTransaction]:
    try:
        return list_coin_transactions(session, team_id, user, None, transaction_type, created_after, created_before)
    except Exception as exc:
        raise _to_http_error(exc) from exc


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
    try:
        return list_coin_transactions(session, team_id, user, user_id, transaction_type, created_after, created_before)
    except Exception as exc:
        raise _to_http_error(exc) from exc


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
    try:
        return create_manual_coin_transaction(session, team_id, user, payload)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.get("/teams/{team_id}/coin-rules", response_model=list[CoinRuleRead])
def read_coin_rules(
    team_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> list[CoinRule]:
    try:
        return list_coin_rules(session, team_id, user)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.post("/teams/{team_id}/coin-rules", response_model=CoinRuleRead, status_code=status.HTTP_201_CREATED)
def post_coin_rule(
    team_id: UUID,
    payload: CoinRuleCreateRequest,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> CoinRule:
    try:
        return create_coin_rule(session, team_id, user, payload)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.patch("/coin-rules/{coin_rule_id}", response_model=CoinRuleRead)
def patch_coin_rule(
    coin_rule_id: UUID,
    payload: CoinRuleUpdateRequest,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> CoinRule:
    try:
        return update_coin_rule(session, coin_rule_id, user, payload)
    except Exception as exc:
        raise _to_http_error(exc) from exc

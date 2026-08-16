from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.common.database import get_db
from app.common.enums import RedemptionStatus
from app.common.permissions import PermissionDeniedError
from app.models import Redemption, StoreItem, User
from app.store.schemas import (
    RedemptionCreateRequest,
    RedemptionRead,
    StoreItemCreateRequest,
    StoreItemRead,
    StoreItemUpdateRequest,
)
from app.store.service import (
    RedemptionNotFoundError,
    StoreItemNotFoundError,
    StoreRuleError,
    cancel_redemption,
    create_redemption,
    create_store_item,
    fulfill_redemption,
    get_store_item,
    list_my_redemptions,
    list_store_items,
    list_team_redemptions,
    refund_redemption,
    update_store_item,
)
from app.users.router import current_user

router = APIRouter(prefix="/api/v1", tags=["store"])


def _to_http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, PermissionDeniedError):
        return HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "STORE_PERMISSION_DENIED", "message": "Store permission denied"},
        )
    if isinstance(exc, (StoreItemNotFoundError, RedemptionNotFoundError)):
        return HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "STORE_RESOURCE_NOT_FOUND", "message": "Resource not found"},
        )
    if isinstance(exc, StoreRuleError):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "STORE_RULE_CONFLICT", "message": str(exc)},
        )
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail={"code": "INTERNAL_ERROR", "message": "Unexpected error"},
    )


@router.get("/teams/{team_id}/store-items", response_model=list[StoreItemRead])
def read_store_items(
    team_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
    is_active: Annotated[bool | None, Query()] = None,
) -> list[StoreItem]:
    try:
        return list_store_items(session, team_id, user, is_active)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.get("/store-items/{store_item_id}", response_model=StoreItemRead)
def read_store_item(
    store_item_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> StoreItem:
    try:
        return get_store_item(session, store_item_id, user)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.post("/teams/{team_id}/store-items", response_model=StoreItemRead, status_code=status.HTTP_201_CREATED)
def post_store_item(
    team_id: UUID,
    payload: StoreItemCreateRequest,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> StoreItem:
    try:
        return create_store_item(session, team_id, user, payload)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.patch("/store-items/{store_item_id}", response_model=StoreItemRead)
def patch_store_item(
    store_item_id: UUID,
    payload: StoreItemUpdateRequest,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> StoreItem:
    try:
        return update_store_item(session, store_item_id, user, payload)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.post("/teams/{team_id}/redemptions", response_model=RedemptionRead, status_code=status.HTTP_201_CREATED)
def post_redemption(
    team_id: UUID,
    payload: RedemptionCreateRequest,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> Redemption:
    try:
        return create_redemption(session, team_id, user, payload)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.get("/teams/{team_id}/redemptions", response_model=list[RedemptionRead])
def read_my_redemptions(
    team_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
    redemption_status: Annotated[RedemptionStatus | None, Query(alias="status")] = None,
) -> list[dict[str, object]]:
    try:
        return list_my_redemptions(session, team_id, user, redemption_status)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.get("/teams/{team_id}/redemptions/manage", response_model=list[RedemptionRead])
def read_team_redemptions(
    team_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
    redemption_status: Annotated[RedemptionStatus | None, Query(alias="status")] = None,
) -> list[dict[str, object]]:
    try:
        return list_team_redemptions(session, team_id, user, redemption_status)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.post("/redemptions/{redemption_id}/fulfill", response_model=RedemptionRead)
def post_fulfill_redemption(
    redemption_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> Redemption:
    try:
        return fulfill_redemption(session, redemption_id, user)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.post("/redemptions/{redemption_id}/cancel", response_model=RedemptionRead)
def post_cancel_redemption(
    redemption_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> Redemption:
    try:
        return cancel_redemption(session, redemption_id, user)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.post("/redemptions/{redemption_id}/refund", response_model=RedemptionRead)
def post_refund_redemption(
    redemption_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> Redemption:
    try:
        return refund_redemption(session, redemption_id, user)
    except Exception as exc:
        raise _to_http_error(exc) from exc

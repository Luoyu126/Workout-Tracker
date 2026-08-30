from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.common.database import get_db
from app.common.dependencies import current_user
from app.common.enums import RedemptionStatus
from app.models import Redemption, StoreItem, User
from app.store.schemas import (
    RedemptionCreateRequest,
    RedemptionRead,
    StoreItemCreateRequest,
    StoreItemRead,
    StoreItemUpdateRequest,
)
from app.store.service import (
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

router = APIRouter(prefix="/api/v1", tags=["store"])


@router.get("/teams/{team_id}/store-items", response_model=list[StoreItemRead])
def read_store_items(
    team_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
    is_active: Annotated[bool | None, Query()] = None,
) -> list[StoreItem]:
    return list_store_items(session, team_id, user, is_active)


@router.get("/store-items/{store_item_id}", response_model=StoreItemRead)
def read_store_item(
    store_item_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> StoreItem:
    return get_store_item(session, store_item_id, user)


@router.post("/teams/{team_id}/store-items", response_model=StoreItemRead, status_code=status.HTTP_201_CREATED)
def post_store_item(
    team_id: UUID,
    payload: StoreItemCreateRequest,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> StoreItem:
    return create_store_item(session, team_id, user, payload)


@router.patch("/store-items/{store_item_id}", response_model=StoreItemRead)
def patch_store_item(
    store_item_id: UUID,
    payload: StoreItemUpdateRequest,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> StoreItem:
    return update_store_item(session, store_item_id, user, payload)


@router.post("/teams/{team_id}/redemptions", response_model=RedemptionRead, status_code=status.HTTP_201_CREATED)
def post_redemption(
    team_id: UUID,
    payload: RedemptionCreateRequest,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> Redemption:
    return create_redemption(session, team_id, user, payload)


@router.get("/teams/{team_id}/redemptions", response_model=list[RedemptionRead])
def read_my_redemptions(
    team_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
    redemption_status: Annotated[RedemptionStatus | None, Query(alias="status")] = None,
) -> list[dict[str, object]]:
    return list_my_redemptions(session, team_id, user, redemption_status)


@router.get("/teams/{team_id}/redemptions/manage", response_model=list[RedemptionRead])
def read_team_redemptions(
    team_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
    redemption_status: Annotated[RedemptionStatus | None, Query(alias="status")] = None,
) -> list[dict[str, object]]:
    return list_team_redemptions(session, team_id, user, redemption_status)


@router.post("/redemptions/{redemption_id}/fulfill", response_model=RedemptionRead)
def post_fulfill_redemption(
    redemption_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> Redemption:
    return fulfill_redemption(session, redemption_id, user)


@router.post("/redemptions/{redemption_id}/cancel", response_model=RedemptionRead)
def post_cancel_redemption(
    redemption_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> Redemption:
    return cancel_redemption(session, redemption_id, user)


@router.post("/redemptions/{redemption_id}/refund", response_model=RedemptionRead)
def post_refund_redemption(
    redemption_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> Redemption:
    return refund_redemption(session, redemption_id, user)

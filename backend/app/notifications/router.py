from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.common.database import get_db
from app.common.dependencies import current_user
from app.common.enums import NotificationType
from app.models import DeviceToken, Notification, User
from app.notifications.schemas import (
    DeviceTokenRead,
    DeviceTokenUpsertRequest,
    NotificationRead,
    TeamAnnouncementRequest,
    UnreadCountRead,
)
from app.notifications.service import (
    create_team_announcement,
    deactivate_device_token,
    list_notifications,
    mark_notification_read,
    unread_count,
    upsert_device_token,
)

router = APIRouter(prefix="/api/v1", tags=["notifications"])


@router.get("/notifications", response_model=list[NotificationRead])
def read_notifications(
    team_id: UUID | None = None,
    notification_type: NotificationType | None = Query(default=None, alias="type"),
    unread_only: bool = False,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> list[Notification]:
    return list_notifications(session, user, team_id, notification_type, unread_only)


@router.post("/notifications/{notification_id}/read", response_model=NotificationRead)
def post_notification_read(
    notification_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> Notification:
    return mark_notification_read(session, user, notification_id)


@router.get("/notifications/unread-count", response_model=UnreadCountRead)
def read_unread_count(
    team_id: UUID | None = None,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> dict[str, int]:
    return {"count": unread_count(session, user, team_id)}


@router.post(
    "/teams/{team_id}/announcements",
    response_model=list[NotificationRead],
    status_code=status.HTTP_201_CREATED,
)
def post_team_announcement(
    team_id: UUID,
    payload: TeamAnnouncementRequest,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> list[Notification]:
    return create_team_announcement(session, team_id, user, payload.id, payload.title, payload.body)


@router.put("/device-tokens", response_model=DeviceTokenRead)
def put_device_token(
    payload: DeviceTokenUpsertRequest,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> DeviceToken:
    return upsert_device_token(session, user, payload.token, payload.platform)


@router.delete("/device-tokens/{device_token_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_device_token(
    device_token_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> None:
    deactivate_device_token(session, user, device_token_id)

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.common.database import get_db
from app.common.enums import NotificationType
from app.common.permissions import PermissionDeniedError
from app.models import DeviceToken, Notification, User
from app.notifications.schemas import (
    DeviceTokenRead,
    DeviceTokenUpsertRequest,
    NotificationRead,
    TeamAnnouncementRequest,
    UnreadCountRead,
)
from app.notifications.service import (
    DeviceTokenNotFoundError,
    NotificationNotFoundError,
    TeamAnnouncementConflictError,
    create_team_announcement,
    deactivate_device_token,
    list_notifications,
    mark_notification_read,
    unread_count,
    upsert_device_token,
)
from app.users.router import current_user

router = APIRouter(prefix="/api/v1", tags=["notifications"])


def _to_http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, PermissionDeniedError):
        return HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "NOTIFICATION_PERMISSION_DENIED", "message": "Notification permission denied"},
        )
    if isinstance(exc, (NotificationNotFoundError, DeviceTokenNotFoundError)):
        return HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NOTIFICATION_RESOURCE_NOT_FOUND", "message": "Resource not found"},
        )
    if isinstance(exc, TeamAnnouncementConflictError):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "TEAM_ANNOUNCEMENT_CONFLICT", "message": str(exc)},
        )
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail={"code": "INTERNAL_ERROR", "message": "Unexpected error"},
    )


@router.get("/notifications", response_model=list[NotificationRead])
def read_notifications(
    team_id: UUID | None = None,
    notification_type: NotificationType | None = Query(default=None, alias="type"),
    unread_only: bool = False,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> list[Notification]:
    try:
        return list_notifications(session, user, team_id, notification_type, unread_only)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.post("/notifications/{notification_id}/read", response_model=NotificationRead)
def post_notification_read(
    notification_id: UUID,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> Notification:
    try:
        return mark_notification_read(session, user, notification_id)
    except Exception as exc:
        raise _to_http_error(exc) from exc


@router.get("/notifications/unread-count", response_model=UnreadCountRead)
def read_unread_count(
    team_id: UUID | None = None,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> dict[str, int]:
    try:
        return {"count": unread_count(session, user, team_id)}
    except Exception as exc:
        raise _to_http_error(exc) from exc


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
    try:
        return create_team_announcement(session, team_id, user, payload.id, payload.title, payload.body)
    except Exception as exc:
        raise _to_http_error(exc) from exc


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
    try:
        deactivate_device_token(session, user, device_token_id)
    except Exception as exc:
        raise _to_http_error(exc) from exc

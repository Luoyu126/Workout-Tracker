from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.orm import Session

from app.common.enums import DevicePlatform, MembershipRole, NotificationType
from app.common.transactions import transaction_boundary
from app.config import get_settings
from app.models import DeviceToken, Event, Notification, User
from app.notifications import repository
from app.notifications.errors import (
    DeviceTokenNotFoundError,
    NotificationNotFoundError,
    TeamAnnouncementConflictError,
)
from app.notifications.push import enqueue_push_notifications
from app.teams import repository as team_repository
from app.teams.eligibility import is_membership_active_member_at
from app.teams.service import get_active_membership, require_team_role


def create_user_notification(
    session: Session,
    user_id: UUID,
    team_id: UUID,
    notification_type: NotificationType,
    title: str,
    body: str,
    reference_type: str | None = None,
    reference_id: UUID | None = None,
) -> Notification:
    """Domain helper: add one notification to the caller-owned transaction."""

    notification = Notification(
        user_id=user_id,
        team_id=team_id,
        type=notification_type,
        title=title,
        body=body,
        reference_type=reference_type,
        reference_id=reference_id,
    )
    repository.add(session, notification)
    repository.flush(session)
    enqueue_push_notifications(session, [notification], get_settings())
    return notification


def create_team_notifications(
    session: Session,
    team_id: UUID,
    notification_type: NotificationType,
    title: str,
    body: str,
    reference_type: str | None = None,
    reference_id: UUID | None = None,
) -> list[Notification]:
    """Domain helper: add notifications without committing the caller's transaction."""

    notifications = [
        Notification(
            user_id=user_id,
            team_id=team_id,
            type=notification_type,
            title=title,
            body=body,
            reference_type=reference_type,
            reference_id=reference_id,
        )
        for user_id in team_repository.list_active_user_ids(session, team_id)
    ]
    repository.add_all(session, notifications)
    repository.flush(session)
    enqueue_push_notifications(session, notifications, get_settings())
    return notifications


def _event_notification_content(event: Event) -> tuple[str, str]:
    title = "新比赛" if event.type == "match" else "新活动"
    body = f"{event.title} 已发布，请在 {event.start_time.isoformat()} 前确认是否参加。"
    return title, body


def sync_event_notifications(session: Session, event: Event) -> list[Notification]:
    """Domain helper: synchronize eligible recipients without committing."""

    eligible_user_ids = {
        membership.user_id
        for membership in team_repository.list_member_memberships(session, event.team_id)
        if is_membership_active_member_at(membership, event.created_at)
    }
    existing = repository.list_event_notifications(session, event.team_id, event.id)
    existing_by_user_id = {notification.user_id: notification for notification in existing}
    title, body = _event_notification_content(event)
    now = datetime.now(UTC)
    for notification in existing:
        if notification.user_id not in eligible_user_ids:
            repository.delete_value(session, notification)
            continue
        notification.title = title
        notification.body = body
        notification.reference_type = "event"
        notification.updated_at = now
    created: list[Notification] = []
    for user_id in eligible_user_ids - existing_by_user_id.keys():
        notification = Notification(
            user_id=user_id,
            team_id=event.team_id,
            type=NotificationType.new_event,
            title=title,
            body=body,
            reference_type="event",
            reference_id=event.id,
        )
        repository.add(session, notification)
        created.append(notification)
    repository.flush(session)
    enqueue_push_notifications(session, created, get_settings())
    return [item for item in existing + created if item.user_id in eligible_user_ids]


def delete_event_notifications(session: Session, event_id: UUID) -> None:
    """Domain helper: remove notifications without committing."""

    repository.delete_event_notifications(session, event_id)


def create_team_announcement(
    session: Session,
    team_id: UUID,
    user: User,
    announcement_id: UUID,
    title: str,
    body: str,
) -> list[Notification]:
    with transaction_boundary(session):
        require_team_role(
            session,
            team_id,
            user.id,
            MembershipRole.admin,
            permission_code="NOTIFICATION_PERMISSION_DENIED",
            operation="notifications.create_announcement",
        )
        existing = repository.list_team_announcement_notifications(session, team_id, announcement_id)
        if existing:
            if any(
                notification.title != title
                or notification.body != body
                or notification.reference_type != "team_announcement"
                or notification.reference_id != announcement_id
                for notification in existing
            ):
                raise TeamAnnouncementConflictError(
                    "Team announcement id already belongs to another request"
                )
            notifications = existing
        else:
            notifications = create_team_notifications(
                session,
                team_id,
                NotificationType.team_announcement,
                title=title,
                body=body,
                reference_type="team_announcement",
                reference_id=announcement_id,
            )
    return notifications


def list_notifications(
    session: Session,
    user: User,
    team_id: UUID | None = None,
    notification_type: NotificationType | None = None,
    unread_only: bool = False,
) -> list[Notification]:
    if team_id is not None:
        get_active_membership(
            session,
            team_id,
            user.id,
            permission_code="NOTIFICATION_PERMISSION_DENIED",
            operation="notifications.list",
        )
    return repository.list_for_user(
        session,
        user.id,
        team_id=team_id,
        notification_type=notification_type,
        unread_only=unread_only,
    )


def mark_notification_read(session: Session, user: User, notification_id: UUID) -> Notification:
    with transaction_boundary(session):
        notification = repository.get_notification(session, notification_id)
        if notification is None or notification.user_id != user.id:
            raise NotificationNotFoundError()
        if notification.read_at is None:
            notification.read_at = datetime.now(UTC)
    repository.refresh(session, notification)
    return notification


def unread_count(session: Session, user: User, team_id: UUID | None = None) -> int:
    if team_id is not None:
        get_active_membership(
            session,
            team_id,
            user.id,
            permission_code="NOTIFICATION_PERMISSION_DENIED",
            operation="notifications.unread_count",
        )
    return repository.count_unread(session, user.id, team_id)


def upsert_device_token(
    session: Session,
    user: User,
    token: str,
    platform: DevicePlatform,
) -> DeviceToken:
    with transaction_boundary(session):
        device_token = repository.find_device_token(session, token)
        if device_token is None:
            device_token = DeviceToken(user_id=user.id, token=token, platform=platform, is_active=True)
            repository.add(session, device_token)
        else:
            device_token.user_id = user.id
            device_token.platform = platform
            device_token.is_active = True
            device_token.last_seen_at = datetime.now(UTC)
    repository.refresh(session, device_token)
    return device_token


def deactivate_device_token(session: Session, user: User, device_token_id: UUID) -> None:
    with transaction_boundary(session):
        device_token = repository.get_device_token(session, device_token_id)
        if device_token is None or device_token.user_id != user.id:
            raise DeviceTokenNotFoundError()
        device_token.is_active = False

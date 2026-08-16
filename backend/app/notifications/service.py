from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.common.enums import DevicePlatform, MembershipRole, MembershipStatus, NotificationType
from app.config import get_settings
from app.models import DeviceToken, Notification, TeamMembership, User
from app.notifications.push import enqueue_push_notifications
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
    notification = Notification(
        user_id=user_id,
        team_id=team_id,
        type=notification_type,
        title=title,
        body=body,
        reference_type=reference_type,
        reference_id=reference_id,
    )
    session.add(notification)
    session.flush()
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
    user_ids = session.scalars(
        select(TeamMembership.user_id).where(
            TeamMembership.team_id == team_id,
            TeamMembership.status == MembershipStatus.active,
        )
    ).all()
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
        for user_id in user_ids
    ]
    session.add_all(notifications)
    session.flush()
    enqueue_push_notifications(session, notifications, get_settings())
    return notifications


def create_team_announcement(
    session: Session,
    team_id: UUID,
    user: User,
    announcement_id: UUID,
    title: str,
    body: str,
) -> list[Notification]:
    require_team_role(session, team_id, user.id, MembershipRole.captain)
    existing_notifications = list(
        session.scalars(
            select(Notification)
            .where(
                Notification.team_id == team_id,
                Notification.type == NotificationType.team_announcement,
                Notification.reference_type == "team_announcement",
                Notification.reference_id == announcement_id,
            )
            .order_by(Notification.created_at, Notification.id)
        )
    )
    if existing_notifications:
        if any(
            notification.title != title
            or notification.body != body
            or notification.reference_type != "team_announcement"
            or notification.reference_id != announcement_id
            for notification in existing_notifications
        ):
            raise TeamAnnouncementConflictError("Team announcement id already belongs to another request")
        return existing_notifications

    notifications = create_team_notifications(
        session,
        team_id,
        NotificationType.team_announcement,
        title=title,
        body=body,
        reference_type="team_announcement",
        reference_id=announcement_id,
    )
    session.commit()
    return notifications


class NotificationNotFoundError(Exception):
    pass


class TeamAnnouncementConflictError(Exception):
    pass


class DeviceTokenNotFoundError(Exception):
    pass


def list_notifications(
    session: Session,
    user: User,
    team_id: UUID | None = None,
    notification_type: NotificationType | None = None,
    unread_only: bool = False,
) -> list[Notification]:
    if team_id is not None:
        get_active_membership(session, team_id, user.id)
    stmt = select(Notification).where(Notification.user_id == user.id).order_by(Notification.created_at.desc())
    if team_id is not None:
        stmt = stmt.where(Notification.team_id == team_id)
    if notification_type is not None:
        stmt = stmt.where(Notification.type == notification_type)
    if unread_only:
        stmt = stmt.where(Notification.read_at.is_(None))
    return list(session.scalars(stmt))


def mark_notification_read(session: Session, user: User, notification_id: UUID) -> Notification:
    notification = session.get(Notification, notification_id)
    if notification is None or notification.user_id != user.id:
        raise NotificationNotFoundError("Notification not found")
    if notification.read_at is None:
        notification.read_at = datetime.now(UTC)
        session.commit()
        session.refresh(notification)
    return notification


def unread_count(session: Session, user: User, team_id: UUID | None = None) -> int:
    if team_id is not None:
        get_active_membership(session, team_id, user.id)
    stmt = select(func.count()).select_from(Notification).where(
        Notification.user_id == user.id,
        Notification.read_at.is_(None),
    )
    if team_id is not None:
        stmt = stmt.where(Notification.team_id == team_id)
    return session.scalar(stmt) or 0


def upsert_device_token(
    session: Session,
    user: User,
    token: str,
    platform: DevicePlatform,
) -> DeviceToken:
    device_token = session.scalar(select(DeviceToken).where(DeviceToken.token == token))
    if device_token is None:
        device_token = DeviceToken(user_id=user.id, token=token, platform=platform, is_active=True)
        session.add(device_token)
    else:
        device_token.user_id = user.id
        device_token.platform = platform
        device_token.is_active = True
        device_token.last_seen_at = datetime.now(UTC)
    session.commit()
    session.refresh(device_token)
    return device_token


def deactivate_device_token(session: Session, user: User, device_token_id: UUID) -> None:
    device_token = session.get(DeviceToken, device_token_id)
    if device_token is None or device_token.user_id != user.id:
        raise DeviceTokenNotFoundError("Device token not found")
    device_token.is_active = False
    session.commit()

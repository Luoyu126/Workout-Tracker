from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.common.enums import NotificationType
from app.models import DeviceToken, Notification


def add(session: Session, value: object) -> None:
    session.add(value)


def add_all(session: Session, values: Sequence[object]) -> None:
    session.add_all(values)


def delete_value(session: Session, value: object) -> None:
    session.delete(value)


def flush(session: Session) -> None:
    session.flush()


def refresh(session: Session, value: object) -> None:
    session.refresh(value)


def list_event_notifications(session: Session, team_id: UUID, event_id: UUID) -> list[Notification]:
    return list(
        session.scalars(
            select(Notification).where(
                Notification.team_id == team_id,
                Notification.type == NotificationType.new_event,
                Notification.reference_id == event_id,
            )
        )
    )


def delete_event_notifications(session: Session, event_id: UUID) -> None:
    session.execute(
        delete(Notification).where(
            Notification.type == NotificationType.new_event,
            Notification.reference_id == event_id,
        )
    )


def list_team_announcement_notifications(
    session: Session,
    team_id: UUID,
    announcement_id: UUID,
) -> list[Notification]:
    return list(
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


def list_for_user(
    session: Session,
    user_id: UUID,
    *,
    team_id: UUID | None,
    notification_type: NotificationType | None,
    unread_only: bool,
) -> list[Notification]:
    stmt = select(Notification).where(Notification.user_id == user_id).order_by(Notification.created_at.desc())
    if team_id is not None:
        stmt = stmt.where(Notification.team_id == team_id)
    if notification_type is not None:
        stmt = stmt.where(Notification.type == notification_type)
    if unread_only:
        stmt = stmt.where(Notification.read_at.is_(None))
    return list(session.scalars(stmt))


def get_notification(session: Session, notification_id: UUID) -> Notification | None:
    return session.get(Notification, notification_id)


def count_unread(session: Session, user_id: UUID, team_id: UUID | None) -> int:
    stmt = select(func.count()).select_from(Notification).where(
        Notification.user_id == user_id,
        Notification.read_at.is_(None),
    )
    if team_id is not None:
        stmt = stmt.where(Notification.team_id == team_id)
    return session.scalar(stmt) or 0


def find_device_token(session: Session, token: str) -> DeviceToken | None:
    return session.scalar(select(DeviceToken).where(DeviceToken.token == token))


def get_device_token(session: Session, token_id: UUID) -> DeviceToken | None:
    return session.get(DeviceToken, token_id)


def list_active_device_tokens(
    session: Session,
    user_ids: set[UUID],
) -> list[DeviceToken]:
    return list(
        session.scalars(
            select(DeviceToken).where(
                DeviceToken.user_id.in_(user_ids),
                DeviceToken.is_active.is_(True),
            )
        ).all()
    )

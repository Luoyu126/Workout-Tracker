import json
from dataclasses import dataclass
from typing import Any, TypedDict, cast
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import UUID

from sqlalchemy import event, select
from sqlalchemy.orm import Session
from sqlalchemy.orm import Session as OrmSession

from app.common.enums import enum_value
from app.config import Settings
from app.models import DeviceToken, Notification

PENDING_EXPO_PUSH_MESSAGES_KEY = "pending_expo_push_messages"
EXPO_PUSH_MESSAGE_BATCH_SIZE = 100


@dataclass(frozen=True)
class PushDeliveryReport:
    attempted: int
    delivered: int
    skipped: int


class QueuedPushBatch(TypedDict):
    endpoint: str
    timeout_seconds: float
    messages: list[dict[str, Any]]


def _notification_data(notification: Notification) -> dict[str, str]:
    data = {
        "notificationId": str(notification.id),
        "teamId": str(notification.team_id),
        "type": enum_value(notification.type),
    }
    if notification.reference_type:
        data["referenceType"] = notification.reference_type
    if notification.reference_id:
        data["referenceId"] = str(notification.reference_id)
    return data


def build_expo_push_messages(
    notifications: list[Notification],
    device_tokens: list[DeviceToken],
) -> list[dict[str, Any]]:
    tokens_by_user_id: dict[UUID, list[DeviceToken]] = {}
    for device_token in device_tokens:
        if device_token.is_active:
            tokens_by_user_id.setdefault(device_token.user_id, []).append(device_token)

    messages: list[dict[str, Any]] = []
    for notification in notifications:
        for device_token in tokens_by_user_id.get(notification.user_id, []):
            messages.append(
                {
                    "to": device_token.token,
                    "title": notification.title,
                    "body": notification.body,
                    "sound": "default",
                    "data": _notification_data(notification),
                }
            )
    return messages


def send_expo_push_messages(
    messages: list[dict[str, Any]],
    endpoint: str,
    timeout_seconds: float,
) -> int:
    if not messages:
        return 0

    request = Request(
        endpoint,
        data=json.dumps(messages).encode("utf-8"),
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urlopen(request, timeout=timeout_seconds) as response:
        response.read()
    return len(messages)


def _send_queued_push_batches(batches: list[QueuedPushBatch]) -> None:
    for batch in batches:
        try:
            send_expo_push_messages(
                batch["messages"],
                batch["endpoint"],
                batch["timeout_seconds"],
            )
        except (HTTPError, URLError, OSError, TimeoutError, ValueError):
            continue


def _chunk_push_messages(messages: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    return [
        messages[index : index + EXPO_PUSH_MESSAGE_BATCH_SIZE]
        for index in range(0, len(messages), EXPO_PUSH_MESSAGE_BATCH_SIZE)
    ]


def enqueue_push_notifications(
    session: Session,
    notifications: list[Notification],
    settings: Settings,
) -> PushDeliveryReport:
    if not notifications or not settings.push_notifications_enabled:
        return PushDeliveryReport(attempted=0, delivered=0, skipped=len(notifications))

    user_ids = {notification.user_id for notification in notifications}
    device_tokens = session.scalars(
        select(DeviceToken).where(
            DeviceToken.user_id.in_(user_ids),
            DeviceToken.is_active.is_(True),
        )
    ).all()
    active_push_user_ids = {device_token.user_id for device_token in device_tokens}
    messages = build_expo_push_messages(notifications, list(device_tokens))

    if messages:
        pending_batches = cast(
            list[QueuedPushBatch],
            session.info.setdefault(PENDING_EXPO_PUSH_MESSAGES_KEY, []),
        )
        for message_batch in _chunk_push_messages(messages):
            pending_batches.append(
                {
                    "endpoint": settings.expo_push_endpoint,
                    "timeout_seconds": settings.expo_push_timeout_seconds,
                    "messages": message_batch,
                }
            )

    return PushDeliveryReport(
        attempted=len(messages),
        delivered=0,
        skipped=sum(1 for notification in notifications if notification.user_id not in active_push_user_ids),
    )


def deliver_push_notifications(
    session: Session,
    notifications: list[Notification],
    settings: Settings,
) -> PushDeliveryReport:
    return enqueue_push_notifications(session, notifications, settings)


@event.listens_for(OrmSession, "after_commit")
def send_pending_push_notifications_after_commit(session: Session) -> None:
    batches = cast(
        list[QueuedPushBatch],
        session.info.pop(PENDING_EXPO_PUSH_MESSAGES_KEY, []),
    )
    _send_queued_push_batches(batches)


@event.listens_for(OrmSession, "after_rollback")
def discard_pending_push_notifications_after_rollback(session: Session) -> None:
    session.info.pop(PENDING_EXPO_PUSH_MESSAGES_KEY, None)

from collections.abc import Iterator
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.common.database import Base
from app.common.enums import DevicePlatform, MembershipRole, MembershipStatus, NotificationType
from app.models import DeviceToken, Notification, Organization, Team, TeamMembership, User
from app.notifications import push
from app.notifications import service as notification_service
from app.notifications.router import (
    delete_device_token,
    post_notification_read,
    post_team_announcement,
    put_device_token,
    read_notifications,
    read_unread_count,
)
from app.notifications.schemas import DeviceTokenUpsertRequest, TeamAnnouncementRequest
from app.notifications.service import create_team_notifications


@pytest.fixture()
def session() -> Iterator[Session]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with SessionLocal() as db:
        yield db
    Base.metadata.drop_all(engine)
    engine.dispose()


def _user(name: str) -> User:
    normalized = name.lower().replace(" ", ".")
    return User(auth_id=uuid4(), name=name, email=f"{normalized}@example.com")


def _seed_team(session: Session) -> tuple[Team, User, User]:
    organization = Organization(name="Notification API Org", slug=f"notification-api-{uuid4().hex[:8]}")
    player = _user("Notification Player")
    other_player = _user("Other Notification Player")
    session.add_all([organization, player, other_player])
    session.flush()

    team = Team(organization_id=organization.id, name="Notification MVP Team")
    session.add(team)
    session.flush()
    session.add_all(
        [
            TeamMembership(
                team_id=team.id,
                user_id=player.id,
                role=MembershipRole.member,
                status=MembershipStatus.active,
            ),
            TeamMembership(
                team_id=team.id,
                user_id=other_player.id,
                role=MembershipRole.member,
                status=MembershipStatus.active,
            ),
        ]
    )
    session.commit()
    return team, player, other_player


def _seed_team_with_admin(session: Session) -> tuple[Team, User, User, User]:
    organization = Organization(name="Announcement API Org", slug=f"announcement-api-{uuid4().hex[:8]}")
    admin = _user("Announcement Admin")
    player = _user("Announcement Player")
    inactive_player = _user("Inactive Announcement Player")
    session.add_all([organization, admin, player, inactive_player])
    session.flush()

    team = Team(organization_id=organization.id, name="Announcement MVP Team")
    session.add(team)
    session.flush()
    session.add_all(
        [
            TeamMembership(
                team_id=team.id,
                user_id=admin.id,
                role=MembershipRole.admin,
                status=MembershipStatus.active,
            ),
            TeamMembership(
                team_id=team.id,
                user_id=player.id,
                role=MembershipRole.member,
                status=MembershipStatus.active,
            ),
            TeamMembership(
                team_id=team.id,
                user_id=inactive_player.id,
                role=MembershipRole.member,
                status=MembershipStatus.inactive,
            ),
        ]
    )
    session.commit()
    return team, admin, player, inactive_player


def test_notification_router_lists_counts_and_marks_only_own_notifications(
    session: Session,
) -> None:
    team, player, other_player = _seed_team(session)
    own_notification = Notification(
        user_id=player.id,
        team_id=team.id,
        type=NotificationType.new_event,
        title="新活动",
        body="周末训练已发布",
        reference_type="event",
        reference_id=uuid4(),
    )
    other_notification = Notification(
        user_id=other_player.id,
        team_id=team.id,
        type=NotificationType.team_announcement,
        title="活动更新",
        body="训练时间更新",
        reference_type="event",
        reference_id=uuid4(),
    )
    session.add_all([own_notification, other_notification])
    session.commit()

    assert read_unread_count(None, player, session) == {"count": 1}
    assert read_unread_count(team.id, player, session) == {"count": 1}
    assert read_notifications(None, None, False, player, session) == [own_notification]
    assert read_notifications(team.id, NotificationType.new_event, True, player, session) == [
        own_notification
    ]

    with pytest.raises(HTTPException) as other_read_exc:
        post_notification_read(other_notification.id, player, session)
    assert other_read_exc.value.status_code == 404
    assert other_read_exc.value.detail["code"] == "NOTIFICATION_RESOURCE_NOT_FOUND"

    read_notification = post_notification_read(own_notification.id, player, session)

    assert read_notification.read_at is not None
    first_read_at = read_notification.read_at
    assert read_unread_count(None, player, session) == {"count": 0}
    assert read_notifications(None, None, True, player, session) == []

    reread_notification = post_notification_read(own_notification.id, player, session)
    assert reread_notification.read_at == first_read_at
    assert read_unread_count(None, player, session) == {"count": 0}


def test_team_scoped_notification_reads_require_active_membership_but_global_inbox_keeps_history(
    session: Session,
) -> None:
    team, player, _ = _seed_team(session)
    notification = Notification(
        user_id=player.id,
        team_id=team.id,
        type=NotificationType.team_announcement,
        title="旧球队通知",
        body="离队前收到的通知。",
        reference_type="team",
        reference_id=team.id,
    )
    session.add(notification)
    session.commit()

    membership = session.scalar(
        select(TeamMembership).where(TeamMembership.team_id == team.id, TeamMembership.user_id == player.id)
    )
    assert membership is not None
    membership.status = MembershipStatus.inactive
    session.commit()

    assert read_notifications(None, None, False, player, session) == [notification]

    with pytest.raises(HTTPException) as scoped_list_exc:
        read_notifications(team.id, None, False, player, session)
    assert scoped_list_exc.value.status_code == 403
    assert scoped_list_exc.value.detail["code"] == "NOTIFICATION_PERMISSION_DENIED"

    with pytest.raises(HTTPException) as scoped_count_exc:
        read_unread_count(team.id, player, session)
    assert scoped_count_exc.value.status_code == 403
    assert scoped_count_exc.value.detail["code"] == "NOTIFICATION_PERMISSION_DENIED"


def test_device_token_router_upserts_reassigns_and_deactivates_token(session: Session) -> None:
    _, player, other_player = _seed_team(session)

    token = put_device_token(
        DeviceTokenUpsertRequest(token=" ExponentPushToken[test-token] ", platform=DevicePlatform.ios),
        player,
        session,
    )
    assert token.token == "ExponentPushToken[test-token]"
    assert token.user_id == player.id
    assert token.is_active is True

    reassigned = put_device_token(
        DeviceTokenUpsertRequest(token="ExponentPushToken[test-token]", platform=DevicePlatform.android),
        other_player,
        session,
    )
    assert reassigned.id == token.id
    assert reassigned.user_id == other_player.id
    assert reassigned.platform == DevicePlatform.android

    with pytest.raises(HTTPException) as wrong_user_delete_exc:
        delete_device_token(reassigned.id, player, session)
    assert wrong_user_delete_exc.value.status_code == 404

    delete_device_token(reassigned.id, other_player, session)
    session.refresh(reassigned)
    assert reassigned.is_active is False
    assert session.get(DeviceToken, reassigned.id) is not None

    reactivated = put_device_token(
        DeviceTokenUpsertRequest(token="ExponentPushToken[test-token]", platform=DevicePlatform.ios),
        player,
        session,
    )
    assert reactivated.id == token.id
    assert reactivated.user_id == player.id
    assert reactivated.platform == DevicePlatform.ios
    assert reactivated.is_active is True

    for invalid_token in ("", "test-token", "ExponentPushToken[]"):
        with pytest.raises(ValidationError):
            DeviceTokenUpsertRequest(token=invalid_token, platform=DevicePlatform.ios)


def test_team_notifications_are_created_only_for_active_members(session: Session) -> None:
    team, player, other_player = _seed_team(session)
    inactive_player = _user("Inactive Notification Player")
    pending_player = _user("Pending Notification Player")
    session.add_all([inactive_player, pending_player])
    session.flush()
    session.add_all(
        [
            TeamMembership(
                team_id=team.id,
                user_id=inactive_player.id,
                role=MembershipRole.member,
                status=MembershipStatus.inactive,
            ),
            TeamMembership(
                team_id=team.id,
                user_id=pending_player.id,
                role=MembershipRole.member,
                status=MembershipStatus.pending,
            ),
        ]
    )
    session.commit()

    create_team_notifications(
        session,
        team.id,
        NotificationType.team_announcement,
        title="队内通知",
        body="今晚训练照常。",
        reference_type="team",
        reference_id=team.id,
    )
    session.commit()

    notifications = session.scalars(select(Notification).order_by(Notification.created_at)).all()
    assert {notification.user_id for notification in notifications} == {player.id, other_player.id}
    assert all(notification.type == NotificationType.team_announcement for notification in notifications)


def test_team_notifications_deliver_best_effort_expo_push_to_active_tokens(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    team, player, other_player = _seed_team(session)
    inactive_token = DeviceToken(
        user_id=player.id,
        token="ExponentPushToken[inactive]",
        platform=DevicePlatform.ios,
        is_active=False,
    )
    active_player_token = DeviceToken(
        user_id=player.id,
        token="ExponentPushToken[player]",
        platform=DevicePlatform.ios,
        is_active=True,
    )
    active_other_token = DeviceToken(
        user_id=other_player.id,
        token="ExponentPushToken[other]",
        platform=DevicePlatform.android,
        is_active=True,
    )
    session.add_all([inactive_token, active_player_token, active_other_token])
    session.commit()

    sent_messages: list[dict[str, object]] = []

    def fake_send(messages: list[dict[str, object]], endpoint: str, timeout_seconds: float) -> int:
        sent_messages.extend(messages)
        assert endpoint == "https://push.example.test/send"
        assert timeout_seconds == 2
        return len(messages)

    monkeypatch.setattr(push, "send_expo_push_messages", fake_send)
    monkeypatch.setattr(
        notification_service,
        "get_settings",
        lambda: type(
            "PushSettings",
            (),
            {
                "push_notifications_enabled": True,
                "expo_push_endpoint": "https://push.example.test/send",
                "expo_push_timeout_seconds": 2,
            },
        )(),
    )

    create_team_notifications(
        session,
        team.id,
        NotificationType.team_announcement,
        title="队内通知",
        body="今晚训练照常。",
        reference_type="team",
        reference_id=team.id,
    )
    assert sent_messages == []

    session.commit()

    assert {message["to"] for message in sent_messages} == {
        "ExponentPushToken[player]",
        "ExponentPushToken[other]",
    }
    assert all(message["title"] == "队内通知" for message in sent_messages)
    assert all(message["body"] == "今晚训练照常。" for message in sent_messages)
    assert all(message["sound"] == "default" for message in sent_messages)
    assert all(message["data"]["referenceType"] == "team" for message in sent_messages)
    assert session.scalars(select(Notification)).all()


def test_expo_push_payload_includes_navigation_reference_data(session: Session) -> None:
    team, player, _ = _seed_team(session)
    reference_id = uuid4()
    notification = Notification(
        user_id=player.id,
        team_id=team.id,
        type=NotificationType.redemption_completed,
        title="兑换已完成",
        body="你的商品已经发放。",
        reference_type="redemption",
        reference_id=reference_id,
    )
    active_token = DeviceToken(
        user_id=player.id,
        token="ExponentPushToken[player]",
        platform=DevicePlatform.ios,
        is_active=True,
    )
    inactive_token = DeviceToken(
        user_id=player.id,
        token="ExponentPushToken[inactive]",
        platform=DevicePlatform.android,
        is_active=False,
    )
    session.add_all([notification, active_token, inactive_token])
    session.flush()

    messages = push.build_expo_push_messages([notification], [active_token, inactive_token])

    assert messages == [
        {
            "to": "ExponentPushToken[player]",
            "title": "兑换已完成",
            "body": "你的商品已经发放。",
            "sound": "default",
            "data": {
                "notificationId": str(notification.id),
                "teamId": str(team.id),
                "type": "redemption_completed",
                "referenceType": "redemption",
                "referenceId": str(reference_id),
            },
        }
    ]


def test_expo_push_messages_are_chunked_to_service_batch_limit(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    organization = Organization(name="Push Chunk Org", slug=f"push-chunk-{uuid4().hex[:8]}")
    session.add(organization)
    session.flush()
    team = Team(organization_id=organization.id, name="Push Chunk Team")
    session.add(team)
    session.flush()
    users = [_user(f"Push Chunk Player {index}") for index in range(101)]
    session.add_all(users)
    session.flush()
    session.add_all(
        [
            TeamMembership(
                team_id=team.id,
                user_id=user.id,
                role=MembershipRole.member,
                status=MembershipStatus.active,
            )
            for user in users
        ]
    )
    session.add_all(
        [
            DeviceToken(
                user_id=user.id,
                token=f"ExponentPushToken[player-{index}]",
                platform=DevicePlatform.ios,
                is_active=True,
            )
            for index, user in enumerate(users)
        ]
    )
    session.commit()

    sent_batch_sizes: list[int] = []

    def fake_send(messages: list[dict[str, object]], endpoint: str, timeout_seconds: float) -> int:
        sent_batch_sizes.append(len(messages))
        assert len(messages) <= push.EXPO_PUSH_MESSAGE_BATCH_SIZE
        assert endpoint == "https://push.example.test/send"
        assert timeout_seconds == 2
        return len(messages)

    monkeypatch.setattr(push, "send_expo_push_messages", fake_send)
    monkeypatch.setattr(
        notification_service,
        "get_settings",
        lambda: type(
            "PushSettings",
            (),
            {
                "push_notifications_enabled": True,
                "expo_push_endpoint": "https://push.example.test/send",
                "expo_push_timeout_seconds": 2,
            },
        )(),
    )

    create_team_notifications(
        session,
        team.id,
        NotificationType.team_announcement,
        title="队内通知",
        body="大名单推送分批测试。",
        reference_type="team",
        reference_id=team.id,
    )
    assert sent_batch_sizes == []

    session.commit()

    assert sent_batch_sizes == [100, 1]
    assert len(session.scalars(select(Notification)).all()) == 101


def test_queued_expo_push_is_discarded_when_business_transaction_rolls_back(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    team, player, _ = _seed_team(session)
    session.add(
        DeviceToken(
            user_id=player.id,
            token="ExponentPushToken[player]",
            platform=DevicePlatform.ios,
            is_active=True,
        )
    )
    session.commit()

    sent_messages: list[dict[str, object]] = []

    def fake_send(messages: list[dict[str, object]], endpoint: str, timeout_seconds: float) -> int:
        sent_messages.extend(messages)
        return len(messages)

    monkeypatch.setattr(push, "send_expo_push_messages", fake_send)
    monkeypatch.setattr(
        notification_service,
        "get_settings",
        lambda: type(
            "PushSettings",
            (),
            {
                "push_notifications_enabled": True,
                "expo_push_endpoint": "https://push.example.test/send",
                "expo_push_timeout_seconds": 2,
            },
        )(),
    )

    create_team_notifications(
        session,
        team.id,
        NotificationType.team_announcement,
        title="队内通知",
        body="这条事务会回滚。",
        reference_type="team",
        reference_id=team.id,
    )
    session.rollback()

    assert sent_messages == []
    assert session.scalars(select(Notification)).all() == []


def test_expo_push_failure_after_commit_preserves_in_app_notifications(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    team, player, _ = _seed_team(session)
    session.add(
        DeviceToken(
            user_id=player.id,
            token="ExponentPushToken[player]",
            platform=DevicePlatform.ios,
            is_active=True,
        )
    )
    session.commit()

    def fake_send(messages: list[dict[str, object]], endpoint: str, timeout_seconds: float) -> int:
        raise OSError("expo push endpoint unavailable")

    monkeypatch.setattr(push, "send_expo_push_messages", fake_send)
    monkeypatch.setattr(
        notification_service,
        "get_settings",
        lambda: type(
            "PushSettings",
            (),
            {
                "push_notifications_enabled": True,
                "expo_push_endpoint": "https://push.example.test/send",
                "expo_push_timeout_seconds": 2,
            },
        )(),
    )

    create_team_notifications(
        session,
        team.id,
        NotificationType.team_announcement,
        title="队内通知",
        body="推送失败也要保留 Inbox 通知。",
        reference_type="team",
        reference_id=team.id,
    )
    session.commit()

    notifications = session.scalars(select(Notification).order_by(Notification.created_at)).all()
    assert len(notifications) == 2
    assert read_unread_count(team.id, player, session) == {"count": 1}


def test_push_delivery_is_skipped_when_disabled(session: Session) -> None:
    team, player, _ = _seed_team(session)
    notification = Notification(
        user_id=player.id,
        team_id=team.id,
        type=NotificationType.new_event,
        title="新活动",
        body="训练已发布",
    )
    session.add(notification)
    session.flush()

    report = push.deliver_push_notifications(
        session,
        [notification],
        type(
            "PushSettings",
            (),
            {
                "push_notifications_enabled": False,
                "expo_push_endpoint": "https://push.example.test/send",
                "expo_push_timeout_seconds": 2,
            },
        )(),
    )

    assert report.attempted == 0
    assert report.delivered == 0
    assert report.skipped == 1


def test_push_delivery_reports_skipped_notifications_without_active_tokens(session: Session) -> None:
    team, player, _ = _seed_team(session)
    notification = Notification(
        user_id=player.id,
        team_id=team.id,
        type=NotificationType.new_event,
        title="新活动",
        body="训练已发布",
    )
    session.add_all(
        [
            notification,
            DeviceToken(
                user_id=player.id,
                token="ExponentPushToken[inactive]",
                platform=DevicePlatform.ios,
                is_active=False,
            ),
        ]
    )
    session.flush()

    report = push.deliver_push_notifications(
        session,
        [notification],
        type(
            "PushSettings",
            (),
            {
                "push_notifications_enabled": True,
                "expo_push_endpoint": "https://push.example.test/send",
                "expo_push_timeout_seconds": 2,
            },
        )(),
    )

    assert report.attempted == 0
    assert report.delivered == 0
    assert report.skipped == 1


def test_admin_can_post_team_announcement_for_active_members(session: Session) -> None:
    team, admin, player, inactive_player = _seed_team_with_admin(session)
    announcement_id = uuid4()

    notifications = post_team_announcement(
        team.id,
        TeamAnnouncementRequest(id=announcement_id, title="今晚训练", body="19:00 准时到球场集合。"),
        admin,
        session,
    )

    assert {notification.user_id for notification in notifications} == {admin.id, player.id}
    assert inactive_player.id not in {notification.user_id for notification in notifications}
    assert all(notification.type == NotificationType.team_announcement for notification in notifications)
    assert all(notification.reference_type == "team_announcement" for notification in notifications)
    assert all(notification.reference_id == announcement_id for notification in notifications)
    assert read_unread_count(team.id, player, session) == {"count": 1}

    stored_notifications = session.scalars(select(Notification).order_by(Notification.created_at)).all()
    assert len(stored_notifications) == 2


def test_team_announcement_create_is_idempotent_by_client_announcement_id(session: Session) -> None:
    team, admin, player, _ = _seed_team_with_admin(session)
    announcement_id = uuid4()
    payload = TeamAnnouncementRequest(id=announcement_id, title="今晚训练", body="19:00 准时到球场集合。")

    notifications = post_team_announcement(team.id, payload, admin, session)
    repeated_notifications = post_team_announcement(team.id, payload, admin, session)

    assert {notification.id for notification in repeated_notifications} == {notification.id for notification in notifications}
    assert {notification.user_id for notification in notifications} == {admin.id, player.id}
    assert read_unread_count(team.id, player, session) == {"count": 1}
    assert session.scalars(
        select(Notification)
        .where(
            Notification.type == NotificationType.team_announcement,
            Notification.reference_type == "team_announcement",
            Notification.reference_id == announcement_id,
        )
        .order_by(Notification.created_at)
    ).all() == notifications

    with pytest.raises(HTTPException) as mismatch_exc:
        post_team_announcement(
            team.id,
            TeamAnnouncementRequest(id=announcement_id, title="今晚训练", body="20:00 改时间。"),
            admin,
            session,
        )
    assert mismatch_exc.value.status_code == 409
    assert mismatch_exc.value.detail["code"] == "TEAM_ANNOUNCEMENT_CONFLICT"
    assert read_unread_count(team.id, player, session) == {"count": 1}


def test_team_announcement_push_failure_still_persists_in_app_notifications(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    team, admin, player, _ = _seed_team_with_admin(session)
    session.add(
        DeviceToken(
            user_id=player.id,
            token="ExponentPushToken[player]",
            platform=DevicePlatform.ios,
            is_active=True,
        )
    )
    session.commit()
    send_attempts: list[list[dict[str, object]]] = []

    def fake_send(messages: list[dict[str, object]], endpoint: str, timeout_seconds: float) -> int:
        send_attempts.append(messages)
        raise OSError("expo push endpoint unavailable")

    monkeypatch.setattr(push, "send_expo_push_messages", fake_send)
    monkeypatch.setattr(
        notification_service,
        "get_settings",
        lambda: type(
            "PushSettings",
            (),
            {
                "push_notifications_enabled": True,
                "expo_push_endpoint": "https://push.example.test/send",
                "expo_push_timeout_seconds": 2,
            },
        )(),
    )

    notifications = post_team_announcement(
        team.id,
        TeamAnnouncementRequest(id=uuid4(), title="今晚训练", body="即使远程推送失败，站内通知也必须保留。"),
        admin,
        session,
    )

    assert len(send_attempts) == 1
    assert [message["to"] for message in send_attempts[0]] == ["ExponentPushToken[player]"]
    assert {notification.user_id for notification in notifications} == {admin.id, player.id}
    assert session.scalars(select(Notification).order_by(Notification.created_at)).all() == notifications
    assert read_unread_count(team.id, player, session) == {"count": 1}


def test_member_cannot_post_team_announcement(session: Session) -> None:
    team, _, player, _ = _seed_team_with_admin(session)

    with pytest.raises(HTTPException) as exc:
        post_team_announcement(
            team.id,
            TeamAnnouncementRequest(id=uuid4(), title="越权公告", body="这条不应该发送。"),
            player,
            session,
        )

    assert exc.value.status_code == 403
    assert exc.value.detail["code"] == "NOTIFICATION_PERMISSION_DENIED"
    assert session.scalars(select(Notification)).all() == []

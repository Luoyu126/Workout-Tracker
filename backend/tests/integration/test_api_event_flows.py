from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.common.database import Base
from app.common.enums import (
    EventStatus,
    EventType,
    MatchEntryType,
    MembershipRole,
    MembershipStatus,
    NotificationType,
    SignupStatus,
)
from app.events.match_router import post_match_log
from app.events.match_schemas import MatchLogEntryCreateRequest
from app.events.router import (
    delete_event_route,
    patch_event,
    post_complete_event,
    post_event,
    post_match,
    post_publish_event,
    put_my_signup,
    read_event,
    read_events,
    read_my_signup,
    read_signups,
)
from app.events.schemas import (
    EventCompletionRequest,
    EventCreateRequest,
    EventSignupUpsertRequest,
    EventUpdateRequest,
    MatchCreateRequest,
    MatchDetailsCreateRequest,
    MatchDetailsUpdateRequest,
)
from app.models import (
    CoinTransaction,
    Event,
    EventSignup,
    MatchDetails,
    MatchLogEntry,
    Notification,
    Organization,
    Team,
    TeamMembership,
    User,
)
from app.notifications.router import read_notifications


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
    organization = Organization(name="API Test Org", slug=f"api-test-org-{uuid4().hex[:8]}")
    captain = _user("API Captain")
    player = _user("API Player")
    session.add_all([organization, captain, player])
    session.flush()

    team = Team(organization_id=organization.id, name="API MVP Team")
    session.add(team)
    session.flush()
    session.add_all(
        [
            TeamMembership(
                team_id=team.id,
                user_id=captain.id,
                role=MembershipRole.captain,
                status=MembershipStatus.active,
            ),
            TeamMembership(
                team_id=team.id,
                user_id=player.id,
                role=MembershipRole.member,
                status=MembershipStatus.active,
            ),
        ]
    )
    session.commit()
    return team, captain, player


def _seed_other_team(session: Session) -> tuple[Team, User, User]:
    organization = Organization(name="Other API Test Org", slug=f"other-api-test-org-{uuid4().hex[:8]}")
    captain = _user(f"Other Captain {uuid4().hex[:6]}")
    player = _user(f"Other Player {uuid4().hex[:6]}")
    session.add_all([organization, captain, player])
    session.flush()

    team = Team(organization_id=organization.id, name="Other API MVP Team")
    session.add(team)
    session.flush()
    session.add_all(
        [
            TeamMembership(
                team_id=team.id,
                user_id=captain.id,
                role=MembershipRole.captain,
                status=MembershipStatus.active,
            ),
            TeamMembership(
                team_id=team.id,
                user_id=player.id,
                role=MembershipRole.member,
                status=MembershipStatus.active,
            ),
        ]
    )
    session.commit()
    return team, captain, player


def _event_payload(title: str = "周末训练") -> EventCreateRequest:
    return EventCreateRequest(
        type=EventType.training,
        title=title,
        location="主球场",
        start_time=datetime.now(UTC) + timedelta(days=2),
    )


def test_event_router_publish_update_delete_create_team_notifications(session: Session) -> None:
    team, captain, player = _seed_team(session)
    inactive_player = _user("Inactive Event Notification Player")
    pending_player = _user("Pending Event Notification Player")
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
    active_user_ids = {captain.id, player.id}
    inactive_or_pending_user_ids = {inactive_player.id, pending_player.id}

    event = post_event(team.id, _event_payload(), captain, session)
    assert event.status == EventStatus.draft
    create_notifications = session.scalars(
        select(Notification)
        .where(Notification.reference_type == "event_snapshot")
        .order_by(Notification.created_at)
    ).all()
    assert [notification.type for notification in create_notifications] == [
        NotificationType.new_event,
        NotificationType.new_event,
    ]
    assert {notification.user_id for notification in create_notifications} == active_user_ids
    assert inactive_or_pending_user_ids.isdisjoint({notification.user_id for notification in create_notifications})
    assert all(notification.reference_id is None for notification in create_notifications)
    assert all("周末训练" in notification.body for notification in create_notifications)
    assert all(event.start_time.isoformat() in notification.body for notification in create_notifications)
    with pytest.raises(HTTPException) as draft_read_exc:
        read_event(event.id, player, session)
    assert draft_read_exc.value.status_code == 403

    published = post_publish_event(event.id, captain, session)
    assert published["status"] == EventStatus.published
    repeated_publish = post_publish_event(event.id, captain, session)
    assert repeated_publish["status"] == EventStatus.published
    notifications = session.scalars(
        select(Notification).where(Notification.reference_id == event.id).order_by(Notification.created_at)
    ).all()
    assert [notification.type for notification in notifications] == [
        NotificationType.new_event,
        NotificationType.new_event,
    ]
    assert {notification.user_id for notification in notifications} == active_user_ids
    assert inactive_or_pending_user_ids.isdisjoint({notification.user_id for notification in notifications})

    updated = patch_event(
        event.id,
        EventUpdateRequest(title="周末训练改时间"),
        captain,
        session,
    )
    assert updated["title"] == "周末训练改时间"
    update_notifications = session.scalars(
        select(Notification).where(Notification.type == NotificationType.event_updated)
    ).all()
    assert len(update_notifications) == 2
    assert {notification.user_id for notification in update_notifications} == active_user_ids
    assert inactive_or_pending_user_ids.isdisjoint({notification.user_id for notification in update_notifications})

    repeated_update = patch_event(
        event.id,
        EventUpdateRequest(title="周末训练改时间"),
        captain,
        session,
    )
    assert repeated_update["title"] == "周末训练改时间"
    assert session.scalars(
        select(Notification).where(Notification.type == NotificationType.event_updated)
    ).all() == update_notifications

    delete_event_route(event.id, captain, session)

    assert session.get(Event, event.id) is None
    delete_notifications = session.scalars(
        select(Notification).where(Notification.type == NotificationType.event_deleted)
    ).all()
    assert len(delete_notifications) == 2
    assert {notification.user_id for notification in delete_notifications} == active_user_ids
    assert inactive_or_pending_user_ids.isdisjoint({notification.user_id for notification in delete_notifications})
    assert all(notification.reference_type == "event_snapshot" for notification in delete_notifications)
    assert all(notification.reference_id is None for notification in delete_notifications)
    assert all("周末训练改时间" in notification.body for notification in delete_notifications)
    assert all(event.start_time.isoformat() in notification.body for notification in delete_notifications)

    player_inbox = read_notifications(team.id, NotificationType.event_deleted, False, player, session)
    assert len(player_inbox) == 1
    assert player_inbox[0].reference_type == "event_snapshot"
    assert player_inbox[0].reference_id is None
    assert "周末训练改时间" in player_inbox[0].body
    assert event.start_time.isoformat() in player_inbox[0].body


def test_event_and_match_creation_are_idempotent_by_client_event_id(session: Session) -> None:
    team, captain, _ = _seed_team(session)
    event_id = uuid4()
    event_payload = EventCreateRequest(
        id=event_id,
        type=EventType.training,
        title="幂等训练",
        location="主球场",
        start_time=datetime.now(UTC) + timedelta(days=2),
    )

    event = post_event(team.id, event_payload, captain, session)
    repeated_event = post_event(team.id, event_payload, captain, session)

    assert repeated_event.id == event.id == event_id
    assert session.scalars(select(Event).where(Event.id == event_id)).all() == [event]
    assert len(session.scalars(select(Notification).where(Notification.type == NotificationType.new_event)).all()) == 2

    with pytest.raises(HTTPException) as event_mismatch_exc:
        post_event(
            team.id,
            EventCreateRequest(
                id=event_id,
                type=EventType.training,
                title="不同训练",
                start_time=event_payload.start_time,
            ),
            captain,
            session,
        )
    assert event_mismatch_exc.value.status_code == 409
    assert event_mismatch_exc.value.detail["code"] == "EVENT_CONFLICT"

    match_id = uuid4()
    match_payload = MatchCreateRequest(
        event=EventCreateRequest(
            id=match_id,
            type=EventType.match,
            title="幂等比赛",
            location="主球场",
            start_time=datetime.now(UTC) + timedelta(days=3),
        ),
        match_details=MatchDetailsCreateRequest(opponent="重试队", notes="首回合"),
    )

    match = post_match(team.id, match_payload, captain, session)
    repeated_match = post_match(team.id, match_payload, captain, session)

    assert repeated_match["id"] == match["id"] == match_id
    assert session.scalars(select(Event).where(Event.id == match_id)).one().type == EventType.match
    assert len(session.scalars(select(MatchDetails).where(MatchDetails.event_id == match_id)).all()) == 1
    assert len(session.scalars(select(Notification).where(Notification.type == NotificationType.new_event)).all()) == 4

    with pytest.raises(HTTPException) as match_mismatch_exc:
        post_match(
            team.id,
            MatchCreateRequest(
                event=match_payload.event,
                match_details=MatchDetailsCreateRequest(opponent="另一个队"),
            ),
            captain,
            session,
        )
    assert match_mismatch_exc.value.status_code == 409
    assert match_mismatch_exc.value.detail["code"] == "EVENT_CONFLICT"


def test_event_create_endpoint_rejects_match_type_use_match_endpoint_instead(session: Session) -> None:
    team, captain, _ = _seed_team(session)

    with pytest.raises(HTTPException) as create_exc:
        post_event(
            team.id,
            EventCreateRequest(
                type=EventType.match,
                title="应走比赛接口",
                start_time=datetime.now(UTC) + timedelta(days=2),
            ),
            captain,
            session,
        )

    assert create_exc.value.status_code == 409
    assert create_exc.value.detail["code"] == "EVENT_STATE_CONFLICT"
    assert "Use /teams/{team_id}/matches" in create_exc.value.detail["message"]


def test_draft_event_update_and_delete_do_not_create_update_or_delete_notifications(session: Session) -> None:
    team, captain, player = _seed_team(session)

    draft = post_event(team.id, _event_payload("只通知创建的草稿"), captain, session)
    create_notifications = session.scalars(select(Notification).order_by(Notification.created_at)).all()
    assert len(create_notifications) == 2
    assert {notification.user_id for notification in create_notifications} == {captain.id, player.id}
    assert {notification.type for notification in create_notifications} == {NotificationType.new_event}
    assert {notification.reference_type for notification in create_notifications} == {"event_snapshot"}
    assert {notification.reference_id for notification in create_notifications} == {None}

    updated = patch_event(
        draft.id,
        EventUpdateRequest(title="草稿修改不通知", location="备用场"),
        captain,
        session,
    )

    assert updated["title"] == "草稿修改不通知"
    assert updated["location"] == "备用场"
    assert session.scalars(select(Notification).order_by(Notification.created_at)).all() == create_notifications
    assert session.scalars(select(Notification).where(Notification.type == NotificationType.event_updated)).all() == []

    delete_event_route(draft.id, captain, session)

    assert session.get(Event, draft.id) is None
    assert session.scalars(select(Notification).order_by(Notification.created_at)).all() == create_notifications
    assert session.scalars(select(Notification).where(Notification.type == NotificationType.event_deleted)).all() == []


def test_delete_published_match_physically_removes_dependent_records(session: Session) -> None:
    team, captain, player = _seed_team(session)
    event_response = post_match(
        team.id,
        MatchCreateRequest(
            event=_event_payload("待删除比赛"),
            match_details=MatchDetailsCreateRequest(opponent="删除测试队"),
        ),
        captain,
        session,
    )
    event_id = event_response["id"]
    post_publish_event(event_id, captain, session)
    signup = put_my_signup(
        event_id,
        EventSignupUpsertRequest(status=SignupStatus.going),
        player,
        session,
    )
    log = post_match_log(
        event_id,
        MatchLogEntryCreateRequest(
            entry_type=MatchEntryType.goal,
            minute=8,
            player_name="小陈",
            player_number="9",
        ),
        captain,
        session,
    )
    match_details = session.scalar(select(MatchDetails).where(MatchDetails.event_id == event_id))
    assert match_details is not None

    delete_event_route(event_id, captain, session)

    assert session.get(Event, event_id) is None
    assert session.get(EventSignup, signup.id) is None
    assert session.get(MatchDetails, match_details.id) is None
    assert session.get(MatchLogEntry, log.id) is None
    delete_notifications = session.scalars(
        select(Notification).where(Notification.type == NotificationType.event_deleted)
    ).all()
    assert len(delete_notifications) == 2
    assert all(notification.reference_type == "event_snapshot" for notification in delete_notifications)
    assert all(notification.reference_id is None for notification in delete_notifications)
    assert all("待删除比赛" in notification.body for notification in delete_notifications)


def test_event_router_keeps_drafts_hidden_from_members_even_with_explicit_filters(session: Session) -> None:
    team, captain, player = _seed_team(session)
    draft = post_event(team.id, _event_payload("队长草稿"), captain, session)
    published = post_event(team.id, _event_payload("公开训练"), captain, session)
    post_publish_event(published.id, captain, session)

    assert [event["id"] for event in read_events(team.id, None, EventStatus.draft, None, None, captain, session)] == [
        draft.id
    ]
    assert [event["id"] for event in read_events(team.id, None, None, None, None, player, session)] == [published.id]
    assert read_events(team.id, None, EventStatus.draft, None, None, player, session) == []

    with pytest.raises(HTTPException) as signup_exc:
        read_my_signup(draft.id, player, session)
    assert signup_exc.value.status_code == 403
    assert signup_exc.value.detail["code"] == "EVENT_PERMISSION_DENIED"


def test_other_team_captain_cannot_manage_events_or_completion(session: Session) -> None:
    _team_a, team_a_captain, _team_a_player = _seed_team(session)
    team_b, team_b_captain, team_b_player = _seed_other_team(session)

    draft = post_event(team_b.id, _event_payload("B 队草稿"), team_b_captain, session)
    published = post_event(team_b.id, _event_payload("B 队公开训练"), team_b_captain, session)
    post_publish_event(published.id, team_b_captain, session)

    with pytest.raises(HTTPException) as publish_exc:
        post_publish_event(draft.id, team_a_captain, session)
    assert publish_exc.value.status_code == 403
    assert publish_exc.value.detail["code"] == "EVENT_PERMISSION_DENIED"

    with pytest.raises(HTTPException) as patch_exc:
        patch_event(published.id, EventUpdateRequest(title="非法跨队修改"), team_a_captain, session)
    assert patch_exc.value.status_code == 403
    assert patch_exc.value.detail["code"] == "EVENT_PERMISSION_DENIED"

    with pytest.raises(HTTPException) as delete_exc:
        delete_event_route(published.id, team_a_captain, session)
    assert delete_exc.value.status_code == 403
    assert delete_exc.value.detail["code"] == "EVENT_PERMISSION_DENIED"

    with pytest.raises(HTTPException) as complete_exc:
        post_complete_event(published.id, team_a_captain, session)
    assert complete_exc.value.status_code == 403
    assert complete_exc.value.detail["code"] == "EVENT_PERMISSION_DENIED"


def test_match_creation_notifies_active_team_members(session: Session) -> None:
    team, captain, player = _seed_team(session)
    payload = _event_payload("周末比赛")

    post_match(
        team.id,
        MatchCreateRequest(
            event=payload,
            match_details=MatchDetailsCreateRequest(opponent="API United"),
        ),
        captain,
        session,
    )

    notifications = session.scalars(select(Notification).order_by(Notification.created_at)).all()
    assert [notification.type for notification in notifications] == [
        NotificationType.new_event,
        NotificationType.new_event,
    ]
    assert {notification.user_id for notification in notifications} == {captain.id, player.id}
    assert {notification.reference_type for notification in notifications} == {"event_snapshot"}
    assert all(notification.reference_id is None for notification in notifications)
    assert all("周末比赛" in notification.body for notification in notifications)
    assert all(payload.start_time.isoformat() in notification.body for notification in notifications)


def test_signup_reads_include_user_summary_for_mobile_lists(session: Session) -> None:
    team, captain, player = _seed_team(session)
    event = post_event(team.id, _event_payload("名单展示训练"), captain, session)
    post_publish_event(event.id, captain, session)

    saved_signup = put_my_signup(
        event.id,
        EventSignupUpsertRequest(status=SignupStatus.going),
        player,
        session,
    )
    assert saved_signup.user_id == player.id
    assert saved_signup.status == SignupStatus.going

    signup_rows = read_signups(event.id, None, captain, session)
    assert signup_rows[0]["user"]["name"] == player.name
    assert signup_rows[0]["user"]["email"] == player.email


def test_match_publish_requires_non_blank_opponent_even_for_existing_match_details(session: Session) -> None:
    team, captain, _ = _seed_team(session)
    event = Event(
        team_id=team.id,
        type=EventType.match,
        title="缺少对手的比赛",
        start_time=datetime.now(UTC) + timedelta(days=2),
        status=EventStatus.draft,
        created_by=captain.id,
    )
    session.add(event)
    session.flush()
    session.add(MatchDetails(event_id=event.id, opponent="   "))
    session.commit()

    with pytest.raises(HTTPException) as publish_exc:
        post_publish_event(event.id, captain, session)

    assert publish_exc.value.status_code == 409
    assert publish_exc.value.detail["code"] == "EVENT_STATE_CONFLICT"
    assert "opponent" in publish_exc.value.detail["message"]
    assert session.get(Event, event.id).status == EventStatus.draft


def test_completed_event_router_blocks_update_and_delete(session: Session) -> None:
    team, captain, player = _seed_team(session)
    event = post_event(team.id, _event_payload("完成后不可修改"), captain, session)
    post_publish_event(event.id, captain, session)
    put_my_signup(
        event.id,
        EventSignupUpsertRequest(status=SignupStatus.going),
        player,
        session,
    )

    completion = post_complete_event(event.id, captain, session)
    assert completion["status"] == EventStatus.completed
    assert completion["going_count"] == 1

    with pytest.raises(HTTPException) as patch_exc:
        patch_event(event.id, EventUpdateRequest(title="非法修改"), captain, session)
    assert patch_exc.value.status_code == 409
    assert patch_exc.value.detail["code"] == "EVENT_STATE_CONFLICT"

    with pytest.raises(HTTPException) as delete_exc:
        delete_event_route(event.id, captain, session)
    assert delete_exc.value.status_code == 409
    assert delete_exc.value.detail["code"] == "EVENT_STATE_CONFLICT"
    assert session.get(Event, event.id) is not None


def test_match_completion_accepts_final_match_details(session: Session) -> None:
    team, captain, player = _seed_team(session)
    event_response = post_match(
        team.id,
        MatchCreateRequest(
            event=_event_payload("最终比分比赛"),
            match_details=MatchDetailsCreateRequest(opponent="API United", notes="赛前备注"),
        ),
        captain,
        session,
    )
    event = session.get(Event, event_response["id"])
    assert event is not None
    post_publish_event(event.id, captain, session)
    put_my_signup(
        event.id,
        EventSignupUpsertRequest(status=SignupStatus.going),
        player,
        session,
    )

    completion = post_complete_event(
        event.id,
        captain,
        session,
        payload=EventCompletionRequest(
            match_details=MatchDetailsUpdateRequest(
                team_score=2,
                opponent_score=1,
                result="win",
                notes="  终场确认  ",
            )
        ),
    )

    assert completion["status"] == EventStatus.completed
    match_details = session.scalar(select(MatchDetails).where(MatchDetails.event_id == event.id))
    assert match_details is not None
    assert match_details.team_score == 2
    assert match_details.opponent_score == 1
    assert match_details.result == "win"
    assert match_details.notes == "终场确认"


def test_match_update_rejects_partial_score_pair(session: Session) -> None:
    team, captain, _ = _seed_team(session)
    event_response = post_match(
        team.id,
        MatchCreateRequest(
            event=_event_payload("比分成对校验"),
            match_details=MatchDetailsCreateRequest(opponent="API United"),
        ),
        captain,
        session,
    )

    with pytest.raises(HTTPException) as update_exc:
        patch_event(
            event_response["id"],
            EventUpdateRequest(match_details=MatchDetailsUpdateRequest(team_score=1)),
            captain,
            session,
        )

    assert update_exc.value.status_code == 409
    assert update_exc.value.detail["code"] == "EVENT_STATE_CONFLICT"
    match_details = session.scalar(select(MatchDetails).where(MatchDetails.event_id == event_response["id"]))
    assert match_details is not None
    assert match_details.team_score is None
    assert match_details.opponent_score is None


def test_match_completion_rejects_result_that_does_not_match_score(session: Session) -> None:
    team, captain, player = _seed_team(session)
    event_response = post_match(
        team.id,
        MatchCreateRequest(
            event=_event_payload("结果比分校验"),
            match_details=MatchDetailsCreateRequest(opponent="API United"),
        ),
        captain,
        session,
    )
    event = session.get(Event, event_response["id"])
    assert event is not None
    post_publish_event(event.id, captain, session)
    put_my_signup(
        event.id,
        EventSignupUpsertRequest(status=SignupStatus.going),
        player,
        session,
    )

    with pytest.raises(HTTPException) as complete_exc:
        post_complete_event(
            event.id,
            captain,
            session,
            payload=EventCompletionRequest(
                match_details=MatchDetailsUpdateRequest(
                    team_score=2,
                    opponent_score=1,
                    result="loss",
                )
            ),
        )

    assert complete_exc.value.status_code == 409
    assert complete_exc.value.detail["code"] == "EVENT_STATE_CONFLICT"
    session.refresh(event)
    assert event.status == EventStatus.published
    match_details = session.scalar(select(MatchDetails).where(MatchDetails.event_id == event.id))
    assert match_details is not None
    assert match_details.team_score is None
    assert match_details.opponent_score is None
    assert match_details.result is None
    assert session.scalars(select(EventSignup).where(EventSignup.event_id == event.id)).one().status == SignupStatus.going
    assert session.scalars(select(CoinTransaction).where(CoinTransaction.reference_id == event.id)).all() == []


def test_training_completion_rejects_match_details_without_completing(session: Session) -> None:
    team, captain, player = _seed_team(session)
    event = post_event(team.id, _event_payload("训练不能带比分"), captain, session)
    post_publish_event(event.id, captain, session)
    put_my_signup(
        event.id,
        EventSignupUpsertRequest(status=SignupStatus.going),
        player,
        session,
    )

    with pytest.raises(HTTPException) as complete_exc:
        post_complete_event(
            event.id,
            captain,
            session,
            payload=EventCompletionRequest(
                match_details=MatchDetailsUpdateRequest(
                    team_score=1,
                    opponent_score=0,
                    result="win",
                )
            ),
        )

    assert complete_exc.value.status_code == 409
    assert complete_exc.value.detail["code"] == "EVENT_STATE_CONFLICT"
    assert "match events" in complete_exc.value.detail["message"]
    session.refresh(event)
    assert event.status == EventStatus.published
    assert session.scalars(select(EventSignup).where(EventSignup.event_id == event.id)).one().status == SignupStatus.going
    assert session.scalars(select(CoinTransaction).where(CoinTransaction.reference_id == event.id)).all() == []


def test_event_router_rejects_invalid_schedule_updates(session: Session) -> None:
    team, captain, _ = _seed_team(session)
    start_time = datetime.now(UTC) + timedelta(days=2)
    event = post_event(
        team.id,
        EventCreateRequest(
            type=EventType.training,
            title="时间校验",
            start_time=start_time,
            end_time=start_time + timedelta(hours=2),
            signup_deadline=start_time - timedelta(hours=3),
        ),
        captain,
        session,
    )

    with pytest.raises(HTTPException) as end_time_exc:
        patch_event(event.id, EventUpdateRequest(end_time=start_time - timedelta(hours=1)), captain, session)
    assert end_time_exc.value.status_code == 409
    assert end_time_exc.value.detail["code"] == "EVENT_STATE_CONFLICT"
    assert "end_time" in end_time_exc.value.detail["message"]

    with pytest.raises(HTTPException) as signup_deadline_exc:
        patch_event(
            event.id,
            EventUpdateRequest(signup_deadline=start_time + timedelta(hours=1)),
            captain,
            session,
        )
    assert signup_deadline_exc.value.status_code == 409
    assert signup_deadline_exc.value.detail["code"] == "EVENT_STATE_CONFLICT"
    assert "signup_deadline" in signup_deadline_exc.value.detail["message"]


def test_event_signup_rejects_after_deadline(session: Session) -> None:
    team, captain, player = _seed_team(session)
    event = post_event(
        team.id,
        EventCreateRequest(
            type=EventType.training,
            title="已截止报名",
            location="主球场",
            start_time=datetime.now(UTC) + timedelta(days=2),
            signup_deadline=datetime.now(UTC) - timedelta(minutes=1),
        ),
        captain,
        session,
    )
    post_publish_event(event.id, captain, session)

    with pytest.raises(HTTPException) as signup_exc:
        put_my_signup(
            event.id,
            EventSignupUpsertRequest(status=SignupStatus.going),
            player,
            session,
        )

    assert signup_exc.value.status_code == 409
    assert signup_exc.value.detail["code"] == "EVENT_STATE_CONFLICT"
    assert "deadline" in signup_exc.value.detail["message"]
    assert session.scalars(select(EventSignup).where(EventSignup.event_id == event.id)).all() == []


def test_inactive_member_cannot_read_or_update_event_signup(session: Session) -> None:
    team, captain, _ = _seed_team(session)
    inactive_player = _user("Inactive Signup Player")
    session.add(inactive_player)
    session.flush()
    session.add(
        TeamMembership(
            team_id=team.id,
            user_id=inactive_player.id,
            role=MembershipRole.member,
            status=MembershipStatus.inactive,
        )
    )
    event = post_event(team.id, _event_payload("非活跃成员不可报名"), captain, session)
    post_publish_event(event.id, captain, session)

    with pytest.raises(HTTPException) as read_exc:
        read_my_signup(event.id, inactive_player, session)
    assert read_exc.value.status_code == 403
    assert read_exc.value.detail["code"] == "EVENT_PERMISSION_DENIED"

    with pytest.raises(HTTPException) as signup_exc:
        put_my_signup(
            event.id,
            EventSignupUpsertRequest(status=SignupStatus.going),
            inactive_player,
            session,
        )
    assert signup_exc.value.status_code == 403
    assert signup_exc.value.detail["code"] == "EVENT_PERMISSION_DENIED"
    assert session.scalars(select(EventSignup).where(EventSignup.event_id == event.id)).all() == []


def test_event_signup_without_deadline_rejects_after_start_time(session: Session) -> None:
    team, captain, player = _seed_team(session)
    event = post_event(
        team.id,
        EventCreateRequest(
            type=EventType.training,
            title="已开始训练",
            location="主球场",
            start_time=datetime.now(UTC) - timedelta(minutes=1),
        ),
        captain,
        session,
    )
    post_publish_event(event.id, captain, session)

    with pytest.raises(HTTPException) as signup_exc:
        put_my_signup(
            event.id,
            EventSignupUpsertRequest(status=SignupStatus.going),
            player,
            session,
        )

    assert signup_exc.value.status_code == 409
    assert signup_exc.value.detail["code"] == "EVENT_STATE_CONFLICT"
    assert "deadline" in signup_exc.value.detail["message"]
    assert session.scalars(select(EventSignup).where(EventSignup.event_id == event.id)).all() == []


def test_completed_event_router_blocks_signup_changes(session: Session) -> None:
    team, captain, player = _seed_team(session)
    event = post_event(team.id, _event_payload("完成后不可改报名"), captain, session)
    post_publish_event(event.id, captain, session)
    saved_signup = put_my_signup(
        event.id,
        EventSignupUpsertRequest(status=SignupStatus.going),
        player,
        session,
    )
    post_complete_event(event.id, captain, session)

    with pytest.raises(HTTPException) as signup_exc:
        put_my_signup(
            event.id,
            EventSignupUpsertRequest(status=SignupStatus.not_going, note="赛后不能改"),
            player,
            session,
        )

    assert signup_exc.value.status_code == 409
    assert signup_exc.value.detail["code"] == "EVENT_STATE_CONFLICT"
    assert session.get(EventSignup, saved_signup.id).status == SignupStatus.going

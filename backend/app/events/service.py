from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.common.enums import (
    EventStatus,
    EventType,
    MembershipRole,
    NotificationType,
    SignupStatus,
    enum_value,
)
from app.common.permissions import PermissionDeniedError, role_at_least
from app.events.schemas import (
    EventCreateRequest,
    EventSignupUpsertRequest,
    EventUpdateRequest,
    MatchCreateRequest,
    validate_match_score_result,
    validate_schedule_window,
)
from app.models import Attendance, Event, EventSignup, MatchDetails, MatchLogEntry, User
from app.notifications.service import create_team_notifications
from app.teams.service import get_active_membership, require_team_role


class EventNotFoundError(Exception):
    pass


class EventStateError(Exception):
    pass


class EventConflictError(Exception):
    pass


class SignupRuleError(Exception):
    pass


def _get_event(session: Session, event_id: UUID) -> Event:
    event = session.get(Event, event_id)
    if event is None:
        raise EventNotFoundError("Event not found")
    return event


def _get_event_for_update(session: Session, event_id: UUID) -> Event:
    event = session.scalar(select(Event).where(Event.id == event_id).with_for_update())
    if event is None:
        raise EventNotFoundError("Event not found")
    return event


def _get_match_details(session: Session, event_id: UUID) -> MatchDetails | None:
    return session.scalar(select(MatchDetails).where(MatchDetails.event_id == event_id))


def _ensure_publishable_match_details(session: Session, event: Event) -> None:
    match_details = _get_match_details(session, event.id)
    if match_details is None or match_details.opponent.strip() == "":
        raise EventStateError("Match opponent is required before publishing")


def _read_event_with_details(session: Session, event: Event) -> dict[str, object]:
    return {
        "id": event.id,
        "team_id": event.team_id,
        "type": event.type,
        "title": event.title,
        "description": event.description,
        "location": event.location,
        "start_time": event.start_time,
        "end_time": event.end_time,
        "signup_deadline": event.signup_deadline,
        "status": event.status,
        "created_by": event.created_by,
        "created_at": event.created_at,
        "updated_at": event.updated_at,
        "match_details": _get_match_details(session, event.id),
    }


def _now_for(deadline: datetime) -> datetime:
    if deadline.tzinfo is None:
        return datetime.now(UTC).replace(tzinfo=None)
    return datetime.now(UTC)


def _signup_closes_at(event: Event) -> datetime:
    return event.signup_deadline or event.start_time


def _ensure_event_visible(session: Session, event: Event, user: User) -> None:
    membership = get_active_membership(session, event.team_id, user.id)
    if event.status == EventStatus.draft and not role_at_least(membership.role, MembershipRole.captain):
        raise PermissionDeniedError("Draft events require captain role")


def _ensure_valid_schedule(event: Event) -> None:
    try:
        validate_schedule_window(event.start_time, event.end_time, event.signup_deadline)
    except ValueError as exc:
        raise EventStateError(str(exc)) from exc


def _draft_event_notification_body(event: Event) -> str:
    return f"{event.title} 已创建，时间：{event.start_time.isoformat()}。"


def _datetimes_match(left: datetime | None, right: datetime | None) -> bool:
    if left is None or right is None:
        return left is right
    if left.tzinfo is None:
        left = left.replace(tzinfo=UTC)
    else:
        left = left.astimezone(UTC)
    if right.tzinfo is None:
        right = right.replace(tzinfo=UTC)
    else:
        right = right.astimezone(UTC)
    return left == right


def _event_create_fields_match(event: Event, payload: EventCreateRequest) -> bool:
    return (
        enum_value(event.type) == enum_value(payload.type)
        and event.title == payload.title
        and event.description == payload.description
        and event.location == payload.location
        and _datetimes_match(event.start_time, payload.start_time)
        and _datetimes_match(event.end_time, payload.end_time)
        and _datetimes_match(event.signup_deadline, payload.signup_deadline)
    )


def _event_matches_create_request(event: Event, team_id: UUID, user: User, payload: EventCreateRequest) -> bool:
    return event.team_id == team_id and event.created_by == user.id and _event_create_fields_match(event, payload)


def create_event(session: Session, team_id: UUID, user: User, payload: EventCreateRequest) -> Event:
    require_team_role(session, team_id, user.id, MembershipRole.captain)
    if payload.type == EventType.match:
        raise EventStateError("Use /teams/{team_id}/matches to create matches")
    if payload.id is not None:
        existing = session.get(Event, payload.id)
        if existing is not None:
            if not _event_matches_create_request(existing, team_id, user, payload):
                raise EventConflictError("Event id already belongs to another request")
            return existing
    event = Event(
        id=payload.id,
        team_id=team_id,
        type=payload.type,
        title=payload.title,
        description=payload.description,
        location=payload.location,
        start_time=payload.start_time,
        end_time=payload.end_time,
        signup_deadline=payload.signup_deadline,
        status=EventStatus.draft,
        created_by=user.id,
    )
    session.add(event)
    session.flush()
    create_team_notifications(
        session,
        event.team_id,
        NotificationType.new_event,
        title="新活动",
        body=_draft_event_notification_body(event),
        reference_type="event_snapshot",
        reference_id=None,
    )
    session.commit()
    session.refresh(event)
    return event


def create_match(session: Session, team_id: UUID, user: User, payload: MatchCreateRequest) -> Event:
    require_team_role(session, team_id, user.id, MembershipRole.captain)
    event_payload = payload.event.model_copy(update={"type": EventType.match})
    if event_payload.id is not None:
        existing = session.get(Event, event_payload.id)
        if existing is not None:
            match_details = _get_match_details(session, existing.id)
            if (
                not _event_matches_create_request(existing, team_id, user, event_payload)
                or match_details is None
                or match_details.opponent != payload.match_details.opponent
                or match_details.notes != payload.match_details.notes
            ):
                raise EventConflictError("Event id already belongs to another request")
            return existing
    event = Event(
        id=event_payload.id,
        team_id=team_id,
        type=EventType.match,
        title=event_payload.title,
        description=event_payload.description,
        location=event_payload.location,
        start_time=event_payload.start_time,
        end_time=event_payload.end_time,
        signup_deadline=event_payload.signup_deadline,
        status=EventStatus.draft,
        created_by=user.id,
    )
    session.add(event)
    session.flush()
    session.add(
        MatchDetails(
            event_id=event.id,
            opponent=payload.match_details.opponent,
            notes=payload.match_details.notes,
        )
    )
    create_team_notifications(
        session,
        event.team_id,
        NotificationType.new_event,
        title="新比赛",
        body=_draft_event_notification_body(event),
        reference_type="event_snapshot",
        reference_id=None,
    )
    session.commit()
    session.refresh(event)
    return event


def list_events(
    session: Session,
    team_id: UUID,
    user: User,
    event_type: EventType | None = None,
    status: EventStatus | None = None,
    starts_after: datetime | None = None,
    starts_before: datetime | None = None,
) -> list[dict[str, object]]:
    membership = get_active_membership(session, team_id, user.id)
    stmt = select(Event).where(Event.team_id == team_id).order_by(Event.start_time)
    if not role_at_least(membership.role, MembershipRole.captain):
        stmt = stmt.where(Event.status != EventStatus.draft)
    if event_type is not None:
        stmt = stmt.where(Event.type == event_type)
    if status is not None:
        stmt = stmt.where(Event.status == status)
    if starts_after is not None:
        stmt = stmt.where(Event.start_time >= starts_after)
    if starts_before is not None:
        stmt = stmt.where(Event.start_time <= starts_before)
    return [_read_event_with_details(session, event) for event in session.scalars(stmt)]


def get_event_detail(session: Session, event_id: UUID, user: User) -> dict[str, object]:
    event = _get_event(session, event_id)
    _ensure_event_visible(session, event, user)
    return _read_event_with_details(session, event)


def update_event(session: Session, event_id: UUID, user: User, payload: EventUpdateRequest) -> Event:
    event = _get_event_for_update(session, event_id)
    require_team_role(session, event.team_id, user.id, MembershipRole.captain)
    if event.status == EventStatus.completed:
        raise EventStateError("Completed events cannot be modified")
    if event.status not in {EventStatus.draft, EventStatus.published}:
        raise EventStateError("Only draft or published events can be modified")

    update_data = payload.model_dump(exclude_unset=True, exclude={"match_details"})
    try:
        validate_schedule_window(
            update_data.get("start_time", event.start_time),
            update_data.get("end_time", event.end_time),
            update_data.get("signup_deadline", event.signup_deadline),
        )
    except ValueError as exc:
        raise EventStateError(str(exc)) from exc

    has_changes = False
    for field, value in update_data.items():
        if getattr(event, field) != value:
            setattr(event, field, value)
            has_changes = True

    if payload.match_details is not None:
        if event.type != EventType.match:
            raise EventStateError("Only match events can update match details")
        match_details = _get_match_details(session, event.id)
        if match_details is None:
            raise EventStateError("Match details are required")
        match_update_data = payload.match_details.model_dump(exclude_unset=True)
        try:
            validate_match_score_result(
                match_update_data.get("team_score", match_details.team_score),
                match_update_data.get("opponent_score", match_details.opponent_score),
                match_update_data.get("result", match_details.result),
            )
        except ValueError as exc:
            raise EventStateError(str(exc)) from exc
        for field, value in match_update_data.items():
            if getattr(match_details, field) != value:
                setattr(match_details, field, value)
                has_changes = True

    _ensure_valid_schedule(event)

    if has_changes and event.status == EventStatus.published:
        create_team_notifications(
            session,
            event.team_id,
            NotificationType.event_updated,
            title="活动已更新",
            body=f"{event.title} 的安排已更新。",
            reference_type="event",
            reference_id=event.id,
        )

    session.commit()
    session.refresh(event)
    return event


def publish_event(session: Session, event_id: UUID, user: User) -> Event:
    event = _get_event_for_update(session, event_id)
    require_team_role(session, event.team_id, user.id, MembershipRole.captain)
    if event.status == EventStatus.published:
        return event
    if event.status != EventStatus.draft:
        raise EventStateError("Only draft events can be published")
    if event.type == EventType.match:
        _ensure_publishable_match_details(session, event)

    event.status = EventStatus.published
    create_team_notifications(
        session,
        event.team_id,
        NotificationType.new_event,
        title="新活动",
        body=f"{event.title} 已发布，请确认是否参加。",
        reference_type="event",
        reference_id=event.id,
    )
    session.commit()
    session.refresh(event)
    return event


def delete_event(session: Session, event_id: UUID, user: User) -> None:
    event = _get_event_for_update(session, event_id)
    require_team_role(session, event.team_id, user.id, MembershipRole.captain)
    if event.status == EventStatus.completed:
        raise EventStateError("Completed events cannot be deleted")
    if event.status not in {EventStatus.draft, EventStatus.published}:
        raise EventStateError("Only draft or published events can be deleted")

    if event.status == EventStatus.published:
        body = f"{event.title}（{event.start_time.isoformat()}）已删除。"
        create_team_notifications(
            session,
            event.team_id,
            NotificationType.event_deleted,
            title="活动已删除",
            body=body,
            reference_type="event_snapshot",
            reference_id=None,
        )
    session.execute(delete(EventSignup).where(EventSignup.event_id == event.id))
    session.execute(delete(Attendance).where(Attendance.event_id == event.id))
    session.execute(delete(MatchLogEntry).where(MatchLogEntry.event_id == event.id))
    session.execute(delete(MatchDetails).where(MatchDetails.event_id == event.id))
    session.delete(event)
    session.commit()


def get_my_signup(session: Session, event_id: UUID, user: User) -> EventSignup | dict[str, object]:
    event = _get_event(session, event_id)
    _ensure_event_visible(session, event, user)
    signup = session.scalar(
        select(EventSignup).where(EventSignup.event_id == event_id, EventSignup.user_id == user.id)
    )
    if signup is not None:
        return signup
    return {
        "id": None,
        "event_id": event.id,
        "user_id": user.id,
        "status": SignupStatus.maybe,
        "note": None,
        "created_at": None,
        "updated_at": None,
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "avatar_url": user.avatar_url,
        },
    }


def upsert_my_signup(
    session: Session,
    event_id: UUID,
    user: User,
    payload: EventSignupUpsertRequest,
) -> EventSignup:
    event = _get_event(session, event_id)
    get_active_membership(session, event.team_id, user.id)
    if event.status != EventStatus.published:
        raise SignupRuleError("Signup requires a published event")
    signup_closes_at = _signup_closes_at(event)
    if _now_for(signup_closes_at) > signup_closes_at:
        raise SignupRuleError("Signup deadline has passed")

    signup = session.scalar(
        select(EventSignup).where(EventSignup.event_id == event_id, EventSignup.user_id == user.id)
    )
    if signup is None:
        signup = EventSignup(event_id=event_id, user_id=user.id, status=payload.status, note=payload.note)
        session.add(signup)
    else:
        signup.status = payload.status
        signup.note = payload.note
    session.commit()
    session.refresh(signup)
    return signup


def _signup_read(signup: EventSignup, signup_user: User | None) -> dict[str, object]:
    return {
        "id": signup.id,
        "event_id": signup.event_id,
        "user_id": signup.user_id,
        "status": signup.status,
        "note": signup.note,
        "created_at": signup.created_at,
        "updated_at": signup.updated_at,
        "user": None
        if signup_user is None
        else {
            "id": signup_user.id,
            "name": signup_user.name,
            "email": signup_user.email,
            "avatar_url": signup_user.avatar_url,
        },
    }


def list_signups(session: Session, event_id: UUID, user: User, status: SignupStatus | None) -> list[dict[str, object]]:
    event = _get_event(session, event_id)
    require_team_role(session, event.team_id, user.id, MembershipRole.captain)
    stmt = (
        select(EventSignup, User)
        .join(User, User.id == EventSignup.user_id)
        .where(EventSignup.event_id == event_id)
        .order_by(EventSignup.created_at)
    )
    if status is not None:
        stmt = stmt.where(EventSignup.status == status)
    return [_signup_read(signup, signup_user) for signup, signup_user in session.execute(stmt).all()]

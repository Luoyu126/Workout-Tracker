from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.orm import Session

from app.coins.service import issue_signup_reward
from app.common.enums import EventStatus, EventType, MembershipRole, SignupStatus, enum_value
from app.common.permissions import PermissionDeniedError
from app.common.transactions import transaction_boundary
from app.events import repository
from app.events.errors import (
    EventConflictError,
    EventNotFoundError,
    EventStateError,
    SignupRuleError,
)
from app.events.schemas import (
    EventCompletionRequest,
    EventCreateRequest,
    EventSignupUpsertRequest,
    EventUpdateRequest,
    MatchCreateRequest,
    validate_match_score_result,
    validate_schedule_window,
)
from app.models import Event, EventSignup, MatchDetails, TeamMembership, User
from app.notifications.service import delete_event_notifications, sync_event_notifications
from app.teams import repository as team_repository
from app.teams.eligibility import is_membership_eligible_for_event
from app.teams.service import get_active_membership, require_team_role


def _get_event(session: Session, event_id: UUID) -> Event:
    event = repository.get_event(session, event_id)
    if event is None:
        raise EventNotFoundError()
    return event


def _get_event_for_update(session: Session, event_id: UUID) -> Event:
    event = repository.get_event_for_update(session, event_id)
    if event is None:
        raise EventNotFoundError()
    return event


def _get_match_details(session: Session, event_id: UUID) -> MatchDetails | None:
    return repository.get_match_details(session, event_id)


def _read_event_with_details(
    session: Session,
    event: Event,
    match_details: MatchDetails | None = None,
    *,
    load_match_details: bool = True,
) -> dict[str, object]:
    if match_details is None and load_match_details:
        match_details = repository.get_match_details(session, event.id)
    return {
        "id": event.id,
        "team_id": event.team_id,
        "type": event.type,
        "title": event.title,
        "description": event.description,
        "location": event.location,
        "start_time": event.start_time,
        "end_time": event.end_time,
        "status": event.status,
        "created_by": event.created_by,
        "created_at": event.created_at,
        "updated_at": event.updated_at,
        "match_details": match_details,
    }


def _now_for(deadline: datetime) -> datetime:
    if deadline.tzinfo is None:
        return datetime.now(UTC).replace(tzinfo=None)
    return datetime.now(UTC)


def _ensure_event_visible(
    session: Session,
    event: Event,
    user: User,
    *,
    permission_code: str = "EVENT_PERMISSION_DENIED",
) -> None:
    get_active_membership(
        session,
        event.team_id,
        user.id,
        permission_code=permission_code,
        operation="events.ensure_visible",
    )


def _require_event_admin(session: Session, event: Event, user: User, operation: str) -> None:
    require_team_role(
        session,
        event.team_id,
        user.id,
        MembershipRole.admin,
        permission_code="EVENT_PERMISSION_DENIED",
        operation=operation,
    )


def _ensure_valid_schedule(event: Event) -> None:
    try:
        validate_schedule_window(event.start_time, event.end_time)
    except ValueError as exc:
        raise EventStateError(str(exc)) from exc


def _datetimes_match(left: datetime | None, right: datetime | None) -> bool:
    if left is None or right is None:
        return left is right
    left = left.replace(tzinfo=UTC) if left.tzinfo is None else left.astimezone(UTC)
    right = right.replace(tzinfo=UTC) if right.tzinfo is None else right.astimezone(UTC)
    return left == right


def _event_create_fields_match(event: Event, payload: EventCreateRequest) -> bool:
    return (
        enum_value(event.type) == enum_value(payload.type)
        and event.title == payload.title
        and event.description == payload.description
        and event.location == payload.location
        and _datetimes_match(event.start_time, payload.start_time)
        and _datetimes_match(event.end_time, payload.end_time)
    )


def _event_matches_create_request(event: Event, team_id: UUID, user: User, payload: EventCreateRequest) -> bool:
    return event.team_id == team_id and event.created_by == user.id and _event_create_fields_match(event, payload)


def create_event(session: Session, team_id: UUID, user: User, payload: EventCreateRequest) -> Event:
    with transaction_boundary(session):
        require_team_role(
            session,
            team_id,
            user.id,
            MembershipRole.admin,
            permission_code="EVENT_PERMISSION_DENIED",
            operation="events.create_event",
        )
        if payload.type == EventType.match:
            raise EventStateError("Use /teams/{team_id}/matches to create matches")
        existing = repository.get_event(session, payload.id) if payload.id is not None else None
        if existing is not None:
            if not _event_matches_create_request(existing, team_id, user, payload):
                raise EventConflictError("Event id already belongs to another request")
            event = existing
        else:
            event = Event(
                id=payload.id,
                team_id=team_id,
                type=payload.type,
                title=payload.title,
                description=payload.description,
                location=payload.location,
                start_time=payload.start_time,
                end_time=payload.end_time,
                status=EventStatus.published,
                created_by=user.id,
            )
            repository.add(session, event)
            repository.flush(session)
            sync_event_notifications(session, event)
    repository.refresh(session, event)
    return event


def create_match(session: Session, team_id: UUID, user: User, payload: MatchCreateRequest) -> Event:
    with transaction_boundary(session):
        require_team_role(
            session,
            team_id,
            user.id,
            MembershipRole.admin,
            permission_code="EVENT_PERMISSION_DENIED",
            operation="events.create_match",
        )
        event_payload = payload.event.model_copy(update={"type": EventType.match})
        existing = repository.get_event(session, event_payload.id) if event_payload.id is not None else None
        if existing is not None:
            details = repository.get_match_details(session, existing.id)
            if (
                not _event_matches_create_request(existing, team_id, user, event_payload)
                or details is None
                or details.opponent != payload.match_details.opponent
                or details.notes != payload.match_details.notes
            ):
                raise EventConflictError("Event id already belongs to another request")
            event = existing
        else:
            event = Event(
                id=event_payload.id,
                team_id=team_id,
                type=EventType.match,
                title=event_payload.title,
                description=event_payload.description,
                location=event_payload.location,
                start_time=event_payload.start_time,
                end_time=event_payload.end_time,
                status=EventStatus.published,
                created_by=user.id,
            )
            repository.add(session, event)
            repository.flush(session)
            repository.add(
                session,
                MatchDetails(
                    event_id=event.id,
                    opponent=payload.match_details.opponent,
                    notes=payload.match_details.notes,
                ),
            )
            sync_event_notifications(session, event)
    repository.refresh(session, event)
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
    get_active_membership(
        session,
        team_id,
        user.id,
        permission_code="EVENT_PERMISSION_DENIED",
        operation="events.list_events",
    )
    events = repository.list_events(
        session,
        team_id,
        event_type=event_type,
        status=status,
        starts_after=starts_after,
        starts_before=starts_before,
    )
    details_by_event = {
        details.event_id: details
        for details in repository.list_match_details(session, [event.id for event in events])
    }
    return [
        _read_event_with_details(
            session,
            event,
            details_by_event.get(event.id),
            load_match_details=False,
        )
        for event in events
    ]


def get_event_detail(session: Session, event_id: UUID, user: User) -> dict[str, object]:
    event = _get_event(session, event_id)
    _ensure_event_visible(session, event, user)
    return _read_event_with_details(session, event)


def update_event(session: Session, event_id: UUID, user: User, payload: EventUpdateRequest) -> Event:
    with transaction_boundary(session):
        event = _get_event_for_update(session, event_id)
        _require_event_admin(session, event, user, "events.update_event")
        if event.status == EventStatus.completed:
            raise EventStateError("Completed events cannot be modified")
        if event.status != EventStatus.published:
            raise EventStateError("Only published events can be modified")
        update_data = payload.model_dump(exclude_unset=True, exclude={"match_details"})
        try:
            validate_schedule_window(
                update_data.get("start_time", event.start_time),
                update_data.get("end_time", event.end_time),
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
            details = repository.get_match_details(session, event.id)
            if details is None:
                raise EventStateError("Match details are required")
            detail_updates = payload.match_details.model_dump(exclude_unset=True)
            try:
                validate_match_score_result(
                    detail_updates.get("team_score", details.team_score),
                    detail_updates.get("opponent_score", details.opponent_score),
                    detail_updates.get("result", details.result),
                )
            except ValueError as exc:
                raise EventStateError(str(exc)) from exc
            for field, value in detail_updates.items():
                if getattr(details, field) != value:
                    setattr(details, field, value)
                    has_changes = True
        _ensure_valid_schedule(event)
        if has_changes:
            sync_event_notifications(session, event)
    repository.refresh(session, event)
    return event


def delete_event(session: Session, event_id: UUID, user: User) -> None:
    with transaction_boundary(session):
        event = _get_event_for_update(session, event_id)
        _require_event_admin(session, event, user, "events.delete_event")
        if event.status == EventStatus.completed:
            raise EventStateError("Completed events cannot be deleted")
        if event.status != EventStatus.published:
            raise EventStateError("Only published events can be deleted")
        delete_event_notifications(session, event.id)
        repository.delete_event_graph(session, event)


def _apply_completion_match_details(
    session: Session,
    event: Event,
    payload: EventCompletionRequest,
) -> None:
    if payload.match_details is None:
        return
    if event.type != EventType.match:
        raise EventStateError("Only match events can include final match details")
    details = repository.get_match_details(session, event.id)
    if details is None:
        raise EventStateError("Match details are required before completing a match")
    updates = payload.match_details.model_dump(exclude_unset=True)
    try:
        validate_match_score_result(
            updates.get("team_score", details.team_score),
            updates.get("opponent_score", details.opponent_score),
            updates.get("result", details.result),
        )
    except ValueError as exc:
        raise EventStateError(str(exc)) from exc
    for field, value in updates.items():
        setattr(details, field, value)


def _eligible_member_ids_for_event(
    session: Session,
    event: Event,
    memberships: list[TeamMembership] | None = None,
) -> list[UUID]:
    return [
        membership.user_id
        for membership in (
            memberships
            if memberships is not None
            else team_repository.list_member_memberships(session, event.team_id)
        )
        if is_membership_eligible_for_event(membership, event)
    ]


def complete_event(
    session: Session,
    event_id: UUID,
    user: User,
    payload: EventCompletionRequest | None = None,
) -> dict[str, object]:
    with transaction_boundary(session):
        event = _get_event_for_update(session, event_id)
        _require_event_admin(session, event, user, "events.complete_event")
        member_memberships = team_repository.list_member_memberships(session, event.team_id)
        eligible_member_ids = _eligible_member_ids_for_event(session, event, member_memberships)
        membership_by_user_id = {membership.user_id: membership for membership in member_memberships}
        signup_by_user_id = {
            signup.user_id: signup.status for signup in repository.list_event_signups(session, event.id)
        }

        def status_for(member_id: UUID) -> SignupStatus:
            return signup_by_user_id.get(member_id, SignupStatus.maybe)

        if event.status == EventStatus.completed:
            going_count = sum(
                1 for member_id in eligible_member_ids if status_for(member_id) == SignupStatus.going
            )
            result = {
                "event_id": event.id,
                "status": enum_value(event.status),
                "going_count": going_count,
                "reward_count": 0,
            }
        else:
            if event.status != EventStatus.published:
                raise EventStateError("Only published events can be completed")
            _apply_completion_match_details(session, event, payload or EventCompletionRequest())
            reward_count = 0
            going_count = 0
            for member_id in eligible_member_ids:
                signup_status = status_for(member_id)
                if signup_status == SignupStatus.going:
                    going_count += 1
                if issue_signup_reward(
                    session,
                    event,
                    member_id,
                    signup_status,
                    user.id,
                    membership=membership_by_user_id[member_id],
                ) is not None:
                    reward_count += 1
            event.status = EventStatus.completed
            result = {
                "event_id": event.id,
                "status": enum_value(event.status),
                "going_count": going_count,
                "reward_count": reward_count,
            }
    return result


def get_my_signup(session: Session, event_id: UUID, user: User) -> EventSignup | dict[str, object]:
    event = _get_event(session, event_id)
    membership = get_active_membership(
        session,
        event.team_id,
        user.id,
        permission_code="EVENT_PERMISSION_DENIED",
        operation="events.get_signup",
    )
    if membership.role != MembershipRole.member:
        raise PermissionDeniedError(
            "Only members can sign up for events",
            code="EVENT_PERMISSION_DENIED",
            operation="events.get_signup",
        )
    signup = repository.find_signup(session, event_id, user.id)
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
        "user": {"id": user.id, "name": user.name, "email": user.email, "avatar_url": user.avatar_url},
    }


def upsert_my_signup(
    session: Session,
    event_id: UUID,
    user: User,
    payload: EventSignupUpsertRequest,
) -> EventSignup:
    with transaction_boundary(session):
        event = _get_event(session, event_id)
        membership = get_active_membership(
            session,
            event.team_id,
            user.id,
            permission_code="EVENT_PERMISSION_DENIED",
            operation="events.upsert_signup",
        )
        if membership.role != MembershipRole.member:
            raise PermissionDeniedError(
                "Only members can sign up for events",
                code="EVENT_PERMISSION_DENIED",
                operation="events.upsert_signup",
            )
        if event.status != EventStatus.published:
            raise SignupRuleError("Signup requires a published event")
        if _now_for(event.start_time) > event.start_time:
            raise SignupRuleError("Signup deadline has passed")
        signup = repository.find_signup(session, event_id, user.id)
        if signup is None:
            signup = EventSignup(event_id=event_id, user_id=user.id, status=payload.status, note=payload.note)
            repository.add(session, signup)
        else:
            signup.status = payload.status
            signup.note = payload.note
    repository.refresh(session, signup)
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
    _require_event_admin(session, event, user, "events.list_signups")
    return [
        _signup_read(signup, signup_user)
        for signup, signup_user in repository.list_signups_with_users(
            session,
            event_id,
            event.team_id,
            status,
        )
    ]

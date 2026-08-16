from datetime import datetime
from typing import cast
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.attendance.schemas import EventCompletionRequest
from app.coins.service import issue_initial_attendance_reward, reconcile_completed_attendance_reward
from app.common.enums import (
    AttendanceStatus,
    EventStatus,
    EventType,
    MembershipRole,
    MembershipStatus,
    enum_value,
)
from app.events.schemas import validate_match_score_result
from app.events.service import EventNotFoundError, _ensure_event_visible
from app.models import Attendance, Event, MatchDetails, TeamMembership, User
from app.teams.service import get_active_membership, require_team_role


class AttendanceNotFoundError(Exception):
    pass


class AttendanceStateError(Exception):
    pass


def _get_event(session: Session, event_id: UUID) -> Event:
    event = session.get(Event, event_id)
    if event is None:
        raise EventNotFoundError("Event not found")
    return event


def _get_event_for_completion(session: Session, event_id: UUID) -> Event:
    event = session.scalar(select(Event).where(Event.id == event_id).with_for_update())
    if event is None:
        raise EventNotFoundError("Event not found")
    return event


def _user_summary(user: User | None) -> dict[str, object] | None:
    if user is None:
        return None
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "avatar_url": user.avatar_url,
    }


def _attendance_read(attendance: Attendance, attendance_user: User | None) -> dict[str, object]:
    return {
        "id": attendance.id,
        "event_id": attendance.event_id,
        "user_id": attendance.user_id,
        "status": attendance.status,
        "recorded_by": attendance.recorded_by,
        "recorded_at": attendance.recorded_at,
        "note": attendance.note,
        "created_at": attendance.created_at,
        "updated_at": attendance.updated_at,
        "user": _user_summary(attendance_user),
    }


def list_attendance(session: Session, event_id: UUID, user: User) -> list[dict[str, object]]:
    event = _get_event(session, event_id)
    _ensure_event_visible(session, event, user)
    rows = session.execute(
        select(Attendance, User)
        .join(User, User.id == Attendance.user_id)
        .where(Attendance.event_id == event_id)
        .order_by(Attendance.created_at)
    ).all()
    return [_attendance_read(attendance, attendance_user) for attendance, attendance_user in rows]


def read_attendance_with_user(session: Session, attendance_id: UUID) -> dict[str, object]:
    attendance, attendance_user = session.execute(
        select(Attendance, User)
        .join(User, User.id == Attendance.user_id)
        .where(Attendance.id == attendance_id)
    ).one()
    return _attendance_read(attendance, attendance_user)


def upsert_attendance(
    session: Session,
    event_id: UUID,
    target_user_id: UUID,
    user: User,
    status: AttendanceStatus,
    note: str | None,
) -> Attendance:
    event = _get_event(session, event_id)
    require_team_role(session, event.team_id, user.id, MembershipRole.captain)
    if event.status not in {EventStatus.published, EventStatus.completed}:
        raise AttendanceStateError("Attendance requires published or completed event")

    attendance = session.scalar(
        select(Attendance).where(Attendance.event_id == event_id, Attendance.user_id == target_user_id)
    )
    if attendance is None or event.status != EventStatus.completed:
        get_active_membership(session, event.team_id, target_user_id)

    if attendance is None:
        attendance = Attendance(
            event_id=event_id,
            user_id=target_user_id,
            status=status,
            recorded_by=user.id,
            note=note,
        )
        session.add(attendance)
        session.flush()
    else:
        attendance.status = status
        attendance.note = note
        attendance.recorded_by = user.id
        session.flush()

    if event.status == EventStatus.completed:
        reconcile_completed_attendance_reward(session, event, attendance, user.id)

    session.commit()
    session.refresh(attendance)
    return attendance


def _apply_completion_match_details(
    session: Session,
    event: Event,
    payload: EventCompletionRequest,
) -> None:
    if payload.match_details is None:
        return
    if event.type != EventType.match:
        raise AttendanceStateError("Only match events can include final match details")
    match_details = session.scalar(select(MatchDetails).where(MatchDetails.event_id == event.id))
    if match_details is None:
        raise AttendanceStateError("Match details are required before completing a match")
    match_update_data = payload.match_details.model_dump(exclude_unset=True)
    try:
        validate_match_score_result(
            match_update_data.get("team_score", match_details.team_score),
            match_update_data.get("opponent_score", match_details.opponent_score),
            match_update_data.get("result", match_details.result),
        )
    except ValueError as exc:
        raise AttendanceStateError(str(exc)) from exc
    for field, value in match_update_data.items():
        setattr(match_details, field, value)


def complete_event(
    session: Session,
    event_id: UUID,
    user: User,
    payload: EventCompletionRequest | None = None,
) -> dict[str, object]:
    completion_payload = payload or EventCompletionRequest()
    event = _get_event_for_completion(session, event_id)
    require_team_role(session, event.team_id, user.id, MembershipRole.captain)
    if event.status == EventStatus.completed:
        attendance_count = session.scalar(
            select(func.count()).select_from(Attendance).where(Attendance.event_id == event.id)
        ) or 0
        return {
            "event_id": event.id,
            "status": enum_value(event.status),
            "attendance_count": attendance_count,
            "reward_count": 0,
        }
    if event.status != EventStatus.published:
        raise AttendanceStateError("Only published events can be completed")

    _apply_completion_match_details(session, event, completion_payload)

    eligible_member_ids = session.scalars(
        select(TeamMembership.user_id).where(
            TeamMembership.team_id == event.team_id,
            TeamMembership.joined_at <= event.start_time,
            (
                (TeamMembership.status == MembershipStatus.active)
                | (
                    TeamMembership.left_at.is_not(None)
                    & (TeamMembership.left_at >= event.start_time)
                )
            ),
        )
    ).all()
    existing_user_ids = set(
        session.scalars(select(Attendance.user_id).where(Attendance.event_id == event.id)).all()
    )
    for member_id in eligible_member_ids:
        if member_id not in existing_user_ids:
            session.add(
                Attendance(
                    event_id=event.id,
                    user_id=member_id,
                    status=AttendanceStatus.absent,
                    recorded_by=user.id,
                    note="Auto-marked absent at completion",
                )
            )
    session.flush()

    reward_count = 0
    attendances = session.scalars(select(Attendance).where(Attendance.event_id == event.id)).all()
    for attendance in attendances:
        reward = issue_initial_attendance_reward(session, event, attendance, user.id)
        if reward is not None:
            reward_count += 1

    event.status = EventStatus.completed
    session.commit()
    return {
        "event_id": event.id,
        "status": enum_value(event.status),
        "attendance_count": len(attendances),
        "reward_count": reward_count,
    }


def attendance_board(
    session: Session,
    team_id: UUID,
    user: User,
    starts_after: datetime | None = None,
    starts_before: datetime | None = None,
) -> list[dict[str, object]]:
    get_active_membership(session, team_id, user.id)
    stmt = (
        select(
            Attendance.user_id,
            Attendance.status,
            func.count().label("count"),
        )
        .join(Event, Event.id == Attendance.event_id)
        .where(Event.team_id == team_id, Event.status == EventStatus.completed)
        .group_by(Attendance.user_id, Attendance.status)
    )
    if starts_after is not None:
        stmt = stmt.where(Event.start_time >= starts_after)
    if starts_before is not None:
        stmt = stmt.where(Event.start_time <= starts_before)

    rows = session.execute(stmt).all()
    user_ids = {user_id for user_id, _status, _count in rows}
    users_by_id = {
        row.id: row for row in session.scalars(select(User).where(User.id.in_(user_ids))).all()
    } if user_ids else {}
    board: dict[UUID, dict[str, object]] = {}
    for user_id, status, count in rows:
        row = board.setdefault(
            user_id,
            {
                "user_id": user_id,
                "user": _user_summary(users_by_id.get(user_id)),
                "present": 0,
                "late": 0,
                "absent": 0,
                "excused": 0,
                "total": 0,
                "attendance_rate": 0.0,
            },
        )
        row[enum_value(status)] = count
        row["total"] = cast(int, row["total"]) + count
    for row in board.values():
        total = cast(int, row["total"])
        attended = cast(int, row["present"]) + cast(int, row["late"])
        row["attendance_rate"] = round(attended / total, 4) if total > 0 else 0.0
    return sorted(board.values(), key=lambda row: (-cast(float, row["attendance_rate"]), str(row["user_id"])))

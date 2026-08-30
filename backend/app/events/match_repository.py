from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.enums import CoinTransactionType
from app.models import CoinTransaction, EventSignup, MatchLogEntry, TeamMembership


def get_log(session: Session, log_id: UUID) -> MatchLogEntry | None:
    return session.get(MatchLogEntry, log_id)


def list_logs(session: Session, event_id: UUID, after: UUID | None) -> list[MatchLogEntry]:
    stmt = select(MatchLogEntry).where(MatchLogEntry.event_id == event_id)
    if after is not None:
        after_log = get_log(session, after)
        if after_log is not None and after_log.event_id == event_id:
            stmt = stmt.where(
                (MatchLogEntry.minute > after_log.minute)
                | (
                    (MatchLogEntry.minute == after_log.minute)
                    & (MatchLogEntry.created_at > after_log.created_at)
                )
                | (
                    (MatchLogEntry.minute == after_log.minute)
                    & (MatchLogEntry.created_at == after_log.created_at)
                    & (MatchLogEntry.id > after_log.id)
                )
            )
    return list(
        session.scalars(
            stmt.order_by(MatchLogEntry.minute, MatchLogEntry.created_at, MatchLogEntry.id)
        )
    )


def list_member_signups(session: Session, event_id: UUID, team_id: UUID) -> list[EventSignup]:
    return list(
        session.scalars(
            select(EventSignup)
            .join(
                TeamMembership,
                (TeamMembership.team_id == team_id)
                & (TeamMembership.user_id == EventSignup.user_id),
            )
            .where(EventSignup.event_id == event_id, TeamMembership.role == "member")
        ).all()
    )


def list_signup_rewards(session: Session, team_id: UUID, event_id: UUID) -> list[CoinTransaction]:
    return list(
        session.scalars(
            select(CoinTransaction).where(
                CoinTransaction.team_id == team_id,
                CoinTransaction.type == CoinTransactionType.signup_reward,
                CoinTransaction.reference_type == "event",
                CoinTransaction.reference_id == event_id,
            )
        ).all()
    )


def add(session: Session, value: object) -> None:
    session.add(value)


def delete(session: Session, value: object) -> None:
    session.delete(value)


def refresh(session: Session, value: object) -> None:
    session.refresh(value)

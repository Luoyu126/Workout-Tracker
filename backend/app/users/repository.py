from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import User


def find_by_auth_id(session: Session, auth_id: UUID) -> User | None:
    return session.scalar(select(User).where(User.auth_id == auth_id))


def add(session: Session, user: User) -> None:
    session.add(user)


def refresh(session: Session, user: User) -> None:
    session.refresh(user)

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.auth import AuthClaims
from app.common.enums import UserStatus
from app.models import User
from app.users.schemas import UserSyncRequest, UserUpdateRequest


class DisabledUserError(Exception):
    pass


def get_user_by_auth_id(session: Session, claims: AuthClaims) -> User:
    user = session.scalar(select(User).where(User.auth_id == claims.auth_id))
    if user is None:
        raise LookupError("User not found")
    if user.status == UserStatus.disabled:
        raise DisabledUserError("User is disabled")
    return user


def sync_user(session: Session, claims: AuthClaims, payload: UserSyncRequest) -> User:
    user = session.scalar(select(User).where(User.auth_id == claims.auth_id))
    if user is None:
        user = User(
            auth_id=claims.auth_id,
            email=claims.email,
            name=payload.name,
            student_id=payload.student_id,
            avatar_url=payload.avatar_url,
            status=UserStatus.active,
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        return user

    if user.status == UserStatus.disabled:
        raise DisabledUserError("User is disabled")

    user.email = claims.email
    user.name = payload.name
    user.student_id = payload.student_id
    user.avatar_url = payload.avatar_url
    session.commit()
    session.refresh(user)
    return user


def update_user_profile(session: Session, user: User, payload: UserUpdateRequest) -> User:
    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(user, field, value)
    session.commit()
    session.refresh(user)
    return user

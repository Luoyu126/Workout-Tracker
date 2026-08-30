from sqlalchemy.orm import Session

from app.common.auth import AuthClaims
from app.common.enums import UserStatus
from app.common.transactions import transaction_boundary
from app.models import User
from app.users import repository
from app.users.errors import DisabledUserError, UserNotSyncedError
from app.users.schemas import UserSyncRequest, UserUpdateRequest


def get_user_by_auth_id(session: Session, claims: AuthClaims) -> User:
    user = repository.find_by_auth_id(session, claims.auth_id)
    if user is None:
        raise UserNotSyncedError()
    if user.status == UserStatus.disabled:
        raise DisabledUserError("User is disabled")
    return user


def sync_user(session: Session, claims: AuthClaims, payload: UserSyncRequest) -> User:
    with transaction_boundary(session):
        user = repository.find_by_auth_id(session, claims.auth_id)
        if user is None:
            user = User(
                auth_id=claims.auth_id,
                email=claims.email,
                name=payload.name,
                student_id=payload.student_id,
                avatar_url=payload.avatar_url,
                status=UserStatus.active,
            )
            repository.add(session, user)
        else:
            if user.status == UserStatus.disabled:
                raise DisabledUserError()
            user.email = claims.email
            user.name = payload.name
            user.student_id = payload.student_id
            user.avatar_url = payload.avatar_url
    repository.refresh(session, user)
    return user


def update_user_profile(session: Session, user: User, payload: UserUpdateRequest) -> User:
    with transaction_boundary(session):
        update_data = payload.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(user, field, value)
    repository.refresh(session, user)
    return user

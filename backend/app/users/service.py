from sqlalchemy.orm import Session

from app.common.auth import AuthClaims
from app.common.enums import UserStatus
from app.common.transactions import transaction_boundary
from app.config import Settings, get_settings
from app.models import User
from app.users import auth_admin, repository
from app.users.errors import (
    AuthAccountNotFoundError,
    DisabledUserError,
    PasswordResetUnavailableError,
    UserNotSyncedError,
)
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


def reset_initial_password(email: str, settings: Settings | None = None) -> None:
    resolved_settings = settings or get_settings()
    password = resolved_settings.normalized_initial_login_password
    admin_key = resolved_settings.auth_admin_key
    issuer = resolved_settings.jwt_issuer
    if password is None or admin_key is None or issuer is None:
        raise PasswordResetUnavailableError()
    user_id = auth_admin.find_user_id_by_email(issuer, admin_key, email)
    if user_id is None:
        raise AuthAccountNotFoundError()
    auth_admin.update_user_password(issuer, admin_key, user_id, password)


def update_user_profile(session: Session, user: User, payload: UserUpdateRequest) -> User:
    with transaction_boundary(session):
        update_data = payload.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(user, field, value)
    repository.refresh(session, user)
    return user

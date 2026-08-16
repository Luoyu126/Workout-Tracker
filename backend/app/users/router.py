from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.common.auth import AuthClaims, get_auth_claims
from app.common.database import get_db
from app.models import User
from app.users.schemas import UserRead, UserSyncRequest, UserUpdateRequest
from app.users.service import DisabledUserError, get_user_by_auth_id, sync_user, update_user_profile

router = APIRouter(prefix="/api/v1", tags=["users"])


def current_user(
    claims: AuthClaims = Depends(get_auth_claims),
    session: Session = Depends(get_db),
) -> User:
    try:
        return get_user_by_auth_id(session, claims)
    except LookupError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "USER_NOT_SYNCED", "message": "User has not been synced"},
        ) from exc
    except DisabledUserError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "USER_DISABLED", "message": "User is disabled"},
        ) from exc


@router.post("/auth/sync", response_model=UserRead)
def sync_current_user(
    payload: UserSyncRequest,
    claims: AuthClaims = Depends(get_auth_claims),
    session: Session = Depends(get_db),
) -> User:
    try:
        return sync_user(session, claims, payload)
    except DisabledUserError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "USER_DISABLED", "message": "User is disabled"},
        ) from exc


@router.get("/users/me", response_model=UserRead)
def read_current_user(user: User = Depends(current_user)) -> User:
    return user


@router.patch("/users/me", response_model=UserRead)
def update_current_user(
    payload: UserUpdateRequest,
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> User:
    return update_user_profile(session, user, payload)

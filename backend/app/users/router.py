from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.common.auth import AuthClaims, get_auth_claims
from app.common.database import get_db
from app.common.dependencies import current_user
from app.models import User
from app.users.schemas import UserRead, UserSyncRequest, UserUpdateRequest
from app.users.service import sync_user, update_user_profile

router = APIRouter(prefix="/api/v1", tags=["users"])


@router.post("/auth/sync", response_model=UserRead)
def sync_current_user(
    payload: UserSyncRequest,
    claims: AuthClaims = Depends(get_auth_claims),
    session: Session = Depends(get_db),
) -> User:
    return sync_user(session, claims, payload)


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

from fastapi import Depends
from sqlalchemy.orm import Session

from app.common.auth import AuthClaims, get_auth_claims
from app.common.database import get_db
from app.models import User
from app.users.service import get_user_by_auth_id


def current_user(
    claims: AuthClaims = Depends(get_auth_claims),
    session: Session = Depends(get_db),
) -> User:
    return get_user_by_auth_id(session, claims)

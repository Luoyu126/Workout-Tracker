from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.common.database import get_db
from app.models import Organization, User
from app.organizations.schemas import OrganizationRead
from app.organizations.service import list_my_organizations
from app.users.router import current_user

router = APIRouter(prefix="/api/v1", tags=["organizations"])


@router.get("/organizations", response_model=list[OrganizationRead])
def read_my_organizations(
    user: User = Depends(current_user),
    session: Session = Depends(get_db),
) -> list[Organization]:
    return list_my_organizations(session, user)

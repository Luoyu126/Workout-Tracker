from sqlalchemy.orm import Session

from app.models import Organization, User
from app.organizations import repository


def list_my_organizations(session: Session, user: User) -> list[Organization]:
    return repository.list_for_user(session, user.id)

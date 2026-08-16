from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class OrganizationRead(BaseModel):
    id: UUID
    name: str
    slug: str
    logo_url: str | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

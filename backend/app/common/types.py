import uuid
from typing import Literal

from sqlalchemy import JSON
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.types import Uuid

JSONBType = JSON().with_variant(JSONB, "postgresql")


def UUID(as_uuid: Literal[True] = True) -> Uuid[uuid.UUID]:
    return Uuid(as_uuid=as_uuid)

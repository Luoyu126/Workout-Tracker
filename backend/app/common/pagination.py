from pydantic import BaseModel, Field


class PageParams(BaseModel):
    cursor: str | None = None
    limit: int = Field(default=20, ge=1, le=100)


class Page[T](BaseModel):
    items: list[T]
    next_cursor: str | None = None

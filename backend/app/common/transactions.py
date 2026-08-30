from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy.orm import Session


@contextmanager
def transaction_boundary(session: Session) -> Iterator[None]:
    """Own the single commit/rollback boundary for one application use case."""

    try:
        yield
        session.commit()
    except Exception:
        session.rollback()
        raise

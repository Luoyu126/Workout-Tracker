import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.orm import Session

from app.common.database import SessionLocal
from app.common.errors import AppError
from app.common.logging import get_app_logger
from app.config import Settings
from app.events.service import complete_due_event, list_due_event_ids

SessionFactory = Callable[[], Session]


@dataclass(frozen=True)
class EventCompletionSweepResult:
    candidates: int
    completed: int
    skipped: int
    failed: int


def run_event_completion_sweep(
    settings: Settings,
    *,
    due_at: datetime | None = None,
    session_factory: SessionFactory = SessionLocal,
) -> EventCompletionSweepResult:
    cutoff = due_at or datetime.now(UTC)
    with session_factory() as discovery_session:
        event_ids = list_due_event_ids(
            discovery_session,
            cutoff,
            settings.event_completion_batch_size,
        )

    completed = 0
    skipped = 0
    failed = 0
    logger = get_app_logger()
    for event_id in event_ids:
        try:
            with session_factory() as event_session:
                result = complete_due_event(event_session, event_id, cutoff)
            if result is None:
                skipped += 1
            else:
                completed += 1
        except Exception as exc:
            failed += 1
            _log_completion_failure(logger, event_id, exc)

    if event_ids:
        logger.info(
            "Due event completion sweep finished",
            extra={
                "operation": "events.complete_due_sweep",
                "context": {
                    "cutoff": cutoff.isoformat(),
                    "candidates": len(event_ids),
                    "completed": completed,
                    "skipped": skipped,
                    "failed": failed,
                },
            },
        )
    return EventCompletionSweepResult(
        candidates=len(event_ids),
        completed=completed,
        skipped=skipped,
        failed=failed,
    )


def _log_completion_failure(logger: logging.Logger, event_id: UUID, exc: Exception) -> None:
    extra = {
        "operation": "events.complete_due_event",
        "error_code": exc.code if isinstance(exc, AppError) else "EVENT_COMPLETION_FAILED",
        "exception_type": type(exc).__name__,
        "context": {"event_id": str(event_id)},
    }
    if isinstance(exc, AppError):
        logger.warning(exc.message, extra=extra)
    else:
        logger.exception(
            "Automatic event completion failed",
            exc_info=exc,
            extra=extra,
        )


async def _run_sweep_without_interrupting_transaction(settings: Settings) -> None:
    sweep_task = asyncio.create_task(asyncio.to_thread(run_event_completion_sweep, settings))
    try:
        await asyncio.shield(sweep_task)
    except asyncio.CancelledError:
        await sweep_task
        raise


async def run_event_completion_worker(settings: Settings) -> None:
    logger = get_app_logger()
    logger.info(
        "Event completion worker started",
        extra={
            "operation": "events.completion_worker",
            "context": {
                "poll_seconds": settings.event_completion_poll_seconds,
                "batch_size": settings.event_completion_batch_size,
            },
        },
    )
    try:
        while True:
            try:
                await _run_sweep_without_interrupting_transaction(settings)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.exception(
                    "Event completion sweep failed",
                    exc_info=exc,
                    extra={
                        "operation": "events.complete_due_sweep",
                        "error_code": "EVENT_COMPLETION_SWEEP_FAILED",
                        "exception_type": type(exc).__name__,
                    },
                )
            await asyncio.sleep(settings.event_completion_poll_seconds)
    finally:
        logger.info(
            "Event completion worker stopped",
            extra={"operation": "events.completion_worker"},
        )

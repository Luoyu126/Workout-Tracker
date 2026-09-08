import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.coins.router import router as coins_router
from app.common.exception_handlers import register_exception_handlers
from app.common.logging import configure_logging
from app.common.request_context import RequestContextMiddleware
from app.config import get_settings
from app.events.match_router import router as match_router
from app.events.router import router as events_router
from app.events.worker import run_event_completion_worker
from app.notifications.router import router as notifications_router
from app.organizations.router import router as organizations_router
from app.store.router import router as store_router
from app.teams.router import router as teams_router
from app.users.router import router as users_router


def create_app() -> FastAPI:
    settings = get_settings()
    settings.validate_runtime_configuration()
    configure_logging(settings)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        worker_task: asyncio.Task[None] | None = None
        if settings.event_completion_worker_enabled:
            worker_task = asyncio.create_task(
                run_event_completion_worker(settings),
                name="event-completion-worker",
            )
        try:
            yield
        finally:
            if worker_task is not None:
                worker_task.cancel()
                with suppress(asyncio.CancelledError):
                    await worker_task

    app = FastAPI(
        title="Workout Tracker API",
        version="0.1.0",
        docs_url="/docs" if settings.normalized_app_env != "production" else None,
        redoc_url="/redoc" if settings.normalized_app_env != "production" else None,
        lifespan=lifespan,
    )
    register_exception_handlers(app)
    app.add_middleware(RequestContextMiddleware)
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    @app.get("/health", tags=["system"])
    def health() -> dict[str, str]:
        return {"status": "ok", "env": settings.normalized_app_env}

    app.include_router(users_router)
    app.include_router(organizations_router)
    app.include_router(teams_router)
    app.include_router(events_router)
    app.include_router(match_router)
    app.include_router(coins_router)
    app.include_router(store_router)
    app.include_router(notifications_router)

    return app


app = create_app()

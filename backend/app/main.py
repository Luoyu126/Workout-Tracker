from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.attendance.router import router as attendance_router
from app.coins.router import router as coins_router
from app.config import get_settings
from app.events.match_router import router as match_router
from app.events.router import router as events_router
from app.notifications.router import router as notifications_router
from app.organizations.router import router as organizations_router
from app.store.router import router as store_router
from app.teams.router import router as teams_router
from app.users.router import router as users_router


def create_app() -> FastAPI:
    settings = get_settings()
    settings.validate_runtime_configuration()
    app = FastAPI(
        title="Workout Tracker API",
        version="0.1.0",
        docs_url="/docs" if settings.normalized_app_env != "production" else None,
        redoc_url="/redoc" if settings.normalized_app_env != "production" else None,
    )
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
    app.include_router(attendance_router)
    app.include_router(coins_router)
    app.include_router(store_router)
    app.include_router(notifications_router)

    return app


app = create_app()

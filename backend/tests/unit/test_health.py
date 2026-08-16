from app.main import create_app


def test_health_check() -> None:
    app = create_app()
    route = next(route for route in app.routes if getattr(route, "path", None) == "/health")

    response = route.endpoint()

    assert response["status"] == "ok"


def test_production_app_startup_requires_jwt_configuration(monkeypatch) -> None:
    import app.main as main_module
    from app.config import Settings

    monkeypatch.setattr(main_module, "get_settings", lambda: Settings(APP_ENV="production"))

    try:
        create_app()
    except RuntimeError as exc:
        assert "SUPABASE_JWT_SECRET or SUPABASE_JWT_JWKS_URL" in str(exc)
    else:
        raise AssertionError("production app startup should fail without JWT verification settings")


def test_production_app_startup_treats_app_env_case_insensitively(monkeypatch) -> None:
    import app.main as main_module
    from app.config import Settings

    monkeypatch.setattr(main_module, "get_settings", lambda: Settings(APP_ENV=" Production "))

    try:
        create_app()
    except RuntimeError as exc:
        assert "SUPABASE_JWT_SECRET or SUPABASE_JWT_JWKS_URL" in str(exc)
    else:
        raise AssertionError("production app startup should fail regardless of APP_ENV casing")


def test_production_app_startup_rejects_blank_jwt_configuration(monkeypatch) -> None:
    import app.main as main_module
    from app.config import Settings

    monkeypatch.setattr(
        main_module,
        "get_settings",
        lambda: Settings(APP_ENV=" production ", SUPABASE_JWT_SECRET="   ", SUPABASE_JWT_JWKS_URL="   "),
    )

    try:
        create_app()
    except RuntimeError as exc:
        assert "SUPABASE_JWT_SECRET or SUPABASE_JWT_JWKS_URL" in str(exc)
    else:
        raise AssertionError("production app startup should fail with blank JWT verification settings")


def test_production_app_startup_rejects_documentation_placeholder_jwt_configuration(monkeypatch) -> None:
    import app.main as main_module
    from app.config import Settings

    monkeypatch.setattr(
        main_module,
        "get_settings",
        lambda: Settings(
            APP_ENV="production",
            SUPABASE_JWT_SECRET="<your-supabase-jwt-secret>",
            SUPABASE_JWT_JWKS_URL="https://your-project.supabase.co/auth/v1/.well-known/jwks.json",
        ),
    )

    try:
        create_app()
    except RuntimeError as exc:
        assert "documentation placeholder value" in str(exc)
        assert "SUPABASE_JWT_SECRET" in str(exc)
    else:
        raise AssertionError("production app startup should reject JWT documentation placeholder settings")


def test_production_app_startup_rejects_wildcard_cors(monkeypatch) -> None:
    import app.main as main_module
    from app.config import Settings

    monkeypatch.setattr(
        main_module,
        "get_settings",
        lambda: Settings(
            APP_ENV="production",
            SUPABASE_JWT_SECRET="secret",
            CORS_ALLOWED_ORIGINS="https://app.example.test,*",
        ),
    )

    try:
        create_app()
    except RuntimeError as exc:
        assert "CORS_ALLOWED_ORIGINS" in str(exc)
        assert "wildcard" in str(exc)
    else:
        raise AssertionError("production app startup should fail with wildcard CORS origins")


def test_production_app_starts_with_jwt_configuration_and_disables_docs(monkeypatch) -> None:
    import app.main as main_module
    from app.config import Settings

    monkeypatch.setattr(
        main_module,
        "get_settings",
        lambda: Settings(APP_ENV="production", SUPABASE_JWT_SECRET="secret"),
    )

    app = create_app()
    paths = {getattr(route, "path", None) for route in app.routes}
    health_route = next(route for route in app.routes if getattr(route, "path", None) == "/health")

    assert health_route.endpoint()["env"] == "production"
    assert "/docs" not in paths
    assert "/redoc" not in paths


def test_local_app_installs_configured_cors_middleware(monkeypatch) -> None:
    import app.main as main_module
    from app.config import Settings

    monkeypatch.setattr(
        main_module,
        "get_settings",
        lambda: Settings(CORS_ALLOWED_ORIGINS=" http://localhost:8081, http://127.0.0.1:19006 "),
    )

    app = create_app()

    cors_middleware = next(
        middleware for middleware in app.user_middleware if middleware.cls.__name__ == "CORSMiddleware"
    )
    assert cors_middleware.kwargs["allow_origins"] == [
        "http://localhost:8081",
        "http://127.0.0.1:19006",
    ]
    assert cors_middleware.kwargs["allow_credentials"] is True

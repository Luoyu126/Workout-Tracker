from app.config import Settings
from scripts.check_release_env import release_env_problems


def test_backend_release_env_check_rejects_local_or_unverified_production_config() -> None:
    problems = release_env_problems(
        Settings(
            APP_ENV="local",
            DATABASE_URL="postgresql+psycopg://postgres:postgres@localhost:5432/workout_tracker",
            SUPABASE_JWT_SECRET="",
            SUPABASE_JWT_JWKS_URL="",
            CORS_ALLOWED_ORIGINS="https://app.example.test,*",
        ),
        "production",
    )

    assert "APP_ENV must be production" in "\n".join(problems)
    assert "DATABASE_URL must not point at a local database host" in "\n".join(problems)
    assert "SUPABASE_JWT_SECRET or SUPABASE_JWT_JWKS_URL is required" in "\n".join(problems)
    assert "CORS_ALLOWED_ORIGINS must not contain wildcard" in "\n".join(problems)


def test_backend_release_env_check_rejects_malformed_release_urls() -> None:
    problems = release_env_problems(
        Settings(
            APP_ENV="production",
            DATABASE_URL="not-a-database-url",
            SUPABASE_JWT_JWKS_URL="http://project.supabase.co/auth/v1/.well-known/jwks.json",
            CORS_ALLOWED_ORIGINS="https://,app.example.test",
        ),
        "production",
    )

    assert "DATABASE_URL must include a database hostname" in "\n".join(problems)
    assert "SUPABASE_JWT_JWKS_URL must be a valid HTTPS URL" in "\n".join(problems)
    assert "CORS_ALLOWED_ORIGINS must use valid HTTPS origins" in "\n".join(problems)


def test_backend_release_env_check_rejects_documentation_placeholder_jwt_config() -> None:
    problems = release_env_problems(
        Settings(
            APP_ENV="production",
            DATABASE_URL="postgresql+psycopg://app:secret@db.example.test:5432/workout_tracker",
            SUPABASE_JWT_SECRET="<your-supabase-jwt-secret>",
            SUPABASE_JWT_JWKS_URL="https://your-project.supabase.co/auth/v1/.well-known/jwks.json",
            CORS_ALLOWED_ORIGINS="https://app.example.test",
        ),
        "production",
    )

    assert "SUPABASE_JWT_SECRET must not use a documentation placeholder value" in "\n".join(problems)
    assert "SUPABASE_JWT_JWKS_URL must not use a documentation placeholder value" in "\n".join(problems)


def test_backend_release_env_check_rejects_database_and_cors_documentation_placeholders() -> None:
    problems = release_env_problems(
        Settings(
            APP_ENV="production",
            DATABASE_URL="postgresql+psycopg://app:secret@your-db.example.test:5432/workout_tracker",
            SUPABASE_JWT_JWKS_URL="https://project.supabase.co/auth/v1/.well-known/jwks.json",
            CORS_ALLOWED_ORIGINS="https://your-app.example.test",
        ),
        "production",
    )

    assert "DATABASE_URL must not use a documentation placeholder value" in "\n".join(problems)
    assert "CORS_ALLOWED_ORIGINS must not use documentation placeholder values" in "\n".join(problems)


def test_backend_release_env_check_accepts_https_production_config_and_skips_development() -> None:
    production_settings = Settings(
        APP_ENV="production",
        DATABASE_URL="postgresql+psycopg://app:secret@db.example.test:5432/workout_tracker",
        SUPABASE_JWT_JWKS_URL="https://project.supabase.co/auth/v1/.well-known/jwks.json",
        CORS_ALLOWED_ORIGINS="https://preview.example.test,https://app.example.test",
    )
    local_settings = Settings(
        APP_ENV="local",
        DATABASE_URL="postgresql+psycopg://postgres:postgres@localhost:5432/workout_tracker",
        CORS_ALLOWED_ORIGINS="http://localhost:8081",
    )

    assert release_env_problems(production_settings, "production") == []
    assert release_env_problems(local_settings, "development") == []

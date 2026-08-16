from __future__ import annotations

import sys
from urllib.parse import urlparse

from app.config import Settings, get_settings

LOCAL_DATABASE_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0"}
PLACEHOLDER_JWT_SECRETS = {"your-supabase-jwt-secret", "supabase-jwt-secret", "jwt-secret"}


def _non_blank(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _database_host(database_url: str) -> str | None:
    parsed_url = urlparse(database_url)
    return parsed_url.hostname


def _is_placeholder_value(value: str | None) -> bool:
    normalized_value = _non_blank(value)
    if normalized_value is None:
        return False
    normalized_value = normalized_value.removeprefix("<").removesuffix(">").strip().lower()
    parsed_url = urlparse(normalized_value)
    hostname = parsed_url.hostname or ""
    return (
        normalized_value.startswith("your-")
        or normalized_value.endswith("-placeholder")
        or "placeholder" in normalized_value
        or hostname.startswith("your-")
        or ".your-" in hostname
    )


def _is_placeholder_jwt_secret(value: str | None) -> bool:
    normalized_value = _non_blank(value)
    if normalized_value is None:
        return False
    normalized_value = normalized_value.removeprefix("<").removesuffix(">").strip().lower()
    return normalized_value in PLACEHOLDER_JWT_SECRETS or _is_placeholder_value(value)


def release_env_problems(settings: Settings, profile: str) -> list[str]:
    normalized_profile = profile.strip().lower()
    if normalized_profile in {"development", "local"}:
        return []

    problems: list[str] = []
    if settings.normalized_app_env != "production":
        problems.append("APP_ENV must be production for release-like backend environments")

    database_url = _non_blank(settings.database_url)
    if database_url is None:
        problems.append("DATABASE_URL is required")
    else:
        if _is_placeholder_value(database_url):
            problems.append("DATABASE_URL must not use a documentation placeholder value")
        database_host = _database_host(database_url)
        if database_host is None:
            problems.append("DATABASE_URL must include a database hostname")
        elif database_host in LOCAL_DATABASE_HOSTS:
            problems.append("DATABASE_URL must not point at a local database host for release-like environments")

    if not (settings.jwt_secret or settings.jwt_jwks_url):
        problems.append("SUPABASE_JWT_SECRET or SUPABASE_JWT_JWKS_URL is required")
    if _is_placeholder_jwt_secret(settings.jwt_secret):
        problems.append("SUPABASE_JWT_SECRET must not use a documentation placeholder value")
    if _is_placeholder_value(settings.jwt_jwks_url):
        problems.append("SUPABASE_JWT_JWKS_URL must not use a documentation placeholder value")
    if settings.jwt_jwks_url:
        parsed_jwks_url = urlparse(settings.jwt_jwks_url)
        if parsed_jwks_url.scheme != "https" or not parsed_jwks_url.netloc:
            problems.append("SUPABASE_JWT_JWKS_URL must be a valid HTTPS URL")

    if "*" in settings.cors_origins:
        problems.append("CORS_ALLOWED_ORIGINS must not contain wildcard '*'")
    if not settings.cors_origins:
        problems.append("CORS_ALLOWED_ORIGINS must include at least one exact frontend origin")
    for origin in settings.cors_origins:
        if _is_placeholder_value(origin):
            problems.append("CORS_ALLOWED_ORIGINS must not use documentation placeholder values")
            break
        parsed_origin = urlparse(origin)
        if parsed_origin.scheme != "https" or not parsed_origin.netloc:
            problems.append("CORS_ALLOWED_ORIGINS must use valid HTTPS origins for release-like environments")
            break

    return problems


def main() -> int:
    profile = sys.argv[1] if len(sys.argv) > 1 else "production"
    problems = release_env_problems(get_settings(), profile)
    if problems:
        print(f"Backend release environment check failed for {profile}:", file=sys.stderr)
        for problem in problems:
            print(f"- {problem}", file=sys.stderr)
        return 1

    print(f"Backend release environment check passed for {profile}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

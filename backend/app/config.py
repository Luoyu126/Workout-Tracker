from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

PLACEHOLDER_JWT_SECRETS = {"your-supabase-jwt-secret", "supabase-jwt-secret", "jwt-secret"}


class Settings(BaseSettings):
    app_env: str = Field(default="local", alias="APP_ENV")
    database_url: str = Field(
        default="postgresql+psycopg://postgres:postgres@localhost:5432/workout_tracker",
        alias="DATABASE_URL",
    )
    supabase_jwt_issuer: str | None = Field(default=None, alias="SUPABASE_JWT_ISSUER")
    supabase_jwt_audience: str = Field(default="authenticated", alias="SUPABASE_JWT_AUDIENCE")
    supabase_jwt_jwks_url: str | None = Field(default=None, alias="SUPABASE_JWT_JWKS_URL")
    supabase_jwt_secret: str | None = Field(default=None, alias="SUPABASE_JWT_SECRET")
    bootstrap_org_name: str = Field(default="Campus Club", alias="BOOTSTRAP_ORG_NAME")
    bootstrap_org_slug: str = Field(default="campus-club", alias="BOOTSTRAP_ORG_SLUG")
    bootstrap_team_name: str = Field(default="Campus Football", alias="BOOTSTRAP_TEAM_NAME")
    bootstrap_admin_auth_id: str | None = Field(default=None, alias="BOOTSTRAP_ADMIN_AUTH_ID")
    bootstrap_admin_email: str | None = Field(default=None, alias="BOOTSTRAP_ADMIN_EMAIL")
    bootstrap_admin_name: str = Field(default="Admin", alias="BOOTSTRAP_ADMIN_NAME")
    bootstrap_training_reward: int = Field(default=10, alias="BOOTSTRAP_TRAINING_REWARD")
    bootstrap_match_reward: int = Field(default=20, alias="BOOTSTRAP_MATCH_REWARD")
    push_notifications_enabled: bool = Field(default=False, alias="PUSH_NOTIFICATIONS_ENABLED")
    expo_push_endpoint: str = Field(
        default="https://exp.host/--/api/v2/push/send",
        alias="EXPO_PUSH_ENDPOINT",
    )
    expo_push_timeout_seconds: float = Field(default=5.0, alias="EXPO_PUSH_TIMEOUT_SECONDS")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    log_dir: str = Field(default="backend/logs", alias="LOG_DIR")
    log_max_bytes: int = Field(default=10_485_760, alias="LOG_MAX_BYTES")
    log_backup_count: int = Field(default=5, alias="LOG_BACKUP_COUNT")
    cors_allowed_origins: str = Field(
        default="http://localhost:8081,http://localhost:19006,http://127.0.0.1:8081,http://127.0.0.1:19006",
        alias="CORS_ALLOWED_ORIGINS",
    )

    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    @staticmethod
    def _non_blank(value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @property
    def normalized_app_env(self) -> str:
        return self.app_env.strip().lower()

    @property
    def jwt_secret(self) -> str | None:
        return self._non_blank(self.supabase_jwt_secret)

    @property
    def jwt_jwks_url(self) -> str | None:
        return self._non_blank(self.supabase_jwt_jwks_url)

    @property
    def jwt_issuer(self) -> str | None:
        return self._non_blank(self.supabase_jwt_issuer)

    @property
    def cors_origins(self) -> list[str]:
        return [
            origin
            for origin in (self._non_blank(value) for value in self.cors_allowed_origins.split(","))
            if origin is not None
        ]

    @staticmethod
    def _is_placeholder_value(value: str | None) -> bool:
        normalized_value = Settings._non_blank(value)
        if normalized_value is None:
            return False
        normalized_value = normalized_value.removeprefix("<").removesuffix(">").strip().lower()
        return (
            normalized_value.startswith("your-")
            or normalized_value.endswith("-placeholder")
            or "placeholder" in normalized_value
            or "://your-" in normalized_value
            or ".your-" in normalized_value
        )

    @classmethod
    def _is_placeholder_jwt_secret(cls, value: str | None) -> bool:
        normalized_value = cls._non_blank(value)
        if normalized_value is None:
            return False
        normalized_value = normalized_value.removeprefix("<").removesuffix(">").strip().lower()
        return normalized_value in PLACEHOLDER_JWT_SECRETS or cls._is_placeholder_value(value)

    def validate_runtime_configuration(self) -> None:
        if self.normalized_app_env == "production" and not (self.jwt_secret or self.jwt_jwks_url):
            raise RuntimeError(
                "Production requires SUPABASE_JWT_SECRET or SUPABASE_JWT_JWKS_URL"
            )
        if self.normalized_app_env == "production" and self._is_placeholder_jwt_secret(self.jwt_secret):
            raise RuntimeError("Production SUPABASE_JWT_SECRET must not use a documentation placeholder value")
        if self.normalized_app_env == "production" and self._is_placeholder_value(self.jwt_jwks_url):
            raise RuntimeError("Production SUPABASE_JWT_JWKS_URL must not use a documentation placeholder value")
        if self.normalized_app_env == "production" and "*" in self.cors_origins:
            raise RuntimeError("Production CORS_ALLOWED_ORIGINS must not contain wildcard '*'")


@lru_cache
def get_settings() -> Settings:
    return Settings()

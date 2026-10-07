from app.config import Settings
from app.users import auth_admin
from app.users.errors import AuthAccountNotFoundError, PasswordResetUnavailableError
from app.users.service import reset_initial_password


def _settings() -> Settings:
    return Settings(
        SUPABASE_JWT_ISSUER="https://project.supabase.co/auth/v1",
        SUPABASE_SECRET_KEY="service-role",
        INITIAL_LOGIN_PASSWORD="initial-secret",
    )


def test_reset_sets_the_configured_password_for_the_matching_account(monkeypatch) -> None:
    updated: dict[str, str] = {}

    def find_user_id(issuer: str, admin_key: str, email: str) -> str:
        assert issuer == "https://project.supabase.co/auth/v1"
        assert admin_key == "service-role"
        assert email == "player@example.com"
        return "user-1"

    def update_password(issuer: str, admin_key: str, user_id: str, password: str) -> None:
        updated["issuer"] = issuer
        updated["admin_key"] = admin_key
        updated["user_id"] = user_id
        updated["password"] = password

    monkeypatch.setattr(auth_admin, "find_user_id_by_email", find_user_id)
    monkeypatch.setattr(auth_admin, "update_user_password", update_password)

    reset_initial_password("player@example.com", _settings())

    assert updated == {
        "issuer": "https://project.supabase.co/auth/v1",
        "admin_key": "service-role",
        "user_id": "user-1",
        "password": "initial-secret",
    }


def test_reset_reports_a_missing_account_without_changing_a_password(monkeypatch) -> None:
    monkeypatch.setattr(auth_admin, "find_user_id_by_email", lambda *_args: None)

    try:
        reset_initial_password("missing@example.com", _settings())
    except AuthAccountNotFoundError as exc:
        assert exc.code == "AUTH_ACCOUNT_NOT_FOUND"
        assert "initial-secret" not in exc.message
    else:
        raise AssertionError("expected missing account")


def test_reset_is_unavailable_when_the_initial_password_is_not_configured() -> None:
    settings = Settings(
        SUPABASE_JWT_ISSUER="https://project.supabase.co/auth/v1",
        SUPABASE_SECRET_KEY="service-role",
        INITIAL_LOGIN_PASSWORD="   ",
    )

    try:
        reset_initial_password("player@example.com", settings)
    except PasswordResetUnavailableError as exc:
        assert exc.code == "PASSWORD_RESET_UNAVAILABLE"
    else:
        raise AssertionError("expected unavailable reset")


def test_auth_lookup_matches_the_email_exactly() -> None:
    def request(method: str, url: str, admin_key: str, body: dict[str, str] | None) -> dict[str, object]:
        assert method == "GET"
        assert "filter=player%40example.com" in url
        assert admin_key == "service-role"
        assert body is None
        return {
            "users": [
                {"id": "other", "email": "player@example.com.invalid"},
                {"id": "user-1", "email": "Player@Example.com"},
            ]
        }

    user_id = auth_admin.find_user_id_by_email(
        "https://project.supabase.co/auth/v1",
        "service-role",
        "player@example.com",
        request=request,
    )

    assert user_id == "user-1"

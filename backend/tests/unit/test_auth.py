from uuid import uuid4

import jwt
import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.common.auth import _decode_token, get_auth_claims
from app.config import Settings


def test_decode_hs256_supabase_token() -> None:
    auth_id = uuid4()
    token = jwt.encode(
        {"sub": str(auth_id), "email": "player@example.com", "aud": "authenticated"},
        "secret",
        algorithm="HS256",
    )
    settings = Settings(SUPABASE_JWT_SECRET="secret")

    payload = _decode_token(token, settings)

    assert payload["sub"] == str(auth_id)
    assert payload["email"] == "player@example.com"


def test_decode_hs256_supabase_token_strips_secret_and_issuer() -> None:
    auth_id = uuid4()
    token = jwt.encode(
        {
            "sub": str(auth_id),
            "email": "player@example.com",
            "aud": "authenticated",
            "iss": "https://project.supabase.co/auth/v1",
        },
        "secret",
        algorithm="HS256",
    )
    settings = Settings(
        SUPABASE_JWT_SECRET="  secret  ",
        SUPABASE_JWT_ISSUER="  https://project.supabase.co/auth/v1  ",
    )

    payload = _decode_token(token, settings)

    assert payload["sub"] == str(auth_id)
    assert payload["email"] == "player@example.com"


def test_local_mode_allows_unverified_jwt_for_development() -> None:
    token = jwt.encode({"sub": str(uuid4()), "email": "player@example.com"}, "dev")
    settings = Settings(APP_ENV="local")

    payload = _decode_token(token, settings)

    assert payload["email"] == "player@example.com"


def test_production_requires_jwt_configuration() -> None:
    settings = Settings(APP_ENV="production")

    with pytest.raises(HTTPException) as exc_info:
        _decode_token("token", settings)

    assert exc_info.value.status_code == 500


def test_production_treats_blank_jwt_configuration_as_missing() -> None:
    settings = Settings(APP_ENV=" production ", SUPABASE_JWT_SECRET="   ", SUPABASE_JWT_JWKS_URL="   ")

    with pytest.raises(HTTPException) as exc_info:
        _decode_token("token", settings)

    assert exc_info.value.status_code == 500


def test_get_auth_claims_requires_bearer_credentials() -> None:
    with pytest.raises(HTTPException) as exc_info:
        get_auth_claims(None, Settings(APP_ENV="local"))

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail["code"] == "UNAUTHENTICATED"


def test_get_auth_claims_rejects_tokens_missing_required_claims() -> None:
    token = jwt.encode({"sub": str(uuid4())}, "dev")

    with pytest.raises(HTTPException) as exc_info:
        get_auth_claims(
            HTTPAuthorizationCredentials(scheme="Bearer", credentials=token),
            Settings(APP_ENV="local"),
        )

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail["code"] == "INVALID_TOKEN"


def test_get_auth_claims_rejects_wrong_audience_even_with_valid_secret() -> None:
    token = jwt.encode(
        {"sub": str(uuid4()), "email": "player@example.com", "aud": "wrong-audience"},
        "secret",
        algorithm="HS256",
    )

    with pytest.raises(HTTPException) as exc_info:
        get_auth_claims(
            HTTPAuthorizationCredentials(scheme="Bearer", credentials=token),
            Settings(SUPABASE_JWT_SECRET="secret"),
        )

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail["code"] == "INVALID_TOKEN"

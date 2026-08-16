from dataclasses import dataclass
from typing import cast
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

from app.config import Settings, get_settings

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class AuthClaims:
    auth_id: UUID
    email: str


def _decode_token(token: str, settings: Settings) -> dict[str, object]:
    jwt_secret = settings.jwt_secret
    jwt_jwks_url = settings.jwt_jwks_url
    jwt_issuer = settings.jwt_issuer
    if jwt_secret:
        return cast(
            dict[str, object],
            jwt.decode(
                token,
                jwt_secret,
                algorithms=["HS256"],
                audience=settings.supabase_jwt_audience,
                issuer=jwt_issuer,
                options={"verify_iss": jwt_issuer is not None},
            ),
        )

    if jwt_jwks_url:
        jwks_client = PyJWKClient(jwt_jwks_url)
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        return cast(
            dict[str, object],
            jwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256", "ES256"],
                audience=settings.supabase_jwt_audience,
                issuer=jwt_issuer,
                options={"verify_iss": jwt_issuer is not None},
            ),
        )

    if settings.normalized_app_env == "production":
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "AUTH_NOT_CONFIGURED", "message": "JWT verification is not configured"},
        )

    return cast(
        dict[str, object],
        jwt.decode(token, options={"verify_signature": False, "verify_aud": False}),
    )


def get_auth_claims(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    settings: Settings = Depends(get_settings),
) -> AuthClaims:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHENTICATED", "message": "Missing bearer token"},
        )

    try:
        payload = _decode_token(credentials.credentials, settings)
        subject = payload.get("sub")
        email = payload.get("email")
        if not isinstance(subject, str) or not isinstance(email, str):
            raise ValueError("Token must include sub and email claims")
        return AuthClaims(auth_id=UUID(subject), email=email)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "INVALID_TOKEN", "message": "Invalid access token"},
        ) from exc

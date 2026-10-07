import json
from collections.abc import Callable
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from app.users.errors import PasswordResetFailedError

AdminRequest = Callable[[str, str, str, dict[str, str] | None], dict[str, object]]


def find_user_id_by_email(
    issuer: str,
    admin_key: str,
    email: str,
    *,
    request: AdminRequest | None = None,
) -> str | None:
    payload: dict[str, object] = _admin_json(
        "GET",
        f"{issuer.rstrip('/')}/admin/users?filter={quote(email)}",
        admin_key,
        None,
        request,
    )
    users = payload.get("users") if isinstance(payload, dict) else None
    if not isinstance(users, list):
        raise PasswordResetFailedError()
    normalized_email = email.strip().lower()
    for user in users:
        if not isinstance(user, dict):
            continue
        user_email = user.get("email")
        user_id = user.get("id")
        if (
            isinstance(user_email, str)
            and user_email.strip().lower() == normalized_email
            and isinstance(user_id, str)
            and user_id
        ):
            return user_id
    return None


def update_user_password(
    issuer: str,
    admin_key: str,
    user_id: str,
    password: str,
    *,
    request: AdminRequest | None = None,
) -> None:
    _admin_json(
        "PUT",
        f"{issuer.rstrip('/')}/admin/users/{quote(user_id)}",
        admin_key,
        {"password": password},
        request,
    )


def _admin_json(
    method: str,
    url: str,
    admin_key: str,
    body: dict[str, str] | None,
    request: AdminRequest | None,
) -> dict[str, object]:
    send = request or _send_admin_request
    try:
        return send(method, url, admin_key, body)
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise PasswordResetFailedError() from exc


def _send_admin_request(
    method: str, url: str, admin_key: str, body: dict[str, str] | None
) -> dict[str, object]:
    data = None if body is None else json.dumps(body).encode()
    admin_request = Request(
        url,
        data=data,
        method=method,
        headers={
            "apikey": admin_key,
            "Authorization": f"Bearer {admin_key}",
            "Content-Type": "application/json",
        },
    )
    with urlopen(admin_request, timeout=10) as response:
        raw = response.read().decode()
    if not raw:
        return {}
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise PasswordResetFailedError()
    return parsed

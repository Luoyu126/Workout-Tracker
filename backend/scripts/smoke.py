from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.request import urlopen


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _read_health(url: str) -> dict[str, Any]:
    with urlopen(url, timeout=1.5) as response:
        payload = response.read().decode("utf-8")
    data = json.loads(payload)
    if not isinstance(data, dict):
        raise RuntimeError(f"Unexpected health response: {data!r}")
    return data


def main() -> int:
    port = _free_port()
    backend_dir = Path(__file__).resolve().parents[1]
    env = os.environ.copy()
    env.setdefault("APP_ENV", "local")
    env.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")

    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--log-level",
            "warning",
        ],
        cwd=backend_dir,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    url = f"http://127.0.0.1:{port}/health"
    deadline = time.monotonic() + 10
    try:
        while time.monotonic() < deadline:
            if process.poll() is not None:
                stdout, stderr = process.communicate(timeout=1)
                raise RuntimeError(
                    "Backend smoke server exited before becoming healthy.\n"
                    f"stdout:\n{stdout}\n"
                    f"stderr:\n{stderr}"
                )
            try:
                data = _read_health(url)
            except (ConnectionError, TimeoutError, URLError, json.JSONDecodeError):
                time.sleep(0.2)
                continue

            if data.get("status") != "ok":
                raise RuntimeError(f"Health check returned non-ok payload: {data!r}")
            print(f"Backend smoke check passed: {url} -> {data}")
            return 0

        raise RuntimeError(f"Backend smoke server did not become healthy within timeout: {url}")
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Backend smoke check failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc

from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.main import create_app


def main() -> None:
    parser = argparse.ArgumentParser(description="Export FastAPI OpenAPI JSON.")
    parser.add_argument("output", type=Path, help="Output openapi.json path.")
    parser.add_argument("--check", action="store_true", help="Fail if exported OpenAPI is stale.")
    args = parser.parse_args()

    app = create_app()
    exported = json.dumps(app.openapi(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.check:
        existing = args.output.read_text(encoding="utf-8") if args.output.exists() else ""
        if existing != exported:
            raise SystemExit(f"OpenAPI export is stale: {args.output}")
        print(f"OpenAPI export is current: {args.output}")
        return

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(exported, encoding="utf-8")
    print(f"Exported OpenAPI: {args.output}")


if __name__ == "__main__":
    main()

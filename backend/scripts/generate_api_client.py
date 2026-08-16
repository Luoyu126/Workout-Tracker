from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

HTTP_METHODS = {"get", "post", "put", "patch", "delete"}


def schema_name(schema: dict[str, Any] | None) -> str | None:
    if not schema:
        return None
    if "$ref" in schema:
        return str(schema["$ref"]).rsplit("/", 1)[-1]
    for union_key in ("anyOf", "oneOf"):
        if union_key in schema:
            union_names = [
                name
                for option in schema[union_key]
                if option.get("type") != "null"
                for name in [schema_name(option)]
                if name
            ]
            if len(union_names) == 1:
                return union_names[0]
            if union_names:
                return " | ".join(union_names)
    if schema.get("type") == "array":
        item_name = schema_name(schema.get("items"))
        return f"{item_name}[]" if item_name else "unknown[]"
    return schema.get("title") or schema.get("type") or "unknown"


def request_schema(operation: dict[str, Any]) -> str | None:
    content = operation.get("requestBody", {}).get("content", {})
    return schema_name(content.get("application/json", {}).get("schema"))


def response_schema(operation: dict[str, Any]) -> str | None:
    responses = operation.get("responses", {})
    for status_code in ("200", "201", "202"):
        content = responses.get(status_code, {}).get("content", {})
        resolved = schema_name(content.get("application/json", {}).get("schema"))
        if resolved:
            return resolved
    if "204" in responses:
        return "void"
    return None


def status_codes(operation: dict[str, Any]) -> list[int]:
    codes: list[int] = []
    for code in operation.get("responses", {}):
        if code.isdigit():
            codes.append(int(code))
    return sorted(codes)


def build_generated_source(openapi: dict[str, Any]) -> str:
    endpoints: list[dict[str, Any]] = []
    for path, path_item in sorted(openapi.get("paths", {}).items()):
        for method, operation in sorted(path_item.items()):
            if method not in HTTP_METHODS:
                continue
            endpoints.append(
                {
                    "operationId": operation.get("operationId"),
                    "method": method.upper(),
                    "path": path,
                    "requestBody": request_schema(operation),
                    "response": response_schema(operation),
                    "statusCodes": status_codes(operation),
                }
            )

    schema_names = sorted(openapi.get("components", {}).get("schemas", {}).keys())
    return (
        "/* eslint-disable */\n"
        "// This file is generated from FastAPI OpenAPI. Do not edit by hand.\n\n"
        f"export const openApiInfo = {json.dumps(openapi.get('info', {}), ensure_ascii=False, indent=2)} as const;\n\n"
        f"export const apiSchemaNames = {json.dumps(schema_names, ensure_ascii=False, indent=2)} as const;\n\n"
        f"export const apiEndpoints = {json.dumps(endpoints, ensure_ascii=False, indent=2)} as const;\n\n"
        'export type ApiSchemaName = (typeof apiSchemaNames)[number];\n'
        'export type ApiEndpoint = (typeof apiEndpoints)[number];\n'
        'export type ApiOperationId = ApiEndpoint["operationId"];\n'
        'export type ApiPath = ApiEndpoint["path"];\n'
        'export type ApiMethod = ApiEndpoint["method"];\n'
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate TypeScript API contract metadata.")
    parser.add_argument("openapi", type=Path, help="Input openapi.json path.")
    parser.add_argument("output", type=Path, help="Output generated TypeScript path.")
    parser.add_argument("--check", action="store_true", help="Fail if generated output is stale.")
    args = parser.parse_args()

    openapi = json.loads(args.openapi.read_text(encoding="utf-8"))
    generated = build_generated_source(openapi)

    if args.check:
        existing = args.output.read_text(encoding="utf-8") if args.output.exists() else ""
        if existing != generated:
            raise SystemExit(f"Generated API client is stale: {args.output}")
        print(f"Generated API client is current: {args.output}")
        return

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(generated, encoding="utf-8")
    print(f"Generated API client: {args.output}")


if __name__ == "__main__":
    main()

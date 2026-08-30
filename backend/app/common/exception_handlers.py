import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.common.errors import AppError
from app.common.logging import get_app_logger
from app.common.request_context import get_request_id


def _request_log_context(request: Request, *, error_code: str, operation: str) -> dict[str, object]:
    return {
        "request_id": getattr(request.state, "request_id", None) or get_request_id(),
        "error_code": error_code,
        "operation": operation,
        "http_method": request.method,
        "request_path": request.url.path,
    }


async def handle_app_error(request: Request, exc: AppError) -> JSONResponse:
    logger = get_app_logger()
    level = getattr(logging, exc.log_level.upper(), logging.WARNING)
    extra = _request_log_context(request, error_code=exc.code, operation=exc.operation)
    extra.update({"exception_type": type(exc).__name__, "context": exc.context})
    logger.log(level, exc.message, extra=extra)
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": {"code": exc.code, "message": exc.message}},
    )


async def handle_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    logger = get_app_logger()
    logger.info(
        "Request validation failed",
        extra=_request_log_context(
            request,
            error_code="VALIDATION_ERROR",
            operation="request.validate",
        ),
    )
    return JSONResponse(
        status_code=422,
        content={"detail": {"code": "VALIDATION_ERROR", "message": "Request validation failed"}},
    )


async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
    logger = get_app_logger()
    extra = _request_log_context(
        request,
        error_code="INTERNAL_ERROR",
        operation="request.unexpected_error",
    )
    extra["exception_type"] = type(exc).__name__
    logger.exception("Unexpected error", exc_info=exc, extra=extra)
    return JSONResponse(
        status_code=500,
        content={"detail": {"code": "INTERNAL_ERROR", "message": "Unexpected error"}},
    )


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, handle_app_error)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, handle_validation_error)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, handle_unexpected_error)

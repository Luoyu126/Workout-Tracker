import json
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

from app.config import Settings

LOGGER_NAME = "workout_tracker"
PROJECT_ROOT = Path(__file__).resolve().parents[3]


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "message": record.getMessage(),
        }
        for field_name in (
            "request_id",
            "error_code",
            "operation",
            "http_method",
            "request_path",
            "exception_type",
            "context",
        ):
            value = getattr(record, field_name, None)
            if value is not None:
                payload[field_name] = value
        if record.exc_info:
            payload["stack_trace"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, ensure_ascii=False)


def configure_logging(settings: Settings) -> logging.Logger:
    logger = logging.getLogger(LOGGER_NAME)
    logger.setLevel(settings.log_level.upper())
    logger.propagate = False

    log_dir = Path(settings.log_dir)
    if not log_dir.is_absolute():
        log_dir = PROJECT_ROOT / log_dir
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = (log_dir / "app.log").resolve()
    configured_path = getattr(logger, "_workout_tracker_log_path", None)

    if configured_path != str(log_path):
        for old_handler in list(logger.handlers):
            old_handler.close()
            logger.removeHandler(old_handler)
        handler = RotatingFileHandler(
            log_path,
            maxBytes=settings.log_max_bytes,
            backupCount=settings.log_backup_count,
            encoding="utf-8",
        )
        handler.setFormatter(JsonFormatter())
        logger.addHandler(handler)
        logger._workout_tracker_log_path = str(log_path)  # type: ignore[attr-defined]
    return logger


def get_app_logger() -> logging.Logger:
    return logging.getLogger(LOGGER_NAME)

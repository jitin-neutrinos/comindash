"""Structured JSON logging (structlog) for backend + worker.

stdout is always the primary sink (Docker captures it, Promtail ships it to
Loki). The rotating file sink is a *best-effort* fallback for the in-product
log viewer: the directory comes from ``LOG_DIR`` (default ``./logs``) and a
missing or unwritable directory downgrades to stdout-only instead of raising.
Importing the app on a developer machine must never depend on ``/app/logs``
existing.
"""

import logging
import os
import sys
from logging.handlers import TimedRotatingFileHandler

import structlog

DEFAULT_LOG_DIR = "/app/logs" if os.path.isdir("/app") else "logs"

_configured = False


def setup_logging(service_name: str = "backend") -> None:
    global _configured
    if _configured:
        return

    log_level = os.environ.get("LOG_LEVEL", "INFO").upper()
    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=log_level)

    shared_processors = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]
    formatter = structlog.stdlib.ProcessorFormatter(
        processor=structlog.processors.JSONRenderer()
    )

    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.setLevel(log_level)

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)

    file_handler = _file_handler(service_name, formatter)
    if file_handler is not None:
        root_logger.addHandler(file_handler)

    structlog.configure(
        processors=shared_processors
        + [structlog.stdlib.ProcessorFormatter.wrap_for_formatter],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )
    _configured = True


def _file_handler(service_name: str, formatter: logging.Formatter):
    """Rotating JSONL sink, or None when the log dir is unusable."""
    log_dir = os.environ.get("LOG_DIR", DEFAULT_LOG_DIR)
    try:
        os.makedirs(log_dir, exist_ok=True)
        handler = TimedRotatingFileHandler(
            os.path.join(log_dir, f"{service_name}.jsonl"),
            when="midnight",
            backupCount=5,
        )
    except OSError as e:  # read-only fs, permission denied, bad path
        print(
            f"[logging] file sink disabled ({log_dir}: {e}); stdout only",
            file=sys.stderr,
        )
        return None
    handler.setFormatter(formatter)
    return handler


def get_logger(name: str):
    return structlog.get_logger(name)

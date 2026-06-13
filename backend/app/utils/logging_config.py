"""Structured logging configuration and error-message sanitization.

This module centralizes logging setup for the backend so every component emits
records in a consistent, level-aware format. It also provides a helper for
producing user-facing error messages that never leak server-side details such
as absolute file paths, stack traces, or credentials.

Two output formats are supported:

* **text** (default): a human-readable, single-line format that is easy to scan
  in a terminal or log file.
* **json**: a structured, machine-parseable line per record, suitable for log
  aggregation systems. Extra structured fields attached to a log record (via
  ``logger.info("msg", extra={"context": {...}})``) are merged into the JSON
  object.

Design notes:

* Full error detail (including the exception type and traceback) is logged
  server-side, while :func:`sanitize_error_message` returns a short, generic
  message safe to return to API clients (Requirement 10.4).
* The sanitizer also strips anything that looks like a filesystem path or a
  secret to avoid leaking sensitive data in responses or logs (Requirement
  13.8).

Validates: Requirements 10.4, 13.8
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

#: Root logger name for the application. Child loggers (e.g.
#: ``markitdown.api.convert``) inherit this configuration.
ROOT_LOGGER_NAME = "markitdown"

#: Human-readable single-line log format.
TEXT_LOG_FORMAT = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"

#: Date format shared by both text and JSON formatters.
DATE_FORMAT = "%Y-%m-%dT%H:%M:%S%z"

#: Standard ``LogRecord`` attributes. Anything outside this set that appears on
#: a record is treated as a structured "extra" field and included in JSON logs.
_RESERVED_LOG_RECORD_ATTRS = frozenset(
    {
        "args", "asctime", "created", "exc_info", "exc_text", "filename",
        "funcName", "levelname", "levelno", "lineno", "message", "module",
        "msecs", "msg", "name", "pathname", "process", "processName",
        "relativeCreated", "stack_info", "taskName", "thread", "threadName",
    }
)

#: Default user-facing message when no safe message can be derived.
_GENERIC_ERROR_MESSAGE = "An unexpected error occurred. Please try again later."

#: Maximum length of a sanitized user-facing message.
_MAX_SANITIZED_LENGTH = 200

# Patterns used to strip sensitive substrings from user-facing messages.
# Order matters: paths and key/value secrets are removed before generic
# whitespace collapsing.
_WINDOWS_PATH_RE = re.compile(r"[A-Za-z]:\\[^\s'\"]+")
_UNIX_PATH_RE = re.compile(r"(?<![\w./])/(?:[\w.\-]+/)+[\w.\-]+")
_SECRET_KV_RE = re.compile(
    r"\b(?:password|passwd|pwd|secret|token|api[_-]?key|key|authorization|"
    r"auth|bearer|credential|access[_-]?key)\b\s*[:=]\s*\S+",
    re.IGNORECASE,
)
_WHITESPACE_RE = re.compile(r"\s+")

# A small allow-list of exception types whose message is safe and useful to
# surface to users (they are constructed by our own code with vetted text).
_SAFE_EXCEPTION_TYPES: tuple[str, ...] = (
    "ValueError",
    "TimeoutError",
    "asyncio.TimeoutError",
)


# ---------------------------------------------------------------------------
# JSON formatter
# ---------------------------------------------------------------------------


class JsonLogFormatter(logging.Formatter):
    """Format log records as single-line JSON objects.

    Standard fields (timestamp, level, logger name, message) are always
    included. Exception information is rendered into a ``exception`` field, and
    any non-reserved attributes attached via ``extra=`` are merged in as
    structured context.
    """

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": self.formatTime(record, DATE_FORMAT),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        # Merge structured extras (anything not part of the standard record).
        for key, value in record.__dict__.items():
            if key not in _RESERVED_LOG_RECORD_ATTRS and not key.startswith("_"):
                payload[key] = value

        return json.dumps(payload, default=str, ensure_ascii=False)


# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------


def _resolve_level(level: Optional[str | int]) -> int:
    """Resolve a log level from a name, number, or environment default."""
    if level is None:
        level = os.getenv("LOG_LEVEL", "INFO")
    if isinstance(level, int):
        return level
    resolved = logging.getLevelName(str(level).upper())
    # ``getLevelName`` returns a string like "Level XYZ" for unknown names.
    return resolved if isinstance(resolved, int) else logging.INFO


def _resolve_format(log_format: Optional[str]) -> str:
    """Resolve the output format ("text" or "json")."""
    if log_format is None:
        log_format = os.getenv("LOG_FORMAT", "text")
    log_format = log_format.lower()
    return "json" if log_format == "json" else "text"


def setup_logging(
    level: Optional[str | int] = None,
    log_format: Optional[str] = None,
) -> logging.Logger:
    """Configure application-wide structured logging.

    Installs a single stream handler on the application root logger
    (``markitdown``) with either a text or JSON formatter. Calling this function
    more than once is safe: the previous handlers are cleared first so the
    configuration is idempotent.

    Args:
        level: Log level as a name (e.g. ``"INFO"``), a numeric level, or
            ``None`` to read the ``LOG_LEVEL`` environment variable
            (default ``INFO``).
        log_format: Either ``"text"`` or ``"json"``, or ``None`` to read the
            ``LOG_FORMAT`` environment variable (default ``"text"``).

    Returns:
        The configured application root logger.

    Validates: Requirements 10.4, 13.8
    """
    resolved_level = _resolve_level(level)
    resolved_format = _resolve_format(log_format)

    formatter: logging.Formatter
    if resolved_format == "json":
        formatter = JsonLogFormatter()
    else:
        formatter = logging.Formatter(fmt=TEXT_LOG_FORMAT, datefmt=DATE_FORMAT)

    handler = logging.StreamHandler()
    handler.setFormatter(formatter)
    handler.setLevel(resolved_level)

    app_logger = logging.getLogger(ROOT_LOGGER_NAME)
    app_logger.setLevel(resolved_level)
    # Clear existing handlers to keep setup idempotent across reloads/tests.
    for existing in list(app_logger.handlers):
        app_logger.removeHandler(existing)
    app_logger.addHandler(handler)
    # Do not double-log through the python root logger.
    app_logger.propagate = False

    # Align the python root level so libraries log at the configured threshold
    # without attaching duplicate handlers to the app logger.
    logging.getLogger().setLevel(resolved_level)

    app_logger.debug(
        "Logging configured (level=%s, format=%s)",
        logging.getLevelName(resolved_level),
        resolved_format,
    )
    return app_logger


def get_logger(name: Optional[str] = None) -> logging.Logger:
    """Return a child logger under the application root logger.

    Args:
        name: An optional suffix (e.g. ``"api.convert"``). When omitted, the
            application root logger is returned.

    Returns:
        A :class:`logging.Logger` instance.
    """
    if not name:
        return logging.getLogger(ROOT_LOGGER_NAME)
    if name.startswith(ROOT_LOGGER_NAME):
        return logging.getLogger(name)
    return logging.getLogger(f"{ROOT_LOGGER_NAME}.{name}")


# ---------------------------------------------------------------------------
# Error-message sanitization
# ---------------------------------------------------------------------------


def _strip_sensitive(text: str) -> str:
    """Remove paths and secret-like key/value pairs from ``text``."""
    text = _SECRET_KV_RE.sub("[redacted]", text)
    text = _WINDOWS_PATH_RE.sub("[path]", text)
    text = _UNIX_PATH_RE.sub("[path]", text)
    text = _WHITESPACE_RE.sub(" ", text).strip()
    return text


def sanitize_error_message(
    exc: BaseException | str,
    fallback: str = _GENERIC_ERROR_MESSAGE,
) -> str:
    """Return a user-safe error message derived from an exception.

    The returned string is suitable for inclusion in an API response: it
    contains no stack traces, absolute file paths, or secret-like values. For
    exception types that we construct ourselves with vetted, user-friendly text
    (e.g. :class:`ValueError`, :class:`TimeoutError`), the sanitized message is
    surfaced. For all other exception types, a generic ``fallback`` message is
    returned to avoid leaking internal details.

    Callers should log the full exception separately (e.g. with
    ``logger.exception(...)``) so detailed information is preserved server-side
    while only the sanitized message reaches the user.

    Args:
        exc: The exception (or a raw message string) to sanitize.
        fallback: The generic message used when the exception is not in the
            safe allow-list or yields no usable text.

    Returns:
        A short, sanitized, user-facing error message.

    Validates: Requirements 10.4, 13.8
    """
    if isinstance(exc, str):
        message = _strip_sensitive(exc)
        return (message[:_MAX_SANITIZED_LENGTH] or fallback)

    # Determine the fully qualified exception type name.
    exc_type = type(exc)
    qualified_name = f"{exc_type.__module__}.{exc_type.__name__}"
    simple_name = exc_type.__name__

    is_safe = (
        simple_name in _SAFE_EXCEPTION_TYPES
        or qualified_name in _SAFE_EXCEPTION_TYPES
    )

    if not is_safe:
        return fallback

    raw = str(exc).strip()
    if not raw:
        return fallback

    cleaned = _strip_sensitive(raw)
    if not cleaned:
        return fallback

    return cleaned[:_MAX_SANITIZED_LENGTH]

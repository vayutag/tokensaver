"""Unit tests for the structured logging configuration and error sanitizer.

Validates: Requirements 10.4, 13.8
"""

import json
import logging

import pytest

from app.utils.logging_config import (
    ROOT_LOGGER_NAME,
    JsonLogFormatter,
    get_logger,
    sanitize_error_message,
    setup_logging,
)


# ---------------------------------------------------------------------------
# setup_logging
# ---------------------------------------------------------------------------


def test_setup_logging_text_configures_single_handler():
    logger = setup_logging(level="DEBUG", log_format="text")
    assert logger.name == ROOT_LOGGER_NAME
    assert logger.level == logging.DEBUG
    assert len(logger.handlers) == 1
    # Text format uses the standard library Formatter (not JSON).
    assert not isinstance(logger.handlers[0].formatter, JsonLogFormatter)


def test_setup_logging_is_idempotent():
    setup_logging(log_format="text")
    setup_logging(log_format="text")
    logger = logging.getLogger(ROOT_LOGGER_NAME)
    # Repeated calls must not accumulate duplicate handlers.
    assert len(logger.handlers) == 1


def test_setup_logging_json_uses_json_formatter():
    logger = setup_logging(log_format="json")
    assert isinstance(logger.handlers[0].formatter, JsonLogFormatter)


def test_setup_logging_reads_environment(monkeypatch):
    monkeypatch.setenv("LOG_LEVEL", "WARNING")
    monkeypatch.setenv("LOG_FORMAT", "json")
    logger = setup_logging()
    assert logger.level == logging.WARNING
    assert isinstance(logger.handlers[0].formatter, JsonLogFormatter)


def test_get_logger_returns_child_under_root():
    assert get_logger("api.convert").name == "markitdown.api.convert"
    assert get_logger().name == ROOT_LOGGER_NAME
    # An already-qualified name is preserved.
    assert get_logger("markitdown.api").name == "markitdown.api"


# ---------------------------------------------------------------------------
# JsonLogFormatter
# ---------------------------------------------------------------------------


def _make_record(**kwargs):
    defaults = dict(
        name="markitdown.test",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="hello %s",
        args=("world",),
        exc_info=None,
    )
    defaults.update(kwargs)
    return logging.LogRecord(
        name=defaults["name"],
        level=defaults["level"],
        pathname=defaults["pathname"],
        lineno=defaults["lineno"],
        msg=defaults["msg"],
        args=defaults["args"],
        exc_info=defaults["exc_info"],
    )


def test_json_formatter_emits_standard_fields():
    record = _make_record()
    payload = json.loads(JsonLogFormatter().format(record))
    assert payload["level"] == "INFO"
    assert payload["logger"] == "markitdown.test"
    assert payload["message"] == "hello world"
    assert "timestamp" in payload


def test_json_formatter_includes_extra_context():
    record = _make_record()
    record.request_id = "abc-123"  # simulate extra= context
    payload = json.loads(JsonLogFormatter().format(record))
    assert payload["request_id"] == "abc-123"


def test_json_formatter_includes_exception():
    try:
        raise ValueError("boom")
    except ValueError:
        import sys

        record = _make_record(exc_info=sys.exc_info())
    payload = json.loads(JsonLogFormatter().format(record))
    assert "exception" in payload
    assert "ValueError" in payload["exception"]


# ---------------------------------------------------------------------------
# sanitize_error_message
# ---------------------------------------------------------------------------


def test_sanitize_unsafe_exception_returns_generic():
    # A RuntimeError is not in the safe allow-list, so internal detail is hidden.
    msg = sanitize_error_message(RuntimeError("internal kaboom at module X"))
    assert "kaboom" not in msg
    assert msg  # non-empty generic fallback


def test_sanitize_safe_exception_surfaces_message():
    msg = sanitize_error_message(ValueError("Unsupported file type: .xyz"))
    assert "Unsupported file type" in msg


def test_sanitize_strips_windows_paths():
    msg = sanitize_error_message(
        ValueError(r"failed reading C:\Users\Tanuj\secret\file.pdf")
    )
    assert "C:\\Users" not in msg
    assert "[path]" in msg


def test_sanitize_strips_unix_paths():
    msg = sanitize_error_message("error at /home/user/secrets/key.pem now")
    assert "/home/user" not in msg
    assert "[path]" in msg


def test_sanitize_redacts_secrets():
    msg = sanitize_error_message("connect failed password=hunter2 retrying")
    assert "hunter2" not in msg
    assert "[redacted]" in msg


def test_sanitize_string_input():
    assert sanitize_error_message("plain message") == "plain message"


def test_sanitize_empty_uses_fallback():
    out = sanitize_error_message(ValueError(""))
    assert out  # falls back to a non-empty generic message


def test_sanitize_truncates_long_messages():
    long_text = "x" * 500
    out = sanitize_error_message(long_text)
    assert len(out) <= 200

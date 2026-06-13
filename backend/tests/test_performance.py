"""Tests for backend performance optimizations (task 16.2).

Covers:
- The short-TTL response cache on the health endpoint (Requirement 12.3).
- The request timeout safety-net middleware returning 504 (Requirements 12.3, 12.5).
- Non-blocking async temp-file persistence (Requirement 12.4).
"""

from __future__ import annotations

import asyncio
import os
from types import SimpleNamespace

import pytest

import app.api.health as health
from app.config import get_settings
from app.main import RequestTimeoutMiddleware
from app.services.file_processor import FileProcessor


# ---------------------------------------------------------------------------
# Health endpoint response caching (Requirement 12.3)
# ---------------------------------------------------------------------------


def _run(coro):
    return asyncio.run(coro)


def test_health_response_is_cached_within_ttl(monkeypatch):
    """A second call within the TTL returns the cached response object."""
    settings = get_settings()
    monkeypatch.setattr(settings, "health_cache_ttl", 30, raising=False)
    health._health_cache.clear()

    first = _run(health.health_endpoint())
    second = _run(health.health_endpoint())

    # Same object identity proves the second call was served from cache and
    # did not recompute disk/memory statistics.
    assert first is second


def test_health_cache_disabled_recomputes_each_call(monkeypatch):
    """With TTL=0 the cache is disabled and each call recomputes a response."""
    settings = get_settings()
    monkeypatch.setattr(settings, "health_cache_ttl", 0, raising=False)
    health._health_cache.clear()

    first = _run(health.health_endpoint())
    second = _run(health.health_endpoint())

    # Distinct objects: no caching occurred. Content is still equivalent.
    assert first is not second
    assert first.status == second.status
    assert first.version == second.version


def test_health_cache_clear_forces_recompute(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "health_cache_ttl", 30, raising=False)
    health._health_cache.clear()

    first = _run(health.health_endpoint())
    health._health_cache.clear()
    third = _run(health.health_endpoint())

    assert first is not third


# ---------------------------------------------------------------------------
# Request timeout middleware (Requirements 12.3, 12.5)
# ---------------------------------------------------------------------------


def _fake_request():
    return SimpleNamespace(method="GET", url=SimpleNamespace(path="/slow"))


def test_timeout_middleware_returns_504_when_exceeded():
    middleware = RequestTimeoutMiddleware(app=None, timeout_seconds=0.05)

    async def slow_call_next(request):
        await asyncio.sleep(1.0)
        return "should-not-reach"

    response = _run(middleware.dispatch(_fake_request(), slow_call_next))

    assert response.status_code == 504


def test_timeout_middleware_passes_through_fast_requests():
    middleware = RequestTimeoutMiddleware(app=None, timeout_seconds=5)
    sentinel = object()

    async def fast_call_next(request):
        return sentinel

    response = _run(middleware.dispatch(_fake_request(), fast_call_next))

    assert response is sentinel


# ---------------------------------------------------------------------------
# Async file persistence (Requirement 12.4)
# ---------------------------------------------------------------------------


def test_save_temp_file_async_writes_content():
    processor = FileProcessor()
    content = b"# Hello async IO\n"

    path = _run(processor.save_temp_file_async(content, "note.md"))

    try:
        assert os.path.exists(path)
        with open(path, "rb") as handle:
            assert handle.read() == content
        # Filename is sanitized and preserved with a unique prefix.
        assert path.endswith("note.md")
    finally:
        processor.cleanup_file(path)


def test_save_temp_file_async_matches_sync_behavior():
    processor = FileProcessor()
    content = b"data"

    async_path = _run(processor.save_temp_file_async(content, "a.txt"))
    sync_path = processor.save_temp_file(content, "a.txt")

    try:
        assert os.path.exists(async_path)
        assert os.path.exists(sync_path)
        assert async_path != sync_path  # unique UUID prefixes
    finally:
        processor.cleanup_file(async_path)
        processor.cleanup_file(sync_path)

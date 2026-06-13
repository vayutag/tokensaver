"""
Main FastAPI application entry point for the MarkItDown Website Backend.

This module initializes the FastAPI application, configures CORS, sets up
request logging, and enforces per-IP rate limiting.

Validates: Requirements 13.1, 13.6, 14.7
"""

import asyncio
import logging
import time
from collections import defaultdict, deque
from threading import Lock

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import get_settings
from app.utils.logging_config import setup_logging

# ---------------------------------------------------------------------------
# Logging configuration
# ---------------------------------------------------------------------------

# Configure application-wide structured logging (level/format are driven by the
# LOG_LEVEL and LOG_FORMAT environment variables; defaults to INFO/text).
# Validates: Requirements 10.4, 13.8
setup_logging()
logger = logging.getLogger("markitdown.api")

settings = get_settings()


# ---------------------------------------------------------------------------
# Rate limiting middleware
# ---------------------------------------------------------------------------

# Window size for rate limiting in seconds (one hour).
_RATE_LIMIT_WINDOW_SECONDS = 60 * 60


class RateLimiterMiddleware(BaseHTTPMiddleware):
    """
    Enforce a per-IP request limit using an in-memory sliding window.

    Each client IP is allowed up to ``limit`` requests within a rolling
    one-hour window. Requests exceeding the limit receive a
    ``429 Too Many Requests`` response.

    Validates: Requirements 13.6
    """

    def __init__(self, app, limit: int, window_seconds: int = _RATE_LIMIT_WINDOW_SECONDS):
        super().__init__(app)
        self.limit = limit
        self.window_seconds = window_seconds
        # Map of client IP -> deque of request timestamps within the window.
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = Lock()

    def _client_ip(self, request: Request) -> str:
        """Resolve the client IP, honoring a forwarding proxy header."""
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            # The first entry is the originating client.
            return forwarded.split(",")[0].strip()
        if request.client and request.client.host:
            return request.client.host
        return "unknown"

    def _is_rate_limited(self, client_ip: str) -> tuple[bool, int]:
        """
        Record a request for the client and determine whether it is allowed.

        Returns a tuple of (is_limited, remaining_requests).
        """
        now = time.monotonic()
        window_start = now - self.window_seconds

        with self._lock:
            timestamps = self._hits[client_ip]

            # Drop timestamps that fall outside the current window.
            while timestamps and timestamps[0] < window_start:
                timestamps.popleft()

            if len(timestamps) >= self.limit:
                return True, 0

            timestamps.append(now)
            remaining = self.limit - len(timestamps)
            return False, remaining

    async def dispatch(self, request: Request, call_next):
        client_ip = self._client_ip(request)
        is_limited, remaining = self._is_rate_limited(client_ip)

        if is_limited:
            logger.warning("Rate limit exceeded for client %s", client_ip)
            return JSONResponse(
                status_code=429,
                content={
                    "detail": (
                        f"Rate limit exceeded. Maximum {self.limit} requests "
                        "per hour allowed."
                    )
                },
                headers={
                    "Retry-After": str(self.window_seconds),
                    "X-RateLimit-Limit": str(self.limit),
                    "X-RateLimit-Remaining": "0",
                },
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(self.limit)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        return response


# ---------------------------------------------------------------------------
# Request timeout middleware
# ---------------------------------------------------------------------------


class RequestTimeoutMiddleware(BaseHTTPMiddleware):
    """Abort requests that exceed a configurable wall-clock timeout.

    Acts as a safety net against stuck or hung requests. The timeout is
    intentionally larger than the per-file conversion timeout so legitimate
    conversions are never cut short; only requests that run away beyond the
    configured limit are terminated with a ``504 Gateway Timeout``.

    Validates: Requirements 12.3, 12.5
    """

    def __init__(self, app, timeout_seconds: int):
        super().__init__(app)
        self.timeout_seconds = timeout_seconds

    async def dispatch(self, request: Request, call_next):
        try:
            return await asyncio.wait_for(
                call_next(request), timeout=self.timeout_seconds
            )
        except asyncio.TimeoutError:
            logger.warning(
                "Request %s %s exceeded %ds timeout",
                request.method,
                request.url.path,
                self.timeout_seconds,
            )
            return JSONResponse(
                status_code=504,
                content={
                    "detail": (
                        "The request exceeded the maximum processing time of "
                        f"{self.timeout_seconds} seconds. Try a smaller file "
                        "or a different format."
                    )
                },
            )


# ---------------------------------------------------------------------------
# Request logging middleware
# ---------------------------------------------------------------------------


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """
    Log each incoming request with method, path, status, and timing.

    File contents and other sensitive data are never logged.

    Validates: Requirements 10.4, 13.8
    """

    async def dispatch(self, request: Request, call_next):
        start_time = time.perf_counter()
        logger.info("--> %s %s", request.method, request.url.path)

        try:
            response = await call_next(request)
        except Exception:
            elapsed_ms = (time.perf_counter() - start_time) * 1000
            logger.exception(
                "<-- %s %s failed after %.2fms",
                request.method,
                request.url.path,
                elapsed_ms,
            )
            raise

        elapsed_ms = (time.perf_counter() - start_time) * 1000
        logger.info(
            "<-- %s %s %d %.2fms",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
        )
        response.headers["X-Process-Time-ms"] = f"{elapsed_ms:.2f}"
        return response


# ---------------------------------------------------------------------------
# Application factory
# ---------------------------------------------------------------------------


def create_app() -> FastAPI:
    """
    Create and configure the FastAPI application instance.

    Returns:
        FastAPI: The configured application.
    """
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description=(
            "API for converting documents (PDF, PowerPoint, Word, Excel, "
            "images, audio, HTML) to Markdown using the MarkItDown library."
        ),
        debug=settings.debug,
    )

    # CORS: allow configured frontend origins.
    # `allow_origin_regex` is a safety net that accepts the deployed Render
    # frontend (any URL suffix) without needing its exact URL configured.
    # Validates: Requirements 14.7
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_origin_regex=settings.cors_origin_regex,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Rate limiting: 100 requests per IP per hour (configurable).
    # Validates: Requirements 13.6
    app.add_middleware(
        RateLimiterMiddleware,
        limit=settings.rate_limit_per_hour,
    )

    # Request timeout safety net: abort runaway requests with a 504.
    # Added after the rate limiter and before request logging so the logging
    # middleware remains the outermost layer and still records timed-out
    # requests (including the 504 response). Existing middleware ordering
    # (CORS innermost, request logging outermost) is preserved.
    # Validates: Requirements 12.3, 12.5
    app.add_middleware(
        RequestTimeoutMiddleware,
        timeout_seconds=settings.request_timeout,
    )

    # Request logging (also records API response times for monitoring).
    # Validates: Requirements 12.3, 10.4
    app.add_middleware(RequestLoggingMiddleware)

    # Register API routers (convert, download, health).
    # Imported here to avoid import-time coupling and keep middleware setup
    # above unaffected.
    # Validates: Requirements 14.1, 14.3, 14.4
    from app.api.convert import router as convert_router
    from app.api.download import router as download_router
    from app.api.health import router as health_router

    app.include_router(convert_router)
    app.include_router(download_router)
    app.include_router(health_router)

    @app.on_event("startup")
    async def on_startup() -> None:
        logger.info(
            "Starting %s v%s (debug=%s)",
            settings.app_name,
            settings.app_version,
            settings.debug,
        )
        logger.info("Allowed CORS origins: %s", settings.cors_origins_list)
        logger.info("Rate limit: %d requests/IP/hour", settings.rate_limit_per_hour)

        # Validate optional cloud service configuration and log availability.
        # Validates: Requirements 18.3, 18.4, 8.3
        from app.services.cloud_clients import validate_cloud_configuration

        validate_cloud_configuration(settings)

        # Launch the periodic temporary-file cleanup task. It sweeps expired
        # uploads/results every 15 minutes and on low disk space.
        # Validates: Requirements 11.2, 11.3, 11.4, 11.5
        from app.services.cleanup import get_cleanup_service

        get_cleanup_service().start()
        logger.info("Cleanup service scheduled.")

    @app.on_event("shutdown")
    async def on_shutdown() -> None:
        # Cancel the background cleanup task cleanly on shutdown.
        # Validates: Requirements 11.3
        from app.services.cleanup import get_cleanup_service

        await get_cleanup_service().stop()
        logger.info("Cleanup service stopped.")

    return app


app = create_app()

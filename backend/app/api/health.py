"""GET /api/health endpoint.

Reports overall system health so the frontend can surface a status indicator
and operators can monitor the service.

The endpoint (Requirements 14.4, 15.1, 15.2, 15.3, 15.4, 15.6):

1. Checks that the MarkItDown library can be imported (15.2).
2. Reports the application version and the list of supported formats (15.3).
3. Samples disk usage of the temp storage volume and, when available, system
   memory utilisation (15.4 reporting input for degraded detection).
4. Returns a ``degraded`` status when resource constraints are detected, or
   ``unavailable`` when the conversion library is missing (15.6).
5. Logs every health check request (15.4).

Memory statistics use ``psutil`` when installed but degrade gracefully to
disk-only reporting when it is not available, since ``psutil`` is an optional
dependency.

Validates: Requirements 14.4, 15.1, 15.2, 15.3, 15.4, 15.6
"""

from __future__ import annotations

import logging
import shutil
import time
from threading import Lock
from typing import Optional

from fastapi import APIRouter

from app.config import get_settings
from app.constants import SUPPORTED_FORMAT_LABELS, ApiEndpoints
from app.models.health import ConversionMetrics, HealthResponse, ResourceStatus
from app.services.metrics import get_metrics_collector

logger = logging.getLogger("markitdown.api.health")

router = APIRouter(tags=["health"])

# Thresholds beyond which the system reports a degraded status (Requirement 15.6).
_DISK_USAGE_DEGRADED_PERCENT = 90.0
_MEMORY_USAGE_DEGRADED_PERCENT = 90.0


class _HealthResponseCache:
    """Tiny thread-safe TTL cache for the computed health response.

    Health checks are typically polled at a high frequency by the frontend
    status indicator and external monitors. Recomputing disk usage and memory
    statistics on every poll is wasteful, so the fully computed response is
    cached for a short, configurable TTL (``HEALTH_CACHE_TTL``). Each request
    is still logged for monitoring purposes (Requirement 15.4); only the
    expensive resource sampling is skipped on a cache hit.

    Validates: Requirements 12.3
    """

    def __init__(self) -> None:
        self._lock = Lock()
        self._value: Optional[HealthResponse] = None
        self._expires_at: float = 0.0

    def get(self) -> Optional[HealthResponse]:
        """Return the cached response if it is still fresh, else ``None``."""
        with self._lock:
            if self._value is not None and time.monotonic() < self._expires_at:
                return self._value
            return None

    def set(self, value: HealthResponse, ttl_seconds: float) -> None:
        """Cache ``value`` for ``ttl_seconds``. A non-positive TTL disables caching."""
        if ttl_seconds <= 0:
            return
        with self._lock:
            self._value = value
            self._expires_at = time.monotonic() + ttl_seconds

    def clear(self) -> None:
        """Invalidate the cache (primarily for tests)."""
        with self._lock:
            self._value = None
            self._expires_at = 0.0


# Module-level cache shared across requests within the process.
_health_cache = _HealthResponseCache()


def _check_markitdown_available() -> bool:
    """Return ``True`` when the MarkItDown library can be imported.

    Validates: Requirement 15.2
    """
    try:
        import markitdown  # noqa: F401

        return True
    except Exception:  # noqa: BLE001 - any import failure means unavailable
        logger.warning("MarkItDown library is not available")
        return False


# Maps a MarkItDown converter type name (with the trailing ``Converter``
# stripped) to the user-facing format label this service exposes. Lets the
# health endpoint translate the library's *dynamically discovered* converters
# into the labels the frontend understands while constraining the result to
# formats the backend actually accepts (Requirements 15.2, 15.3).
_CONVERTER_LABELS: dict[str, str] = {
    "Pdf": "PDF",
    "Docx": "Word (DOC, DOCX)",
    "Doc": "Word (DOC, DOCX)",
    "Pptx": "PowerPoint (PPT, PPTX)",
    "Ppt": "PowerPoint (PPT, PPTX)",
    "Xlsx": "Excel (XLS, XLSX)",
    "Xls": "Excel (XLS, XLSX)",
    "Image": "Images (JPEG, PNG, GIF, BMP, TIFF, WebP)",
    "Audio": "Audio (MP3, WAV, M4A, OGG, FLAC)",
    "Wav": "Audio (MP3, WAV, M4A, OGG, FLAC)",
    "Mp3": "Audio (MP3, WAV, M4A, OGG, FLAC)",
    "Html": "HTML",
}


def _markitdown_supported_formats() -> list[str] | None:
    """Derive supported-format labels from MarkItDown's registered converters.

    Introspects a MarkItDown instance's converter registrations and maps the
    discovered converter types to the user-facing labels this service exposes.
    The library does not provide a stable public API for enumerating
    converters, so attribute access is defensive and any failure results in
    ``None`` so the caller can fall back to the shared constants.

    Discovered labels are intersected with and ordered by
    :data:`SUPPORTED_FORMAT_LABELS`, ensuring the health endpoint only reports
    formats this service actually accepts even though the underlying library
    may register additional converters.

    Validates: Requirements 15.2, 15.3
    """
    try:
        from markitdown import MarkItDown
    except Exception:  # noqa: BLE001 - library missing/unimportable
        return None

    try:
        registrations = getattr(MarkItDown(), "_converters", None)
    except Exception:  # noqa: BLE001 - construction/introspection failure
        return None

    if not registrations:
        return None

    discovered: set[str] = set()
    suffix = "Converter"
    for registration in registrations:
        # Registration objects wrap the converter instance; unwrap defensively.
        converter = getattr(registration, "converter", registration)
        cls_name = type(converter).__name__
        key = cls_name[: -len(suffix)] if cls_name.endswith(suffix) else cls_name
        label = _CONVERTER_LABELS.get(key)
        if label is not None:
            discovered.add(label)

    # Preserve the canonical ordering defined by the shared constants.
    ordered = [label for label in SUPPORTED_FORMAT_LABELS if label in discovered]
    return ordered or None


def _resolve_supported_formats(markitdown_available: bool) -> list[str]:
    """Resolve the supported-format labels reported by the health endpoint.

    Prefers labels derived dynamically from MarkItDown's registered converters
    so the reported formats track the library's real capabilities. Falls back
    to the shared :data:`SUPPORTED_FORMAT_LABELS` constant when the library is
    unavailable or cannot be introspected, rather than embedding a hardcoded
    list here (Requirement 15.3).
    """
    if markitdown_available:
        dynamic = _markitdown_supported_formats()
        if dynamic:
            return dynamic
    return list(SUPPORTED_FORMAT_LABELS)


def _gather_resources(storage_path: str) -> ResourceStatus:
    """Collect disk and (best-effort) memory utilisation.

    Disk usage is measured for the temporary storage volume using the standard
    library. Memory usage is reported only when ``psutil`` is available.

    Validates: Requirements 15.4, 15.6
    """
    resources = ResourceStatus()

    # Disk usage for the storage volume.
    try:
        usage = shutil.disk_usage(storage_path)
        resources.disk_total_bytes = usage.total
        resources.disk_free_bytes = usage.free
        if usage.total > 0:
            resources.disk_percent_used = round(
                (usage.used / usage.total) * 100, 2
            )
    except OSError as exc:
        logger.warning("Unable to read disk usage for %s: %s", storage_path, exc)

    # Memory usage via psutil when available (optional dependency).
    try:
        import psutil  # type: ignore

        mem = psutil.virtual_memory()
        resources.memory_total_bytes = mem.total
        resources.memory_available_bytes = mem.available
        resources.memory_percent_used = round(float(mem.percent), 2)
    except Exception:  # noqa: BLE001 - psutil missing or unreadable
        logger.debug("Memory statistics unavailable (psutil not installed)")

    return resources


def _is_resource_constrained(resources: ResourceStatus) -> bool:
    """Return ``True`` when disk or memory usage exceeds degraded thresholds."""
    if (
        resources.disk_percent_used is not None
        and resources.disk_percent_used >= _DISK_USAGE_DEGRADED_PERCENT
    ):
        return True
    if (
        resources.memory_percent_used is not None
        and resources.memory_percent_used >= _MEMORY_USAGE_DEGRADED_PERCENT
    ):
        return True
    return False


@router.get(
    ApiEndpoints.HEALTH,
    response_model=HealthResponse,
    summary="Report system health and supported formats",
)
async def health_endpoint() -> HealthResponse:
    """Return the current system health status.

    Returns:
        A :class:`HealthResponse` describing library availability, version,
        supported formats, and resource utilisation.
    """
    settings = get_settings()

    # Log the health check request (Requirement 15.4). Always logged, even on
    # a cache hit, so monitoring still observes every poll.
    logger.info("Health check requested")

    # Serve a recently computed response when available to avoid recomputing
    # disk/memory statistics on every poll (Requirement 12.3).
    cached = _health_cache.get()
    if cached is not None:
        return cached

    markitdown_available = _check_markitdown_available()
    resources = _gather_resources(settings.temp_storage_path)

    # Collect aggregated conversion metrics (Requirements 15.1, 15.4).
    snapshot = get_metrics_collector().snapshot()
    metrics = ConversionMetrics(
        total_conversions=snapshot.total_conversions,
        successful_conversions=snapshot.successful_conversions,
        failed_conversions=snapshot.failed_conversions,
        average_processing_time_seconds=snapshot.average_processing_time_seconds,
        total_processing_time_seconds=snapshot.total_processing_time_seconds,
    )

    # Determine overall status (Requirement 15.6).
    if not markitdown_available:
        overall_status: str = "unavailable"
    elif _is_resource_constrained(resources):
        overall_status = "degraded"
    else:
        overall_status = "healthy"

    # Emit a structured health summary so external monitoring services can
    # ingest status, resource pressure, and conversion metrics (Req 15.4).
    logger.info(
        "monitoring health_summary status=%s markitdown_available=%s "
        "disk_percent_used=%s memory_percent_used=%s "
        "total_conversions=%d successful_conversions=%d failed_conversions=%d "
        "avg_processing_time=%.4f",
        overall_status,
        markitdown_available,
        resources.disk_percent_used,
        resources.memory_percent_used,
        snapshot.total_conversions,
        snapshot.successful_conversions,
        snapshot.failed_conversions,
        snapshot.average_processing_time_seconds,
    )

    response = HealthResponse(
        status=overall_status,
        version=settings.app_version,
        supported_formats=_resolve_supported_formats(markitdown_available),
        markitdown_available=markitdown_available,
        resources=resources,
        metrics=metrics,
    )

    # Cache the freshly computed response for the configured TTL.
    _health_cache.set(response, settings.health_cache_ttl)
    return response

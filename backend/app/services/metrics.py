"""In-memory metrics collection for conversion operations.

Provides a small, thread-safe :class:`MetricsCollector` that aggregates
counters for conversion operations so the health endpoint can surface basic
operational metrics for monitoring (Requirements 15.1, 15.4).

The collector tracks:

- ``total_conversions`` - total number of recorded conversion attempts.
- ``successful_conversions`` - attempts that produced markdown.
- ``failed_conversions`` - attempts that failed (validation, conversion error,
  or timeout).
- ``average_processing_time_seconds`` - mean wall-clock processing time across
  all recorded attempts.

Metrics are intentionally kept in process memory: they are lightweight, reset
on restart, and are meant to be scraped/observed via the health endpoint or
logs rather than persisted. A :class:`threading.Lock` guards all mutations so
the collector is safe to use from worker threads and concurrent requests.

Validates: Requirements 15.1, 15.4
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass

logger = logging.getLogger("markitdown.metrics")


@dataclass(frozen=True)
class MetricsSnapshot:
    """Immutable point-in-time view of conversion metrics.

    Attributes:
        total_conversions: Total recorded conversion attempts.
        successful_conversions: Attempts that completed successfully.
        failed_conversions: Attempts that failed.
        average_processing_time_seconds: Mean processing time across all
            recorded attempts (``0.0`` when no conversions have been recorded).
        total_processing_time_seconds: Sum of processing times across all
            recorded attempts.
    """

    total_conversions: int
    successful_conversions: int
    failed_conversions: int
    average_processing_time_seconds: float
    total_processing_time_seconds: float


class MetricsCollector:
    """Thread-safe in-memory aggregator for conversion metrics.

    The collector is cheap to construct and shared process-wide via
    :func:`get_metrics_collector`. All public methods are safe to call
    concurrently from multiple threads.

    Validates: Requirements 15.1, 15.4
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._total = 0
        self._successes = 0
        self._failures = 0
        self._total_processing_time = 0.0

    def record_conversion(self, success: bool, processing_time: float) -> None:
        """Record the outcome of a single conversion attempt.

        Args:
            success: ``True`` if the conversion produced markdown, ``False``
                if it failed (validation, conversion error, or timeout).
            processing_time: Wall-clock processing time in seconds. Negative
                values are clamped to ``0.0`` to keep aggregates sane.
        """
        if processing_time < 0:
            processing_time = 0.0

        with self._lock:
            self._total += 1
            if success:
                self._successes += 1
            else:
                self._failures += 1
            self._total_processing_time += processing_time

        # Emit a structured log line so external monitoring services can
        # ingest conversion outcomes without scraping the health endpoint
        # (Requirement 15.4). No file contents or user data are logged.
        logger.info(
            "metric conversion_recorded success=%s processing_time=%.4f",
            success,
            processing_time,
        )

    def snapshot(self) -> MetricsSnapshot:
        """Return an immutable snapshot of the current metrics.

        Returns:
            A :class:`MetricsSnapshot` with the aggregated counters and the
            computed average processing time.
        """
        with self._lock:
            total = self._total
            successes = self._successes
            failures = self._failures
            total_time = self._total_processing_time

        average = (total_time / total) if total > 0 else 0.0
        return MetricsSnapshot(
            total_conversions=total,
            successful_conversions=successes,
            failed_conversions=failures,
            average_processing_time_seconds=round(average, 4),
            total_processing_time_seconds=round(total_time, 4),
        )

    def reset(self) -> None:
        """Reset all counters to zero.

        Primarily useful for tests; in production metrics persist for the
        lifetime of the process.
        """
        with self._lock:
            self._total = 0
            self._successes = 0
            self._failures = 0
            self._total_processing_time = 0.0


# Module-level shared instance for the API layer to import.
metrics_collector = MetricsCollector()


def get_metrics_collector() -> MetricsCollector:
    """Return the shared process-wide :class:`MetricsCollector` instance."""
    return metrics_collector

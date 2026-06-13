"""In-memory store for conversion results keyed by result ID.

This module provides a lightweight, thread-safe store that holds completed
conversion results so they can be retrieved later by the download endpoint.
Both the ``POST /api/convert`` endpoint (which saves results) and the
``GET /api/download/{result_id}`` endpoint (which retrieves them) depend on
this shared store.

Results are retained for a configurable period (default one hour, per
``Settings.result_retention_hours``) after which they are considered expired
and are no longer returned (Requirements 6.3, 6.4, 11.2). Expiry is enforced
lazily on access and via an explicit :meth:`ResultStore.purge_expired` call so
the store never returns stale data, even before a background cleanup task runs.

The store keeps the full :class:`ConversionResponse` alongside the original
filename so the download endpoint can surface useful metadata. The markdown
content itself lives inside the stored response.

Validates: Requirements 6.3, 6.4, 11.2
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Optional

from app.config import Settings, get_settings
from app.models.conversion import ConversionResponse


@dataclass
class StoredResult:
    """A conversion result held in the store along with bookkeeping data.

    Attributes:
        response: The full :class:`ConversionResponse` returned to the client
            when the conversion completed.
        original_filename: The sanitized name of the uploaded source file.
        created_at: Monotonic timestamp (seconds) when the result was stored.
    """

    response: ConversionResponse
    original_filename: str
    created_at: float

    @property
    def markdown(self) -> str:
        """Convenience accessor for the stored markdown content."""
        return self.response.markdown


class ResultStore:
    """Thread-safe, TTL-bounded store of conversion results.

    A single instance is shared across requests. Access is guarded by a lock
    because conversions run in worker threads and FastAPI may handle requests
    concurrently. Entries older than the configured retention window are
    treated as expired and removed on access.

    Validates: Requirements 6.3, 6.4, 11.2
    """

    def __init__(self, settings: Optional[Settings] = None) -> None:
        self._settings = settings or get_settings()
        self._results: dict[str, StoredResult] = {}
        self._lock = threading.Lock()

    @property
    def _retention_seconds(self) -> float:
        """Retention window in seconds derived from configured hours."""
        return self._settings.result_retention_hours * 60 * 60

    def _is_expired(self, entry: StoredResult, now: float) -> bool:
        """Return ``True`` when an entry has outlived the retention window."""
        return (now - entry.created_at) >= self._retention_seconds

    def save(
        self,
        result_id: str,
        response: ConversionResponse,
        original_filename: str,
    ) -> None:
        """Store a conversion result under ``result_id``.

        Args:
            result_id: Unique identifier (UUID v4) for the result.
            response: The conversion response to retain.
            original_filename: Sanitized source filename for metadata.
        """
        entry = StoredResult(
            response=response,
            original_filename=original_filename,
            created_at=time.monotonic(),
        )
        with self._lock:
            self._results[result_id] = entry

    def get(self, result_id: str) -> Optional[StoredResult]:
        """Retrieve a stored result, or ``None`` if absent or expired.

        Expired entries are removed as a side effect so the store does not
        return stale data (Requirements 6.4, 11.2).

        Args:
            result_id: The identifier to look up.

        Returns:
            The :class:`StoredResult` when present and unexpired, else ``None``.
        """
        now = time.monotonic()
        with self._lock:
            entry = self._results.get(result_id)
            if entry is None:
                return None
            if self._is_expired(entry, now):
                # Drop the stale entry and report a miss.
                del self._results[result_id]
                return None
            return entry

    def purge_expired(self) -> int:
        """Remove all expired entries and return the number removed."""
        now = time.monotonic()
        with self._lock:
            expired_ids = [
                result_id
                for result_id, entry in self._results.items()
                if self._is_expired(entry, now)
            ]
            for result_id in expired_ids:
                del self._results[result_id]
            return len(expired_ids)

    def clear(self) -> None:
        """Remove every stored result. Primarily useful in tests."""
        with self._lock:
            self._results.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._results)


# Module-level shared instance for the API layer to import.
result_store = ResultStore()


def get_result_store() -> ResultStore:
    """Return the shared :class:`ResultStore` instance."""
    return result_store

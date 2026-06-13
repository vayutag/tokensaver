"""Temporary file and result cleanup service.

The backend writes uploaded files and (transiently) conversion artifacts into
``settings.temp_storage_path``. While the request path removes each upload
immediately after conversion (Requirement 11.1), files belonging to crashed,
failed, or timed-out conversions can be orphaned on disk. This module provides
a defensive, time-based sweep that keeps temporary storage bounded.

Responsibilities (Requirements 11.2, 11.3, 11.4, 11.5):

- :func:`cleanup_expired_files` deletes files older than a retention window
  (default ``settings.result_retention_hours``) from a storage directory and
  reports how many files were removed and how many bytes were freed.
- :class:`CleanupService` runs that sweep on a schedule (every 15 minutes) as a
  cancellable background task and also performs an *emergency* sweep when the
  underlying disk is running low on free space.
- The in-memory :class:`~app.services.result_store.ResultStore` is purged in
  the same cycle so expired download results are dropped promptly.

The age of a file is determined from its modification time (``st_mtime``) which
is set when the upload is written, so an orphaned upload becomes eligible for
deletion ``max_age_hours`` after it was created. Deletion is best-effort: a
failure to remove one file is logged and the sweep continues
(Requirement 11.5).
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import time
from dataclasses import dataclass
from typing import Optional

from app.config import Settings, get_settings
from app.services.result_store import ResultStore, get_result_store

logger = logging.getLogger("markitdown.cleanup")


# ---------------------------------------------------------------------------
# Scheduling / threshold configuration
# ---------------------------------------------------------------------------

# The scheduled sweep runs every 15 minutes (Requirement 11.3).
CLEANUP_INTERVAL_SECONDS = 15 * 60

# Emergency cleanup triggers when free disk space drops below this fraction of
# the total capacity (Requirement 11.4). Expressed as a ratio in [0, 1].
LOW_DISK_FREE_RATIO = 0.10


@dataclass
class CleanupResult:
    """Outcome of a cleanup sweep.

    Attributes:
        deleted_count: Number of files successfully removed.
        bytes_freed: Total size in bytes of the removed files.
        errors: Number of files that could not be removed.
    """

    deleted_count: int = 0
    bytes_freed: int = 0
    errors: int = 0

    def merge(self, other: "CleanupResult") -> "CleanupResult":
        """Return a new result combining ``self`` and ``other``."""
        return CleanupResult(
            deleted_count=self.deleted_count + other.deleted_count,
            bytes_freed=self.bytes_freed + other.bytes_freed,
            errors=self.errors + other.errors,
        )


def cleanup_expired_files(
    storage_path: str,
    max_age_hours: int,
    *,
    now: Optional[float] = None,
) -> CleanupResult:
    """Delete files older than ``max_age_hours`` from ``storage_path``.

    Files are aged by their modification time. Subdirectories are not recursed
    into and are left untouched; only regular files directly inside
    ``storage_path`` are considered. Deletion is best-effort so that a single
    failure (e.g. a file locked by another process) never aborts the sweep
    (Requirement 11.5).

    Preconditions:
        - ``max_age_hours`` is a positive integer.

    Postconditions:
        - Every regular file in ``storage_path`` whose age is at least
          ``max_age_hours`` has been removed, unless removal failed.
        - The returned :class:`CleanupResult` accounts for every file removed
          and every removal failure.

    Validates: Requirements 11.2, 11.3, 11.5

    Args:
        storage_path: Directory to sweep.
        max_age_hours: Maximum age in hours before a file is removed.
        now: Optional override for the current time (epoch seconds); used by
            tests to make ages deterministic.

    Returns:
        A :class:`CleanupResult` summarizing the sweep.
    """
    result = CleanupResult()

    if max_age_hours <= 0:
        logger.warning(
            "cleanup_expired_files called with non-positive max_age_hours=%s; "
            "skipping to avoid deleting live files.",
            max_age_hours,
        )
        return result

    if not storage_path or not os.path.isdir(storage_path):
        logger.debug("Storage path %r does not exist; nothing to clean.", storage_path)
        return result

    current_time = time.time() if now is None else now
    max_age_seconds = max_age_hours * 60 * 60

    try:
        entries = os.scandir(storage_path)
    except OSError as exc:
        logger.warning("Failed to scan storage path %s: %s", storage_path, exc)
        return result

    with entries:
        for entry in entries:
            try:
                if not entry.is_file(follow_symlinks=False):
                    continue
                stat = entry.stat()
                age_seconds = current_time - stat.st_mtime
                if age_seconds < max_age_seconds:
                    continue
                size = stat.st_size
                os.remove(entry.path)
                result.deleted_count += 1
                result.bytes_freed += size
            except OSError as exc:
                result.errors += 1
                logger.warning(
                    "Failed to remove expired file %s: %s", entry.path, exc
                )

    if result.deleted_count or result.errors:
        logger.info(
            "Cleanup removed %d file(s), freed %d byte(s), %d error(s) from %s.",
            result.deleted_count,
            result.bytes_freed,
            result.errors,
            storage_path,
        )
    return result


def is_disk_space_low(
    storage_path: str,
    *,
    min_free_ratio: float = LOW_DISK_FREE_RATIO,
) -> bool:
    """Return ``True`` when free disk space is below ``min_free_ratio``.

    Uses :func:`shutil.disk_usage` on the filesystem backing ``storage_path``.
    If usage cannot be determined, returns ``False`` (treating an unknown disk
    as not-low) so cleanup decisions never crash the caller.

    Validates: Requirement 11.4

    Args:
        storage_path: A path on the filesystem to inspect.
        min_free_ratio: Minimum acceptable free-space fraction of total.

    Returns:
        ``True`` if the free fraction is below ``min_free_ratio``.
    """
    try:
        usage = shutil.disk_usage(storage_path)
    except OSError as exc:
        logger.warning("Could not determine disk usage for %s: %s", storage_path, exc)
        return False

    if usage.total <= 0:
        return False

    free_ratio = usage.free / usage.total
    return free_ratio < min_free_ratio


class CleanupService:
    """Schedules periodic and emergency cleanup of temporary storage.

    A single instance owns the background task. :meth:`start` launches the
    periodic loop and :meth:`stop` cancels it; both are safe to call from the
    FastAPI startup/shutdown handlers. Each cycle removes expired files from
    ``settings.temp_storage_path`` and purges expired entries from the shared
    :class:`ResultStore`. When disk space is low, an additional emergency sweep
    runs immediately (Requirement 11.4).

    Validates: Requirements 11.2, 11.3, 11.4, 11.5
    """

    def __init__(
        self,
        settings: Optional[Settings] = None,
        result_store: Optional[ResultStore] = None,
        *,
        interval_seconds: int = CLEANUP_INTERVAL_SECONDS,
        low_disk_free_ratio: float = LOW_DISK_FREE_RATIO,
    ) -> None:
        self._settings = settings or get_settings()
        self._result_store = result_store or get_result_store()
        self._interval_seconds = interval_seconds
        self._low_disk_free_ratio = low_disk_free_ratio
        self._task: Optional[asyncio.Task] = None

    @property
    def storage_path(self) -> str:
        """Directory swept by this service."""
        return self._settings.temp_storage_path

    @property
    def max_age_hours(self) -> int:
        """Retention window applied to temporary files."""
        return self._settings.result_retention_hours

    def run_once(self) -> CleanupResult:
        """Perform a single cleanup cycle and return the combined result.

        Removes expired temporary files, purges expired download results, and
        runs an emergency sweep when free disk space is low.

        Validates: Requirements 11.2, 11.3, 11.4, 11.5

        Returns:
            A :class:`CleanupResult` summarizing the files removed this cycle.
        """
        result = cleanup_expired_files(self.storage_path, self.max_age_hours)

        # Drop expired download results from the in-memory store so stale
        # entries are not retained beyond the retention window (Requirement
        # 11.2).
        purged = self._result_store.purge_expired()
        if purged:
            logger.info("Purged %d expired result(s) from the result store.", purged)

        # Emergency sweep when the disk is running low (Requirement 11.4).
        if is_disk_space_low(
            self.storage_path, min_free_ratio=self._low_disk_free_ratio
        ):
            logger.warning(
                "Low disk space detected on %s; running emergency cleanup.",
                self.storage_path,
            )
            emergency = self.emergency_cleanup()
            result = result.merge(emergency)

        return result

    def emergency_cleanup(self) -> CleanupResult:
        """Aggressively remove expired files to reclaim disk space.

        Triggered when free space is low. Reuses the same age-based sweep as
        the scheduled cycle so only expired files are removed (Requirement
        11.4); live results within the retention window are preserved.

        Returns:
            A :class:`CleanupResult` summarizing the emergency sweep.
        """
        return cleanup_expired_files(self.storage_path, self.max_age_hours)

    async def _run_loop(self) -> None:
        """Background loop running :meth:`run_once` every ``interval_seconds``."""
        logger.info(
            "Cleanup service started (interval=%ds, retention=%dh, path=%s).",
            self._interval_seconds,
            self.max_age_hours,
            self.storage_path,
        )
        try:
            while True:
                await asyncio.sleep(self._interval_seconds)
                try:
                    # Run the (blocking) filesystem sweep off the event loop.
                    await asyncio.to_thread(self.run_once)
                except Exception:  # noqa: BLE001 - never let the loop die
                    logger.exception("Unexpected error during cleanup cycle.")
        except asyncio.CancelledError:
            logger.info("Cleanup service stopping.")
            raise

    def start(self) -> None:
        """Launch the periodic cleanup background task (idempotent)."""
        if self._task is not None and not self._task.done():
            return
        self._task = asyncio.create_task(self._run_loop())

    async def stop(self) -> None:
        """Cancel the background task and wait for it to unwind."""
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        finally:
            self._task = None


# Module-level shared instance wired into the FastAPI lifecycle.
cleanup_service = CleanupService()


def get_cleanup_service() -> CleanupService:
    """Return the shared :class:`CleanupService` instance."""
    return cleanup_service

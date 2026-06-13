"""File processing service integrating the MarkItDown conversion library.

This module owns the conversion lifecycle for the backend:

- Initializing the MarkItDown library, including optional cloud-service
  configuration (Requirement 4.1, 8.x).
- Converting a single file to markdown with a hard timeout
  (Requirements 4.1, 4.2, 4.3, 4.4).
- Converting batches of files concurrently with a bounded concurrency limit
  of at most ``max_concurrent_conversions`` (default 5) simultaneous
  conversions (Requirements 4.5, 7.2).
- Persisting uploaded bytes to temporary storage and cleaning those files up
  afterwards, even on failure or timeout (Requirement 11.1, 11.5).
- Producing descriptive error messages for failures (Requirement 4.7).
- Extracting and structuring conversion metadata such as processing time,
  converter used, and file type (Requirement 4.4).

The synchronous ``MarkItDown.convert`` call is executed in a worker thread so
the conversion can be awaited and bounded by :func:`asyncio.wait_for`. Note
that a timed-out conversion returns a timeout error result immediately; the
underlying worker thread is left to finish on its own since Python cannot
forcibly cancel an arbitrary thread.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional

from app.config import Settings, get_settings
from app.services.cloud_clients import get_cloud_client
from app.services.file_validation import (
    ValidationResult,
    sanitize_filename,
    validate_file,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Cloud retry / fallback configuration
# ---------------------------------------------------------------------------
# When a cloud service is requested, transient rate-limit errors are retried
# with exponential backoff before giving up and falling back to local
# processing (Requirements 8.4, 8.5).
_MAX_CLOUD_ATTEMPTS = 3
_CLOUD_RETRY_BASE_DELAY = 0.5  # seconds; doubled on each subsequent attempt

# Model identifiers handed to MarkItDown's ``mlm_model`` parameter alongside the
# cloud client. MarkItDown 0.0.1a2 wires cloud/LLM assistance through the
# ``mlm_client`` / ``mlm_model`` pair; the model is advisory and ``None`` is an
# acceptable value for clients that do not require it.
_CLOUD_MODEL_BY_SERVICE: dict[str, Optional[str]] = {
    "azure_di": None,
    "azure_cu": None,
}


def _backoff_delay(attempt: int) -> float:
    """Return the exponential backoff delay (seconds) for a retry attempt.

    ``attempt`` is 1-based, so the delays grow as base, 2*base, 4*base, ...
    """
    return _CLOUD_RETRY_BASE_DELAY * (2 ** (attempt - 1))


def _is_rate_limit_error(exc: BaseException) -> bool:
    """Best-effort detection of rate-limit / throttling errors.

    Cloud SDKs surface throttling differently, so we inspect any HTTP status
    code attribute (``status_code`` / ``status``) for ``429`` and fall back to
    scanning the message text for common rate-limit phrasing.

    Validates: Requirement 8.5
    """
    for attr in ("status_code", "status"):
        code = getattr(exc, attr, None)
        if code == 429:
            return True

    message = str(exc).lower()
    return (
        "429" in message
        or "rate limit" in message
        or "rate-limit" in message
        or "too many requests" in message
        or "throttl" in message
    )


# ---------------------------------------------------------------------------
# Converter inference
# ---------------------------------------------------------------------------
# MarkItDown 0.0.1a2 does not expose which converter handled a file, so we
# infer a human-readable converter name from the file extension. This is used
# only for metadata reporting (Requirement 4.4) and never affects conversion.
_EXTENSION_TO_CONVERTER: dict[str, str] = {
    ".pdf": "PdfConverter",
    ".docx": "DocxConverter",
    ".doc": "DocxConverter",
    ".pptx": "PptxConverter",
    ".ppt": "PptxConverter",
    ".xlsx": "XlsxConverter",
    ".xls": "XlsxConverter",
    ".csv": "CsvConverter",
    ".html": "HtmlConverter",
    ".htm": "HtmlConverter",
    ".json": "PlainTextConverter",
    ".xml": "PlainTextConverter",
    ".txt": "PlainTextConverter",
    ".md": "PlainTextConverter",
    ".jpg": "ImageConverter",
    ".jpeg": "ImageConverter",
    ".png": "ImageConverter",
    ".gif": "ImageConverter",
    ".bmp": "ImageConverter",
    ".tiff": "ImageConverter",
    ".tif": "ImageConverter",
    ".webp": "ImageConverter",
    ".mp3": "AudioConverter",
    ".wav": "AudioConverter",
    ".m4a": "AudioConverter",
    ".ogg": "AudioConverter",
    ".flac": "AudioConverter",
    ".epub": "EpubConverter",
    ".zip": "ZipConverter",
}

_DEFAULT_CONVERTER_NAME = "UnknownConverter"


@dataclass
class ProcessingOptions:
    """Options controlling a single conversion.

    Attributes:
        cloud_service: Optional cloud service identifier (``"azure_di"`` or
            ``"azure_cu"``) requesting enhanced conversion quality.
        extract_images: Whether to attempt image extraction/description.
        timeout: Maximum conversion time in seconds. Must be positive.
    """

    cloud_service: Optional[str] = None
    extract_images: bool = True
    timeout: int = 30


@dataclass
class ProcessingMetadata:
    """Structured metadata describing a conversion attempt.

    Validates: Requirement 4.4
    """

    file_type: str
    file_size: int
    processing_time: float
    converter_used: str
    image_count: Optional[int] = None
    page_count: Optional[int] = None


@dataclass
class ProcessingResult:
    """Outcome of converting a single file.

    Attributes:
        success: ``True`` when conversion produced markdown content.
        markdown: The converted markdown (empty string on failure).
        error: Descriptive error message when ``success`` is ``False``.
        metadata: Structured metadata about the conversion.
        cloud_fallback: ``True`` when a cloud service was requested but the
            conversion ultimately used local processing (because the cloud
            service was unavailable or failed). Lets the caller indicate
            reduced result quality to the user (Requirement 8.6).
    """

    success: bool
    metadata: ProcessingMetadata
    markdown: str = ""
    error: Optional[str] = None
    cloud_fallback: bool = False


def _infer_converter_used(path: str) -> str:
    """Infer a human-readable converter name from a file path's extension."""
    ext = os.path.splitext(path)[1].lower()
    return _EXTENSION_TO_CONVERTER.get(ext, _DEFAULT_CONVERTER_NAME)


def _detect_file_type(path: str) -> str:
    """Best-effort MIME type detection for metadata, based on extension."""
    import mimetypes

    mime, _ = mimetypes.guess_type(path)
    return mime or "application/octet-stream"


class FileProcessor:
    """Coordinates file conversion via the MarkItDown library.

    A single instance owns an :class:`asyncio.Semaphore` that bounds the
    number of concurrent conversions to ``settings.max_concurrent_conversions``
    (Requirements 4.5, 7.2). The instance is safe to share across requests
    within a single event loop.
    """

    def __init__(self, settings: Optional[Settings] = None) -> None:
        self._settings = settings or get_settings()
        self._semaphore = asyncio.Semaphore(
            self._settings.max_concurrent_conversions
        )

    # ------------------------------------------------------------------
    # MarkItDown initialization
    # ------------------------------------------------------------------
    def _create_markitdown(
        self,
        cloud_service: Optional[str],
        *,
        use_cloud: bool = True,
    ) -> tuple["object", bool]:
        """Instantiate a MarkItDown client configured for the request.

        When a cloud service is requested and ``use_cloud`` is ``True``, the
        appropriate client is obtained via
        :func:`app.services.cloud_clients.get_cloud_client` and wired into
        MarkItDown. MarkItDown 0.0.1a2 accepts an ``mlm_client`` / ``mlm_model``
        pair through which both Azure Document Intelligence and Azure Content
        Understanding clients are supplied (Requirements 8.1, 8.2, 8.3).

        If a cloud service is requested but not configured/available,
        :func:`get_cloud_client` returns ``None`` and we transparently build a
        local-only client instead, rather than failing (Requirement 8.4).

        Validates: Requirements 4.1, 8.1, 8.2, 8.3, 8.4

        Args:
            cloud_service: Requested cloud service identifier (or ``None``).
            use_cloud: When ``False``, build a local-only client even if a
                cloud service is requested. Used for the fallback path.

        Returns:
            A tuple ``(markitdown, cloud_used)`` where ``cloud_used`` indicates
            whether a cloud client was successfully wired in.
        """
        # Imported lazily so that importing this module does not require the
        # (heavy) markitdown dependency to be installed at import time.
        from markitdown import MarkItDown

        mlm_client = None
        mlm_model = None
        cloud_used = False

        if use_cloud and cloud_service:
            client = get_cloud_client(cloud_service, self._settings)
            if client is not None:
                mlm_client = client
                mlm_model = _CLOUD_MODEL_BY_SERVICE.get(cloud_service)
                cloud_used = True
                logger.info(
                    "Configured MarkItDown with cloud service '%s'.",
                    cloud_service,
                )
            else:
                logger.warning(
                    "Cloud service '%s' requested but unavailable; "
                    "falling back to local processing.",
                    cloud_service,
                )

        markitdown = MarkItDown(mlm_client=mlm_client, mlm_model=mlm_model)
        return markitdown, cloud_used

    def _convert_with_retry(self, markitdown: "object", file_path: str) -> str:
        """Convert ``file_path`` using a cloud-backed MarkItDown with retries.

        Rate-limit / throttling errors are retried with exponential backoff up
        to :data:`_MAX_CLOUD_ATTEMPTS` attempts. Non-rate-limit errors are
        raised immediately so the caller can fall back to local processing.
        When all retries are exhausted, the final exception propagates.

        Validates: Requirement 8.5

        Args:
            markitdown: A cloud-configured MarkItDown instance.
            file_path: Path to the file to convert.

        Returns:
            The converted markdown text.

        Raises:
            Exception: The underlying conversion error if all attempts fail or
                a non-retryable error occurs.
        """
        last_exc: Optional[BaseException] = None
        for attempt in range(1, _MAX_CLOUD_ATTEMPTS + 1):
            try:
                result = markitdown.convert(file_path)
                return result.text_content or ""
            except Exception as exc:  # noqa: BLE001 - inspected for rate limit
                last_exc = exc
                if _is_rate_limit_error(exc) and attempt < _MAX_CLOUD_ATTEMPTS:
                    delay = _backoff_delay(attempt)
                    logger.warning(
                        "Cloud service rate-limited (attempt %d/%d); "
                        "retrying in %.2fs.",
                        attempt,
                        _MAX_CLOUD_ATTEMPTS,
                        delay,
                    )
                    time.sleep(delay)
                    continue
                raise

        # Defensive: the loop always returns or raises, but guard anyway.
        assert last_exc is not None
        raise last_exc

    # ------------------------------------------------------------------
    # Temporary file storage
    # ------------------------------------------------------------------
    def save_temp_file(self, content: bytes, filename: str) -> str:
        """Persist uploaded bytes to temporary storage and return the path.

        The stored filename is prefixed with a UUID to avoid collisions while
        preserving the original (sanitized) name and extension so MarkItDown
        can infer the correct converter.

        Validates: Requirement 11.1

        Args:
            content: Raw file bytes.
            filename: Original (untrusted) client filename.

        Returns:
            Absolute path to the written temporary file.
        """
        safe_name = sanitize_filename(filename)
        unique_name = f"{uuid.uuid4().hex}_{safe_name}"
        storage_dir = self._settings.temp_storage_path
        os.makedirs(storage_dir, exist_ok=True)
        temp_path = os.path.join(storage_dir, unique_name)

        with open(temp_path, "wb") as handle:
            handle.write(content)

        return temp_path

    async def save_temp_file_async(self, content: bytes, filename: str) -> str:
        """Asynchronously persist uploaded bytes to temporary storage.

        Writing potentially large uploads to disk is blocking I/O. Offloading
        it to a worker thread keeps the event loop responsive so other
        concurrent requests are not stalled while bytes are flushed to disk
        (Requirement 12.4). Delegates to :meth:`save_temp_file` in the thread.

        Validates: Requirements 11.1, 12.4

        Args:
            content: Raw file bytes.
            filename: Original (untrusted) client filename.

        Returns:
            Absolute path to the written temporary file.
        """
        return await asyncio.to_thread(self.save_temp_file, content, filename)

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------
    def validate_file(self, file_path: str) -> ValidationResult:
        """Validate a file already written to disk.

        Reads the file content and delegates to the shared
        :func:`validate_file` routine which performs magic-byte detection,
        size, and safety checks.

        Args:
            file_path: Path to the file to validate.

        Returns:
            A :class:`ValidationResult` describing the outcome.
        """
        if not os.path.exists(file_path):
            return ValidationResult(
                valid=False,
                error=f"File not found: {file_path}",
            )

        with open(file_path, "rb") as handle:
            content = handle.read()

        return validate_file(
            content=content,
            filename=os.path.basename(file_path),
            settings=self._settings,
        )

    # ------------------------------------------------------------------
    # Single file conversion
    # ------------------------------------------------------------------
    async def process_file(
        self,
        file_path: str,
        options: Optional[ProcessingOptions] = None,
    ) -> ProcessingResult:
        """Convert a single file to markdown with timeout handling.

        Preconditions:
            - ``file_path`` exists and is readable.
            - ``options.timeout`` is a positive integer.

        Postconditions:
            - Returns a :class:`ProcessingResult` with ``success=True`` and
              markdown content when conversion succeeds.
            - Returns a :class:`ProcessingResult` with ``success=False`` and a
              descriptive error message when conversion fails or times out.
            - ``metadata.processing_time`` reflects the elapsed wall-clock time.

        Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.7

        Args:
            file_path: Path to the file to convert.
            options: Conversion options; defaults to the configured timeout.

        Returns:
            A :class:`ProcessingResult`.
        """
        if options is None:
            options = ProcessingOptions(timeout=self._settings.conversion_timeout)

        start_time = time.monotonic()
        file_type = _detect_file_type(file_path)
        converter_used = _infer_converter_used(file_path)
        try:
            file_size = os.path.getsize(file_path)
        except OSError:
            file_size = 0

        def _build_metadata() -> ProcessingMetadata:
            return ProcessingMetadata(
                file_type=file_type,
                file_size=file_size,
                processing_time=time.monotonic() - start_time,
                converter_used=converter_used,
            )

        # Guard against a non-existent file before invoking the converter.
        if not os.path.exists(file_path):
            return ProcessingResult(
                success=False,
                error=f"File not found: {file_path}",
                metadata=_build_metadata(),
            )

        # Run the blocking conversion in a worker thread, bounded by timeout.
        loop = asyncio.get_event_loop()

        def _convert() -> tuple[str, bool]:
            """Convert the file, preferring cloud and falling back to local.

            Returns ``(markdown, cloud_fallback)`` where ``cloud_fallback`` is
            ``True`` when a cloud service was requested but local processing
            was ultimately used (Requirements 8.4, 8.5, 8.6).
            """
            # Attempt cloud-backed conversion first when requested.
            if options.cloud_service:
                markitdown, cloud_used = self._create_markitdown(
                    options.cloud_service
                )
                if cloud_used:
                    try:
                        text = self._convert_with_retry(markitdown, file_path)
                        return text, False
                    except Exception as exc:  # noqa: BLE001 - fall back locally
                        logger.warning(
                            "Cloud conversion via '%s' failed: %s; "
                            "falling back to local processing.",
                            options.cloud_service,
                            exc,
                        )
                # Cloud requested but unavailable or failed -> local fallback.
                local_md, _ = self._create_markitdown(
                    options.cloud_service, use_cloud=False
                )
                result = local_md.convert(file_path)
                return (result.text_content or ""), True

            # No cloud service requested: straight local conversion.
            markitdown, _ = self._create_markitdown(options.cloud_service)
            result = markitdown.convert(file_path)
            return (result.text_content or ""), False

        cloud_fallback = False
        try:
            markdown_text, cloud_fallback = await asyncio.wait_for(
                loop.run_in_executor(None, _convert),
                timeout=options.timeout,
            )
        except asyncio.TimeoutError:
            logger.warning(
                "Conversion timed out after %ss for %s",
                options.timeout,
                os.path.basename(file_path),
            )
            return ProcessingResult(
                success=False,
                error=(
                    f"Conversion timed out after {options.timeout} seconds. "
                    "Try a smaller file or a different format."
                ),
                metadata=_build_metadata(),
            )
        except Exception as exc:  # noqa: BLE001 - surface a clean message
            logger.exception("Conversion failed for %s", os.path.basename(file_path))
            return ProcessingResult(
                success=False,
                error=f"Conversion failed: {exc}",
                metadata=_build_metadata(),
            )

        if cloud_fallback:
            logger.info(
                "Conversion for %s completed via local fallback after a cloud "
                "service was requested (reduced quality possible).",
                os.path.basename(file_path),
            )

        return ProcessingResult(
            success=True,
            markdown=markdown_text,
            metadata=_build_metadata(),
            cloud_fallback=cloud_fallback,
        )

    # ------------------------------------------------------------------
    # Batch conversion
    # ------------------------------------------------------------------
    async def process_batch(
        self,
        file_paths: list[str],
        options: Optional[ProcessingOptions] = None,
    ) -> list[ProcessingResult]:
        """Convert multiple files concurrently with a bounded concurrency.

        At most ``settings.max_concurrent_conversions`` (default 5) files are
        converted simultaneously. Every file is processed regardless of
        individual failures, and results are returned in the same order as the
        input paths (Requirements 4.5, 7.2, 7.3, 7.4).

        Preconditions:
            - ``file_paths`` is a list of file paths.

        Postconditions:
            - Returns a list of :class:`ProcessingResult` of the same length as
              ``file_paths``, with results aligned by index.

        Validates: Requirements 4.5, 7.2

        Args:
            file_paths: Paths of the files to convert.
            options: Conversion options applied to every file.

        Returns:
            A list of :class:`ProcessingResult` aligned to ``file_paths``.
        """
        if not file_paths:
            return []

        async def _convert_with_limit(path: str) -> ProcessingResult:
            async with self._semaphore:
                return await self.process_file(path, options)

        tasks = [_convert_with_limit(path) for path in file_paths]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        processed: list[ProcessingResult] = []
        for path, result in zip(file_paths, results):
            if isinstance(result, Exception):
                logger.exception(
                    "Unexpected error processing %s", os.path.basename(path)
                )
                file_type = _detect_file_type(path)
                try:
                    file_size = os.path.getsize(path)
                except OSError:
                    file_size = 0
                processed.append(
                    ProcessingResult(
                        success=False,
                        error=f"Unexpected error: {result}",
                        metadata=ProcessingMetadata(
                            file_type=file_type,
                            file_size=file_size,
                            processing_time=0.0,
                            converter_used=_infer_converter_used(path),
                        ),
                    )
                )
            else:
                processed.append(result)

        assert len(processed) == len(file_paths)
        return processed

    # ------------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------------
    async def cleanup(self, file_paths: list[str]) -> None:
        """Delete temporary files, ignoring individual failures.

        Cleanup is best-effort: a failure to remove one file is logged but does
        not prevent removal of the others. This is invoked after conversion
        completes, fails, or times out (Requirements 11.1, 11.5).

        Args:
            file_paths: Paths of temporary files to remove.
        """
        for path in file_paths:
            self.cleanup_file(path)

    def cleanup_file(self, file_path: str) -> bool:
        """Remove a single temporary file if it exists.

        Validates: Requirements 11.1, 11.5

        Args:
            file_path: Path of the file to remove.

        Returns:
            ``True`` if the file was removed, ``False`` otherwise.
        """
        try:
            if file_path and os.path.exists(file_path):
                os.remove(file_path)
                return True
        except OSError as exc:
            logger.warning("Failed to remove temp file %s: %s", file_path, exc)
        return False


# Module-level convenience instance for the API layer to import.
file_processor = FileProcessor()


def get_file_processor() -> FileProcessor:
    """Return the shared :class:`FileProcessor` instance."""
    return file_processor

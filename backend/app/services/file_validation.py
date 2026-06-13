"""
File validation service for the MarkItDown Website backend.

This module provides security-focused validation of uploaded files before they
are passed to the conversion pipeline. Validation includes:

- Magic bytes (content) based MIME type detection, not extension trust alone
  (Requirement 2.5, 13.2)
- File size validation against the configured limit (Requirement 2.x)
- Filename sanitization to prevent path traversal attacks (Requirement 13.4)
- Rejection of executable file types such as .exe, .dll, .sh, .bat, .cmd
  (Requirement 13.3)

The public entry point is :func:`validate_file`, which returns a
:class:`ValidationResult` describing whether the file is acceptable and, when
not, a detailed human-readable error message (Requirement 2.6).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

from app.config import Settings, get_settings


# ---------------------------------------------------------------------------
# Supported formats
# ---------------------------------------------------------------------------
# MarkItDown supports a range of document, image, audio, and text formats.
# These MIME types are the ones the backend will accept after magic-bytes
# detection. Keeping this set here keeps the validation service self-contained;
# it can be promoted to a shared constants module (task 1.3) later.
SUPPORTED_MIME_TYPES: frozenset[str] = frozenset(
    {
        # Documents
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",  # docx
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",  # pptx
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",  # xlsx
        "application/epub+zip",
        "application/zip",
        # Images
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/bmp",
        "image/tiff",
        "image/webp",
        # Audio
        "audio/mpeg",
        "audio/wav",
        "audio/x-wav",
        # Text / markup
        "text/html",
        "text/plain",
        "text/csv",
        "text/markdown",
        "application/json",
        "application/xml",
        "text/xml",
    }
)

# Human-friendly list of formats used in error messages (Requirement 2.4).
SUPPORTED_FORMATS_DISPLAY: tuple[str, ...] = (
    "PDF",
    "Word (DOCX)",
    "PowerPoint (PPTX)",
    "Excel (XLSX)",
    "EPUB",
    "Images (PNG, JPEG, GIF, BMP, TIFF, WEBP)",
    "Audio (MP3, WAV)",
    "HTML",
    "Text (TXT, CSV, Markdown)",
    "JSON",
    "XML",
)

# Executable / script extensions that must always be rejected (Requirement 13.3).
BLOCKED_EXECUTABLE_EXTENSIONS: frozenset[str] = frozenset(
    {".exe", ".dll", ".sh", ".bat", ".cmd"}
)

# Number of bytes to inspect for magic-byte detection.
_MAGIC_HEADER_SIZE = 64


@dataclass
class ValidationResult:
    """Result of validating a single uploaded file.

    Attributes:
        valid: ``True`` when the file passes every validation check.
        error: A detailed, user-facing error message when ``valid`` is
            ``False``; ``None`` otherwise.
        detected_type: The MIME type detected from the file content when it
            could be determined.
        sanitized_filename: The safe filename with any path components removed,
            suitable for use when writing to temporary storage.
    """

    valid: bool
    error: Optional[str] = None
    detected_type: Optional[str] = None
    sanitized_filename: Optional[str] = None


def sanitize_filename(filename: str) -> str:
    """Sanitize a filename to prevent path traversal attacks.

    Strips any directory components (both POSIX ``/`` and Windows ``\\``
    separators), removes traversal sequences, and discards leading dots and
    other unsafe characters. Always returns a non-empty basename; if nothing
    safe remains, ``"unnamed"`` is returned.

    Validates: Requirement 13.4

    Args:
        filename: The original (untrusted) filename supplied by the client.

    Returns:
        A safe filename containing no directory components.
    """
    if not filename:
        return "unnamed"

    # Normalize Windows separators to forward slashes, then take the last path
    # segment so embedded directory traversal (e.g. "../../etc/passwd" or
    # "..\\..\\windows\\system32") cannot escape the storage directory.
    normalized = filename.replace("\\", "/")
    base = normalized.split("/")[-1]

    # Reject any residual traversal tokens and null bytes.
    base = base.replace("\x00", "")
    if base in ("", ".", ".."):
        return "unnamed"

    # Keep only a conservative set of safe characters.
    safe_chars = []
    for ch in base:
        if ch.isalnum() or ch in ("-", "_", ".", " "):
            safe_chars.append(ch)
        else:
            safe_chars.append("_")
    sanitized = "".join(safe_chars).strip()

    # Strip leading dots so we never produce hidden/relative-looking names.
    sanitized = sanitized.lstrip(".")

    if not sanitized:
        return "unnamed"

    return sanitized


def _get_extension(filename: str) -> str:
    """Return the lowercase extension (including dot) of a filename."""
    return os.path.splitext(filename)[1].lower()


def detect_mime_type(content: bytes) -> Optional[str]:
    """Detect the MIME type of a file from its magic bytes.

    Inspects the leading bytes of the file content against a table of known
    signatures. Container formats based on ZIP (DOCX, PPTX, XLSX, EPUB) are
    reported generically as ``application/zip`` because distinguishing them
    requires inspecting the archive contents; the ZIP MIME type is accepted by
    the supported-types set so these documents pass validation.

    Validates: Requirements 2.5, 13.2

    Args:
        content: The raw bytes of the file (at least the leading header).

    Returns:
        The detected MIME type string, or ``None`` if it could not be
        determined from the content.
    """
    if not content:
        return None

    header = content[:_MAGIC_HEADER_SIZE]

    # PDF
    if header.startswith(b"%PDF"):
        return "application/pdf"

    # ZIP-based containers (docx, pptx, xlsx, epub, plain zip)
    if header.startswith((b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")):
        return "application/zip"

    # PNG
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"

    # JPEG
    if header.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"

    # GIF
    if header.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"

    # BMP
    if header.startswith(b"BM"):
        return "image/bmp"

    # TIFF (little-endian and big-endian)
    if header.startswith((b"II*\x00", b"MM\x00*")):
        return "image/tiff"

    # RIFF containers: WEBP (image) and WAV (audio)
    if header.startswith(b"RIFF") and len(header) >= 12:
        riff_type = header[8:12]
        if riff_type == b"WEBP":
            return "image/webp"
        if riff_type == b"WAVE":
            return "audio/wav"

    # MP3: ID3 tag or MPEG audio frame sync
    if header.startswith(b"ID3"):
        return "audio/mpeg"
    if len(header) >= 2 and header[0] == 0xFF and (header[1] & 0xE0) == 0xE0:
        return "audio/mpeg"

    # HTML (case-insensitive check on a leading, whitespace-trimmed slice)
    stripped = header.lstrip()
    lowered = stripped[:15].lower()
    if lowered.startswith((b"<!doctype html", b"<html")):
        return "text/html"

    return None


def detect_executable(content: bytes) -> bool:
    """Detect whether file content represents an executable or script.

    Recognizes common executable/script signatures regardless of the declared
    extension so that an executable renamed to a benign extension is still
    rejected.

    Validates: Requirement 13.3

    Args:
        content: The raw bytes of the file.

    Returns:
        ``True`` if the content looks like an executable or script.
    """
    if not content:
        return False

    header = content[:_MAGIC_HEADER_SIZE]

    # Windows PE / DOS executables (.exe, .dll): "MZ"
    if header.startswith(b"MZ"):
        return True

    # ELF binaries (Linux executables / shared objects)
    if header.startswith(b"\x7fELF"):
        return True

    # Mach-O binaries (macOS)
    macho_signatures = (
        b"\xfe\xed\xfa\xce",
        b"\xfe\xed\xfa\xcf",
        b"\xce\xfa\xed\xfe",
        b"\xcf\xfa\xed\xfe",
    )
    if header.startswith(macho_signatures):
        return True

    # Shell scripts via shebang
    if header.startswith(b"#!"):
        return True

    return False


def validate_file(
    content: bytes,
    filename: str,
    settings: Optional[Settings] = None,
) -> ValidationResult:
    """Validate an uploaded file for size, type, and safety.

    The validation pipeline, in order:

    1. Sanitize the filename to neutralize path traversal (Requirement 13.4).
    2. Reject blocked executable extensions (Requirement 13.3).
    3. Reject content whose magic bytes indicate an executable/script
       (Requirement 13.3).
    4. Enforce the configured maximum file size.
    5. Detect the MIME type from magic bytes and ensure it is supported
       (Requirements 2.5, 13.2).

    The returned :class:`ValidationResult` carries a detailed error message on
    failure so callers (e.g. the API layer) can surface it in a 400 response
    (Requirement 2.6).

    Args:
        content: The raw bytes of the uploaded file.
        filename: The original filename provided by the client.
        settings: Optional settings instance; defaults to the global settings.

    Returns:
        A :class:`ValidationResult` describing the outcome.
    """
    if settings is None:
        settings = get_settings()

    sanitized = sanitize_filename(filename)
    extension = _get_extension(sanitized)

    # 1. Reject blocked executable extensions outright.
    if extension in BLOCKED_EXECUTABLE_EXTENSIONS:
        return ValidationResult(
            valid=False,
            error=(
                f"Executable file type '{extension}' is not allowed for "
                "security reasons."
            ),
            sanitized_filename=sanitized,
        )

    # 2. Reject empty files - nothing to detect or convert.
    if not content:
        return ValidationResult(
            valid=False,
            error="The uploaded file is empty.",
            sanitized_filename=sanitized,
        )

    # 3. Reject executable/script content by inspecting magic bytes.
    if detect_executable(content):
        return ValidationResult(
            valid=False,
            error=(
                "The uploaded file appears to be an executable or script, "
                "which is not allowed for security reasons."
            ),
            sanitized_filename=sanitized,
        )

    # 4. Enforce the configured maximum file size. A limit of 0 (or negative)
    #    means "no limit" - files of any size are accepted.
    file_size = len(content)
    if settings.max_file_size > 0 and file_size > settings.max_file_size:
        limit_mb = settings.max_file_size / (1024 * 1024)
        actual_mb = file_size / (1024 * 1024)
        return ValidationResult(
            valid=False,
            error=(
                f"File size {actual_mb:.2f}MB exceeds the maximum allowed "
                f"limit of {limit_mb:.0f}MB."
            ),
            sanitized_filename=sanitized,
        )

    # 5. Detect MIME type from content and validate against supported types.
    detected_type = detect_mime_type(content)
    if detected_type is None:
        supported = ", ".join(SUPPORTED_FORMATS_DISPLAY)
        return ValidationResult(
            valid=False,
            error=(
                "Could not determine the file type from its content. "
                f"Supported formats are: {supported}."
            ),
            sanitized_filename=sanitized,
        )

    if detected_type not in SUPPORTED_MIME_TYPES:
        supported = ", ".join(SUPPORTED_FORMATS_DISPLAY)
        return ValidationResult(
            valid=False,
            error=(
                f"Unsupported file type '{detected_type}'. "
                f"Supported formats are: {supported}."
            ),
            detected_type=detected_type,
            sanitized_filename=sanitized,
        )

    # All checks passed.
    return ValidationResult(
        valid=True,
        detected_type=detected_type,
        sanitized_filename=sanitized,
    )

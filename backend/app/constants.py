"""Shared application constants for the MarkItDown Website backend.

Centralises supported MIME types, file size limits, timeout defaults,
and API endpoint paths. Runtime-configurable values (max file size,
timeout, concurrency) have their canonical source in ``app.config`` and
are mirrored here only as defaults; prefer ``get_settings()`` when a
configured value is required.

Task 1.3 - Shared constants.
Validates: Requirements 2.3, 2.4, 4.2, 14.5
"""

# ---------------------------------------------------------------------------
# File size limits
# ---------------------------------------------------------------------------

# Default maximum upload size in bytes (50MB). Mirrors the backend config
# default and the frontend client-side limit (Requirements 2.1, 2.2).
DEFAULT_MAX_FILE_SIZE: int = 50 * 1024 * 1024

# ---------------------------------------------------------------------------
# Timeout / concurrency defaults
# ---------------------------------------------------------------------------

# Default per-file conversion timeout in seconds (Requirement 4.2).
DEFAULT_CONVERSION_TIMEOUT_SECONDS: int = 30

# Allowed bounds for the conversion timeout (Requirement 4.2).
MIN_CONVERSION_TIMEOUT_SECONDS: int = 1
MAX_CONVERSION_TIMEOUT_SECONDS: int = 300

# Maximum number of files processed concurrently (Requirement 4.5, 7.2).
DEFAULT_MAX_CONCURRENT_CONVERSIONS: int = 5

# ---------------------------------------------------------------------------
# Supported MIME types
# ---------------------------------------------------------------------------

# Supported MIME types grouped by document category. Used for validation
# and for reporting supported formats via the health endpoint.
SUPPORTED_MIME_TYPE_GROUPS: dict[str, list[str]] = {
    "pdf": ["application/pdf"],
    "word": [
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",  # .docx
        "application/msword",  # .doc
    ],
    "powerpoint": [
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",  # .pptx
        "application/vnd.ms-powerpoint",  # .ppt
    ],
    "excel": [
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",  # .xlsx
        "application/vnd.ms-excel",  # .xls
    ],
    "image": [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/bmp",
        "image/tiff",
        "image/webp",
    ],
    "audio": [
        "audio/mpeg",  # .mp3
        "audio/wav",
        "audio/x-wav",
        "audio/mp4",  # .m4a
        "audio/ogg",
        "audio/flac",
    ],
    "html": ["text/html"],
}

# Flat, canonical list of all supported MIME types (Requirements 2.3, 2.4).
SUPPORTED_MIME_TYPES: list[str] = [
    mime_type
    for group in SUPPORTED_MIME_TYPE_GROUPS.values()
    for mime_type in group
]

# Human-readable labels for supported formats, used in error messages and
# the health endpoint response (Requirements 2.4, 15.3).
SUPPORTED_FORMAT_LABELS: list[str] = [
    "PDF",
    "Word (DOC, DOCX)",
    "PowerPoint (PPT, PPTX)",
    "Excel (XLS, XLSX)",
    "Images (JPEG, PNG, GIF, BMP, TIFF, WebP)",
    "Audio (MP3, WAV, M4A, OGG, FLAC)",
    "HTML",
]

# ---------------------------------------------------------------------------
# Security: blocked executable file types
# ---------------------------------------------------------------------------

# Executable file extensions that must always be rejected (Requirement 13.3).
BLOCKED_FILE_EXTENSIONS: list[str] = [
    ".exe",
    ".dll",
    ".sh",
    ".bat",
    ".cmd",
]

# ---------------------------------------------------------------------------
# API endpoint paths
# ---------------------------------------------------------------------------

API_PREFIX: str = "/api"


class ApiEndpoints:
    """API endpoint paths exposed by the backend (Requirement 14.x)."""

    CONVERT: str = f"{API_PREFIX}/convert"
    HEALTH: str = f"{API_PREFIX}/health"
    # Path template for the download endpoint; ``result_id`` is the path param.
    DOWNLOAD: str = f"{API_PREFIX}/download/{{result_id}}"

    @staticmethod
    def download(result_id: str) -> str:
        """Build the download path for a given result ID."""
        return f"{API_PREFIX}/download/{result_id}"

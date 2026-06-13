"""Services package.

Contains business logic such as file validation, the MarkItDown file
processor, and cleanup services.
"""

from app.services.file_processor import (
    FileProcessor,
    ProcessingMetadata,
    ProcessingOptions,
    ProcessingResult,
    file_processor,
    get_file_processor,
)
from app.services.file_validation import (
    BLOCKED_EXECUTABLE_EXTENSIONS,
    SUPPORTED_FORMATS_DISPLAY,
    SUPPORTED_MIME_TYPES,
    ValidationResult,
    detect_executable,
    detect_mime_type,
    sanitize_filename,
    validate_file,
)
from app.services.metrics import (
    MetricsCollector,
    MetricsSnapshot,
    get_metrics_collector,
    metrics_collector,
)

__all__ = [
    "BLOCKED_EXECUTABLE_EXTENSIONS",
    "SUPPORTED_FORMATS_DISPLAY",
    "SUPPORTED_MIME_TYPES",
    "ValidationResult",
    "detect_executable",
    "detect_mime_type",
    "sanitize_filename",
    "validate_file",
    "FileProcessor",
    "ProcessingMetadata",
    "ProcessingOptions",
    "ProcessingResult",
    "file_processor",
    "get_file_processor",
    "MetricsCollector",
    "MetricsSnapshot",
    "get_metrics_collector",
    "metrics_collector",
]

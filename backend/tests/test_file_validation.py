"""Unit tests for the file validation service.

Covers magic-bytes MIME detection, file size limits, filename sanitization,
executable rejection, and the overall validate_file pipeline.

Requirements: 2.5, 2.6, 13.2, 13.3, 13.4
"""

import pytest

from app.config import Settings
from app.services.file_validation import (
    SUPPORTED_MIME_TYPES,
    ValidationResult,
    detect_executable,
    detect_mime_type,
    sanitize_filename,
    validate_file,
)


# Minimal valid magic-byte headers for supported formats.
PDF_BYTES = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
JPEG_BYTES = b"\xff\xd8\xff\xe0" + b"\x00" * 16
GIF_BYTES = b"GIF89a" + b"\x00" * 16
ZIP_BYTES = b"PK\x03\x04" + b"\x00" * 20  # docx/pptx/xlsx/epub container
WEBP_BYTES = b"RIFF\x00\x00\x00\x00WEBP" + b"\x00" * 8
WAV_BYTES = b"RIFF\x00\x00\x00\x00WAVE" + b"\x00" * 8
MP3_BYTES = b"ID3\x03\x00\x00\x00" + b"\x00" * 16
HTML_BYTES = b"<!DOCTYPE html>\n<html><body>hi</body></html>"

EXE_BYTES = b"MZ\x90\x00" + b"\x00" * 16
ELF_BYTES = b"\x7fELF" + b"\x00" * 16
SHELL_BYTES = b"#!/bin/bash\necho hi\n"


@pytest.fixture
def settings() -> Settings:
    """Settings with a small (1MB) limit for predictable size tests."""
    return Settings(max_file_size=1 * 1024 * 1024)


# ---------------------------------------------------------------------------
# detect_mime_type
# ---------------------------------------------------------------------------
class TestDetectMimeType:
    @pytest.mark.parametrize(
        "content,expected",
        [
            (PDF_BYTES, "application/pdf"),
            (PNG_BYTES, "image/png"),
            (JPEG_BYTES, "image/jpeg"),
            (GIF_BYTES, "image/gif"),
            (ZIP_BYTES, "application/zip"),
            (WEBP_BYTES, "image/webp"),
            (WAV_BYTES, "audio/wav"),
            (MP3_BYTES, "audio/mpeg"),
            (HTML_BYTES, "text/html"),
            (b"BM" + b"\x00" * 16, "image/bmp"),
            (b"II*\x00" + b"\x00" * 16, "image/tiff"),
            (b"MM\x00*" + b"\x00" * 16, "image/tiff"),
        ],
    )
    def test_detects_known_signatures(self, content, expected):
        assert detect_mime_type(content) == expected

    def test_returns_none_for_unknown(self):
        assert detect_mime_type(b"\x01\x02\x03 random bytes") is None

    def test_returns_none_for_empty(self):
        assert detect_mime_type(b"") is None

    def test_all_detected_image_types_are_supported(self):
        # Sanity: detected types for our fixtures are in the supported set.
        for content in (PNG_BYTES, JPEG_BYTES, GIF_BYTES, WEBP_BYTES):
            assert detect_mime_type(content) in SUPPORTED_MIME_TYPES


# ---------------------------------------------------------------------------
# detect_executable
# ---------------------------------------------------------------------------
class TestDetectExecutable:
    @pytest.mark.parametrize("content", [EXE_BYTES, ELF_BYTES, SHELL_BYTES])
    def test_detects_executables(self, content):
        assert detect_executable(content) is True

    @pytest.mark.parametrize("content", [PDF_BYTES, PNG_BYTES, HTML_BYTES])
    def test_non_executables_pass(self, content):
        assert detect_executable(content) is False

    def test_empty_is_not_executable(self):
        assert detect_executable(b"") is False


# ---------------------------------------------------------------------------
# sanitize_filename
# ---------------------------------------------------------------------------
class TestSanitizeFilename:
    def test_strips_posix_path_traversal(self):
        assert sanitize_filename("../../etc/passwd") == "passwd"

    def test_strips_windows_path_traversal(self):
        assert sanitize_filename("..\\..\\windows\\system32\\cmd") == "cmd"

    def test_keeps_simple_name(self):
        assert sanitize_filename("report.pdf") == "report.pdf"

    def test_removes_null_bytes(self):
        assert "\x00" not in sanitize_filename("evil\x00.pdf")

    def test_empty_returns_unnamed(self):
        assert sanitize_filename("") == "unnamed"

    def test_dot_only_returns_unnamed(self):
        assert sanitize_filename("..") == "unnamed"
        assert sanitize_filename(".") == "unnamed"

    def test_replaces_unsafe_characters(self):
        result = sanitize_filename("my file;rm -rf.pdf")
        assert "/" not in result and "\\" not in result
        assert result.endswith(".pdf")

    def test_result_has_no_directory_separators(self):
        result = sanitize_filename("a/b/c/../../d.txt")
        assert "/" not in result
        assert result == "d.txt"


# ---------------------------------------------------------------------------
# validate_file
# ---------------------------------------------------------------------------
class TestValidateFile:
    def test_valid_pdf_passes(self, settings):
        result = validate_file(PDF_BYTES, "document.pdf", settings)
        assert isinstance(result, ValidationResult)
        assert result.valid is True
        assert result.detected_type == "application/pdf"
        assert result.error is None
        assert result.sanitized_filename == "document.pdf"

    def test_valid_png_passes(self, settings):
        result = validate_file(PNG_BYTES, "image.png", settings)
        assert result.valid is True
        assert result.detected_type == "image/png"

    def test_rejects_executable_extension(self, settings):
        result = validate_file(PDF_BYTES, "malware.exe", settings)
        assert result.valid is False
        assert ".exe" in result.error

    @pytest.mark.parametrize("ext", [".exe", ".dll", ".sh", ".bat", ".cmd"])
    def test_rejects_all_blocked_extensions(self, settings, ext):
        result = validate_file(PDF_BYTES, f"file{ext}", settings)
        assert result.valid is False
        assert "not allowed" in result.error.lower()

    def test_rejects_executable_content_despite_safe_extension(self, settings):
        # Renamed executable should still be rejected via magic bytes.
        result = validate_file(EXE_BYTES, "document.pdf", settings)
        assert result.valid is False
        assert "executable" in result.error.lower()

    def test_rejects_shell_script_content(self, settings):
        result = validate_file(SHELL_BYTES, "script.txt", settings)
        assert result.valid is False
        assert "executable" in result.error.lower()

    def test_rejects_empty_file(self, settings):
        result = validate_file(b"", "empty.pdf", settings)
        assert result.valid is False
        assert "empty" in result.error.lower()

    def test_rejects_oversized_file(self, settings):
        oversized = PDF_BYTES + b"\x00" * (settings.max_file_size + 1)
        result = validate_file(oversized, "big.pdf", settings)
        assert result.valid is False
        assert "exceeds" in result.error.lower()

    def test_accepts_file_at_size_limit(self):
        small_settings = Settings(max_file_size=len(PDF_BYTES))
        result = validate_file(PDF_BYTES, "exact.pdf", small_settings)
        assert result.valid is True

    def test_rejects_unknown_content_type(self, settings):
        result = validate_file(b"\x01\x02\x03\x04 random", "mystery.dat", settings)
        assert result.valid is False
        assert "could not determine" in result.error.lower()

    def test_sanitizes_filename_with_path_traversal(self, settings):
        result = validate_file(PDF_BYTES, "../../etc/report.pdf", settings)
        assert result.valid is True
        assert result.sanitized_filename == "report.pdf"

    def test_error_lists_supported_formats_for_unknown(self, settings):
        result = validate_file(b"\xde\xad\xbe\xef unknown", "x.bin", settings)
        assert result.valid is False
        assert "PDF" in result.error

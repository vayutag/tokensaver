"""Security-focused regression tests.

These tests lock in security-relevant behavior that is easy to regress:

- The configurable file-size cap: a limit of 0 means "unlimited" (any size is
  accepted), while a positive limit is still strictly enforced.
- The download endpoint's UUID guard, which prevents path-traversal or
  injection via the ``result_id`` path parameter.
- Filename sanitization and executable rejection (cross-checked here as a
  defense-in-depth regression guard).

Validates: Requirements 2.x (size), 13.2, 13.3, 13.4 (validation/security).
"""

from app.api.download import _is_valid_uuid
from app.config import Settings
from app.services.file_validation import sanitize_filename, validate_file

# A minimal valid PDF header so content passes magic-byte detection.
PDF_BYTES = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"


# ---------------------------------------------------------------------------
# File-size cap: unlimited vs enforced
# ---------------------------------------------------------------------------
class TestFileSizeCap:
    def test_unlimited_accepts_large_file(self):
        """max_file_size=0 means no cap: a large file is still accepted."""
        unlimited = Settings(max_file_size=0)
        # ~5MB payload, far larger than the old 50MB-era test fixtures but the
        # point is that NO size check rejects it when the cap is disabled.
        big = PDF_BYTES + b"\x00" * (5 * 1024 * 1024)
        result = validate_file(big, "huge.pdf", unlimited)
        assert result.valid is True
        assert result.detected_type == "application/pdf"

    def test_negative_limit_treated_as_unlimited(self):
        """A negative cap is also treated as 'no limit'."""
        unlimited = Settings(max_file_size=-1)
        big = PDF_BYTES + b"\x00" * (1024 * 1024)
        assert validate_file(big, "big.pdf", unlimited).valid is True

    def test_positive_limit_still_enforced(self):
        """A positive cap must still reject files that exceed it."""
        capped = Settings(max_file_size=1024)  # 1KB
        oversized = PDF_BYTES + b"\x00" * 2048
        result = validate_file(oversized, "big.pdf", capped)
        assert result.valid is False
        assert "exceeds" in (result.error or "").lower()

    def test_default_cap_is_5gb(self):
        """The shipped default cap is 5GB."""
        assert Settings().max_file_size == 5 * 1024 * 1024 * 1024

    def test_file_under_5gb_default_is_accepted(self):
        """A normal-sized file is accepted under the default 5GB cap."""
        result = validate_file(PDF_BYTES, "doc.pdf", Settings())
        assert result.valid is True


# ---------------------------------------------------------------------------
# Download endpoint UUID guard (path-traversal / injection prevention)
# ---------------------------------------------------------------------------
class TestDownloadUuidGuard:
    def test_accepts_well_formed_uuid(self):
        assert _is_valid_uuid("3f2504e0-4f89-41d3-9a0c-0305e82c3301") is True

    def test_rejects_path_traversal(self):
        assert _is_valid_uuid("../../etc/passwd") is False
        assert _is_valid_uuid("..\\..\\windows\\system32") is False

    def test_rejects_arbitrary_strings(self):
        for bad in ("", "not-a-uuid", "result.md", "../secret", "%2e%2e"):
            assert _is_valid_uuid(bad) is False


# ---------------------------------------------------------------------------
# Defense-in-depth: filename sanitization + executable rejection still hold
# ---------------------------------------------------------------------------
class TestValidationDefenseInDepth:
    def test_filename_sanitization_strips_traversal(self):
        assert sanitize_filename("../../etc/passwd") == "passwd"
        assert "/" not in sanitize_filename("a/b/c.txt")
        assert "\\" not in sanitize_filename("a\\b\\c.txt")

    def test_executable_extension_rejected_even_when_unlimited(self):
        """Removing the size cap must not weaken executable rejection."""
        unlimited = Settings(max_file_size=0)
        result = validate_file(PDF_BYTES, "malware.exe", unlimited)
        assert result.valid is False

    def test_renamed_executable_rejected_by_magic_bytes(self):
        unlimited = Settings(max_file_size=0)
        exe = b"MZ\x90\x00" + b"\x00" * 32
        result = validate_file(exe, "document.pdf", unlimited)
        assert result.valid is False
        assert "executable" in (result.error or "").lower()

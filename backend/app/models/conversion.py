"""Pydantic models for file conversion requests and responses.

These models define the request/response contract for the conversion
API and are used by FastAPI for automatic validation and OpenAPI schema
generation.

Task 1.3 - Shared data models.
Validates: Requirements 2.3, 2.4, 4.2, 14.5
"""

from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, Field


class ConversionRequest(BaseModel):
    """Optional parameters accepted by the POST /api/convert endpoint.

    The uploaded file itself is received as multipart form data; this
    model captures the accompanying conversion options.

    Validates: Requirements 14.2, 14.5, 4.2
    """

    cloud_service: Optional[Literal["azure_di", "azure_cu"]] = Field(
        default=None,
        description="Optional cloud service to use for enhanced conversion.",
    )
    extract_images: bool = Field(
        default=True,
        description="Whether to extract images from the source document.",
    )
    preserve_formatting: bool = Field(
        default=True,
        description="Whether to preserve source formatting where possible.",
    )
    timeout: int = Field(
        default=30,
        ge=1,
        le=300,
        description="Maximum conversion time in seconds (1-300).",
    )


class ConversionMetadata(BaseModel):
    """Structured metadata describing a completed conversion.

    Validates: Requirements 4.4, 5.6
    """

    file_type: str = Field(
        ...,
        description="Detected MIME type of the source file.",
    )
    file_size: int = Field(
        ...,
        gt=0,
        description="Size of the source file in bytes.",
    )
    processing_time: float = Field(
        ...,
        ge=0,
        description="Time taken to perform the conversion, in seconds.",
    )
    converter_used: str = Field(
        ...,
        description="Identifier of the converter used by MarkItDown.",
    )
    output_size: int = Field(
        default=0,
        ge=0,
        description="Size of the converted markdown output in bytes (UTF-8).",
    )
    size_reduction_percent: float = Field(
        default=0.0,
        description=(
            "Percentage reduction from source file size to markdown output "
            "size. Positive means the output is smaller; can be negative when "
            "the markdown is larger than the source (e.g. already-plain text)."
        ),
    )
    image_count: Optional[int] = Field(
        default=None,
        ge=0,
        description="Number of images extracted, when applicable.",
    )
    page_count: Optional[int] = Field(
        default=None,
        ge=0,
        description="Number of pages processed, when applicable.",
    )


class ConversionResponse(BaseModel):
    """Response returned for a single file conversion.

    Validates: Requirements 4.6, 4.7, 14.5
    """

    id: str = Field(
        ...,
        description="Unique result identifier (UUID v4).",
    )
    markdown: str = Field(
        default="",
        description="Converted markdown content (empty on failure).",
    )
    metadata: ConversionMetadata = Field(
        ...,
        description="Metadata describing the conversion.",
    )
    success: bool = Field(
        ...,
        description="Whether the conversion succeeded.",
    )
    error: Optional[str] = Field(
        default=None,
        description="Descriptive error message when success is False.",
    )
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="UTC time at which the conversion completed.",
    )

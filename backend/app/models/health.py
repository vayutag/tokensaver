"""Pydantic models for the system health endpoint.

Includes resource utilisation, aggregated conversion metrics, and the overall
health response surfaced by ``GET /api/health``.

Task 1.3 - Shared data models.
Validates: Requirements 14.4, 15.1, 15.3, 15.4
"""

from typing import Literal, Optional

from pydantic import BaseModel, Field


class ResourceStatus(BaseModel):
    """Resource utilisation snapshot reported by the health endpoint.

    Used to surface disk and memory pressure so the system can report a
    degraded status when constraints are detected.

    Validates: Requirements 15.4, 15.6
    """

    disk_total_bytes: Optional[int] = Field(
        default=None,
        description="Total disk capacity of the storage volume, in bytes.",
    )
    disk_free_bytes: Optional[int] = Field(
        default=None,
        description="Free disk space on the storage volume, in bytes.",
    )
    disk_percent_used: Optional[float] = Field(
        default=None,
        description="Percentage of disk capacity currently in use (0-100).",
    )
    memory_total_bytes: Optional[int] = Field(
        default=None,
        description="Total system memory, in bytes, when available.",
    )
    memory_available_bytes: Optional[int] = Field(
        default=None,
        description="Available system memory, in bytes, when available.",
    )
    memory_percent_used: Optional[float] = Field(
        default=None,
        description="Percentage of system memory in use (0-100), when available.",
    )


class ConversionMetrics(BaseModel):
    """Aggregated, in-memory metrics for conversion operations.

    Reported by the health endpoint so operators and monitoring services can
    observe conversion throughput and reliability. Counters are process-local
    and reset on restart.

    Validates: Requirements 15.1, 15.4
    """

    total_conversions: int = Field(
        default=0,
        description="Total number of recorded conversion attempts.",
    )
    successful_conversions: int = Field(
        default=0,
        description="Number of conversions that completed successfully.",
    )
    failed_conversions: int = Field(
        default=0,
        description="Number of conversions that failed or timed out.",
    )
    average_processing_time_seconds: float = Field(
        default=0.0,
        description="Mean processing time across all recorded conversions.",
    )
    total_processing_time_seconds: float = Field(
        default=0.0,
        description="Sum of processing times across all recorded conversions.",
    )


class HealthResponse(BaseModel):
    """Response returned by the GET /api/health endpoint.

    Reports overall system status, version, and the list of supported
    file formats so the frontend can surface a status indicator.

    Validates: Requirements 14.4, 15.1, 15.2, 15.3, 15.6
    """

    status: Literal["healthy", "degraded", "unavailable"] = Field(
        ...,
        description="Overall system status.",
    )
    version: str = Field(
        ...,
        description="Backend application version.",
    )
    supported_formats: list[str] = Field(
        default_factory=list,
        description="List of supported file format labels.",
    )
    markitdown_available: bool = Field(
        default=True,
        description="Whether the MarkItDown library is available.",
    )
    resources: Optional[ResourceStatus] = Field(
        default=None,
        description="Disk and memory utilisation snapshot, when available.",
    )
    metrics: Optional[ConversionMetrics] = Field(
        default=None,
        description="Aggregated conversion operation metrics.",
    )

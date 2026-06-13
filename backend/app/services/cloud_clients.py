"""Optional cloud-service client initialization for enhanced conversions.

This module centralizes the (optional) wiring for Azure AI services used to
improve conversion quality for complex documents:

- **Azure Document Intelligence** (``azure_di``) for richer document parsing.
- **Azure Content Understanding** (``azure_cu``) for multimodal understanding.

The Azure SDK packages are *optional* dependencies. To keep them optional, all
SDK imports are performed lazily inside the initialization functions. If a
service is not configured (missing endpoint/key) or the corresponding SDK is
not installed, the initializer returns ``None`` and the caller is expected to
fall back to local processing (Requirement 8.4) rather than failing.

A startup validation helper, :func:`validate_cloud_configuration`, inspects the
current settings and logs which cloud services are available, warning about
partial or invalid configuration (Requirements 18.3, 18.4).

Validates: Requirements 8.3, 18.3, 18.4
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Optional

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Configuration validation
# ---------------------------------------------------------------------------


@dataclass
class CloudServiceStatus:
    """Summary of a single cloud service's configuration state.

    Attributes:
        name: Human-readable service name.
        configured: ``True`` when both endpoint and key are present.
        partial: ``True`` when exactly one of endpoint/key is present
            (an invalid/incomplete configuration).
        warnings: Any configuration warnings discovered for this service.
    """

    name: str
    configured: bool = False
    partial: bool = False
    warnings: list[str] = field(default_factory=list)


@dataclass
class CloudConfigurationReport:
    """Aggregate report describing cloud service configuration at startup.

    Validates: Requirements 18.3, 18.4
    """

    services: list[CloudServiceStatus] = field(default_factory=list)

    @property
    def any_configured(self) -> bool:
        """Whether at least one cloud service is fully configured."""
        return any(service.configured for service in self.services)

    @property
    def has_warnings(self) -> bool:
        """Whether any service reported a configuration warning."""
        return any(service.warnings for service in self.services)


def _evaluate_service(
    name: str,
    endpoint: Optional[str],
    key: Optional[str],
) -> CloudServiceStatus:
    """Evaluate the configuration state of a single endpoint/key pair."""
    has_endpoint = bool(endpoint and endpoint.strip())
    has_key = bool(key and key.strip())

    status = CloudServiceStatus(name=name)

    if has_endpoint and has_key:
        status.configured = True
    elif has_endpoint or has_key:
        # Exactly one of the two values is present: invalid/partial config.
        status.partial = True
        missing = "key" if has_endpoint else "endpoint"
        status.warnings.append(
            f"{name} is partially configured (missing {missing}); "
            "the service will be disabled until both endpoint and key are set."
        )

    return status


def validate_cloud_configuration(
    settings: Optional[Settings] = None,
) -> CloudConfigurationReport:
    """Validate cloud service configuration and log the outcome.

    This is intended to be called once at application startup. It inspects the
    Azure Document Intelligence and Azure Content Understanding settings and:

    - logs which services are fully configured and available,
    - warns on partial/invalid configuration (only endpoint or only key set),
    - notes when no cloud services are configured (local-only processing).

    Validates: Requirements 18.3, 18.4, 8.3

    Args:
        settings: Application settings; defaults to the global instance.

    Returns:
        A :class:`CloudConfigurationReport` summarizing each service.
    """
    settings = settings or get_settings()

    di_status = _evaluate_service(
        "Azure Document Intelligence",
        settings.azure_di_endpoint,
        settings.azure_di_key,
    )
    cu_status = _evaluate_service(
        "Azure Content Understanding",
        settings.azure_cu_endpoint,
        settings.azure_cu_key,
    )

    report = CloudConfigurationReport(services=[di_status, cu_status])

    for service in report.services:
        if service.configured:
            logger.info("Cloud service configured and available: %s", service.name)
        for warning in service.warnings:
            logger.warning("Cloud service configuration warning: %s", warning)

    if not report.any_configured:
        logger.info(
            "No cloud services configured; all conversions will use local "
            "processing only."
        )

    return report


# ---------------------------------------------------------------------------
# Client initialization (lazy SDK imports, optional dependencies)
# ---------------------------------------------------------------------------


def init_azure_document_intelligence_client(
    settings: Optional[Settings] = None,
) -> Optional[Any]:
    """Initialize an Azure Document Intelligence client if possible.

    The Azure SDK is imported lazily so the dependency remains optional. The
    function returns ``None`` (rather than raising) when:

    - the service is not configured (missing endpoint and/or key), or
    - the ``azure-ai-documentintelligence`` SDK is not installed, or
    - client construction fails for any reason.

    Callers should treat a ``None`` result as "fall back to local processing"
    (Requirement 8.4).

    Validates: Requirements 8.3, 18.4

    Args:
        settings: Application settings; defaults to the global instance.

    Returns:
        An initialized client instance, or ``None`` if unavailable.
    """
    settings = settings or get_settings()

    if not settings.has_azure_di:
        logger.debug(
            "Azure Document Intelligence not configured; returning no client."
        )
        return None

    try:
        # Lazy imports keep the Azure SDK optional.
        from azure.ai.documentintelligence import DocumentIntelligenceClient
        from azure.core.credentials import AzureKeyCredential
    except ImportError:
        logger.warning(
            "Azure Document Intelligence is configured but the "
            "'azure-ai-documentintelligence' package is not installed; "
            "falling back to local processing. Install it to enable this "
            "service."
        )
        return None

    try:
        client = DocumentIntelligenceClient(
            endpoint=settings.azure_di_endpoint,
            credential=AzureKeyCredential(settings.azure_di_key),
        )
        logger.info("Initialized Azure Document Intelligence client.")
        return client
    except Exception as exc:  # noqa: BLE001 - never fail startup on this
        logger.warning(
            "Failed to initialize Azure Document Intelligence client: %s; "
            "falling back to local processing.",
            exc,
        )
        return None


def init_azure_content_understanding_client(
    settings: Optional[Settings] = None,
) -> Optional[Any]:
    """Initialize an Azure Content Understanding client if possible.

    Like :func:`init_azure_document_intelligence_client`, the Azure SDK is
    imported lazily and the function returns ``None`` when the service is not
    configured, the SDK is unavailable, or construction fails.

    Validates: Requirements 8.3, 18.4

    Args:
        settings: Application settings; defaults to the global instance.

    Returns:
        An initialized client instance, or ``None`` if unavailable.
    """
    settings = settings or get_settings()

    if not settings.has_azure_cu:
        logger.debug(
            "Azure Content Understanding not configured; returning no client."
        )
        return None

    try:
        # Lazy imports keep the Azure SDK optional. Azure Content Understanding
        # is accessed via the azure-ai-inference SDK's ChatCompletionsClient.
        from azure.ai.inference import ChatCompletionsClient
        from azure.core.credentials import AzureKeyCredential
    except ImportError:
        logger.warning(
            "Azure Content Understanding is configured but the "
            "'azure-ai-inference' package is not installed; falling back to "
            "local processing. Install it to enable this service."
        )
        return None

    try:
        client = ChatCompletionsClient(
            endpoint=settings.azure_cu_endpoint,
            credential=AzureKeyCredential(settings.azure_cu_key),
        )
        logger.info("Initialized Azure Content Understanding client.")
        return client
    except Exception as exc:  # noqa: BLE001 - never fail startup on this
        logger.warning(
            "Failed to initialize Azure Content Understanding client: %s; "
            "falling back to local processing.",
            exc,
        )
        return None


def get_cloud_client(
    cloud_service: Optional[str],
    settings: Optional[Settings] = None,
) -> Optional[Any]:
    """Return an initialized client for the requested cloud service.

    Dispatches to the appropriate initializer based on ``cloud_service``.
    Returns ``None`` for an unknown/empty service identifier or when the
    requested service is unavailable, so callers can fall back to local
    processing (Requirement 8.4).

    Validates: Requirements 8.3

    Args:
        cloud_service: One of ``"azure_di"``, ``"azure_cu"``, or ``None``.
        settings: Application settings; defaults to the global instance.

    Returns:
        An initialized client instance, or ``None`` if unavailable.
    """
    if not cloud_service:
        return None

    settings = settings or get_settings()
    normalized = cloud_service.strip().lower()

    if normalized == "azure_di":
        return init_azure_document_intelligence_client(settings)
    if normalized == "azure_cu":
        return init_azure_content_understanding_client(settings)

    logger.warning(
        "Unknown cloud service requested: '%s'; falling back to local "
        "processing.",
        cloud_service,
    )
    return None

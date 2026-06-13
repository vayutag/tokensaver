"""
Configuration module for MarkItDown Website Backend.

Reads configuration from environment variables and provides validated settings
for the application using Pydantic Settings.

Environment Variables:
- MAX_FILE_SIZE: Maximum file size in bytes (default: 50MB)
- CONVERSION_TIMEOUT: Maximum conversion time in seconds (default: 30)
- MAX_CONCURRENT_CONVERSIONS: Maximum simultaneous conversions (default: 5)
- REQUEST_TIMEOUT: Safety-net per-request timeout in seconds (default: 120)
- HEALTH_CACHE_TTL: Seconds to cache the health response (default: 5)
- TEMP_STORAGE_PATH: Path for temporary file storage (default: ./temp)
- RESULT_RETENTION_HOURS: Hours to retain conversion results (default: 1)
- CORS_ORIGINS: Comma-separated list of allowed CORS origins
- RATE_LIMIT_PER_HOUR: Maximum requests per IP per hour (default: 100)
- AZURE_DI_ENDPOINT: Azure Document Intelligence endpoint (optional)
- AZURE_DI_KEY: Azure Document Intelligence API key (optional)
- AZURE_CU_ENDPOINT: Azure Content Understanding endpoint (optional)
- AZURE_CU_KEY: Azure Content Understanding API key (optional)
"""

from pathlib import Path
from typing import Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables.

    Validates: Requirements 18.1, 18.2, 18.5
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
        env_nested_delimiter="__",
    )

    # File handling settings
    max_file_size: int = Field(
        default=5 * 1024 * 1024 * 1024,  # 5GB in bytes
        description="Maximum file size in bytes (0 = unlimited)",
    )

    conversion_timeout: int = Field(
        default=30,
        ge=1,
        le=300,
        description="Maximum conversion time in seconds",
    )

    max_concurrent_conversions: int = Field(
        default=5,
        ge=1,
        le=20,
        description="Maximum number of simultaneous file conversions",
    )

    # Performance / serving settings
    # Validates: Requirements 12.3, 12.4, 12.5
    request_timeout: int = Field(
        default=120,
        ge=1,
        le=600,
        description=(
            "Safety-net timeout in seconds for any single HTTP request. Set "
            "intentionally larger than CONVERSION_TIMEOUT so genuine "
            "conversions are not cut short; requests exceeding this receive a "
            "504 Gateway Timeout. Guards against stuck/hung requests."
        ),
    )

    health_cache_ttl: int = Field(
        default=5,
        ge=0,
        le=60,
        description=(
            "Seconds to cache the /api/health response. Avoids recomputing "
            "disk/memory statistics on every poll. Set to 0 to disable "
            "caching."
        ),
    )

    # Storage settings
    temp_storage_path: str = Field(
        default="./temp",
        description="Path for temporary file storage",
    )

    result_retention_hours: int = Field(
        default=1,
        ge=1,
        le=24,
        description="Hours to retain conversion results",
    )

    # CORS settings
    cors_origins: str = Field(
        default="http://localhost:3000,http://localhost:5173",
        description="Comma-separated list of allowed CORS origins",
    )

    # Azure AI service settings (optional)
    azure_di_endpoint: Optional[str] = Field(
        default=None,
        description="Azure Document Intelligence endpoint URL",
    )

    azure_di_key: Optional[str] = Field(
        default=None,
        description="Azure Document Intelligence API key",
    )

    azure_cu_endpoint: Optional[str] = Field(
        default=None,
        description="Azure Content Understanding endpoint URL",
    )

    azure_cu_key: Optional[str] = Field(
        default=None,
        description="Azure Content Understanding API key",
    )

    # Rate limiting
    rate_limit_per_hour: int = Field(
        default=100,
        ge=1,
        description="Maximum requests per IP per hour",
    )

    # Application settings
    app_name: str = Field(
        default="MarkItDown Website API",
        description="Application name",
    )

    app_version: str = Field(
        default="0.1.0",
        description="Application version",
    )

    debug: bool = Field(
        default=False,
        description="Enable debug mode",
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, v):
        """Parse CORS origins from comma-separated string."""
        if v is None or v == "":
            return "http://localhost:3000,http://localhost:5173"
        return v

    @property
    def cors_origins_list(self) -> list[str]:
        """Get CORS origins as a list."""
        return [
            origin.strip()
            for origin in self.cors_origins.split(",")
            if origin.strip()
        ]

    @field_validator("temp_storage_path")
    @classmethod
    def validate_storage_path(cls, v):
        """Ensure storage path is valid and exists."""
        path = Path(v)
        # Create directory if it doesn't exist
        path.mkdir(parents=True, exist_ok=True)
        return str(path.absolute())

    @property
    def has_azure_di(self) -> bool:
        """Check if Azure Document Intelligence is configured."""
        return bool(self.azure_di_endpoint and self.azure_di_key)

    @property
    def has_azure_cu(self) -> bool:
        """Check if Azure Content Understanding is configured."""
        return bool(self.azure_cu_endpoint and self.azure_cu_key)

    @property
    def has_cloud_services(self) -> bool:
        """Check if any cloud services are configured."""
        return self.has_azure_di or self.has_azure_cu


# Global settings instance
settings = Settings()


def get_settings() -> Settings:
    """
    Get application settings instance.

    Returns:
        Settings: Validated application settings
    """
    return settings
